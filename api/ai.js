// Vercel serverless function — POST { kind, text } -> { result, provider }
// Tries Groq first, falls back to Mistral. Both API keys are read from
// environment variables set in the Vercel project (never committed to git).

const WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_REQUESTS = 8; // per IP, per window

// Best-effort in-memory limiter. Serverless instances are ephemeral and can
// scale to multiple concurrent instances, so this is a soft cap, not a hard
// guarantee — good enough for a free, no-login demo tool. For strict limits
// across all instances, back this with a shared store (e.g. Upstash Redis).
const hits = globalThis.__cvmakerAiHits || (globalThis.__cvmakerAiHits = new Map());

const PROMPTS = {
  summary:
    "Rewrite the following resume professional summary to be concise, impactful, and ATS-friendly. Keep it 2-4 sentences, in English, no first-person pronouns. Return ONLY the rewritten text — no quotes, no markdown, no preamble.",
  org:
    'Rewrite the following organizational/work experience description into 2-4 concise, ATS-friendly bullet points starting with strong action verbs. Separate bullets with a newline, each starting with "• ". Return ONLY the rewritten text — no preamble.',
  edu:
    'Rewrite the following education note/highlight into concise, ATS-friendly bullet points starting with strong action verbs. Separate bullets with a newline, each starting with "• ". Return ONLY the rewritten text — no preamble.',
  ach:
    "Rewrite the following achievement description to be concise and impactful for a resume, in English, 1-2 sentences. Return ONLY the rewritten text — no quotes, no preamble.",
  proj:
    "Rewrite the following project description to be concise, results-oriented, and ATS-friendly for a resume, in English, 1-2 sentences. Return ONLY the rewritten text — no quotes, no preamble.",
};

const PARSE_SCHEMA_HINT = `Extract structured resume data from the raw text below into STRICT JSON only (no markdown, no code fences, no explanation, no trailing commas). Use this exact shape — omit nothing, use "" or [] for anything not found:
{
  "name": "", "role": "", "about": "", "location": "", "email": "", "phone": "", "linkedin": "", "github": "", "instagram": "", "website": "",
  "org": [{"org":"","role":"","start":"","end":"","cert":"","summary":""}],
  "education": [{"school":"","degree":"","start":"","end":"","location":"","cert":"","summary":""}],
  "ach": [{"title":"","year":"","cert":"","summary":""}],
  "skills": ["skill1","skill2"],
  "proj": [{"name":"","role":"","link":"","summary":"","tech":["tech1"],"featured":false}]
}
Rules: "org" = organizational/work experience entries. Keep dates in the format found in the source (e.g. "Jan 2022"). Leave "cert"/"link" empty unless an explicit URL is present in the source. Output valid JSON and nothing else.`;

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Read-only: how much of the window is left, without spending any of it.
// Lets the client show "X left / resets in Yh" on page load.
function getStatus(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    return { limit: MAX_REQUESTS, remaining: MAX_REQUESTS, resetAt: now + WINDOW_MS };
  }
  return { limit: MAX_REQUESTS, remaining: Math.max(0, MAX_REQUESTS - rec.count), resetAt: rec.resetAt };
}

// Spends one request from the window.
function consume(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit: MAX_REQUESTS, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }
  if (rec.count >= MAX_REQUESTS) {
    return { allowed: false, limit: MAX_REQUESTS, remaining: 0, resetAt: rec.resetAt };
  }
  rec.count += 1;
  return { allowed: true, limit: MAX_REQUESTS, remaining: MAX_REQUESTS - rec.count, resetAt: rec.resetAt };
}

async function callProvider(provider, messages, opts) {
  const payload = {
    model: provider.model,
    messages,
    temperature: opts.jsonMode ? 0.3 : 0.6,
    max_tokens: opts.maxTokens,
  };
  if (opts.jsonMode) payload.response_format = { type: "json_object" };

  const r = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + provider.key,
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(provider.name + " returned " + r.status + (detail ? ": " + detail.slice(0, 200) : ""));
  }
  const data = await r.json();
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out || !out.trim()) throw new Error(provider.name + " returned an empty result");
  return out.trim();
}

function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

module.exports = async function handler(req, res) {
  const ip = getClientIp(req);

  // Status check — the UI polls this on load to show "X left / resets in Yh"
  // without spending any of the user's quota.
  if (req.method === "GET") {
    const st = getStatus(ip);
    res.setHeader("X-RateLimit-Limit", String(st.limit));
    res.setHeader("X-RateLimit-Remaining", String(st.remaining));
    res.setHeader("X-RateLimit-Reset", String(st.resetAt));
    res.status(200).json(st);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rl = consume(ip);
  res.setHeader("X-RateLimit-Limit", String(rl.limit));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(rl.resetAt));
  if (!rl.allowed) {
    const minsLeft = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
    res.status(429).json({ error: "Rate limit reached. Try again in ~" + minsLeft + " minutes.", limit: rl.limit, remaining: rl.remaining, resetAt: rl.resetAt });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const kind = body && body.kind;
  const isParse = kind === "parse";
  const text = ((body && body.text) || "").toString().slice(0, isParse ? 12000 : 2000);

  if (!text.trim() || (!isParse && !PROMPTS[kind])) {
    res.status(400).json({ error: "Missing or invalid 'kind'/'text'" });
    return;
  }

  const messages = isParse
    ? [
        {
          role: "system",
          content: "You are a resume-parsing assistant. You only output strict JSON, nothing else — no markdown, no code fences, no commentary.",
        },
        { role: "user", content: PARSE_SCHEMA_HINT + "\n\n---\n" + text },
      ]
    : [
        {
          role: "system",
          content:
            "You are a professional resume-writing assistant. You only output the rewritten text with no preamble, no markdown formatting, and no quotation marks.",
        },
        { role: "user", content: PROMPTS[kind] + "\n\n---\n" + text },
      ];

  const providers = [
    process.env.GROQ_API_KEY && {
      name: "groq",
      key: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.1-8b-instant",
    },
    process.env.MISTRAL_API_KEY && {
      name: "mistral",
      key: process.env.MISTRAL_API_KEY,
      url: "https://api.mistral.ai/v1/chat/completions",
      model: "mistral-small-latest",
    },
  ].filter(Boolean);

  if (!providers.length) {
    res.status(500).json({ error: "No AI provider configured on the server (missing GROQ_API_KEY / MISTRAL_API_KEY)." });
    return;
  }

  const callOpts = { maxTokens: isParse ? 3000 : 400, jsonMode: isParse };

  let lastError = "";
  for (const provider of providers) {
    try {
      const raw = await callProvider(provider, messages, callOpts);
      if (!isParse) {
        res.status(200).json({ result: raw, provider: provider.name, limit: rl.limit, remaining: rl.remaining, resetAt: rl.resetAt });
        return;
      }
      const parsed = extractJson(raw);
      if (!parsed || typeof parsed !== "object") {
        lastError = provider.name + " did not return valid JSON";
        continue;
      }
      res.status(200).json({ result: parsed, provider: provider.name, limit: rl.limit, remaining: rl.remaining, resetAt: rl.resetAt });
      return;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }

  res.status(502).json({ error: "AI providers unavailable: " + lastError });
};

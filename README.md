# CV Builder

A free, ATS-friendly resume/CV builder. No login, no accounts — data is kept
in your browser (`localStorage`) only. Includes:

- A "✨ AI improve" button per section (summary, each work/org/education/
  achievement/project description) plus a "✨ Improve All" bulk action.
- A chat assistant that can review/rewrite any part of the CV — it asks
  clarifying questions instead of guessing, shows every proposed change as a
  before/after preview the user must explicitly approve, and every applied
  change can be undone.
- Drag-and-drop import of an existing CV (PDF) — text is extracted
  client-side, then parsed into the form by AI.
- Several ATS-safe templates, grouped as "Recommended for Indonesia" vs
  "International" in the template picker.

All AI features are powered by a serverless function that tries Groq, then
Mistral, then OpenRouter (free model) as a last resort.

## Project structure

```
index.html   — the whole app (static HTML/CSS/JS, no build step)
api/ai.js    — Vercel serverless function for the AI-assist feature
```

## Running locally

No build step is needed for the static site — just open `index.html` in a
browser. To also exercise the `/api/ai` function locally, use the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

Create a `.env.local` file (copy `.env.example`) with your own API keys for
local testing. `.env.local` is git-ignored and never committed.

## Deploying to Vercel

1. Import this repo into Vercel (framework preset: "Other" — no build command
   needed).
2. In the project's **Settings → Environment Variables**, add whichever of
   these you have (all optional, but at least one is required for the AI
   features to work):
   - `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com)
   - `MISTRAL_API_KEY` — from [console.mistral.ai](https://console.mistral.ai)
   - `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys)
     (uses the free `openai/gpt-oss-20b:free` model)
3. Redeploy. The server tries Groq first, then Mistral, then OpenRouter —
   whichever keys are set are used in that order; a provider without a key
   is simply skipped.

**Never commit real API keys to this repo.** They're read from environment
variables on the server only — the browser never sees them.

## Rate limiting

Each visitor gets **8 AI requests per rolling 3-hour window**, enforced two ways:

- **Server-side, per IP** (`api/ai.js`): the source of truth. Tracked in an
  in-memory `Map` inside the serverless function — a best-effort limit, since
  Vercel can run multiple concurrent instances and recycle them over time, so
  the real-world cap per IP is approximate, not exact.
- **Client-side, per device** (`index.html`): the UI polls `GET /api/ai` on
  load and after every AI call to read the current `limit`/`remaining`/`resetAt`,
  shown as a badge in the top bar (e.g. "✨ AI: 3/8 left"). The result is
  cached in `localStorage`, so once a device hits 0 it immediately disables
  every AI button and the CV-import dropzone on that device — no need to wait
  for a failed request. This is a UX lock, not a security boundary: it's tied
  to `localStorage`, so clearing site data or using a private window resets
  it (the server-side IP limit still applies underneath).

Together this keeps a free, login-less tool from being trivially abused
without requiring accounts — not a strict, unbypassable quota.

For a stronger server-side guarantee (e.g. if this gets real traffic), swap
the in-memory `Map` in `api/ai.js` for a shared store such as
[Upstash Redis](https://upstash.com) or Vercel KV.

## Notes

- The API keys used during development were shared in plain text at some
  point — if that's ever true for your keys too, rotate them from the
  provider's dashboard before relying on this in production.

# CV Builder

A free, ATS-friendly resume/CV builder. No login, no accounts — data is kept
in your browser (`localStorage`) only. Includes an optional "✨ AI improve"
button on the summary and description fields, powered by a serverless
function that calls Groq (primary) with Mistral as a fallback.

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
2. In the project's **Settings → Environment Variables**, add:
   - `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com)
   - `MISTRAL_API_KEY` — from [console.mistral.ai](https://console.mistral.ai)
3. Redeploy. The AI button works once at least one key is set; if both are
   set, Groq is tried first and Mistral is used as a fallback.

**Never commit real API keys to this repo.** They're read from environment
variables on the server only — the browser never sees them.

## Rate limiting

`api/ai.js` limits each IP address to 8 AI requests per rolling 3-hour
window, tracked in-memory inside the serverless function. This is a
best-effort limit: because Vercel can run multiple instances of a function
concurrently and instances are recycled over time, the real-world cap per
user is approximate, not exact. It's meant to keep a free, login-less tool
from being trivially abused — not as a strict quota.

For a stronger guarantee (e.g. if this gets real traffic), swap the in-memory
`Map` in `api/ai.js` for a shared store such as
[Upstash Redis](https://upstash.com) or Vercel KV.

## Notes

- The API keys used during development were shared in plain text at some
  point — if that's ever true for your keys too, rotate them from the
  provider's dashboard before relying on this in production.

# Prompt Studio — a Flam-shaped prototype

Built by **Gaurav Jain** for Flam's Software Engineering Intern application.

## The problem this targets

Flam's whole product thesis is *"cut weeks to seconds"*: one prompt becomes
interactive, multi-variant creative, distributed everywhere at once (Web
Embed / Sharable Links / Flam Codes). This prototype rebuilds a real,
working slice of that pipeline — not a mockup of it:

1. **One campaign brief → several distinct creative directions**, generated
  by a Groq free-tier LLM (`qwen/qwen3.8-27b`), not just reworded copy —
   each direction gets its own angle, palette, and tone.
2. **Instant language switching** — every direction is generated with its
   translations already attached, so flipping a language is a local state
   change, not a new API call. The page measures and displays the real
   switch time live, the same "near-zero latency swap" idea behind Flicks.
3. **One-click remix** — regenerating a single direction keeps its angle
   and re-executes it, instead of throwing away the whole batch.
4. **Real distribution, not a fake button** — every direction can be turned
   into a sharable link (state-encoded in the URL, no database needed), an
   embeddable `<iframe>` snippet, and a scannable QR ("Flam Code"),
   mirroring Flam's actual omni-channel model.

Deliberately out of scope: the actual video/3D/avatar generation (Fable,
Fantom, Forge) — that needs Flam's own proprietary diffusion and synthesis
models and isn't something to fake convincingly. This prototype focuses on
the part of the pipeline that's honestly buildable end-to-end in the time
available: prompt → structured creative → instant variants → distribution.

## Stack

  exposed to the browser), calls Groq's OpenAI-compatible chat completions
  endpoint, and returns structured JSON.
  Flam's own site, a node-graph layout echoing their "Prompt-Powered
  Creation" canvas. QR codes are generated locally by the Node server so
  sharing still works when the browser is offline.

## Run it locally

```bash
npm install
cp .env.example .env
# put a free key from https://console.groq.com/keys into .env
npm start
```

Then open `http://localhost:3000`.

Getting a Groq key takes about two minutes, no credit card: create an
account at console.groq.com, go to **API Keys → Create Key**, and paste it
into `.env` as `GROQ_API_KEY`.

## Deploy it

Render is the simplest fit for this prototype because it runs the existing
Express server directly. The included `render.yaml` uses `npm ci`, starts
`npm start`, and checks `/api/health`. Create a Render Web Service from this
repository, add `GROQ_API_KEY` as a secret environment variable, and deploy.
Do not deploy this as a static-only Vercel site: the server-side Groq proxy and
local QR endpoint need a Node runtime. Vercel is possible later with API
functions, but it would require restructuring this app.

The generated share URL uses the deployed origin automatically, so QR codes
and embeds point to the live HTTPS URL after deployment. The QR PNG is made
locally by the server and cached for one day.

Groq usage is deliberately controlled: repeated full briefs are cached for ten
minutes, simultaneous identical requests are deduplicated, translations are
generated in the same request, and the response budget is capped at 1,200
tokens. A remix uses one direction request and falls back locally during a
temporary Groq outage or rate limit.

## Notes on the choices made here

  "bring your own key" client-side mode so it could run with zero backend
  at all — but shipping a real key in browser JS (even a free-tier one) is
  the kind of thing a reviewing engineer would flag, so this uses a proper
  backend proxy instead.
  markdown fences even when told not to; `extractJson()` in `server.js`
  strips fences and locates the outer `{...}` before parsing, so a stray
  code fence doesn't break generation.
  model is asked for genuine translations in-language up front, so
  switching languages never triggers a second network call.
 After Render gives you the HTTPS URL, set `PUBLIC_BASE_URL` to that exact URL
 in the service environment variables and redeploy before sharing any QR code.

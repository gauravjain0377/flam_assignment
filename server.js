require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
const generationCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

const SUPPORTED_LANGUAGES = [
  "English", "Hindi", "Tamil", "Telugu", "Bengali", "Marathi",
  "Kannada", "Gujarati", "Malayalam", "Punjabi", "Spanish", "French"
];

// ---- prompt builders -------------------------------------------------

function directionsSystemPrompt(count, languages) {
  return `You are a senior creative strategist inside an AI-native interactive-ad platform (like Flam). Given a short campaign brief, produce ${count} distinct creative directions for the SAME product/goal — each direction must have a genuinely different angle, tone, or hook, not just reworded copy.

Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:

{
  "directions": [
    {
      "id": "short-kebab-slug",
      "angle": "2-4 word label for the creative angle, e.g. 'Urgency & scarcity'",
      "headline": "punchy headline, max 8 words",
      "subhead": "one supporting sentence, max 16 words",
      "cta": "a short call to action, max 4 words",
      "mood": "one word mood, e.g. bold / playful / premium / warm / minimal",
      "palette": ["#hex1", "#hex2", "#hex3"],
      "translations": {
        ${languages.map((l) => `"${l}": { "headline": "...", "subhead": "...", "cta": "..." }`).join(",\n        ")}
      }
    }
  ]
}

Rules:
- palette must be 3 hex colors that visually suit the product/brand and mood, with enough contrast for white text to sit on the first color.
- translations must be genuine, natural translations in each target language's own script (not transliteration), matching the meaning and tone of the English version, same max word counts as a guide.
- Always include an "English" entry in translations equal to the main headline/subhead/cta even if English was requested as a language.
- Keep language playful/native, not robotic literal translation.
- Output strictly valid JSON. No trailing commas.`;
}

function singleDirectionSystemPrompt(languages) {
  return `You are a senior creative strategist inside an AI-native interactive-ad platform (like Flam). Given a campaign brief and an existing creative angle the user wants reshuffled, produce ONE new variation on that same angle — same core idea, fresh execution (different headline/subhead/cta/palette).

Return ONLY valid JSON, no markdown fences, matching exactly:

{
  "id": "short-kebab-slug",
  "angle": "2-4 word label, keep close to the original angle",
  "headline": "punchy headline, max 8 words",
  "subhead": "one supporting sentence, max 16 words",
  "cta": "a short call to action, max 4 words",
  "mood": "one word mood",
  "palette": ["#hex1", "#hex2", "#hex3"],
  "translations": {
    ${languages.map((l) => `"${l}": { "headline": "...", "subhead": "...", "cta": "..." }`).join(",\n    ")}
  }
}`;
}

function extractJson(text) {
  // Groq occasionally wraps JSON in fences even when told not to; strip defensively.
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function fallbackDirection(brief, angle, languages) {
  const cleanAngle = String(angle).trim() || "Fresh perspective";
  const base = {
    id: `local-${Date.now()}`,
    angle: cleanAngle,
    headline: `Make ${cleanAngle.toLowerCase()} impossible to ignore`,
    subhead: `A sharper take on ${brief.trim().slice(0, 72)}.`,
    cta: "Make it move",
    mood: "bold",
    palette: ["#ff6948", "#11110f", "#d8f84e"],
    translations: {},
  };
  languages.forEach((language) => {
    base.translations[language] = {
      headline: base.headline,
      subhead: base.subhead,
      cta: base.cta,
    };
  });
  return base;
}

async function callGroq(systemPrompt, userPrompt) {
  if (!GROQ_API_KEY) {
    const err = new Error(
      "GROQ_API_KEY is not set. Copy .env.example to .env and add a free key from https://console.groq.com/keys"
    );
    err.code = "NO_KEY";
    throw err;
  }

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    const err = new Error(`Groq API error (${resp.status}): ${errText}`);
    err.code = "GROQ_ERROR";
    throw err;
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  return extractJson(text);
}

// ---- routes ------------------------------------------------------------

app.get("/api/languages", (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

app.post("/api/generate", async (req, res) => {
  const { brief, languages = ["English", "Hindi"], count = 4 } = req.body || {};

  if (!brief || typeof brief !== "string" || brief.trim().length < 6) {
    return res.status(400).json({ error: "Give me a real campaign brief (at least a few words)." });
  }
  const safeLangs = (Array.isArray(languages) ? languages : ["English"]).filter((l) =>
    SUPPORTED_LANGUAGES.includes(l)
  );
  if (safeLangs.length === 0) safeLangs.push("English");
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 4, 2), 6);

  const started = Date.now();
  const cacheKey = JSON.stringify({ brief: brief.trim(), languages: safeLangs, count: safeCount });
  const cached = generationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.payload, cached: true, generationMs: Date.now() - started });
  }
  try {
    const parsed = await callGroq(
      directionsSystemPrompt(safeCount, safeLangs),
      `Campaign brief: ${brief.trim()}`
    );
    const directions = Array.isArray(parsed.directions) ? parsed.directions : [];
    const payload = { directions, generationMs: Date.now() - started, model: MODEL };
    generationCache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
    res.json(payload);
  } catch (err) {
    console.error(err);
    const status = err.code === "NO_KEY" ? 500 : 502;
    res.status(status).json({ error: err.message });
  }
});

app.post("/api/regenerate", async (req, res) => {
  const { brief, angle, languages = ["English"] } = req.body || {};
  if (!brief || !angle) {
    return res.status(400).json({ error: "Missing brief or angle to regenerate." });
  }
  const safeLangs = (Array.isArray(languages) ? languages : ["English"]).filter((l) =>
    SUPPORTED_LANGUAGES.includes(l)
  );
  if (safeLangs.length === 0) safeLangs.push("English");

  const started = Date.now();
  try {
    const parsed = await callGroq(
      singleDirectionSystemPrompt(safeLangs),
      `Campaign brief: ${brief.trim()}\nExisting angle to riff on: ${angle}\nGive me a fresh execution of this same angle.`
    );
    res.json({ direction: parsed, generationMs: Date.now() - started });
  } catch (err) {
    console.error(err);
    if (err.code === "NO_KEY" || err.code === "GROQ_ERROR") {
      return res.json({ direction: fallbackDirection(brief, angle, safeLangs), fallback: true, generationMs: Date.now() - started });
    }
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasKey: Boolean(GROQ_API_KEY), model: MODEL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Flam Prompt Studio running on http://localhost:${PORT}`);
  if (!GROQ_API_KEY) {
    console.warn("⚠️  No GROQ_API_KEY set — /api/generate will fail until you add one to .env");
  }
});

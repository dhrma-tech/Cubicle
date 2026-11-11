// Vercel function: forwards chat requests to an AI provider so keys never reach the browser.
// Providers are tried in order and the next one takes over when one is busy, rate limited or rejects the key.
// Set at least one key in Vercel (Settings, Environment Variables):
//   GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY (OPENAI_BASE_URL works for OpenRouter, Together, etc.)
// Optional: AI_PROVIDERS (order, default "gemini,groq,anthropic,openai"), GEMINI_MODEL, GROQ_MODEL, ANTHROPIC_MODEL, OPENAI_MODEL, AI_DAILY_LIMIT.
// The per-visitor limit is kept in memory, so it is best effort: it resets when the function restarts.
import { forGemini, fromAnthropic, fromOpenAI, toAnthropic, toOpenAI } from "./_providers.js";

const env = process.env;
const LIMIT = Number(env.AI_DAILY_LIMIT || 60);
const hits = new Map();
const BUDGET_MS = 54_000;

function allowed(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${day}|${ip}`;
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5000) for (const key of hits.keys()) if (!key.startsWith(day)) hits.delete(key);
  hits.set(k, n);
  return { ok: n <= LIMIT, left: Math.max(0, LIMIT - n) };
}

const post = (url, headers, body, ms) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
const readJson = async (r) => { const text = await r.text(); try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null }; } };

/* Each provider: (body, maxTokens, ms) -> { ok, status, json (Gemini shaped when ok), text } */
const PROVIDERS = {
  gemini: {
    key: () => env.GEMINI_API_KEY,
    async call(body, maxTokens, ms) {
      const key = env.GEMINI_API_KEY;
      const models = [...new Set([env.GEMINI_MODEL || "gemini-3.6-flash", "gemini-3.5-flash-lite"])];
      const hosts = [(m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`];
      if (key.startsWith("AQ.")) hosts.push((m) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`);   // Vertex express-mode keys
      const payload = {
        contents: forGemini(body.contents), systemInstruction: body.systemInstruction,
        tools: body.tools?.length ? body.tools : undefined, toolConfig: body.tools?.length ? { functionCallingConfig: { mode: "AUTO" } } : undefined,
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
      };
      const thin = { ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingLevel: "low" } } };
      const deadline = Date.now() + ms; let last = { ok: false, status: 0, text: "no attempt" };
      for (const model of models) for (const host of hosts) {
        const left = deadline - Date.now(); if (left < 1500) return last;
        try {
          let r = await post(host(model), { "x-goog-api-key": key }, thin, Math.min(left, 25_000));
          if (r.status === 400) r = await post(host(model), { "x-goog-api-key": key }, payload, Math.min(deadline - Date.now(), 25_000));   // model refused the thinking setting
          const { text, json } = await readJson(r);
          if (r.ok && json) return { ok: true, status: 200, json, text };
          last = { ok: false, status: r.status, text };
          if (r.status === 401 || r.status === 403) continue;   // maybe the other host knows this key
        } catch (e) { last = { ok: false, status: e?.name === "TimeoutError" ? 504 : 502, text: String(e?.message || e) }; }
      }
      return last;
    },
  },
  groq: {
    key: () => env.GROQ_API_KEY,
    call: (body, maxTokens, ms) => openaiLike("https://api.groq.com/openai/v1", env.GROQ_API_KEY, env.GROQ_MODEL || "llama-3.3-70b-versatile", body, maxTokens, ms),
  },
  openai: {
    key: () => env.OPENAI_API_KEY,
    call: (body, maxTokens, ms) => openaiLike((env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""), env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-4.1-mini", body, maxTokens, ms),
  },
  anthropic: {
    key: () => env.ANTHROPIC_API_KEY,
    async call(body, maxTokens, ms) {
      try {
        const r = await post("https://api.anthropic.com/v1/messages", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, toAnthropic(body, env.ANTHROPIC_MODEL || "claude-haiku-5-5", maxTokens), ms);
        const { text, json } = await readJson(r);
        return r.ok && json ? { ok: true, status: 200, json: fromAnthropic(json), text } : { ok: false, status: r.status, text };
      } catch (e) { return { ok: false, status: e?.name === "TimeoutError" ? 504 : 502, text: String(e?.message || e) }; }
    },
  },
};
async function openaiLike(base, key, model, body, maxTokens, ms) {
  try {
    const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${key}` }, toOpenAI(body, model, maxTokens), ms);
    const { text, json } = await readJson(r);
    return r.ok && json ? { ok: true, status: 200, json: fromOpenAI(json), text } : { ok: false, status: r.status, text };
  } catch (e) { return { ok: false, status: e?.name === "TimeoutError" ? 504 : 502, text: String(e?.message || e) }; }
}

// Gemini 3 needs a bit longer than the others, so it gets a larger share of the time budget.
const SHARE = { gemini: 28_000, groq: 14_000, anthropic: 20_000, openai: 20_000 };

// Gemini calls are slow enough that the Vercel default of 10 s would cut them off.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const order = String(env.AI_PROVIDERS || "gemini,groq,anthropic,openai").split(",").map((s) => s.trim().toLowerCase()).filter((id) => PROVIDERS[id] && PROVIDERS[id].key());
  if (!order.length) return res.status(503).json({ error: "not_configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (JSON.stringify(body).length > 250_000) return res.status(413).json({ error: "too_large" });
  if (!Array.isArray(body.contents) || !body.contents.length) return res.status(400).json({ error: "bad_request" });
  // only function declarations are allowed: no search grounding, code execution or other paid tools
  body.tools = Array.isArray(body.tools) ? body.tools.filter((t) => t && t.functionDeclarations).map((t) => ({ functionDeclarations: t.functionDeclarations })) : [];

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const lim = allowed(ip);
  res.setHeader("x-ai-left", String(lim.left));
  if (!lim.ok) return res.status(429).json({ error: "daily_limit" });

  const maxTokens = Math.min(Number(body.generationConfig?.maxOutputTokens) || 2048, 3000);
  const t0 = Date.now(); const failures = [];
  for (const id of order) {
    const left = BUDGET_MS - (Date.now() - t0);
    if (left < 2500) break;
    const r = await PROVIDERS[id].call(body, maxTokens, Math.min(left, SHARE[id] || 20_000));
    if (r.ok) {
      res.setHeader("x-ai-provider", id); res.setHeader("x-ai-ms", String(Date.now() - t0));
      return res.status(200).json(r.json);
    }
    failures.push({ id, status: r.status, detail: String(r.text).slice(0, 240) });
    console.error("ai provider failed", id, r.status, String(r.text).slice(0, 300));
  }
  const keyOnly = failures.length && failures.every((f) => f.status === 401 || f.status === 403);
  if (keyOnly) return res.status(502).json({ error: "server_key", detail: failures[0].detail });
  if (failures.every((f) => f.status === 429)) return res.status(429).json({ error: "quota" });
  return res.status(failures.some((f) => f.status === 504) && failures.length === 1 ? 504 : 502).json({ error: failures.some((f) => f.status === 504) && failures.length === 1 ? "timeout" : "busy", detail: failures.map((f) => `${f.id} ${f.status}`).join(", ") });
}

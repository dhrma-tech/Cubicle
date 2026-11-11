// Vercel function: forwards chat requests to Gemini so the key never reaches the browser.
// Set GEMINI_API_KEY in Vercel (Settings, Environment Variables). Optional: GEMINI_MODEL, AI_DAILY_LIMIT.
// The per-visitor limit is kept in memory, so it is best effort: it resets when the function restarts.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// AI Studio now issues keys that start with "AQ." as well. Those work on the Gemini API host. Vertex express-mode keys also start
// with "AQ.", so when the Gemini API refuses one, the same key is tried on the Vertex host.
const HOSTS = [
  (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  (m) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`,
];
const LIMIT = Number(process.env.AI_DAILY_LIMIT || 60);
const hits = new Map();

function allowed(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${day}|${ip}`;
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5000) for (const key of hits.keys()) if (!key.startsWith(day)) hits.delete(key);
  hits.set(k, n);
  return { ok: n <= LIMIT, left: Math.max(0, LIMIT - n) };
}

// Gemini with tools can take a while; the default 10 s limit would cut it off.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "not_configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (JSON.stringify(body).length > 250_000) return res.status(413).json({ error: "too_large" });
  if (!Array.isArray(body.contents) || !body.contents.length) return res.status(400).json({ error: "bad_request" });
  // only function declarations are allowed: no search grounding, code execution or other paid tools
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => t && t.functionDeclarations).map((t) => ({ functionDeclarations: t.functionDeclarations })) : [];

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const lim = allowed(ip);
  res.setHeader("x-ai-left", String(lim.left));
  if (!lim.ok) return res.status(429).json({ error: "daily_limit" });

  const payload = {
    contents: body.contents,
    systemInstruction: body.systemInstruction,
    tools: tools.length ? tools : undefined,
    toolConfig: tools.length ? { functionCallingConfig: { mode: "AUTO" } } : undefined,
    generationConfig: { temperature: 0.4, maxOutputTokens: Math.min(Number(body.generationConfig?.maxOutputTokens) || 2048, 3000) },
  };
  const call = (p, host, ms) => fetch(HOSTS[host](MODEL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(p),
    signal: AbortSignal.timeout(ms),
  });
  const t0 = Date.now();
  const thin = { ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingBudget: 0 } } };
  const attempt = async (host, ms) => {
    // thinking off keeps answers fast; if the model rejects that setting, retry with its defaults
    let r = await call(thin, host, ms);
    if (r.status === 400) r = await call(payload, host, ms);
    return r;
  };
  try {
    let r = await attempt(0, key.startsWith("AQ.") ? 35_000 : 50_000);
    if (key.startsWith("AQ.") && [400, 401, 403].includes(r.status)) {
      const first = await r.text();
      const r2 = await attempt(1, 20_000);
      if (r2.ok) r = r2; else { console.error("gemini rejected key", r.status, first.slice(0, 300), "| vertex", r2.status); return res.status(502).json({ error: "server_key", detail: first.slice(0, 300) }); }
    }
    const text = await r.text();
    res.setHeader("x-ai-ms", String(Date.now() - t0));
    if (r.status === 429) return res.status(429).json({ error: "quota" });
    if (r.status === 401 || r.status === 403) { console.error("gemini rejected key", r.status, text.slice(0, 400)); return res.status(502).json({ error: "server_key", detail: text.slice(0, 300) }); }
    res.status(r.status).setHeader("content-type", "application/json").send(text);
  } catch (e) {
    res.status(e?.name === "TimeoutError" ? 504 : 502).json({ error: e?.name === "TimeoutError" ? "timeout" : "upstream" });
  }
}

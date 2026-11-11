// Vercel function: forwards chat requests to Gemini so the key never reaches the browser.
// Set GEMINI_API_KEY in Vercel (Settings, Environment Variables). Optional: GEMINI_MODEL, AI_DAILY_LIMIT.
// The per-visitor limit is kept in memory, so it is best effort: it resets when the function restarts.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
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
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (r.status === 429) return res.status(429).json({ error: "quota" });
    res.status(r.status).setHeader("content-type", "application/json").send(text);
  } catch {
    res.status(502).json({ error: "upstream" });
  }
}

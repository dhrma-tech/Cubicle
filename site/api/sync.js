// Vercel function: optional cross-device sync. Stores an opaque, client-side encrypted blob in Supabase.
// The server never sees the passphrase or the plaintext; the row id is derived from the passphrase in the browser.
// Env: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the public key is enough: the table is locked by RLS and only the
// sync_get / sync_put functions can touch it, one row at a time by id). SUPABASE_SERVICE_KEY also works.
const MAX = 1_500_000;
const ID = /^[0-9a-f]{64}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return res.status(503).json({ error: "not_configured" });
  const h = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  const rpc = (fn, body) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  try {
    if (req.method === "GET") {
      if (req.query?.status) return res.status(200).json({ enabled: true });
      const id = String(req.query?.id || "");
      if (!ID.test(id)) return res.status(400).json({ error: "bad_id" });
      const r = await rpc("sync_get", { p_id: id });
      if (!r.ok) return res.status(502).json({ error: "store_failed", status: r.status });
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(rows[0]);
    }
    if (req.method === "PUT" || req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (!ID.test(String(b.id || "")) || typeof b.data !== "string") return res.status(400).json({ error: "bad_request" });
      if (b.data.length > MAX) return res.status(413).json({ error: "too_large" });
      const r = await rpc("sync_put", { p_id: b.id, p_data: b.data });
      if (!r.ok) return res.status(502).json({ error: "store_failed", status: r.status });
      return res.status(200).json({ ok: true, updated_at: await r.json() });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "store_failed" });
  }
}

// Vercel function: optional cross-device sync. Stores an opaque, client-side encrypted blob in Supabase.
// The server never sees the passphrase or the plaintext; the row id is derived from the passphrase in the browser.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Table: sync_blobs(id text primary key, data text, updated_at timestamptz default now()).
const MAX = 1_500_000;
const ID = /^[0-9a-f]{64}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return res.status(503).json({ error: "not_configured" });
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const table = `${url}/rest/v1/sync_blobs`;
  try {
    if (req.method === "GET") {
      const id = String(req.query?.id || "");
      if (req.query?.status) return res.status(200).json({ enabled: true });
      if (!ID.test(id)) return res.status(400).json({ error: "bad_id" });
      const r = await fetch(`${table}?id=eq.${id}&select=data,updated_at`, { headers: h, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return res.status(502).json({ error: "store_failed", status: r.status });
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(rows[0]);
    }
    if (req.method === "PUT" || req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (!ID.test(String(b.id || "")) || typeof b.data !== "string") return res.status(400).json({ error: "bad_request" });
      if (b.data.length > MAX) return res.status(413).json({ error: "too_large" });
      const r = await fetch(`${table}?on_conflict=id`, {
        method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: b.id, data: b.data, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return res.status(502).json({ error: "store_failed", status: r.status });
      return res.status(200).json({ ok: true, updated_at: new Date().toISOString() });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "store_failed" });
  }
}

// Vercel function: public metadata for one YouTube video, no API key needed.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  const id = String(req.query?.id || "");
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: "bad_id" });
  try {
    const o = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}&format=json`, { headers: { "user-agent": UA } });
    if (o.status === 401) return res.status(200).json({ error: "not_embeddable" });
    if (!o.ok) return res.status(200).json({ error: "not_found" });
    const j = await o.json();
    const out = { id, title: j.title, channel: j.author_name, handle: (String(j.author_url || "").match(/@([^/?#]+)/) || [])[1] || null };
    try { // length and date come from the watch page; fine to miss
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4500);
      const p = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "user-agent": UA, cookie: "CONSENT=YES+1; SOCS=CAI", "accept-language": "en-US,en;q=0.9" }, signal: ac.signal });
      const html = await p.text(); clearTimeout(t);
      const len = html.match(/"lengthSeconds":"(\d+)"/), pub = html.match(/"publishDate":"(\d{4}-\d{2}-\d{2})/) || html.match(/"uploadDate":"(\d{4}-\d{2}-\d{2})/);
      if (len) out.seconds = Number(len[1]);
      if (pub) out.published = pub[1];
    } catch { /* optional */ }
    res.status(200).json(out);
  } catch {
    res.status(200).json({ error: "upstream" });
  }
}

// Vercel function: live refresh for the Explore page. Pulls the fast-moving JSON sources (Hacker News, Hugging Face papers,
// Lobsters) straight from their public APIs. Lab blogs and GitHub repos still come from the scheduled data refresh.
import { createHash } from "node:crypto";

const UA = { "user-agent": "Mozilla/5.0 (compatible; CubicleNews/1.0; +https://github.com/dhrma-tech/Dev-Tube)" };
const AI = /\b(ai|a\.i\.|llms?|gpt-?\d*|chatgpt|claude|anthropic|openai|gemini|deepmind|mistral|llama|qwen|deepseek|grok|transformers?|diffusion models?|neural|machine learning|deep learning|nvidia|cuda|inference|fine-?tun\w*|hugging ?face|pytorch|tensorflow|mcp|agentic|ai agents?|language models?|open[- ]weights?|sora|midjourney|alphafold|robotics)\b/i;

const norm = (u) => (u || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
const clean = (s, n = 210) => {
  s = String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "").replace(/[,;:.\-\s]+$/, "") + "…";
};
const web = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
const mk = (src, name, g, title, url, ts, sc = 0, cm = 0, cu = null, d = "", a = null) => ({
  id: `${src}:${createHash("md5").update(norm(url)).digest("hex").slice(0, 10)}`, s: src, sn: name, g, t: clean(title, 160), u: web(url) || "#",
  ts: Math.floor(ts), sc: Math.floor(sc || 0), cm: Math.floor(cm || 0), cu: web(cu), d: clean(d), a,
});
const get = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

async function hn() {
  const now = Date.now() / 1000, since = Math.floor(now - 72 * 3600), seen = new Set(), out = [];
  const qs = ["AI", "LLM", "GPT", "Claude", "OpenAI", "Anthropic", "Gemini", "machine learning", "neural network", "Nvidia", "AI agents", "DeepSeek", "Llama"];
  const res = await Promise.all(qs.map((q) => get(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=40&query=${encodeURIComponent(q)}&numericFilters=${encodeURIComponent(`created_at_i>${since},points>25`)}`).then((j) => j.hits || []).catch(() => [])));
  for (const hits of res) for (const h of hits) {
    if (seen.has(h.objectID) || !AI.test(h.title || "")) continue;
    seen.add(h.objectID);
    const cu = `https://news.ycombinator.com/item?id=${h.objectID}`;
    out.push(mk("hn", "Hacker News", "hn", h.title, h.url || cu, h.created_at_i, h.points, h.num_comments, cu, "", h.author));
  }
  if (!out.length) throw new Error("no stories");
  return out;
}
async function papers() {
  const j = await get("https://huggingface.co/api/daily_papers?limit=40");
  const out = [];
  for (const x of j) {
    const p = x.paper || {}; const ts = Date.parse(p.publishedAt || x.publishedAt) / 1000;
    if (!ts || !p.id) continue;
    out.push(mk("hfpapers", "Hugging Face Papers", "research", p.title || x.title, `https://huggingface.co/papers/${p.id}`, ts, p.upvotes || x.upvotes, x.numComments, null, p.summary || x.summary || ""));
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, 14);
}
async function lobsters() {
  const now = Date.now() / 1000, seen = new Set(), out = [];
  for (const tag of ["ai", "ml"]) for (const x of await get(`https://lobste.rs/t/${tag}.json`)) {
    const ts = Date.parse(x.created_at) / 1000;
    if (seen.has(x.short_id) || now - ts > 4 * 86400) continue;
    seen.add(x.short_id);
    out.push(mk("lobsters", "Lobsters", "community", x.title, x.url || x.comments_url, ts, x.score, x.comment_count, x.comments_url, x.description_plain || "", x.submitter_user || ""));
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  const jobs = { hn, hfpapers: papers, lobsters };
  const items = [], sources = [];
  await Promise.all(Object.entries(jobs).map(async ([id, fn]) => {
    try { const r = await fn(); items.push(...r); sources.push({ id, count: r.length, ok: true, error: null }); }
    catch (e) { sources.push({ id, count: 0, ok: false, error: String(e.message || e).slice(0, 120) }); }
  }));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).json({ updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"), items: items.filter((i) => i.u !== "#"), sources });
}

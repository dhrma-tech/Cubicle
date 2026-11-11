import type { Data } from "./data";
import type { Video } from "./types";

/* "Go deeper" without AI: match a Short's caption words against the whole catalogue, weighted by how rare each word is. */
const STOP = new Set("the and for with this that from your you are how why what when into about just they them their have has not but can will more most than then out all any one two its use using make made does did get got new now here there don best top way ways thing things really very actually should would could been being over under only also like need needs want wants know every each some many much even still ever never real stop start day days time times year years week first last next free full part guide tips tip learn learning video videos short shorts watch ft vs".split(" "));
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const KEEP2 = new Set(["ai", "ml", "rl", "c#", "go"]);
export const tokens = (t: string) => {
  const out = new Set<string>();
  for (const raw of t.toLowerCase().replace(/#/g, " ").replace(/[^a-z0-9+.# ]/g, " ").split(/\s+/)) {
    const x = stem(raw.replace(/^\.+|\.+$/g, ""));
    if ((x.length > 2 || KEEP2.has(x)) && !STOP.has(x)) out.add(x);
  }
  return [...out];
};

let cached: { data: Data; inv: Map<string, number[]> } | null = null;
function index(d: Data) {
  if (cached?.data === d) return cached.inv;
  const inv = new Map<string, number[]>();
  d.videos.forEach((v, i) => {
    for (const t of tokens(`${v.t} ${d.nodes.get(v.n)?.title ?? ""}`)) (inv.get(t) ?? inv.set(t, []).get(t)!).push(i);
  });
  cached = { data: d, inv };
  return inv;
}

// when the caption says too little, fall back to the Short's track
const FALLBACK: Record<string, string[]> = {
  ai: ["ae-agents", "ae-prompting", "llm-overview", "ae-rag"],
  code: ["tooling", "py-advanced", "ts-js", "ae-codegen"],
  dsa: ["dsa-full", "dsa-practice", "cr-coding", "dsa-complexity"],
  math: ["math-for-ml", "linalg", "probability", "calculus"],
  sys: ["sd-fundamentals", "infra-containers", "sd-distributed", "infra-serving"],
  career: ["cr-roadmap", "cr-ai-interview", "cr-portfolio", "cr-coding"],
  focus: ["cr-roadmap", "pp-howto", "ae-roadmap"],
};

export interface Related { topics: { id: string; title: string; count: number }[]; videos: Video[] }

export function relatedTo(d: Data, s: { t: string; k: string }): Related {
  const inv = index(d), N = d.videos.length;
  const score = new Map<number, number>();
  for (const t of tokens(s.t)) {
    const ids = inv.get(t);
    if (!ids || ids.length > N * 0.08) continue;           // skip words that appear everywhere
    const idf = Math.log(N / ids.length);
    for (const i of ids) score.set(i, (score.get(i) || 0) + idf);
  }
  const ranked = [...score.entries()]
    .map(([i, sc]) => ({ v: d.videos[i], sc: sc + 0.3 * d.videos[i].sc - (d.videos[i].o ? 1.5 : 0) }))
    .filter((x) => x.sc >= 4 && (!x.v.d || x.v.d >= 420))
    .sort((a, b) => b.sc - a.sc);

  const votes = new Map<string, number>();
  for (const { v, sc } of ranked.slice(0, 15)) votes.set(v.n, (votes.get(v.n) || 0) + sc);
  const ids = [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 4);
  for (const id of FALLBACK[s.k] ?? FALLBACK.ai) if (ids.length < 4 && !ids.includes(id) && d.nodes.has(id)) ids.push(id);

  const perChannel = new Map<string, number>();
  const videos: Video[] = [];
  for (const { v } of ranked) {
    const n = perChannel.get(v.c) || 0;
    if (n >= 2) continue;
    perChannel.set(v.c, n + 1); videos.push(v);
    if (videos.length === 5) break;
  }
  return { topics: ids.map((id) => ({ id, title: d.nodes.get(id)!.title, count: d.nodes.get(id)!.count })), videos };
}

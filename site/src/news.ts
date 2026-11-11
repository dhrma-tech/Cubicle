import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface NewsItem {
  id: string; s: string; sn: string; g: "hn" | "labs" | "blogs" | "research" | "repos" | "community";
  t: string; u: string; ts: number; sc: number; cm: number; cu: string | null; d: string; a: string | null; hot: number; hn?: 1;
}
export interface NewsData { updated: string; items: NewsItem[]; sources: { id: string; count: number; ok: boolean; error: string | null }[] }

export const GROUPS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hn", label: "Hacker News" },
  { id: "labs", label: "Labs" },
  { id: "blogs", label: "Newsletters" },
  { id: "research", label: "Papers" },
  { id: "repos", label: "Open source" },
  { id: "community", label: "Community" },
];

/* ---------- reader state: saved, read, muted sources, last visit (this browser only) ---------- */
interface NS { saved: string[]; read: string[]; muted: string[]; seenAt: number }
const KEY = "devtube.news.v1";
const load = (): NS => {
  try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); if (j) return { saved: j.saved || [], read: j.read || [], muted: j.muted || [], seenAt: j.seenAt || 0 }; } catch { /* ignore */ }
  return { saved: [], read: [], muted: [], seenAt: 0 };
};
let state = load();
const prevVisit = state.seenAt; // "new since your last visit" compares against the previous visit
const subs = new Set<() => void>();
const commit = (n: NS) => { state = n; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ } subs.forEach((f) => f()); };

export const newsActions = {
  toggleSave: (id: string) => commit({ ...state, saved: state.saved.includes(id) ? state.saved.filter((x) => x !== id) : [id, ...state.saved] }),
  markRead: (id: string) => { if (!state.read.includes(id)) commit({ ...state, read: [id, ...state.read].slice(0, 600) }); },
  mute: (s: string) => commit({ ...state, muted: [...new Set([...state.muted, s])] }),
  unmuteAll: () => commit({ ...state, muted: [] }),
  touch: () => commit({ ...state, seenAt: Date.now() }),
};
export const useNewsState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
export const previousVisit = () => prevVisit;

/* ---------- data ---------- */
const norm = (u: string) => (u || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
const LIVE = new Set(["hn", "hfpapers", "lobsters"]);   // sources the /api/news function can fetch on demand
// same formula as the data pipeline (07_fetch_news.py); only the live groups are ever scored here
const BASE: Record<string, (i: NewsItem) => number> = { hn: (i) => i.sc + 1.5 * i.cm, community: (i) => i.sc * 6 + i.cm, research: (i) => 20 + i.sc * 4 };
const hot = (i: NewsItem) => {
  const age = Math.max(1, (Date.now() / 1000 - i.ts) / 3600);
  return Math.round(((BASE[i.g]?.(i) ?? 0) / (age + 2) ** 1.1) * 100) / 100;
};

/** Merge live items over the static snapshot: live sources are replaced, everything else is kept. */
/** Only http(s) links may reach an href. Anything else (javascript:, data:) is dropped. */
const web = (u: string | null | undefined) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const clean = (d: NewsData): NewsData => ({ ...d, items: (d.items || []).filter((i) => web(i.u)).map((i) => ({ ...i, cu: web(i.cu) })) });

function merge(cur: NewsData, live0: NewsData): NewsData {
  const live = clean(live0);
  const kept = cur.items.filter((i) => !LIVE.has(i.s));
  const urls = new Set(kept.map((i) => norm(i.u)));
  const fresh: NewsItem[] = [];
  for (const i of live.items) { const k = norm(i.u); if (urls.has(k)) continue; urls.add(k); fresh.push({ ...i, hot: hot(i) }); }
  const okIds = new Set(live.sources.filter((s) => s.ok).map((s) => s.id));
  // a live source that failed keeps its older items instead of vanishing
  const stale = cur.items.filter((i) => LIVE.has(i.s) && !okIds.has(i.s) && !urls.has(norm(i.u)));
  const items = [...kept, ...fresh, ...stale].sort((a, b) => b.hot - a.hot);
  const sources = [...cur.sources.filter((s) => !okIds.has(s.id)), ...live.sources.filter((s) => s.ok)];
  return { updated: live.updated, items, sources };
}

export interface RefreshResult { added: number; live: boolean }

export function useNewsData() {
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const cur = useRef<NewsData | null>(null);
  cur.current = data;
  useEffect(() => {
    let off = false;
    setError(null);
    fetch(`./data/news.json?t=${Math.floor(Date.now() / 300000)}-${tick}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<NewsData>; })
      .then((d) => { if (!off) setData(clean(d)); })
      .catch((e) => { if (!off) setError(String(e.message || e)); });
    return () => { off = true; };
  }, [tick]);

  /** Pull the newest snapshot, then overlay live Hacker News, papers and Lobsters on top of it. */
  const refresh = async (): Promise<RefreshResult> => {
    if (refreshing) return { added: 0, live: true };
    setRefreshing(true);
    try {
      const before = new Set((cur.current?.items ?? []).map((i) => i.id));
      let base = cur.current;
      try {
        const r = await fetch(`./data/news.json?t=${Date.now()}`, { cache: "no-store" });
        if (r.ok) base = clean((await r.json()) as NewsData);
      } catch { /* keep what is on screen */ }
      if (!base) throw new Error("no data");
      let live = false; let next = base;
      try {
        const r = await fetch("/api/news", { cache: "no-store" });
        const j = r.ok ? ((await r.json().catch(() => null)) as NewsData | null) : null;
        if (j && Array.isArray(j.items) && j.items.length) { next = merge(base, j); live = true; }
      } catch { /* function not available (local preview): the snapshot is all there is */ }
      setData(next); setError(null);
      return { added: next.items.filter((i) => !before.has(i.id)).length, live };
    } finally { setRefreshing(false); }
  };
  return { data, error, refreshing, refresh, reload: () => setTick((t) => t + 1) };
}

export function ago(ts: number, now = Date.now()) {
  const m = Math.max(1, Math.round((now - ts * 1000) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}
export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

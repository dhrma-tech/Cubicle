import { useEffect, useState, useSyncExternalStore } from "react";

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
export function useNewsData() {
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    setError(null);
    fetch(`./data/news.json?t=${Math.floor(Date.now() / 300000)}-${tick}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<NewsData>; })
      .then((d) => { if (!off) setData(d); })
      .catch((e) => { if (!off) setError(String(e.message || e)); });
    return () => { off = true; };
  }, [tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export function ago(ts: number, now = Date.now()) {
  const m = Math.max(1, Math.round((now - ts * 1000) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}
export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

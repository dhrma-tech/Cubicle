import { useEffect, useState, useSyncExternalStore } from "react";

export interface Short { i: string; t: string; c: string; h: string; k: string; v: number; p: string; sc: number }
export interface ShortsData { updated: string; tracks: { id: string; label: string }[]; items: Short[] }

/* ---------- Pro-Scroll state: goal, streak, saved, learned, hidden channels (this browser only) ---------- */
interface SS { seen: string[]; saved: string[]; learned: string[]; muted: string[]; days: Record<string, number>; met: string[]; goal: number; auto: boolean }
const KEY = "devtube.scroll.v1";
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DEF: SS = { seen: [], saved: [], learned: [], muted: [], days: {}, met: [], goal: 10, auto: true };
const load = (): SS => {
  try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); if (j) return { ...DEF, ...j }; } catch { /* ignore */ }
  return DEF;
};
let state = load();
const subs = new Set<() => void>();
const commit = (n: SS) => { state = n; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ } subs.forEach((f) => f()); };
const toggle = (a: string[], id: string) => (a.includes(id) ? a.filter((x) => x !== id) : [id, ...a]);

export const scrollActions = {
  /** Counts a Short as watched. Returns true when this one reaches today's goal. */
  see(id: string): boolean {
    if (state.seen.includes(id)) return false;
    const t = dayKey();
    const n = (state.days[t] || 0) + 1;
    const reached = n >= state.goal && !state.met.includes(t);
    const keep = Object.fromEntries(Object.entries(state.days).sort().slice(-60));
    commit({ ...state, seen: [id, ...state.seen].slice(0, 3000), days: { ...keep, [t]: n }, met: reached ? [...state.met, t].slice(-120) : state.met });
    return reached;
  },
  toggleSave: (id: string) => commit({ ...state, saved: toggle(state.saved, id) }),
  toggleLearned: (id: string) => commit({ ...state, learned: toggle(state.learned, id) }),
  hideChannel: (h: string) => commit({ ...state, muted: [...new Set([...state.muted, h])] }),
  showChannel: (h: string) => commit({ ...state, muted: state.muted.filter((x) => x !== h) }),
  showAllChannels: () => commit({ ...state, muted: [] }),
  setAuto: (auto: boolean) => commit({ ...state, auto }),
  setGoal(goal: number) {
    const t = dayKey(), n = state.days[t] || 0;
    const met = n >= goal ? [...new Set([...state.met, t])] : state.met.filter((d) => d !== t);
    commit({ ...state, goal, met });
  },
};
export const useScrollState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);

/** Days in a row (ending today, or yesterday if today is not done yet) on which the goal was met. */
export function streakOf(met: string[]) {
  const set = new Set(met);
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function useShortsData() {
  const [data, setData] = useState<ShortsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`./data/shorts.json?t=${Math.floor(Date.now() / 600000)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ShortsData>; })
      .then((d) => { if (!off) setData(d); })
      .catch((e) => { if (!off) setError(String(e.message || e)); });
    return () => { off = true; };
  }, []);
  return { data, error };
}

const STOP = new Set("the and for with this that from your you are how why what when into about just they them their have has not but can will more most than then out all any one two its it's use using make made does did get got new".split(" "));
/** A short search phrase for the long-form catalogue ("Go deeper"). */
export function deeperQuery(title: string) {
  const w = title.toLowerCase().replace(/#\S+/g, " ").replace(/[^a-z0-9+#. ]/g, " ").split(/\s+/).filter((x) => x.length > 2 && !STOP.has(x));
  return w.slice(0, 3).join(" ");
}

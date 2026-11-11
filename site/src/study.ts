import { useSyncExternalStore } from "react";
import { dayKey } from "./proscroll";

const KEY = "devtube.study.v1";
const DAY = 86400000;
export const REVIEW_DAYS = [3, 7, 30, 90];

export interface Note { id: string; t: number; text: string; ts: number }
export interface PlanItem { id: string }
export interface Plan { goal: string; items: PlanItem[]; created: number; perDay: number }
export interface Review { stage: number; due: number; kind: "v" | "s"; title?: string }
export interface Study {
  notes: Record<string, Note[]>;
  resume: Record<string, number>;
  speed: number;
  queue: string[];
  autoNext: boolean;
  focus: boolean;
  log: Record<string, Record<string, number>>; // day -> section -> seconds
  plan: Plan | null;
  budget: number; // minutes available today
  review: Record<string, Review>;
  follows: { channels: string[]; topics: string[]; seen: number };
}

const fresh = (): Study => ({
  notes: {}, resume: {}, speed: 1, queue: [], autoNext: true, focus: false, log: {}, plan: null, budget: 30, review: {},
  follows: { channels: [], topics: [], seen: Date.now() },
});

function load(): Study {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const j = JSON.parse(raw);
    const f = fresh();
    return { ...f, ...j, follows: { ...f.follows, ...(j.follows || {}) } };
  } catch { return fresh(); }
}

let state: Study = load();
const subs = new Set<() => void>();
function commit(next: Study) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  subs.forEach((f) => f());
}
export const useStudy = (): Study => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
export const getStudy = () => state;
const uid = () => Math.random().toString(36).slice(2, 9);

export const study = {
  /* notes */
  addNote: (vid: string, t: number, text: string) => {
    const n: Note = { id: uid(), t: Math.max(0, Math.floor(t)), text: text.trim(), ts: Date.now() };
    if (!n.text) return;
    commit({ ...state, notes: { ...state.notes, [vid]: [...(state.notes[vid] || []), n].sort((a, b) => a.t - b.t) } });
  },
  editNote: (vid: string, id: string, text: string) =>
    commit({ ...state, notes: { ...state.notes, [vid]: (state.notes[vid] || []).map((n) => (n.id === id ? { ...n, text } : n)) } }),
  delNote: (vid: string, id: string) => {
    const list = (state.notes[vid] || []).filter((n) => n.id !== id);
    const notes = { ...state.notes };
    if (list.length) notes[vid] = list; else delete notes[vid];
    commit({ ...state, notes });
  },
  /* resume + speed */
  setResume: (vid: string, sec: number, dur?: number) => {
    const resume = { ...state.resume };
    if (sec < 15 || (dur && sec > dur - 20)) delete resume[vid]; else resume[vid] = Math.floor(sec);
    state = { ...state, resume }; // quiet save: no re-render storm during playback
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  },
  setSpeed: (speed: number) => commit({ ...state, speed }),
  /* queue */
  enqueue: (id: string, top = false) => {
    if (state.queue.includes(id)) return;
    commit({ ...state, queue: top ? [id, ...state.queue] : [...state.queue, id] });
  },
  dequeue: (id: string) => commit({ ...state, queue: state.queue.filter((x) => x !== id) }),
  setQueue: (queue: string[]) => commit({ ...state, queue }),
  moveQueue: (id: string, dir: -1 | 1) => {
    const q = [...state.queue]; const i = q.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    commit({ ...state, queue: q });
  },
  setAutoNext: (autoNext: boolean) => commit({ ...state, autoNext }),
  setFocus: (focus: boolean) => commit({ ...state, focus }),
  /* study time */
  addTime: (section: string, sec: number) => {
    const d = dayKey();
    const day = { ...(state.log[d] || {}) };
    day[section || "other"] = (day[section || "other"] || 0) + sec;
    state = { ...state, log: { ...state.log, [d]: day } };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    subs.forEach((f) => f());
  },
  /* plan */
  setPlan: (plan: Plan | null) => commit({ ...state, plan }),
  setBudget: (budget: number) => commit({ ...state, budget }),
  /* spaced review */
  schedule: (id: string, kind: "v" | "s" = "v", title?: string) => {
    if (state.review[id]) return;
    commit({ ...state, review: { ...state.review, [id]: { stage: 0, due: Date.now() + REVIEW_DAYS[0] * DAY, kind, title } } });
  },
  unschedule: (id: string) => {
    if (!state.review[id]) return;
    const review = { ...state.review }; delete review[id];
    commit({ ...state, review });
  },
  grade: (id: string, remembered: boolean) => {
    const r = state.review[id]; if (!r) return;
    const review = { ...state.review };
    if (!remembered) review[id] = { ...r, stage: 0, due: Date.now() + DAY };
    else if (r.stage + 1 >= REVIEW_DAYS.length) delete review[id];
    else review[id] = { ...r, stage: r.stage + 1, due: Date.now() + REVIEW_DAYS[r.stage + 1] * DAY };
    commit({ ...state, review });
  },
  /* follows */
  toggleChannel: (c: string) => {
    const f = state.follows;
    commit({ ...state, follows: { ...f, channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c] } });
  },
  toggleTopic: (n: string) => {
    const f = state.follows;
    commit({ ...state, follows: { ...f, topics: f.topics.includes(n) ? f.topics.filter((x) => x !== n) : [...f.topics, n] } });
  },
  markSeen: () => commit({ ...state, follows: { ...state.follows, seen: Date.now() } }),
  /* backup */
  exportJSON: () => JSON.stringify(state),
  importJSON: (txt: string) => { const j = JSON.parse(txt); const f = fresh(); commit({ ...f, ...j, follows: { ...f.follows, ...(j.follows || {}) } }); },
  reset: () => commit(fresh()),
};

export const dueReviews = (s: Study, now = Date.now()) => Object.entries(s.review).filter(([, r]) => r.due <= now).map(([id, r]) => ({ id, ...r })).sort((a, b) => a.due - b.due);

/** Seconds studied per day for the last n days, oldest first. */
export function lastDays(s: Study, n: number) {
  const out: { day: string; sec: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * DAY));
    out.push({ day: k, sec: Object.values(s.log[k] || {}).reduce((a, b) => a + b, 0) });
  }
  return out;
}

export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
export const fmtHM = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

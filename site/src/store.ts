import { useSyncExternalStore } from "react";
import type { State } from "./types";
import { study } from "./study";

const KEY = "devtube:v1";
const fresh = (): State => ({
  liked: [], later: [], history: [], done: {}, hidden: [], mutedChannels: [], introDismissed: false,
  settings: { thumb: "mid", hideOutdated: false, theme: "auto", preview: true },
});

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const j = JSON.parse(raw);
    const f = fresh();
    return { ...f, ...j, settings: { ...f.settings, ...(j.settings || {}) } };
  } catch {
    return fresh();
  }
}

let state: State = load();
const subs = new Set<() => void>();

function commit(next: State) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: keep in memory */ }
  subs.forEach((f) => f());
}

export const useStore = (): State =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);

const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [id, ...arr]);

export const actions = {
  toggleLiked: (id: string) => commit({ ...state, liked: toggle(state.liked, id) }),
  toggleLater: (id: string) => commit({ ...state, later: toggle(state.later, id) }),
  toggleDone: (id: string) => {
    const done = { ...state.done };
    const was = !!done[id];
    if (was) delete done[id]; else done[id] = Date.now();
    commit({ ...state, done });
    if (was) study.unschedule(id); else study.schedule(id, "v");
  },
  visit: (id: string) => {
    const h = state.history.filter((x) => x.id !== id);
    commit({ ...state, history: [{ id, ts: Date.now() }, ...h].slice(0, 300) });
  },
  hide: (id: string) => commit({ ...state, hidden: [id, ...state.hidden.filter((x) => x !== id)] }),
  unhide: (id: string) => commit({ ...state, hidden: state.hidden.filter((x) => x !== id) }),
  muteChannel: (c: string) => commit({ ...state, mutedChannels: [c, ...state.mutedChannels.filter((x) => x !== c)] }),
  unmuteChannel: (c: string) => commit({ ...state, mutedChannels: state.mutedChannels.filter((x) => x !== c) }),
  restoreHidden: () => commit({ ...state, hidden: [], mutedChannels: [] }),
  dismissIntro: () => commit({ ...state, introDismissed: true }),
  clearHistory: () => commit({ ...state, history: [] }),
  setSettings: (p: Partial<State["settings"]>) => commit({ ...state, settings: { ...state.settings, ...p } }),
  exportJSON: () => JSON.stringify(state, null, 1),
  importJSON: (txt: string) => {
    const j = JSON.parse(txt);
    if (typeof j !== "object" || !j) throw new Error("Not a DEV Tube backup file");
    const f = fresh();
    commit({ ...f, ...j, settings: { ...f.settings, ...(j.settings || {}) } });
  },
  reset: () => commit(fresh()),
};

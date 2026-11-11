import { useSyncExternalStore } from "react";
import type { Video } from "./types";

/* Everything the AI page creates lives only in this browser: private videos, playlists and the optional Gemini key. */
export interface Playlist { id: string; title: string; desc: string; ids: string[]; notes: Record<string, string>; created: number }
interface US { mine: Video[]; playlists: Playlist[]; key: string }
const KEY = "devtube.ai.v1";
const load = (): US => {
  try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); if (j) return { mine: j.mine || [], playlists: j.playlists || [], key: j.key || "" }; } catch { /* ignore */ }
  return { mine: [], playlists: [], key: "" };
};
let state = load();
const subs = new Set<() => void>();
const mineSubs = new Set<() => void>();
const commit = (n: US) => {
  const mineChanged = n.mine !== state.mine;
  state = n;
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
  subs.forEach((f) => f());
  if (mineChanged) mineSubs.forEach((f) => f());
};

export const userMine = () => state.mine;
export const onMineChange = (f: () => void) => { mineSubs.add(f); return () => { mineSubs.delete(f); }; };
export const useUserData = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
export const geminiKey = () => state.key;

const uid = () => Math.random().toString(36).slice(2, 9);
export const userActions = {
  addVideo: (v: Video) => { if (!state.mine.some((x) => x.i === v.i)) commit({ ...state, mine: [v, ...state.mine] }); },
  removeVideo: (id: string) => commit({ ...state, mine: state.mine.filter((x) => x.i !== id), playlists: state.playlists.map((p) => ({ ...p, ids: p.ids.filter((x) => x !== id) })) }),
  savePlaylist: (p: Omit<Playlist, "id" | "created">) => { const id = uid(); commit({ ...state, playlists: [{ ...p, id, created: Date.now() }, ...state.playlists] }); return id; },
  deletePlaylist: (id: string) => commit({ ...state, playlists: state.playlists.filter((p) => p.id !== id) }),
  removeFromPlaylist: (pid: string, vid: string) => commit({ ...state, playlists: state.playlists.map((p) => (p.id === pid ? { ...p, ids: p.ids.filter((x) => x !== vid) } : p)) }),
  setKey: (key: string) => commit({ ...state, key: key.trim() }),
};

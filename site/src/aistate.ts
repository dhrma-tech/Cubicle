import { useSyncExternalStore } from "react";

/* Open/closed state of the Ask AI side panel, plus a prompt waiting to be sent when it opens. */
let open = false;
let prompt: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const openAI = (p?: string) => { open = true; if (p) prompt = p; emit(); };
export const closeAI = () => { if (open) { open = false; emit(); } };
export const toggleAI = () => { open = !open; emit(); };
export const takePrompt = () => { const p = prompt; prompt = null; return p; };
export const useAIOpen = () => useSyncExternalStore(subscribe, () => open);
export const usePendingPrompt = () => useSyncExternalStore(subscribe, () => prompt);

import { useEffect, useSyncExternalStore } from "react";
import { fmtClock } from "./study";
import { toast } from "./components";

/* Pomodoro: in-memory, survives navigation, not reloads. */
type Phase = "work" | "break";
interface P { phase: Phase; running: boolean; left: number; work: number; brk: number; cycles: number }
let p: P = { phase: "work", running: false, left: 25 * 60, work: 25, brk: 5, cycles: 0 };
let end = 0;
let iv = 0;
const subs = new Set<() => void>();
const set = (n: Partial<P>) => { p = { ...p, ...n }; subs.forEach((f) => f()); };
const tick = () => {
  const left = Math.max(0, Math.round((end - Date.now()) / 1000));
  if (left > 0) { set({ left }); return; }
  const wasWork = p.phase === "work";
  const phase: Phase = wasWork ? "break" : "work";
  set({ phase, left: (wasWork ? p.brk : p.work) * 60, cycles: p.cycles + (wasWork ? 1 : 0) });
  end = Date.now() + p.left * 1000;
  toast(wasWork ? `Focus block done. Take ${p.brk} minutes.` : "Break over. Back to it.");
  try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=").play().catch(() => {}); } catch { /* ignore */ }
};
export const pomo = {
  start: () => { end = Date.now() + p.left * 1000; clearInterval(iv); iv = window.setInterval(tick, 500); set({ running: true }); },
  pause: () => { clearInterval(iv); set({ running: false }); },
  reset: () => { clearInterval(iv); set({ running: false, phase: "work", left: p.work * 60 }); },
  skip: () => { end = Date.now(); tick(); },
};
const usePomo = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => p);

export function PomoChip() {
  const s = usePomo();
  useEffect(() => { document.title = s.running ? `${fmtClock(s.left)} ${s.phase === "work" ? "focus" : "break"} · Cubicle` : "Cubicle"; return () => { document.title = "Cubicle"; }; }, [s.running, s.left, s.phase]);
  return (
    <span className={"pomo" + (s.running ? " on" : "") + (s.phase === "break" ? " brk" : "")} role="group" aria-label="Focus timer">
      <button type="button" className="pomo-main" onClick={() => (s.running ? pomo.pause() : pomo.start())} aria-label={s.running ? "Pause timer" : "Start timer"} title="25 min focus, 5 min break">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M9 2h6" /></svg>
        <b>{fmtClock(s.left)}</b><span>{s.phase === "work" ? "Focus" : "Break"}</span>
      </button>
      {s.running || s.left !== s.work * 60 ? <button type="button" className="pomo-x" onClick={pomo.reset} aria-label="Reset timer">Reset</button> : null}
      {s.cycles ? <small title="Finished focus blocks this session">{s.cycles}x</small> : null}
    </span>
  );
}

import { RefObject, useCallback, useEffect, useRef, useState } from "react";

export interface PlayerOpts {
  speed: number;
  onEnd?: () => void;
  onTick?: (time: number, dur: number) => void;
  onRate?: (r: number) => void;
  onPlaying?: (playing: boolean) => void;
}

/** Controls a YouTube embed (enablejsapi=1) through postMessage. */
export function usePlayer(ref: RefObject<HTMLIFrameElement>, vid: string, o: PlayerOpts) {
  const opts = useRef(o); opts.current = o;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const live = useRef({ t: 0, d: 0, st: -1, rate: 1, set: false });

  const send = useCallback((func: string, args: unknown[] = []) => {
    ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }, [ref]);

  useEffect(() => {
    live.current = { t: 0, d: 0, st: -1, rate: 1, set: false };
    setTime(0); setPlaying(false);
    const f = ref.current; if (!f) return;
    let heard = false;
    const hello = () => f.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
    const iv = setInterval(() => { if (!heard) hello(); }, 400);
    f.addEventListener("load", hello);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || typeof e.data !== "string") return;
      let j: { event?: string; info?: Record<string, number> | number };
      try { j = JSON.parse(e.data); } catch { return; }
      heard = true;
      const L = live.current;
      const setState = (st: number) => {
        if (st === L.st) return; L.st = st;
        const p = st === 1; setPlaying(p); opts.current.onPlaying?.(p);
        if (p && !L.set) { L.set = true; if (opts.current.speed !== 1) send("setPlaybackRate", [opts.current.speed]); }
        if (st === 0) opts.current.onEnd?.();
      };
      if (j.event === "onStateChange" && typeof j.info === "number") setState(j.info);
      if (j.event === "infoDelivery" && j.info && typeof j.info === "object") {
        const i = j.info;
        if (typeof i.currentTime === "number") { L.t = i.currentTime; setTime(i.currentTime); }
        if (typeof i.duration === "number") L.d = i.duration;
        if (typeof i.playerState === "number") setState(i.playerState);
        if (typeof i.playbackRate === "number" && i.playbackRate !== L.rate) { L.rate = i.playbackRate; if (L.set) opts.current.onRate?.(i.playbackRate); }
        if (typeof i.currentTime === "number") opts.current.onTick?.(L.t, L.d);
      }
    };
    addEventListener("message", onMsg);
    return () => { clearInterval(iv); f.removeEventListener("load", hello); removeEventListener("message", onMsg); };
  }, [ref, vid, send]);

  const seek = useCallback((s: number) => { send("seekTo", [s, true]); send("playVideo"); }, [send]);
  const setRate = useCallback((r: number) => { live.current.rate = r; send("setPlaybackRate", [r]); }, [send]);
  const now = useCallback(() => live.current.t, []);
  return { time, playing, seek, setRate, now, duration: () => live.current.d, send };
}

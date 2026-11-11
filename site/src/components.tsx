import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Video } from "./types";
import { actions, useStore } from "./store";
import { fmtDur, LEVEL_NAME, type Data } from "./data";
import { study, useStudy } from "./study";

export const go = (hash: string) => { location.hash = hash; };

/* ---------- icons (stroke, 1.6) ---------- */
const I = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const IconHeart = ({ on }: { on?: boolean }) => <I fill={on} d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z" />;
export const IconClock = ({ on }: { on?: boolean }) => <I fill={on} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />;
export const IconCheck = ({ on }: { on?: boolean }) => <I fill={on} d="M4.5 12.5l5 5 10-11" />;

/* ---------- thumbnail: middle frame, not the uploader's A/B-tested one ---------- */
export function Thumb({ v, big }: { v: Video; big?: boolean }) {
  const { settings } = useStore();
  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => { if (img.current?.complete && img.current.naturalWidth) setLoaded(true); }, []);
  const file = settings.thumb === "mid" && !fallback ? "hq2.jpg" : "hqdefault.jpg";
  return (
    <span className={"thumb" + (big ? " thumb-big" : "") + (loaded ? " loaded" : "")}>
      <img ref={img} src={`https://i.ytimg.com/vi/${v.i}/${file}`} alt="" loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFallback(true)} />
      {v.d ? <span className="dur">{fmtDur(v.d)}</span> : null}
      <FreshBar v={v} />
    </span>
  );
}

/* ---------- freshness: bar drains with age, hatches when it may be outdated ---------- */
export function FreshBar({ v }: { v: Video }) {
  if (v.sh === "e") return <span className="fresh fresh-ever" title="Evergreen: this topic does not age quickly" />;
  return (
    <span className={"fresh" + (v.o ? " fresh-old" : "")} title={freshText(v)}>
      <i style={{ width: `${Math.max(6, Math.round(v.f * 100))}%` }} />
    </span>
  );
}

export function freshText(v: Video) {
  const how = v.ag === "p" ? "from its publish date" : v.ag === "t" ? "from the year in its title" : "estimated from when it was first recommended";
  const base = v.sh === "f" ? "Covers fast-moving tools or models." : v.sh === "s" ? "Covers tools that change over a few years." : "Evergreen.";
  return `${base} Freshness ${Math.round(v.f * 100)}%, ${how}.${v.o ? " Check that it still matches current tools." : ""}`;
}

/* ---------- vouch strip: how many independent people and lists recommend it ---------- */
export function Vouch({ v, wide }: { v: Video; wide?: boolean }) {
  const dots = Math.min(5, Math.max(v.hn || v.sr ? 1 : 0, Math.ceil(Math.log2(v.hn + v.sr * 3 + 1))));
  const label =
    (v.hn ? `${v.hn} Hacker News ${v.hn === 1 ? "user" : "users"}` : "") + (v.hn && v.sr ? " and " : "") +
    (v.sr ? `${v.sr} course ${v.sr === 1 ? "list" : "lists"}` : "");
  return (
    <span className={"vouch" + (wide ? " vouch-wide" : "")} title={`Recommended by ${label || "a trusted channel"}`}>
      <span className="dots" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((k) => <i key={k} className={k < dots ? "on" : ""} />)}
      </span>
      <span className="vouch-text">
        {v.hn ? <span>{v.hn} on Hacker News</span> : null}
        {v.sr ? <span>{v.sr} course {v.sr === 1 ? "list" : "lists"}</span> : null}
        {!v.hn && !v.sr ? <span>Trusted channel</span> : null}
      </span>
    </span>
  );
}

export function LevelTag({ v }: { v: Video }) {
  return <span className={`tag tag-${v.l}`}>{LEVEL_NAME[v.l]}</span>;
}

/* ---------- action buttons ---------- */
export function Actions({ id, compact }: { id: string; compact?: boolean }) {
  const s = useStore();
  const liked = s.liked.includes(id), later = s.later.includes(id), done = !!s.done[id];
  const btn = (on: boolean, label: string, fn: () => void, icon: ReactNode) => (
    <button type="button" className={"act" + (on ? " on" : "")} aria-pressed={on} aria-label={label} title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); fn(); }}>
      {icon}{compact ? null : <span>{label}</span>}
    </button>
  );
  return (
    <span className="acts">
      {btn(liked, liked ? "Liked" : "Like", () => toggleLike(id, liked), <IconHeart on={liked} />)}
      {btn(later, later ? "In watch later" : "Watch later", () => toggleLater(id, later), <IconClock on={later} />)}
      {btn(done, done ? "Done" : "Mark done", () => toggleDone(id, done), <IconCheck on={done} />)}
    </span>
  );
}

/* ---------- catalogue row ---------- */
export function VideoRow({ v, data, showNode = true }: { v: Video; data: Data; showNode?: boolean }) {
  const s = useStore();
  const node = data.nodes.get(v.n);
  const seen = s.history.some((h) => h.id === v.i);
  const done = !!s.done[v.i];
  return (
    <article className={"row" + (done ? " row-done" : "")} data-row data-id={v.i}>
      <a className="row-thumb" href={`#/watch/${v.i}`} tabIndex={-1} aria-hidden="true"><Thumb v={v} /></a>
      <div className="row-main">
        <h3 className="row-title"><a href={`#/watch/${v.i}`}>{v.t}</a></h3>
        <p className="row-meta">
          <span>{v.c}</span>
          <LevelTag v={v} />
          {v.u ? <span className="yours">Yours</span> : null}
          {showNode && node ? <a className="node-link" href={`#/n/${v.n}`}>{node.title}</a> : null}
          {v.o ? <span className="tag tag-old" title={freshText(v)}>May be outdated</span> : null}
          {seen && !done ? <span className="seen">Watched</span> : null}
          {done ? <span className="seen">Done</span> : null}
        </p>
        {v.w ? <p className="row-why">{v.w[1]}</p> : null}
      </div>
      <div className="row-side">
        <Vouch v={v} />
        <Actions id={v.i} compact />
      </div>
    </article>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h2>{title}</h2>{children ? <p>{children}</p> : null}</div>;
}

/* ======================= toasts (snackbar with undo) ======================= */
interface ToastMsg { id: number; msg: string; undo?: () => void }
let toastNow: ToastMsg | null = null;
let toastTimer = 0;
const toastSubs = new Set<() => void>();
const emit = () => toastSubs.forEach((f) => f());

export function toast(msg: string, undo?: () => void) {
  toastNow = { id: Date.now(), msg, undo };
  emit();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastNow = null; emit(); }, 5000);
}

export function Toaster() {
  const t = useSyncExternalStore((cb) => { toastSubs.add(cb); return () => { toastSubs.delete(cb); }; }, () => toastNow);
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {t ? (
        <div className="toast" key={t.id}>
          <span>{t.msg}</span>
          {t.undo ? <button type="button" onClick={() => { t.undo?.(); toastNow = null; emit(); }}>Undo</button> : null}
        </div>
      ) : null}
    </div>
  );
}

/* toggles that always confirm with a toast that can undo them */
export const toggleLike = (id: string, was: boolean) => { actions.toggleLiked(id); toast(was ? "Removed from Liked" : "Added to Liked", () => actions.toggleLiked(id)); };
export const toggleLater = (id: string, was: boolean) => { actions.toggleLater(id); toast(was ? "Removed from Watch later" : "Saved to Watch later", () => actions.toggleLater(id)); };
export const toggleDone = (id: string, was: boolean) => { actions.toggleDone(id); toast(was ? "Marked as not done" : "Marked as done", () => actions.toggleDone(id)); };

/* ======================= YouTube-style card ======================= */
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" style={{ background: `hsl(${hue(name)} 38% 32%)` }} aria-hidden="true">{(name.trim()[0] || "?").toUpperCase()}</span>;
}

const IconDots = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
);

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function YtCard({ v, data, home }: { v: Video; data: Data; home?: boolean }) {
  const s = useStore();
  const [prev, setPrev] = useState(false);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const timer = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const liked = s.liked.includes(v.i), later = s.later.includes(v.i), done = !!s.done[v.i];
  const seen = s.history.some((h) => h.id === v.i);
  const node = data.nodes.get(v.n);
  const sy = useStudy(); const inQ = sy.queue.includes(v.i); const fol = sy.follows.channels.includes(v.c);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); box.current?.querySelector<HTMLElement>(".kebab")?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = v.d ? Math.max(5, Math.floor(v.d * 0.3)) : 45;
  const preview = `https://www.youtube-nocookie.com/embed/${v.i}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&start=${start}`;
  const parts: string[] = [];
  if (v.hn) parts.push(`${v.hn} on Hacker News`);
  if (v.sr) parts.push(`${v.sr} course ${v.sr === 1 ? "list" : "lists"}`);
  if (!parts.length) parts.push("Trusted channel");
  parts.push(LEVEL_NAME[v.l]);

  const item = (label: string, fn: () => void) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(false); fn(); }}>{label}</button>
  );
  const copy = () => {
    const url = `https://youtu.be/${v.i}`;
    (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => toast("Link copied")).catch(() => toast("Could not copy the link. Open the video and copy the address."));
  };

  return (
    <article className={"yt" + (done ? " yt-done" : "")} data-row data-id={v.i}>
      <div className="yt-thumbwrap"
        onPointerEnter={(e) => { if (e.pointerType !== "mouse" || !s.settings.preview || reduced()) return; timer.current = window.setTimeout(() => setPrev(true), 700); }}
        onPointerLeave={() => { clearTimeout(timer.current); setPrev(false); setReady(false); }}>
        <a className="yt-thumb" href={`#/watch/${v.i}`} aria-label={v.t} tabIndex={-1}>
          <Thumb v={v} big />
          {prev ? <iframe className={"preview" + (ready ? " ready" : "")} src={preview} title="" tabIndex={-1} aria-hidden="true" allow="autoplay; encrypted-media" onLoad={() => setReady(true)} /> : null}
          {done ? <span className="badge-done">Done</span> : null}
        </a>
        <span className="qa">
          <button type="button" className={"qbtn" + (later ? " on" : "")} aria-label={later ? "Remove from Watch later" : "Save to Watch later"} title={later ? "Remove from Watch later" : "Watch later"} onClick={() => toggleLater(v.i, later)}><IconClock on={later} /></button>
          <button type="button" className={"qbtn" + (done ? " on" : "")} aria-label={done ? "Mark as not done" : "Mark as done"} title={done ? "Marked done" : "Mark done"} onClick={() => toggleDone(v.i, done)}><IconCheck on={done} /></button>
        </span>
      </div>
      <div className="yt-info">
        <a href={`#/browse?ch=${encodeURIComponent(v.c)}`} className="yt-avatar" tabIndex={-1} aria-hidden="true"><Avatar name={v.c} /></a>
        <div className="yt-text">
          <h3 className="yt-title"><a href={`#/watch/${v.i}`} title={v.t}>{v.t}</a></h3>
          <a className="yt-channel" href={`#/browse?ch=${encodeURIComponent(v.c)}`}>{v.c}</a>
          <p className="yt-meta"><span className="mini-dots" aria-hidden="true">{[0, 1, 2].map((k) => <i key={k} className={k < Math.min(3, Math.ceil(Math.log2(v.hn + v.sr * 3 + 1) / 1.7)) ? "on" : ""} />)}</span><span>{parts.join(" · ")}</span></p>
          {v.o || seen || node || v.u ? (
            <p className="yt-tags">
              {v.u ? <span className="yours">Yours</span> : null}
              {node ? <a className="node-link" href={`#/n/${v.n}`}>{node.title}</a> : null}
              {v.o ? <span className="tag tag-old" title={freshText(v)}>May be outdated</span> : null}
              {seen && !done ? <span className="seen">Watched</span> : null}
            </p>
          ) : null}
        </div>
        <div className="yt-menu" ref={box}>
          <button type="button" className="kebab" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><IconDots /></button>
          {menu ? (
            <div className="menu" role="menu" aria-label="Video actions">
              {item(later ? "Remove from Watch later" : "Save to Watch later", () => toggleLater(v.i, later))}
              {item(liked ? "Remove from Liked" : "Add to Liked", () => toggleLike(v.i, liked))}
              {item(done ? "Mark as not done" : "Mark as done", () => toggleDone(v.i, done))}
              {item(inQ ? "Remove from Up next" : "Add to Up next", () => { if (inQ) study.dequeue(v.i); else { study.enqueue(v.i); toast("Added to Up next", () => study.dequeue(v.i)); } })}
              {item(fol ? `Unfollow ${v.c}` : `Follow ${v.c}`, () => { study.toggleChannel(v.c); toast(fol ? `Unfollowed ${v.c}` : `Following ${v.c}`); })}
              {item("Copy link", copy)}
              <a role="menuitem" href={`https://www.youtube.com/watch?v=${v.i}`} target="_blank" rel="noreferrer noopener" onClick={() => setMenu(false)}>Open on YouTube</a>
              {home ? <hr /> : null}
              {home ? item("Not interested", () => { actions.hide(v.i); toast("Video hidden from your home feed", () => actions.unhide(v.i)); }) : null}
              {home ? item("Don't recommend this channel", () => { actions.muteChannel(v.c); toast(`Hiding ${v.c} from your home feed`, () => actions.unmuteChannel(v.c)); }) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

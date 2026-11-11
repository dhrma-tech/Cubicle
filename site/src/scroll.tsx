import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Thumb, toast } from "./components";
import { fmtDur, LEVEL_NAME, type Data } from "./data";
import { relatedTo, tokens } from "./related";
import { openAI } from "./aistate";
import { PillSelect } from "./views";
import { compact } from "./news";
import { dayKey, scrollActions, streakOf, useScrollState, useShortsData, type Short } from "./proscroll";

const P: Record<string, string> = {
  save: "M6 4h12v17l-6-4-6 4z",
  check: "M4 12.5l5 5L20 6.5",
  deeper: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6",
  sound: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6",
  hide: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8",
  play: "M8 5v14l11-7z",
  up: "M6 14l6-6 6 6",
  down: "M6 10l6 6 6-6",
};
const Ic = ({ n }: { n: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>
);

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clean = (t: string) => t.replace(/\s*#\S+/g, "").trim() || t;
function age(p: string) {
  const d = Math.max(0, Math.round((Date.now() - new Date(p).getTime()) / 864e5));
  if (d < 1) return "today";
  if (d < 31) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

function Ring({ n, goal, size = 84 }: { n: number; goal: number; size?: number }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r, f = Math.min(1, n / goal);
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.min(n, goal)} of ${goal} Shorts today`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="ring-t">{Math.min(n, goal)}/{goal}</text>
    </svg>
  );
}

interface SlideProps {
  s: Short; n: number; active: boolean; near: boolean; hidden: boolean; sound: boolean; auto: boolean; track: string;
  saved: boolean; learned: boolean;
  hold: boolean; onEnd: () => void; onSound: () => void; onSave: () => void; onLearn: () => void; onHide: () => void; onDeeper: () => void;
  reg: (n: number, el: HTMLElement | null) => void;
}

function Slide(p: SlideProps) {
  const { s, n, active } = p;
  const ref = useRef<HTMLIFrameElement>(null);
  const [paused, setPaused] = useState(false);
  const endRef = useRef(p.onEnd); endRef.current = p.onEnd;
  const autoRef = useRef(p.auto); autoRef.current = p.auto;
  const post = useCallback((func: string, args: unknown[] = []) => {
    ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }, []);

  useEffect(() => { if (!active) setPaused(false); }, [active]);
  useEffect(() => { if (active && p.hold) { post("pauseVideo"); setPaused(true); } }, [p.hold, active, post]);
  useEffect(() => { if (active) post(p.sound ? "unMute" : "mute"); }, [p.sound, active, post]);
  useEffect(() => {
    if (!active) return;
    const f = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      let d: { event?: string; info?: unknown } | null = null;
      try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      if (!d) return;
      const info = d.info as { playerState?: number } | number | undefined;
      const st = d.event === "onStateChange" ? (info as number) : d.event === "infoDelivery" && info && typeof info === "object" && typeof info.playerState === "number" ? info.playerState : undefined;
      if (st === undefined) return;
      setPaused(st === 2);
      if (st === 0) { if (autoRef.current) endRef.current(); else { post("seekTo", [0, true]); post("playVideo"); } }
    };
    addEventListener("message", f);
    return () => removeEventListener("message", f);
  }, [active, post]);

  const src = `https://www.youtube-nocookie.com/embed/${s.i}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  const toggle = () => { if (paused) { post("playVideo"); setPaused(false); } else { post("pauseVideo"); setPaused(true); } };

  return (
    <section className={"sc-slide" + (active ? " is-active" : "")} data-n={n} hidden={p.hidden} ref={(el) => p.reg(n, el)} aria-label={`${clean(s.t)}, by ${s.c}`}>
      <div className="sc-col">
      <div className="sc-stage">
        {p.near ? <img className="sc-poster" src={`https://i.ytimg.com/vi/${s.i}/hqdefault.jpg`} alt="" loading={active ? "eager" : "lazy"} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : null}
        {active ? (
          <iframe ref={ref} title={clean(s.t)} src={src} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => { ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: s.i, channel: "widget" }), "*"); if (p.sound) post("unMute"); }} />
        ) : null}
        {active ? <button className="sc-hit" onClick={toggle} aria-label={paused ? "Play" : "Pause"} /> : null}
        {active && paused ? <span className="sc-pause" aria-hidden="true"><Ic n="play" /></span> : null}
        {active && !p.sound ? <button className="sc-unmute" onClick={p.onSound}><Ic n="mute" />Tap for sound</button> : null}
      </div>
      </div>
      <div className="sc-acts">
        <button className={"sc-act" + (p.saved ? " on" : "")} onClick={p.onSave} aria-pressed={p.saved} title="Save (s)"><Ic n="save" /><span>{p.saved ? "Saved" : "Save"}</span></button>
        <button className={"sc-act" + (p.learned ? " on" : "")} onClick={p.onLearn} aria-pressed={p.learned} title="Got it (d)"><Ic n="check" /><span>Got it</span></button>
        <button className="sc-act" onClick={p.onDeeper} title="Related topics and full videos"><Ic n="deeper" /><span>Go deeper</span></button>
        <button className="sc-act" onClick={p.onSound} aria-pressed={p.sound} title="Sound (m)"><Ic n={p.sound ? "sound" : "mute"} /><span>{p.sound ? "Sound on" : "Muted"}</span></button>
        <button className="sc-act" onClick={p.onHide} title={`Hide ${s.c}`}><Ic n="hide" /><span>Hide</span></button>
      </div>
    </section>
  );
}

function Deeper({ s, data, deck, labels, onClose, onJump }: { s: Short; data: Data; deck: Short[]; labels: Record<string, string>; onClose: () => void; onJump: (n: number) => void }) {
  const rel = useMemo(() => relatedTo(data, s), [data, s]);
  const more = useMemo(() => {
    const q = new Set(tokens(s.t));
    return deck.map((x, n) => ({ x, n, sc: tokens(x.t).filter((t) => q.has(t)).length * 2 + (x.k === s.k ? 1 : 0) }))
      .filter((r) => r.x.i !== s.i && r.sc >= 2).sort((a, b) => b.sc - a.sc).slice(0, 4);
  }, [deck, s]);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return (
    <div className="sc-sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="sc-sheet" role="dialog" aria-modal="true" aria-label="Go deeper">
        <header>
          <div><h2>Go deeper</h2><p>{clean(s.t)}</p></div>
          <button ref={close} className="sc-fold" onClick={onClose} aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <section>
          <h3>Related topics</h3>
          <div className="sc-topics">{rel.topics.map((n) => <a key={n.id} className="sc-topic" href={`#/n/${n.id}`}><b>{n.title}</b><small>{n.count} videos</small></a>)}</div>
        </section>
        <section>
          <h3>Full videos on this</h3>
          {rel.videos.length ? (
            <ul className="sc-rel">{rel.videos.map((v) => (
              <li key={v.i}>
                <a href={`#/watch/${v.i}`} className="ai-pl-thumb" aria-label={v.t}><Thumb v={v} /></a>
                <div><a href={`#/watch/${v.i}`} className="ai-pl-t">{v.t}</a><p>{v.c}{v.d ? `, ${fmtDur(v.d)}` : ""}, {LEVEL_NAME[v.l]}</p></div>
              </li>
            ))}</ul>
          ) : <p className="sc-none">No close match for this one. Try a topic above.</p>}
        </section>
        {more.length ? (
          <section>
            <h3>More Shorts like this</h3>
            <ul className="sc-more">{more.map((r) => <li key={r.x.i}><button onClick={() => onJump(r.n)}><span>{clean(r.x.t)}</span><small>{r.x.c}, {labels[r.x.k] ?? r.x.k}</small></button></li>)}</ul>
          </section>
        ) : null}
        <button className="btn btn-primary sc-ask" onClick={() => { onClose(); openAI(`I just watched a Short called "${clean(s.t)}" by ${s.c}. Help me learn this properly. Ask me a few questions, then suggest videos from the catalogue.`); }}>Ask AI to explain this</button>
      </aside>
    </div>
  );
}

export function Scroll({ q, data }: { q: URLSearchParams; data: Data }) {
  const { data: shorts, error } = useShortsData();
  const ss = useScrollState();
  const ssRef = useRef(ss); ssRef.current = ss;
  const track = q.get("t") || "all";
  const savedOnly = q.get("saved") === "1";
  const seed = useRef(Math.floor(Math.random() * 1e9));
  const seenAtMount = useRef(new Set(ss.seen));
  const [act, setAct] = useState(0);
  const actRef = useRef(0); actRef.current = act;
  const [sound, setSound] = useState(false);
  const [done, setDone] = useState(false);
  const [deeper, setDeeper] = useState<Short | null>(null);
  const [fold, setFold] = useState(() => { try { return localStorage.getItem("devtube.scroll.fold") === "1"; } catch { return false; } });
  const toggleFold = () => setFold((f) => { const n = !f; try { localStorage.setItem("devtube.scroll.fold", n ? "1" : "0"); } catch { /* private mode */ } return n; });
  const feed = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLElement | null)[]>([]);
  const labels = useMemo(() => Object.fromEntries((shorts?.tracks ?? []).map((t) => [t.id, t.label])), [shorts]);

  // the session deck: ranked score with a little per-visit jitter, unseen first, never two in a row from one channel
  const deck = useMemo<Short[]>(() => {
    if (!shorts) return [];
    const rnd = (id: string) => { let h = 2166136261 ^ seed.current; for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619); return (h >>> 0) % 1000 / 1000; };
    let xs = shorts.items;
    if (savedOnly) xs = xs.filter((s) => ssRef.current.saved.includes(s.i));
    else if (track !== "all") xs = xs.filter((s) => s.k === track);
    xs = xs.map((s) => ({ s, r: s.sc * (0.85 + 0.3 * rnd(s.i)) })).sort((a, b) => b.r - a.r).map((x) => x.s);
    if (!savedOnly) { const seen = seenAtMount.current; xs = [...xs.filter((s) => !seen.has(s.i)), ...xs.filter((s) => seen.has(s.i))]; }
    const out: Short[] = [], pool = [...xs];
    while (pool.length) {
      const a = out[out.length - 1]?.h, b = out[out.length - 2]?.h;
      let k = pool.slice(0, 14).findIndex((s) => s.h !== a && s.h !== b);
      if (k < 0) k = 0;
      out.push(pool.splice(k, 1)[0]);
    }
    return out;
  }, [shorts, track, savedOnly]);

  useEffect(() => { setAct(0); feed.current?.scrollTo({ top: 0 }); }, [track, savedOnly]);

  // which slide is on screen
  useEffect(() => {
    const root = feed.current;
    if (!root || !deck.length) return;
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setAct(Number((e.target as HTMLElement).dataset.n)); }, { root, threshold: 0.6 });
    els.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [deck]);

  // a Short counts once you have stayed on it for 3 seconds
  useEffect(() => {
    const s = deck[act];
    if (!s) return;
    const t = setTimeout(() => { if (scrollActions.see(s.i)) setDone(true); }, 3000);
    return () => clearTimeout(t);
  }, [act, deck]);

  const goTo = useCallback((n: number, dir = 1) => {
    let k = n;
    while (k >= 0 && k < deck.length && ssRef.current.muted.includes(deck[k].h)) k += dir;
    k = Math.max(0, Math.min(deck.length, k));
    els.current[k]?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  }, [deck]);

  const save = (s: Short) => {
    const was = ssRef.current.saved.includes(s.i);
    scrollActions.toggleSave(s.i);
    toast(was ? "Removed from saved" : "Saved to Pro-Scroll", () => scrollActions.toggleSave(s.i));
  };
  const learn = (s: Short) => {
    const was = ssRef.current.learned.includes(s.i);
    scrollActions.toggleLearned(s.i);
    toast(was ? "Unmarked" : "Marked as learned", () => scrollActions.toggleLearned(s.i));
  };
  const hide = (s: Short, n: number) => {
    scrollActions.hideChannel(s.h);
    toast(`Hidden ${s.c} from Pro-Scroll`, () => scrollActions.showChannel(s.h));
    goTo(n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = deck[actRef.current];
      switch (e.key) {
        case "ArrowDown": case "j": e.preventDefault(); goTo(actRef.current + 1, 1); break;
        case "ArrowUp": case "k": e.preventDefault(); goTo(actRef.current - 1, -1); break;
        case "m": setSound((v) => !v); break;
        case "s": if (s) save(s); break;
        case "d": if (s) learn(s); break;
        case " ": if (!(t && (t.tagName === "BUTTON" || t.tagName === "A"))) { e.preventDefault(); feed.current?.querySelector<HTMLButtonElement>(".is-active .sc-hit")?.click(); } break;
        case "Escape": setDone(false); setDeeper(null); break;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [deck, goTo]);

  const today = ss.days[dayKey()] || 0;
  const streak = streakOf(ss.met);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const s of shorts?.items ?? []) { if (ss.muted.includes(s.h)) continue; c.all++; c[s.k] = (c[s.k] || 0) + 1; }
    return c;
  }, [shorts, ss.muted]);
  const trackLinks = (shorts?.tracks ?? []).filter((t) => counts[t.id]);

  if (error) return <div className="page"><div className="empty"><h2>Could not load Pro-Scroll</h2><p>{error}. Check your connection and reload the page.</p></div></div>;
  if (!shorts) return <div className="page"><p className="loading" role="status">Loading Shorts…</p></div>;

  const chev = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={fold ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} /></svg>;
  const side = fold ? (
    <aside className="sc-side is-fold" aria-label="Pro-Scroll controls">
      <button className="sc-fold" onClick={toggleFold} aria-label="Open the panel" aria-expanded="false" title="Open the panel">{chev}</button>
      <Ring n={today} goal={ss.goal} size={44} />
    </aside>
  ) : (
    <aside className="sc-side" aria-label="Pro-Scroll controls">
      <button className="sc-fold" onClick={toggleFold} aria-label="Fold the panel" aria-expanded="true" title="Fold the panel">{chev}</button>
      <div className="sc-goal">
        <Ring n={today} goal={ss.goal} />
        <div>
          <b>{today >= ss.goal ? "Goal reached" : `${ss.goal - today} to go`}</b>
          <span>{streak ? `${streak}-day streak` : "Start a streak today"}</span>
        </div>
      </div>
      <PillSelect label="Daily goal" value={String(ss.goal)} options={[["5", "5 a day"], ["10", "10 a day"], ["20", "20 a day"], ["30", "30 a day"]]} onChange={(v) => scrollActions.setGoal(+v)} />
      <nav className="sc-tracks" aria-label="Tracks">
        <a href="#/scroll" className={!savedOnly && track === "all" ? "on" : ""}>All<small>{counts.all}</small></a>
        {trackLinks.map((t) => <a key={t.id} href={`#/scroll?t=${t.id}`} className={!savedOnly && track === t.id ? "on" : ""}>{t.label}<small>{counts[t.id]}</small></a>)}
        <a href="#/scroll?saved=1" className={savedOnly ? "on" : ""}>Saved<small>{ss.saved.length}</small></a>
      </nav>
      <label className="sc-auto"><input type="checkbox" checked={ss.auto} onChange={(e) => scrollActions.setAuto(e.target.checked)} />Play the next one when a Short ends</label>
      {ss.muted.length ? <button className="sc-link" onClick={() => scrollActions.showAllChannels()}>Show {ss.muted.length} hidden channel{ss.muted.length > 1 ? "s" : ""}</button> : null}
      <p className="sc-keys"><kbd>j</kbd> <kbd>k</kbd> next, previous<br /><kbd>s</kbd> save <kbd>d</kbd> got it<br /><kbd>m</kbd> sound <kbd>space</kbd> pause</p>
      <p className="sc-note">Only YouTube Shorts. Instagram and X have no open feed or embeds that work without logging in.</p>
    </aside>
  );

  return (
    <div className={"sc" + (fold ? " fold" : "")}>
      {side}
      <div className="sc-main">
        <div className="sc-top" aria-label="Tracks">
          <span className="sc-mini"><b>{Math.min(today, ss.goal)}</b>/{ss.goal}</span>
          <a href="#/scroll" className={"chip" + (!savedOnly && track === "all" ? " on" : "")}>All</a>
          {trackLinks.map((t) => <a key={t.id} href={`#/scroll?t=${t.id}`} className={"chip" + (!savedOnly && track === t.id ? " on" : "")}>{t.label}</a>)}
          <a href="#/scroll?saved=1" className={"chip" + (savedOnly ? " on" : "")}>Saved</a>
        </div>
        {deck.length === 0 ? (
          <div className="sc-empty"><h2>{savedOnly ? "Nothing saved yet" : "No Shorts here"}</h2><p>{savedOnly ? "Press S or tap Save on any Short and it will show up here." : "Pick another track."}</p><a className="btn" href="#/scroll">Back to all Shorts</a></div>
        ) : (
          <div className="sc-feed" ref={feed}>
            {deck.map((s, n) => (
              <Slide key={s.i} s={s} n={n} active={n === act} near={Math.abs(n - act) <= 3} hidden={ss.muted.includes(s.h)} sound={sound} auto={ss.auto}
                track={labels[s.k] ?? s.k} saved={ss.saved.includes(s.i)} learned={ss.learned.includes(s.i)}
                onEnd={() => goTo(actRef.current + 1, 1)} onSound={() => setSound((v) => !v)} onSave={() => save(s)} onLearn={() => learn(s)} onHide={() => hide(s, n)} onDeeper={() => setDeeper(s)} hold={deeper?.i === s.i}
                reg={(i, el) => { els.current[i] = el; }} />
            ))}
            <section className="sc-slide sc-end" data-n={deck.length} ref={(el) => { els.current[deck.length] = el; }}>
              <div>
                <h2>That was the whole deck</h2>
                <p>New Shorts are added whenever the data refreshes. For depth, switch to a full lecture.</p>
                <div className="sc-row"><a className="btn btn-primary" href="#/browse?dur=long">Watch a full lecture</a><a className="btn" href="#/learn">Open the syllabus</a></div>
              </div>
            </section>
            <div className="sc-nav" aria-label="Move between Shorts">
              <button onClick={() => goTo(act - 1, -1)} aria-label="Previous Short" disabled={act <= 0}><Ic n="up" /></button>
              <span aria-live="off"><b>{Math.min(act + 1, deck.length)}</b><i>{deck.length}</i></span>
              <button onClick={() => goTo(act + 1, 1)} aria-label="Next Short" disabled={act >= deck.length}><Ic n="down" /></button>
            </div>
          </div>
        )}
      </div>
      {deeper ? <Deeper s={deeper} data={data} deck={deck} labels={labels} onClose={() => setDeeper(null)} onJump={(n) => { setDeeper(null); goTo(n); }} /> : null}
      {done ? (
        <div className="sc-done" role="dialog" aria-modal="true" aria-label="Daily goal reached" onClick={(e) => { if (e.target === e.currentTarget) setDone(false); }}>
          <div className="sc-done-card">
            <Ring n={ss.goal} goal={ss.goal} size={112} />
            <h2>{ss.goal} Shorts done for today</h2>
            <p>{streak > 1 ? `${streak}-day streak. ` : ""}Short clips make you aware of ideas. A full lecture on one of them makes you learn it.</p>
            <div className="sc-row">
              <a className="btn btn-primary" href="#/browse?dur=long">Watch a full lecture</a>
              <a className="btn" href="#/learn">Open the syllabus</a>
              <button className="btn" onClick={() => setDone(false)} autoFocus>Keep scrolling</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

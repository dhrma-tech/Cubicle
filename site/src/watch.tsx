import { useEffect, useMemo, useRef, useState } from "react";
import { actions } from "./store";
import { fmtDur, LEVEL_NAME, type Data } from "./data";
import { Actions, freshText, go, LevelTag, Thumb, toast, Vouch } from "./components";
import { NotFound } from "./views";
import { usePlayer } from "./player";
import { fmtClock, getStudy, study, useStudy } from "./study";
import { PomoChip } from "./focus";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function notesMarkdown(id: string, title: string, notes: { t: number; text: string }[]) {
  const url = `https://youtu.be/${id}`;
  return `# Notes: ${title}\n${url}\n\n` + notes.map((n) => `- [${fmtClock(n.t)}](${url}?t=${n.t}) ${n.text}`).join("\n") + "\n";
}

export function Watch({ id, data }: { id: string; data: Data }) {
  const v = data.byId.get(id);
  const s = useStudy();
  const visited = useRef<string | null>(null);
  if (v && visited.current !== id) { visited.current = id; queueMicrotask(() => actions.visit(id)); }
  const frame = useRef<HTMLIFrameElement>(null);
  const startAt = useMemo(() => Math.floor(getStudy().resume[id] || 0), [id]);
  const lastSave = useRef(0);
  const [upnext, setUpnext] = useState<{ id: string; left: number } | null>(null);
  const [stamp, setStamp] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const noteIn = useRef<HTMLInputElement>(null);

  const p = usePlayer(frame, id, {
    speed: s.speed,
    onRate: (r) => study.setSpeed(r),
    onTick: (t, d) => { if (Math.abs(t - lastSave.current) >= 5) { lastSave.current = t; study.setResume(id, t, d); } },
    onEnd: () => {
      study.setResume(id, 0);
      const cur = getStudy();
      if (!isDoneNow(id)) { actions.toggleDone(id); toast("Marked as done. First review in 3 days."); }
      const i = cur.queue.indexOf(id);
      const next = i >= 0 ? cur.queue[i + 1] : cur.queue[0];
      if (i >= 0) study.dequeue(id);
      if (cur.autoNext && next) setUpnext({ id: next, left: 5 });
    },
  });

  useEffect(() => { setUpnext(null); setStamp(null); setDraft(""); }, [id]);
  useEffect(() => {
    if (!upnext) return;
    if (upnext.left <= 0) { go(`/watch/${upnext.id}`); return; }
    const t = setTimeout(() => setUpnext((u) => (u ? { ...u, left: u.left - 1 } : u)), 1000);
    return () => clearTimeout(t);
  }, [upnext]);

  // study time: count real playback in 5 second steps
  useEffect(() => {
    if (!p.playing || !v) return;
    const sec = v.s;
    const iv = setInterval(() => study.addTime(sec, 5), 5000);
    return () => clearInterval(iv);
  }, [p.playing, v]);

  // n stamps the current time and jumps to the note box
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key !== "n") return;
      e.preventDefault(); setStamp(Math.floor(p.now())); noteIn.current?.focus();
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [p]);

  if (!v) return <NotFound />;
  const node = data.nodes.get(v.n);
  const sec = data.sections.find((x) => x.id === v.s);
  const siblings = data.byNode.get(v.n) || [];
  const idx = siblings.findIndex((x) => x.i === v.i);
  const more = [...siblings.slice(idx + 1), ...siblings.slice(0, idx)].filter((x) => !s.queue.includes(x.i)).slice(0, 6);
  const notes = s.notes[id] || [];
  const queued = s.queue.includes(id);
  const queueVids = s.queue.map((q) => data.byId.get(q)).filter((x): x is NonNullable<typeof x> => !!x);
  const qTotal = queueVids.reduce((a, x) => a + (x.d || 0), 0);
  const nextVid = upnext ? data.byId.get(upnext.id) : null;

  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    study.addNote(id, stamp ?? p.now(), draft);
    setDraft(""); setStamp(null);
  };
  const exportMd = (download: boolean) => {
    const md = notesMarkdown(id, v.t, notes);
    if (download) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = `notes-${id}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else navigator.clipboard?.writeText(md).then(() => toast("Notes copied as Markdown"), () => toast("Could not copy. Use Download."));
  };

  return (
    <div className={"watch" + (s.focus ? " is-focus" : "")}>
      <div className="watch-main">
        <div className="player">
          <iframe ref={frame} key={id} title={v.t}
            src={`https://www.youtube-nocookie.com/embed/${v.i}?rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${startAt ? `&start=${startAt}` : ""}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
        {upnext && nextVid ? (
          <div className="upnext" role="status">
            <span>Up next in {upnext.left}s: <b>{nextVid.t}</b></span>
            <button type="button" className="btn" onClick={() => go(`/watch/${nextVid.i}`)}>Play now</button>
            <button type="button" className="btn" onClick={() => setUpnext(null)}>Cancel</button>
          </div>
        ) : null}
        <h1 className="watch-title">{v.t}</h1>
        <p className="row-meta">
          <span>{v.c}</span><LevelTag v={v} />
          {node ? <a className="node-link" href={`#/n/${v.n}`}>{node.title}</a> : null}
          {v.p ? <span>{v.p}</span> : null}{v.d ? <span>{fmtDur(v.d)}</span> : null}
          {startAt ? <span className="resumed">Resumed at {fmtClock(startAt)}</span> : null}
        </p>
        <Actions id={v.i} />
        <div className="wtools" role="toolbar" aria-label="Study tools">
          <span className="speeds" role="group" aria-label="Playback speed">
            {SPEEDS.map((r) => <button key={r} type="button" className={s.speed === r ? "on" : ""} aria-pressed={s.speed === r} onClick={() => { study.setSpeed(r); p.setRate(r); }}>{r}x</button>)}
          </span>
          <button type="button" className={"btn" + (queued ? " on" : "")} onClick={() => { if (queued) study.dequeue(id); else { study.enqueue(id); toast("Added to Up next", () => study.dequeue(id)); } }}>{queued ? "In Up next" : "Add to Up next"}</button>
          <button type="button" className={"btn" + (s.focus ? " on" : "")} aria-pressed={s.focus} onClick={() => study.setFocus(!s.focus)}>{s.focus ? "Exit focus mode" : "Focus mode"}</button>
          <button type="button" className={"btn" + (s.follows.channels.includes(v.c) ? " on" : "")} onClick={() => study.toggleChannel(v.c)}>{s.follows.channels.includes(v.c) ? "Following" : "Follow channel"}</button>
          <PomoChip />
          <a className="textlink" href={`https://www.youtube.com/watch?v=${v.i}`} target="_blank" rel="noreferrer noopener">Open on YouTube</a>
        </div>

        <section className="notes" aria-labelledby="notes-h">
          <header>
            <h2 id="notes-h">Notes {notes.length ? <small>{notes.length}</small> : null}</h2>
            {notes.length ? <span className="notes-x"><button type="button" onClick={() => exportMd(false)}>Copy Markdown</button><button type="button" onClick={() => exportMd(true)}>Download .md</button></span> : null}
          </header>
          <form onSubmit={addNote} className="note-form">
            <button type="button" className="stamp" onClick={() => setStamp(Math.floor(p.now()))} title="Stamp the current time (press n)">{fmtClock(stamp ?? p.time)}</button>
            <input ref={noteIn} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note at this moment. Press n to stamp the time." aria-label="Note text" />
            <button type="submit" className="btn" disabled={!draft.trim()}>Add</button>
          </form>
          {notes.length ? (
            <ul className="note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <button type="button" className="note-t" onClick={() => p.seek(n.t)} aria-label={`Jump to ${fmtClock(n.t)}`}>{fmtClock(n.t)}</button>
                  <span className="note-x" contentEditable suppressContentEditableWarning onBlur={(e) => { const t = e.currentTarget.textContent?.trim() || ""; if (t && t !== n.text) study.editNote(id, n.id, t); else if (!t) study.delNote(id, n.id); }}>{n.text}</span>
                  <button type="button" className="note-d" onClick={() => study.delNote(id, n.id)} aria-label="Delete note">Delete</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Notes stay in this browser. Click a time to jump back to it.</p>}
        </section>

        <section className="why" aria-labelledby="why-h">
          <h2 id="why-h">Why it is here</h2>
          <Vouch v={v} wide />
          <ul className="why-list">
            {v.hn ? <li>{v.hn} {v.hn === 1 ? "person" : "people"} on Hacker News linked it{v.rc ? `, ${v.rc} of them while recommending it` : ""}{v.y[0] ? `, between ${v.y[0]} and ${v.y[1]}` : ""}.</li> : null}
            {v.sr ? <li>It appears in {v.sr} course {v.sr === 1 ? "list" : "lists"}: {v.src.join(", ")}.</li> : null}
            {!v.hn && !v.sr ? <li>It comes from a channel on the trusted list.</li> : null}
            <li className={v.o ? "warn" : ""}>{freshText(v)}</li>
          </ul>
          {v.w ? (
            <blockquote className="hn-quote">
              {v.w[1]}
              <footer><a href={`https://news.ycombinator.com/item?id=${v.w[0]}`} target="_blank" rel="noreferrer noopener">Hacker News comment</a></footer>
            </blockquote>
          ) : null}
        </section>
      </div>
      <aside className="watch-side" aria-label="Next videos">
        {queueVids.length ? (
          <>
            <h2>Up next <small className="q-meta">{queueVids.length} {queueVids.length === 1 ? "video" : "videos"}{qTotal ? `, ${fmtDur(qTotal)}` : ""}</small></h2>
            <p className="crumb"><a href="#/queue">Manage queue</a></p>
            <ol className="next">
              {queueVids.slice(0, 8).map((x) => (
                <li key={x.i} className={x.i === id ? "cur" : ""}>
                  <a href={`#/watch/${x.i}`}><Thumb v={x} /><span className="next-t">{x.t}<small>{x.c} · {LEVEL_NAME[x.l]}</small></span></a>
                  <button type="button" className="q-x" onClick={() => study.dequeue(x.i)} aria-label={`Remove ${x.t} from Up next`}>x</button>
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <h2>{node ? `More in ${node.title}` : "Related"}</h2>
        {sec ? <p className="crumb"><a href={`#/s/${sec.id}`}>{sec.title}</a></p> : null}
        <ol className="next">
          {more.map((x) => (
            <li key={x.i}>
              <a href={`#/watch/${x.i}`}><Thumb v={x} /><span className="next-t">{x.t}<small>{x.c} · {LEVEL_NAME[x.l]}</small></span></a>
              <button type="button" className="q-x add" onClick={() => { study.enqueue(x.i); toast("Added to Up next", () => study.dequeue(x.i)); }} aria-label={`Add ${x.t} to Up next`}>+</button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

// the Done state read outside of render (used by the end-of-video handler)
function isDoneNow(id: string) {
  try { return !!JSON.parse(localStorage.getItem("devtube:v1") || "{}").done?.[id]; } catch { return false; }
}

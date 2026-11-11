import { useEffect, useMemo, useRef, useState } from "react";
import { openAI } from "./aistate";
import { fmtDur, type Data } from "./data";
import { actions, useStore } from "./store";
import { Thumb, toast } from "./components";
import { addProposed, type Answer, type Chat, type Item, type Question } from "./ai";
import { geminiKey, userActions, useUserData } from "./userdata";
import { LEVEL_NAME } from "./data";

export const Spark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>
);
const hours = (secs: number) => (secs >= 3600 ? `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min` : `${Math.max(1, Math.round(secs / 60))} min`);
const total = (ids: string[], data: Data) => ids.reduce((n, id) => n + (data.byId.get(id)?.d ?? 0), 0);

/* ---------- cards ---------- */
export function AskCard({ item, chat }: { item: Extract<Item, { kind: "ask" }>; chat: Chat }) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const done = !!item.answered;
  const pick = (qi: number, q: Question, o: string) => setSel((s) => {
    const cur = s[qi] ?? [];
    return { ...s, [qi]: q.multi ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : cur.includes(o) ? [] : [o] };
  });
  const answers = (): Answer[] => item.questions.map((q, qi) => ({ question: q.question, answer: [...(sel[qi] ?? []), other[qi]?.trim()].filter(Boolean).join(", ") || "No preference" }));
  const any = item.questions.some((_, qi) => (sel[qi]?.length ?? 0) > 0 || other[qi]?.trim());
  if (done) {
    return (
      <div className="ai-card ai-ask is-done" aria-label="Your answers">
        {item.answered!.map((a, k) => <p key={k}><span>{a.question}</span><b>{a.answer}</b></p>)}
      </div>
    );
  }
  return (
    <form className="ai-card ai-ask" onSubmit={(e) => { e.preventDefault(); if (any) void chat.answer(answers()); }}>
      {item.questions.map((q, qi) => (
        <fieldset key={qi} disabled={chat.busy}>
          <legend>{q.question}{q.multi ? <small> Pick any</small> : null}</legend>
          <div className="ai-opts">
            {q.options.map((o) => <button type="button" key={o} className={"ai-opt" + (sel[qi]?.includes(o) ? " on" : "")} aria-pressed={!!sel[qi]?.includes(o)} onClick={() => pick(qi, q, o)}>{o}</button>)}
          </div>
          <input className="ai-other" type="text" placeholder="Or write your own" value={other[qi] ?? ""} onChange={(e) => setOther((s) => ({ ...s, [qi]: e.target.value }))} />
        </fieldset>
      ))}
      <button type="submit" className="btn btn-primary" disabled={!any || chat.busy}>Continue</button>
    </form>
  );
}

export function PlaylistCard({ item, data, chat }: { item: Extract<Item, { kind: "playlist" }>; data: Data; chat: Chat }) {
  const secs = total(item.ids, data);
  const save = () => {
    const id = userActions.savePlaylist({ title: item.title, desc: item.desc, ids: item.ids, notes: item.notes });
    item.saved = id; chat.touch();
    toast("Playlist saved");
  };
  return (
    <div className="ai-card ai-pl">
      <header>
        <h3>{item.title}</h3>
        {item.desc ? <p>{item.desc}</p> : null}
        <small>{item.ids.length} videos{secs ? `, ${hours(secs)}` : ""}</small>
      </header>
      <ol>
        {item.ids.map((id) => {
          const v = data.byId.get(id); if (!v) return null;
          return (
            <li key={id}>
              <a href={`#/watch/${id}`} className="ai-pl-thumb" aria-label={v.t}><Thumb v={v} /></a>
              <div>
                <a href={`#/watch/${id}`} className="ai-pl-t">{v.t}</a>
                <p>{v.c}{v.d ? `, ${fmtDur(v.d)}` : ""}, {LEVEL_NAME[v.l]}</p>
                {item.notes[id] ? <p className="ai-pl-n">{item.notes[id]}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <footer>
        {item.saved ? <><span className="ai-saved">Saved</span><a className="btn" href={`#/playlist/${item.saved}`}>Open playlist</a></> : <button className="btn btn-primary" onClick={save}>Save playlist</button>}
      </footer>
    </div>
  );
}

export function VideoCard({ item, data, chat }: { item: Extract<Item, { kind: "video" }>; data: Data; chat: Chat }) {
  const node = data.nodes.get(item.node);
  return (
    <div className="ai-card ai-vid">
      <img src={`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`} alt="" />
      <div>
        <h3>{item.title}</h3>
        <p>{item.channel}{item.seconds ? `, ${fmtDur(item.seconds)}` : ""}</p>
        <p className="ai-chips"><span>{node?.title ?? item.node}</span><span>{LEVEL_NAME[item.level]}</span></p>
        {item.note ? <p className="ai-pl-n">{item.note}</p> : null}
        {item.state === "added" ? (
          <div className="ai-row"><span className="ai-saved">Added to your DEV Tube</span><a className="btn" href={`#/watch/${item.id}`}>Watch</a></div>
        ) : item.state === "skipped" ? <p className="ai-pl-n">Not added.</p> : (
          <div className="ai-row">
            <button className="btn btn-primary" onClick={() => { addProposed(data, item); item.state = "added"; chat.touch(); toast("Added. Only you can see it."); }}>Add to my DEV Tube</button>
            <button className="btn" onClick={() => { item.state = "skipped"; chat.touch(); }}>Not now</button>
          </div>
        )}
        <small className="ai-fine">Stays in this browser. It is not added for other visitors.</small>
      </div>
    </div>
  );
}

export function KeyPanel({ onClose }: { onClose: () => void }) {
  const u = useUserData();
  const [v, setV] = useState("");
  return (
    <div className="ai-key" role="dialog" aria-label="Gemini key">
      <p><b>{u.key ? "Using your own Gemini key" : "Using the shared AI on this site"}</b></p>
      <p>The shared AI has a daily limit per visitor. Your own free key has its own limit and is stored only in this browser. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a key in Google AI Studio</a>.</p>
      <div className="ai-row">
        <input type="password" autoComplete="off" placeholder={u.key ? "Paste a new key to replace it" : "Paste your Gemini key"} value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn btn-primary" disabled={!v.trim()} onClick={() => { userActions.setKey(v); setV(""); toast("Key saved in this browser"); onClose(); }}>Save</button>
        {u.key ? <button className="btn" onClick={() => { userActions.setKey(""); toast("Key removed"); }}>Remove</button> : null}
      </div>
    </div>
  );
}

/* ---------- composer ---------- */
export function Composer({ chat, big, placeholder }: { chat: Chat; big?: boolean; placeholder?: string }) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; } }, [text]);
  const submit = () => { if (!text.trim() || chat.busy) return; const t = text; setText(""); void chat.send(t); };
  return (
    <div className={"ai-compose" + (big ? " big" : "")}>
      <textarea ref={ta} rows={1} value={text} placeholder={placeholder ?? (big ? "Tell me your goal, or paste a YouTube link" : "Reply")} aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
      <button className="ai-send" onClick={submit} disabled={!text.trim() || chat.busy} aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
    </div>
  );
}

/* ---------- playlists ---------- */
export function Playlists({ data }: { data: Data }) {
  const u = useUserData();
  return (
    <div className="page">
      <header className="page-head"><div><h1>Playlists</h1><p className="sub">Playlists you saved from Ask AI. They are stored only in this browser.</p></div></header>
      <p><button className="btn btn-primary" onClick={() => openAI("Build me a playlist. Ask me a few questions first.")}>Create one with AI</button></p>
      {u.playlists.length === 0 ? <div className="empty"><h2>No playlists yet</h2><p>Ask the AI for a learning plan and save it. It will show up here.</p></div> : (
        <div className="pl-grid">
          {u.playlists.map((p) => {
            const ids = p.ids.filter((id) => data.byId.has(id));
            const secs = total(ids, data); const first = data.byId.get(ids[0]);
            return (
              <article key={p.id} className="pl-tile">
                <a href={`#/playlist/${p.id}`} className="pl-cover">{first ? <img src={`https://i.ytimg.com/vi/${first.i}/hqdefault.jpg`} alt="" loading="lazy" /> : null}<span>{ids.length} videos</span></a>
                <h3><a href={`#/playlist/${p.id}`}>{p.title}</a></h3>
                <p>{secs ? hours(secs) : ""}</p>
              </article>
            );
          })}
        </div>
      )}
      {u.mine.length ? (
        <section className="pl-mine">
          <h2>Videos you added</h2>
          <ul>{u.mine.map((v) => (
            <li key={v.i}><a href={`#/watch/${v.i}`}>{v.t}</a><span>{v.c}</span>
              <button className="ai-ghost" onClick={() => { userActions.removeVideo(v.i); toast("Removed from your DEV Tube"); }}>Remove</button></li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}

export function PlaylistView({ id, data }: { id: string; data: Data }) {
  const u = useUserData();
  const st = useStore();
  const p = u.playlists.find((x) => x.id === id);
  const vids = useMemo(() => (p?.ids ?? []).map((i) => data.byId.get(i)).filter((v): v is NonNullable<typeof v> => !!v), [p, data]);
  if (!p) return <div className="page"><div className="empty"><h2>Playlist not found</h2><p>It may have been deleted, or it was saved in another browser.</p><a className="btn" href="#/playlists">All playlists</a></div></div>;
  const done = vids.filter((v) => st.done[v.i]).length;
  const secs = total(p.ids, data);
  return (
    <div className="page">
      <header className="page-head"><div>
        <h1>{p.title}</h1>
        {p.desc ? <p className="sub">{p.desc}</p> : null}
        <p className="sub">{vids.length} videos{secs ? `, ${hours(secs)}` : ""}, {done} done</p>
      </div></header>
      <div className="ai-row" style={{ marginBottom: 18 }}>
        {vids[0] ? <a className="btn btn-primary" href={`#/watch/${(vids.find((v) => !st.done[v.i]) ?? vids[0]).i}`}>{done ? "Continue" : "Start"}</a> : null}
        <button className="btn" onClick={() => openAI(`Change my playlist "${p.title}". Ask me what to adjust.`)}>Ask AI to change it</button>
        <button className="btn" onClick={() => { userActions.deletePlaylist(p.id); toast("Playlist deleted"); location.hash = "#/playlists"; }}>Delete</button>
      </div>
      <ol className="pl-list">
        {vids.map((v, k) => (
          <li key={v.i} className={st.done[v.i] ? "is-done" : ""}>
            <span className="pl-n">{k + 1}</span>
            <a href={`#/watch/${v.i}`} className="ai-pl-thumb"><Thumb v={v} /></a>
            <div><a href={`#/watch/${v.i}`} className="ai-pl-t">{v.t}</a><p>{v.c}{v.d ? `, ${fmtDur(v.d)}` : ""}, {LEVEL_NAME[v.l]}</p>{p.notes[v.i] ? <p className="ai-pl-n">{p.notes[v.i]}</p> : null}</div>
            <div className="pl-act">
              <button className="ai-ghost" onClick={() => actions.toggleDone(v.i)} aria-pressed={!!st.done[v.i]}>{st.done[v.i] ? "Done" : "Mark done"}</button>
              <button className="ai-ghost" onClick={() => userActions.removeFromPlaylist(p.id, v.i)}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

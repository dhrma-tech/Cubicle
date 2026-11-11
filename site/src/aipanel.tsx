import { useEffect, useRef, useState } from "react";
import { fmtDur, LEVEL_NAME, type Data } from "./data";
import { STARTERS, useChat } from "./ai";
import { closeAI, takePrompt, toggleAI, useAIOpen, usePendingPrompt } from "./aistate";
import { AskCard, Composer, KeyPanel, PlaylistCard, Spark, VideoCard } from "./aipage";
import { useUserData } from "./userdata";

const NAMES: Record<string, string> = { "": "Home", explore: "Explore", scroll: "Pro-Scroll", learn: "Syllabus", prep: "Interview prep", liked: "Liked videos", browse: "Browse", playlists: "Playlists", later: "Watch later", history: "History", progress: "Progress", best: "Best of", longs: "Long videos", settings: "Settings" };
const seg = () => location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);

function pageLabel(d: Data) {
  const [p0, p1] = seg();
  if (p0 === "watch" && p1) return d.byId.get(p1)?.t ?? "Video";
  if (p0 === "n" && p1) return d.nodes.get(p1)?.title ?? "Topic";
  if (p0 === "playlist") return "Playlist";
  return NAMES[p0 ?? ""] ?? (p0 ? p0[0].toUpperCase() + p0.slice(1) : "Home");
}

/* Everything the assistant is told about the page, read from the live page at send time. */
function pageContext(d: Data) {
  const path = seg(); const [p0, p1] = path;
  const out = [`Page: ${pageLabel(d)} (route /${path.join("/")})`];
  if (p0 === "watch" && p1) {
    const v = d.byId.get(p1);
    if (v) out.push(`The user is watching: "${v.t}" by ${v.c}. Topic: ${d.nodes.get(v.n)?.title ?? v.n}. Level: ${LEVEL_NAME[v.l]}.${v.d ? ` Length: ${fmtDur(v.d)}.` : ""}${v.p ? ` Published ${v.p.slice(0, 10)}.` : ""}${v.o ? " It may be outdated." : ""} Catalogue id: ${v.i}.`);
  }
  if (p0 === "n" && p1) { const n = d.nodes.get(p1); if (n) out.push(`Topic page: ${n.title} (id ${n.id}), ${n.count} videos.`); }
  if (p0 === "scroll") {
    const s = [...document.querySelectorAll<HTMLElement>(".sc-slide")].find((e) => { const r = e.getBoundingClientRect(); return r.top > -innerHeight / 2 && r.top < innerHeight / 2; });
    if (s?.ariaLabel) out.push(`The user is on a YouTube Short: ${s.ariaLabel}.`);
  }
  const main = document.querySelector("main");
  if (main) {
    const ids = new Set<string>(); const vids: string[] = [];
    main.querySelectorAll<HTMLAnchorElement>('a[href^="#/watch/"]').forEach((a) => {
      const id = a.getAttribute("href")!.split("/")[2]?.split("?")[0]; const v = id ? d.byId.get(id) : undefined;
      if (v && !ids.has(id!) && vids.length < 40) { ids.add(id!); vids.push(`${v.i} | ${v.t} | ${v.c}`); }
    });
    if (vids.length) out.push(`Videos visible on the page (id | title | channel):\n${vids.join("\n")}`);
    const text = main.innerText.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, 4500);
    if (text) out.push(`Visible text on the page:\n${text}`);
  }
  return out.join("\n\n");
}

function starters(d: Data) {
  const [p0] = seg();
  if (p0 === "watch") return ["What will I learn from this video?", "What should I know before watching this?", "What should I watch next?"];
  if (p0 === "n") return ["Where should I start in this topic?", "Make a playlist from this topic", "What are the key ideas here?"];
  if (p0 === "scroll") return ["Explain the Short I am on", "What should I learn next?"];
  void d;
  return ["What is on this page?", "What should I watch next?", ...STARTERS.slice(0, 1)];
}

/** Models like to answer in Markdown. Show clean text instead: no asterisks, underscores, hashes or backticks. */
export const plain = (t: string) => t
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^(\s*)[*+]\s+/gm, "$1- ")
  .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1")
  .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2").replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
  .replace(/`([^`]+)`/g, "$1").replace(/^```\w*$/gm, "")
  .replace(/\*{2,}/g, "").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)");

export function AIPanel({ data }: { data: Data }) {
  const open = useAIOpen();
  const chat = useChat();
  const u = useUserData();
  const pending = usePendingPrompt();
  const [keyOpen, setKeyOpen] = useState(false);
  const [label, setLabel] = useState(() => pageLabel(data));
  const [tips, setTips] = useState(() => starters(data));
  const end = useRef<HTMLDivElement>(null);
  const empty = chat.items.length === 0;

  useEffect(() => { chat.context = () => pageContext(data); return () => { chat.context = null; }; }, [chat, data]);
  useEffect(() => {
    const f = () => { setLabel(pageLabel(data)); setTips(starters(data)); };
    f(); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f);
  }, [data, open]);
  useEffect(() => { if (open && pending) { const p = takePrompt(); if (p) void chat.send(p); } }, [open, pending, chat]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeAI(); };
    addEventListener("keydown", k);
    const t = matchMedia("(pointer: fine)").matches ? setTimeout(() => document.querySelector<HTMLTextAreaElement>(".aip textarea")?.focus(), 320) : 0;
    return () => { removeEventListener("keydown", k); clearTimeout(t); };
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" }); }, [chat.items.length, chat.busy, open]);

  return (
    <>
      <button className={"aip-fab" + (open ? " hide" : "")} onClick={toggleAI} aria-label="Ask AI" aria-expanded={open} title="Ask AI (g a)" tabIndex={open ? -1 : 0}>
        <Spark size={44} />
      </button>
      <div className={"aip-scrim" + (open ? " on" : "")} onClick={closeAI} />
      <aside className={"aip" + (open ? " open" : "")} aria-label="Ask AI" aria-hidden={!open}>
        <header className="aip-head">
          <span className="ai-who"><span className="aip-logo"><Spark size={24} /></span>Ask AI</span>
          <div>
            {!empty ? <button className="ai-ghost" onClick={() => chat.reset()} disabled={chat.busy}>New chat</button> : null}
            <button className="ai-ghost" onClick={() => setKeyOpen((o) => !o)} aria-expanded={keyOpen}>{u.key ? "Your key" : "Key"}</button>
            <button className="aip-x" onClick={closeAI} aria-label="Close Ask AI"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
          </div>
        </header>
        <p className="aip-ctx" title={label}><i />Reading: <b>{label}</b></p>
        {keyOpen ? <KeyPanel onClose={() => setKeyOpen(false)} /> : null}

        <div className="aip-scroll">
          {empty ? (
            <div className="aip-hero">
              <span className="ai-mark"><Spark size={46} /></span>
              <h2>Ask about this page</h2>
              <p>I can see what you see. Ask about a video, a term, or anything here. I can also plan what to learn next and build playlists from the catalogue.</p>
              <div className="ai-starters">{tips.map((s) => <button key={s} onClick={() => void chat.send(s)}>{s}</button>)}</div>
            </div>
          ) : (
            <div className="ai-col" role="log" aria-live="polite">
              {chat.items.map((it, k) => {
                switch (it.kind) {
                  case "user": return <div key={k} className="ai-msg me"><p>{it.text}</p></div>;
                  case "text": return <div key={k} className="ai-msg"><span className="ai-mark sm"><Spark size={26} /></span><div className="ai-text">{plain(it.text).split(/\n{2,}/).map((p, j) => <p key={j} className="ai-p">{p}</p>)}</div></div>;
                  case "ask": return <AskCard key={k} item={it} chat={chat} />;
                  case "playlist": return <PlaylistCard key={k} item={it} data={data} chat={chat} />;
                  case "video": return <VideoCard key={k} item={it} data={data} chat={chat} />;
                  case "error": return (
                    <div key={k} className="ai-error" role="alert"><p>{it.text}</p>
                      <div className="ai-row">{it.key ? <button className="btn" onClick={() => setKeyOpen(true)}>Add my key</button> : null}{it.retry ? <button className="btn" onClick={() => void chat.retry()}>Try again</button> : null}</div>
                    </div>
                  );
                }
              })}
              {chat.busy ? <div className="ai-status" role="status"><i /><i /><i /><span>{chat.status}</span></div> : null}
              <div ref={end} />
            </div>
          )}
        </div>

        <footer className="aip-foot">
          <Composer chat={chat} placeholder="Ask about this page" />
          <p className="ai-fine">AI can be wrong. It sees this page, not video transcripts.</p>
        </footer>
      </aside>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "./data";
import { useStore, actions } from "./store";
import { go, Toaster } from "./components";
import { About, Browse, Home, Learn, NodePage, NotFound, Prep, ProgressPage, Saved, SectionPage, SettingsPage, Watch } from "./views";

function parse() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [p, qs = ""] = h.split("?");
  return { path: p.split("/").filter(Boolean), q: new URLSearchParams(qs) };
}

function useRoute() {
  const [r, setR] = useState(parse());
  const last = useRef(r.path.join("/"));
  useEffect(() => {
    const f = () => {
      const n = parse();
      setR(n);
      const key = n.path.join("/");
      if (key !== last.current) { last.current = key; window.scrollTo(0, 0); }
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return r;
}

const SHORTCUTS: [string, string][] = [
  ["/", "Search"], ["j / k", "Next / previous video"], ["Enter", "Open the selected video"], ["l", "Like the selected video"],
  ["w", "Add to watch later"], ["d", "Mark done"], ["g then h", "Go home"], ["g then s", "Go to the syllabus"], ["g then p", "Go to interview prep"], ["?", "Show this list"],
];

export default function App() {
  const { data, error } = useData();
  const route = useRoute();
  const st = useStore();
  const [railOpen, setRailOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sel = useRef(-1);
  const gPending = useRef(false);

  // theme
  useEffect(() => {
    const t = st.settings.theme;
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  }, [st.settings.theme]);

  useEffect(() => { setRailOpen(false); }, [route.path.join("/")]);

  const rows = useCallback(() => Array.from(document.querySelectorAll<HTMLElement>("[data-row]")), []);
  const select = useCallback((i: number) => {
    const r = rows(); if (!r.length) return;
    sel.current = Math.max(0, Math.min(r.length - 1, i));
    r.forEach((el, k) => el.classList.toggle("is-sel", k === sel.current));
    r[sel.current].scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [rows]);

  useEffect(() => { sel.current = -1; }, [route.path.join("/"), route.q.toString()]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) { if (e.key === "Escape") t.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (gPending.current) {
        gPending.current = false;
        const m: Record<string, string> = { h: "/", s: "/learn", p: "/prep", l: "/liked" };
        if (m[e.key]) { go(m[e.key]); e.preventDefault(); return; }
      }
      const r = rows(); const cur = r[sel.current]; const id = cur?.dataset.id;
      switch (e.key) {
        case "/": e.preventDefault(); searchRef.current?.focus(); break;
        case "?": setHelp((h) => !h); break;
        case "Escape": setHelp(false); break;
        case "g": gPending.current = true; setTimeout(() => { gPending.current = false; }, 900); break;
        case "j": select(sel.current + 1); break;
        case "k": select(sel.current - 1); break;
        case "Enter": if (id) go(`/watch/${id}`); break;
        case "l": if (id) actions.toggleLiked(id); break;
        case "w": if (id) actions.toggleLater(id); break;
        case "d": if (id) actions.toggleDone(id); break;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [rows, select]);

  const [p0, p1] = route.path;
  const active = p0 || "home";
  const link = (href: string, label: string, key: string, count?: number) => (
    <a href={href} className={"nav" + (active === key ? " on" : "")} aria-current={active === key ? "page" : undefined}>
      <span>{label}</span>{count ? <small>{count}</small> : null}
    </a>
  );

  let body: JSX.Element;
  if (error) body = <div className="page"><div className="empty"><h2>Could not load the catalogue</h2><p>{error}. Check your connection and reload the page.</p></div></div>;
  else if (!data) body = <div className="page"><p className="loading" role="status">Loading the catalogue…</p></div>;
  else {
    switch (p0) {
      case undefined: body = <Home data={data} q={route.q} />; break;
      case "learn": body = <Learn data={data} />; break;
      case "s": body = <SectionPage id={p1} q={route.q} data={data} />; break;
      case "n": body = <NodePage id={p1} q={route.q} data={data} />; break;
      case "browse": body = <Browse q={route.q} data={data} />; break;
      case "watch": body = <Watch id={p1} data={data} />; break;
      case "liked": body = <Saved kind="liked" q={route.q} data={data} />; break;
      case "later": body = <Saved kind="later" q={route.q} data={data} />; break;
      case "history": body = <Saved kind="history" q={route.q} data={data} />; break;
      case "prep": body = <Prep data={data} />; break;
      case "progress": body = <ProgressPage data={data} />; break;
      case "settings": body = <SettingsPage />; break;
      case "about": body = <About data={data} />; break;
      default: body = <NotFound />;
    }
  }

  return (
    <div className={"shell" + (railOpen ? " rail-open" : "")}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="top">
        <button type="button" className="burger" aria-label="Menu" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}><span /><span /><span /></button>
        <a className="brand" href="#/" aria-label="DEV Tube home"><b>DEV</b>Tube</a>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const v = searchRef.current?.value.trim(); go(v ? `/browse?q=${encodeURIComponent(v)}` : "/browse"); searchRef.current?.blur(); }}>
          <span className="search-in"><input ref={searchRef} type="search" placeholder="Search videos, channels, topics" aria-label="Search videos" defaultValue={p0 === "browse" ? route.q.get("q") ?? "" : ""} key={p0 === "browse" ? route.q.get("q") ?? "" : "x"} /><kbd aria-hidden="true">/</kbd></span>
          <button type="submit" className="search-btn" aria-label="Search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg></button>
        </form>
        <button type="button" className="textbtn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">?</button>
      </header>

      <nav className="rail" aria-label="Main">
        {link("#/", "Home", "home")}
        {link("#/learn", "Syllabus", "learn")}
        {link("#/prep", "Interview prep", "prep")}
        {link("#/browse", "Most recommended", "browse")}
        {data?.meta.hasDuration ? <a className="nav" href="#/browse?dur=long"><span>Longs</span></a> : null}
        <hr />
        {link("#/liked", "Liked", "liked", st.liked.length)}
        {link("#/later", "Watch later", "later", st.later.length)}
        {link("#/history", "History", "history")}
        {link("#/progress", "Progress", "progress", Object.keys(st.done).length)}
        {data ? (
          <>
            <hr />
            <p className="rail-h">Sections</p>
            {data.sections.map((s) => (
              <a key={s.id} href={`#/s/${s.id}`} className={"nav sub" + (p0 === "s" && p1 === s.id ? " on" : "")}><span>{s.title}</span><small>{s.count}</small></a>
            ))}
          </>
        ) : null}
        <hr />
        {link("#/settings", "Settings", "settings")}
        {link("#/about", "How this works", "about")}
      </nav>
      <div className="scrim" onClick={() => setRailOpen(false)} />

      <main id="main" tabIndex={-1}>{body}</main>

      <Toaster />

      {help ? (
        <div className="dialog-wrap" role="presentation" onClick={() => setHelp(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <dl>{SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
            <button className="btn" type="button" onClick={() => setHelp(false)} autoFocus>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

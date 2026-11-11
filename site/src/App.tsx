import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "./data";
import { useStore, actions } from "./store";
import { go, Toaster } from "./components";
import { Explore } from "./explore";
import { Scroll } from "./scroll";
import { AIPage, PlaylistView, Playlists } from "./aipage";
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

const ICONS: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  learn: "M4 6h16M4 12h16M4 18h10",
  prep: "M3 8h18v12H3zM9 8V5h6v3M3 13h18",
  best: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  longs: "M4 5h16v14H4zM10 9.5v5l4.5-2.5z",
  liked: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z",
  later: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v5l3 2",
  progress: "M4 12l5 5L20 6",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  ai: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
  playlists: "M4 6h12M4 11h12M4 16h7M18 13v6M15 16h6",
  scroll: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 17h4M12 7v6M9.5 10.5L12 13l2.5-2.5",
  explore: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  about: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
};
const Ico = ({ n }: { n: string }) => (
  <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>
);

const SHORTCUTS: [string, string][] = [
  ["/", "Search"], ["j / k", "Next / previous video"], ["Enter", "Open the selected video"], ["l", "Like the selected video"],
  ["w", "Add to watch later"], ["d", "Mark done"], ["g then h", "Go home"], ["g then e", "Go to Explore"], ["g then r", "Go to Pro-Scroll"], ["g then a", "Ask AI"], ["g then s", "Go to the syllabus"], ["g then p", "Go to interview prep"], ["?", "Show this list"],
];

export default function App() {
  const { data, error } = useData();
  const route = useRoute();
  const st = useStore();
  const [railOpen, setRailOpen] = useState(false);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem("devtube.rail") !== "full"; } catch { return true; } });
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
        const m: Record<string, string> = { h: "/", e: "/explore", r: "/scroll", a: "/ai", s: "/learn", p: "/prep", l: "/liked" };
        if (m[e.key]) { go(m[e.key]); e.preventDefault(); return; }
      }
      const r = rows(); const cur = r[sel.current]; const id = cur?.dataset.id;
      switch (e.key) {
        case "/": e.preventDefault(); searchRef.current?.focus(); break;
        case "?": setHelp((h) => !h); break;
        case "Escape": setHelp(false); setRailOpen(false); break;
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
  const isWatch = p0 === "watch" || p0 === "scroll" || p0 === "ai"; // immersive pages: the sidebar is a hidden drawer, like YouTube's watch page
  const toggleRail = () => {
    if (isWatch || matchMedia("(max-width: 860px)").matches) { setRailOpen((o) => !o); return; }
    setMini((m) => { const n = !m; try { localStorage.setItem("devtube.rail", n ? "mini" : "full"); } catch { /* private mode */ } return n; });
  };
  const link = (href: string, label: string, key: string, icon: string, count?: number, on = active === key, short?: string) => (
    <a href={href} className={"nav" + (on ? " on" : "")} aria-current={on ? "page" : undefined} title={label}>
      <Ico n={icon} /><span className="lb"><span className="lg">{label}</span><span className="sh">{short ?? label}</span></span>{count ? <small>{count}</small> : null}
    </a>
  );

  let body: JSX.Element;
  if (error) body = <div className="page"><div className="empty"><h2>Could not load the catalogue</h2><p>{error}. Check your connection and reload the page.</p></div></div>;
  else if (!data) body = <div className="page"><p className="loading" role="status">Loading the catalogue…</p></div>;
  else {
    switch (p0) {
      case undefined: body = <Home data={data} q={route.q} />; break;
      case "explore": body = <Explore q={route.q} />; break;
      case "scroll": body = <Scroll q={route.q} data={data} />; break;
      case "ai": body = <AIPage data={data} ask={route.q.get("ask")} />; break;
      case "playlists": body = <Playlists data={data} />; break;
      case "playlist": body = <PlaylistView id={p1 ?? ""} data={data} />; break;
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
    <div className={"shell" + (railOpen ? " rail-open" : "") + (isWatch ? " drawer" : mini ? " mini" : "")}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="top">
        <div className="top-l">
          <button type="button" className="burger" aria-label="Toggle menu" aria-expanded={isWatch || railOpen ? railOpen : !mini} onClick={toggleRail}><span /><span /><span /></button>
          <a className="brand" href="#/" aria-label="DEV Tube home"><b>DEV</b>Tube</a>
        </div>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const v = searchRef.current?.value.trim(); go(v ? `/browse?q=${encodeURIComponent(v)}` : "/browse"); searchRef.current?.blur(); }}>
          <span className="search-in"><input ref={searchRef} type="search" placeholder="Search videos, channels, topics" aria-label="Search videos" defaultValue={p0 === "browse" ? route.q.get("q") ?? "" : ""} key={p0 === "browse" ? route.q.get("q") ?? "" : "x"} /></span>
          <button type="submit" className="search-btn" aria-label="Search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg></button>
        </form>
        <div className="top-r"><a className="ask-btn" href="#/ai" aria-label="Ask AI" title="Ask AI (g a)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v4M17 5h4M5 17v4M3 19h4" /></svg></a></div>
      </header>

      <nav className="rail" aria-label="Main">
        {link("#/", "Home", "home", "home")}
        {link("#/explore", "Explore", "explore", "explore")}
        {link("#/scroll", "Pro-Scroll", "scroll", "scroll", undefined, active === "scroll", "Scroll")}
        {link("#/ai", "Ask AI", "ai", "ai")}
        {link("#/learn", "Syllabus", "learn", "learn")}
        {link("#/prep", "Interview prep", "prep", "prep", undefined, active === "prep", "Prep")}
        {link("#/browse", "Most recommended", "browse", "best", undefined, active === "browse" && route.q.get("dur") !== "long", "Top")}
        {data?.meta.hasDuration ? link("#/browse?dur=long", "Longs", "longs", "longs", undefined, active === "browse" && route.q.get("dur") === "long") : null}
        <hr />
        {link("#/liked", "Liked", "liked", "liked", st.liked.length)}
        {link("#/later", "Watch later", "later", "later", st.later.length)}
        {link("#/playlists", "Playlists", "playlists", "playlists", undefined, active === "playlists" || active === "playlist", "Lists")}
        {link("#/history", "History", "history", "history")}
        {link("#/progress", "Progress", "progress", "progress", Object.keys(st.done).length)}
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
        {link("#/settings", "Settings", "settings", "settings")}
        {link("#/about", "How this works", "about", "about", undefined, active === "about", "About")}
      </nav>
      <div className="scrim" onClick={() => setRailOpen(false)} />

      <main id="main" tabIndex={-1} key={route.path.join("/")}>{body}</main>

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

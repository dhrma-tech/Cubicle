import { useEffect, useMemo, useRef, useState } from "react";
import type { Video } from "./types";
import { actions, useStore } from "./store";
import { study, useStudy } from "./study";
import { fmtDur, LEVEL_NAME, pathOrder, SHELF_NAME, type Data } from "./data";
import { Actions, Empty, freshText, go, LevelTag, Thumb, Vouch, VideoRow, YtCard } from "./components";

/* ---------- query helpers ---------- */
export function setParam(key: string, val: string | null) {
  const h = location.hash.replace(/^#/, "") || "/";
  const [p, qs = ""] = h.split("?");
  const sp = new URLSearchParams(qs);
  if (val) sp.set(key, val); else sp.delete(key);
  const s = sp.toString();
  location.hash = p + (s ? "?" + s : "");
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="prog" role="img" aria-label={`${done} of ${total} done`}>
      <i style={{ width: `${pct(done, total)}%` }} />
    </span>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children}
    </header>
  );
}

/* ---------- pill dropdown (rounded, replaces the native select popup) ---------- */
export function PillSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLElement>(".pill-btn")?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    box.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const cur = options.find((o) => o[0] === value)?.[1] ?? options[0][1];
  return (
    <div className="sortsel" ref={box}>
      <span>{label}</span>
      <div className="pill-wrap">
        <button type="button" className="pill-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {cur}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {open ? (
          <div className="pill-list" role="listbox" aria-label={label}>
            {options.map(([v, l]) => (
              <button key={v} type="button" role="option" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => { setOpen(false); onChange(v); }}>{l}</button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================== Catalog (filterable list) ============================== */
export function Catalog({ base, q, data, showNode = true, emptyTitle = "No videos match", sortDefault = "best" }:
  { base: Video[]; q: URLSearchParams; data: Data; showNode?: boolean; emptyTitle?: string; sortDefault?: string }) {
  const s = useStore();
  const [shown, setShown] = useState(40);
  const lv = q.get("lv"), dur = q.get("dur"), ch = q.get("ch"), text = (q.get("q") || "").trim().toLowerCase();
  const fresh = q.get("fresh") === "1" || s.settings.hideOutdated;
  const sort = q.get("sort") || sortDefault;
  const list = useMemo(() => {
    let l = base;
    if (ch) l = l.filter((v) => v.c === ch);
    if (lv) l = l.filter((v) => v.l === lv);
    if (fresh) l = l.filter((v) => !v.o);
    if (dur === "long") l = l.filter((v) => (v.d || 0) >= 2400);
    if (dur === "short") l = l.filter((v) => v.d && v.d < 1200);
    if (text) {
      const toks = text.split(/\s+/);
      l = l.filter((v) => {
        const hay = `${v.t} ${v.c} ${data.nodes.get(v.n)?.title ?? ""}`.toLowerCase();
        return toks.every((t) => hay.includes(t));
      });
    }
    l = [...l];
    if (sort === "saved") { /* keep the order the user saved them in */ }
    else if (sort === "path") l.sort(pathOrder);
    else if (sort === "recent") l.sort((a, b) => (b.y[1] ?? 0) - (a.y[1] ?? 0) || b.sc - a.sc);
    else l.sort((a, b) => b.sc - a.sc);
    return l;
  }, [base, lv, ch, fresh, dur, text, sort, data]);
  const chip = (key: string, val: string, label: string, cur: string | null) => (
    <button type="button" className={"chip" + (cur === val ? " on" : "")} aria-pressed={cur === val} onClick={() => setParam(key, cur === val ? null : val)}>{label}</button>
  );
  return (
    <>
      <div className="filters" role="group" aria-label="Filters">
        <span className="fgroup">{chip("lv", "b", "Beginner", lv)}{chip("lv", "i", "Intermediate", lv)}{chip("lv", "a", "Advanced", lv)}</span>
        {data.meta.hasDuration ? <span className="fgroup">{chip("dur", "short", "Under 20 min", dur)}{chip("dur", "long", "Longs (40 min+)", dur)}</span> : null}
        <span className="fgroup">
          <button type="button" className={"chip" + (q.get("fresh") === "1" ? " on" : "")} aria-pressed={q.get("fresh") === "1"} onClick={() => setParam("fresh", q.get("fresh") === "1" ? null : "1")}>Hide possibly outdated</button>
        </span>
        <PillSelect label="Sort" value={sort} options={[...(sortDefault === "saved" ? [["saved", "Saved order"]] : []), ["best", "Most recommended"], ["path", "Learning order"], ["recent", "Recently recommended"]] as [string, string][]} onChange={(v) => setParam("sort", v === sortDefault ? null : v)} />
      </div>
      {list.length === 0 ? (
        <Empty title={emptyTitle}>Clear a filter or try a broader search.</Empty>
      ) : (
        <div className="rows" role="feed" aria-label="Videos">
          <p className="count">{list.length} {list.length === 1 ? "video" : "videos"}</p>
          {list.slice(0, shown).map((v) => <VideoRow key={v.i} v={v} data={data} showNode={showNode} />)}
          {list.length > shown ? <button type="button" className="more" onClick={() => setShown((n) => n + 60)}>Show {Math.min(60, list.length - shown)} more</button> : null}
        </div>
      )}
    </>
  );
}

/* ============================== Home (YouTube-style feed) ============================== */
const PAGE = 24;

function rankFeed(data: Data, s: ReturnType<typeof useStore>, pool: Video[]): Video[] {
  const aff = new Map<string, number>();
  const add = (id: string, w: number) => {
    const v = data.byId.get(id); if (!v) return;
    aff.set("n:" + v.n, (aff.get("n:" + v.n) || 0) + w);
    aff.set("s:" + v.s, (aff.get("s:" + v.s) || 0) + w * 0.5);
  };
  s.liked.forEach((id) => add(id, 3));
  Object.keys(s.done).forEach((id) => add(id, 2));
  s.history.slice(0, 40).forEach((h) => add(h.id, 1));
  const personal = aff.size > 0;
  const seen = new Set(s.history.slice(0, 120).map((h) => h.id));
  const maxSc = Math.max(1, ...data.videos.map((v) => v.sc));
  const day = Math.floor(Date.now() / 864e5);
  const jitter = (id: string) => { let h = day; for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0; return (h % 1000) / 1000; };
  const scored = pool.map((v) => ({
    v,
    x: (v.sc / maxSc) * 3 + Math.min(aff.get("n:" + v.n) || 0, 8) * 0.35 + Math.min(aff.get("s:" + v.s) || 0, 8) * 0.12 +
      (!personal && v.l === "b" ? 0.6 : 0) + jitter(v.i) * 0.9 -
      (s.done[v.i] ? 3 : 0) - (seen.has(v.i) ? 1.2 : 0) - (v.o ? 1.5 : 0),
  })).sort((a, b) => b.x - a.x).map((o) => o.v);
  // spread topics and channels so the grid does not show five of the same thing in a row
  const head = scored.slice(0, 400), tail = scored.slice(400), out: Video[] = [];
  const recentN: string[] = [], recentC: string[] = [];
  while (head.length) {
    let k = head.findIndex((v, idx) => idx < 30 && !recentN.includes(v.n) && !recentC.includes(v.c));
    if (k < 0) k = 0;
    const [v] = head.splice(k, 1);
    out.push(v);
    recentN.push(v.n); if (recentN.length > 3) recentN.shift();
    recentC.push(v.c); if (recentC.length > 2) recentC.shift();
  }
  return out.concat(tail);
}

const IconChev = ({ dir }: { dir: "l" | "r" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

export function Home({ data, q, top }: { data: Data; q: URLSearchParams; top?: React.ReactNode }) {
  const s = useStore();
  const chipId = q.get("c") || "all";
  const [shown, setShown] = useState(PAGE);
  const bar = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  const sRef = useRef(s); sRef.current = s;

  const chips: { id: string; label: string }[] = [
    { id: "all", label: "All" },
    { id: "beginner", label: "Beginner friendly" },
    ...(data.meta.hasDuration ? [{ id: "long", label: "Longs" }] : []),
    ...data.sections.map((x) => ({ id: x.id, label: x.title })),
  ];

  // The order is computed once per chip so cards never jump while you click around.
  const feed = useMemo(() => {
    let pool = data.videos;
    if (chipId === "beginner") pool = pool.filter((v) => v.l === "b");
    else if (chipId === "long") pool = pool.filter((v) => (v.d || 0) >= 2400);
    else if (chipId !== "all") pool = data.bySection.get(chipId) || [];
    return rankFeed(data, sRef.current, pool);
  }, [data, chipId]);

  const muted = useMemo(() => new Set(s.mutedChannels), [s.mutedChannels]);
  const hidden = useMemo(() => new Set(s.hidden), [s.hidden]);
  const visible = useMemo(
    () => feed.filter((v) => !hidden.has(v.i) && !muted.has(v.c) && !(s.settings.hideOutdated && v.o)),
    [feed, hidden, muted, s.settings.hideOutdated],
  );

  useEffect(() => { setShown(PAGE); }, [chipId]);
  useEffect(() => {
    const el = sentinel.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setShown((n) => n + PAGE); }, { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible.length, shown]);

  const measure = () => {
    const b = bar.current; if (!b) return;
    setEdge({ l: b.scrollLeft > 4, r: b.scrollLeft + b.clientWidth < b.scrollWidth - 4 });
  };
  useEffect(() => { measure(); addEventListener("resize", measure); return () => removeEventListener("resize", measure); }, [chips.length]);
  useEffect(() => { bar.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ inline: "center", block: "nearest" }); }, []);
  const nudge = (d: number) => bar.current?.scrollBy({ left: d * bar.current.clientWidth * 0.7, behavior: "smooth" });
  const pick = (id: string) => go(id === "all" ? "/" : `/?c=${id}`);
  const hiddenCount = s.hidden.length + s.mutedChannels.length;

  return (
    <div className="home">
      <div className="chipbar" role="group" aria-label="Filter the feed">
        {edge.l ? <button type="button" className="chip-arrow l" aria-label="Scroll chips left" onClick={() => nudge(-1)}><IconChev dir="l" /></button> : null}
        <div className="chip-scroll" ref={bar} onScroll={measure}>
          {chips.map((c) => (
            <button key={c.id} type="button" className={"fchip" + (chipId === c.id ? " on" : "")} aria-pressed={chipId === c.id} onClick={() => pick(c.id)}>{c.label}</button>
          ))}
        </div>
        {edge.r ? <button type="button" className="chip-arrow r" aria-label="Scroll chips right" onClick={() => nudge(1)}><IconChev dir="r" /></button> : null}
      </div>

      {chipId === "all" ? top : null}
      {!s.introDismissed && chipId === "all" ? (
        <aside className="intro" aria-label="About DEV Tube">
          <p><b>{data.videos.length.toLocaleString()} videos</b> for machine learning, AI engineering, programming, DSA and interviews. Each one is here because several independent people or course lists recommended it. No account needed.</p>
          <span className="intro-actions">
            <a className="btn btn-primary" href="#/learn">Open the syllabus</a>
            <a className="btn" href="#/prep">Interview prep</a>
            <button type="button" className="btn" onClick={() => actions.dismissIntro()}>Dismiss</button>
          </span>
        </aside>
      ) : null}

      {visible.length === 0 ? (
        <Empty title="Nothing to show here">
          {hiddenCount > 0 ? <>You have hidden videos or channels. <button type="button" className="textlink" onClick={() => actions.restoreHidden()}>Restore them</button> or pick another topic.</> : "Pick another topic above."}
        </Empty>
      ) : (
        <div className="yt-grid" role="feed" aria-label="Videos">
          {visible.slice(0, shown).map((v) => <YtCard key={v.i} v={v} data={data} home />)}
        </div>
      )}
      {visible.length > shown ? <div ref={sentinel} className="sentinel"><button type="button" className="more" onClick={() => setShown((n) => n + PAGE)}>Show more</button></div> : visible.length > 0 ? <p className="end">That is everything in this view.</p> : null}
    </div>
  );
}

/* ============================== Syllabus ============================== */
export function Learn({ data }: { data: Data }) {
  const s = useStore();
  return (
    <div className="page">
      <PageHead title="Syllabus" sub="Every topic an AI or ML engineer is expected to know, from Python to production. Open a topic to watch its videos from beginner to advanced." />
      <div className="syllabus">
        {data.sections.map((sec, idx) => {
          const vids = data.bySection.get(sec.id) || [];
          const done = vids.filter((v) => s.done[v.i]).length;
          return (
            <details key={sec.id} className="sec" open={idx < 2}>
              <summary>
                <span className="sec-title">{sec.title}</span>
                <span className="sec-meta">{sec.count} videos</span>
                <Progress done={done} total={vids.length} />
              </summary>
              <p className="sec-blurb">{sec.blurb}. <a href={`#/s/${sec.id}`}>See all {sec.count}</a></p>
              <ul className="nodes">
                {sec.nodes.map((n) => {
                  const nv = data.byNode.get(n.id) || [];
                  const nd = nv.filter((v) => s.done[v.i]).length;
                  return (
                    <li key={n.id}>
                      <a href={`#/n/${n.id}`}>
                        <span className="node-name">{n.title}</span>
                        <span className="node-count">{nd ? `${nd}/${n.count}` : n.count}</span>
                        <Progress done={nd} total={nv.length} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== Section / topic / browse ============================== */
export function SectionPage({ id, q, data }: { id: string; q: URLSearchParams; data: Data }) {
  const sec = data.sections.find((x) => x.id === id);
  if (!sec) return <NotFound />;
  return (
    <div className="page">
      <PageHead title={sec.title} sub={sec.blurb} />
      <nav className="subnav" aria-label="Topics in this section">
        {sec.nodes.map((n) => <a key={n.id} href={`#/n/${n.id}`}>{n.title} <small>{n.count}</small></a>)}
      </nav>
      <Catalog base={data.bySection.get(id) || []} q={q} data={data} />
    </div>
  );
}

export function NodePage({ id, q, data }: { id: string; q: URLSearchParams; data: Data }) {
  const fs = useStudy();
  const n = data.nodes.get(id);
  if (!n) return <NotFound />;
  const sec = data.sections.find((x) => x.id === n.section)!;
  return (
    <div className="page">
      <p className="crumb"><a href="#/learn">Syllabus</a> / <a href={`#/s/${sec.id}`}>{sec.title}</a></p>
      <PageHead title={n.title} sub={`${n.count} videos. ${SHELF_NAME[n.shelf.charAt(0) as "e" | "s" | "f"] ?? ""}.`} >
        <button className="btn" type="button" onClick={() => study.toggleTopic(n.id)}>{fs.follows.topics.includes(n.id) ? "Following" : "Follow topic"}</button>
      </PageHead>
      <Catalog base={data.byNode.get(id) || []} q={q} data={data} showNode={false} sortDefault="path" />
    </div>
  );
}

export function Browse({ q, data }: { q: URLSearchParams; data: Data }) {
  const base = data.videos;
  const text = q.get("q");
  return (
    <div className="page">
      <PageHead title={q.get("ch") ? `Videos from ${q.get("ch")}` : text ? `Results for “${text}”` : q.get("dur") === "long" ? "Longs" : "Most recommended"} sub={q.get("dur") === "long" ? "Full courses, lectures and deep dives, 40 minutes and up." : "Every video, ranked by how many independent sources recommend it."} />
      <Catalog base={base} q={q} data={data} />
    </div>
  );
}

export function Saved({ kind, data, q }: { kind: "liked" | "later" | "history"; data: Data; q: URLSearchParams }) {
  const s = useStore();
  const ids = kind === "liked" ? s.liked : kind === "later" ? s.later : s.history.map((h) => h.id);
  const base = ids.map((id) => data.byId.get(id)).filter(Boolean) as Video[];
  const titles = { liked: "Liked", later: "Watch later", history: "History" } as const;
  const hints = {
    liked: "Press the heart on any video to keep it here.",
    later: "Press the clock on any video to queue it.",
    history: "Videos you open appear here, newest first.",
  } as const;
  return (
    <div className="page">
      <PageHead title={titles[kind]} sub="Saved in this browser only.">
        {kind === "history" && base.length ? <button className="btn" type="button" onClick={() => actions.clearHistory()}>Clear history</button> : null}
      </PageHead>
      {base.length === 0 ? <Empty title={`Nothing in ${titles[kind].toLowerCase()} yet`}>{hints[kind]}</Empty> : <Catalog base={base} q={q} data={data} sortDefault="saved" />}
    </div>
  );
}

/* ============================== Interview prep ============================== */
export const TRACKS = [
  { id: "coding", title: "Coding interviews", blurb: "Data structures, algorithms and how to practice them.", nodes: ["dsa-complexity", "dsa-arrays", "dsa-pointers", "dsa-linked", "dsa-search-sort", "dsa-trees", "dsa-graphs", "dsa-heaps", "dsa-backtracking", "dsa-dp", "dsa-greedy-bits", "dsa-practice", "dsa-full", "cr-coding"] },
  { id: "ml", title: "ML theory and statistics", blurb: "The questions behind every data science and ML engineer loop.", nodes: ["probability", "stats", "linalg", "calculus", "optimization", "ml-supervised", "ml-trees", "ml-eval", "dl-training", "cr-ml-interview"] },
  { id: "ai", title: "AI and LLM engineer interviews", blurb: "How models work and how you build on them.", nodes: ["llm-attention", "llm-tokens", "llm-inference-internals", "ae-vector", "ae-rag", "ae-agents", "ae-evals", "ae-finetune", "ae-context", "cr-ai-interview", "cr-fde"] },
  { id: "sd", title: "System design", blurb: "Designing services, data systems and ML or LLM systems.", nodes: ["sd-fundamentals", "sd-data", "sd-distributed", "sd-cases", "sd-ml", "sd-llm"] },
  { id: "cs", title: "CS fundamentals", blurb: "Operating systems, networks, languages and databases.", nodes: ["cs-os", "cs-net", "cs-arch", "cs-lang", "sql", "cs-craft"] },
  { id: "career", title: "Projects, portfolio and getting hired", blurb: "What to build, how to show it and how to talk about it.", nodes: ["ae-projects", "cr-portfolio", "cr-roadmap", "cr-kaggle", "cr-behavioral", "cr-freelance"] },
];

export function Prep({ data }: { data: Data }) {
  const s = useStore();
  return (
    <div className="page">
      <PageHead title="Interview prep" sub="Six tracks. Work through a track top to bottom; progress is counted from the videos you mark done." />
      <div className="tracks">
        {TRACKS.map((t) => {
          const nodes = t.nodes.map((id) => data.nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n && n.count > 0);
          if (!nodes.length) return null;
          const all = nodes.flatMap((n) => data.byNode.get(n.id) || []);
          const done = all.filter((v) => s.done[v.i]).length;
          return (
            <section key={t.id} className="track">
              <header>
                <h2>{t.title}</h2>
                <p>{t.blurb}</p>
                <span className="track-prog"><Progress done={done} total={all.length} /> {done}/{all.length} done</span>
              </header>
              <ul>
                {nodes.map((n) => {
                  const nv = data.byNode.get(n.id) || [];
                  const top = nv.find((v) => !v.o && !s.done[v.i]) || nv[0];
                  const nd = nv.filter((v) => s.done[v.i]).length;
                  return (
                    <li key={n.id}>
                      <a className="track-node" href={`#/n/${n.id}`}>{n.title}</a>
                      <span className="node-count">{nd}/{n.count}</span>
                      {top ? <a className="track-pick" href={`#/watch/${top.i}`} title={top.t}>{nd === nv.length ? "Review: " : "Start with: "}{top.t}</a> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== Progress ============================== */
export function ProgressPage({ data }: { data: Data }) {
  const s = useStore();
  const total = data.videos.length, done = Object.keys(s.done).filter((id) => data.byId.has(id)).length;
  return (
    <div className="page">
      <PageHead title="Progress" sub="Counted from videos you mark done. Saved in this browser only." />
      <p className="bigprog"><Progress done={done} total={total} /> <strong>{done}</strong> of {total.toLocaleString()} videos done</p>
      <ul className="prog-list">
        {data.sections.map((sec) => {
          const vids = data.bySection.get(sec.id) || [];
          const d = vids.filter((v) => s.done[v.i]).length;
          return <li key={sec.id}><a href={`#/s/${sec.id}`}>{sec.title}</a><Progress done={d} total={vids.length} /><span className="node-count">{d}/{vids.length}</span></li>;
        })}
      </ul>
    </div>
  );
}

/* ============================== Settings ============================== */
export function SettingsPage() {
  const s = useStore();
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const download = () => {
    const blob = new Blob([JSON.stringify({ ...JSON.parse(actions.exportJSON()), _study: JSON.parse(study.exportJSON()) }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "devtube-progress.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const upload = async (f?: File) => {
    if (!f) return;
    try { const j = JSON.parse(await f.text()); const st = j._study; delete j._study; actions.importJSON(JSON.stringify(j)); if (st) study.importJSON(JSON.stringify(st)); setMsg("Progress restored."); } catch (e) { setMsg("That file is not a DEV Tube backup. Choose the file you exported."); }
  };
  return (
    <div className="page narrow">
      <PageHead title="Settings" sub="Stored in this browser. Nothing is sent anywhere." />
      <fieldset className="set">
        <legend>Thumbnails</legend>
        <label><input type="radio" name="th" checked={s.settings.thumb === "mid"} onChange={() => actions.setSettings({ thumb: "mid" })} /> A frame from the middle of the video</label>
        <label><input type="radio" name="th" checked={s.settings.thumb === "default"} onChange={() => actions.setSettings({ thumb: "default" })} /> The uploader’s thumbnail</label>
      </fieldset>
      <fieldset className="set">
        <legend>Home feed</legend>
        <label><input type="checkbox" checked={s.settings.preview} onChange={(e) => actions.setSettings({ preview: e.target.checked })} /> Play a muted preview when I hover a video</label>
        <p className="hint">{s.hidden.length} hidden {s.hidden.length === 1 ? "video" : "videos"}, {s.mutedChannels.length} hidden {s.mutedChannels.length === 1 ? "channel" : "channels"}.</p>
        <div className="btnrow"><button className="btn" type="button" disabled={!s.hidden.length && !s.mutedChannels.length} onClick={() => { actions.restoreHidden(); setMsg("Hidden videos and channels restored."); }}>Restore hidden videos</button></div>
      </fieldset>
      <fieldset className="set">
        <legend>Freshness</legend>
        <label><input type="checkbox" checked={s.settings.hideOutdated} onChange={(e) => actions.setSettings({ hideOutdated: e.target.checked })} /> Hide videos that may be outdated everywhere</label>
      </fieldset>
      <fieldset className="set">
        <legend>Theme</legend>
        {(["auto", "light", "dark"] as const).map((t) => (
          <label key={t}><input type="radio" name="theme" checked={s.settings.theme === t} onChange={() => actions.setSettings({ theme: t })} /> {t === "auto" ? "Match my device" : t === "light" ? "Light" : "Dark"}</label>
        ))}
      </fieldset>
      <fieldset className="set">
        <legend>Your data</legend>
        <p>{s.liked.length} liked, {s.later.length} in watch later, {Object.keys(s.done).length} done, {s.history.length} in history.</p>
        <div className="btnrow">
          <button className="btn" type="button" onClick={download}>Export progress</button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Import progress</button>
          <button className="btn btn-danger" type="button" onClick={() => { if (confirm("Erase all likes, history and progress from this browser?")) { actions.reset(); study.reset(); setMsg("All local data erased."); } }}>Erase everything</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        <p role="status" className="msg">{msg}</p>
      </fieldset>
    </div>
  );
}

/* ============================== About ============================== */
export function About({ data }: { data: Data }) {
  const m = data.meta;
  const est = (m.ages?.m ?? 0) + (m.ages?.u ?? 0);
  return (
    <div className="page narrow prose">
      <PageHead title="How this works" />
      <p>DEV Tube is a syllabus for AI, machine learning and AI engineering, filled with videos that people keep recommending to each other. It currently has {m.videos.toLocaleString()} videos from {m.channels.toLocaleString()} channels, sorted into {m.nodes} topics. Last built {m.built}.</p>

      <h2>Where the videos come from</h2>
      <p>Two independent signals. First, every YouTube link in the full Hacker News comment archive ({m.hn_comments.toLocaleString()} comments with links), counted by how many different users linked each video and how many of them were recommending it. Second, course lists: university syllabi, GitHub roadmaps and awesome lists. A video needs more than one voice behind it, or a place on a trusted list, to get in.</p>

      <h2>How videos are ranked</h2>
      <p>Score = recommendations (users, recommending comments, course lists) × freshness. Freshness depends on the topic: math and algorithms stay fresh for years, while videos about specific models or tools lose value in months. Those get a hatched bar and a “May be outdated” tag.</p>
      {est > 0 ? <p>For {est.toLocaleString()} videos the publish date was not available, so age is estimated from when the video was first recommended or from a year in its title. Hover the freshness bar to see how a video’s age was worked out.</p> : null}

      <h2>Your privacy</h2>
      <p>There are no accounts. Likes, watch later, history and progress live in your browser’s storage and never leave it. Videos play through YouTube’s privacy-enhanced embed.</p>

      <h2>Use the data</h2>
      <p>The full dataset is a single zip with a guide written for coding agents. Give it to yours and ask for your own version.</p>
      <p><a className="btn btn-primary" href="./devtube-data.zip" download>Download the data</a></p>

      <h2>Credits and limits</h2>
      <p>Hacker News data comes from the open-index/hacker-news dataset (ODC-By 1.0); comment excerpts link back to the original comment. The idea follows Andrej Karpathy’s HackerTube. DEV Tube is independent and not affiliated with YouTube, Hacker News or Karpathy. Videos can be removed by their owners at any time. “Recommended often” is not the same as “correct”, so check anything you rely on.</p>
    </div>
  );
}

export function NotFound() {
  return <div className="page"><Empty title="Not found">That page or video is not in the catalogue. <a href="#/">Go home</a> or <a href="#/learn">open the syllabus</a>.</Empty></div>;
}

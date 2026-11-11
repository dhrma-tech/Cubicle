import { useEffect, useMemo, useState } from "react";
import { Avatar, Empty, toast } from "./components";
import { PillSelect } from "./views";
import { ago, compact, GROUPS, newsActions, previousVisit, useNewsData, useNewsState, type NewsItem } from "./news";

const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const P = { save: "M6 4h12v17l-6-4-6 4z", out: "M7 17L17 7M9 7h8v8", chat: "M4 5h16v11H9l-5 4z", up: "M12 5l7 10H5z", star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z", more: "M5 12h.01M12 12h.01M19 12h.01", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" };

function Stats({ n }: { n: NewsItem }) {
  return (
    <span className="n-stats">
      {n.sc > 0 ? <span title={n.g === "repos" ? "GitHub stars" : n.g === "research" ? "Upvotes" : "Points"}><Ico d={n.g === "repos" ? P.star : P.up} size={13} />{compact(n.sc)}{n.g === "repos" ? " stars" : n.g === "research" ? " upvotes" : " points"}</span> : null}
      {n.cm > 0 ? (n.cu ? <a href={n.cu} target="_blank" rel="noreferrer noopener" title="Open the discussion"><Ico d={P.chat} size={13} />{compact(n.cm)} comments</a> : <span><Ico d={P.chat} size={13} />{compact(n.cm)}</span>) : null}
    </span>
  );
}

function Story({ n, big, saved, read, isNew }: { n: NewsItem; big?: boolean; saved: boolean; read: boolean; isNew: boolean }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    const c = () => setMenu(false);
    document.addEventListener("keydown", f); document.addEventListener("click", c);
    return () => { document.removeEventListener("keydown", f); document.removeEventListener("click", c); };
  }, [menu]);
  return (
    <article className={"story" + (big ? " story-big" : "") + (read ? " is-read" : "")}>
      <Avatar name={n.sn} />
      <div className="story-main">
        <p className="story-src"><b>{n.sn}</b>{n.a && n.g === "hn" ? <span> · {n.a}</span> : null}<span> · {ago(n.ts)}</span>{isNew ? <i className="new-dot" title="New since your last visit">New</i> : null}</p>
        <h3 className="story-title"><a href={n.u} target="_blank" rel="noreferrer noopener" onClick={() => newsActions.markRead(n.id)}>{n.t}</a></h3>
        {n.d ? <p className="story-desc">{n.d}</p> : null}
        <p className="story-foot"><Stats n={n} /></p>
      </div>
      <div className="story-act">
        <button type="button" className={"icon-btn" + (saved ? " on" : "")} aria-pressed={saved} aria-label={saved ? "Remove from saved" : "Save for later"} title={saved ? "Saved" : "Save for later"} onClick={() => newsActions.toggleSave(n.id)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d={P.save} /></svg>
        </button>
        <span className="story-menu">
          <button type="button" className="icon-btn" aria-label="More options" aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}><Ico d={P.more} /></button>
          {menu ? (
            <div className="menu" role="menu">
              <a role="menuitem" href={n.u} target="_blank" rel="noreferrer noopener">Open the article</a>
              {n.cu ? <a role="menuitem" href={n.cu} target="_blank" rel="noreferrer noopener">Open the discussion</a> : null}
              <button type="button" role="menuitem" onClick={() => newsActions.markRead(n.id)}>Mark as read</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => newsActions.mute(n.s)}>Hide stories from {n.sn}</button>
            </div>
          ) : null}
        </span>
      </div>
    </article>
  );
}

function Rail({ title, sub, items, numbered }: { title: string; sub?: string; items: NewsItem[]; numbered?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="side-card">
      <h2>{title}</h2>
      {sub ? <p className="side-sub">{sub}</p> : null}
      <ol className={numbered ? "numbered" : ""}>
        {items.map((n, i) => (
          <li key={n.id}>
            <a href={n.u} target="_blank" rel="noreferrer noopener" onClick={() => newsActions.markRead(n.id)}>
              {numbered ? <span className="rank">{i + 1}</span> : null}
              <span className="side-t">{n.t}</span>
              <span className="side-m">{n.sn} · {ago(n.ts)}{n.sc > 0 ? ` · ${compact(n.sc)}${n.g === "repos" ? " stars" : n.g === "research" ? " upvotes" : " points"}` : ""}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

const dayLabel = (ts: number) => {
  const d = new Date(ts * 1000), n = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff = Math.round((b - a) / 864e5);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

export function Explore({ q }: { q: URLSearchParams }) {
  const { data, error, reload, refresh, refreshing } = useNewsData();
  const doRefresh = async () => {
    try {
      const r = await refresh();
      toast(!r.live ? "Showing the latest saved snapshot. Live feeds are only available on the deployed site." : r.added ? `${r.added} new ${r.added === 1 ? "story" : "stories"}` : "Already up to date");
    } catch { toast("Could not refresh. Check your connection."); }
  };
  const ns = useNewsState();
  const [shown, setShown] = useState(20);
  const g = q.get("g") || "all", sort = q.get("sort") || "top", onlySaved = q.get("saved") === "1";
  const setP = (k: string, v: string | null) => {
    const p = new URLSearchParams(q.toString()); if (v === null) p.delete(k); else p.set(k, v);
    const s = p.toString(); location.hash = "#/explore" + (s ? "?" + s : "");
  };
  const seen = useMemo(() => previousVisit(), []);
  useEffect(() => { const t = setTimeout(() => newsActions.touch(), 4000); return () => clearTimeout(t); }, []);
  useEffect(() => { setShown(20); }, [g, sort, onlySaved]);

  const all = useMemo(() => (data?.items ?? []).filter((n) => !ns.muted.includes(n.s)), [data, ns.muted]);
  const counts = useMemo(() => { const c: Record<string, number> = { all: all.length }; all.forEach((n) => { c[n.g] = (c[n.g] || 0) + 1; }); return c; }, [all]);
  const list = useMemo(() => {
    let l = all;
    if (g !== "all") l = l.filter((n) => n.g === g);
    if (onlySaved) l = (data?.items ?? []).filter((n) => ns.saved.includes(n.id));
    return [...l].sort(sort === "latest" ? (a, b) => b.ts - a.ts : (a, b) => b.hot - a.hot);
  }, [all, data, g, sort, onlySaved, ns.saved]);

  const trending = useMemo(() => [...all].sort((a, b) => b.hot - a.hot).slice(0, 6), [all]);
  const labs = useMemo(() => all.filter((n) => n.g === "labs").sort((a, b) => b.ts - a.ts).slice(0, 5), [all]);
  const papers = useMemo(() => all.filter((n) => n.g === "research").sort((a, b) => b.sc - a.sc).slice(0, 5), [all]);
  const repos = useMemo(() => all.filter((n) => n.g === "repos").sort((a, b) => b.sc - a.sc).slice(0, 5), [all]);
  const updated = data ? ago(Date.parse(data.updated) / 1000) : "";
  const hiddenSrc = ns.muted.length;

  let lastDay = "";
  return (
    <div className="explore">
      <header className="ex-head">
        <div>
          <h1>What’s happening in AI</h1>
          <p className="ex-sub">Hacker News, official lab blogs, newsletters, new papers and open-source repos in one place.{data ? ` Updated ${updated}.` : ""}</p>
        </div>
        <button type="button" className={"btn ex-refresh" + (refreshing ? " is-busy" : "")} onClick={() => void doRefresh()} disabled={refreshing} aria-busy={refreshing}><Ico d={P.refresh} size={16} /> {refreshing ? "Refreshing" : "Refresh"}</button>
      </header>

      <div className="ex-bar" role="group" aria-label="Filter stories">
        <div className="ex-chips">
          {GROUPS.filter((x) => x.id === "all" || counts[x.id]).map((x) => (
            <button key={x.id} type="button" className={"fchip" + (!onlySaved && g === x.id ? " on" : "")} aria-pressed={!onlySaved && g === x.id} onClick={() => { setP("saved", null); setP("g", x.id === "all" ? null : x.id); }}>
              {x.label}<small>{counts[x.id] ?? 0}</small>
            </button>
          ))}
          <button type="button" className={"fchip" + (onlySaved ? " on" : "")} aria-pressed={onlySaved} onClick={() => setP("saved", onlySaved ? null : "1")}>Saved<small>{ns.saved.length}</small></button>
        </div>
        <PillSelect label="Sort" value={sort} options={[["top", "Trending"], ["latest", "Latest"]]} onChange={(v) => setP("sort", v === "top" ? null : v)} />
      </div>
      {hiddenSrc ? <p className="ex-muted">{hiddenSrc} {hiddenSrc === 1 ? "source is" : "sources are"} hidden. <button type="button" className="textlink" onClick={() => newsActions.unmuteAll()}>Show all sources</button></p> : null}

      <div className="ex-grid">
        <div className="ex-main" role="feed" aria-label="Stories">
          {error ? (
            <Empty title="News is not available right now">Could not load the latest stories ({error}). <button type="button" className="textlink" onClick={reload}>Try again</button></Empty>
          ) : !data ? (
            <div className="ex-skel" aria-busy="true" aria-label="Loading stories">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel-row"><i /><span><b /><b /><b /></span></div>)}</div>
          ) : list.length === 0 ? (
            <Empty title={onlySaved ? "Nothing saved yet" : "No stories here"}>{onlySaved ? "Press the bookmark on any story to keep it here." : "Pick another source above."}</Empty>
          ) : (
            <>
              {list.slice(0, shown).map((n, i) => {
                const day = sort === "latest" ? dayLabel(n.ts) : "";
                const head = day && day !== lastDay ? <h2 key={"d" + day} className="day-head">{day}</h2> : null;
                lastDay = day || lastDay;
                return (
                  <div key={n.id}>
                    {head}
                    <Story n={n} big={i === 0 && sort === "top" && !onlySaved} saved={ns.saved.includes(n.id)} read={ns.read.includes(n.id)} isNew={seen > 0 && n.ts * 1000 > seen} />
                  </div>
                );
              })}
              {list.length > shown ? <button type="button" className="more" onClick={() => setShown((s) => s + 20)}>Show {Math.min(20, list.length - shown)} more</button> : <p className="end">You are all caught up.</p>}
            </>
          )}
        </div>

        <aside className="ex-side" aria-label="Highlights">
          <Rail title="Trending now" sub="Most talked about in the last day or two" items={trending} numbered />
          <Rail title="Fresh from the labs" items={labs} />
          <Rail title="Papers worth a look" sub="Most upvoted on Hugging Face today" items={papers} />
          <Rail title="New open-source repos" sub="Created this week, ranked by stars" items={repos} />
          {data ? <p className="side-note">Sources: {data.sources.filter((s) => s.ok && s.count).length} live feeds. Refreshed about every 2 hours. Reddit blocks automated access, so it is not included.</p> : null}
        </aside>
      </div>
    </div>
  );
}

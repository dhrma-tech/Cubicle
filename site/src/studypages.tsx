import { useEffect, useMemo, useState } from "react";
import type { Video } from "./types";
import { useStore } from "./store";
import { fmtDur, LEVEL_NAME, pathOrder, type Data } from "./data";
import { Empty, go, Thumb, toast } from "./components";
import { PageHead, Progress, TRACKS } from "./views";
import { dueReviews, fmtHM, lastDays, REVIEW_DAYS, study, useStudy, type Plan, type Study } from "./study";
import { openAI } from "./aistate";
import { dayKey, streakOf, useScrollState } from "./proscroll";

const DAY = 86400000;
const secOf = (v: Video) => v.d || 600;

function MiniRow({ v, children, done }: { v: Video; children?: React.ReactNode; done?: boolean }) {
  return (
    <li className={"mrow" + (done ? " is-done" : "")}>
      <a className="mrow-a" href={`#/watch/${v.i}`}><Thumb v={v} /><span className="mrow-t">{v.t}<small>{v.c} · {LEVEL_NAME[v.l]}{v.d ? ` · ${fmtDur(v.d)}` : ""}</small></span></a>
      {children ? <span className="mrow-x">{children}</span> : null}
    </li>
  );
}

/** Greedy fit of videos (in order) into a minute budget. The first video is always kept. */
export function fit(vs: Video[], minutes: number) {
  const out: Video[] = []; let t = 0;
  for (const v of vs) { if (out.length && t + secOf(v) > minutes * 60) continue; out.push(v); t += secOf(v); if (t >= minutes * 60) break; }
  return out;
}

/* ============================== Queue ============================== */
export function QueuePage({ data }: { data: Data }) {
  const s = useStudy();
  const st = useStore();
  const vids = s.queue.map((id) => data.byId.get(id)).filter((v): v is Video => !!v);
  const total = vids.reduce((a, v) => a + secOf(v), 0);
  const [mins, setMins] = useState(30);
  return (
    <div className="page">
      <PageHead title="Up next" sub="Your queue. It plays in order and moves on by itself when a video ends.">
        {vids.length ? <button className="btn btn-primary" type="button" onClick={() => go(`/watch/${vids[0].i}`)}>Play queue</button> : null}
      </PageHead>
      {vids.length === 0 ? (
        <Empty title="The queue is empty">Add videos with “Add to Up next” on a watch page or in a card menu, or pull in your Watch later list.</Empty>
      ) : (
        <>
          <p className="q-sum"><b>{vids.length}</b> {vids.length === 1 ? "video" : "videos"}, <b>{fmtHM(total)}</b> in total</p>
          <ol className="mrow-list">
            {vids.map((v, i) => (
              <MiniRow key={v.i} v={v}>
                <button type="button" className="ghost" onClick={() => study.moveQueue(v.i, -1)} disabled={i === 0} aria-label="Move up">Up</button>
                <button type="button" className="ghost" onClick={() => study.moveQueue(v.i, 1)} disabled={i === vids.length - 1} aria-label="Move down">Down</button>
                <button type="button" className="ghost" onClick={() => study.dequeue(v.i)}>Remove</button>
              </MiniRow>
            ))}
          </ol>
        </>
      )}
      <section className="panel">
        <h2>Tools</h2>
        <div className="row-tools">
          <label className="switch"><input type="checkbox" checked={s.autoNext} onChange={(e) => study.setAutoNext(e.target.checked)} /> Play the next video automatically</label>
        </div>
        <div className="row-tools">
          <span>Fit the queue to</span>
          {[15, 30, 60, 90].map((m) => <button key={m} type="button" className={"fchip" + (mins === m ? " on" : "")} onClick={() => setMins(m)}>{m} min</button>)}
          <button type="button" className="btn" disabled={!vids.length} onClick={() => { const k = fit(vids, mins); study.setQueue(k.map((v) => v.i)); toast(`Kept ${k.length} of ${vids.length} videos`); }}>Trim</button>
        </div>
        <div className="row-tools">
          <button type="button" className="btn" disabled={!st.later.length} onClick={() => { st.later.slice().reverse().forEach((id) => study.enqueue(id)); toast("Added your Watch later list"); }}>Add everything from Watch later</button>
          <button type="button" className="btn" disabled={!vids.length} onClick={() => { study.setQueue([]); }}>Clear queue</button>
        </div>
      </section>
    </div>
  );
}

/* ============================== Plan ============================== */
export function buildPlan(data: Data, source: string, perDay: number, done: Record<string, number>): Plan {
  let nodeIds: string[] = []; let goal = "";
  const tr = TRACKS.find((t) => t.id === source);
  const sec = data.sections.find((x) => x.id === source);
  if (tr) { nodeIds = tr.nodes; goal = tr.title; } else if (sec) { nodeIds = sec.nodes.map((n) => n.id); goal = sec.title; }
  else { nodeIds = data.sections.flatMap((x) => x.nodes.map((n) => n.id)); goal = "Full syllabus"; }
  const items: { id: string }[] = [];
  for (const id of nodeIds) {
    const vs = (data.byNode.get(id) || []).filter((v) => !v.o && !done[v.i]).sort(pathOrder).slice(0, tr || sec ? 3 : 2);
    vs.forEach((v) => items.push({ id: v.i }));
  }
  return { goal, items, created: Date.now(), perDay };
}

export function planDays(data: Data, plan: Plan, done: Record<string, number>) {
  const days: Video[][] = []; let cur: Video[] = []; let t = 0;
  for (const it of plan.items) {
    const v = data.byId.get(it.id); if (!v || done[v.i]) continue;
    if (cur.length && t + secOf(v) > plan.perDay * 60) { days.push(cur); cur = []; t = 0; }
    cur.push(v); t += secOf(v);
  }
  if (cur.length) days.push(cur);
  return days;
}

export function PlanPage({ data }: { data: Data }) {
  const s = useStudy();
  const st = useStore();
  const [src, setSrc] = useState("ai");
  const [per, setPer] = useState(30);
  const plan = s.plan;
  const days = useMemo(() => (plan ? planDays(data, plan, st.done) : []), [plan, data, st.done]);
  const total = plan ? plan.items.filter((i) => data.byId.has(i.id)).length : 0;
  const doneN = plan ? plan.items.filter((i) => st.done[i.id]).length : 0;
  return (
    <div className="page">
      <PageHead title="Study plan" sub="A path through the catalogue, cut into days that fit the time you have." />
      {plan ? (
        <>
          <section className="panel">
            <h2>{plan.goal}</h2>
            <p className="track-prog"><Progress done={doneN} total={total} /> {doneN}/{total} done, about {days.length} {days.length === 1 ? "day" : "days"} left at {plan.perDay} min a day</p>
            <div className="row-tools">
              <span>Minutes per day</span>
              {[15, 30, 60, 90].map((m) => <button key={m} type="button" className={"fchip" + (plan.perDay === m ? " on" : "")} onClick={() => study.setPlan({ ...plan, perDay: m })}>{m}</button>)}
              <button type="button" className="btn" onClick={() => { study.setQueue(days[0]?.map((v) => v.i) || []); if (days[0]) go(`/watch/${days[0][0].i}`); }} disabled={!days.length}>Queue today and start</button>
              <button type="button" className="btn" onClick={() => openAI(`Look at my study plan "${plan.goal}" (${doneN} of ${total} videos done, ${plan.perDay} minutes a day) and tell me what to change or what to do next.`)}>Ask AI to review it</button>
              <button type="button" className="btn" onClick={() => { study.setPlan(null); }}>Replace plan</button>
            </div>
          </section>
          {days.slice(0, 14).map((d, i) => (
            <section key={i} className="plan-day">
              <h3>{i === 0 ? "Today" : i === 1 ? "Tomorrow" : `Day ${i + 1}`} <small>{fmtHM(d.reduce((a, v) => a + secOf(v), 0))}</small></h3>
              <ol className="mrow-list">{d.map((v) => <MiniRow key={v.i} v={v} />)}</ol>
            </section>
          ))}
          {days.length > 14 ? <p className="muted">And {days.length - 14} more days after these.</p> : null}
          {days.length === 0 ? <Empty title="Plan complete">Every video in this plan is marked done. Pick a new goal.</Empty> : null}
        </>
      ) : (
        <section className="panel">
          <h2>Pick a goal</h2>
          <div className="plan-form">
            <label>Goal
              <select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="ai">Let AI design it from what I tell it</option>
                <optgroup label="Interview tracks">{TRACKS.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>
                <optgroup label="Sections">{data.sections.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</optgroup>
                <option value="all">Full syllabus, beginner first</option>
              </select>
            </label>
            <label>Time per day
              <select value={per} onChange={(e) => setPer(+e.target.value)}>{[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
            </label>
            {src === "ai" ? (
              <button type="button" className="btn btn-primary" onClick={() => openAI(`Build me a study plan. Ask me my goal, my current level and my deadline if you do not know them, then design it from the catalogue for ${per} minutes a day and save it with save_plan.`)}>Plan with AI</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => { study.setPlan(buildPlan(data, src, per, st.done)); }}>Build plan</button>
            )}
          </div>
          <p className="muted">Plans use the best-ranked videos per topic, beginner first, skipping anything you already marked done and anything flagged as outdated.</p>
        </section>
      )}
    </div>
  );
}

/* ============================== Today card (Home) ============================== */
export function TodayCard({ data }: { data: Data }) {
  const s = useStudy();
  const st = useStore();
  const sc = useScrollState();
  const due = dueReviews(s).length;
  const today = Object.values(s.log[dayKey()] || {}).reduce((a, b) => a + b, 0);
  const week = lastDays(s, 7).reduce((a, d) => a + d.sec, 0);
  const pool = useMemo(() => {
    const plan = s.plan ? planDays(data, s.plan, st.done).flat() : [];
    const q = s.queue.map((id) => data.byId.get(id)).filter((v): v is Video => !!v);
    return q.length ? q : plan;
  }, [s.plan, s.queue, data, st.done]);
  const picks = fit(pool, s.budget);
  const resume = st.history.map((h) => data.byId.get(h.id)).find((v) => v && s.resume[v.i] && !st.done[v.i]);
  if (!pool.length && !due && !week && !resume) {
    return (
      <aside className="today" aria-label="Today">
        <div><h2>Today</h2><p>Set a goal and DEV Tube will line up what to watch for the time you have.</p></div>
        <a className="btn btn-primary" href="#/plan">Build a study plan</a>
      </aside>
    );
  }
  return (
    <aside className="today" aria-label="Today">
      <div className="today-h">
        <h2>Today</h2>
        <span className="today-stats">{fmtHM(today)} studied today · {fmtHM(week)} this week{streakOf(sc.met) ? ` · ${streakOf(sc.met)} day Shorts streak` : ""}</span>
        <span className="today-bud" role="group" aria-label="Time available">
          {[15, 30, 60].map((m) => <button key={m} type="button" className={s.budget === m ? "on" : ""} aria-pressed={s.budget === m} onClick={() => study.setBudget(m)}>{m} min</button>)}
        </span>
      </div>
      <div className="today-b">
        {resume ? <a className="today-resume" href={`#/watch/${resume.i}`}>Resume: <b>{resume.t}</b> <small>from {fmtHM(s.resume[resume.i])}</small></a> : null}
        {picks.length ? (
          <>
            <ol className="mrow-list tight">{picks.slice(0, 4).map((v) => <MiniRow key={v.i} v={v} />)}</ol>
            <div className="row-tools">
              <button type="button" className="btn btn-primary" onClick={() => { study.setQueue(picks.map((v) => v.i)); go(`/watch/${picks[0].i}`); }}>Start ({picks.length} {picks.length === 1 ? "video" : "videos"}, {fmtHM(picks.reduce((a, v) => a + secOf(v), 0))})</button>
              {due ? <a className="btn" href="#/review">{due} to review</a> : null}
            </div>
          </>
        ) : due ? <a className="btn btn-primary" href="#/review">{due} {due === 1 ? "item" : "items"} to review</a> : <a className="btn" href="#/plan">Build a study plan</a>}
      </div>
    </aside>
  );
}

/* ============================== Review ============================== */
export function ReviewPage({ data }: { data: Data }) {
  const s = useStudy();
  const due = dueReviews(s);
  const upcoming = Object.entries(s.review).filter(([, r]) => r.due > Date.now()).sort((a, b) => a[1].due - b[1].due);
  const info = (id: string, r: { kind: "v" | "s"; title?: string }) => {
    const v = data.byId.get(id);
    return { title: v?.t || r.title || id, ch: v?.c || "Short", href: v ? `#/watch/${id}` : `https://www.youtube.com/shorts/${id}`, ext: !v };
  };
  return (
    <div className="page">
      <PageHead title="Review" sub={`Videos you marked done and Shorts you marked "Got it" come back after ${REVIEW_DAYS.join(", ")} days, so they stick.`} />
      {due.length === 0 ? (
        <Empty title={upcoming.length ? "Nothing due" : "Nothing to review yet"}>{upcoming.length ? `Next review in ${Math.max(1, Math.ceil((upcoming[0][1].due - Date.now()) / DAY))} days.` : "Mark a video as done and it will be scheduled here."}</Empty>
      ) : (
        <ul className="rev-list">
          {due.map((r) => {
            const i = info(r.id, r);
            return (
              <li key={r.id} className="rev-card">
                <div className="rev-t">
                  <a href={i.href} {...(i.ext ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{i.title}</a>
                  <small>{i.ch} · review {r.stage + 1} of {REVIEW_DAYS.length}</small>
                </div>
                <div className="rev-a">
                  <button type="button" className="btn" onClick={() => openAI(`Quiz me on "${i.title}" (${i.ch}). Ask one question at a time, wait for my answer, then tell me what I missed.`)}>Quiz me with AI</button>
                  <button type="button" className="btn" onClick={() => { study.grade(r.id, false); }}>Forgot</button>
                  <button type="button" className="btn btn-primary" onClick={() => { study.grade(r.id, true); toast("Next review is scheduled"); }}>Remembered</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {upcoming.length ? (
        <section className="panel">
          <h2>Coming up</h2>
          <ul className="up-list">
            {upcoming.slice(0, 12).map(([id, r]) => <li key={id}><span>{info(id, r).title}</span><small>in {Math.max(1, Math.ceil((r.due - Date.now()) / DAY))} d</small></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ============================== Skills + weekly report ============================== */
function weekReport(s: Study, done: Record<string, number>, data: Data) {
  const days = lastDays(s, 14);
  const cur = days.slice(7).reduce((a, d) => a + d.sec, 0);
  const prev = days.slice(0, 7).reduce((a, d) => a + d.sec, 0);
  const since = Date.now() - 7 * DAY;
  const doneN = Object.values(done).filter((t) => t >= since).length;
  const bySec = new Map<string, number>();
  for (const d of days.slice(7)) for (const [k, v] of Object.entries(s.log[d.day] || {})) bySec.set(k, (bySec.get(k) || 0) + v);
  const top = [...bySec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, sec]) => ({ title: data.sections.find((x) => x.id === id)?.title || id, sec }));
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].sec > 0; i--) streak++;
  if (streak === 0 && days[days.length - 2]?.sec) for (let i = days.length - 2; i >= 0 && days[i].sec > 0; i--) streak++;
  return { days, cur, prev, doneN, top, streak };
}

export function SkillsPage({ data }: { data: Data }) {
  const s = useStudy();
  const st = useStore();
  const r = weekReport(s, st.done, data);
  const max = Math.max(60, ...r.days.map((d) => d.sec));
  const nodeStat = (nid: string) => { const vs = data.byNode.get(nid) || []; return { tot: vs.length, d: vs.filter((v) => st.done[v.i]).length }; };
  const gaps: { id: string; title: string; sec: string }[] = [];
  for (const sec of data.sections) {
    const stats = sec.nodes.map((n) => ({ n, ...nodeStat(n.id) })).filter((x) => x.tot > 0);
    const touched = stats.some((x) => x.d > 0);
    if (touched) stats.filter((x) => x.d === 0).slice(0, 3).forEach((x) => gaps.push({ id: x.n.id, title: x.n.title, sec: sec.title }));
  }
  const text = `DEV Tube weekly report\nStudied ${fmtHM(r.cur)} this week (${fmtHM(r.prev)} last week). ${r.doneN} videos finished. ${r.streak} day study streak.${r.top.length ? ` Most time: ${r.top.map((t) => `${t.title} ${fmtHM(t.sec)}`).join(", ")}.` : ""}`;
  const delta = r.cur - r.prev;
  return (
    <div className="page">
      <PageHead title="Skills and weekly report" sub="Where you have covered the syllabus, and how the last week went." />
      <section className="panel report">
        <h2>This week</h2>
        <div className="rep-nums">
          <div><b>{fmtHM(r.cur)}</b><span>studied{r.prev || r.cur ? ` (${delta >= 0 ? "+" : "-"}${fmtHM(Math.abs(delta))} vs last week)` : ""}</span></div>
          <div><b>{r.doneN}</b><span>videos finished</span></div>
          <div><b>{r.streak}</b><span>day study streak</span></div>
        </div>
        <div className="bars" role="img" aria-label="Minutes studied per day for the last 14 days">
          {r.days.map((d) => <i key={d.day} title={`${d.day}: ${fmtHM(d.sec)}`} style={{ height: `${Math.max(3, (d.sec / max) * 100)}%` }} className={d.sec ? "on" : ""} />)}
        </div>
        {r.top.length ? <p className="muted">Most time: {r.top.map((t) => `${t.title} (${fmtHM(t.sec)})`).join(", ")}.</p> : <p className="muted">Study time is counted while a video is actually playing on a watch page.</p>}
        <div className="row-tools">
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Report copied"), () => toast("Could not copy"))}>Copy summary</button>
          <button type="button" className="btn btn-primary" onClick={() => openAI(`${text}\n\nWhat should I focus on next week? Use my progress and the catalogue.`)}>Ask AI what next</button>
        </div>
      </section>
      <section className="skills">
        <h2>Syllabus coverage</h2>
        <p className="muted">Each square is a topic. Darker means more of its videos are done. Click one to open it.</p>
        {data.sections.map((sec) => (
          <div key={sec.id} className="sk-sec">
            <h3><a href={`#/s/${sec.id}`}>{sec.title}</a></h3>
            <div className="sk-grid">
              {sec.nodes.filter((n) => n.count > 0).map((n) => {
                const { tot, d } = nodeStat(n.id); const f = tot ? d / tot : 0;
                return <a key={n.id} href={`#/n/${n.id}`} className="sk-cell" style={{ ["--f" as string]: f }} title={`${n.title}: ${d}/${tot} done`}><span>{n.title}</span><small>{d}/{tot}</small></a>;
              })}
            </div>
          </div>
        ))}
        {gaps.length ? (
          <>
            <h2>Gaps</h2>
            <p className="muted">Topics with nothing done, inside sections you have already started.</p>
            <ul className="gap-list">{gaps.slice(0, 12).map((g) => <li key={g.id}><a href={`#/n/${g.id}`}>{g.title}</a> <small>{g.sec}</small></li>)}</ul>
          </>
        ) : null}
      </section>
    </div>
  );
}

/* ============================== Following ============================== */
export const newCount = (data: Data, s: Study, done: Record<string, number>) => {
  const since = dayKey(new Date(s.follows.seen));
  return followed(data, s, done).filter((v) => (v.p || "") > since).length;
};
function followed(data: Data, s: Study, done: Record<string, number>) {
  const ch = new Set(s.follows.channels), tp = new Set(s.follows.topics);
  if (!ch.size && !tp.size) return [];
  return data.videos.filter((v) => (ch.has(v.c) || tp.has(v.n)) && !done[v.i]).sort((a, b) => (b.p || "").localeCompare(a.p || "") || b.sc - a.sc);
}

export function FollowingPage({ data }: { data: Data }) {
  const s = useStudy();
  const st = useStore();
  const seenAtOpen = useMemo(() => dayKey(new Date(s.follows.seen)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => study.markSeen(), []);
  const feed = followed(data, s, st.done);
  const [pick, setPick] = useState("");
  const channels = useMemo(() => [...new Set(data.videos.map((v) => v.c))].sort(), [data]);
  const [chPick, setChPick] = useState("");
  return (
    <div className="page">
      <PageHead title="Following" sub="Channels and topics you follow. New videos from them show up here." />
      <section className="panel">
        <div className="follow-row">
          {s.follows.channels.map((c) => <button key={c} type="button" className="fchip on" onClick={() => study.toggleChannel(c)} title="Unfollow">{c} x</button>)}
          {s.follows.topics.map((t) => <button key={t} type="button" className="fchip on" onClick={() => study.toggleTopic(t)} title="Unfollow">{data.nodes.get(t)?.title || t} x</button>)}
          {!s.follows.channels.length && !s.follows.topics.length ? <span className="muted">Nothing followed yet.</span> : null}
        </div>
        <div className="row-tools">
          <select value={chPick} onChange={(e) => setChPick(e.target.value)} aria-label="Channel to follow"><option value="">Follow a channel...</option>{channels.filter((c) => !s.follows.channels.includes(c)).map((c) => <option key={c}>{c}</option>)}</select>
          <button type="button" className="btn" disabled={!chPick} onClick={() => { study.toggleChannel(chPick); setChPick(""); }}>Follow</button>
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Topic to follow"><option value="">Follow a topic...</option>{data.sections.map((sec) => <optgroup key={sec.id} label={sec.title}>{sec.nodes.filter((n) => n.count > 0 && !s.follows.topics.includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</optgroup>)}</select>
          <button type="button" className="btn" disabled={!pick} onClick={() => { study.toggleTopic(pick); setPick(""); }}>Follow</button>
        </div>
      </section>
      {feed.length ? (
        <>
          <h2 className="feed-h">New for you</h2>
          <ol className="mrow-list">
            {feed.slice(0, 40).map((v) => <MiniRow key={v.i} v={v}>{(v.p || "") > seenAtOpen ? <span className="new-b">New</span> : null}<button type="button" className="ghost" onClick={() => { study.enqueue(v.i); toast("Added to Up next"); }}>Queue</button></MiniRow>)}
          </ol>
        </>
      ) : <Empty title="Nothing here yet">Follow a channel or a topic and its videos you have not finished appear here, newest first.</Empty>}
    </div>
  );
}

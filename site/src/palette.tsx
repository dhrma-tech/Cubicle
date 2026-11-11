import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "./data";
import { actions, useStore } from "./store";
import { go, toast } from "./components";
import { openAI } from "./aistate";
import { study, useStudy } from "./study";
import { pomo } from "./focus";

interface Cmd { id: string; label: string; hint?: string; run: () => void }

const PAGES: [string, string][] = [
  ["Home", "/"], ["Explore", "/explore"], ["Pro-Scroll", "/scroll"], ["Syllabus", "/learn"], ["Interview prep", "/prep"], ["Most recommended", "/browse"],
  ["Study plan", "/plan"], ["Up next queue", "/queue"], ["Review", "/review"], ["Skills and weekly report", "/skills"], ["Following", "/following"],
  ["Liked", "/liked"], ["Watch later", "/later"], ["Playlists", "/playlists"], ["History", "/history"], ["Progress", "/progress"], ["Settings", "/settings"], ["How this works", "/about"],
];

export function Palette({ data, onClose }: { data: Data; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const st = useStore();
  const sy = useStudy();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const list = useMemo<Cmd[]>(() => {
    const t = q.trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    const out: Cmd[] = [];
    const act = (label: string, run: () => void, hint = "Action") => ({ id: "a:" + label, label, hint, run });
    const actionsList = [
      act("Toggle focus mode", () => study.setFocus(!sy.focus)),
      act("Start or pause focus timer", () => { pomo.start(); }),
      act("Reset focus timer", () => pomo.reset()),
      act("Switch theme: light", () => actions.setSettings({ theme: "light" })),
      act("Switch theme: dark", () => actions.setSettings({ theme: "dark" })),
      act("Switch theme: match system", () => actions.setSettings({ theme: "auto" })),
      act("Open Ask AI", () => openAI()),
      act("Clear Up next queue", () => { study.setQueue([]); toast("Queue cleared"); }),
    ];
    if (!t) {
      PAGES.slice(0, 11).forEach(([l, h]) => out.push({ id: "p:" + h, label: l, hint: "Page", run: () => go(h) }));
      return out.concat(actionsList.slice(0, 3));
    }
    PAGES.filter(([l]) => words.every((w) => l.toLowerCase().includes(w))).forEach(([l, h]) => out.push({ id: "p:" + h, label: l, hint: "Page", run: () => go(h) }));
    actionsList.filter((a) => words.every((w) => a.label.toLowerCase().includes(w))).forEach((a) => out.push(a));
    let n = 0;
    for (const nd of data.nodes.values()) {
      if (n >= 5) break;
      if (nd.count && words.every((w) => nd.title.toLowerCase().includes(w))) { out.push({ id: "n:" + nd.id, label: nd.title, hint: "Topic", run: () => go(`/n/${nd.id}`) }); n++; }
    }
    const vids = data.videos.filter((v) => !st.hidden.includes(v.i) && words.every((w) => (v.t + " " + v.c).toLowerCase().includes(w))).sort((a, b) => b.sc - a.sc).slice(0, 8);
    vids.forEach((v) => out.push({ id: "v:" + v.i, label: v.t, hint: v.c, run: () => go(`/watch/${v.i}`) }));
    out.push({ id: "ai", label: `Ask AI: ${q.trim()}`, hint: "Ask AI", run: () => openAI(q.trim()) });
    return out;
  }, [q, data, st.hidden, sy.focus]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { document.querySelector(".pal-i.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };

  return (
    <div className="dialog-wrap pal-wrap" role="presentation" onClick={onClose}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); run(list[sel]); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page, topic or video, or type a question for AI" aria-label="Command palette" />
        <ul role="listbox">
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} className={"pal-i" + (i === sel ? " on" : "")} onMouseMove={() => setSel(i)} onClick={() => run(c)}>
              <span>{c.label}</span><small>{c.hint}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

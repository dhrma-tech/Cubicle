import { useEffect, useState } from "react";
import type { Meta, Section, TNode, Video } from "./types";
import { onMineChange, userMine } from "./userdata";

export interface Data {
  videos: Video[];
  byId: Map<string, Video>;
  sections: Section[];
  nodes: Map<string, TNode & { section: string }>;
  byNode: Map<string, Video[]>; // path order: level then score
  bySection: Map<string, Video[]>;
  meta: Meta;
}

const LV = { b: 0, i: 1, a: 2 } as const;
export const pathOrder = (a: Video, b: Video) => LV[a.l] - LV[b.l] || b.sc - a.sc;

let cache: Promise<Data> | null = null;
let base: { videos: Video[]; sections: Section[]; meta: Meta } | null = null;
const listeners = new Set<(d: Data) => void>();

async function fetchJSON<T>(p: string): Promise<T> {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`Could not load ${p} (${r.status})`);
  return r.json();
}

function build(videos: Video[], sections: Section[], meta: Meta): Data {
  const byId = new Map(videos.map((v) => [v.i, v]));
  const nodes = new Map<string, TNode & { section: string }>();
  sections.forEach((s) => s.nodes.forEach((n) => nodes.set(n.id, { ...n, section: s.id })));
  const byNode = new Map<string, Video[]>();
  const bySection = new Map<string, Video[]>();
  for (const v of videos) {
    (byNode.get(v.n) ?? byNode.set(v.n, []).get(v.n)!).push(v);
    (bySection.get(v.s) ?? bySection.set(v.s, []).get(v.s)!).push(v);
  }
  byNode.forEach((a) => a.sort(pathOrder));
  bySection.forEach((a) => a.sort((x, y) => y.sc - x.sc));
  return { videos, byId, sections, nodes, byNode, bySection, meta: { ...meta, hasDuration: videos.some((v) => !!v.d) } };
}

export function loadData(): Promise<Data> {
  if (!cache) {
    cache = Promise.all([
      fetchJSON<Video[]>("./data/videos.json"),
      fetchJSON<{ sections: Section[] }>("./data/taxonomy.json"),
      fetchJSON<Meta>("./data/meta.json"),
    ]).then(([v, t, m]) => {
      base = { videos: v, sections: t.sections.filter((s) => s.count > 0).map((s) => ({ ...s, nodes: s.nodes.filter((n) => n.count > 0) })), meta: m };
      return build([...userMine(), ...v], base.sections, base.meta);
    });
  }
  return cache;
}

// videos the user added on the AI page are merged in and the catalogue is rebuilt
onMineChange(() => {
  if (!base) return;
  const d = build([...userMine(), ...base.videos], base.sections, base.meta);
  cache = Promise.resolve(d);
  listeners.forEach((f) => f(d));
});

export function useData(): { data: Data | null; error: string | null } {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadData().then(setData).catch((e) => setError(String(e.message || e)));
    listeners.add(setData);
    return () => { listeners.delete(setData); };
  }, []);
  return { data, error };
}

export const fmtDur = (s?: number) => {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export const LEVEL_NAME = { b: "Beginner", i: "Intermediate", a: "Advanced" } as const;
export const SHELF_NAME = { e: "Evergreen", s: "Changes over years", f: "Changes within months" } as const;

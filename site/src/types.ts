export type Level = "b" | "i" | "a";
export type Shelf = "e" | "s" | "f";

export interface Video {
  i: string; // youtube id
  t: string; // title
  c: string; // channel
  h?: string | null; // channel handle
  n: string; // node id
  s: string; // section id
  l: Level;
  sh: Shelf;
  sc: number; // rank score
  f: number; // freshness 0..1
  o: 0 | 1; // may be outdated
  hn: number; // distinct HN users
  rc: number; // HN recommending comments
  sr: number; // curated sources
  src: string[];
  y: [number | null, number | null];
  ag: string; // age source: p published, t title, m mention, u unknown
  d?: number; // seconds
  p?: string; // published date
  w?: [number, string]; // [HN comment id, snippet]
  u?: 1; // added by this user on the AI page (stored only in their browser)
}

export interface TNode { id: string; title: string; shelf: string; level: string; count: number }
export interface Section { id: string; title: string; blurb: string; count: number; nodes: TNode[] }
export interface Meta {
  built: string; videos: number; nodes: number; channels: number; hn_comments: number;
  ages: Record<string, number>; hasDuration?: boolean; year: number;
}

export interface Settings { thumb: "mid" | "default"; hideOutdated: boolean; theme: "auto" | "light" | "dark"; preview: boolean }
export interface State {
  liked: string[];
  later: string[];
  history: { id: string; ts: number }[];
  done: Record<string, number>;
  hidden: string[];
  mutedChannels: string[];
  introDismissed: boolean;
  settings: Settings;
}

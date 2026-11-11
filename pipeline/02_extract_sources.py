"""Step 2: collect YouTube links from curated syllabi pages and GitHub roadmap/awesome lists
(data/seeds.json). These are an independent signal from HN: a video linked from a university
syllabus or a maintained roadmap counts as a separate source.
Output: data/raw/source_links.jsonl  (video links, with the anchor/context text)
        data/raw/source_playlists.json (playlist ids to expand with the YouTube API in step 4)
"""
import json, re, sys, requests, html
from collections import defaultdict
from common import DATA, RAW, video_ids, playlist_ids, load_json

HEAD = {"User-Agent": "devtube-pipeline/1.0 (+personal research project)"}
VID_CTX = re.compile(r"(.{0,140}?)((?:https?:)?//(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com/(?:watch\?[^\s\"'<>)\]]*|embed/[^\s\"'<>)\]]*|shorts/[^\s\"'<>)\]]*)|youtu\.be/[^\s\"'<>)\]]*))", re.S | re.I)


def fetch(url):
    try:
        r = requests.get(url, headers=HEAD, timeout=30)
        return r.text if r.status_code == 200 else None
    except Exception as e:
        print("  fetch error", url, str(e)[:80]); return None


def contexts(text):
    out = []
    for m in VID_CTX.finditer(text):
        ctx = re.sub(r"\s+", " ", re.sub(r"<[^>]+>|[\[\]()*#>|]", " ", m.group(1))).strip()[-110:]
        for v in video_ids(m.group(2)):
            out.append((v, ctx))
    return out


def main():
    seeds = load_json(DATA / "seeds.json")
    rows, playlists = [], defaultdict(set)
    for kind, key in (("github", "github_readmes"), ("syllabus", "syllabus_pages")):
        for s in seeds[key]:
            txt = fetch(s["url"])
            if txt is None:
                print("MISS", s["label"]); continue
            txt = html.unescape(txt)
            vs = contexts(txt); pls = playlist_ids(txt)
            for v, ctx in vs:
                rows.append({"source_type": kind, "source": s["label"], "video_id": v, "ctx": ctx})
            for p in pls:
                playlists[p].add(s["label"])
            print(f"OK   {s['label']}: {len(set(v for v,_ in vs))} videos, {len(pls)} playlists")
    with open(RAW / "source_links.jsonl", "w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (RAW / "source_playlists.json").write_text(json.dumps({k: sorted(v) for k, v in playlists.items()}, indent=1))
    print("videos rows:", len(rows), "unique:", len({r['video_id'] for r in rows}), "playlists:", len(playlists))


if __name__ == "__main__":
    main()

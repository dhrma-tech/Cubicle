"""Step 3: turn raw HN comments + curated source links into one row per video with
signal counts (independent sources), and pick which videos deserve a metadata lookup.

Signals per video:
  hn_authors     distinct HN users who linked it
  hn_mentions    comments linking it
  hn_rec         comments that read as recommendations ("must watch", "highly recommend"...)
  src_count      curated sources (syllabi / GitHub lists) linking it
  years          which years it was mentioned in (for recency + "still recommended")
Output: data/out/candidates.jsonl
"""
import glob, json, re, collections, datetime
import duckdb
from common import RAW, OUT, clean_html, video_ids, playlist_ids

REC = re.compile(r"\b(recommend|must[- ]watch|must[- ]see|highly|excellent|brilliant|fantastic|great (talk|video|lecture|series|course|explanation|intro)|best (talk|video|lecture|intro|explanation|course|resource)|worth (watching|a watch)|favou?rite|changed (my|how)|life[- ]changing|eye[- ]opening|gem\b|classic\b|watch this|go watch|check out)", re.I)
AI_CTX = re.compile(r"\b(machine learning|deep learning|neural|transformer|gpt|llm|language model|backprop|gradient|pytorch|tensorflow|reinforcement|ai\b|a\.i\.|embedding|attention|diffusion|algorithm|data structure|leetcode|dynamic programming|system design|distributed|compiler|python|rust|golang|linear algebra|calculus|probability|statistics|lecture|course|tutorial|talk|keynote|interview|mlops|cuda|gpu)\b", re.I)


def main():
    files = sorted(glob.glob(str(RAW / "hn" / "*.parquet")))
    print(len(files), "monthly files")
    con = duckdb.connect()
    vids = collections.defaultdict(lambda: {"authors": set(), "n": 0, "rec": 0, "years": collections.Counter(),
                                            "ctx": [], "ctx_ai": 0, "ids": [], "playlist_only": 0})
    rows = con.execute(f"SELECT id, time, author, text FROM read_parquet({files!r})").fetchall()
    print(len(rows), "comments with youtube links")
    for cid, t, author, text in rows:
        ids = video_ids(text)
        if not ids or len(ids) > 12:   # skip link-dump comments
            continue
        year = (t.year if hasattr(t, "year") else datetime.datetime.utcfromtimestamp(t).year)
        plain = re.sub(r"https?://\S+|(?:www\.)?youtu\.be/\S+|(?:www\.)?youtube\.com/\S+", "", clean_html(text))
        plain = re.sub(r"\s+", " ", plain).strip()
        is_rec = bool(REC.search(plain)); ai = bool(AI_CTX.search(plain))
        for v in ids:
            d = vids[v]
            d["authors"].add(author); d["n"] += 1; d["rec"] += is_rec; d["ctx_ai"] += ai
            d["years"][year] += 1
            if len(plain) >= 40 and not plain.startswith((">", "&gt;")) and len(d["ctx"]) < 4:
                if is_rec or not d["ctx"]:
                    d["ctx"].append({"id": cid, "text": plain[:400], "rec": bool(is_rec)})
    print(len(vids), "unique videos in HN")

    src = collections.defaultdict(lambda: {"sources": set(), "ctx": []})
    for fn in ("source_links.jsonl", "expanded_links.jsonl"):
        p = RAW / fn
        if not p.exists(): continue
        for line in p.open(encoding="utf-8"):
            r = json.loads(line)
            s = src[r["video_id"]]; s["sources"].add(r["source"])
            if r["ctx"] and len(s["ctx"]) < 2: s["ctx"].append(r["ctx"])
    print(len(src), "unique videos in curated sources")

    out, keep = open(OUT / "candidates.jsonl", "w", encoding="utf-8"), 0
    for v in set(vids) | set(src):
        h = vids.get(v); s = src.get(v)
        a = len(h["authors"]) if h else 0
        n_src = len([x for x in s["sources"] if not x.startswith("channel:")]) if s else 0
        n_chan = len([x for x in s["sources"] if x.startswith("channel:")]) if s else 0
        rec = h["rec"] if h else 0
        ctx_ai = h["ctx_ai"] if h else 0
        # lookup budget gate: broadly mentioned, recommended, from a curated source, or AI-ish context
        if not (n_src >= 1 or n_chan >= 1 or a >= 3 or (a >= 2 and (rec >= 1 or ctx_ai >= 1)) or (rec >= 1 and ctx_ai >= 1)):
            continue
        keep += 1
        out.write(json.dumps({
            "id": v,
            "hn_authors": a, "hn_mentions": h["n"] if h else 0, "hn_rec": rec,
            "years": dict(sorted(h["years"].items())) if h else {},
            "hn_ctx": h["ctx"] if h else [],
            "src_count": n_src, "sources": sorted(s["sources"]) if s else [],
            "src_ctx": s["ctx"] if s else [],
        }, ensure_ascii=False) + "\n")
    out.close()
    print("candidates for metadata lookup:", keep)


if __name__ == "__main__":
    main()

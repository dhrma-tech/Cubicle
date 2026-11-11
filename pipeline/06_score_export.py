"""Step 6: apply signal + freshness scoring, cap per node, export the site dataset and the
public data zip (with DATA.md for agents).  python 06_score_export.py [--cap 150] [--year 2026]
Reads: data/out/classified.jsonl, optional data/out/llm_labels.jsonl
Writes: site/public/data/{videos.json,taxonomy.json,meta.json}  and  site/public/devtube-data.zip
"""
import argparse, json, math, re, zipfile, datetime, collections
from common import ROOT, OUT, DATA, RAW, load_json, dump_json

HALF = {"evergreen": 10.0, "semi": 3.0, "fast": 1.0}
YEAR = re.compile(r"(?<!\d)(20[0-2]\d)(?!\d)")
LV = {"beginner": "b", "intermediate": "i", "advanced": "a"}
SH = {"evergreen": "e", "semi": "s", "fast": "f"}


def handle(url):
    m = re.search(r"/@([^/?#]+)", url or ""); return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cap", type=int, default=150); ap.add_argument("--year", type=int, default=datetime.date.today().year)
    a = ap.parse_args()
    tax = load_json(DATA / "taxonomy.json")
    node_meta = {n["id"]: {**n, "section": s["id"]} for s in tax["sections"] for n in s["nodes"]}
    llm = {}
    p = OUT / "llm_labels.jsonl"
    if p.exists():
        for l in p.open(encoding="utf-8"):
            r = json.loads(l); llm[r["id"]] = r
    rows = []
    for l in (OUT / "classified.jsonl").open(encoding="utf-8"):
        c = json.loads(l)
        if c["id"] in llm:
            x = llm[c["id"]]
            if not x.get("relevant", True): continue
            if x.get("node") in node_meta:
                c["node"] = x["node"]; c["section"] = node_meta[x["node"]]["section"]
            c["level"] = x.get("level", c["level"]); c["shelf"] = x.get("shelf", c["shelf"]); c["llm"] = 1
        # gate: independent signal required
        if not (c["hn_authors"] >= 2 or c["src_count"] >= 1 or c["trusted"]): continue
        if not (c["rule_score"] >= 3 or c["src_count"] or c["trusted"] or c.get("llm")): continue
        yrs = sorted(int(y) for y in c["years"]) if c["years"] else []
        first, last = (yrs[0], yrs[-1]) if yrs else (None, None)
        # age estimate: real publish date > year in title > first HN mention (lower bound)
        if c.get("published"):
            age = a.year - int(c["published"][:4]) + 0.5; agesrc = "published"
        else:
            ty = [int(y) for y in YEAR.findall(c["title"] or "") if int(y) <= a.year]
            if ty and node_meta[c["node"]]["shelf"] != "evergreen" or (ty and c["shelf"] != "evergreen"):
                age = a.year - max(ty) + 0.5; agesrc = "title"
            elif first:
                age = a.year - first + 0.5; agesrc = "mention"
            else:
                age = 2.0; agesrc = "unknown"
        fresh = 0.5 ** (age / HALF[c["shelf"]])
        outdated = c["shelf"] != "evergreen" and fresh < 0.4
        recent = sum(v for y, v in c["years"].items() if int(y) >= a.year - 2) if c["years"] else 0
        signal = (math.log1p(c["hn_authors"]) + 0.6 * math.log1p(c["hn_rec"]) + 2.0 * min(c["src_count"], 3)
                  + (1.5 if c["trusted"] else 0) + (0.4 if recent else 0))
        score = signal * (0.5 + 0.5 * fresh)
        why = None
        for h in sorted(c["hn_ctx"], key=lambda h: not h.get("rec")):
            t = re.sub(r"\s+", " ", h["text"]).strip()
            if len(t) >= 40 and h.get("rec") and "wikipedia" not in t.lower()[:30]:
                if len(t) > 170:
                    t = t[:170].rsplit(" ", 1)[0].rstrip(",;:-") + "…"
                why = [h["id"], t]; break
        v = {"i": c["id"], "t": c["title"], "c": c["channel"], "h": handle(c.get("channel_url")), "n": c["node"], "s": c["section"],
             "l": LV[c["level"]], "sh": SH[c["shelf"]], "sc": round(score, 2), "f": round(fresh, 2), "o": int(outdated),
             "hn": c["hn_authors"], "rc": c["hn_rec"], "sr": c["src_count"], "src": [x for x in c["sources"] if not x.startswith("channel:")][:3],
             "y": [first, last], "ag": agesrc[0]}
        if c.get("duration"): v["d"] = c["duration"]
        if c.get("published"): v["p"] = c["published"][:10]
        if why: v["w"] = why
        rows.append(v)
    # cap per node, keep best
    bynode = collections.defaultdict(list)
    for v in rows: bynode[v["n"]].append(v)
    final = []
    for nid, vs in bynode.items():
        vs.sort(key=lambda x: -x["sc"]); final += vs[: a.cap]
    # a video belongs to exactly one node; stable ordering
    final.sort(key=lambda x: (x["s"], x["n"], -x["sc"]))
    counts = collections.Counter(v["n"] for v in final)
    site = ROOT / "site" / "public"; (site / "data").mkdir(parents=True, exist_ok=True)
    tax_out = json.loads(json.dumps(tax))
    for s in tax_out["sections"]:
        for n in s["nodes"]:
            n["count"] = counts.get(n["id"], 0); n.pop("keywords", None)
        s["count"] = sum(n["count"] for n in s["nodes"])
    meta = {"built": datetime.date.today().isoformat(), "videos": len(final), "nodes": sum(1 for n in counts if counts[n]),
            "year": a.year, "cap_per_node": a.cap,
            "hn_comments": 275113, "ages": dict(collections.Counter(v["ag"] for v in final)), "hasDuration": any("d" in v for v in final),
            "channels": len({v["c"] for v in final})}
    dump_json(site / "data" / "videos.json", final); dump_json(site / "data" / "taxonomy.json", tax_out); dump_json(site / "data" / "meta.json", meta)
    # compact (no indent) copy for production
    (site / "data" / "videos.json").write_text(json.dumps(final, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_zip(site / "devtube-data.zip", final, tax_out, meta)
    print(json.dumps(meta)); print("top nodes:", counts.most_common(8))


DATA_MD = """# Cubicle data export

A curated catalogue of YouTube videos for AI / ML / AI engineering / programming / DSA / system design / job prep,
ranked by how many *independent* sources recommend each video. Hand this zip to your own coding agent
and ask for your own version (different taxonomy, scoring, UI).

## Files
- `videos.json`   final catalogue: array of video records (schema below)
- `taxonomy.json` syllabus tree: sections -> nodes (node.count = videos in the final catalogue)
- `meta.json`     build info
- `candidates.jsonl` (full pipeline output with all raw signals, per video)

## Video record (short keys)
| key | meaning |
|---|---|
| i | YouTube video id (`https://youtu.be/<i>`) |
| t / c / h | title / channel name / channel handle |
| n / s | taxonomy node id / section id |
| l | level: b=beginner i=intermediate a=advanced |
| sh | shelf life: e=evergreen s=semi-fresh f=fast-decaying |
| sc | final rank score (signal x freshness) |
| f / o | freshness 0..1 / 1 = flagged "may be outdated" |
| hn | distinct Hacker News users who linked it |
| rc | HN comments that read as recommendations |
| sr / src | number of curated sources (syllabi, GitHub lists) / their names |
| y | [first, last] year mentioned on HN |
| ag | how age was estimated: p=publish date, t=year in title, m=first HN mention (lower bound), u=unknown |
| d / p | duration seconds / publish date (only if the YouTube API enrichment step was run) |
| w | [HN comment id, short snippet] - why it was recommended. Link: `https://news.ycombinator.com/item?id=<id>` |

## Gotchas
- Age/freshness is an estimate unless `ag == "p"`.  Run `pipeline/04b_youtube_api.py` with a key for real dates/durations.
- HN data: Hugging Face `open-index/hacker-news` (ODC-By 1.0). Snippets are user comments; keep the link back to the comment.
- Thumbnails are not stored: use `https://i.ytimg.com/vi/<id>/hq2.jpg` (middle frame) or `hqdefault.jpg`.
- Videos can disappear: embedding was verified at build time via oEmbed only.
"""


def write_zip(path, final, tax, meta):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("DATA.md", DATA_MD)
        z.writestr("videos.json", json.dumps(final, ensure_ascii=False, separators=(",", ":")))
        z.writestr("taxonomy.json", json.dumps(tax, ensure_ascii=False, indent=1))
        z.writestr("meta.json", json.dumps(meta, indent=1))
        c = OUT / "classified.jsonl"
        if c.exists(): z.write(c, "candidates.jsonl")


if __name__ == "__main__":
    main()

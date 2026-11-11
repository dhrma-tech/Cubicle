"""Step 4b (needs a free YouTube Data API v3 key in env YT_API_KEY).  Quota: 10,000 units/day, every call here is 1 unit.
  python 04b_youtube_api.py expand   -> resolves the seed channels and expands playlists found in syllabi/GitHub lists
                                        into data/raw/expanded_links.jsonl (run BEFORE 03_merge.py)
  python 04b_youtube_api.py enrich   -> duration, publish date, description, tags, views, embeddable for all candidates
                                        into data/raw/youtube_meta.jsonl (run AFTER 03_merge.py / 04a_oembed.py)
"""
import argparse, json, os, re, sys, time, requests
from common import RAW, OUT, DATA, load_json

KEY = os.environ.get("YT_API_KEY")
API = "https://www.googleapis.com/youtube/v3"
units = 0
BUDGET = 9400


def call(ep, **params):
    global units
    if units >= BUDGET:
        raise SystemExit(f"stopping: quota budget {BUDGET} reached; rerun tomorrow (resumable)")
    for attempt in range(4):
        r = requests.get(f"{API}/{ep}", params={**params, "key": KEY}, timeout=30)
        if r.status_code == 200:
            units += 1; return r.json()
        if r.status_code in (403, 429) and "quota" in r.text.lower():
            raise SystemExit("YouTube quota exhausted for today; rerun tomorrow (resumable)")
        if r.status_code == 404: return None
        time.sleep(2 * (attempt + 1))
    return None


def iso_dur(s):
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m: return 0
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


def playlist_items(pl, pages):
    tok, out = None, []
    for _ in range(pages):
        j = call("playlistItems", part="snippet", playlistId=pl, maxResults=50, **({"pageToken": tok} if tok else {}))
        if not j: break
        for it in j.get("items", []):
            sn = it["snippet"]; vid = sn.get("resourceId", {}).get("videoId")
            if vid: out.append((vid, sn.get("title", "")))
        tok = j.get("nextPageToken")
        if not tok: break
    return out


def expand(a):
    seeds = load_json(DATA / "seeds.json")
    rows = []
    for ch in seeds["channels"]:
        j = call("channels", part="contentDetails,snippet", forHandle="@" + ch["handle"])
        if not j or not j.get("items"):
            print("channel not found:", ch["handle"]); continue
        up = j["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        items = playlist_items(up, a.channel_pages)
        for vid, title in items:
            rows.append({"source_type": "channel", "source": "channel:@" + ch["handle"], "video_id": vid, "ctx": title})
        print(f"channel @{ch['handle']}: {len(items)} videos", flush=True)
    pls = load_json(RAW / "source_playlists.json", {})
    skip = re.compile(a.skip_sources) if a.skip_sources else None
    for i, (pl, parents) in enumerate(pls.items()):
        if skip and all(skip.search(p) for p in parents): continue
        items = playlist_items(pl, 1)
        for vid, title in items:
            for par in parents:
                rows.append({"source_type": "playlist", "source": par, "video_id": vid, "ctx": title})
        if i % 100 == 0: print(f"playlists {i}/{len(pls)}  units={units}", flush=True)
    with (RAW / "expanded_links.jsonl").open("w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("expanded rows:", len(rows), "units used:", units)


def enrich(a):
    ids = [json.loads(l)["id"] for l in (OUT / "candidates.jsonl").open(encoding="utf-8")]
    cache = RAW / "youtube_meta.jsonl"; done = set()
    if cache.exists():
        done = {json.loads(l)["id"] for l in cache.open(encoding="utf-8")}
    todo = [i for i in ids if i not in done]
    print(f"{len(ids)} candidates, {len(done)} cached, {len(todo)} to fetch")
    with cache.open("a", encoding="utf-8") as f:
        for k in range(0, len(todo), 50):
            batch = todo[k:k + 50]
            j = call("videos", part="snippet,contentDetails,statistics,status", id=",".join(batch), maxResults=50)
            got = set()
            for it in (j or {}).get("items", []):
                sn, cd, st, stt = it["snippet"], it["contentDetails"], it.get("status", {}), it.get("statistics", {})
                got.add(it["id"])
                f.write(json.dumps({"id": it["id"], "title": sn.get("title"), "channel": sn.get("channelTitle"),
                                    "published": sn.get("publishedAt"), "duration": iso_dur(cd.get("duration")),
                                    "views": int(stt.get("viewCount", 0) or 0), "lang": sn.get("defaultAudioLanguage") or sn.get("defaultLanguage"),
                                    "desc": (sn.get("description") or "")[:500], "tags": (sn.get("tags") or [])[:15],
                                    "category": sn.get("categoryId"), "embeddable": st.get("embeddable", True)}, ensure_ascii=False) + "\n")
            for missing in set(batch) - got:   # deleted / private
                f.write(json.dumps({"id": missing, "embeddable": False, "gone": True}) + "\n")
            if (k // 50) % 20 == 0: print(f"  {k}/{len(todo)} units={units}", flush=True)
    print("enrich done, units used:", units)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("mode", choices=["expand", "enrich"])
    ap.add_argument("--channel-pages", type=int, default=4, help="pages of 50 uploads per seed channel")
    ap.add_argument("--skip-sources", default="EbookFoundation", help="regex of playlist parent sources to skip (saves quota)")
    a = ap.parse_args()
    if not KEY: sys.exit("Set YT_API_KEY first (free: Google Cloud Console -> enable YouTube Data API v3 -> API key)")
    {"expand": expand, "enrich": enrich}[a.mode](a)

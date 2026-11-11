"""Step 4a (no API key needed): title + channel + availability via YouTube oEmbed.
  200 -> ok (embeddable)   401 -> embedding disabled/private   404 -> deleted/unavailable
Resumable cache: data/raw/oembed.jsonl.   python 04a_oembed.py [--workers 16] [--limit N]
"""
import argparse, json, time, threading, concurrent.futures as cf, requests
from common import RAW, OUT

CACHE = RAW / "oembed.jsonl"
lock = threading.Lock()
S = threading.local()


def sess():
    if not hasattr(S, "s"):
        S.s = requests.Session(); S.s.headers["User-Agent"] = "devtube-pipeline/1.0"
    return S.s


def get(vid):
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
    for attempt in range(5):
        try:
            r = sess().get(url, timeout=15)
            if r.status_code == 200:
                j = r.json()
                return {"id": vid, "status": "ok", "title": j.get("title"), "channel": j.get("author_name"),
                        "channel_url": j.get("author_url")}
            if r.status_code in (401, 403):
                return {"id": vid, "status": "restricted"}
            if r.status_code == 404:
                return {"id": vid, "status": "gone"}
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1)); continue
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {"id": vid, "status": "error"}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--workers", type=int, default=16); ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    done = {}
    if CACHE.exists():
        for l in CACHE.open(encoding="utf-8"):
            r = json.loads(l)
            if r["status"] != "error": done[r["id"]] = r
    ids = [json.loads(l)["id"] for l in (OUT / "candidates.jsonl").open(encoding="utf-8")]
    todo = [i for i in ids if i not in done]
    if a.limit: todo = todo[:a.limit]
    print(f"{len(ids)} candidates, {len(done)} cached, {len(todo)} to fetch", flush=True)
    t0, n = time.time(), 0
    with CACHE.open("a", encoding="utf-8") as f, cf.ThreadPoolExecutor(a.workers) as ex:
        for r in ex.map(get, todo):
            f.write(json.dumps(r, ensure_ascii=False) + "\n"); n += 1
            if n % 500 == 0:
                f.flush(); print(f"  {n}/{len(todo)}  {n/(time.time()-t0):.1f}/s", flush=True)
    print("done", n, f"{time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()

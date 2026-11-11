"""Step 1: pull every HN comment that links YouTube, month by month, from the
open-index/hacker-news Parquet mirror on Hugging Face (queried remotely via DuckDB,
nothing is downloaded in full). Resumable: finished months are skipped.

  python pipeline/01_extract_hn.py [--workers 6] [--from 2007-01]
"""
import argparse, concurrent.futures as cf, time, sys
import duckdb
from huggingface_hub import list_repo_files
from common import RAW

REPO = "open-index/hacker-news"
OUTDIR = RAW / "hn"
OUTDIR.mkdir(parents=True, exist_ok=True)


def months():
    files = [f for f in list_repo_files(REPO, repo_type="dataset") if f.startswith("data/") and f.endswith(".parquet")]
    return sorted(files)


def do_month(path: str):
    name = path.split("/")[-1].replace(".parquet", "")
    out = OUTDIR / f"{name}.parquet"
    if out.exists():
        return name, "skip", 0
    for attempt in range(4):
        try:
            con = duckdb.connect()
            con.execute("INSTALL httpfs; LOAD httpfs;")
            src = f"hf://datasets/{REPO}/{path}"
            tmp = OUTDIR / f"{name}.tmp.parquet"
            con.execute(f"""
              COPY (
                SELECT id, time, "by" AS author, parent, text
                FROM read_parquet('{src}')
                WHERE type = 2
                  AND coalesce(deleted, false) = false AND coalesce(dead, false) = false
                  AND (text ILIKE '%youtube.com%' OR text ILIKE '%youtu.be%')
              ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
            """)
            n = con.execute(f"SELECT count(*) FROM read_parquet('{tmp}')").fetchone()[0]
            tmp.rename(out)
            return name, "ok", n
        except Exception as e:  # network hiccup -> retry
            time.sleep(3 * (attempt + 1))
            err = str(e)[:120]
    return name, f"fail: {err}", 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--from", dest="start", default="2006-01")
    a = ap.parse_args()
    todo = [p for p in months() if p.split("/")[-1][:7] >= a.start]
    print(f"{len(todo)} monthly files", flush=True)
    done = total = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for name, status, n in ex.map(do_month, todo):
            done += 1; total += n
            print(f"[{done}/{len(todo)}] {name} {status} {n}", flush=True)
    print("TOTAL youtube-linking comments:", total)

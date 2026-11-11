"""Run the whole pipeline in order.  Every step is resumable, so re-running is cheap.
  python run_all.py                    # no keys needed: HN + syllabi + oEmbed + rules  -> site data
  python run_all.py --api              # + YouTube API (needs YT_API_KEY): channels, playlists, durations, dates
  python run_all.py --api --llm        # + Haiku relabel pass (needs ANTHROPIC_API_KEY)
Then:  cd ../site && npm install && npm run build
"""
import argparse, subprocess, sys, os

ap = argparse.ArgumentParser()
ap.add_argument("--api", action="store_true"); ap.add_argument("--llm", action="store_true")
ap.add_argument("--skip-hn", action="store_true", help="reuse already extracted HN months")
a = ap.parse_args()
py = sys.executable

def run(*args):
    print("\n==>", " ".join(args), flush=True)
    r = subprocess.run([py, *args], cwd=os.path.dirname(os.path.abspath(__file__)))
    if r.returncode: sys.exit(r.returncode)

run("build_taxonomy.py")
if not a.skip_hn: run("01_extract_hn.py")
run("02_extract_sources.py")
if a.api: run("04b_youtube_api.py", "expand")
run("03_merge.py")
run("04a_oembed.py")
if a.api: run("04b_youtube_api.py", "enrich")
run("05_classify.py")
if a.llm: run("05b_llm_label.py")
run("06_score_export.py")
print("\nDone. Build the site:  cd ../site && npm install && npm run build")

"""Step 8: Pro-Scroll. Productive YouTube Shorts for AI / dev learners. No API key needed.

Source: every YouTube channel has a Shorts-only upload playlist whose id is the channel id with the
"UC" prefix swapped for "UUSH". Its public RSS feed (feeds/videos.xml?playlist_id=UUSH...) lists the 15
latest Shorts with title, date and view count.  Channels come from a hand-picked list plus the
channels already in the long-form catalogue.

Output: site/public/data/shorts.json
Run:    python pipeline/08_fetch_shorts.py        (about 2 minutes)
"""
import html, importlib, json, math, re, sys, time, datetime as dt, collections
from concurrent.futures import ThreadPoolExecutor
import requests
from common import ROOT, DATA, RAW

C = importlib.import_module("05_classify")           # reuse the OFFTOPIC / NEG / TECH filters
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
     "Accept-Language": "en-US,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"}

TRACKS = [("ai", "AI and LLMs"), ("code", "Coding tips"), ("dsa", "DSA and interviews"), ("math", "Math and theory"),
          ("sys", "Systems and infra"), ("career", "Career and startups"), ("focus", "Focus and study")]

# handle -> default track. Curated: trusted, so only the junk filter applies to them.
CURATED = {
    # AI news, models, agents
    "bycloudai": "ai", "TwoMinutePapers": "ai", "mreflow": "ai", "aiexplained-official": "ai", "matthew_berman": "ai",
    "TheAIGRID": "ai", "WesRoth": "ai", "AICodeKing": "ai", "AIJasonZ": "ai", "NateBJones": "ai", "AllAboutAI": "ai",
    "anthropic-ai": "ai", "OpenAI": "ai", "googledeepmind": "ai", "NVIDIA": "ai", "HuggingFace": "ai", "LangChain": "ai",
    "AndrewYNg": "ai", "Deeplearningai": "ai", "ycombinator": "career", "DwarkeshPatel": "ai", "LexClips": "ai",
    "krishnaik06": "ai", "campusx-official": "ai", "statquest": "math", "YannicKilcher": "ai", "CodeEmporium": "ai",
    "AssemblyAI": "ai", "sentdex": "ai", "Computerphile": "sys", "gregisenberg": "career",
    # coding and craft
    "Fireship": "code", "ThePrimeTimeagen": "code", "ThePrimeagen": "code", "t3dotgg": "code", "TechWithTim": "code",
    "WebDevSimplified": "code", "TraversyMedia": "code", "ArjanCodes": "code", "BenAwad97": "code", "CodeWithHarry": "code",
    "KunalKushwaha": "code", "NetworkChuck": "sys", "mCoding": "code", "NickChapsas": "code", "jherr2006": "code",
    # DSA and interviews
    "NeetCode": "dsa", "NeetCodeIO": "dsa", "takeUforward": "dsa", "ApnaCollegeOfficial": "dsa", "LoveBabbar": "dsa",
    "WilliamFiset-videos": "dsa", "BackToBackSWE": "dsa", "TechLead": "career", "exponent": "career",
    # systems
    "ByteByteGo": "sys", "gkcs": "sys", "hnasr": "sys", "DevOpsToolkit": "sys", "TechWorldwithNana": "sys",
    # math and theory
    "3blue1brown": "math", "Veritasium": "math", "numberphile": "math", "WelchLabsVideo": "math", "SabineHossenfelder": "math",
    # focus, study, productivity
    "aliabdaal": "focus", "Thomasfrank": "focus", "CalNewportMedia": "focus", "mattdavella": "focus", "JeffSu": "focus",
    "TheStudyBug": "focus", "JustinSung": "focus", "ThomasFrankExplains": "focus", "hubermanlabclips": "focus", "DanKoeTalks": "focus", "ScottHYoung": "focus", "MattPocockUk": "code", "DreamsofCode": "code", "CodingGarden": "code", "lennyspodcast": "career", "HarvardBusinessReview": "focus", "Elizabeth.Filips": "focus",
}
for _h in ("NetworkChuck", "Veritasium", "SabineHossenfelder", "mattdavella", "HarvardBusinessReview", "BenAwad97", "jherr2006", "WelchLabsVideo", "Elizabeth.Filips"):
    CURATED.pop(_h, None)          # general science / lifestyle / entertainment: not productive enough
BLOCK = {"siraj raval"}
# channels where every Short is on-topic, so a terse title still counts
PURE = {"bycloudai", "TwoMinutePapers", "ByteByteGo", "gkcs", "hnasr", "AICodeKing", "anthropic-ai", "OpenAI", "googledeepmind",
        "HuggingFace", "LangChain", "Deeplearningai", "CodeEmporium"}
REJECT = re.compile(r"(?<![a-z0-9])(giveaway|sponsor(?:ed)?|promo code|discount|use code|affiliate|subscribe now|prank|reaction|"
                    r"shorts? challenge|meme|funny|cringe|asmr|haul|unboxing|gossip|drama|roast|dating|astrology)(?![a-z0-9])", re.I)
TRK = [
    ("dsa", re.compile(r"leetcode|neetcode|data structure|dsa\b|big o|binary (search|tree)|linked list|dynamic programming|two pointers|sliding window|graph|recursion|coding interview|algorithm|hash ?map|heap\b|stack\b|queue\b")),
    ("sys", re.compile(r"system design|database|sql\b|redis|kafka|docker|kubernetes|k8s|distributed|load balanc|cache|caching|scal(e|ing)|latency|api\b|http|tcp|dns|linux|cloud|aws\b|gpu|cuda|infra|devops|ci/cd|microservice|queue")),
    ("math", re.compile(r"linear algebra|calculus|probabil|statistic|bayes|matrix|eigen|gradient|entropy|proof|theorem|prime numbers?|geometry|puzzle|math(s|ematics)?\b|information theory")),
    ("ai", re.compile(r"\bai\b|a\.i\.|llm|gpt|chatgpt|claude|gemini|llama|mistral|deepseek|qwen|grok|openai|anthropic|deepmind|neural|transformer|diffusion|agent|agentic|rag\b|embedding|fine-?tun|prompt|machine learning|deep learning|\bml\b|model|tokens?\b|inference|mcp\b|copilot|cursor|vibe cod")),
    ("career", re.compile(r"career|job|hired|hiring|resume|cv\b|salary|interview|offer|promotion|startup|founder|saas|freelanc|portfolio|internship|layoff|raise|pitch|side project|indie")),
    ("focus", re.compile(r"focus|deep work|productiv|study|habit|procrastinat|pomodoro|note-taking|take notes|second brain|obsidian|notion|learn(ing)? (faster|how|anything)|active recall|feynman|spaced|flashcard|burnout|routine|discipline|distraction|time block|morning")),
    ("code", re.compile(r"code|coding|programm|developer|python|javascript|typescript|rust\b|golang|\bgo\b|react|next\.?js|node|git\b|bug|debug|refactor|clean code|vim|vscode|terminal|regex|frontend|backend|software|engineer|web ?(dev|app|develop)|framework|library|open.source|github|clean code")),
]


def get(url, tries=3):
    for k in range(tries):
        try:
            r = requests.get(url, headers=H, timeout=25)
            if r.status_code == 200: return r
            if r.status_code in (404, 400): return None
        except requests.RequestException:
            pass
        time.sleep(1.5 * (k + 1))
    return None


def resolve(handle):
    r = get(f"https://www.youtube.com/@{handle}")
    if not r: return None
    m = re.search(r'"externalId":"(UC[\w-]{22})"', r.text) or re.search(r'channel_id=(UC[\w-]{22})', r.text)
    n = re.search(r'<meta property="og:title" content="([^"]+)"', r.text)
    return {"id": m.group(1), "name": (n.group(1) if n else handle)} if m else None


def feed(cid):
    r = get(f"https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH{cid[2:]}")
    out = []
    if not r: return out
    for e in r.text.split("<entry>")[1:]:
        g = lambda p: (re.search(p, e, re.S) or [None, None])[1]
        vid, title, pub, views = g(r"<yt:videoId>([\w-]{11})<"), g(r"<media:title>(.*?)</media:title>"), g(r"<published>(.*?)<"), g(r'<media:statistics views="(\d+)"')
        if vid and title and pub:
            out.append({"i": vid, "t": re.sub(r"\s+", " ", html.unescape(title)).strip(),
                        "p": pub[:10], "v": int(views or 0)})
    return out


def pick_track(title, hint):
    t = title.lower()
    for k, rx in TRK:
        if rx.search(t): return k
    return hint


def main():
    cache_f = DATA / "shorts_channels.json"      # tracked in git so CI does not re-resolve ~200 channel pages
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    # channels from the long-form catalogue: top by score, only those the pipeline already trusts enough to list
    vids = json.loads((ROOT / "site/public/data/videos.json").read_text())
    agg = collections.defaultdict(float)
    nm = {}
    for v in vids:
        if v.get("h"): agg[v["h"]] += v.get("sc", 0); nm[v["h"]] = v["c"]
    cat = [h for h, _ in sorted(agg.items(), key=lambda x: -x[1])[:140] if h.lower() not in {c.lower() for c in CURATED}]
    handles = [(h, t, True) for h, t in CURATED.items()] + [(h, None, False) for h in cat]
    todo = [h for h, _, _ in handles if h not in cache]
    print(f"{len(handles)} channels, resolving {len(todo)}", flush=True)
    with ThreadPoolExecutor(8) as ex:
        for h, r in zip(todo, ex.map(resolve, todo)): cache[h] = r
    cache_f.write_text(json.dumps(cache))
    ok = [(h, t, cur) for h, t, cur in handles if cache.get(h)]
    print(f"resolved {len(ok)}; missing: {[h for h, _, _ in handles if not cache.get(h)][:40]}", flush=True)

    with ThreadPoolExecutor(8) as ex:
        feeds = list(ex.map(lambda x: feed(cache[x[0]]["id"]), ok))

    today = dt.date.today()
    items, per_chan = [], {}
    for (h, hint, cur), fd in zip(ok, feeds):
        name = html.unescape(cache[h]["name"]).replace("AI News & Strategy Daily | Nate B Jones", "Nate B Jones").strip()
        if not fd: continue
        per_chan[h] = len(fd)
        med = sorted(x["v"] for x in fd)[len(fd) // 2] or 1
        for x in fd:
            tl = x["t"].lower()
            if REJECT.search(tl) or C.OFFTOPIC.search(tl) or C.NEG.search(tl): continue
            if x["v"] < (2000 if cur else 8000): continue
            if name.lower() in BLOCK: continue
            k = next((a for a, rx in TRK if rx.search(tl)), None)
            if k is None and h not in PURE: continue                # an on-topic title is required, a channel default is not enough
            if not cur and not C.TECH.search(tl): continue
            age = max(0, (today - dt.date.fromisoformat(x["p"])).days)
            if age > 900: continue
            fresh = 0.5 ** (age / 365)
            ratio = x["v"] / med
            sc = math.log10(x["v"] + 10) * (0.4 + 0.6 * fresh) + 0.5 * min(ratio, 4)
            items.append({"i": x["i"], "t": x["t"], "c": name, "h": h, "k": k or hint or "code",
                          "v": x["v"], "p": x["p"], "sc": round(sc, 3)})
    # dedupe, cap per channel, rank
    seen, by_c, out = set(), collections.Counter(), []
    for it in sorted(items, key=lambda x: -x["sc"]):
        if it["i"] in seen or by_c[it["h"]] >= 8: continue
        seen.add(it["i"]); by_c[it["h"]] += 1; out.append(it)
    out = out[:700]
    if len(out) < 100:                      # YouTube blocked us or the feeds changed: keep the last good file
        sys.exit(f"only {len(out)} Shorts found, not overwriting shorts.json")
    res = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "tracks": [{"id": a, "label": b} for a, b in TRACKS], "items": out}
    (ROOT / "site/public/data/shorts.json").write_text(json.dumps(res, separators=(",", ":")))
    print(f"wrote {len(out)} shorts from {len(by_c)} channels", dict(collections.Counter(i['k'] for i in out)))


if __name__ == "__main__":
    main()

"""Build site/public/data/news.json for the Explore page ("What's happening in AI").
Free sources only, no keys needed: Hacker News (Algolia), official lab blogs (RSS / sitemap),
Hugging Face daily papers, GitHub search, Lobsters. Reddit is tried but usually blocks servers.
Optional: GITHUB_TOKEN raises the GitHub search rate limit.   Run:  python 07_fetch_news.py
"""
import os, re, json, time, html, hashlib, email.utils, datetime as dt, xml.etree.ElementTree as ET
import concurrent.futures as cf
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "public", "data", "news.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; DEVTubeNews/1.0; +https://github.com/dhrma-tech/Dev-Tube)"}
NOW = time.time()
H = 3600

AI = re.compile(r"\b(ai|a\.i\.|llms?|gpt-?\d*|chatgpt|claude|anthropic|openai|gemini|deepmind|mistral|llama|qwen|deepseek|grok|copilot|"
                r"transformers?|diffusion|neural|machine learning|deep learning|reinforcement learning|nvidia|gpus?|cuda|tpus?|inference|"
                r"fine-?tun\w*|embeddings?|hugging ?face|pytorch|tensorflow|jax|mcp|agentic|language models?|open[- ]weights?|"
                r"sora|midjourney|alphafold|robotics|multimodal|rag|agents?)\b", re.I)
AI_STRICT = re.compile(r"\b(ai|a\.i\.|llms?|gpt-?\d*|chatgpt|claude|anthropic|openai|gemini|deepmind|mistral|llama|qwen|deepseek|grok|"
                       r"transformers?|diffusion models?|neural|machine learning|deep learning|nvidia|cuda|inference|fine-?tun\w*|"
                       r"hugging ?face|pytorch|tensorflow|mcp|agentic|ai agents?|language models?|open[- ]weights?|sora|midjourney|alphafold|robotics)\b", re.I)


def get(url, **kw):
    kw.setdefault("timeout", 25)
    h = dict(UA); h.update(kw.pop("headers", {}))
    return requests.get(url, headers=h, **kw)


def clean(s, n=210):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= n: return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(",;:.-")
    return cut + "…"


def norm(u):
    u = re.sub(r"^https?://(www\.)?", "", (u or "").strip().lower())
    u = re.sub(r"[?#].*$", "", u)
    return u.rstrip("/")


def mk(src, name, group, title, url, ts, sc=0, cm=0, cu=None, d="", author=None):
    return {"id": src + ":" + hashlib.md5(norm(url).encode()).hexdigest()[:10], "s": src, "sn": name, "g": group,
            "t": clean(title, 160), "u": url, "ts": int(ts), "sc": int(sc or 0), "cm": int(cm or 0), "cu": cu,
            "d": clean(d), "a": author}


# ---------------------------------------------------------------- Hacker News
def hacker_news():
    out, seen = [], set()
    qs = ["AI", "LLM", "GPT", "Claude", "OpenAI", "Anthropic", "Gemini", "machine learning", "neural network", "Nvidia", "AI agents", "DeepSeek", "Llama"]
    since = int(NOW - 72 * H)

    def one(q):
        r = get("https://hn.algolia.com/api/v1/search_by_date", params={"tags": "story", "query": q, "hitsPerPage": 40,
                "numericFilters": f"created_at_i>{since},points>25"})
        return r.json().get("hits", [])
    with cf.ThreadPoolExecutor(6) as ex:
        for hits in ex.map(one, qs):
            for h in hits:
                oid = h["objectID"]
                if oid in seen or not AI_STRICT.search(h.get("title") or ""): continue
                seen.add(oid)
                cu = f"https://news.ycombinator.com/item?id={oid}"
                out.append(mk("hn", "Hacker News", "hn", h["title"], h.get("url") or cu, h["created_at_i"],
                              h.get("points"), h.get("num_comments"), cu, "", h.get("author")))
    return out


# ---------------------------------------------------------------- RSS / Atom
def ptime(s):
    if not s: return None
    try: return email.utils.parsedate_to_datetime(s).timestamp()
    except Exception: pass
    try: return dt.datetime.fromisoformat(s.strip().replace("Z", "+00:00")).timestamp()
    except Exception: return None


def feed(src, name, group, url, days=14, limit=8, ai_only=False):
    r = get(url, allow_redirects=True); r.raise_for_status()
    root = ET.fromstring(r.content)
    tag = lambda e: e.tag.split("}")[-1]
    out = []
    for it in root.iter():
        if tag(it) not in ("item", "entry"): continue
        f = {}
        for c in it:
            t = tag(c)
            if t == "link" and c.get("href") and (c.get("rel") in (None, "alternate")): f.setdefault("link", c.get("href"))
            elif t == "link" and c.text: f.setdefault("link", c.text.strip())
            elif t in ("title", "pubDate", "published", "updated", "description", "summary", "encoded", "content", "creator", "author"): f.setdefault(t, "".join(c.itertext()) if len(c) else (c.text or ""))
        ts = ptime(f.get("pubDate") or f.get("published") or f.get("updated"))
        if not ts or NOW - ts > days * 24 * H or ts > NOW + H or not f.get("link") or not f.get("title"): continue
        if ai_only and not AI.search(f["title"]): continue
        body = f.get("description") or f.get("summary") or f.get("encoded") or f.get("content") or ""
        out.append(mk(src, name, group, f["title"], f["link"], ts, d=body, author=(f.get("creator") or f.get("author") or "").strip() or None))
    out.sort(key=lambda x: -x["ts"])
    return out[:limit]


FEEDS = [
    ("openai", "OpenAI", "labs", "https://openai.com/news/rss.xml", 14, 8, False),
    ("deepmind", "Google DeepMind", "labs", "https://deepmind.google/blog/rss.xml", 21, 6, False),
    ("googleai", "Google AI", "labs", "https://blog.google/technology/ai/rss/", 14, 6, False),
    ("googleresearch", "Google Research", "labs", "https://research.google/blog/rss/", 21, 5, False),
    ("msr", "Microsoft Research", "labs", "https://www.microsoft.com/en-us/research/feed/", 14, 5, True),
    ("nvidia", "NVIDIA", "labs", "https://blogs.nvidia.com/feed/", 10, 6, True),
    ("hf", "Hugging Face", "labs", "https://huggingface.co/blog/feed.xml", 21, 6, False),
    ("simon", "Simon Willison", "blogs", "https://simonwillison.net/atom/everything/", 7, 6, False),
    ("importai", "Import AI", "blogs", "https://importai.substack.com/feed", 21, 3, False),
    ("latentspace", "Latent Space", "blogs", "https://www.latent.space/feed", 21, 4, False),
]


def anthropic():
    t = get("https://www.anthropic.com/sitemap.xml").text
    ents = re.findall(r"<loc>(https://www\.anthropic\.com/(?:news|research|engineering)/[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", t)
    ents = [(u, ptime(m)) for u, m in ents]
    ents = sorted([e for e in ents if e[1] and NOW - e[1] < 21 * 24 * H], key=lambda e: -e[1])[:8]

    def one(e):
        u, lm = e
        p = get(u).text
        g = lambda k: (re.search(r'<meta property="%s" content="([^"]*)"' % k, p) or [None, ""])[1]
        title = html.unescape(g("og:title")); pub = ptime(g("article:published_time")) or lm
        if not title: return None
        d = g("og:description")
        if d.startswith("Anthropic is an AI safety and research company"): d = ""
        return mk("anthropic", "Anthropic", "labs", title, u, pub, d=d)
    with cf.ThreadPoolExecutor(4) as ex:
        return [x for x in ex.map(one, ents) if x]


# ---------------------------------------------------------------- research, repos, community
def papers():
    j = get("https://huggingface.co/api/daily_papers", params={"limit": 40}).json()
    out = []
    for x in j:
        p = x.get("paper") or {}
        ts = ptime(p.get("publishedAt") or x.get("publishedAt"))
        if not ts or not p.get("id"): continue
        out.append(mk("hfpapers", "Hugging Face Papers", "research", p.get("title") or x.get("title"), "https://huggingface.co/papers/" + p["id"],
                      ts, p.get("upvotes") or x.get("upvotes"), x.get("numComments"), None, p.get("summary") or x.get("summary") or "", None))
    out.sort(key=lambda x: -x["sc"])
    return out[:14]


def repos():
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=10)).strftime("%Y-%m-%d")
    h = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"): h["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    seen, out = set(), []
    for q in ["topic:llm", "topic:ai-agents", "topic:machine-learning", "topic:generative-ai", "topic:mcp"]:
        r = get("https://api.github.com/search/repositories", headers=h, params={"q": f"{q} created:>{since}", "sort": "stars", "per_page": 8})
        if r.status_code != 200: continue
        for x in r.json().get("items", []):
            if x["id"] in seen or x.get("fork"): continue
            seen.add(x["id"])
            out.append(mk("github", "GitHub", "repos", x["full_name"], x["html_url"], ptime(x["created_at"]), x["stargazers_count"], 0, None, x.get("description") or "", x["owner"]["login"]))
        time.sleep(1.2)
    out.sort(key=lambda x: -x["sc"])
    return out[:14]


def lobsters():
    out, seen = [], set()
    for tag in ("ai", "ml"):
        for x in get(f"https://lobste.rs/t/{tag}.json").json():
            ts = ptime(x["created_at"])
            if x["short_id"] in seen or NOW - ts > 4 * 24 * H: continue
            seen.add(x["short_id"])
            out.append(mk("lobsters", "Lobsters", "community", x["title"], x.get("url") or x["comments_url"], ts, x["score"], x["comment_count"], x["comments_url"], x.get("description_plain") or "", (x.get("submitter_user") or "")))
    return out


def reddit():
    out = []
    for sub in ("MachineLearning", "LocalLLaMA"):
        r = get(f"https://www.reddit.com/r/{sub}/top.json", params={"t": "day", "limit": 15})
        if r.status_code != 200: raise RuntimeError(f"reddit {r.status_code}")
        for c in r.json()["data"]["children"]:
            x = c["data"]
            out.append(mk("reddit", "r/" + sub, "community", x["title"], "https://www.reddit.com" + x["permalink"] if x.get("is_self") else x["url"], x["created_utc"],
                          x["score"], x["num_comments"], "https://www.reddit.com" + x["permalink"], x.get("selftext", ""), x.get("author")))
    return out


JOBS = [("hn", hacker_news), ("anthropic", anthropic), ("papers", papers), ("repos", repos), ("lobsters", lobsters), ("reddit", reddit)] + \
       [(f[0], (lambda f=f: feed(*f))) for f in FEEDS]


def main():
    items, status = [], []
    def run(j):
        name, fn = j
        try:
            r = fn(); return name, r, None
        except Exception as e:
            return name, [], f"{type(e).__name__}: {e}"[:120]
    with cf.ThreadPoolExecutor(8) as ex:
        for name, r, err in ex.map(run, JOBS):
            status.append({"id": name, "count": len(r), "ok": err is None, "error": err})
            items += r
            print(f"{name:14s} {len(r):3d}  {err or ''}")
    # merge Hacker News stats into the original post when a lab / blog is on HN
    by = {norm(i["u"]): i for i in items if i["g"] != "hn"}
    keep = []
    for i in items:
        if i["g"] == "hn" and norm(i["u"]) in by:
            t = by[norm(i["u"])]
            t["sc"] = max(t["sc"], i["sc"]); t["cm"] = max(t["cm"], i["cm"]); t["cu"] = t["cu"] or i["cu"]; t["hn"] = 1
        else: keep.append(i)
    # drop duplicates by URL and compute "hot"
    seen, final = set(), []
    for i in sorted(keep, key=lambda x: -x["ts"]):
        k = norm(i["u"])
        if k in seen: continue
        seen.add(k)
        base = {"hn": i["sc"] + 1.5 * i["cm"], "community": i["sc"] * 6 + i["cm"], "research": 20 + i["sc"] * 4, "repos": 20 + i["sc"] / 3,
                "labs": 140 + i["sc"] * 2, "blogs": 100 + i["sc"]}[i["g"]]
        age = max(1.0, (NOW - i["ts"]) / H)
        i["hot"] = round(base / (age + 2) ** 1.1, 2)
        final.append(i)
    final.sort(key=lambda x: -x["hot"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"updated": dt.datetime.fromtimestamp(NOW, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "items": final, "sources": status},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("items:", len(final), "->", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()

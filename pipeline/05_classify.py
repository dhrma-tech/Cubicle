"""Step 5: rule-based relevance + taxonomy labeling (works with no API at all).
For each candidate video it decides: is it a useful AI/ML/CS learning video, which taxonomy node,
level, and freshness class. 05b_llm_label.py can later overrule these labels with an LLM pass.
Output: data/out/classified.jsonl
"""
import json, re, collections
from common import RAW, OUT, DATA, load_json

TAX = load_json(DATA / "taxonomy.json")
SEEDS = load_json(DATA / "seeds.json")
TRUSTED = {c["handle"].lower(): c["hint"] for c in SEEDS["channels"]}

# --- keyword index ---------------------------------------------------------
NODES = {}
for s in TAX["sections"]:
    for n in s["nodes"]:
        NODES[n["id"]] = {**n, "section": s["id"]}
PATS = []  # (node_id, compiled, weight)
for nid, n in NODES.items():
    for kw in n["keywords"]:
        w = 1.0 + 0.5 * (len(kw.split()) - 1)
        PATS.append((nid, re.compile(r"(?<![a-z0-9])" + re.escape(kw.lower()) + r"s?(?![a-z0-9])"), w))

# nodes whose keywords are generic: need an independent tech signal to count
LOOSE = {"cs-craft","cs-security","cs-net","pp-talks", "pp-interviews", "cr-freelance", "cr-portfolio", "cr-behavioral", "cr-kaggle", "ae-projects",
         "pp-howto", "cr-roadmap", "sd-fundamentals", "tooling", "testing", "ae-roadmap"}
TECH = re.compile(r"(?<![a-z0-9])(ai|ml|a\.i\.|machine learning|deep learning|neural|llm|gpt|claude|gemini|model|models|algorithm|algorithms|data structure|python|rust|c\+\+|java|javascript|typescript|programming|programmer|coding|code|software|developer|engineer|engineering|compiler|database|distributed|system design|computer science|cs\d{2,3}|math|mathematics|linear algebra|statistics|gpu|cuda|kubernetes|docker|api|backend|frontend|leetcode|interview|data science|data scientist|kaggle|startup|saas|tensor|pytorch|transformer|embedding|rag|agent|agents)(?![a-z0-9])")
# videos about unrelated subjects that happen to share vocabulary
NEG = re.compile(r"(?<![a-z0-9])(startup sound|shutdown sound|boot sound|sound effect|mario kart|never gonna give you up|remix|trailer|movie|film|music video|official video|lyrics|gameplay|walkthrough of the game|minecraft|fortnite|cricket|football|nba|nfl|recipe|cooking|vlog|prank|asmr|tiktok|reaction|react to|news clip|full episode|standup|stand-up|snl|conan|trump|biden|election|politic|police|covid|vaccine|lockdown|bitcoin price|crypto pump)(?![a-z0-9])")
BEGIN = re.compile(r"(beginner|introduction|intro to|intro\b|crash course|basics|101|for dummies|getting started|from zero|explained simply|first steps|tutorial for)")
ADV = re.compile(r"(advanced|deep dive|in depth|in-depth|internals|from scratch|research|paper|state of the art|production|at scale|optimization|theory)")
FAST = re.compile(r"(gpt-?[3-9]|gpt4|claude|gemini|llama ?[2-9]|llama-?[2-9]|mistral|deepseek|qwen|grok|o1\b|o3\b|sonnet|opus|haiku|langchain|llamaindex|langgraph|crewai|autogen|cursor|copilot|windsurf|mcp\b|chatgpt|openai|anthropic|agentic|vibe cod|20(2[2-9])|ai agents?)")
AI_STRICT = re.compile(r"(?<![a-z0-9])(ai|a\.i\.|artificial intelligence|machine learning|deep learning|neural|llm|llms|gpt|chatgpt|openai|anthropic|claude|gemini|deepmind|transformer|diffusion|agi|robotics|self-driving)(?![a-z0-9])")
AI_ONLY = {"pp-interviews", "pp-explainers"}
YEAR = re.compile(r"(?<!\d)(20[0-2]\d)(?!\d)")


def handle(url):
    m = re.search(r"/@([^/?#]+)", url or "")
    return m.group(1).lower() if m else None


def classify(c, o, api=None):
    title = (o.get("title") or (api or {}).get("title") or "")
    chan = o.get("channel") or (api or {}).get("channel") or ""
    desc = ((api or {}).get("description") or "")[:500]
    tags = " ".join((api or {}).get("tags") or [])[:300]
    srcctx = " ".join(c.get("src_ctx") or [])
    tl = title.lower()
    body = f"{chan} {desc} {tags} {srcctx}".lower()
    if NEG.search(tl) and not c["src_count"]:
        return None
    scores = collections.Counter(); hits = collections.defaultdict(list)
    for nid, pat, w in PATS:
        if pat.search(tl):
            scores[nid] += 3 * w; hits[nid].append("t")
        elif body and pat.search(body):
            scores[nid] += 1 * w; hits[nid].append("b")
    h = handle(o.get("channel_url"))
    trusted_hint = TRUSTED.get(h or "")
    if trusted_hint:
        for nid, n in NODES.items():
            if n["section"] == trusted_hint and scores[nid]: scores[nid] += 0.5
    if not scores:
        return None
    ranked = scores.most_common(3)
    nid, sc = ranked[0]
    title_hit = "t" in hits[nid]
    tech = bool(TECH.search(tl)) or bool(TECH.search(body)) or bool(trusted_hint)
    if nid in LOOSE and not (tech and (title_hit or c["src_count"] or trusted_hint)):
        # try next best non-loose node
        alt = [(n2, s2) for n2, s2 in ranked[1:] if n2 not in LOOSE]
        if alt: nid, sc = alt[0]; title_hit = "t" in hits[nid]
        else: return None
    if not (title_hit or c["src_count"] or trusted_hint):  # body-only evidence is too weak
        return None
    if not tech:
        return None
    if nid in AI_ONLY and not (AI_STRICT.search(tl) or AI_STRICT.search(chan.lower()) or c["src_count"]):
        return None
    n = NODES[nid]
    level = n["level"]
    if BEGIN.search(tl): level = "beginner"
    elif ADV.search(tl) and level != "beginner": level = "advanced"
    shelf = n["shelf"]
    if FAST.search(tl) and shelf == "evergreen": shelf = "semi"
    if FAST.search(tl) and shelf == "semi" and re.search(r"(gpt|claude|gemini|llama|cursor|langchain|mcp|20(2[3-9]))", tl): shelf = "fast"
    second = ranked[1][1] if len(ranked) > 1 else 0
    return {"node": nid, "section": n["section"], "level": level, "shelf": shelf, "rule_score": round(sc, 2),
            "margin": round(sc - second, 2), "trusted": bool(trusted_hint)}


def main():
    cands = [json.loads(l) for l in (OUT / "candidates.jsonl").open(encoding="utf-8")]
    oem = {}
    for l in (RAW / "oembed.jsonl").open(encoding="utf-8"):
        r = json.loads(l); oem[r["id"]] = r
    api = {}
    p = RAW / "youtube_meta.jsonl"
    if p.exists():
        for l in p.open(encoding="utf-8"):
            r = json.loads(l); api[r["id"]] = r
    kept = 0; stat = collections.Counter()
    with (OUT / "classified.jsonl").open("w", encoding="utf-8") as f:
        for c in cands:
            o = oem.get(c["id"], {}); a = api.get(c["id"])
            st = o.get("status") or ("ok" if a else "missing")
            if a and a.get("embeddable") is False: st = "restricted"
            if st != "ok": stat[st] += 1; continue
            res = classify(c, o, a)
            if not res: stat["irrelevant"] += 1; continue
            row = {**c, **res, "title": o.get("title") or a.get("title"), "channel": o.get("channel") or a.get("channel"),
                   "channel_url": o.get("channel_url")}
            if a:
                for k in ("published", "duration", "views", "lang", "desc"): 
                    if k in a: row[k] = a[k]
            f.write(json.dumps(row, ensure_ascii=False) + "\n"); kept += 1; stat["kept"] += 1
    print(dict(stat))


if __name__ == "__main__":
    main()

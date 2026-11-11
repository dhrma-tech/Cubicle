"""Step 5b (optional, needs ANTHROPIC_API_KEY): LLM pass over the rule-classified videos to
 (1) drop videos that are not real learning/tech content, (2) fix the taxonomy node, level and freshness class.
Cheap by design: title + channel only, 40 videos per request, Haiku-class model. Resumable.
  python 05b_llm_label.py --dry-run            # token + cost estimate, no API calls
  python 05b_llm_label.py [--model claude-haiku-5-5] [--batch 40]
"""
import argparse, json, os, sys, time
from common import OUT, DATA, load_json

TAX = load_json(DATA / "taxonomy.json")
NODE_LIST = "\n".join(f"{n['id']}: {s['title']} > {n['title']} (typical level {n['level']}, shelf {n['shelf']})"
                      for s in TAX["sections"] for n in s["nodes"])
SYSTEM = f"""You label YouTube videos for Cubicle, a curated catalogue for people who want to become AI/ML engineers
(AI engineering, ML, deep learning, LLMs, programming, DSA, CS foundations, system design, MLOps, interview/job prep).

For each input line `id | title | channel | rule_guess` return one JSON object. Output ONLY a JSON array, one object per input, same order:
{{"id": str, "relevant": bool, "node": str, "level": "beginner|intermediate|advanced", "shelf": "evergreen|semi|fast"}}

relevant=false when the video is NOT useful learning/career material for that audience (entertainment, news, politics, music, demos with no teaching value,
sound/clip videos, unrelated hobby content, generic business/startup talk without an AI/engineering angle).
node must be one of the ids below; fix the rule_guess when wrong.
shelf: evergreen = fundamentals that do not age (math, DSA, core ML, transformer internals); semi = tooling/libraries that change in years;
fast = specific model/product/framework versions, prices, news that go stale in months.

NODES:
{NODE_LIST}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="claude-haiku-5-5"); ap.add_argument("--batch", type=int, default=40)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    rows = [json.loads(l) for l in (OUT / "classified.jsonl").open(encoding="utf-8")]
    outp = OUT / "llm_labels.jsonl"; done = set()
    if outp.exists(): done = {json.loads(l)["id"] for l in outp.open(encoding="utf-8")}
    todo = [r for r in rows if r["id"] not in done]
    toks_in = len(SYSTEM) // 4 * (len(todo) // a.batch + 1) + sum(len(f"{r['id']}|{r['title']}|{r['channel']}|{r['node']}") // 3 for r in todo)
    toks_out = len(todo) * 28
    print(f"{len(todo)} videos to label in {len(todo)//a.batch+1} requests ~{toks_in:,} input tokens (system prompt repeated; cache it) and ~{toks_out:,} output tokens")
    if a.dry_run: return
    if not os.environ.get("ANTHROPIC_API_KEY"): sys.exit("Set ANTHROPIC_API_KEY (console.anthropic.com, billed separately from Claude Pro)")
    import anthropic
    cl = anthropic.Anthropic()
    with outp.open("a", encoding="utf-8") as f:
        for k in range(0, len(todo), a.batch):
            b = todo[k:k + a.batch]
            msg = "\n".join(f"{r['id']} | {r['title']} | {r['channel']} | {r['node']}" for r in b)
            for attempt in range(3):
                try:
                    resp = cl.messages.create(model=a.model, max_tokens=4000, temperature=0,
                        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                        messages=[{"role": "user", "content": msg}])
                    txt = resp.content[0].text.strip()
                    txt = txt[txt.index("["): txt.rindex("]") + 1]
                    arr = json.loads(txt)
                    ids = {r["id"] for r in b}
                    for o in arr:
                        if o.get("id") in ids: f.write(json.dumps(o, ensure_ascii=False) + "\n")
                    break
                except Exception as e:
                    print("  retry", attempt, str(e)[:100]); time.sleep(3 * (attempt + 1))
            f.flush(); print(f"  {k+len(b)}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()

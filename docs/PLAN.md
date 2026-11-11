# DEV Tube: build plan (single release)

Status as of 2026-11-11: pipeline and site are built and tested end to end on real data. Two optional inputs would deepen the catalogue (YouTube API key, Anthropic API key). Everything else is done.

## 1. Goal and scope
One complete product, no versions: a HackerTube-style catalogue for **AI engineers and AI/ML engineers**, covering everything needed to learn and to get hired:
programming, DSA and coding interviews, math for ML, classical ML, deep learning, LLM internals, AI engineering, MLOps and inference, CS foundations, system design, papers and talks, job prep.
A video is included only if independent people or lists vouch for it. No accounts; all state is local to the browser.

## 2. Product spec
| Area | Behaviour |
|---|---|
| Syllabus | 12 sections, 104 topics. Each topic lists videos in learning order (beginner, then intermediate, then advanced, best first). |
| Interview prep | 6 tracks (coding, ML theory, AI/LLM engineer, system design, CS fundamentals, portfolio and hiring) assembled from topics, with per-track progress and a "start with" pick per topic. |
| Vouch strip | Up to 5 amber dots + text: how many Hacker News users and course lists recommend the video. |
| Freshness | Bar under each thumbnail. Hatched amber plus "May be outdated" when a fast-changing topic's video is old. Evergreen topics never get flagged. |
| For you | Client-side: affinity from likes, done and history; excludes seen videos; max 1 per topic for diversity; daily jitter. |
| Local state | Liked, Watch later, History, Done (progress), settings. Export / import / erase. |
| Thumbnails | Middle frame (`hq2.jpg`), setting to switch back to the uploader's. |
| Longs | Appears when duration data exists (YouTube API step). |
| Keyboard | `/` search, `j`/`k`, `Enter`, `l` like, `w` later, `d` done, `g h/s/p`, `?` help. |
| Data export | `devtube-data.zip` with `DATA.md` written for coding agents. |
| Quality floor | Responsive, light/dark, visible focus, reduced motion, skip link, aria on toggles and progress. |

## 3. Signals and scoring
Per video: `hn_authors` (distinct HN users), `hn_rec` (comments that read as recommendations), `src_count` (distinct syllabi / GitHub lists / playlists), trusted-channel flag, mention years.

```
signal = ln(1+hn_authors) + 0.6*ln(1+hn_rec) + 2.0*min(src_count,3) + 1.5*trusted + 0.4*[mentioned in last 3 years]
freshness = 0.5 ^ (age_years / half_life)      half_life: evergreen 10y, semi 3y, fast 1y
score = signal * (0.5 + 0.5*freshness)
may be outdated = shelf != evergreen and freshness < 0.4
```
Age source, best first: real publish date (API) > year in title > first HN mention (lower bound). The UI states which one was used.
Gate: needs `hn_authors >= 2`, or a course list, or a trusted channel; plus a taxonomy keyword hit in the title (or curated source). Cap 150 per topic.

## 4. Pipeline (all steps resumable; code in `pipeline/`)
| Step | Script | What it does | Result so far |
|---|---|---|---|
| 0 | `build_taxonomy.py` | Writes `data/taxonomy.json` (12 sections, 104 nodes, keywords, level, freshness class). | done |
| 1 | `01_extract_hn.py` | DuckDB over `open-index/hacker-news` Parquet on Hugging Face, month by month, no full download. | 239 months, 275,113 YouTube-linking comments, 5 min |
| 2 | `02_extract_sources.py` | YouTube links and playlists from syllabi and GitHub lists (`data/seeds.json`). | 597 videos, 1,522 playlists |
| 4b expand | `04b_youtube_api.py expand` | Resolves 26 seed channels and expands playlists. Needs API key. | waiting on key |
| 3 | `03_merge.py` | One row per video with signals; lookup-budget gate. | 185,521 unique videos -> 24,972 candidates |
| 4a | `04a_oembed.py` | Title, channel, availability (200 / 401 restricted / 404 gone). No key. | 24,972 looked up in 75 s |
| 4b enrich | `04b_youtube_api.py enrich` | Duration, publish date, description, tags, views, embeddable. Needs key. | waiting on key |
| 5 | `05_classify.py` | Rule classifier: topic node, level, freshness class, relevance. | 1,039 kept |
| 5b | `05b_llm_label.py` | Optional Haiku pass: drop non-learning videos, fix topic/level/freshness. 40 titles per request, cached system prompt. | ~110k input tokens for the current set |
| 6 | `06_score_export.py` | Scores, freshness, per-topic cap, writes site data and the data zip. | 842 videos, 75 topics |

`run_all.py` chains everything. Expected size after the API steps: several thousand videos (channels and playlists are where depth comes from for DSA, math and ML fundamentals, which HN rarely discusses).

## 5. Site (`site/`)
Vite + React + TypeScript, static, hash routing. Data loaded from `public/data/*.json`. Fonts bundled (Bricolage Grotesque, Instrument Sans). Build: 175 kB JS (57 kB gzip).
Routes: `/` home, `/learn`, `/s/:section`, `/n/:topic`, `/browse?q=&lv=&dur=&fresh=&sort=`, `/watch/:id`, `/prep`, `/liked`, `/later`, `/history`, `/progress`, `/settings`, `/about`.
Design: bottle-green ink on chalk paper (dark: deep bottle green), amber reserved for the vouch signal and freshness only. Catalogue rows instead of a card grid; the syllabus is the navigation.

## 6. Verification done
- TypeScript strict build passes; no console or page errors across all routes.
- Interaction tests (Playwright): keyboard like / later / done, filter chips, search, open video, history, all routes, 404 states, dark theme, help dialog.
- Screenshots reviewed at 1440 and 390 widths.
- Data spot checks: found and fixed noise (generic keywords such as "stack", "talk", "startup"; poor HN snippets).

## 7. Open items and risks
- **YouTube API key** (free): unlocks channels, playlists, durations, dates, Longs filter, real freshness.
- **Anthropic API key** (billed separately from Claude Pro): optional LLM cleanup, about $1-3.
- Rule classifier is conservative; the LLM pass is the accuracy upgrade. Hand-check about 100 videos after the final run.
- YouTube API terms on caching metadata: check before public launch; embeds use the official player.
- HN skews senior and systems-oriented; beginner and DSA depth comes from lists and channels.
- Videos can be deleted or lose embedding; rerun `04a_oembed.py` periodically (cache entries marked gone are skipped in the next classify).
- Name "DEV Tube" is a working title.

## 8. Deploy
Vercel / Cloudflare Pages / GitHub Pages: root `site`, build `npm run build`, output `dist`. Buy the domain, point it at the host. Update by re-running the pipeline, rebuilding and redeploying.

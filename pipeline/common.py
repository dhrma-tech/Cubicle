"""Shared helpers for the DEV Tube pipeline."""
import html, re, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = DATA / "out"
for p in (RAW, OUT):
    p.mkdir(parents=True, exist_ok=True)

# 11-char YouTube id after watch?v=, youtu.be/, /embed/, /shorts/, /live/
_VID = re.compile(
    r"(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^\s\"'<>]*?&)?v=|embed/|shorts/|live/|v/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])",
    re.I,
)
_PL = re.compile(r"youtube\.com/playlist\?(?:[^\s\"'<>]*?&)?list=([A-Za-z0-9_-]{10,})", re.I)


def clean_html(s: str) -> str:
    """HN comment HTML -> plain text (also un-escapes &#x2F; etc)."""
    s = html.unescape(s or "")
    s = re.sub(r"<p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def video_ids(raw_html: str) -> list[str]:
    s = html.unescape(raw_html or "")
    seen, out = set(), []
    for m in _VID.finditer(s):
        v = m.group(1)
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def playlist_ids(raw_html: str) -> list[str]:
    s = html.unescape(raw_html or "")
    return list(dict.fromkeys(m.group(1) for m in _PL.finditer(s)))


def load_json(path, default=None):
    path = pathlib.Path(path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def dump_json(path, obj):
    pathlib.Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

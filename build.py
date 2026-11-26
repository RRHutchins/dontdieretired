#!/usr/bin/env python3
"""
Don't Die Retired — static site builder.

Usage:
    python build.py            # build site into dist/
    python build.py --serve    # build then serve on http://localhost:8000

Inputs:
    site.yaml                  config (ads, affiliates, newsletter, products...)
    content/articles/*.md      articles with YAML front matter
    content/videos.yaml        curated video list
    content/products.yaml      digital products + affiliate picks
    templates/*.html           Jinja2 templates
    static/*                   copied to dist/static/

Outputs:
    dist/                      the deployable site
    social/<date>-<slug>/      social pack (posts, image cards, short-video script)
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import html
import json
import os
import re
import shutil
import textwrap
from pathlib import Path

import markdown
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image, ImageDraw, ImageFont

import art

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
SOCIAL = ROOT / "social"
CONTENT = ROOT / "content"
STATIC = ROOT / "static"

# Brand fonts live in the repo (SIL Open Font Licence) so images match the site
# on any machine; fall back to DejaVu if they are ever missing.
_FONTS = ROOT / "brand" / "fonts"
def _font(name, fallback):
    f = _FONTS / name
    return str(f) if f.exists() else fallback
FONT_BOLD = _font("Fraunces-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
FONT_REG = _font("SourceSans3-SemiBold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")

# ---------------------------------------------------------------- helpers

def load_yaml(p: Path):
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def split_front_matter(text: str):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        raise ValueError("missing front matter")
    return yaml.safe_load(m.group(1)), m.group(2)


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


def reading_time(md_text: str) -> int:
    words = len(re.findall(r"\w+", md_text))
    return max(1, round(words / 220))


def metadesc(text, n=155) -> str:
    """Search-result description: plain text, at most n characters, ending at a sentence if one fits, else at a word."""
    t = re.sub(r"\s+", " ", re.sub(r"[#>*_`\[\]]", "", str(text or ""))).strip()
    if len(t) <= n:
        return t
    cut = t[:n]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if end >= 90:
        return cut[:end + 1]
    return cut[:cut.rfind(" ")].rstrip(" ,;:—-") + "…"


_MONTHS = {m: i for i, m in enumerate("January February March April May June July August September October November December".split(), 1)}


def modified_date(body: str, published: dt.date) -> dt.date:
    """Latest 'Updated/Corrected 7 October 2026: ...' line at the foot of an article, else the publication date."""
    best = published
    for d, m, y in re.findall(r"^(?:Updated|Corrected) (\d{1,2}) ([A-Z][a-z]+) (\d{4}):", body, re.M):
        if m in _MONTHS:
            best = max(best, dt.date(int(y), _MONTHS[m], int(d)))
    return best


def seo_title(title: str, site: str, n=60) -> str:
    """Page title for search results: the headline, with the site name only when the two fit together."""
    full = f"{title} — {site}"
    return full if len(full) <= n else title


def excerpt(md_text: str, n=180) -> str:
    plain = re.sub(r"[#>*_`\[\]()!]", "", md_text)
    plain = re.sub(r"\s+", " ", plain).strip()
    return (plain[: n - 1] + "…") if len(plain) > n else plain


MD = markdown.Markdown(extensions=["extra", "smarty", "toc", "attr_list"])


def render_md(text: str) -> str:
    MD.reset()
    return MD.convert(text)


def wrap_text(draw, text, font, max_width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=font) <= max_width:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines



# ---------------------------------------------------------------- photographs and films (RUNBOOK §6l)

def story_photo(fm, slug, credits):
    """The photograph for an article, or None (the article then keeps its artwork).

    Two kinds. (1) An openly licensed photo from Wikimedia Commons: front matter `photo_file` names the
    Commons file, tools/photos.py (in GitHub Actions) downloads it and records author and licence in
    content/photo_credits.yaml, and a session sets `photo_checked` once it has looked at the file.
    All three must agree or the photo is not shown. (2) A photo we hold written permission for:
    `photo:` (a path under /static/photos/), `photo_credit:` and `photo_alt:`."""
    cap, alt = fm.get("photo_caption", ""), fm.get("photo_alt", "")
    if fm.get("photo_file"):
        c = credits.get(slug) or {}
        f = STATIC / "photos" / f"{slug}.jpg"
        why = ("has no photo_checked date" if not fm.get("photo_checked") else
               "is not in content/photo_credits.yaml yet (the Photos workflow fetches it)" if c.get("file") != fm["photo_file"] else
               "has no file in static/photos/" if not f.exists() else
               "has no photo_caption" if not cap else "has no photo_alt" if not alt else "")
        if why:
            print(f"PHOTO NOTE {slug}: photo not shown, it {why}.")
            return None
        return {"src": f"/static/photos/{slug}.jpg", "small": f"/static/photos/{slug}-800.jpg", "w": c["width"], "h": c["height"],
                "caption": cap, "alt": alt, "author": c["author"], "licence": c["licence"], "licence_url": c.get("licence_url", ""),
                "page": c["page"], "file": c["file"], "open": True, "label": fm.get("photo_label", "Photo")}
    if fm.get("photo") and fm.get("photo_credit"):
        return {"src": fm["photo"], "small": fm["photo"], "w": 1600, "h": 900, "caption": cap, "alt": alt,
                "author": fm["photo_credit"], "licence": "", "licence_url": "", "page": "", "file": "", "open": False, "label": fm.get("photo_label", "Photo")}
    return None


def story_video(fm, held):
    """A film of the person in the story, played with YouTube's own player. `video: {id, title, channel}`;
    the title and channel are copied from YouTube. verify_videos.py checks it before every deploy."""
    v = fm.get("video")
    if not isinstance(v, dict) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(v.get("id", ""))) or not v.get("title") or not v.get("channel"):
        return None
    return None if v["id"] in held else {"id": v["id"], "title": str(v["title"]), "channel": str(v["channel"])}


# ---- Links between pages (RUNBOOK §6p, Robin 27 Oct 2026: readers are led naturally from one page to the next) ----
_NOLINK = {"a", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figcaption", "code", "button", "summary", "th", "script", "style"}
_GENERIC = {"women", "men", "family", "history", "adventure", "learning", "confidence", "endurance", "inventions", "discoveries",
            "science", "second-chance", "solitude", "teaching", "study", "health", "fitness", "retirement", "life", "people"}
_STOP = {"a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "at", "your", "you", "with", "from", "by", "up", "into", "as",
         "do", "go", "take", "try", "get", "make", "join", "learn", "first", "own", "one", "how", "out", "back", "it", "is"}


def kw(*texts):
    """Lower-case content words, crudely singular, from tags, ids and titles."""
    out = set()
    for t in texts:
        for w in re.findall(r"[a-z]+", str(t).lower()):
            if w in _STOP or len(w) < 3: continue
            out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def load_terms():
    f = CONTENT / "link_terms.yaml"
    d = (yaml.safe_load(f.read_text(encoding="utf-8")) if f.exists() else None) or {}
    return sorted(d.items(), key=lambda kv: -len(kv[0]))


_TERM_RX = {}


class Linker:
    """Turn the first mention of a known term into a link. One Linker per page, so the four-link limit spans the page."""
    def __init__(self, terms, self_url, limit=4):
        self.terms, self.self_url, self.limit, self.used = terms, self_url, limit, set()

    def _text(self, text):
        hits = []
        for term, url in self.terms:
            if url == self.self_url or url in self.used: continue
            rx = _TERM_RX.get(term)
            if rx is None:   # compiled once per term: re's own cache holds 512 patterns and the terms outgrew it (23 Nov 2026)
                rx = _TERM_RX[term] = re.compile(r"(?<![\w-])" + re.escape(term) + r"(?![\w-])", 0 if term[:1].isupper() else re.I)
            m = rx.search(text)
            if m and not any(m.start() < e and s_ < m.end() for s_, e, _ in hits):
                hits.append((m.start(), m.end(), url)); self.used.add(url)
        hits = sorted(hits)
        out, pos = [], 0
        for st, en, url in hits:
            if self.limit <= 0: self.used.discard(url); continue
            out.append(text[pos:st]); out.append(f'<a href="{url}" class="auto-link">{text[st:en]}</a>'); pos = en; self.limit -= 1
        out.append(text[pos:])
        return "".join(out)

    def html(self, html):
        depth, out = 0, []
        for part in re.split(r"(<[^>]+>)", html):
            if part.startswith("<"):
                m = re.match(r"</?\s*([a-zA-Z0-9]+)", part)
                if m and m.group(1).lower() in _NOLINK and not part.endswith("/>"):
                    depth += -1 if part.startswith("</") else 1
                out.append(part)
            elif depth > 0 or self.limit <= 0 or not part.strip():
                out.append(part)
            else:
                out.append(self._text(part))
        return "".join(out)

    def plain(self, text):
        from markupsafe import Markup, escape
        return Markup(self.html(str(escape(text))))


def place_video(body_html, v):
    """Put the player after the second paragraph, so the story opens in words and the film follows."""
    e = html.escape
    fig = (f'<figure class="story-film"><div class="video-frame"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/{v["id"]}" '
           f'title="{e(v["title"], quote=True)}" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
           f'<figcaption><strong>Watch.</strong> “{e(v["title"])}”, from {e(v["channel"])}. It plays here from YouTube; the film is theirs, not ours.</figcaption></figure>')
    ends = [m.end() for m in re.finditer(r"</p>", body_html)]
    at = ends[1] if len(ends) > 2 else (ends[0] if ends else 0)
    return body_html[:at] + "\n" + fig + body_html[at:]


# ---------------------------------------------------------------- content

def load_articles(cfg, credits=None, held=None):
    arts = []
    for p in sorted((CONTENT / "articles").glob("*.md")):
        fm, body = split_front_matter(p.read_text(encoding="utf-8"))
        slug = fm.get("slug") or slugify(fm["title"])
        date = fm["date"]
        if isinstance(date, str):
            date = dt.date.fromisoformat(date)
        a = {
            **fm,
            "slug": slug,
            "date": date,
            "date_iso": date.isoformat(),
            "date_human": date.strftime("%-d %B %Y"),
            "url": f"/{fm['category']}/{slug}/",
            "abs_url": f"{cfg['site']['url']}/{fm['category']}/{slug}/",
            "html": render_md(body),
            "body_md": body,
            "reading_time": reading_time(body),
            "excerpt": fm.get("summary") or excerpt(body),
            # search engines: a short description of its own (`description:` in front matter wins) and honest dates
            "meta_description": metadesc(fm.get("description") or fm.get("standfirst") or fm.get("summary") or excerpt(body)),
            "seo_title": seo_title(fm.get("seo_title") or fm["title"], cfg["site"]["name"]),
            "modified_iso": modified_date(body, date).isoformat(),
            "tags": fm.get("tags", []),
            "image": f"/static/img/{slug}.png",          # headline card: social, og:image
            # shown on the site: a credited photo if the article has one (`photo:` + `photo_credit:`,
            # logged in docs/IMAGE_CREDITS.md), otherwise the sun-and-scene artwork from art.py
            "art": f"/static/art/{slug}.svg",
            "scene": fm.get("art"),
        }
        a["photo"] = story_photo(fm, slug, credits or {})
        # social photo cards (RUNBOOK §6l, Robin 16 Nov 2026): only Commons files a session has passed for social use
        a["photo_social"] = bool(a["photo"] and a["photo"]["open"] and fm.get("photo_social") is True)
        a["photo_social_decided"] = "photo_social" in fm
        if a["photo"]:
            a["art"] = a["photo"]["small"]
        a["video"] = story_video(fm, held or set())
        if a["video"]:
            a["html"] = place_video(a["html"], a["video"])
        # Copyright guard (RUNBOOK §7a): news stories quote sparingly. Warn, never fail the build.
        if fm.get("kind") != "guide":
            _q = re.findall(r'["\u201c]([^"\u201d\n]{15,})["\u201d]', body)
            _qw, _tot = sum(len(x.split()) for x in _q), max(len(body.split()), 1)
            _long = max([len(x.split()) for x in _q] or [0])
            if _long > 30 or _qw * 100 > 15 * _tot:
                print(f"COPYRIGHT WARNING {p.name}: quoted {_qw}/{_tot} words ({_qw * 100 // _tot}%), longest quote {_long} words. Limits: 15% and 30 words. Paraphrase some.")
        arts.append(a)
    arts.sort(key=lambda a: a["date"], reverse=True)
    # companion plans ("the plan behind the story")
    plans = {}
    for p in sorted((CONTENT / "plans").glob("*.md")) if (CONTENT / "plans").exists() else []:
        fm, body = split_front_matter(p.read_text(encoding="utf-8"))
        plans[fm["article"]] = {**fm, "html": render_md(body), "body_md": body, "url": f"/plans/{fm['article']}/"}
    for a in arts:
        a["plan"] = plans.get(a["slug"])
    return arts


# ---------------------------------------------------------------- images

PALETTE = {
    "move": ("#0B6E4F", "#E8F5EF"),
    "think": ("#1F4E79", "#E9F0F8"),
    "earn": ("#8A4B08", "#FBF1E4"),
    "connect": ("#6D2E72", "#F5EAF6"),
    "stories": ("#B23A48", "#FBEBEC"),
    "eat": ("#5E7D1E", "#F1F6E6"),
    "money": ("#2F5D50", "#E7F1EE"),
    "travel": ("#0E7490", "#E6F4F7"),
    "tech": ("#4B4F9C", "#EDEEF8"),
    "ai": ("#3F4A54", "#ECEFF1"),
    "explore": ("#2F6B3A", "#EAF3EC"),
    "curious": ("#6A4C2E", "#F4EEE7"),
}


def _mix(hex_a: str, hex_b: str, t: float):
    a = [int(hex_a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(hex_b[i:i + 2], 16) for i in (1, 3, 5)]
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def make_card(title: str, kicker: str, category: str, out: Path, size=(1200, 630), footer="dontdieretired.com"):
    """Brand card used as article hero, OG image and social image.

    Deep topic colour, the logo's rising sun in the lower right, headline in
    Fraunces. Drawn at 2x and downsampled so the sun and rays are smooth."""
    fg, _bg = PALETTE.get(category, ("#333333", "#F3F3F3"))
    cream = "#FBF6EE"
    W0, H0 = size
    S = 2
    W, H = W0 * S, H0 * S
    base = min(W, H)
    img = Image.new("RGB", (W, H), fg)
    d = ImageDraw.Draw(img)

    # rising sun: half-disc on the bottom edge, rays fanning above it
    wide_ = W > H * 1.2
    r = int(base * (0.30 if wide_ else 0.24))
    cx, cy = W - int(base * (0.10 if wide_ else 0.06)) - r, H + int(r * 0.12)
    ray_col = _mix(fg, cream, 0.22)
    import math
    for i in range(7):
        ang = math.radians(180 + 15 + i * 25)
        x1, y1 = cx + math.cos(ang) * r * 1.22, cy + math.sin(ang) * r * 1.22
        x2, y2 = cx + math.cos(ang) * r * 1.62, cy + math.sin(ang) * r * 1.62
        d.line([(x1, y1), (x2, y2)], fill=ray_col, width=int(base * 0.028))
        for (x, y) in ((x1, y1), (x2, y2)):  # round caps
            rr = int(base * 0.014)
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=ray_col)
    d.ellipse([cx - r * 1.06, cy - r * 1.06, cx + r * 1.06, cy + r * 1.06], fill=_mix(fg, cream, 0.12))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=_mix(fg, "#F2B45A", 0.85))

    pad = int(W * 0.065)
    wide = W > H * 1.2
    kf = ImageFont.truetype(FONT_REG, int(base * 0.052))
    ff = ImageFont.truetype(FONT_REG, int(base * 0.044))
    y0 = int(pad * 0.95)
    d.text((pad, y0), kicker, font=kf, fill=_mix(fg, cream, 0.72))
    y0 += int(base * 0.10)
    if wide:
        # headline sits beside the sun; footer bottom-left
        text_w = int((W - 2 * pad) * 0.86)
        limit_y = H - pad - ff.size - int(base * 0.05)
        d.text((pad, H - pad - ff.size), footer, font=ff, fill=_mix(fg, cream, 0.72))
    else:
        # square / story: headline must finish above the rays
        text_w = W - 2 * pad
        limit_y = cy - r * 1.72
    # shrink the headline until it fits, never below a readable floor
    scale = 0.112 if len(title) < 60 else (0.09 if len(title) < 95 else 0.075)
    while True:
        tf = ImageFont.truetype(FONT_BOLD, int(base * scale))
        line_h = int(tf.size * 1.14)
        lines = wrap_text(d, title, tf, text_w)
        if y0 + len(lines) * line_h <= limit_y or scale <= 0.056:
            break
        scale *= 0.92
    max_lines = max(1, int((limit_y - y0) // line_h))
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" ,;:.") + "…"
    y = y0
    for line in lines:
        d.text((pad, y), line, font=tf, fill=cream)
        y += line_h
    if H > W * 1.3 and footer:   # tall pins and story cards: say where it is from, under the headline
        d.text((pad, y + int(line_h * 0.6)), footer, font=ff, fill=_mix(fg, cream, 0.72))
    img = img.resize((W0, H0), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def photo_credit_line(photo):
    """The credit printed on a photo card: author, licence, source, and that we cropped it."""
    return f"Photo: {photo['author']} · {photo['licence']} · Wikimedia Commons (cropped)"


def make_photo_card(title: str, kicker: str, category: str, photo: dict, out: Path, size=(1080, 1080)):
    """Social card with a credited Commons photograph (RUNBOOK §6l, social use; Robin 16 Nov 2026).

    The photo is cropped to fill its panel and otherwise untouched: no text, logo or mark is laid on it, which keeps
    share-alike licences simple. The headline sits on the topic colour beside or below it, with the credit line."""
    fg, _bg = PALETTE.get(category, ("#333333", "#F3F3F3"))
    cream = "#FBF6EE"
    W0, H0 = size
    S = 2
    W, H = W0 * S, H0 * S
    img = Image.new("RGB", (W, H), fg)
    d = ImageDraw.Draw(img)
    src = Image.open(STATIC / photo["src"].lstrip("/").removeprefix("static/")).convert("RGB")
    wide = W > H * 1.2
    if wide:
        box = (0, 0, int(W * 0.5), H)
    else:
        box = (0, 0, W, int(H * (0.56 if H > W * 1.3 else 0.5)))
    bw, bh = box[2] - box[0], box[3] - box[1]
    sc = max(bw / src.width, bh / src.height)
    rs = src.resize((max(bw, round(src.width * sc)), max(bh, round(src.height * sc))), Image.LANCZOS)
    left, top = (rs.width - bw) // 2, (rs.height - bh) // 2
    img.paste(rs.crop((left, top, left + bw, top + bh)), box[:2])
    base = min(W, H)
    pad = int((W - bw if wide else W) * (0.08 if wide else 0.065))
    x0 = (bw if wide else 0) + pad
    tw = W - x0 - pad
    y0 = (0 if wide else bh) + int(pad * 0.8)
    cf = ImageFont.truetype(FONT_REG, int(base * 0.026))
    kf = ImageFont.truetype(FONT_REG, int(base * 0.042))
    ff = ImageFont.truetype(FONT_REG, int(base * 0.038))
    soft = _mix(fg, cream, 0.72)
    # credit: under the photo on tall/square cards, at the foot of the panel on wide ones
    credit = photo_credit_line(photo)
    while d.textlength(credit, font=cf) > tw and cf.size > 14:
        cf = ImageFont.truetype(FONT_REG, cf.size - 1)
    d.text((x0, y0), kicker, font=kf, fill=soft)
    y = y0 + int(kf.size * 1.7)
    foot = H - pad - ff.size
    limit = foot - cf.size * 2.6 - int(base * 0.02)
    scale = 0.08 if not wide else 0.078
    while True:
        tf = ImageFont.truetype(FONT_BOLD, int(base * scale))
        lh = int(tf.size * 1.14)
        lines = wrap_text(d, title, tf, tw)
        if y + len(lines) * lh <= limit or scale <= 0.045:
            break
        scale *= 0.93
    maxl = max(1, int((limit - y) // lh))
    if len(lines) > maxl:
        lines = lines[:maxl]; lines[-1] = lines[-1].rstrip(" ,;:.") + "…"
    for ln in lines:
        d.text((x0, y), ln, font=tf, fill=cream); y += lh
    d.text((x0, foot - cf.size * 2.2), credit, font=cf, fill=soft)
    d.text((x0, foot), "dontdieretired.com", font=ff, fill=soft)
    # the sunrise mark, small, in the panel's corner (never on the photo)
    import math
    r = int(base * 0.035); cx, cy = W - pad - r * 1.7, foot + ff.size * 0.85
    for i in range(7):
        ang = math.radians(195 + i * 25)
        d.line([(cx + math.cos(ang) * r * 1.25, cy + math.sin(ang) * r * 1.25),
                (cx + math.cos(ang) * r * 1.65, cy + math.sin(ang) * r * 1.65)], fill=_mix(fg, cream, 0.3), width=max(2, int(r * 0.13)))
    d.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=_mix(fg, "#F2B45A", 0.85))
    img = img.resize((W0, H0), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def social_card(a, title, kicker, out, size):
    """A photo card when the article's photo is passed for social use and its social date is on or after
    PHOTO_SOCIAL_FROM; otherwise the usual headline card."""
    if a.get("photo_social") and str(a.get("social_date") or a["date_iso"]) >= PHOTO_SOCIAL_FROM:
        make_photo_card(title, kicker, a["category"], a["photo"], out, size=size)
    else:
        make_card(title, kicker, a["category"], out, size=size)


# ---------------------------------------------------------------- social pack

# Hashtags (Robin, 9 Nov 2026: adults are the audience, so no age tags). Every Instagram post carries the three brand
# tags, one fixed tag for the topic and two from the article's own tags; X gets #DontDieRetired and one article tag;
# Facebook gets #DontDieRetired. Never #over50, #activeageing, #seniors, #agingwell or #retirementlife (RUNBOOK §6d).
SOCIAL_V2_FROM = "2026-11-23"   # hand-written, second-model-reviewed captions (`social_text`, `social_card`) from this date (RUNBOOK §6d1)
PHOTO_SOCIAL_FROM = "2026-11-17"   # photo cards and photo credits in captions only for packs from this date (older packs are never rewritten)
HASHTAGS_FROM = "2026-11-10"   # social packs dated before this keep their old text (changing a sent pack re-posts it)
BRAND_HASHTAGS = ["#DontDieRetired", "#NeverRetireFromLife", "#TryNewThings"]
TOPIC_HASHTAGS = {"move": "#MoveMore", "eat": "#CookFromScratch", "think": "#KeepLearning", "money": "#MoneyMatters",
                  "earn": "#CareerChange", "connect": "#Community", "travel": "#Adventure", "tech": "#TechTips",
                  "ai": "#AIForEveryone", "explore": "#Outdoors", "curious": "#History", "stories": "#RealStories"}
# Article tags that are for balancing the site's mix, not for searching, and never become hashtags.
NO_HASHTAG = {"men", "women", "friends", "people", "over50", "over-50", "seniors", "older", "retirement-age",
              "activeageing", "active-ageing", "ageing", "aging", "later-life"}


def article_hashtags(a, n):
    """The first n of an article's own tags as CamelCase hashtags (open-water -> #OpenWater), skipping NO_HASHTAG."""
    out = []
    for t in a["tags"]:
        t = str(t).strip().lower()
        if not t or t in NO_HASHTAG:
            continue
        h = "#" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^a-z0-9]+", t) if w)
        if len(h) > 1 and h not in out:
            out.append(h)
        if len(out) == n:
            break
    return out


def social_pack(a, cfg):
    """Write ready-to-post social content for one article."""
    site = cfg["site"]
    # `social_date` (optional, front matter) holds an article's social posts back to a later day, so several pieces
    # published together go out one a day instead of all at once (RUNBOOK §6o). It never changes the article's own date.
    sdate = str(a.get("social_date") or a["date_iso"])
    folder = SOCIAL / f"{sdate}-{a['slug']}"
    folder.mkdir(parents=True, exist_ok=True)
    utm = lambda src: f"{a['abs_url']}?utm_source={src}&utm_medium=social&utm_campaign=daily"
    hook = a.get("hook") or a["title"]
    lesson = a.get("lesson", "")
    v2 = sdate >= SOCIAL_V2_FROM
    if v2:
        # Robin, 22 Nov 2026: posts must read well, explain places and terms, and carry a photo whenever one is suitable.
        if not a.get("social_text"):
            print(f"SOCIAL NOTE {a['slug']}: no social_text, so the post falls back to hook + summary (RUNBOOK §6d1).")
        elif not a.get("social_reviewed"):
            print(f"SOCIAL NOTE {a['slug']}: social_text has not been reviewed by a second model (RUNBOOK §6d1).")
        if a.get("photo") and a["photo"].get("open") and not a.get("photo_social_decided"):
            print(f"SOCIAL NOTE {a['slug']}: has a checked photo but no photo_social decision; check it for social use (§6l) and set true, or false with a reason.")
        hook = a.get("social_card") or hook
    if sdate < HASHTAGS_FROM:
        # Packs dated before the hashtag change keep their old wording exactly: Buffer posts again any pack whose
        # text changes (RUNBOOK §6d), so already-sent packs must never be rewritten.
        tags = " ".join("#" + re.sub(r"[^a-z0-9]", "", t) for t in (a["tags"] + ["over50", "activeageing", "dontdieretired"]))
        ig_tags, x_tags, fb_tags = tags, "", ""
        why_line = "Why it matters for anyone over 50: "
    else:
        art_tags = article_hashtags(a, 2)
        ig_list = BRAND_HASHTAGS + [TOPIC_HASHTAGS.get(a["category"], "")] + art_tags
        ig_tags = " ".join(t for t in dict.fromkeys(ig_list) if t)
        x_tags = " ".join(["#DontDieRetired"] + art_tags[:1])
        fb_tags = "#DontDieRetired"
        why_line = ""

    st = a.get("social_text") if v2 else None
    posts = {
        "facebook": (f"{st}\n\nRead the full story → {utm('facebook')}" if st else
                     f"{hook}\n\n{a['excerpt']}\n\n{lesson}\n\nRead the full story → {utm('facebook')}")
                    + (f"\n\n{fb_tags}" if fb_tags else ""),
        "instagram": (f"{st}" if st else f"{hook}\n\n{lesson}") + f"\n\nFull story at the link in our bio (dontdieretired.com).\n\n{ig_tags}",
        "x": textwrap.shorten(hook if st else f"{hook} {lesson}", 200, placeholder="…") + f"\n\n{utm('x')}"
             + (f"\n\n{x_tags}" if x_tags else ""),
        "x_thread": "\n\n---\n\n".join([
            f"1/ {hook}",
            f"2/ {a['excerpt']}",
            f"3/ The lesson: {lesson}",
            f"4/ Full story, sources" + (" and a plan you can start this week" if a.get("plan") else "") + f" → {utm('x')}",
        ]),
        "pinterest": f"{a['title']} | {lesson} | {utm('pinterest')}",
        "linkedin": f"{hook}\n\n{a['excerpt']}\n\n{why_line}{lesson}\n\n{utm('linkedin')}",
    }
    if a.get("photo_social") and sdate >= PHOTO_SOCIAL_FROM:
        p_ = a["photo"]
        credit = f"Photo: {p_['author']}, {p_['licence']} ({p_['licence_url']}), via Wikimedia Commons ({p_['page']}). Cropped."
        posts["facebook"] += f"\n\n{credit}"
        posts["instagram"] = posts["instagram"].replace(f"\n\n{ig_tags}", f"\n\n{credit}\n\n{ig_tags}")
    if sdate >= HASHTAGS_FROM:
        posts.pop("linkedin")   # no LinkedIn account (Robin, 9 Nov 2026); older packs are left exactly as they were
    (folder / "posts.md").write_text(
        "\n\n".join(f"## {k}\n\n{v}" for k, v in posts.items()), encoding="utf-8")

    script = a.get("video_script") or textwrap.dedent(f"""
        # 45-second short (Reels / TikTok / Shorts)

        [0-3s]  ON SCREEN: "{hook}"   VO: "{hook}"
        [3-15s] VO: {a['excerpt']}
        [15-35s] VO: {lesson}
        [35-45s] VO: "If they can start, so can you. One small step today."  ON SCREEN: dontdieretired.com
        Pictures: the site's own artwork and the story's own licensed photograph only (RUNBOOK §6l): no stock footage of models, no AI-generated people or places. Captions on.
        """).strip()
    (folder / "short_video_script.md").write_text(script, encoding="utf-8")

    social_card(a, hook, "Don't Die Retired", folder / "square.png", (1080, 1080))
    social_card(a, hook, "Don't Die Retired", folder / "story.png", (1080, 1920))
    social_card(a, hook, "Don't Die Retired", folder / "landscape.png", (1200, 630))

    (folder / "meta.json").write_text(json.dumps({
        "title": a["title"], "url": a["abs_url"], "date": sdate,
        "category": a["category"], "tags": a["tags"], "segments": a.get("segments", []),
        "posts": posts,
    }, indent=2), encoding="utf-8")
    return folder


# ---------------------------------------------------------------- feeds

def write_rss(arts, cfg):
    """feed.xml (every article) and feed/<topic>.xml (one per topic, for one Pinterest board each).
    The image in each item is the tall pin, which is what Pinterest auto-publish uses (RUNBOOK §6d)."""
    site = cfg["site"]

    def feed(items_src, title, path):
        items = []
        for a in items_src[:30]:
            items.append(f"""
    <item>
      <title>{html.escape(a['title'])}</title>
      <link>{a['abs_url']}</link>
      <guid>{a['abs_url']}</guid>
      <pubDate>{dt.datetime.combine(a['date'], dt.time(6)).strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>
      <category>{a['category']}</category>
      <description>{html.escape(a['excerpt'])}</description>
      <enclosure url="{site['url']}/static/pin/{a['slug']}.png" type="image/png" length="0"/>
    </item>""")
        rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>{html.escape(title)}</title>
  <link>{site['url']}</link>
  <description>{html.escape(site['description'])}</description>
  <language>{site['language']}</language>{''.join(items)}
</channel></rss>"""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rss, encoding="utf-8")

    feed(arts, site["name"], DIST / "feed.xml")
    for cid, c in cfg["categories"].items():
        mine = [a for a in arts if a.get("kind") != "guide" and a["category"] != "curious"] if cid == "stories" else [a for a in arts if a["category"] == cid]
        if mine:
            feed(mine, f"{site['name']}: {c['label']}", DIST / "feed" / f"{cid}.xml")


def write_sitemap(urls, cfg):
    site = cfg["site"]
    lastmod = getattr(write_sitemap, "lastmod", {})   # articles only: the date the text last changed, never the build date
    body = "".join(f"<url><loc>{site['url']}{u}</loc>" + (f"<lastmod>{lastmod[u]}</lastmod>" if u in lastmod else "") + "</url>" for u in urls)
    (DIST / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>',
        encoding="utf-8")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {site['url']}/sitemap.xml\n", encoding="utf-8")


# ---------------------------------------------------------------- build

def build(make_social=True):
    cfg = load_yaml(ROOT / "site.yaml")
    videos = load_yaml(CONTENT / "videos.yaml").get("videos", [])
    # The deploy workflow runs verify_videos.py first; a film YouTube does not confirm is left off the page.
    _vc = ROOT / ".videos_check.json"
    if _vc.exists():
        _res = json.loads(_vc.read_text(encoding="utf-8"))
        _held = [v["id"] for v in videos if not _res.get(v["id"], {}).get("show", True)]
        videos = [v for v in videos if v["id"] not in _held]
        if _held: print("Videos held back (not verified with YouTube):", ", ".join(_held))
    products = load_yaml(CONTENT / "products.yaml")
    local = load_yaml(CONTENT / "local.yaml") if (CONTENT / "local.yaml").exists() else {"regions": {}, "activities": {}}
    _pc = CONTENT / "photo_credits.yaml"
    credits = (load_yaml(_pc) if _pc.exists() else {}) or {}
    _shown = {k: v.get("show", True) for k, v in (json.loads(_vc.read_text(encoding="utf-8")) if _vc.exists() else {}).items()}
    arts = load_articles(cfg, credits, {k for k, ok in _shown.items() if not ok})

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(STATIC, DIST / "static")
    # kit thumbnails (RUNBOOK §6w): drawn icons of each type of kit, one sprite, matched to product names by tools/kiticons.py
    import importlib.util as _ilk
    _kis = _ilk.spec_from_file_location("kiticons", ROOT / "tools" / "kiticons.py"); _kim = _ilk.module_from_spec(_kis); _kis.loader.exec_module(_kim)
    _kim.write_sprite(DIST / "static" / "kit-icons.svg")
    # the app (installable web app at /app/)
    if (ROOT / "app").exists():
        shutil.copytree(ROOT / "app", DIST / "app", ignore=shutil.ignore_patterns("build_data.py", "__pycache__"))
        import subprocess, sys as _sys
        subprocess.run([_sys.executable, str(ROOT / "app" / "build_data.py"), str(DIST / "app" / "data.json")], check=True)

    env = Environment(loader=FileSystemLoader(ROOT / "templates"),
                      autoescape=select_autoescape(["html"]))
    env.globals.update(cfg=cfg, now=dt.date.today(), videos=videos, products=products,
                       articles=arts, categories=cfg["categories"], segments=cfg["audience_segments"], local=local)

    # version stamp on the stylesheet and scripts, so a returning reader never gets a new page with last week's CSS
    import hashlib
    _h = hashlib.sha1()
    for f in sorted(STATIC.glob("*.css")) + sorted(STATIC.glob("*.js")):
        _h.update(f.read_bytes())
    _h.update(_kim.sprite().encode())
    env.globals.update(asset_v=_h.hexdigest()[:8])
    env.filters["kicon"] = _kim.icon_for
    # Planner Plus accounts (RUNBOOK §6t): the Worker's address; "" keeps accounts closed. DDR_ACCOUNTS_API is for a local test build only.
    _acct = (os.environ.get("DDR_ACCOUNTS_API") or str((cfg.get("accounts") or {}).get("api") or "")).rstrip("/")
    assert _acct == "" or re.match(r"^(https://[a-z0-9.-]+|http://(localhost|127\.0\.0\.1):\d+)$", _acct), f"accounts.api must be an https origin: {_acct!r}"
    env.globals.update(accounts_api=_acct)
    # Day 20 security review: an ad network's script runs as the site itself, and the accounts Worker trusts the site's origin,
    # so a bad ad could read a signed-in member's email or unused gift codes. Ads and accounts together need the account
    # pages moved to their own origin with a strict Content-Security-Policy first (RUNBOOK §6t, day 20 log).
    assert not (_acct and (cfg.get("ads") or {}).get("enabled") is True), "ads.enabled with accounts.api: move the account pages to their own origin first (RUNBOOK §6t day 20)"
    # Planner Plus paywall (RUNBOOK §6t day 15): off until launch day; it needs accounts, as membership lives there
    _paywall = os.environ.get("DDR_PLUS_PAYWALL") == "1" or (cfg.get("plus") or {}).get("paywall") is True
    assert not _paywall or _acct, "plus.paywall needs accounts.api: membership is kept on the account"
    env.globals.update(plus_paywall=_paywall)
    env.filters["metadesc"] = metadesc
    env.filters["seotitle"] = lambda t: seo_title(t, cfg["site"]["name"])
    env.globals.update(same_as=[v for k, v in cfg.get("social", {}).items() if isinstance(v, str) and v.startswith("http")])
    # Printed puzzle books (RUNBOOK §6s): only books with a real Amazon link; seasonal ones leave the home tile after `until`
    _books = [b for b in (cfg.get("books") or []) if str(b.get("amazon", "")).startswith("https://www.amazon.")]
    _today = dt.date.today().isoformat()
    env.globals.update(books=_books, books_now=[b for b in _books if str(b.get("until") or "9999") >= _today])
    # The Christmas Quiz Book (two editions): shown only once BOTH have a real Amazon link
    _qb = cfg.get("quiz_books") or []
    _quiz = _qb if _qb and all(str(b.get("amazon", "")).startswith("https://www.amazon.") for b in _qb) else []
    env.globals.update(quiz_books=_quiz, quiz_now=[b for b in _quiz if str(b.get("until") or "9999") >= _today][:1])

    def out(path: str, tpl: str, **ctx):
        p = DIST / path.strip("/") / "index.html" if path != "/" else DIST / "index.html"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(env.get_template(tpl).render(path=path, **ctx), encoding="utf-8")
        return path

    urls = []
    # Fifty at Fifty: which challenges belong under which story or guide (the pages themselves are built further down)
    _chs = load_yaml(CONTENT / "challenges.yaml") if (CONTENT / "challenges.yaml").exists() else []
    for a in arts:
        a["challenges"] = [c for c in _chs if a["slug"] in (c.get("guide"), c.get("story"))]
    env.globals.update(list_total=len(_chs))
    # Groups for Things to do (Robin, 20 Nov 2026: "make it clearer there are so many activities", "easy and obvious there are
    # groups to navigate"). content/groups.yaml holds rules, so new activities file themselves. Counts are worked out here at
    # every build, so they are never stale (Robin chose total and group counts on 20 Nov 2026, replacing the 27 Oct no-total rule).
    GROUPS = []
    if (CONTENT / "groups.yaml").exists():
        for gk, g in (load_yaml(CONTENT / "groups.yaml") or {}).get("groups", {}).items():
            rx, nx, also = (re.compile(g[k]) if g.get(k) else None for k in ("match", "not", "also"))
            def _in(c, g=g, rx=rx, nx=nx, also=also, gk=gk):
                if gk in (c.get("groups") or []): return True
                t = (c["id"].replace("-", " ") + " " + c["title"]).lower()
                if g.get("collection"): return c.get("collection") == g["collection"]
                if g.get("not_collection") and c.get("collection") == g["not_collection"]: return False
                if g.get("also_collection") and c.get("collection") == g["also_collection"]: return True
                if nx and nx.search(t): return False
                if also and also.search(t): return True
                return bool((not g.get("categories") or c["category"] in g["categories"]) and (not g.get("kinds") or c["kind"] in g["kinds"])
                            and (not g.get("regions") or set(g["regions"]) & set(c.get("regions") or [])) and (not rx or rx.search(t)))
            ids = [c["id"] for c in _chs if _in(c)]
            if ids:
                GROUPS.append(dict(g, key=gk, ids=ids, n=len(ids)))
        _slugs = {g["slug"] for g in GROUPS}
        assert not _slugs & {c["id"] for c in _chs}, f"a group slug clashes with an activity id: {_slugs & {c['id'] for c in _chs}}"
        _lonely = [c["id"] for c in _chs if not any(c["id"] in g["ids"] for g in GROUPS)]
        if _lonely: print(f"LIST WARNING: {len(_lonely)} activities are in no group (add a rule in content/groups.yaml or `groups:` on the entry): {', '.join(_lonely[:40])}")
    _n = len(_chs)
    env.globals.update(kit_live=bool(list((CONTENT / "kit").glob("*.yaml"))) if (CONTENT / "kit").exists() else False)
    env.globals.update(groups=GROUPS, list_total_text=(f"More than {((_n - 1) // 50) * 50:,}" if _n > 100 else str(_n)))
    # Deep hubs (RUNBOOK §6u, Robin 17 Nov 2026: "a primary source on the internet" for a subject, ultra running first):
    # content/hubs/<id>.yaml gives an event finder, guides and the activities that lead in. Loaded here, rendered after Things to do.
    HUBS = {}
    if (CONTENT / "hubs").exists():
        for _hf in sorted((CONTENT / "hubs").glob("*.yaml")):
            _h = load_yaml(_hf)
            assert _h.get("id") == _hf.stem and re.fullmatch(r"[a-z0-9-]+", _h.get("slug", "")), f"hub {_hf.name}: id must match the file name and slug be plain"
            HUBS[_h["id"]] = _h
    env.globals.update(hubs=HUBS)
    # Gift ideas (RUNBOOK §6v, Robin 19 Nov 2026): content/gifts.yaml. Loaded here so activity pages can link to their gift page;
    # the /gifts/ pages are rendered after the hubs.
    GIFTS = load_yaml(CONTENT / "gifts.yaml") if (CONTENT / "gifts.yaml").exists() else None
    _gift_for = {}
    if GIFTS:
        _gs = GIFTS["season"]
        GIFTS["in_season"] = str(_gs["from"]) <= _today <= str(_gs["until"])
        for _g in GIFTS["groups"]:
            for _i in _g["ideas"]: _gift_for.setdefault(_i["id"], {"url": f"/gifts/{_g['id']}/#{_i['id']}", "label": _g["label"], "h1": _g["h1"]})
    # Christmas present list on every activity page (Robin, 19 Nov 2026: "add a temporary Christmas present list for people
    # interested in the activities. Do for all activities so it is found for Christmas present searches"). In season only:
    # the activity's own booking and kit links, any stocking filler tied to it (`for:` in stocking_fillers.yaml), the
    # promise card for free or low-cost activities, and the activity's gift page. RUNBOOK §6v.
    _sf_for = {}
    if (CONTENT / "stocking_fillers.yaml").exists():
        for _sec in (load_yaml(CONTENT / "stocking_fillers.yaml").get("sections") or []):
            for _it in _sec.get("items") or []:
                if _it.get("for"):
                    _sf_for.setdefault(_it["for"], []).append({"name": _it["name"], "why": _it["why"], "check": _it.get("check", ""),
                        "url": "https://www.amazon.co.uk/s?k=" + "+".join(str(_it["q"]).split()), "page": f"/gifts/stocking-fillers/{_sec['id']}/", "label": _sec.get("label", "")})
    env.globals.update(gift_for=_gift_for, sf_for=_sf_for, gifts_season=bool(GIFTS and GIFTS["in_season"]), gifts_season_name=(GIFTS or {}).get("season", {}).get("name", ""))
    terms = load_terms()
    # match on subjects only: activity ids and story tags (people's names in slugs and titles caused false matches)
    _ch_kw = {c["id"]: kw(c["id"].replace("-", " ")) for c in _chs}
    _art_kw = {x["slug"]: kw(*[t.replace("-", " ") for t in x["tags"] if t not in _GENERIC]) for x in arts}
    # place names and loose words (london, yorkshire, road) count for little: a shared place is not a shared interest
    _ms = CONTENT / "map_shapes.json"
    _weak = {"road", "london", "coast", "sea", "ocean", "water", "city", "town", "trip", "day", "week", "year", "great", "new", "national", "park", "england", "britain", "america", "usa", "world", "record", "life", "story", "site", "time", "long", "big", "old", "home"}
    if _ms.exists():
        for k in ("uk", "us"):
            for ar in json.loads(_ms.read_text(encoding="utf-8"))[k]["areas"]: _weak |= kw(ar["name"])
    _ch_kw = {k: v - _weak for k, v in _ch_kw.items()}
    _art_kw = {k: v - _weak for k, v in _art_kw.items()}

    def related_for(a):
        """Three stories to read next: shared subjects first, then the same topic; newest wins a tie; never the same piece."""
        mine = set(t for t in a["tags"] if t not in _GENERIC)
        def score(b):
            return 3 * len(mine & set(b["tags"])) + 2 * (b["category"] == a["category"]) + len(set(a["tags"]) & set(b["tags"]) & _GENERIC)
        pool = [b for b in arts if b is not a and (b.get("kind") != "guide" or score(b) >= 3)]
        ranked = sorted(pool, key=lambda b: (-score(b), -b["date"].toordinal()))
        return [b for b in ranked if score(b) > 0][:3] or ranked[:3]

    def things_for(a):
        """Up to three activities to try after reading: the ones tied to this piece first, then those sharing its subject."""
        tied = [c for c in _chs if a["slug"] in (c.get("guide"), c.get("story"))]
        mk = _art_kw[a["slug"]]
        scored = sorted(((3 * len(mk & _ch_kw[c["id"]]) + (c["category"] == a["category"]), c) for c in _chs if c not in tied), key=lambda x: -x[0])
        picks = (tied + [c for sc, c in scored if sc >= 3])[:3]
        if len(picks) < 3:   # fill from the same topic, a different trio for each story (stable per slug), richer pages first
            import zlib
            same = [c for c in _chs if c["category"] == a["category"] and c not in picks] or [c for c in _chs if c["category"] in ("explore", "think", "travel") and c not in picks]
            same.sort(key=lambda c: (not (c.get("detail") or c.get("inspire") or c.get("story")), zlib.crc32((a["slug"] + c["id"]).encode())))
            picks += same[:3 - len(picks)]
        return picks
    # article hero/og images
    for a in arts:
        social_card(a, a.get("lesson") or a["title"], cfg["categories"][a["category"]]["label"],
                    DIST / "static" / "img" / f"{a['slug']}.png", (1200, 630))
        if (dt.date.today() - a["date"]).days <= 7:   # square card for Instagram (post_social.py); recent articles only
            (DIST / "static" / "social").mkdir(parents=True, exist_ok=True)
            social_card(a, a.get("hook") or a["title"], "Don't Die Retired",
                        DIST / "static" / "social" / f"{a['slug']}.png", (1080, 1080))
        # tall 2:3 pin for Pinterest (the feed's image); the headline, so a pin reads like the article it links to
        (DIST / "static" / "pin").mkdir(parents=True, exist_ok=True)
        make_card(a["title"], cfg["categories"][a["category"]]["label"], a["category"],
                  DIST / "static" / "pin" / f"{a['slug']}.png", size=(1000, 1500))
        (DIST / "static" / "art").mkdir(parents=True, exist_ok=True)
        (DIST / "static" / "art" / f"{a['slug']}.svg").write_text(
            art.scene_svg({**a, "art": a["scene"]}, PALETTE.get(a["category"], ("#333333",))[0]), encoding="utf-8")
        related = related_for(a)
        a["html"] = Linker(terms, a["url"]).html(a["html"])
        urls.append(out(a["url"], "article.html", a=a, related=related, things=things_for(a)))
        if a.get("plan"):
            out(a["plan"]["url"], "plan.html", a=a, plan=a["plan"])  # not in sitemap: gated content
        if make_social:
            social_pack(a, cfg)

    # "Today's story" is the newest real story, not an evergreen guide published the same day
    featured = next((a for a in arts if a.get("kind") != "guide"), arts[0])
    # Latest: newest first, but no topic takes more than two of the six places
    latest, per = [], {}
    for a in arts:
        if a is featured or per.get(a["category"], 0) >= 2:
            continue
        per[a["category"]] = per.get(a["category"], 0) + 1
        latest.append(a)
        if len(latest) == 6:
            break
    # the home page is written after the activities are ready (below), because Things to do now leads it
    for cid, c in cfg["categories"].items():
        urls.append(out(f"/{cid}/", "category.html", cid=cid, c=c, items=([a for a in arts if a.get("kind") != "guide" and a["category"] != "curious"] if cid == "stories" else [a for a in arts if a["category"] == cid]), acts=[x for x in _chs if x.get("category") == cid]))
    urls.append(out("/videos/", "videos.html"))
    # standalone pages that search should find (title, url, excerpt, tags); written to pages.json
    pages = []
    # Scam help (RUNBOOK §6e)
    scam = load_yaml(CONTENT / "scam_help.yaml") if (CONTENT / "scam_help.yaml").exists() else None
    if scam:
        checked = dt.date.fromisoformat(str(scam["checked"]))
        if (dt.date.today() - checked).days > 120:
            print(f"SCAM HELP WARNING: tools and routes were last verified {checked} (over 120 days ago). Re-verify per RUNBOOK §6e.")
        guides = [a for a in arts if a.get("kind") == "guide" and any(w in (a["title"] + " " + " ".join(a["tags"])).lower() for w in ("scam", "fake", "fraud"))][:6]
        tech_product = next((p for p in products.get("products", []) if p.get("id") == "techconfident"), None)
        urls.append(out("/scam-help/", "scam-help.html", scam=scam, scam_checked=checked.strftime("%-d %B %Y"),
                        scam_guides=guides, tech_product=tech_product))
        pages.append({"title": "Scam checker: check it before you act", "url": "/scam-help/", "category": "tech",
                      "excerpt": "Pick what you received and we point you to a free tool that checks it, and to the official places to report it.",
                      "tags": ["scam", "scams", "fraud", "phishing", "fake", "suspicious", "text", "email", "call"],
                      "image": "/static/og-default.png", "art": "/static/og-default.png"})
    # Fifty at Fifty (RUNBOOK §6h): the challenge catalogue, one page per challenge
    ch_file = CONTENT / "challenges.yaml"
    if ch_file.exists():
        chs = load_yaml(ch_file)
        # Reviewers' picks shared by several activities (row 17, 17 Nov 2026): `picks: <key>` points into content/picks.yaml
        _shared_picks = load_yaml(CONTENT / "picks.yaml") if (CONTENT / "picks.yaml").exists() else {}
        for c in chs:
            if isinstance(c.get("picks"), str):
                assert c["picks"] in _shared_picks, f"challenge {c['id']}: picks key {c['picks']!r} is not in content/picks.yaml"
                c["picks"] = copy.deepcopy(_shared_picks[c["picks"]])
        by_slug = {a["slug"]: a for a in arts}
        LBL = {"effort": {"gentle": "Gentle", "moderate": "Moderate", "demanding": "Demanding"},
               "cost": {"free": "Free", "low": "Under £100 / $130", "mid": "£100 to £500 / $130 to $650", "high": "Over £500 / $650"},
               "time": {"afternoon": "An afternoon", "days": "A day or a few days", "weeks": "A few weeks", "months": "Months", "year": "A year or more"},
               "setting": {"indoors": "Indoors", "outdoors": "Outdoors", "either": "Indoors or out"},
               "company": {"solo": "On your own", "others": "With others", "either": "Alone or with others"}}
        # Named groups of activities, each with its own page at /list/<slug>/ (Robin, 8 Oct 2026). A slug is permanent once live.
        COLLECTIONS = {"arts": {"slug": "arts-and-crafts", "label": "Arts and crafts", "plural": "Arts, crafts and music",
                                "blurb": "Drawing, painting, pottery, printmaking, glass, lettering, yarn, music and writing: things to make and play, with what a first class is really like, what it costs and where to find one in the UK and the US.",
                                "title": "Arts and crafts classes for beginners: where to start", "meta": "Life drawing, pottery, watercolour, linocut, stained glass, calligraphy, ukulele, knitting and writing: what a first class is like and where to find one.",
                                "note": "Course prices and dates come from each provider's own page on the day we checked it, and change; the provider's page is always the one to trust.",
                                # Sections on /list/arts-and-crafts/ (Robin, 26 Nov 2026: "Populate the arts section"). Each activity goes in the
                                # first section whose pattern matches its id or title; anything left goes in "More to make and try". `gift` is a
                                # /gifts/ group id, linked while the gift season is on.
                                "sections": [
                                    ("singing", "Singing and choirs", "Choirs with no audition, barbershop, gospel, shanties and the great choral works, and lessons for your own voice.", r"choir|\bsing|chorus|shant|messiah|cappella|operatic|gilbert|sacred-harp|chorale|choral", "music-and-dance"),
                                    ("pottery", "Pottery, clay and ceramics", "The wheel, hand-building, raku firing, painting china and sculpting in clay, with where to find a class with a kiln.", r"pott|(?<!silver-)clay|ceramic|raku|china-painting", "makers"),
                                    ("painting", "Painting, drawing and lettering", "Watercolor, acrylics, oils, pastels, life drawing, sketching outdoors, illustration and calligraphy.", r"paint|draw|sketch|watercol|pastel|gouache|illustrat|calligraph|signwrit|comic|encaustic|tempera|gild|summer-exhibition|art-society|nature-journal", "painters"),
                                    ("print", "Printmaking, paper and books", "Linocut, screen printing, etching, cyanotype, letterpress, bookbinding, origami and papercraft.", r"print|lino|etching|engrav|cyanotype|origami|paper|quill|bookbind|collage|marbl|pinhole", "painters"),
                                    ("textiles", "Yarn, thread and textiles", "Knitting, crochet, embroidery, sewing, quilting, weaving, spinning, lace, dyeing and rugs.", r"knit|crochet|embroider|stitch|needle|sew|quilt|weav(?!e-a-willow)|spin|felt|macram|lace|tatting|rug|dye|shibori|batik|silk|millin|nalbind|kumihimo|smock|sashiko|crewel|hardanger|tapestry|goldwork|tufting|blanket|smocking", "stitchers"),
                                    ("glass-metal", "Glass, metal and jewelry", "Glassblowing, stained glass, fusing, silver and beaded jewelry, enamelling, blacksmithing and knife making.", r"glass|jewel|silver|enamel|smith|knife|weld|bronze|lapidary|bead", "makers"),
                                    ("wood", "Wood, stone and things to build", "Spoon carving, woodturning, joinery, furniture, willow, leather, mosaic, stone carving and boats.", r"wood|spoon|carv|turn|joiner|chair|furniture|stone|mosaic|willow|basket|leather|shoe|boat|coracle|upholst|clock|marquetry|pyrograph|wire-sculpture|model-railway|dolls|tile-a-table", "makers"),
                                    ("music", "Learn an instrument and play with others", "From a first ukulele or tin whistle to the cello, the bagpipes and the oud, and the orchestras, bands and sessions to join.", r"learn-the-|music|band|orchestra|drum|piano|guitar|ukulele|bell|chamber|samba|gamelan|session|jam|busk|dj\b|-dj|conduct|songwrit|handpan|pipe|recorder|piece-for|jazz|steel-pan|cajon|tabla|taiko|bodhran|tin-whistle|bluegrass", "music-and-dance"),
                                    ("writing", "Writing, poetry and storytelling", "A writing course, a first draft of a book, your own life story, poetry, screenplays and telling stories out loud.", r"writ|poet|story|screenplay|memoir|life-story|storytell", "writers"),
                                    ("stage", "Stage, screen, photography and festivals", "Acting, improv, stand-up, voice work, puppetry, dance, film and photography, and the festivals worth travelling for.", r"theat|act|comed|improv|voice|film|photo|camera|animation|globe|puppet|danc|hula|swing|crier|festival|fleadh|celtic|magic", "music-and-dance"),
                                    ("more", "More to make and try", "Candles, soap, perfume, flowers, bonsai, terrariums, cake decorating and other crafts.", r".", "makers"),
                                ]},
                       "military": {"slug": "military-physical-challenges", "label": "Military physical challenge", "plural": "Military physical challenges",
                                    "blurb": "Marches, runs and loaded carries that are based on military tests or run by forces charities, and that members of the public can enter. Each is hard in its own way, and each has an official page with the entry rules.",
                                    "note": "We list an event here only when its official page shows that the public can enter and that it is still being run. Being listed does not mean the armed forces, or any charity, endorse this site."}}
        need = ("id", "title", "category", "kind", "effort", "cost", "time", "setting", "company", "regions", "why", "start", "links")
        seen, stale = set(), 0
        # The map (RUNBOOK §6h): UK areas and US states, shapes made once by tools/build_map.py from Natural Earth (public domain)
        _ms = CONTENT / "map_shapes.json"
        shapes = json.loads(_ms.read_text(encoding="utf-8")) if _ms.exists() else {"uk": {"areas": []}, "us": {"areas": []}}
        MAPS = [k for k in ("uk", "us", "ca", "world") if k in shapes]
        # Canada's provinces (Robin, 22 Nov 2026) sit in the `world` region, like the country itself
        AREA = {a["id"]: ("world" if k == "ca" else k, a["name"]) for k in MAPS for a in shapes[k]["areas"] if not (k == "world" and a["id"] in ("GBR", "USA"))}
        for c in chs:
            miss = [k for k in need if not c.get(k)]
            assert not miss, f"challenge {c.get('id')}: missing {miss}"
            assert c["id"] not in seen and re.fullmatch(r"[a-z0-9-]+", c["id"]), f"challenge id {c['id']} is duplicated or malformed"
            seen.add(c["id"])
            assert c["category"] in cfg["categories"] and all(c[k] in LBL[k] for k in LBL), f"challenge {c['id']}: unknown category or band"
            assert all(str(l.get("url", "")).startswith("https://") and l.get("label") and l.get("checked") for l in c["links"]), f"challenge {c['id']}: every link needs url, label, checked"
            assert not c.get("collection") or c["collection"] in COLLECTIONS, f"challenge {c['id']}: unknown collection {c.get('collection')}"
            assert c["id"] not in {v["slug"] for v in COLLECTIONS.values()}, f"challenge id {c['id']} clashes with a collection page"
            c["coll"] = COLLECTIONS.get(c.get("collection"))
            assert not c.get("hub") or c["hub"] in HUBS, f"challenge {c['id']}: unknown hub {c.get('hub')}"
            first = re.split(r"(?<=[.!?])\s", c["why"].strip())[0]
            c["why_short"] = first if len(first) <= 170 else first[:167].rsplit(" ", 1)[0] + "…"
            r = c["regions"]
            c["region_label"] = "" if "anywhere" in r else " and ".join(x.upper() for x in r if x != "world")
            # what a search result shows: the activity, then what the page gives (how to start, the official links)
            c["seo"] = next((t for t in (c["title"] + ": how to start and where to go", c["title"] + ": how to start", c["title"]) if len(t) <= 60), c["title"])
            tail = " How to start, and the official " + ("link." if len(c["links"]) == 1 else "links.")
            c["meta"] = c["why_short"] + tail if len(c["why_short"]) + len(tail) <= 155 else c["why_short"]
            c["multi_region"] = len({l.get("region") for l in c["links"]}) > 1
            oldest = min(dt.date.fromisoformat(str(l["checked"])) for l in c["links"])
            c["checked_human"] = oldest.strftime("%-d %B %Y")
            stale += (dt.date.today() - oldest).days > 183
            c["guide_art"], c["story_art"] = by_slug.get(c.get("guide")), by_slug.get(c.get("story"))
            for pl in c.get("places") or []:
                assert pl in AREA and AREA[pl][0] in c["regions"], f"challenge {c['id']}: place {pl} is unknown or outside its regions"
            c["place_label"] = ", ".join(AREA[pl][1] for pl in (c.get("places") or [])[:3]) + (f" and {len(c['places']) - 3} more" if len(c.get("places") or []) > 3 else "")
            # Inspiration (Robin, 27 Oct 2026): real people who have done it. `read` = an outside article, `film` = a YouTube film.
            ins = []
            for it in c.get("inspire") or []:
                k = it.get("kind")
                assert k in ("read", "film") and it.get("person") and it.get("line") and it.get("checked"), f"challenge {c['id']}: inspire items need kind read/film, person, line, checked"
                if k == "read":
                    assert str(it.get("url", "")).startswith("https://") and it.get("title") and it.get("outlet"), f"challenge {c['id']}: a read needs url, title, outlet"
                else:
                    assert re.fullmatch(r"[A-Za-z0-9_-]{11}", str(it.get("id", ""))) and it.get("title") and it.get("channel"), f"challenge {c['id']}: a film needs id, title, channel"
                    if not _shown.get(it["id"], True): print(f"LIST WARNING: film {it['id']} on {c['id']} held back (not confirmed by YouTube)"); continue
                ins.append(it)
            c["inspire_items"] = ins
            # Photograph (extra job 28 Oct 2026): same rules, licences and checks as a story's (RUNBOOK §6l), keyed list-<id>
            c["photo"] = story_photo(c, f"list-{c['id']}", credits)
            for k in c.get("kit") or []:
                assert k.get("name") and k.get("why") and str(k.get("url", "")).startswith("https://www.amazon.co.uk/"), f"challenge {c['id']}: kit items need name, why and an amazon.co.uk url (app.js swaps in the US store)"
            # Reviewers' picks (Robin, 12 Nov 2026: "the best option, a good option and the cheapest good option, with
            # reviews and links"; "use, quote and reference independent reviewers"). Every pick is a named product that a
            # named independent reviewer recommends, with the reviewer's own label and a short quote copied from the review
            # opened on `checked`. We never rank anything ourselves, never give prices, and never claim we tested it.
            pk = c.get("picks")
            if pk:
                assert pk.get("item") and pk.get("why") and pk.get("options"), f"challenge {c['id']}: picks need item, why and options"
                order = {"top": 0, "good": 1, "value": 2}
                for o in pk["options"]:
                    assert o.get("tier") in order and o.get("name") and o.get("label") and o.get("quote") and o.get("reviewer"), f"challenge {c['id']}: each pick needs tier top/good/value, name, label, quote and reviewer"
                    assert len(str(o["quote"]).split()) <= 30, f"challenge {c['id']}: a pick's quote is at most 30 words (short quotation only)"
                    r = o.get("review") or {}
                    assert r.get("title") and str(r.get("url", "")).startswith("https://") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(r.get("checked", ""))), f"challenge {c['id']}: each pick needs review title, url and checked date"
                    assert str(o.get("buy", "")).startswith("https://www.amazon.co.uk/"), f"challenge {c['id']}: a pick's buy link is an amazon.co.uk url (app.js swaps in the US store)"
                    assert not re.search(r"[£$€]\s?\d", str(o["quote"])), f"challenge {c['id']}: no prices in picks (they change)"
                pk["options"] = sorted(pk["options"], key=lambda o: order[o["tier"]])
                _d = max(o["review"]["checked"] for o in pk["options"])
                pk["checked_human"] = dt.datetime.strptime(_d, "%Y-%m-%d").strftime("%-d %B %Y")
            for b in c.get("book") or []:
                assert b.get("label") and b.get("why") and str(b.get("url", "")).startswith("https://") and b.get("aff") in (None, "viator", "getyourguide"), f"challenge {c['id']}: book items need label, why, url and aff viator/getyourguide or none"
            # Depth for search (Robin, 27 Oct 2026: someone who types the activity into Google should land on our page and
            # find it informative and inspiring). `detail` = headed sections, `faq` = the questions people actually search,
            # `sources` = every page the extra text rests on, opened on its `checked` date. `seo_title`/`description` override.
            for sec in c.get("detail") or []:
                assert sec.get("h") and (sec.get("p") or sec.get("list") or sec.get("table")), f"challenge {c['id']}: each detail section needs h and p, list or table"
                assert all(isinstance(x, str) for x in (sec.get("p") or []) + (sec.get("list") or [])) and all(isinstance(x, (str, int, float)) for r in (sec.get("table") or {}).get("rows", []) for x in r), f"challenge {c['id']}: a detail paragraph, list item or table cell is not plain text (quote text that contains a colon)"
                if sec.get("table"):
                    assert sec["table"].get("head") and all(len(r) == len(sec["table"]["head"]) for r in sec["table"].get("rows", [])), f"challenge {c['id']}: table rows must match head"
            for f in c.get("faq") or []:
                assert f.get("q") and f.get("a"), f"challenge {c['id']}: each faq needs q and a"
            if c.get("detail") or c.get("faq"):
                assert c.get("sources") and all(str(x.get("url", "")).startswith("https://") and x.get("label") and x.get("checked") for x in c["sources"]), f"challenge {c['id']}: detail and faq need sources with url, label, checked"
            if c.get("sources"): c["sources_checked"] = max(dt.date.fromisoformat(str(x["checked"])) for x in c["sources"]).strftime("%-d %B %Y")
            lk = Linker(terms, f"/list/{c['id']}/")
            for sec in c.get("detail") or []:
                ps = sec.get("p") or []
                sec["p_html"] = [lk.plain(x) for x in ([ps] if isinstance(ps, str) else ps)]
                if sec.get("after"): sec["after_html"] = lk.plain(sec["after"])
            mk = _ch_kw.get(c["id"], set())
            shown = {c.get("story"), c.get("guide")}
            rn = sorted((a for a in arts if a["slug"] not in shown), key=lambda a: (-(3 * len(mk & _art_kw[a["slug"]]) + (a["category"] == c["category"])), -a["date"].toordinal()))
            c["read_next"] = [a for a in rn if 3 * len(mk & _art_kw[a["slug"]]) + (a["category"] == c["category"]) >= 3][:2] or [a for a in rn if a["category"] == c["category"]][:2]
            if c.get("seo_title"): c["seo"] = c["seo_title"]
            if c.get("description"): c["meta"] = c["description"]
            # Search words (Robin, 13 Nov 2026: "I searched for pottery and nothing came up"): besides the card's own text,
            # the words of the id, search title, description, link labels, section headings and questions, once each
            _sw = " ".join([c["id"].replace("-", " "), c.get("seo_title") or "", c.get("description") or "",
                            " ".join(l["label"] for l in c["links"]), " ".join(s.get("h", "") for s in c.get("detail") or []),
                            " ".join(str(f.get("q", "")) for f in c.get("faq") or [])]).lower()
            _seen = set(); c["search_words"] = " ".join(w for w in re.findall(r"[a-z0-9']+", _sw) if len(w) > 2 and not (w in _seen or _seen.add(w)))
            c["has_story"] = bool(c["story_art"]) or any(i["kind"] == "read" for i in ins)
            c["has_film"] = any(i["kind"] == "film" for i in ins)
            for k in ("guide", "story"):
                if c.get(k) and c[k] not in by_slug: print(f"LIST WARNING: challenge {c['id']} points at a {k} that does not exist: {c[k]}")
            if c.get("local") and c["local"] not in local.get("activities", {}): c["local"] = None
        if stale: print(f"LIST WARNING: {stale} challenges have a link last checked over six months ago. Re-verify per RUNBOOK §6h.")
        # My year, the planner (RUNBOOK §6s): planning fields checked here; the planner pages read dist/planner/activities.json
        import importlib.util as _ilu
        _ps = _ilu.spec_from_file_location("planner", ROOT / "tools" / "planner.py")
        _pl = _ilu.module_from_spec(_ps); _ps.loader.exec_module(_pl)
        _pdata, _pwarn = _pl.prepare(chs, ROOT)
        for w in _pwarn: print(f"LIST WARNING: planner: {w}")
        (DIST / "planner").mkdir(parents=True, exist_ok=True)
        (DIST / "planner" / "activities.json").write_text(json.dumps(_pdata, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        # the engine's training, dated by the planner (day 6): one file per event, loaded only by a plan that trains
        (DIST / "planner" / "training").mkdir(parents=True, exist_ok=True)
        for _eid, _tr in _pl.training(_pdata, ROOT).items():
            (DIST / "planner" / "training" / f"{_eid}.json").write_text(json.dumps(_tr, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        _pby = {a["id"]: a for a in _pdata["activities"]}
        for c in chs: c["plan"] = _pby[c["id"]]
        colls = [dict(v, id=k, acts=[c for c in chs if c.get("collection") == k]) for k, v in COLLECTIONS.items()]
        colls = [v for v in colls if v["acts"]]
        area_n = {}
        for c in chs:
            for pl in c.get("places") or []: area_n[pl] = area_n.get(pl, 0) + 1
        out("/account/", "account.html")   # sign-in for Planner Plus (RUNBOOK §6t day 12): noindex, not in the sitemap, linked from nowhere yet
        out("/redeem/", "account.html", redeem=True)   # the address on the gift card (day 16): the account page with "Use a gift code" first
        out("/my-year/", "my-year.html")   # My year (RUNBOOK §6s): not in the sitemap until the planner launches (day 14)
        # the Planner Plus sales, gift and terms pages (RUNBOOK §6t day 19): noindex and out of the sitemap until launch (plus.paywall)
        for _pu, _pt in (("/planner-plus/", "plus.html"), ("/planner-plus/gift/", "plus-gift.html"), ("/planner-plus/terms/", "plus-terms.html")):
            _u = out(_pu, _pt)
            if _paywall: urls.append(_u)
        # the one worked sample plan non-members see (RUNBOOK §6t day 15): noindex, not in the sitemap until launch
        _sp = _pdata["sample"]; _sc = next((c for c in chs if c["id"] == _sp["activity"]), None)
        assert _sc is not None, f"planner plus.sample_plan: no activity {_sp['activity']}"
        _u = out("/planner-plus/sample/", "plus-sample.html", c=_sc, sample=_sp, pset={"steps": _pdata["steps"], "notes": _pdata["notes"], "trip": _pdata["trip"], "plus": _pdata["plus"], "picks": _pdata["picks"]},
            pkind=_pdata["kinds"][_sc["kind"]], pext={i: _pby[i] for i in [n[0] for n in _sc["plan"]["nearby"]] + _sc["plan"]["goes"]})
        if _paywall: urls.append(_u)   # launch: the sample is a public page (My year and the account stay noindex: personal, nothing to index)
        urls.append(out("/list/", "list.html", challenges=chs, L=LBL, used_cats={c["category"] for c in chs}, colls=colls, shapes=shapes, area_n=area_n))
        # the world map is loaded only when a reader opens its tab: a file of clickable country shapes
        if "world" in shapes:
            (DIST / "static" / "map").mkdir(parents=True, exist_ok=True)
            parts = []
            for a in shapes["world"]["areas"]:
                n, nm = area_n.get(a["id"], 0), html.escape(a["name"])
                if a["id"] in ("GBR", "USA") or (a["id"] == "CAN" and "ca" in shapes):   # these open their own detailed maps
                    k = {"GBR": "uk", "USA": "us", "CAN": "ca"}[a["id"]]
                    parts.append(f'<path d="{a["d"]}" class="has jump" data-jump="{k}" data-name="{nm}" tabindex="0" role="button" aria-label="{nm}: open the detailed map"><title>{nm}: open the detailed map</title></path>')
                elif n:
                    parts.append(f'<path d="{a["d"]}" class="has" data-area="{a["id"]}" data-name="{nm}" tabindex="0" role="button" aria-label="{nm}: {n} {"activity" if n == 1 else "activities"}"><title>{nm}: {n}</title></path>')
                else:
                    parts.append(f'<path d="{a["d"]}" data-area="{a["id"]}" data-name="{nm}" aria-hidden="true"><title>{nm}</title></path>')
            (DIST / "static" / "map" / "world.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{shapes["world"]["viewBox"]}" role="group" aria-label="Map of the world">{"".join(parts)}</svg>', encoding="utf-8")
        for v in colls:
            if v.get("sections") and not isinstance(v["sections"][0], dict):
                left, secs = list(v["acts"]), []
                for sid, lab, intro, pat, gid in v["sections"]:
                    rx = re.compile(pat)
                    mine = [c for c in left if rx.search(c["id"]) or rx.search(c["title"].lower())]
                    left = [c for c in left if c not in mine]
                    if mine: secs.append({"id": sid, "label": lab, "intro": intro, "acts": mine, "gift": gid})
                v["sections"] = secs
            item_list = [{"@type": "ListItem", "position": n, "name": c["title"], "url": f"{cfg['site']['url']}/list/{c['id']}/"} for n, c in enumerate(v["acts"], 1)]
            urls.append(out(f"/list/{v['slug']}/", "collection.html", coll=v, L=LBL, total=len(chs), item_list=item_list))
            if v["id"] == "arts":
                pages.append({"title": v["title"], "url": f"/list/{v['slug']}/", "category": "think", "excerpt": v["blurb"],
                              "tags": ["arts", "art", "crafts", "craft", "music", "painting", "pottery", "classes", "instrument", "gifts", "activities"],
                              "image": "/static/og-default.png", "art": "/static/og-default.png"})
                continue
            pages.append({"title": f"{v['plural']} you can enter", "url": f"/list/{v['slug']}/", "category": "move", "excerpt": v["blurb"],
                          "tags": ["military", "challenge", "challenges", "march", "tab", "ruck", "yomp", "army", "marines", "paras", "activities"],
                          "image": "/static/og-default.png", "art": "/static/og-default.png"})
        # Group pages (content/groups.yaml): one page per group at /list/<slug>/, linked from the tiles on /list/ and the home page.
        _gby = {c["id"]: c for c in chs}
        for g in GROUPS:
            g["acts"] = [_gby[i] for i in g["ids"] if i in _gby]
            if g.get("page") == "collection": continue
            gv = {"id": g["key"], "slug": g["slug"], "plural": g["label"], "label": g["label"], "blurb": g["meta"], "title": g["title"], "meta": g["meta"],
                  "acts": g["acts"], "group": True,
                  "note": "Prices, dates and entry rules come from each organiser's own page on the day we checked it, and change; the organiser's page is always the one to trust."}
            item_list = [{"@type": "ListItem", "position": n, "name": c["title"], "url": f"{cfg['site']['url']}/list/{c['id']}/"} for n, c in enumerate(gv["acts"], 1)]
            urls.append(out(f"/list/{g['slug']}/", "collection.html", coll=gv, L=LBL, total=len(chs), item_list=item_list))
            pages.append({"title": g["title"], "url": f"/list/{g['slug']}/", "category": "explore", "excerpt": g["meta"],
                          "tags": ["activities", "things", "to", "do"] + re.findall(r"[a-z]+", g["label"].lower()),
                          "image": "/static/og-default.png", "art": "/static/og-default.png"})
        # Kit (Robin, 20 Nov 2026): many independent reviews per product type, consolidated into scores and picks by
        # tools/kitscore.py (method explained on /kit/how-we-score/). One content/kit/<type>.yaml per type.
        import importlib.util as _ilu
        _ks = _ilu.spec_from_file_location("kitscore", ROOT / "tools" / "kitscore.py"); _km = _ilu.module_from_spec(_ks); _ks.loader.exec_module(_km)
        _norm = lambda n: re.sub(r"\s*\(.*?\)", "", str(n).lower()).strip()
        KIT = []
        for _kf in sorted((CONTENT / "kit").glob("*.yaml")) if (CONTENT / "kit").exists() else []:
            _kd = load_yaml(_kf)
            _sc = _km.score_type(_kd)
            if not _sc["main"]:
                print(f"KIT WARNING: {_kf.name} has no product recommended in two or more reviews; not published"); continue
            t = dict(_kd, **_sc)
            t["rev"] = {r["id"]: r for r in _kd["reviews"]}
            t["checked_human"] = dt.date.fromisoformat(max(str(r["checked"]) for r in _kd["reviews"])).strftime("%-d %B %Y")
            names = {_norm(n) for n in _kd.get("kit_names") or []}
            t["acts"] = [c for c in chs if any(_norm(k["name"]) in names for k in c.get("kit") or [])]
            _aid = {c["id"] for c in t["acts"]}
            t["groups"] = [g["key"] for g in GROUPS if _aid & set(g["ids"])]
            KIT.append(t)
        for c in chs:
            c["kit_types"] = [t for t in KIT if c in t["acts"]]
        if KIT:
            kit_groups = [{"key": g["key"], "label": g["label"]} for g in GROUPS if any(g["key"] in t["groups"] for t in KIT)]
            urls.append(out("/kit/", "kit.html", kit_types=KIT, kit_groups=kit_groups))
            urls.append(out("/kit/how-we-score/", "kit-method.html"))
            for t in KIT:
                item_list = [{"@type": "ListItem", "position": n, "name": p["name"]} for n, p in enumerate(t["main"], 1)]
                urls.append(out(f"/kit/{t['id']}/", "kit-type.html", t=t, item_list=item_list))
                pages.append({"title": t["title"], "url": f"/kit/{t['id']}/", "category": "explore", "excerpt": t["description"],
                              "tags": ["kit", "best", "review", "reviews"] + re.findall(r"[a-z]+", t["name"].lower()) + [w for p in t["main"] for w in re.findall(r"[a-z]+", p["name"].lower())][:60],
                              "image": "/static/og-default.png", "art": "/static/og-default.png"})
        pages.append({"title": "Things to do: activities worth trying, and a list of your own", "url": "/list/", "category": "explore",
                      "excerpt": "Pick the ones you fancy, at any age. Each has how to start and where to go. Choose your own number and tick them off in your own time.",
                      "tags": ["list", "fifty", "activity", "activities", "challenge", "challenges", "bucket", "goals", "things", "to", "do"],
                      "image": "/static/og-default.png", "art": "/static/og-default.png"})
        for c in chs:
            more = [m for m in chs if m is not c and m["category"] == c["category"]]
            more = sorted(more, key=lambda m: (not (c.get("collection") and m.get("collection") == c.get("collection")), m["effort"] != c["effort"], m["kind"] != c["kind"]))
            # `related: [ids]` (full guides, RUNBOOK §6p): hand-picked next activities, any topic, shown first under "More like this".
            _by_id = {m["id"]: m for m in chs}
            for r in c.get("related") or []:
                assert r in _by_id and r != c["id"], f"challenge {c['id']}: related id {r} does not exist"
            rel = [_by_id[r] for r in c.get("related") or []]
            # reverse links (Robin, 7 Nov 2026: related activities should lead readers on): pages that list this one as related
            rel += [m for m in chs if m is not c and c["id"] in (m.get("related") or []) and m not in rel]
            more = (rel + [m for m in more if m not in rel])[:max(6 if c.get("collection") else 4, min(len(rel), 8))]
            urls.append(out(f"/list/{c['id']}/", "challenge.html", c=c, L=LBL, more=more, total=len(chs), pset={"steps": _pdata["steps"], "notes": _pdata["notes"], "trip": _pdata["trip"], "plus": _pdata["plus"], "picks": _pdata["picks"]}, pkind=_pdata["kinds"][c["kind"]],
                            pext={i: _pby[i] for i in [n[0] for n in c["plan"]["nearby"]] + c["plan"]["goes"]}))
            pages.append({"title": c["title"], "key": c.get("seo_title") or "", "url": f"/list/{c['id']}/", "category": c["category"], "excerpt": c["why_short"],
                          "tags": ["activity", "challenge", c["kind"], c["effort"]] + ([c["collection"]] if c.get("collection") else []) + c["search_words"].split(),
                          "image": (c.get("photo") or {}).get("small") or "/static/og-default.png", "art": (c.get("photo") or {}).get("small") or "/static/og-default.png"})
    # Deep hubs (RUNBOOK §6u): /<slug>/ with the event finder, /<slug>/<guide>/ for each guide
    _chs_by = {c["id"]: c for c in (chs if "chs" in locals() else [])}
    BANDS_ULTRA = [("u100", "Under 100 km", 0, 99.9), ("100k", "100 to 149 km", 100, 149.9), ("100m", "About 100 miles (150 to 180 km)", 150, 180), ("long", "Over 180 km", 180.1, 99999)]
    MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    for h in HUBS.values():
        F = h["facets"]
        # A hub may set its own distance bands ([id, label, min km, max km]); [] means no distance filter (e.g. marathons, all 42.2 km)
        BANDS = [tuple(b) for b in h["bands_def"]] if "bands_def" in h else BANDS_ULTRA
        assert h["slug"] not in cfg["categories"] and h["slug"] not in ("list", "scam-help", "shop", "puzzle"), f"hub {h['id']}: slug clashes with a page"
        seen_e = set()
        # `kind: phenomenon` (Nature's spectacles, 19 Nov 2026): no km, distances, terrain, format, entry or series; instead
        # `type` (facet), `see` (list, facet: how you see it), `see_note`, optional `when` (a one-off date in words) and `more` (extra official links)
        PHEN = h.get("kind") == "phenomenon"
        assert h.get("kind", "race") in ("race", "phenomenon"), f"hub {h['id']}: kind is race or phenomenon"
        if PHEN:
            BANDS = []
        for e in h["events"]:
            need = ("id", "name", "type", "place", "country", "continent", "see", "see_note", "note", "link") if PHEN else ("id", "name", "series", "place", "country", "continent", "km", "distances", "terrain", "format", "entry", "entry_note", "note", "link")
            miss = [k for k in need if not e.get(k)]
            assert not miss, f"hub {h['id']} event {e.get('id')}: missing {miss}"
            assert e["id"] not in seen_e and re.fullmatch(r"[a-z0-9-]+", e["id"]), f"hub {h['id']}: event id {e['id']} duplicated or malformed"
            seen_e.add(e["id"])
            # optional `activity`: the Things to do id with our how-to-start guide for this event (shown both ways)
            assert not e.get("activity") or e["activity"] in _chs_by, f"hub {h['id']} event {e['id']}: unknown activity {e.get('activity')}"
            e["act"] = _chs_by.get(e.get("activity") or "")
            # Priority step 6 (RUNBOOK §6u, 25 Nov 2026): "Plan this race". A race hub may set `plan_activity` (a Things to do id whose
            # planner trains with an engine event, §6r) and a race may override it; the race page links to that activity's planner,
            # with ?on=<race day> when the note says "... is on <day> <month> <year>" in its first sentence and that day is still to come.
            _pa = e.get("plan_activity") or h.get("plan_activity")
            e["plan_act"], e["race_day"] = None, None
            if _pa and not PHEN:
                assert _pa in _chs_by and ((_chs_by[_pa].get("plan") or {}).get("event")), f"hub {h['id']} event {e['id']}: plan_activity {_pa} is not an activity with an engine training plan"
                e["plan_act"] = _chs_by[_pa]
                _m1 = re.search(r"\bis on (?:[A-Z][a-z]+day )?(\d{1,2}) (" + "|".join(MONTHS) + r") (20\d\d)\b", re.split(r"(?<=\.)\s", e["note"])[0])
                if _m1:
                    _rd = dt.date(int(_m1.group(3)), MONTHS.index(_m1.group(2)) + 1, int(_m1.group(1)))
                    if _rd >= dt.date.today():
                        e["race_day"] = {"iso": _rd.isoformat(), "human": _rd.strftime("%A %-d %B %Y"), "year": _rd.year}
            if PHEN:
                assert e["continent"] in F["continent"] and e["type"] in F["type"] and all(x in F["see"] for x in e["see"]), f"hub {h['id']} event {e['id']}: unknown facet value"
                e.setdefault("km", []); e.setdefault("terrain", []); e.setdefault("entry", []); e.setdefault("series", ""); e.setdefault("format", ""); e.setdefault("distances", ""); e.setdefault("entry_note", "")
            else:
                assert e["continent"] in F["continent"] and e["series"] in F["series"] and all(t in F["terrain"] for t in e["terrain"]) and all(x in F["entry"] for x in e["entry"]), f"hub {h['id']} event {e['id']}: unknown facet value"
                assert e["format"] in ("single", "stage", "timed"), f"hub {h['id']} event {e['id']}: format is single, stage or timed"
            assert all(1 <= m <= 12 for m in e.get("month") or []), f"hub {h['id']} event {e['id']}: months are 1 to 12"
            for L_ in [e["link"]] + list(e.get("more") or []):
                assert str(L_.get("url", "")).startswith("https://") and L_.get("label") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(L_.get("checked", ""))), f"hub {h['id']} event {e['id']}: link needs https url, label, checked"
                L_["checked_human"] = dt.date.fromisoformat(str(L_["checked"])).strftime("%-d %B %Y")
            assert not re.search(r"[£$€]\s?\d", e["note"] + e["entry_note"] + e["distances"] + e.get("see_note", "") + e.get("when", "") + e.get("walkers_note", "") + e.get("time_limit_text", "")), f"hub {h['id']} event {e['id']}: no prices (they change)"
            # Priority step 3 (RUNBOOK §6u, 22 Nov 2026): optional `time_limit` (list of {km, hours} from the official page; a page that gives
            # a rate such as "2.5 hours per 10 km" is stored as {km: 10, hours: 2.5} with `time_limit_text` in the page's terms) and
            # `walkers: true` with `walkers_note`, only where the organizer's page welcomes walkers or offers an early start for slower runners.
            # `pace` tokens drive the finder's Pace filter: "walkers", and "slow" when a stated limit allows 12+ minutes per km (a computed fact).
            e["pace"] = []
            for t in e.get("time_limit") or []:
                assert float(t.get("km", 0)) > 0 and float(t.get("hours", 0)) > 0, f"hub {h['id']} event {e['id']}: time_limit items need km and hours"
            # A hub may set `pace_slow_min_km` (default 12) and `pace_slow_label`; marathons use 9.9 (a 7-hour limit or longer).
            # `no_time_limit: true` (with `time_limit_text` in the organizer's words) is for a race whose page says there is no limit.
            _slow = float(h.get("pace_slow_min_km", 12))
            assert not (e.get("no_time_limit") and e.get("time_limit")), f"hub {h['id']} event {e['id']}: no_time_limit or time_limit, not both"
            if e.get("time_limit"):
                _hf = lambda x: f"{x:g}"
                e["tl_label"] = e.get("time_limit_text") or "; ".join(f"{_hf(t['hours'])} hours for {round(t['km'] / 1.609344):,} miles ({_hf(t['km'])} km)" for t in e["time_limit"])
                if any(t["hours"] * 60 / t["km"] >= _slow for t in e["time_limit"]):
                    e["pace"].append("slow")
            elif e.get("no_time_limit"):
                assert e.get("time_limit_text"), f"hub {h['id']} event {e['id']}: no_time_limit needs time_limit_text"
                e["tl_label"] = e["time_limit_text"]
                e["pace"].append("slow")
            assert not e.get("time_limit_text") or e.get("time_limit") or e.get("no_time_limit"), f"hub {h['id']} event {e['id']}: time_limit_text needs time_limit"
            assert bool(e.get("walkers")) == bool(e.get("walkers_note")), f"hub {h['id']} event {e['id']}: walkers needs walkers_note (and the reverse)"
            if e.get("walkers"):
                e["pace"].insert(0, "walkers")
            e["bands"] = sorted({b[0] for k in e["km"] for b in BANDS if b[2] <= k <= b[3]})
            if (PHEN or h.get("month_range")) and e.get("month"):
                # Months that wrap the year (September to April) read as a range; otherwise a list
                ms = e["month"]
                e["month_label"] = f"{MONTHS[ms[0] - 1]} to {MONTHS[ms[-1] - 1]}" if len(ms) > 2 else " and ".join(MONTHS[m - 1] for m in ms)
            else:
                e["month_label"] = " or ".join(MONTHS[m - 1] for m in e.get("month") or [])
            e["search"] = " ".join(x for x in [e["name"], e["place"], e["country"], e["distances"], F.get("type", {}).get(e.get("type"), "")] if x).lower()
        h["events"] = sorted(h["events"], key=lambda e: (list(F["continent"]).index(e["continent"]), e["name"].lower()))
        h["bands"] = [b[:2] for b in BANDS if any(b[0] in e["bands"] for e in h["events"])]
        h["used"] = {"terrain": {t for e in h["events"] for t in e["terrain"]}, "entry": {x for e in h["events"] for x in e["entry"]}, "series": {e["series"] for e in h["events"]},
                     "type": {e.get("type") for e in h["events"] if e.get("type")}, "see": {x for e in h["events"] for x in e.get("see") or []}, "pace": {x for e in h["events"] for x in e.get("pace") or []}}
        h["months"] = [(i + 1, MONTHS[i]) for i in range(12) if any(i + 1 in (e.get("month") or []) for e in h["events"])]
        # Entry calendar (RUNBOOK §6u priority step 4, 23 Nov 2026): optional `entry_dates` on a race, each {date: YYYY-MM-DD or
        # month: YYYY-MM, what (the organizer's terms), url, checked}, only as the official page shows them, with the year.
        # Dates before the build day drop out at each build (hub.js also hides any that pass between builds).
        _td = dt.date.today()
        h["entry_cal"] = []
        for e in h["events"]:
            e["entry_dates_up"] = []
            for d in e.get("entry_dates") or []:
                assert bool(d.get("date")) != bool(d.get("month")), f"hub {h['id']} event {e['id']}: an entry date needs date or month (not both)"
                assert d.get("what") and str(d.get("url", "")).startswith("https://") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("checked", ""))), f"hub {h['id']} event {e['id']}: an entry date needs what, https url, checked"
                assert not re.search(r"[£$€]\s?\d", d["what"]), f"hub {h['id']} event {e['id']}: no prices (they change)"
                if d.get("date"):
                    _d = dt.date.fromisoformat(str(d["date"])); d["iso"] = _d.isoformat(); d["human"] = _d.strftime("%-d %B %Y"); _end = _d
                else:
                    _y, _m = map(int, str(d["month"]).split("-")); _d = dt.date(_y, _m, 1); d["iso"] = _d.isoformat()[:7]; d["human"] = _d.strftime("%B %Y") + " (day not given yet)"
                    _end = (dt.date(_y + (_m == 12), _m % 12 + 1, 1) - dt.timedelta(days=1))
                d["end_iso"] = _end.isoformat(); d["checked_human"] = dt.date.fromisoformat(str(d["checked"])).strftime("%-d %B %Y")
                d["month_key"] = _d.strftime("%B %Y"); d["sort"] = _d.isoformat()
                if _end >= _td:
                    e["entry_dates_up"].append(d); h["entry_cal"].append((d, e))
            e["entry_dates_up"].sort(key=lambda d: d["sort"])
        h["entry_cal"].sort(key=lambda x: (x[0]["sort"], x[1]["name"].lower()))
        h["entry_soon"] = [x for x in h["entry_cal"] if dt.date.fromisoformat(x[0]["sort"]) <= _td + dt.timedelta(days=120)][:10]
        h["entry_months"] = []
        for d, e in h["entry_cal"]:
            if not h["entry_months"] or h["entry_months"][-1][0] != d["month_key"]:
                h["entry_months"].append((d["month_key"], []))
            h["entry_months"][-1][1].append((d, e))
        # The calendar page (`entry_calendar: {slug, title, intro, ...}` on a race hub with event pages): built only with 4+ dates to come
        h["entry_cal_page"] = None
        if h.get("entry_calendar") and h.get("event_pages") and len(h["entry_cal"]) >= 4:
            EC = h["entry_calendar"]
            assert re.fullmatch(r"[a-z0-9-]+", EC.get("slug", "")) and EC.get("title") and EC["slug"] not in {e["id"] for e in h["events"]} | {g["slug"] for g in h.get("guides") or []} | {L["slug"] for L in h.get("landings") or []}, f"hub {h['id']}: entry_calendar needs a free slug and a title"
            EC["url"] = f"/{h['slug']}/{EC['slug']}/"
            h["entry_cal_page"] = EC
        assert not h.get("signup_tag") or re.fullmatch(r"int-[a-z0-9-]+", h["signup_tag"]), f"hub {h['id']}: signup_tag looks like int-<subject>"
        h["acts"] = [_chs_by[i] for i in h.get("activities") or [] if i in _chs_by]
        # Real stories (RUNBOOK §6u priority step 7, 26 Nov 2026): `stories:` lists our own published articles (already sourced under
        # the house rules) by slug, with optional `events` (ids of races the story itself names) so those race pages link to it too.
        _art_by = {a["slug"]: a for a in arts}
        h["story_list"] = []
        for st in h.get("stories") or []:
            assert st.get("slug") in _art_by, f"hub {h['id']}: story {st.get('slug')!r} is not a published article slug"
            assert all(x in seen_e for x in st.get("events") or []), f"hub {h['id']} story {st['slug']}: unknown event id in events"
            h["story_list"].append({"a": _art_by[st["slug"]], "events": list(st.get("events") or [])})
        for e in h["events"]:
            e["stories"] = [st for st in h["story_list"] if e["id"] in st["events"]]
        h["checked_human"] = max(dt.date.fromisoformat(str(e["link"]["checked"])) for e in h["events"]).strftime("%-d %B %Y")
        lk = Linker(terms, f"/{h['slug']}/")
        for g in h.get("guides") or []:
            # `by_month: true` (phenomenon hubs, 25 Nov 2026): the build lists every entry under each of its usual months, from the
            # rows themselves, so the guide's facts are the rows' own (each with its official link); `sources` is then optional.
            g["month_lists"] = []
            if g.get("by_month"):
                assert PHEN, f"hub guide {g.get('slug')}: by_month is for phenomenon hubs"
                g["month_lists"] = [(MONTHS[m - 1], [e for e in h["events"] if m in (e.get("month") or [])]) for m in range(1, 13)]
                g["month_lists"] = [x for x in g["month_lists"] if x[1]]
                g["one_offs"] = [e for e in h["events"] if not e.get("month") and e.get("when")]
                g.setdefault("sources", [])
            assert re.fullmatch(r"[a-z0-9-]+", g.get("slug", "")) and g.get("title") and g.get("standfirst") and g.get("detail") and (g.get("sources") or g.get("by_month")), f"hub {h['id']}: a guide needs slug, title, standfirst, detail, sources"
            for sec in g["detail"]:
                assert sec.get("h") and (sec.get("p") or sec.get("list") or sec.get("table")), f"hub guide {g['slug']}: each section needs h and p, list or table"
                if sec.get("table"):
                    assert all(len(r) == len(sec["table"]["head"]) for r in sec["table"]["rows"]), f"hub guide {g['slug']}: table rows must match head"
                sec["p_html"] = [lk.plain(x) for x in sec.get("p") or []]
            for k in g.get("kit") or []:
                assert k.get("name") and k.get("why") and str(k.get("url", "")).startswith("https://www.amazon.co.uk/"), f"hub guide {g['slug']}: kit needs name, why, amazon.co.uk url"
            # `kit_type: <id>` links the guide to our consolidated reviews page /kit/<id>/ (RUNBOOK §6w, §6u step 5)
            if g.get("kit_type"):
                _kt = [t for t in KIT if t["id"] == g["kit_type"]]
                assert _kt, f"hub guide {g['slug']}: kit_type {g['kit_type']!r} is not a published /kit/ page"
                g["kit_type_obj"] = _kt[0]
            # Reviewers' picks on hub guides (RUNBOOK §6u priority step 5, 24 Nov 2026): `picks:` is a list of blocks in the
            # activity shape (§6t row 17: item, why, options of tier top|good|value, name, the reviewer's own label, a quote of
            # at most 30 words copied from the review opened on `checked`, reviewer, review, Amazon UK search `buy`), or keys
            # into content/picks.yaml. Top only for the reviewer's overall pick, value only for its budget pick; no prices.
            _gp = []
            for pk in g.get("picks") or []:
                if isinstance(pk, str):
                    _sp = load_yaml(CONTENT / "picks.yaml") if (CONTENT / "picks.yaml").exists() else {}
                    assert pk in _sp, f"hub guide {g['slug']}: picks key {pk!r} is not in content/picks.yaml"
                    pk = copy.deepcopy(_sp[pk])
                assert pk.get("item") and pk.get("why") and pk.get("options"), f"hub guide {g['slug']}: picks need item, why and options"
                _order = {"top": 0, "good": 1, "value": 2}
                for o in pk["options"]:
                    assert o.get("tier") in _order and o.get("name") and o.get("label") and o.get("quote") and o.get("reviewer"), f"hub guide {g['slug']}: each pick needs tier top/good/value, name, label, quote and reviewer"
                    assert len(str(o["quote"]).split()) <= 30, f"hub guide {g['slug']}: a pick's quote is at most 30 words"
                    r = o.get("review") or {}
                    assert r.get("title") and str(r.get("url", "")).startswith("https://") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(r.get("checked", ""))), f"hub guide {g['slug']}: each pick needs review title, url and checked date"
                    assert str(o.get("buy", "")).startswith("https://www.amazon.co.uk/"), f"hub guide {g['slug']}: a pick's buy link is an amazon.co.uk url"
                    assert not re.search(r"[£$€]\s?\d", str(o["quote"]) + str(o["label"])), f"hub guide {g['slug']}: no prices in picks"
                pk["options"] = sorted(pk["options"], key=lambda o: _order[o["tier"]])
                pk["checked_human"] = dt.datetime.strptime(max(str(o["review"]["checked"]) for o in pk["options"]), "%Y-%m-%d").strftime("%-d %B %Y")
                _gp.append(pk)
            g["picks"] = _gp
            assert all(str(x.get("url", "")).startswith("https://") and x.get("label") and x.get("checked") for x in g["sources"]), f"hub guide {g['slug']}: sources need url, label, checked"
            _gd = [dt.date.fromisoformat(str(x["checked"])) for x in g["sources"]] + ([dt.date.fromisoformat(str(e["link"]["checked"])) for _, es in g["month_lists"] for e in es] if g.get("by_month") else [])
            g["sources_checked"] = max(_gd).strftime("%-d %B %Y")
            g["url"] = f"/{h['slug']}/{g['slug']}/"
        # Landing pages for common filters (RUNBOOK §6u priority step 2, 21 Nov 2026): /<slug>/<landing slug>/, each a real page
        # listing the races that match one filter. A race hub opts in with `landings:` (list) and optional `landing_months: true`
        # (a page per usual month with enough races). Intro facts are computed from the rows; a page needs at least 4 races.
        h["landing_pages"] = []
        if h.get("landings") or h.get("landing_months"):
            assert not PHEN and h.get("event_pages"), f"hub {h['id']}: landings need a race hub with event_pages"
            for e in h["events"]:
                e["url"] = f"/{h['slug']}/{e['id']}/"
            _taken = {g["slug"] for g in h.get("guides") or []} | {e["id"] for e in h["events"]}
            _defs = list(h.get("landings") or [])
            if h.get("landing_months"):
                _mn = h.get("landing_noun") or (h.get("words") or "races").capitalize()
                _defs += [{"slug": f"in-{MONTHS[m - 1].lower()}", "title": f"{_mn} in {MONTHS[m - 1]}", "short": MONTHS[m - 1], "group": "Usual month", "filter": {"month": m}}
                          for m in range(1, 13) if sum(1 for e in h["events"] if m in (e.get("month") or [])) >= 4]
            _ok_keys = {"country_has", "continent", "band", "format", "month", "entry", "not_entry", "series", "terrain", "pace"}
            def _match(e, f):
                return ((not f.get("country_has") or f["country_has"] in e["country"]) and (not f.get("continent") or e["continent"] == f["continent"])
                        and (not f.get("band") or f["band"] in e["bands"]) and (not f.get("format") or e["format"] == f["format"])
                        and (not f.get("month") or f["month"] in (e.get("month") or [])) and (not f.get("entry") or f["entry"] in e["entry"])
                        and (not f.get("not_entry") or f["not_entry"] not in e["entry"]) and (not f.get("series") or e["series"] == f["series"])
                        and (not f.get("terrain") or f["terrain"] in e["terrain"]) and (not f.get("pace") or f["pace"] in e["pace"]))
            for L in _defs:
                assert re.fullmatch(r"[a-z0-9-]+", L.get("slug", "")) and L.get("title") and L.get("short") and L.get("group") and L.get("filter"), f"hub {h['id']}: a landing needs slug, title, short, group, filter"
                assert L["slug"] not in _taken, f"hub {h['id']}: landing {L['slug']} clashes with a race id, guide or another landing"
                assert set(L["filter"]) <= _ok_keys, f"hub {h['id']} landing {L['slug']}: unknown filter key"
                _taken.add(L["slug"])
                L["events"] = [e for e in h["events"] if _match(e, L["filter"])]
                assert len(L["events"]) >= 4, f"hub {h['id']} landing {L['slug']}: only {len(L['events'])} races (a page needs at least 4)"
                L["url"] = f"/{h['slug']}/{L['slug']}/"
                _ev = L["events"]; _w = h.get("words") or "races"
                _kms = [k for e in _ev for k in e["km"]]
                _fmt = lambda k: f"{k:,.1f}".rstrip("0").rstrip(".")
                # One distance throughout (marathons): say so once rather than "from 42.2 km to 42.2 km"
                facts = [f"{len(_ev)} {_w} on this page, " + (f"all {_fmt(min(_kms))} km." if min(_kms) == max(_kms) else f"with main distances from {_fmt(min(_kms))} km to {_fmt(max(_kms))} km.")]
                _cn = sorted({e["country"] for e in _ev})
                if not L["filter"].get("country_has") and len(_cn) > 1:
                    facts.append(f"They are in {len(_cn)} countries or areas.")
                _ms = sorted({m for e in _ev for m in e.get("month") or []})
                if not L["filter"].get("month") and _ms:
                    facts.append("Usual months run across " + (f"{len(_ms)} months of the year." if len(_ms) > 3 else " and ".join(MONTHS[m - 1] for m in _ms) + "."))
                _ent = [(k, sum(1 for e in _ev if k in e["entry"])) for k in F["entry"]]
                _ent = [(k, n) for k, n in _ent if n and k != L["filter"].get("entry")]
                if _ent:
                    facts.append("How you get a place: " + "; ".join(f"{F['entry'][k].lower()}, {n}" for k, n in _ent) + " (some races use more than one route).")
                L["facts"] = facts
                L["item_list"] = [{"@type": "ListItem", "position": n, "name": e["name"], "url": f"{cfg['site']['url']}{e['url']}"} for n, e in enumerate(_ev, 1)]
                _t = L.get("seo_title") or f"{L['title']}: race list and how to enter"
                L["seo_title"] = _t if len(_t) <= 60 else L["title"]
                L["description"] = L.get("description") or f"{L['title']}: {len(_ev)} {_w} checked on their organisers' pages, with distances, usual month, terrain and how entry works."
                h["landing_pages"].append(L)
            for e in h["events"]:
                e["landings"] = [L for L in h["landing_pages"] if e in L["events"]]
            h["landing_groups"] = []
            for L in h["landing_pages"]:
                if not h["landing_groups"] or h["landing_groups"][-1][0] != L["group"]:
                    h["landing_groups"].append((L["group"], []))
                h["landing_groups"][-1][1].append(L)
            for L in h["landing_pages"]:
                urls.append(out(L["url"], "hub-landing.html", h=h, L=L))
                pages.append({"title": L["title"], "key": L["seo_title"], "url": L["url"], "category": h["category"], "excerpt": L["facts"][0],
                              "tags": [h["id"].replace("-", " ")] + list(h.get("tags") or []) + re.findall(r"[a-z0-9]+", L["title"].lower()),
                              "image": "/static/og-default.png", "art": "/static/og-default.png"})
        # A page per race (RUNBOOK §6u priority step 1, 20 Nov 2026): /<slug>/<event id>/, opt in with `event_pages: true` on a race hub.
        # Event ids are permanent, so these addresses are too. No Event markup (rows have only a usual month).
        if h.get("event_pages"):
            assert not PHEN, f"hub {h['id']}: event_pages is for race hubs"
            _gslugs = {g["slug"] for g in h.get("guides") or []}
            for e in h["events"]:
                assert e["id"] not in _gslugs, f"hub {h['id']}: event id {e['id']} clashes with a guide slug"
                e["url"] = f"/{h['slug']}/{e['id']}/"
            for e in h["events"]:
                rel, seen_r = [], {e["id"]}
                def _add(cands, why):
                    for r in cands:
                        if r["id"] not in seen_r and len(rel) < 6:
                            rel.append((r, why)); seen_r.add(r["id"])
                if e["series"] != "independent":
                    _add([r for r in h["events"] if r["series"] == e["series"]][:3], f"also {F['series'][e['series']]}")
                _add([r for r in h["events"] if r["continent"] == e["continent"] and set(r["bands"]) & set(e["bands"])], f"similar distance, {F['continent'][e['continent']]}")
                _add([r for r in h["events"] if set(r["bands"]) & set(e["bands"])], "similar distance")
                _add([r for r in h["events"] if r["continent"] == e["continent"]], F["continent"][e["continent"]])
                _t = f"{e['name']}: {h.get('seo_suffix') or 'distances, entry and terrain'}"
                e["seo_title"] = _t if len(_t) <= 60 else (f"{e['name']}: {h.get('seo_short') or 'how to enter'}" if len(e["name"]) <= 46 else e["name"])
                e["description"] = f"{e['name']}, {e['place']}: {e['distances']}. {h.get('desc_mid') or 'How entry works, the terrain'} and the official page, checked {e['link']['checked_human']}."
                urls.append(out(e["url"], "hub-event.html", h=h, e=e, related=rel))
                pages.append({"title": e["name"], "key": "", "url": e["url"], "category": h["category"], "excerpt": e["note"],
                              "tags": [h["id"].replace("-", " "), h.get("word") or "race"] + list(h.get("tags") or []) + re.findall(r"[a-z]+", (e["name"] + " " + e["place"] + " " + e["country"]).lower()),
                              "image": "/static/og-default.png", "art": "/static/og-default.png"})
        for g in h.get("guides") or []:
            urls.append(out(g["url"], "hub-guide.html", h=h, g=g, others=[x for x in h["guides"] if x is not g]))
            pages.append({"title": g["title"], "key": g.get("seo_title") or "", "url": g["url"], "category": h["category"], "excerpt": g["standfirst"],
                          "tags": [h["id"].replace("-", " "), "guide"] + list(h.get("tags") or []) + re.findall(r"[a-z]+", g["title"].lower()),
                          "image": "/static/og-default.png", "art": "/static/og-default.png"})
        if h.get("entry_cal_page"):
            EC = h["entry_cal_page"]
            EC["seo_title"] = EC.get("seo_title") or EC["title"]
            _uniq = list({e["id"]: e for d, e in h["entry_cal"]}.values())
            EC["item_list"] = [{"@type": "ListItem", "position": n, "name": e["name"], "url": f"{cfg['site']['url']}{e['url']}"} for n, e in enumerate(_uniq, 1)]
            urls.append(out(EC["url"], "hub-entry-dates.html", h=h, EC=EC))
            pages.append({"title": EC["title"], "key": EC["seo_title"], "url": EC["url"], "category": h["category"], "excerpt": EC.get("description") or EC["title"],
                          "tags": [h["id"].replace("-", " "), "entry", "ballot", "lottery", "registration"] + list(h.get("tags") or []),
                          "image": "/static/og-default.png", "art": "/static/og-default.png"})
        item_list = [{"@type": "ListItem", "position": n, "name": e["name"], "url": f"{cfg['site']['url']}{e['url']}" if e.get("url") else f"{cfg['site']['url']}/{h['slug']}/#{e['id']}"} for n, e in enumerate(h["events"], 1)]
        urls.append(out(f"/{h['slug']}/", "hub.html", h=h, item_list=item_list))
        pages.append({"title": h["h1"], "key": h.get("seo_title") or "", "url": f"/{h['slug']}/", "category": h["category"], "excerpt": h["lead"],
                      "tags": [h["id"].replace("-", " ")] + list(h.get("tags") or []) + [w for e in h["events"] for w in re.findall(r"[a-z]+", e["name"].lower())],
                      "image": "/static/og-default.png", "art": "/static/og-default.png"})
    # Gift ideas (RUNBOOK §6v): /gifts/, /gifts/<group>/, /gifts/<occasion>/, /gifts/shared/ (a shared shortlist, noindex) and
    # /gifts/gifts.json (what the shortlist and shared pages draw from). Every idea is an activity, so its facts come from there.
    gift_pages = []
    if GIFTS and "chs" in locals():
        _byid = {c["id"]: c for c in chs}
        _price = re.compile(r"[£$€]\s?\d")
        IDEAS = {}
        _shared_picks = load_yaml(CONTENT / "picks.yaml") if (CONTENT / "picks.yaml").exists() else {}
        _aff_ok = {"viator", "getyourguide"}
        for g in GIFTS["groups"]:
            assert re.fullmatch(r"[a-z0-9-]+", g["id"]) and g.get("label") and g.get("h1") and g.get("seo_title") and g.get("description") and g.get("lead"), f"gift group {g.get('id')}: needs id, label, h1, seo_title, description, lead"
            for i in g["ideas"]:
                c = _byid.get(i["id"])
                assert c, f"gift group {g['id']}: no activity {i['id']}"
                assert i.get("gift") and not _price.search(i["gift"]), f"gift {i['id']}: needs a gift name, and no prices"
                if i["id"] in IDEAS:
                    IDEAS[i["id"]]["groups"].append(g["id"]); continue
                assert not (i.get("book") and c.get("book")), f"gift {i['id']}: the activity already has booking links; do not add more here"
                book = c.get("book") or i.get("book") or []
                for b in book:
                    assert str(b.get("url", "")).startswith("https://") and b.get("label") and b.get("why") and (not b.get("aff") or b["aff"] in _aff_ok), f"gift {i['id']}: booking links need https url, label, why and aff viator/getyourguide"
                # Reviewers' picks (Robin, 19 Nov 2026: "provide reviews, why to select… a range of options by price and functionality"):
                # the idea's own `picks: <key>` from content/picks.yaml, else the activity's. Top, also recommended and lower-cost,
                # in the reviewer's words, checked exactly as on activities. Otherwise the activity's kit list (ideas, not reviews).
                if i.get("picks"):
                    assert i["picks"] in _shared_picks, f"gift {i['id']}: picks key {i['picks']!r} is not in content/picks.yaml"
                    pk = copy.deepcopy(_shared_picks[i["picks"]])
                    _order = {"top": 0, "good": 1, "value": 2}
                    for o in pk["options"]:
                        assert o.get("tier") in _order and o.get("name") and o.get("label") and o.get("quote") and o.get("reviewer") and len(str(o["quote"]).split()) <= 30, f"gift {i['id']}: picks need tier, name, label, reviewer and a quote of at most 30 words"
                        assert str((o.get("review") or {}).get("url", "")).startswith("https://") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(o["review"].get("checked", ""))) and str(o.get("buy", "")).startswith("https://www.amazon.co.uk/") and not _price.search(str(o["quote"])), f"gift {i['id']}: pick review url, checked date, amazon.co.uk buy link, no prices"
                    pk["options"] = sorted(pk["options"], key=lambda o: _order[o["tier"]])
                    pk["checked_human"] = dt.datetime.strptime(max(str(o["review"]["checked"]) for o in pk["options"]), "%Y-%m-%d").strftime("%-d %B %Y")
                else:
                    pk = c.get("picks") if isinstance(c.get("picks"), dict) else None
                kit = [] if pk else [dict(k) for k in (c.get("kit") or [])[:3]]
                kit_title = f"{pk['item']}: what reviewers recommend" if pk else "Kit that would go with it"
                where = c["links"][0]
                IDEAS[i["id"]] = {"id": i["id"], "gift": i["gift"], "title": c["title"], "why": c["why_short"], "url": f"/list/{c['id']}/",
                                  "category": c["category"], "cost": c["cost"], "free": c["cost"] == "free", "photo": (c.get("photo") or {}).get("small"),
                                  "photo_alt": (c.get("photo") or {}).get("alt", ""), "book": book, "kit": kit, "kit_title": kit_title, "picks": pk,
                                  "where": {"label": where["label"], "url": where["url"]}, "groups": [g["id"]], "season": c.get("season", "")}
            g["items"] = [IDEAS[i["id"]] for i in g["ideas"]]
            g["url"] = f"/gifts/{g['id']}/"
        for o in GIFTS["occasions"]:
            assert re.fullmatch(r"[a-z0-9-]+", o["id"]) and o["id"] not in {g["id"] for g in GIFTS["groups"]} | {"shared"}, f"gift occasion {o['id']}: id clashes"
            if o["ideas"] == "auto":
                o["items"] = [x for x in IDEAS.values() if x["book"]]
            else:
                assert all(x in IDEAS for x in o["ideas"]), f"gift occasion {o['id']}: every idea must be in a group first"
                o["items"] = [IDEAS[x] for x in o["ideas"]]
            o["url"] = f"/gifts/{o['id']}/"
        GH = GIFTS["hub"]
        _season = GIFTS["in_season"]
        _gs_until = dt.date.fromisoformat(str(GIFTS["season"]["until"]))
        gctx = {"G": GIFTS, "season": _season, "season_name": GIFTS["season"]["name"], "groups": GIFTS["groups"], "occasions": GIFTS["occasions"],
                "books": [b for b in (cfg.get("books") or []) if str(b.get("until") or "9999") >= _today and str(b.get("amazon", "")).startswith("https://")],
                "quiz": _quiz if _quiz and str(_quiz[0].get("until") or "9999") >= _today else [], "plus_gift": _paywall}
        # Stocking fillers (RUNBOOK §6v, stocking fillers; Robin 19 Nov 2026: "think stocking fillers, people buy all manner of
        # gifts"): content/stocking_fillers.yaml gives /gifts/stocking-fillers/, a page per interest and the printable promise card.
        SF = load_yaml(CONTENT / "stocking_fillers.yaml") if (CONTENT / "stocking_fillers.yaml").exists() else None
        if SF:
            _sf_bad = re.compile(r"\b(best|top[- ](?:pick|rated|quality)|most popular|bestsell\w*|award[- ]winning|guaranteed|next[- ]day)\b", re.I)
            _gids = {g["id"] for g in GIFTS["groups"]}
            _sf_ids = set()
            for sec in SF["sections"]:
                assert re.fullmatch(r"[a-z0-9-]+", sec["id"]) and sec["id"] not in _sf_ids and sec["id"] != "promise-card", f"stocking fillers: bad or repeated id {sec.get('id')}"
                _sf_ids.add(sec["id"])
                assert sec.get("label") and sec.get("h1") and sec.get("seo_title") and sec.get("description") and sec.get("lead") and sec.get("items"), f"stocking fillers {sec['id']}: needs label, h1, seo_title, description, lead, items"
                assert sec.get("group", "") in _gids | {""}, f"stocking fillers {sec['id']}: group {sec.get('group')!r} is not a gift page"
                sec["url"] = f"/gifts/stocking-fillers/{sec['id']}/"
                sec["gift_page"] = next((g for g in GIFTS["groups"] if g["id"] == sec.get("group")), None)
                for it in sec["items"]:
                    for k in ("name", "why", "check", "q"):
                        assert it.get(k), f"stocking fillers {sec['id']}: an item lacks {k}"
                    _txt = " ".join(str(it[k]) for k in ("name", "why", "check", "q"))
                    assert not _price.search(_txt) and not _sf_bad.search(_txt), f"stocking fillers {sec['id']} / {it['name']}: no prices, no best/top/most popular/delivery promises"
                    it["url"] = "https://www.amazon.co.uk/s?k=" + "+".join(str(it["q"]).split())
                    it["slug"] = re.sub(r"[^a-z0-9]+", "-", it["name"].lower()).strip("-")
                    if it.get("for"):
                        c = _byid.get(it["for"])
                        assert c, f"stocking fillers {sec['id']} / {it['name']}: no activity {it['for']}"
                        it["read"] = {"title": c["title"], "url": f"/list/{c['id']}/"}
            SF["hub"]["url"] = "/gifts/stocking-fillers/"
            _prom = []
            for pid in SF["promise"]["ids"]:
                c = _byid.get(pid)
                assert c, f"promise card: no activity {pid}"
                _prom.append({"id": pid, "title": c["title"], "url": f"/list/{pid}/"})
            SF["promise"]["items"] = _prom
        gctx["sf"] = SF
        _hub_h1 = GH["h1_season"] if _season else GH["h1"]
        _all = list(IDEAS.values())
        def _il(items, base):
            return [{"@type": "ListItem", "position": n, "name": x["gift"], "url": f"{cfg['site']['url']}{base}#{x['id']}"} for n, x in enumerate(items, 1)]
        urls.append(out("/gifts/", "gifts.html", hub=GH, h1=_hub_h1, seo_title=GH["seo_title_season"] if _season else GH["seo_title"],
                        description=GH["description_season"] if _season else GH["description"],
                        item_list=[{"@type": "ListItem", "position": n, "name": p["h1"], "url": cfg["site"]["url"] + p["url"]} for n, p in enumerate(GIFTS["groups"] + GIFTS["occasions"], 1)], **gctx))
        for p in GIFTS["groups"] + GIFTS["occasions"]:
            seo = p["seo_title"]
            if _season and "Christmas" not in seo and len(seo) <= 46: seo = "Christmas " + seo[0].lower() + seo[1:] if seo.startswith("Gifts") else seo
            urls.append(out(p["url"], "gift-group.html", p=p, seo_title=seo, item_list=_il(p["items"], p["url"]),
                            others=[x for x in GIFTS["groups"] + GIFTS["occasions"] if x is not p], **gctx))
            pages.append({"title": p["h1"], "key": p["seo_title"], "url": p["url"], "category": "gifts" if "gifts" in cfg["categories"] else "explore", "excerpt": p["lead"],
                          "tags": ["gift", "gifts", "present", "presents", "christmas"] + re.findall(r"[a-z]+", (p["label"] + " " + " ".join(x["gift"] for x in p["items"])).lower()),
                          "image": "/static/og-default.png", "art": "/static/og-default.png"})
        if SF:
            _sfh = SF["hub"]
            _sf_h1 = _sfh["h1_season"] if _season else _sfh["h1"]
            urls.append(out("/gifts/stocking-fillers/", "stocking.html", h1=_sf_h1, seo_title=_sfh["seo_title_season"] if _season else _sfh["seo_title"],
                            description=_sfh["description_season"] if _season else _sfh["description"],
                            item_list=[{"@type": "ListItem", "position": n, "name": x["h1"], "url": cfg["site"]["url"] + x["url"]} for n, x in enumerate(SF["sections"], 1)], **gctx))
            pages.append({"title": _sf_h1, "key": "", "url": "/gifts/stocking-fillers/", "category": "explore", "excerpt": _sfh["lead"],
                          "tags": ["stocking", "stocking fillers", "stocking filler", "small", "gifts", "presents", "christmas"], "image": "/static/og-default.png", "art": "/static/og-default.png"})
            for sec in SF["sections"]:
                seo = sec["seo_title"] if (_season or "Stocking" not in sec["seo_title"]) else sec["seo_title"].replace("Stocking fillers", "Small gifts")
                urls.append(out(sec["url"], "stocking-section.html", s=sec, seo_title=seo,
                                item_list=[{"@type": "ListItem", "position": n, "name": it["name"], "url": f"{cfg['site']['url']}{sec['url']}#{it['slug']}"} for n, it in enumerate(sec["items"], 1)],
                                others=[x for x in SF["sections"] if x is not sec], **gctx))
                pages.append({"title": sec["h1"], "key": sec["seo_title"], "url": sec["url"], "category": "explore", "excerpt": sec["lead"],
                              "tags": ["stocking", "stocking fillers", "gifts", "presents", "christmas"] + re.findall(r"[a-z]+", (sec["label"] + " " + " ".join(it["name"] for it in sec["items"])).lower()),
                              "image": "/static/og-default.png", "art": "/static/og-default.png"})
            urls.append(out("/gifts/promise-card/", "promise-card.html", **gctx))
        out("/gifts/shared/", "gift-shared.html", **gctx)   # someone's shared shortlist: built in the browser from the address; noindex, not in the sitemap
        (DIST / "gifts").mkdir(parents=True, exist_ok=True)
        (DIST / "gifts" / "gifts.json").write_text(json.dumps({"ideas": IDEAS, "groups": {g["id"]: g["label"] for g in GIFTS["groups"]}}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        pages.append({"title": _hub_h1, "key": "", "url": "/gifts/", "category": "explore", "excerpt": GH["lead"],
                      "tags": ["gift", "gifts", "present", "presents", "christmas", "ideas", "experience", "retirement"], "image": "/static/og-default.png", "art": "/static/og-default.png"})
    # Home (Robin, 13 Nov 2026: "Things to do is now the core of the website"): a finder first, today's story directly under
    # it, then activities for this month and in-depth pages, then the latest stories. Picks change with the build date
    # (stable within a day), photographs first. Nothing here states how many activities there are (Robin, 27 Oct 2026).
    home = {"topics": [], "season": [], "deep": [], "tied": [], "month": dt.date.today().strftime("%B")}
    if _chs and "chs" in locals():
        import zlib
        _day, _mon = dt.date.today().toordinal(), dt.date.today().month
        _rot = lambda pool, salt: sorted(pool, key=lambda c: (not c.get("photo"), zlib.crc32(f"{_day}-{salt}-{c['id']}".encode())))
        _byid = {c["id"]: c for c in chs}
        home["tied"] = [_byid[c["id"]] for c in featured.get("challenges", []) if c["id"] in _byid][:2]
        _skip = {c["id"] for c in home["tied"]}
        home["season"] = _rot([c for c in chs if _mon in (c["plan"].get("when") or []) and len(c["plan"]["when"]) < 12 and c["id"] not in _skip], "season")[:6]
        _skip |= {c["id"] for c in home["season"]}
        home["deep"] = _rot([c for c in chs if c.get("detail") and c["id"] not in _skip], "deep")[:6]
        _used = {c["category"] for c in chs}
        home["topics"] = [{"id": cid, "label": c["label"]} for cid, c in cfg["categories"].items() if cid in _used]
    # the app's Today screen leads with the same picks (13 Nov 2026): /app/home.json, read alongside /index.json
    if (DIST / "app").exists():
        _ac = lambda c: {"id": c["id"], "title": c["title"], "category": c["category"], "why": c["why_short"], "photo": (c.get("photo") or {}).get("small")}
        (DIST / "app" / "home.json").write_text(json.dumps({"month": home["month"], "story": featured["url"], "tied": [_ac(c) for c in home["tied"]],
            "season": [_ac(c) for c in home["season"]], "deep": [_ac(c) for c in home["deep"]], "topics": home["topics"]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    urls.append(out("/", "index.html", featured=featured, latest=latest, home=home, L=LBL if "LBL" in locals() else {}))
    urls.append(out("/start-here/", "start.html"))
    urls.append(out("/newsletter/", "newsletter.html"))
    urls.append(out("/shop/", "shop.html"))
    if _books:
        urls.append(out("/puzzle-books/", "puzzle-books.html"))
        import importlib.util as _ilu   # the book's link-preview image and its social cards (tools/book_posts.py)
        _spec = _ilu.spec_from_file_location("book_posts", ROOT / "tools" / "book_posts.py")
        _bp = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_bp)
        print(f"book cards: {_bp.draw_all(DIST)} posts")
        pages.append({"title": "The Don't Die Retired puzzle books", "url": "/puzzle-books/", "category": "think",
                      "excerpt": "Large-print puzzle books in print on Amazon, made by the people behind the daily puzzles.",
                      "tags": ["puzzle", "puzzles", "book", "books", "christmas", "gift", "present", "sudoku", "large", "print"],
                      "image": "/static/og-default.png", "art": "/static/og-default.png"})
    if (CONTENT / "quiz_posts.yaml").exists():   # Christmas Quiz Book posts (tools/quiz_posts.py): held until both editions have links
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("quiz_posts", ROOT / "tools" / "quiz_posts.py")
        _qp = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_qp)
        if make_social:
            _qp.write_packs()
        print(f"quiz book cards: {_qp.draw_all(DIST)} posts")
    if (CONTENT / "activity_posts.yaml").exists():   # daily puzzle and thing-to-do posts (tools/daily_posts.py, RUNBOOK §6d)
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("daily_posts", ROOT / "tools" / "daily_posts.py")
        _dp = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_dp)
        if make_social:
            print("daily posts: %d puzzle packs, %d activity packs written" % _dp.write_packs())
        else:
            _dp.check_activity_posts()
        print(f"daily post cards: {_dp.draw_all(DIST, make_photo_card, make_card)}")
    if (CONTENT / "plus_posts.yaml").exists():   # Planner Plus gift posts (RUNBOOK §6t row 22): checked every build, cards only once on sale
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("plus_posts", ROOT / "tools" / "plus_posts.py")
        _pp = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_pp)
        _bad = _pp.check(_pp.load()[0])
        assert not _bad, f"content/plus_posts.yaml: {_bad}"
        print(f"plus gift cards: {_pp.draw_all(DIST, make_card)} posts")
    if GIFTS and (CONTENT / "gift_posts.yaml").exists():   # gift hub posts and link-preview cards (tools/gift_posts.py, RUNBOOK §6v)
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("gift_posts", ROOT / "tools" / "gift_posts.py")
        _gp = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_gp)
        if make_social:
            _gp.write_packs()
        print(f"gift cards: {_gp.draw_all(DIST)} posts")
    proposals = (load_yaml(CONTENT / "proposals.yaml") or {}).get("proposals", []) if (CONTENT / "proposals.yaml").exists() else []
    say = out("/your-say/", "your-say.html", proposals=proposals)
    if cfg.get("feedback", {}).get("live"): urls.append(say)
    # /members/ is not built (27 Oct 2026): the membership it described is not running, and the site never claims what it is not doing
    urls.append(out("/sponsor/", "sponsor.html"))
    urls.append(out("/about/", "about.html"))
    urls.append(out("/privacy/", "privacy.html"))
    urls.append(out("/follow/", "follow.html"))
    urls.append(out("/editorial-policy/", "editorial-policy.html", corrections_total=217))
    urls.append(out("/photo-credits/", "photo-credits.html", photo_arts=[a for a in arts if a["photo"]], film_arts=[a for a in arts if a["video"]],
                    photo_acts=[c for c in (chs if ch_file.exists() else []) if c.get("photo")]))
    urls.append(out("/search/", "search.html"))

    # search index + article index for the front end
    (DIST / "index.json").write_text(json.dumps([{
        "title": a["title"], "url": a["url"], "excerpt": a["excerpt"], "tags": a["tags"],
        "category": a["category"], "segments": a.get("segments", []), "date": a["date_iso"], "image": a["image"], "art": a["art"],
        "level": a.get("level", "any"), "age": a.get("subject_age"),
        "photo": bool(a["photo"]), "film": bool(a["video"]),
    } for a in arts]), encoding="utf-8")

    # Daily puzzle (RUNBOOK §6g): one small file per day, only for a short window around today,
    # so yesterday's puzzle really is gone and tomorrow's is not sitting in one big readable file.
    days_file = CONTENT / "puzzle_days.json"
    if days_file.exists():
        import base64, random as _random, sys as _s
        _s.path.insert(0, str(ROOT / "tools"))
        from build_puzzles import load_words, answers as _answers
        from collections import Counter as _Counter
        pdays = json.loads(days_file.read_text(encoding="utf-8"))
        today = dt.date.today()
        left = (dt.date.fromisoformat(max(pdays)) - today).days
        if left < 60:
            print(f"PUZZLE WARNING: only {left} days of puzzles left. Run: python tools/build_puzzles.py --extend 365 (RUNBOOK §6g).")
        wc = [(w, _Counter(w)) for w in load_words()]
        def _obf(text, key):   # light scrambling so answers are not readable at a glance; not security
            k = key.encode()
            return base64.b64encode(bytes(b ^ k[i % len(k)] ^ 0x5A for i, b in enumerate(text.encode()))).decode()
        (DIST / "puzzle" / "d").mkdir(parents=True, exist_ok=True)
        # The three other daily puzzles (ladder, sudoku, numbers; tools/build_daily.py), each at three levels.
        extra_file = CONTENT / "puzzle_extra.json"
        extra = json.loads(extra_file.read_text(encoding="utf-8")) if extra_file.exists() else {}
        if extra:
            from build_daily import accept_words as _accept
            _ok = {n: set(_accept(n)) for n in (4, 5)}
            for n in (4, 5):   # every word a reader may use as a rung
                (DIST / "puzzle" / f"w{n}.txt").write_text("\n".join(sorted(_ok[n])), encoding="utf-8")
            if (dt.date.fromisoformat(max(extra)) - today).days < 60:
                print("PUZZLE WARNING: under 60 days of ladder, sudoku and numbers puzzles left. Run: python tools/build_daily.py (RUNBOOK §6g).")

        def _extra_day(d):
            """Today's other three puzzles, re-checked here with plain code before they go out."""
            x, o = extra[d], {"L": {}, "K": {}, "N": {}}
            for lv in "gsh":
                path = x["ladder"][lv]
                assert all(w in _ok[len(w)] for w in path) and all(sum(a != b for a, b in zip(p, q)) == 1 for p, q in zip(path, path[1:])), f"bad ladder {d} {lv}"
                o["L"][lv] = {"a": path[0], "b": path[-1], "n": len(path) - 1, "s": _obf(",".join(path), d)}
                puz, sol = x["sudoku"][lv]
                n = int(len(sol) ** .5); br = 2 if n == 6 else 3
                rows = [sol[r * n:(r + 1) * n] for r in range(n)]
                groups = rows + ["".join(r[c] for r in rows) for c in range(n)] + ["".join(rows[r0 + i][c0 + j] for i in range(br) for j in range(3)) for r0 in range(0, n, br) for c0 in range(0, n, 3)]
                assert all(sorted(g) == [str(k) for k in range(1, n + 1)] for g in groups) and all(p in ("0", s) for p, s in zip(puz, sol)), f"bad sudoku {d} {lv}"
                o["K"][lv] = {"p": puz, "s": _obf(sol, d)}
                num = x["numbers"][lv]; tiles = list(num["n"]); last = None
                for step in num["w"]:
                    a, op, b, _eq, r = step.split(); a, b, r = int(a), int(b), int(r)
                    tiles.remove(a); tiles.remove(b)
                    assert r > 0 and r == {"+": a + b, "-": a - b, "x": a * b, "/": a // b if a % b == 0 else -1}[op], f"bad numbers {d} {lv}"
                    tiles.append(r); last = r
                assert last == num["t"], f"bad numbers {d} {lv}"
                o["N"][lv] = {"n": num["n"], "t": num["t"], "w": _obf(";".join(num["w"]), d)}
            return o

        for off in range(-2, 15):
            d = (today + dt.timedelta(days=off)).isoformat()
            if d not in pdays:
                continue
            word, centre = pdays[d]
            ans = sorted(_answers(word, centre, wc))
            assert word in ans and all(len(a) >= 4 and centre in a for a in ans), f"bad puzzle {d}"
            outer = list(word); outer.remove(centre)
            _random.Random(d).shuffle(outer)
            n = len(ans)
            nines = [a for a in ans if len(a) == 9]
            (DIST / "puzzle" / "d" / f"{d}.json").write_text(json.dumps({
                "d": d, "c": centre, "o": "".join(outer), "n": n,
                "t": [max(5, round(n * .25)), max(8, round(n * .40)), max(11, round(n * .60))],
                "a": _obf(",".join(ans), d), "w": _obf(",".join(nines), d),
                **(_extra_day(d) if d in extra else {})}, separators=(",", ":")), encoding="utf-8")
        urls.append(out("/puzzle/", "puzzle.html"))
        pages.append({"title": "Daily puzzles: a word wheel, a word ladder, a sudoku and a numbers target", "url": "/puzzle/", "category": "think",
                      "excerpt": "Four new puzzles every day, each at three levels: gentle, steady or hard. Gone at midnight.",
                      "tags": ["puzzle", "puzzles", "word", "wheel", "ladder", "sudoku", "numbers", "game", "daily", "streak"],
                      "image": "/static/og-default.png", "art": "/static/og-default.png"})
    (DIST / "pages.json").write_text(json.dumps(pages), encoding="utf-8")

    write_rss(arts, cfg)
    write_sitemap.lastmod = {a["url"]: a["modified_iso"] for a in arts}
    write_sitemap(urls, cfg)
    (DIST / "CNAME").write_text("dontdieretired.com\n")
    (DIST / "404.html").write_text(env.get_template("404.html").render(path="/404"), encoding="utf-8")
    print(f"Built {len(arts)} articles, {len(urls)} pages → {DIST}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("--no-social", action="store_true")
    args = ap.parse_args()
    build(make_social=not args.no_social)
    if args.serve:
        import http.server, functools
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
        print("Serving on http://localhost:8000")
        http.server.ThreadingHTTPServer(("", 8000), h).serve_forever()

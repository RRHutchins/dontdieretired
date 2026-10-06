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
import datetime as dt
import html
import json
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


# ---------------------------------------------------------------- content

def load_articles(cfg):
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
            "tags": fm.get("tags", []),
            "image": f"/static/img/{slug}.png",          # headline card: social, og:image
            # shown on the site: a credited photo if the article has one (`photo:` + `photo_credit:`,
            # logged in docs/IMAGE_CREDITS.md), otherwise the sun-and-scene artwork from art.py
            "art": fm.get("photo") or f"/static/art/{slug}.svg",
            "scene": fm.get("art"),
        }
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
    img = img.resize((W0, H0), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


# ---------------------------------------------------------------- social pack

def social_pack(a, cfg):
    """Write ready-to-post social content for one article."""
    site = cfg["site"]
    folder = SOCIAL / f"{a['date_iso']}-{a['slug']}"
    folder.mkdir(parents=True, exist_ok=True)
    utm = lambda src: f"{a['abs_url']}?utm_source={src}&utm_medium=social&utm_campaign=daily"
    hook = a.get("hook") or a["title"]
    lesson = a.get("lesson", "")
    tags = " ".join("#" + re.sub(r"[^a-z0-9]", "", t) for t in (a["tags"] + ["over50", "activeageing", "dontdieretired"]))

    posts = {
        "facebook": f"{hook}\n\n{a['excerpt']}\n\n{lesson}\n\nRead the full story → {utm('facebook')}",
        "instagram": f"{hook}\n\n{lesson}\n\nFull story at the link in our bio (dontdieretired.com).\n\n{tags}",
        "x": textwrap.shorten(f"{hook} {lesson}", 200, placeholder="…") + f"\n\n{utm('x')}",
        "x_thread": "\n\n---\n\n".join([
            f"1/ {hook}",
            f"2/ {a['excerpt']}",
            f"3/ The lesson: {lesson}",
            f"4/ Full story, sources and a plan you can start this week → {utm('x')}",
        ]),
        "pinterest": f"{a['title']} | {lesson} | {utm('pinterest')}",
        "linkedin": f"{hook}\n\n{a['excerpt']}\n\nWhy it matters for anyone over 50: {lesson}\n\n{utm('linkedin')}",
    }
    (folder / "posts.md").write_text(
        "\n\n".join(f"## {k}\n\n{v}" for k, v in posts.items()), encoding="utf-8")

    script = a.get("video_script") or textwrap.dedent(f"""
        # 45-second short (Reels / TikTok / Shorts)

        [0-3s]  ON SCREEN: "{hook}"   VO: "{hook}"
        [3-15s] VO: {a['excerpt']}
        [15-35s] VO: {lesson}
        [35-45s] VO: "If they can start, so can you. One small step today."  ON SCREEN: dontdieretired.com
        B-roll: stock footage of older adults active outdoors; captions on; upbeat acoustic track.
        """).strip()
    (folder / "short_video_script.md").write_text(script, encoding="utf-8")

    make_card(hook, "Don't Die Retired", a["category"], folder / "square.png", size=(1080, 1080))
    make_card(hook, "Don't Die Retired", a["category"], folder / "story.png", size=(1080, 1920))
    make_card(hook, "Don't Die Retired", a["category"], folder / "landscape.png", size=(1200, 630))

    (folder / "meta.json").write_text(json.dumps({
        "title": a["title"], "url": a["abs_url"], "date": a["date_iso"],
        "category": a["category"], "tags": a["tags"], "segments": a.get("segments", []),
        "posts": posts,
    }, indent=2), encoding="utf-8")
    return folder


# ---------------------------------------------------------------- feeds

def write_rss(arts, cfg):
    site = cfg["site"]
    items = []
    for a in arts[:30]:
        items.append(f"""
    <item>
      <title>{html.escape(a['title'])}</title>
      <link>{a['abs_url']}</link>
      <guid>{a['abs_url']}</guid>
      <pubDate>{dt.datetime.combine(a['date'], dt.time(6)).strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>
      <category>{a['category']}</category>
      <description>{html.escape(a['excerpt'])}</description>
      <enclosure url="{site['url']}{a['image']}" type="image/png" length="0"/>
    </item>""")
    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>{html.escape(site['name'])}</title>
  <link>{site['url']}</link>
  <description>{html.escape(site['description'])}</description>
  <language>{site['language']}</language>{''.join(items)}
</channel></rss>"""
    (DIST / "feed.xml").write_text(rss, encoding="utf-8")


def write_sitemap(urls, cfg):
    site = cfg["site"]
    body = "".join(f"<url><loc>{site['url']}{u}</loc></url>" for u in urls)
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
    arts = load_articles(cfg)

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(STATIC, DIST / "static")
    # the app (installable web app at /app/)
    if (ROOT / "app").exists():
        shutil.copytree(ROOT / "app", DIST / "app", ignore=shutil.ignore_patterns("build_data.py", "__pycache__"))
        import subprocess, sys as _sys
        subprocess.run([_sys.executable, str(ROOT / "app" / "build_data.py"), str(DIST / "app" / "data.json")], check=True)

    env = Environment(loader=FileSystemLoader(ROOT / "templates"),
                      autoescape=select_autoescape(["html"]))
    env.globals.update(cfg=cfg, now=dt.date.today(), videos=videos, products=products,
                       articles=arts, categories=cfg["categories"], segments=cfg["audience_segments"], local=local)

    def out(path: str, tpl: str, **ctx):
        p = DIST / path.strip("/") / "index.html" if path != "/" else DIST / "index.html"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(env.get_template(tpl).render(path=path, **ctx), encoding="utf-8")
        return path

    urls = []
    # article hero/og images
    for a in arts:
        make_card(a.get("lesson") or a["title"], cfg["categories"][a["category"]]["label"], a["category"],
                  DIST / "static" / "img" / f"{a['slug']}.png")
        if (dt.date.today() - a["date"]).days <= 7:   # square card for Instagram (post_social.py); recent articles only
            (DIST / "static" / "social").mkdir(parents=True, exist_ok=True)
            make_card(a.get("hook") or a["title"], "Don't Die Retired", a["category"],
                      DIST / "static" / "social" / f"{a['slug']}.png", size=(1080, 1080))
        (DIST / "static" / "art").mkdir(parents=True, exist_ok=True)
        (DIST / "static" / "art" / f"{a['slug']}.svg").write_text(
            art.scene_svg({**a, "art": a["scene"]}, PALETTE.get(a["category"], ("#333333",))[0]), encoding="utf-8")
        related = [b for b in arts if b is not a and (b["category"] == a["category"] or set(b["tags"]) & set(a["tags"]))][:3]
        urls.append(out(a["url"], "article.html", a=a, related=related))
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
    urls.append(out("/", "index.html", featured=featured, latest=latest))
    for cid, c in cfg["categories"].items():
        urls.append(out(f"/{cid}/", "category.html", cid=cid, c=c, items=[a for a in arts if a["category"] == cid]))
    urls.append(out("/videos/", "videos.html"))
    urls.append(out("/start-here/", "start.html"))
    urls.append(out("/newsletter/", "newsletter.html"))
    urls.append(out("/shop/", "shop.html"))
    proposals = (load_yaml(CONTENT / "proposals.yaml") or {}).get("proposals", []) if (CONTENT / "proposals.yaml").exists() else []
    say = out("/your-say/", "your-say.html", proposals=proposals)
    if cfg.get("feedback", {}).get("live"): urls.append(say)
    urls.append(out("/members/", "members.html"))
    urls.append(out("/sponsor/", "sponsor.html"))
    urls.append(out("/about/", "about.html"))
    urls.append(out("/privacy/", "privacy.html"))
    urls.append(out("/search/", "search.html"))

    # search index + article index for the front end
    (DIST / "index.json").write_text(json.dumps([{
        "title": a["title"], "url": a["url"], "excerpt": a["excerpt"], "tags": a["tags"],
        "category": a["category"], "segments": a.get("segments", []), "date": a["date_iso"], "image": a["image"], "art": a["art"],
        "level": a.get("level", "any"), "age": a.get("subject_age"),
    } for a in arts]), encoding="utf-8")

    write_rss(arts, cfg)
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

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

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
SOCIAL = ROOT / "social"
CONTENT = ROOT / "content"
STATIC = ROOT / "static"

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

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
            "image": f"/static/img/{slug}.png",
        }
        arts.append(a)
    arts.sort(key=lambda a: a["date"], reverse=True)
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
}


def make_card(title: str, kicker: str, category: str, out: Path, size=(1200, 630), footer="dontdieretired.com"):
    """Brand-coloured typographic card used as article hero, OG image and social image."""
    fg, bg = PALETTE.get(category, ("#333333", "#F3F3F3"))
    W, H = size
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    # colour band
    d.rectangle([0, 0, W, int(H * 0.055)], fill=fg)
    pad = int(W * 0.06)
    # Scale type off the shorter side so tall (story) cards don't get oversized text.
    base = min(W, H)
    kf = ImageFont.truetype(FONT_REG, int(base * 0.05))
    title_scale = 0.105 if len(title) < 60 else (0.085 if len(title) < 95 else 0.068)
    tf = ImageFont.truetype(FONT_BOLD, int(base * title_scale))
    ff = ImageFont.truetype(FONT_REG, int(base * 0.045))
    y = int(H * 0.14)
    d.text((pad, y), kicker.upper(), font=kf, fill=fg)
    y += int(base * 0.11)
    line_h = int(tf.size * 1.22)
    max_lines = max(1, (H - pad - ff.size - int(base * 0.04) - y) // line_h)
    for line in wrap_text(d, title, tf, W - 2 * pad)[:max_lines]:
        d.text((pad, y), line, font=tf, fill="#1A1A1A")
        y += line_h
    # footer
    d.text((pad, H - pad - ff.size), footer, font=ff, fill=fg)
    d.rectangle([W - pad - int(W * 0.12), H - pad - int(H * 0.012), W - pad, H - pad], fill=fg)
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
    products = load_yaml(CONTENT / "products.yaml")
    arts = load_articles(cfg)

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(STATIC, DIST / "static")

    env = Environment(loader=FileSystemLoader(ROOT / "templates"),
                      autoescape=select_autoescape(["html"]))
    env.globals.update(cfg=cfg, now=dt.date.today(), videos=videos, products=products,
                       articles=arts, categories=cfg["categories"], segments=cfg["audience_segments"])

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
        related = [b for b in arts if b is not a and (b["category"] == a["category"] or set(b["tags"]) & set(a["tags"]))][:3]
        urls.append(out(a["url"], "article.html", a=a, related=related))
        if make_social:
            social_pack(a, cfg)

    urls.append(out("/", "index.html", featured=arts[0], latest=arts[1:7]))
    for cid, c in cfg["categories"].items():
        urls.append(out(f"/{cid}/", "category.html", cid=cid, c=c, items=[a for a in arts if a["category"] == cid]))
    urls.append(out("/videos/", "videos.html"))
    urls.append(out("/start-here/", "start.html"))
    urls.append(out("/newsletter/", "newsletter.html"))
    urls.append(out("/shop/", "shop.html"))
    urls.append(out("/members/", "members.html"))
    urls.append(out("/sponsor/", "sponsor.html"))
    urls.append(out("/about/", "about.html"))
    urls.append(out("/privacy/", "privacy.html"))
    urls.append(out("/search/", "search.html"))

    # search index + article index for the front end
    (DIST / "index.json").write_text(json.dumps([{
        "title": a["title"], "url": a["url"], "excerpt": a["excerpt"], "tags": a["tags"],
        "category": a["category"], "segments": a.get("segments", []), "date": a["date_iso"], "image": a["image"],
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

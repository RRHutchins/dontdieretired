
dist/
__pycache__/
social/*/*.png

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
    kf = ImageFont.truetype(FONT_REG, int(H * 0.05))
    tf = ImageFont.truetype(FONT_BOLD, int(H * 0.105) if len(title) < 60 else int(H * 0.085))
    ff = ImageFont.truetype(FONT_REG, int(H * 0.045))
    y = int(H * 0.14)
    d.text((pad, y), kicker.upper(), font=kf, fill=fg)
    y += int(H * 0.11)
    for line in wrap_text(d, title, tf, W - 2 * pad)[:5]:
        d.text((pad, y), line, font=tf, fill="#1A1A1A")
        y += int(tf.size * 1.22)
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

#!/usr/bin/env python3
"""Scaffold a new article file with the front matter the site expects.
Usage: python new_article.py "Title" --category move --tags running,men --segments mover
Claude fills in the body, quotes and sources from verified reporting, then runs build.py.
"""
import argparse, datetime as dt, re, pathlib
ap = argparse.ArgumentParser()
ap.add_argument("title"); ap.add_argument("--category", required=True, choices=["move","think","earn","connect","stories"])
ap.add_argument("--tags", default=""); ap.add_argument("--segments", default="")
ap.add_argument("--date", default=dt.date.today().isoformat())
a = ap.parse_args()
slug = re.sub(r"[^a-z0-9]+", "-", a.title.lower()).strip("-")[:70]
p = pathlib.Path(__file__).parent / "content/articles" / f"{a.date}-{slug}.md"
p.write_text(f'''---
title: "{a.title}"
slug: {slug}
date: {a.date}
category: {a.category}
tags: [{a.tags}]
segments: [{a.segments}]
hook: ""
lesson: ""
standfirst: ""
summary: ""
try_this:
  - ""
  - ""
  - ""
sources:
  - {{title: "", publisher: "", date: "", url: ""}}
---
Body here. Quote only what the sources say. Link related articles with relative URLs.
''', encoding="utf-8")
print(p)

#!/usr/bin/env python3
"""Push a day's social pack to a scheduler (Buffer by default).
Requires env BUFFER_TOKEN and BUFFER_PROFILE_IDS (comma list) — or set SCHEDULER=publer with PUBLER_TOKEN.
Usage: python post_social.py social/2026-09-27-slug
Runs on the daily job after build.py. Safe to re-run: skips packs with a .posted marker.
"""
import json, os, sys, pathlib, urllib.request, urllib.parse
pack = pathlib.Path(sys.argv[1]); meta = json.loads((pack / "meta.json").read_text())
marker = pack / ".posted"
if marker.exists(): sys.exit("already posted")
token = os.environ.get("BUFFER_TOKEN"); profiles = os.environ.get("BUFFER_PROFILE_IDS", "").split(",")
if not token or not profiles[0]:
    sys.exit("No scheduler credentials set — posts are in posts.md for manual/Zapier posting.")
# Buffer's public API accepts one update per profile; each profile maps to a network.
NETWORK_TEXT = {"facebook": meta["posts"]["facebook"], "instagram": meta["posts"]["instagram"],
                "x": meta["posts"]["x"], "linkedin": meta["posts"]["linkedin"], "pinterest": meta["posts"]["pinterest"]}
for pid in profiles:
    net, _, prof = pid.partition(":")          # e.g. "facebook:5f3a...,x:5f3b..."
    body = {"profile_ids[]": prof, "text": NETWORK_TEXT.get(net, meta["posts"]["facebook"]),
            "media[link]": meta["url"], "shorten": "false", "now": "false"}
    data = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in body.items()).encode()
    req = urllib.request.Request("https://api.bufferapp.com/1/updates/create.json?access_token=" + token, data=data)
    with urllib.request.urlopen(req) as r: print(net, r.status)
marker.write_text("ok")

jinja2>=3.1
markdown>=3.5
pyyaml>=6
pillow>=10

# Don't Die Retired — Operations Runbook

This is the instruction set Claude follows to run dontdieretired.com. It is written so a fresh Claude session with this repo can do the job without any other context.

## 1. What the site is
A static site for over-50s, encouraging physical and mental activity, run by AI with human founders. Every article is built on a real, named, linked news story. Tone: positive, plain, no hype, no medical claims, no "you must". British spelling.

Repo layout: `site.yaml` (config), `content/articles/*.md`, `content/videos.yaml`, `content/products.yaml`, `templates/`, `static/`, `build.py` → `dist/`; `social/` gets a post pack per article.

## 2. Daily job (runs every morning, ~06:00 UK)
1. **Find a story.** Web-search for a genuine, recent story of someone 50+ starting or achieving something (sport, study, business, creative, volunteering). Prefer 2024–2026, reputable outlets (BBC, Guardian, regional UK press, ABC AU, CBC, NYT/AP, Guinness). Fetch and read the source. Only use facts and quotes visible on the page. Rotate: women/men, UK/international, physical/mental, ages 50s–90s, and rotate categories (move / think / earn / connect / stories).
2. **Write it.** `python new_article.py "Title" --category X --tags a,b --segments restarter,mover`. Fill front matter: `hook` (≤120 chars, used on social + image), `lesson` (one sentence), `standfirst`, `summary`, 3 `try_this` actions, `sources` with URLs. Body 450–700 words: the story, 2–3 verified quotes, a "why this matters" section with the evidence, a practical section. Link to 1–2 related articles.
3. **Check the videos page.** Once a week add one verified YouTube ID to `content/videos.yaml` (verify via `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json`).
4. **Build + verify.** `python build.py`. Open `dist/<category>/<slug>/index.html`; confirm sources render, no template errors, image generated.
5. **Publish.** `git add -A && git commit -m "Daily: <title>" && git push` (GitHub Actions deploys to Pages in ~1 min).
6. **Social.** `python post_social.py social/<date>-<slug>` (needs scheduler credentials; otherwise the posts sit in `posts.md` for Zapier/manual). Image cards: `square.png` (IG/FB), `story.png` (Reels/Stories/TikTok cover), `landscape.png` (X/LinkedIn/FB link).
7. **Short video.** Send `short_video_script.md` to the video tool (HeyGen/Pictory/InVideo API) when that account exists; upload to YouTube Shorts, Reels, TikTok via the scheduler.

## 3. Weekly job (Sunday)
- Newsletter: assemble the week's best story + one "try this" + one video into the provider's editor (Buttondown/Beehiiv) and send to the free list; a longer version with the printable planner to the paid list.
- Analytics review (Plausible): top pages, entry pages, `segment` event split, `affiliate_click`, `product_click`, `newsletter_submit`, `scroll_depth`. Log the numbers in `reports/YYYY-WW.md`.
- Apply the **improvement loop** in §5.

## 4. Revenue stack — setup checklist (owner does these once; Claude wires them in `site.yaml`)
| Stream | Account to create | Where it plugs in | Turns on when |
|---|---|---|---|
| Display ads | Google AdSense (day 1); apply to Ezoic at ~10k sessions/mo, Mediavine/Raptive at 50k+ | `ads.*` in site.yaml; slots already in templates; consent banner handles GDPR | AdSense approval (needs ~20+ articles, privacy page — done) |
| Affiliate | Amazon Associates UK + US; later Awin/Impact for fitness brands, Decathlon, Wiggle etc. | `affiliates.amazon_uk_tag`; `content/products.yaml` picks; app.js appends tag | Immediately after approval (must make 3 sales in 180 days to keep Amazon account) |
| Newsletter | Buttondown (free to 100 subs) or Beehiiv | `newsletter.form_action`; segment passed as tag | Day 1 |
| Paid newsletter tier | Buttondown/Beehiiv paid subscriptions | `newsletter.paid_tier_url` | When free list > 500 |
| Digital products | Gumroad (0 monthly fee, ~10% + fees) | `products.store_url`, `content/products.yaml` | Day 1 — Claude writes the PDFs (see §6) |
| Membership | Ko-fi (0% platform fee on memberships) or Patreon | `membership.url` | When list > 1,000 or first live Q&A guest booked |
| Sponsorship | None — email | `/sponsor/` page + rate card in site.yaml | Pitch from 10k monthly sessions |
| Platform payouts | Meta (FB/IG) monetisation, X Creator Revenue, YouTube Partner, TikTok Creator Rewards | Scheduler posts drive it | At each platform's threshold (see plan document) |
| Lead-gen / courses (later) | Own cohort course or Teachable | `/shop/` | When product sales prove demand |

## 5. Improvement loop (the "if traffic grows, we improve" rule)
Every Sunday, compare this week with the last four. Act on triggers:
- **Article read depth**: if `scroll_depth 90` < 40% of `scroll_depth 50` on a format → shorten, add sub-heads, move "Try this" higher. Test one change for two weeks.
- **Traffic > 1,000 sessions/week** → start the short-video pipeline properly (daily Reel/Short/TikTok from `short_video_script.md`), because video is the cheapest way to multiply reach at that stage.
- **Traffic > 5,000/week** → commission/produce one longer YouTube piece per week (5–8 min "second start" story, script written by Claude); apply to Ezoic.
- **Segment split** shows one profile > 40% → write 2 of 7 weekly articles for that segment; build the next digital product for it.
- **Affiliate clicks > 2% of article views** on a category → add a "kit list" article for that category (higher-intent, better conversion).
- **Newsletter signups < 1% of visitors** → change the lead magnet or move the form above the fold; test two weeks.
- **Product clicks but no sales** → lower the price or add a preview PDF page.
- **Any article shared > 50 times** → make a video of it and a follow-up article.

## 6. Digital products Claude produces (own IP, ~90% margin)
Write as Word/PDF with the docx skill: The 30-Day Restart (£9), Strong at 60 (£14), Sharp (£12), Second Act workbook (£19), Bundle (£29). Also the free lead magnet: 7-Day Restart Plan. Upload to Gumroad, paste the product URLs into `content/products.yaml`.

## 7. Guard-rails
- Never invent facts, quotes, ages or names. If the source can't be fetched, don't run the story.
- Never give medical advice or dosing; always "check with a GP first".
- Label sponsored content; keep the affiliate disclosure on every page (it's in the footer).
- No ageist framing, no "despite their age" tone, no before/after body shaming.
- Respect the `hidden`-by-default consent banner: ads load only after consent (handled in app.js).
- Keep the same URL for an article once published (slug in front matter).

## 8. Hosting and DNS (one-time)
1. Create GitHub repo `dontdieretired`, push this folder. Settings → Pages → Source: GitHub Actions.
2. At the registrar, add DNS: `A` records for `@` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153; `CNAME` `www` → `<github-user>.github.io`. Enable "Enforce HTTPS" in Pages once the certificate issues.
3. Netlify alternative: "Import from Git", build command `pip install -r requirements.txt && python build.py --no-social`, publish dir `dist`.

# ---------------------------------------------------------------
# Don't Die Retired — site configuration
# Fill in the IDs as each account is created. Empty = feature hidden.
# ---------------------------------------------------------------
site:
  name: "Don't Die Retired"
  tagline: "Life after 50 is not a wind-down. It's a second start."
  url: "https://dontdieretired.com"
  description: "Real stories, practical plans and daily encouragement for people over 50 who intend to stay active in body and mind."
  language: "en-GB"
  author: "The Don't Die Retired team"
  contact_email: "hello@dontdieretired.com"
  twitter_handle: "@dontdieretired"

analytics:
  # Choose ONE. Plausible is privacy-friendly and needs no consent banner for basic stats.
  plausible_domain: "dontdieretired.com"     # e.g. dontdieretired.com  (leave "" to disable)
  ga4_id: ""                                 # e.g. G-XXXXXXXXXX
  hotjar_or_clarity_id: ""                   # Microsoft Clarity project id (free heatmaps)

ads:
  enabled: false                             # set true once AdSense/Ezoic approved
  network: "adsense"                         # adsense | ezoic | mediavine | raptive
  adsense_client: ""                         # e.g. ca-pub-1234567890123456
  slots:
    in_article: ""                           # AdSense slot ids
    sidebar: ""
    footer: ""

affiliates:
  amazon_uk_tag: "dontdieretired-21"         # Amazon Associates UK tracking id
  amazon_us_tag: "dontdieretired-20"
  disclosure: "Some links on this page are affiliate links. If you buy through them we may earn a small commission at no extra cost to you. We only recommend things we would use ourselves."

newsletter:
  provider: "buttondown"                     # buttondown | beehiiv | mailerlite | kit
  form_action: "https://buttondown.com/api/emails/embed-subscribe/dontdieretired"
  list_name: "The Second Start — free weekly email"
  lead_magnet: "Free: the 7-Day Restart Plan (PDF)"
  paid_tier_url: ""                          # Buttondown/Beehiiv paid subscription link
  paid_tier_price: "£4/month"

products:
  platform: "gumroad"                        # gumroad | lemonsqueezy | payhip
  store_url: "https://dontdieretired.gumroad.com"

membership:
  platform: "kofi"                           # kofi | patreon | buymeacoffee
  url: "https://ko-fi.com/dontdieretired"
  price: "£5/month"
  name: "The Restart Circle"

sponsorship:
  media_kit_url: "/sponsor/"
  rate_card:
    - {item: "Sponsored article (written by us, clearly labelled)", price: "from £250"}
    - {item: "Newsletter sponsor slot", price: "from £150"}
    - {item: "Video/short-form mention", price: "from £200"}
    - {item: "Monthly category sponsorship", price: "from £600"}

social:
  facebook: "https://facebook.com/dontdieretired"
  instagram: "https://instagram.com/dontdieretired"
  x: "https://x.com/dontdieretired"
  youtube: "https://youtube.com/@dontdieretired"
  pinterest: "https://pinterest.com/dontdieretired"
  tiktok: "https://tiktok.com/@dontdieretired"
  scheduler: "buffer"                        # buffer | publer | zapier — used by RUNBOOK

audience_segments:
  - {id: "restarter", label: "The Restarter", blurb: "I've been inactive for a while and want a gentle, realistic way back.", tags: [beginner, walking, strength, mindset]}
  - {id: "mover", label: "The Mover", blurb: "I'm already active and want the next challenge.", tags: [running, swimming, cycling, endurance, competition]}
  - {id: "learner", label: "The Learner", blurb: "I want to keep my mind sharp — study, skills, creativity.", tags: [learning, brain, creativity, purpose]}
  - {id: "carer", label: "The Carer", blurb: "I look after someone and need ways to stay well myself.", tags: [walking, mindset, community, beginner]}
  - {id: "changer", label: "The Career Changer", blurb: "I'm not done working — I want a new venture or purpose.", tags: [business, purpose, learning, community]}

categories:
  move: {label: "Move", blurb: "Strength, running, swimming, cycling, walking — at any starting point."}
  think: {label: "Think", blurb: "Learning, memory, creativity and study after 50."}
  earn: {label: "Earn", blurb: "Second careers, side businesses and purpose-driven work."}
  connect: {label: "Connect", blurb: "Community, volunteering and the people who keep us going."}
  stories: {label: "Real Stories", blurb: "People who started late and went far."}

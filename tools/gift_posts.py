#!/usr/bin/env python3
"""Social posts and image cards for the gift ideas hub (RUNBOOK §6v; Robin, 19 Nov 2026: "How do we get it seen? Maybe
send posts to social media about it").

  python tools/gift_posts.py      write social/<date>-<slug>/meta.json for each post in content/gift_posts.yaml
                                  (never rewrites a pack whose date has passed: changing sent text would post it again)

build.py calls draw_all(dist) for the cards: dist/static/social/<slug>.png (1080 square: Instagram, Facebook picture post),
dist/static/img/<slug>.png (1200 x 675, X) and dist/static/img/gifts/og-<page>.png (1200 x 630, each gift page's link preview).
Facts only from content/gifts.yaml and the activities it names; no prices, no delivery promises, no "best".
"""
import datetime as dt, json, pathlib, re, sys

import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "brand" / "fonts"
SITE = "https://dontdieretired.com"
DARK, RED, GOLD, CREAM = (127, 36, 49), (178, 58, 72), "#c98a2b", "#fde9c8"
HASHTAGS = "#DontDieRetired #NeverRetireFromLife #TryNewThings #ChristmasGifts #GiftIdeas"


def load():
    posts = yaml.safe_load((ROOT / "content" / "gift_posts.yaml").read_text(encoding="utf-8")) or {}
    gifts = yaml.safe_load((ROOT / "content" / "gifts.yaml").read_text(encoding="utf-8"))
    pages = {"": {"label": "Gift ideas", "h1": gifts["hub"]["h1_season"], "ideas": ["For " + g["label"].lower() for g in gifts["groups"]], "lead": gifts["hub"]["lead"]}}
    for g in gifts["groups"]:
        pages[g["id"]] = {"label": g["label"], "h1": g["h1"], "ideas": [i["gift"] for i in g["ideas"]], "lead": g["lead"]}
    by_id = {i["id"]: i["gift"] for g in gifts["groups"] for i in g["ideas"]}
    for o in gifts["occasions"]:
        ids = o["ideas"] if o["ideas"] != "auto" else [i["id"] for g in gifts["groups"] for i in g["ideas"] if i.get("book")]
        pages[o["id"]] = {"label": o["label"], "h1": o["h1"], "ideas": [by_id[x] for x in ids if x in by_id], "lead": o["lead"]}
    return posts, pages


def check(posts, pages):
    bad = []
    for p in posts.get("posts") or []:
        if p.get("page", "") not in pages: bad.append(f"{p.get('slug')}: unknown page {p.get('page')!r}")
        if not re.fullmatch(r"gift-[a-z0-9-]+", p.get("slug", "")): bad.append(f"{p.get('slug')}: slug must start gift-")
        if re.search(r"[£$€]\s?\d", p.get("text", "") + p.get("card", "")): bad.append(f"{p['slug']}: no prices")
        if len(p.get("text", "")) > 254: bad.append(f"{p['slug']}: text too long for X ({len(p['text'])})")
        if len(p.get("card", "").split()) > 14: bad.append(f"{p['slug']}: card headline over 14 words")
    return bad


def _esc(t):
    import html
    return html.escape(t)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def wrap(d, text, f, width):
    NB = " "                                  # brand rule: never break "Don't Die Retired" across lines
    lines, line = [], ""
    for w in text.replace("Don't Die Retired", NB.join(["Don't", "Die", "Retired"])).split(" "):
        t = (line + " " + w).strip()
        if d.textlength(t, font=f) <= width or not line: line = t
        else: lines.append(line); line = w
    return [l.replace(NB, " ") for l in lines + [line]]


def fit(d, text, name, width, height, start, least):
    for s in range(start, least - 1, -2):
        f = font(name, s); lines = wrap(d, text, f, width); lh = round(s * 1.12)
        if lh * len(lines) <= height: return f, lines, lh
    f = font(name, least); return f, wrap(d, text, f, width), round(least * 1.12)


def sun(d, cx, cy, r, fill):
    """The sunrise mark, small, in the corner."""
    d.pieslice((cx - r, cy - r, cx + r, cy + r), 180, 360, fill=fill)
    for a in (200, 230, 260, 280, 310, 340):
        import math
        x1, y1 = cx + math.cos(math.radians(a)) * r * 1.3, cy + math.sin(math.radians(a)) * r * 1.3
        x2, y2 = cx + math.cos(math.radians(a)) * r * 1.65, cy + math.sin(math.radians(a)) * r * 1.65
        d.line((x1, y1, x2, y2), fill=fill, width=max(3, r // 6))
    d.rounded_rectangle((cx - r * 1.6, cy + 6, cx + r * 1.6, cy + 6 + max(4, r // 5)), radius=3, fill=fill)


def card(headline, kicker, ideas, size, out, foot="dontdieretired.com/gifts"):
    W, H = size
    img = Image.new("RGB", size, DARK); d = ImageDraw.Draw(img)
    for y in range(H):                             # crimson wash, darker at the top
        t = y / H; d.line((0, y, W, y), fill=tuple(round(DARK[i] + (RED[i] - DARK[i]) * t) for i in range(3)))
    pad = round(W * 0.07)
    kf = font("SourceSans3-SemiBold.ttf", round(W * 0.034))
    d.text((pad, pad), kicker, font=kf, fill=CREAM)
    hh = round(H * (0.34 if ideas else 0.55))
    f, lines, lh = fit(d, headline, "Fraunces-SemiBold.ttf", W - 2 * pad, hh, round(W * 0.085), round(W * 0.05))
    y = pad + round(W * 0.06)
    for l in lines: d.text((pad, y), l, font=f, fill="#ffffff"); y += lh
    if ideas:
        y += round(H * 0.035)
        d.line((pad, y, pad + round(W * 0.12), y), fill=GOLD, width=4); y += round(H * 0.035)
        bf = font("SourceSans3-SemiBold.ttf", round(W * (0.04 if W == H else 0.032)))
        room = H - pad - round(H * 0.09) - y
        for it in ideas:
            ls = wrap(d, it, bf, W - 2 * pad - 40)
            need = len(ls) * round(bf.size * 1.25) + 10
            if need > room: break
            d.ellipse((pad, y + bf.size * .35, pad + 14, y + bf.size * .35 + 14), fill=GOLD)
            for l in ls: d.text((pad + 34, y), l, font=bf, fill="#ffffff"); y += round(bf.size * 1.25)
            y += 10; room -= need
    ff = font("SourceSans3-SemiBold.ttf", round(W * 0.03))
    d.text((pad, H - pad - ff.size), foot, font=ff, fill=CREAM)
    sun(d, W - pad - 30, H - pad - ff.size // 2 - 4, 22, CREAM)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def draw_all(dist):
    posts, pages = load()
    bad = check(posts, pages)
    assert not bad, f"content/gift_posts.yaml: {bad}"
    dist = pathlib.Path(dist)
    for pid, pg in pages.items():                  # link previews for each gift page
        card(pg["h1"], "Gift ideas from Don't Die Retired", pg["ideas"][:4], (1200, 630), dist / "static" / "img" / "gifts" / f"og-{pid or 'hub'}.png",
             foot="dontdieretired.com/gifts" + (f"/{pid}" if pid else ""))
    # Pinterest (Robin, 19 Nov 2026): a tall pin per gift page and feed/gifts.xml for a "Gift ideas" board. Pinterest's
    # auto-publish reads the feed (RUNBOOK §6d); the dates are the day each page went up, so nothing is pinned twice.
    items = []
    for pid, pg in pages.items():
        pin = f"gifts-{pid or 'hub'}.png"
        card(pg["h1"], "Gift ideas", pg["ideas"][:10], (1000, 1500), dist / "static" / "pin" / pin, foot="dontdieretired.com/gifts")
        url = SITE + "/gifts/" + (pid + "/" if pid else "")
        items.append(f"""
    <item>
      <title>{_esc(pg['h1'])}</title>
      <link>{url}</link>
      <guid>{url}</guid>
      <pubDate>Thu, 19 Nov 2026 06:00:00 +0000</pubDate>
      <category>gifts</category>
      <description>{_esc(pg['lead'])}</description>
      <enclosure url="{SITE}/static/pin/{pin}" type="image/png" length="0"/>
    </item>""")
    (dist / "feed").mkdir(parents=True, exist_ok=True)
    (dist / "feed" / "gifts.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Don't Die Retired: gift ideas</title>
  <link>{SITE}/gifts/</link>
  <description>Present ideas for people who love doing things: classes, days out, trips and the kit to go with them.</description>
  <language>en-GB</language>{''.join(items)}
</channel></rss>""", encoding="utf-8")
    n = 0
    for p in posts.get("posts") or []:
        ideas = p["ideas"] if "ideas" in p else pages[p.get("page", "")]["ideas"][:4]
        k = p.get("kicker") or "Christmas gift ideas"
        card(p["card"], k, ideas, (1080, 1080), dist / "static" / "social" / f"{p['slug']}.png")
        card(p["card"], k, ideas[:3], (1200, 675), dist / "static" / "img" / f"{p['slug']}.png")
        n += 1
    return n


def write_packs():
    posts, pages = load()
    bad = check(posts, pages)
    if bad: sys.exit("\n".join(bad))
    today = dt.date.today().isoformat()
    made = kept = 0
    until = str(posts.get("until") or "9999")
    for p in posts["posts"]:
        if p["date"] > until: continue
        folder = ROOT / "social" / f"{p['date']}-{p['slug']}"
        if (folder / "meta.json").exists() and p["date"] < today:
            kept += 1; continue                     # already sent: never change its text
        page = SITE + "/gifts/" + (p["page"] + "/" if p.get("page") else "")
        utm = lambda s: f"{page}?utm_source={s}&utm_medium=social&utm_campaign=gifts"
        ideas = p["ideas"] if "ideas" in p else pages[p.get("page", "")]["ideas"][:4]
        meta = {
            "title": p["card"], "url": page, "date": p["date"], "category": "explore", "kind": "gift", "slot": p.get("slot", "10:30"), "fb_image": True,
            "tags": ["gifts", "christmas"],
            "alt": "A card with the words: " + p["card"] + (". Ideas listed: " + "; ".join(ideas) if ideas else ""),
            "posts": {
                "facebook": f"{p['text']}\n\nSee them → {utm('facebook')}",
                "instagram": f"{p['text']}\n\nLink in our bio (dontdieretired.com/gifts).\n\n{HASHTAGS}",
                "x": f"{p['text']}\n\n{utm('x')}",
            },
        }
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        made += 1
    print(f"gift posts: {made} packs written, {kept} already sent and left alone")
    return made


if __name__ == "__main__":
    write_packs()

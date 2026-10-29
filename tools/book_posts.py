#!/usr/bin/env python3
"""Social posts and image cards for the printed puzzle books (RUNBOOK §6s).

  python tools/book_posts.py          write social/<date>-<slug>/meta.json for every post in content/book_posts.yaml
                                      (never rewrites a pack whose date has passed: changing sent text would post it again)

build.py calls draw_all(dist) to make the cards: dist/static/social/<slug>.png (1080 square, Instagram),
dist/static/img/<slug>.png (1200 x 675, X) and dist/static/img/books/og-<book>.png (1200 x 630, link previews).
"""
import datetime as dt, json, pathlib, sys

import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "brand" / "fonts"
SITE = "https://dontdieretired.com"
PAGE = SITE + "/puzzle-books/"
INK, STONE, RED, GOLD = "#1b1b1f", "#f3f2f0", "#8E1F2F", "#c98a2b"
HASHTAGS = "#puzzles #puzzlebook #christmasgifts #stockingfillers #sudoku #largeprint #dontdieretired"


def load():
    data = yaml.safe_load((ROOT / "content" / "book_posts.yaml").read_text(encoding="utf-8")) or {}
    site = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))
    book = next((b for b in site.get("books") or [] if b["id"] == data.get("book")), None)
    return data, book


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def wrap(d, text, f, width):
    lines, line = [], ""
    NB = "\u00a0"                                  # brand rule: never break "Don't Die Retired" across lines
    for w in text.replace("Don't Die Retired", NB.join(["Don't", "Die", "Retired"])).split(" "):
        t = (line + " " + w).strip()
        if d.textlength(t, font=f) <= width or not line:
            line = t
        else:
            lines.append(line); line = w
    return [l.replace(NB, " ") for l in lines + [line]]


def fit_text(d, text, name, width, height, start, least):
    """Largest size (from start down to least) at which the text fits the box; returns font, lines, line height."""
    for s in range(start, least - 1, -2):
        f = font(name, s); lines = wrap(d, text, f, width); lh = round(s * 1.12)
        if lh * len(lines) <= height:
            return f, lines, lh
    f = font(name, least); return f, wrap(d, text, f, width), round(least * 1.12)


def paste_cover(img, cover, box_h, x, y):
    c = cover.copy(); c.thumbnail((10_000, box_h))
    sh = Image.new("RGBA", (c.width + 60, c.height + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 36, 30 + c.width, 36 + c.height), fill=(30, 20, 10, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    img.paste(sh, (x - 30, y - 30), sh)
    img.paste(c, (x, y))
    return c.width


def card(cover, headline, kicker, size, out):
    W, H = size
    img = Image.new("RGB", size, STONE); d = ImageDraw.Draw(img)
    pad = round(W * 0.07)
    if W == H:                                      # square: headline on top, cover below
        kf = font("SourceSans3-SemiBold.ttf", 40)
        d.text((pad, pad), kicker, font=kf, fill=RED)
        f, lines, lh = fit_text(d, headline, "Fraunces-SemiBold.ttf", W - 2 * pad, round(H * 0.25), 84, 52)
        y = pad + 64
        for l in lines: d.text((pad, y), l, font=f, fill=INK); y += lh
        cov_h = H - y - pad - 40
        cw = round(cov_h * cover.width / cover.height)
        paste_cover(img, cover, cov_h, (W - cw) // 2, y + 36)
    else:                                           # landscape: text left, cover right
        cov_h = H - 2 * pad + 20
        cw = round(cov_h * cover.width / cover.height)
        cx = W - pad - cw
        paste_cover(img, cover, cov_h, cx, (H - cov_h) // 2)
        tw = cx - 2 * pad + 20
        kf = font("SourceSans3-SemiBold.ttf", 30)
        f, lines, lh = fit_text(d, headline, "Fraunces-SemiBold.ttf", tw, round(H * 0.5), 74, 40)
        block = 50 + lh * len(lines)
        y = (H - block) // 2 - 20
        d.text((pad, y), kicker, font=kf, fill=RED); y += 50
        for l in lines: d.text((pad, y), l, font=f, fill=INK); y += lh
        d.text((pad, H - pad - 10), "dontdieretired.com/puzzle-books", font=font("SourceSans3-SemiBold.ttf", 26), fill="#5b5f6b")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def draw_all(dist):
    data, book = load()
    if not book:
        return 0
    cover = Image.open(ROOT / book["cover"].lstrip("/")).convert("RGB")
    kicker = "New on Amazon"
    card(cover, book["title"], kicker, (1200, 630), pathlib.Path(dist) / "static" / "img" / "books" / f"og-{book['id']}.png")
    n = 0
    for p in data.get("posts") or []:
        card(cover, p["card"], "The Christmas Puzzle Book, on Amazon", (1080, 1080), pathlib.Path(dist) / "static" / "social" / f"{p['slug']}.png")
        card(cover, p["card"], "The Christmas Puzzle Book, on Amazon", (1200, 675), pathlib.Path(dist) / "static" / "img" / f"{p['slug']}.png")
        n += 1
    return n


def write_packs():
    data, book = load()
    if not book:
        sys.exit("No book with an Amazon link in site.yaml matches content/book_posts.yaml")
    today = dt.date.today().isoformat()
    made = kept = 0
    for p in data["posts"]:
        folder = ROOT / "social" / f"{p['date']}-{p['slug']}"
        if (folder / "meta.json").exists() and p["date"] < today:
            kept += 1; continue                     # already sent: never change its text
        utm = lambda s: f"{PAGE}?utm_source={s}&utm_medium=social&utm_campaign=book-{book['id']}"
        meta = {
            "title": p["card"], "url": PAGE, "date": p["date"], "category": "think", "kind": "book",
            "tags": ["puzzles", "puzzle-book", "christmas"],
            "posts": {
                "facebook": f"{p['text']}\n\nSee it → {utm('facebook')}",
                "instagram": f"{p['text']}\n\nLink in our bio (dontdieretired.com/puzzle-books).\n\n{HASHTAGS}",
                "x": f"{p['text']}\n\n{utm('x')}",
            },
        }
        if len(meta["posts"]["x"].split("\n\n")[0]) > 255:   # X counts a link as 23 characters; keep the whole post under 280
            sys.exit(f"{p['slug']}: text too long for X")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        made += 1
    print(f"book posts: {made} packs written, {kept} already sent and left alone")


if __name__ == "__main__":
    write_packs()

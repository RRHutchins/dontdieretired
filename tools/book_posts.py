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


PHOTO_CREDIT = "Photo: Don't Die Retired"
PHOTO_ALT = ("Printed copies of The Don't Die Retired Christmas Puzzle Book and the UK and American editions of the "
             "Christmas Quiz Book on a wooden table, beside the words: ")
# Alt text and crop for each of Robin's photos (a post may pick one with `photo:`). Default: PHOTO_ALT, left-anchored crop.
PHOTOS = {
    "santa-hat-books.jpg": {   # sent 25 Nov 2026
        "alt": ("A printed copy of The Don't Die Retired Christmas Puzzle Book tucked into a red Santa hat on a blue checked "
                "sofa, with the American edition of the Christmas Quiz Book propped in front, beside the words: "),
        "anchor": "center",
    },
}


def photo_alt(photo):
    return (PHOTOS.get(pathlib.Path(str(photo)).name) or {}).get("alt", PHOTO_ALT)


def amazon_links(ids):
    """Plain Amazon links for social captions (no Associates tag, so no disclosure is needed): UK on amazon.co.uk,
    US on amazon.com, same ASIN (KDP paperbacks keep one ASIN across marketplaces). Robin, 25 Nov 2026: add the links."""
    site = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))
    every = {b["id"]: b for b in (site.get("books") or []) + (site.get("quiz_books") or [])}
    out = []
    for label, bid, shop in ids:
        b = every.get(bid)
        if b and str(b.get("amazon", "")).startswith("https://www.amazon.") and b.get("asin"):
            out.append((label, f"https://www.amazon.{shop}/dp/{b['asin']}"))
    return out


PUZZLE_LINKS = [("UK", "christmas", "co.uk"), ("US", "christmas", "com")]
QUIZ_LINKS = [("UK edition", "quiz-uk", "co.uk"), ("American edition", "quiz-us", "com")]


def links_block(ids, head="Buy it on Amazon"):
    links = amazon_links(ids)
    return (head + ":\n" + "\n".join(f"{lab}: {url}" for lab, url in links)) if links else ""


def photo_for(data, date, post=None):
    """Robin's own photo of the printed books (sent 22 Nov 2026), for posts dated on or after `photo_from`; a post's own
    `photo:` picks another of his photos. Earlier posts keep the cover card: a sent post is never changed."""
    if post and post.get("photo") and str(date) >= str(data.get("photo_from") or "9999"):
        return ROOT / post["photo"]
    if data.get("photo") and str(date) >= str(data.get("photo_from") or "9999"):
        return ROOT / data["photo"]
    return None


def photo_card(photo, headline, kicker, size, out):
    """Our own photograph of the books on one side, cropped to fill; kicker, headline, credit and address on the stone panel."""
    from PIL import ImageOps
    W, H = size
    img = Image.new("RGB", size, STONE); d = ImageDraw.Draw(img)
    src = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    pw = round(W * (0.62 if W == H else 0.44))
    sc = max(pw / src.width, H / src.height)
    rs = src.resize((round(src.width * sc) + 1, round(src.height * sc) + 1), Image.LANCZOS)
    anchor = (PHOTOS.get(pathlib.Path(str(photo)).name) or {}).get("anchor", "left")
    l = (rs.width - pw) // 2 if anchor == "center" else 0
    t = (rs.height - H) // 2                  # left-anchored by default: keeps the puzzle book's full title in shot
    img.paste(rs.crop((l, t, l + pw, t + H)), (W - pw, 0))
    pad = round(W * 0.05); tw = W - pw - 2 * pad
    kf = font("SourceSans3-SemiBold.ttf", 28 if W == H else 26)
    kl = wrap(d, kicker, kf, tw)
    uf = font("SourceSans3-SemiBold.ttf", 24); cf = font("SourceSans3-Regular.ttf", 20)
    top = pad + len(kl) * 34 + 24
    size_ = 64
    while True:                                     # shrink until the block fits and no single word runs onto the photo
        f, lines, lh = fit_text(d, headline, "Fraunces-SemiBold.ttf", tw, H - top - pad - 110, size_, 30)
        if max(d.textlength(ln, font=f) for ln in lines) <= tw or f.size <= 30:
            break
        size_ = f.size - 2
    y = pad
    for k in kl: d.text((pad, y), k, font=kf, fill=RED); y += 34
    y += 24
    for ln in lines: d.text((pad, y), ln, font=f, fill=INK); y += lh
    d.text((pad, H - pad - 62), PHOTO_CREDIT, font=cf, fill="#5b5f6b")
    d.text((pad, H - pad - 28), "dontdieretired.com/puzzle-books", font=uf, fill="#5b5f6b")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def compare_card(left, right, headline, size, out):
    """The bad AI cartoon (labelled AI-made) beside Robin's real photo of the books, headline above (Robin, 22 Nov 2026)."""
    from PIL import ImageOps
    W, H = size
    img = Image.new("RGB", size, STONE); d = ImageDraw.Draw(img)
    pad = round(W * 0.045)
    sq = W == H
    f, lines, lh = fit_text(d, headline, "Fraunces-SemiBold.ttf", W - 2 * pad, round(H * (0.2 if sq else 0.22)), 60, 30)
    y = pad
    for ln in lines: d.text((pad, y), ln, font=f, fill=INK); y += lh
    top = y + 18; lab = 44; foot = 40
    ph = H - top - lab - foot - pad
    gap = 24; pw = (W - 2 * pad - gap) // 2
    lf = font("SourceSans3-SemiBold.ttf", 28)
    for i, (src, label, col) in enumerate([(left, "AI-made: please, no", RED), (right, "The real books", "#2F5D3A")]):
        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        im = ImageOps.fit(im, (pw, ph), Image.LANCZOS, centering=(0.0, 0.05) if i else (0.5, 0.5))
        x = pad + i * (pw + gap)
        img.paste(im, (x, top))
        d.text((x, top + ph + 8), label, font=lf, fill=col)
        if i == 0:
            d.line((x + 10, top + 10, x + pw - 10, top + ph - 10), fill=RED, width=10)
            d.line((x + pw - 10, top + 10, x + 10, top + ph - 10), fill=RED, width=10)
    d.text((pad, H - pad - 28), "dontdieretired.com/puzzle-books", font=font("SourceSans3-SemiBold.ttf", 24), fill="#5b5f6b")
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
        ph = photo_for(data, p["date"], p)
        draw = (lambda *a: photo_card(ph, *a)) if ph else (lambda *a: card(cover, *a))
        draw(p["card"], "The Christmas Puzzle Book, on Amazon", (1080, 1080), pathlib.Path(dist) / "static" / "social" / f"{p['slug']}.png")
        draw(p["card"], "The Christmas Puzzle Book, on Amazon", (1200, 675), pathlib.Path(dist) / "static" / "img" / f"{p['slug']}.png")
        n += 1
    return n


LINKS_FROM = "2026-11-26"   # Amazon links in captions from the first post written after Robin asked (25 Nov 2026)


def x_post(text, links, fallback):
    """X counts every link as 23 characters. Amazon UK and US links when they fit under 280, else our page."""
    if links:
        tail = "\n\n" + " · ".join(f"{lab}: {url}" for lab, url in links)
        if len(text) + len(tail) - sum(len(u) - 23 for _, u in links) <= 280:
            return text + tail
    return f"{text}\n\n{fallback}"


def write_packs():
    data, book = load()
    if not book:
        sys.exit("No book with an Amazon link in site.yaml matches content/book_posts.yaml")
    today = dt.date.today().isoformat()
    made = kept = 0
    until = str(data.get("until") or "9999")
    for p in data["posts"]:
        if p["date"] > until:
            continue
        folder = ROOT / "social" / f"{p['date']}-{p['slug']}"
        if (folder / "meta.json").exists() and p["date"] < today:
            kept += 1; continue                     # already sent: never change its text
        utm = lambda s: f"{PAGE}?utm_source={s}&utm_medium=social&utm_campaign=book-{book['id']}"
        ph = photo_for(data, p["date"], p)
        buy = links_block(PUZZLE_LINKS) if p["date"] >= LINKS_FROM else ""
        xlinks = amazon_links(PUZZLE_LINKS) if p["date"] >= LINKS_FROM else []
        meta = {
            "title": p["card"], "url": PAGE, "date": p["date"], "category": "think", "kind": "book",
            "tags": ["puzzles", "puzzle-book", "christmas"],
            **({"alt": photo_alt(ph) + p["card"], "fb_image": True} if ph else {}),
            "posts": {
                "facebook": f"{p['text']}\n\n" + (f"{buy}\n\n" if buy else "") + f"See it → {utm('facebook')}",
                "instagram": f"{p['text']}\n\n" + (f"{buy}\n\n" if buy else "") + f"Link in our bio (dontdieretired.com/puzzle-books).\n\n{HASHTAGS}",
                "x": x_post(p["text"], xlinks, utm("x")),
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

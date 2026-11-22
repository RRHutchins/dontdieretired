#!/usr/bin/env python3
"""Social posts and cards for the Christmas Quiz Book, UK and American editions (RUNBOOK §6s).

  python tools/quiz_posts.py     write social/<date>-<slug>/meta.json for every post in content/quiz_posts.yaml,
                                 but only once both editions have an Amazon link in site.yaml → quiz_books
                                 (never rewrites a pack whose date has passed)

build.py calls draw_all(dist): dist/static/social/<slug>.png (1080 square), dist/static/img/<slug>.png (1200 x 675)
and dist/static/img/books/og-quiz.png (1200 x 630, link previews), each with both covers.
"""
import datetime as dt, importlib.util, json, pathlib, sys

import yaml
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://dontdieretired.com"
PAGE = SITE + "/puzzle-books/"
HASHTAGS = "#DontDieRetired #ChristmasQuiz #FamilyQuiz #QuizNight #StockingFillers #ChristmasGifts"
FOOT = "It's one of the 300 questions in our Christmas Quiz Book, in a UK and an American edition, on Amazon."

_spec = importlib.util.spec_from_file_location("book_posts", ROOT / "tools" / "book_posts.py")
bp = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(bp)


def live_books():
    site = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))
    qb = site.get("quiz_books") or []
    ok = [b for b in qb if str(b.get("amazon", "")).startswith("https://www.amazon.")]
    return ok if len(ok) == len(qb) and ok else []


def data():
    return yaml.safe_load((ROOT / "content" / "quiz_posts.yaml").read_text(encoding="utf-8")) or {}


def load():
    return data().get("posts") or []


def check():
    """Every build: hooks short, questions carry answers, no price or banned words, X length."""
    seen = set()
    for p in load():
        assert p["slug"] not in seen, f"quiz_posts: duplicate slug {p['slug']}"; seen.add(p["slug"])
        assert p.get("answer") if p.get("question") else p.get("text"), f"quiz_posts {p['slug']}: needs text or answer"
        words = (p["card"] + " " + p.get("text", "") + " " + p.get("answer", "")).lower()
        assert "£" not in words and "$" not in words and (p.get("question") or "best" not in words.split()), f"quiz_posts {p['slug']}: no prices or 'best'"
        if not p.get("question"):
            assert len(p["card"].split()) <= 20, f"quiz_posts {p['slug']}: card over 20 words"
    return len(seen)


def covers(fan=False):
    """Both covers side by side; fanned (the American edition half behind the UK one) for the wide cards."""
    a = Image.open(ROOT / "static/img/books/quiz-uk.png").convert("RGB")
    b = Image.open(ROOT / "static/img/books/quiz-us.png").convert("RGB")
    if fan:
        off = int(a.width * 0.42)
        img = Image.new("RGB", (a.width + off, a.height), bp.STONE)
        img.paste(b, (off, 0)); img.paste(a, (0, 0))
        return img
    gap = 40
    img = Image.new("RGB", (a.width + b.width + gap, max(a.height, b.height)), bp.STONE)
    img.paste(a, (0, 0)); img.paste(b, (a.width + gap, 0))
    return img


def draw_all(dist):
    check()
    if not live_books():
        return 0
    cov, fan = covers(), covers(fan=True)
    dist = pathlib.Path(dist)
    bp.card(fan, "The Don't Die Retired Christmas Quiz Book", "New on Amazon: UK and American editions", (1200, 630),
            dist / "static" / "img" / "books" / "og-quiz.png")
    n = 0
    for p in load():
        kicker = "Christmas quiz: can you answer this?" if p.get("question") else "The Christmas Quiz Book, on Amazon"
        ph = bp.photo_for(data(), p["date"])
        if p.get("compare"):
            for sz, sub in (((1080, 1080), "social"), ((1200, 675), "img")):
                bp.compare_card(ROOT / p["compare"][0], ROOT / p["compare"][1], p["card"], sz, dist / "static" / sub / f"{p['slug']}.png")
        elif ph:
            bp.photo_card(ph, p["card"], kicker, (1080, 1080), dist / "static" / "social" / f"{p['slug']}.png")
            bp.photo_card(ph, p["card"], kicker, (1200, 675), dist / "static" / "img" / f"{p['slug']}.png")
        else:
            bp.card(cov, p["card"], kicker, (1080, 1080), dist / "static" / "social" / f"{p['slug']}.png")
            bp.card(fan, p["card"], kicker, (1200, 675), dist / "static" / "img" / f"{p['slug']}.png")
        n += 1
    return n


def write_packs():
    check()
    if not live_books():
        print("quiz posts: held (no Amazon link for both editions in site.yaml → quiz_books yet)"); return 0
    today = dt.date.today().isoformat()
    made = kept = 0
    until = str((yaml.safe_load((ROOT / "content" / "quiz_posts.yaml").read_text(encoding="utf-8")) or {}).get("until") or "9999")
    for p in load():
        if p["date"] > until:
            continue
        folder = ROOT / "social" / f"{p['date']}-{p['slug']}"
        if (folder / "meta.json").exists() and p["date"] < today:
            kept += 1; continue
        utm = lambda s: f"{PAGE}?utm_source={s}&utm_medium=social&utm_campaign=book-quiz#quiz"
        if p.get("question"):
            body = f"{p['card']}\n\nThe answer is further down ↓\n\n·\n·\n·\n\nAnswer: {p['answer']}\n\n{FOOT}"
            xbody = f"{p['card']} The answer is in our Christmas Quiz Book."
            if len(xbody) > 254: xbody = p["card"]
        else:
            body = xbody = p["text"]
        meta = {
            "title": p["card"], "url": PAGE, "date": p["date"], "category": "think", "kind": "book", "slot": "20:00", "fb_image": True,
            "tags": ["quiz", "quiz-book", "christmas"],
            "alt": p.get("alt") or (bp.PHOTO_ALT if bp.photo_for(data(), p["date"]) else
                    "The covers of the UK and American editions of The Don't Die Retired Christmas Quiz Book, beside the words: ") + p["card"],
            "posts": {
                "facebook": f"{body}\n\nSee it → {utm('facebook')}",
                "instagram": f"{body}\n\nLink in our bio (dontdieretired.com/puzzle-books).\n\n{HASHTAGS}",
                "x": f"{xbody}\n\n{utm('x')}",
            },
        }
        if len(xbody) > 254:
            sys.exit(f"{p['slug']}: text too long for X")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        made += 1
    print(f"quiz posts: {made} packs written, {kept} already sent and left alone")
    return made


if __name__ == "__main__":
    write_packs()

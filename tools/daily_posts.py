#!/usr/bin/env python3
"""Daily social posts beside the story: a puzzle in the morning and a thing to do in the evening (RUNBOOK §6d, 18 Nov 2026).

  python tools/daily_posts.py      write social/<date>-puzzle-<date>/ for today and the next 21 days (from the
                                   puzzles already in content/puzzle_days.json and puzzle_extra.json), and
                                   social/<date>-do-<id>/ for every post in content/activity_posts.yaml
build.py runs write_packs() on every full build and draw_all(dist, helpers) on every build (cards are drawn in CI).

The day's posts, UK time: 08:00 puzzle, 13:00 story, 18:00 thing to do (post_social.py reads `slot`).
Never rewrites a pack whose date has passed (its text may already be in Buffer, and changed text posts again).
"""
import datetime as dt, json, pathlib, random, sys

import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "brand" / "fonts"
SITE = "https://dontdieretired.com"
AHEAD = 21
FIRST_PUZZLE_DAY = "2026-11-19"
BLUE, CREAM, GOLD, INK, RED = "#1F4E79", "#FBF6EE", "#c98a2b", "#1b1b1f", "#b23a48"
BRAND_TAGS = "#DontDieRetired #NeverRetireFromLife #TryNewThings"
TOPIC_TAGS = {"move": "#MoveMore", "eat": "#CookFromScratch", "think": "#KeepLearning", "money": "#MoneyMatters",
              "earn": "#CareerChange", "connect": "#Community", "travel": "#Adventure", "tech": "#TechTips",
              "ai": "#AIForEveryone", "explore": "#Outdoors", "curious": "#History"}
# which puzzle goes out on which weekday (Monday = 0), and at which level: g gentle, s steady, h hard
ROTA = {0: ("wheel", None), 1: ("ladder", "s"), 2: ("numbers", "s"), 3: ("sudoku", "g"),
        4: ("wheel", None), 5: ("ladder", "h"), 6: ("numbers", "h")}
LEVEL = {"g": "Gentle", "s": "Steady", "h": "Hard"}
NAME = {"wheel": "The Wheel", "ladder": "The Ladder", "numbers": "Numbers", "sudoku": "Sudoku"}


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def utm(url, src, campaign):
    return f"{url}?utm_source={src}&utm_medium=social&utm_campaign={campaign}"


# ---------------------------------------------------------------- puzzle data

def _data():
    days = json.loads((ROOT / "content" / "puzzle_days.json").read_text(encoding="utf-8"))
    extra = json.loads((ROOT / "content" / "puzzle_extra.json").read_text(encoding="utf-8"))
    return days, extra


def wheel(days, d):
    """The nine letters in the same order the site shows them, the centre letter, the answers."""
    sys.path.insert(0, str(ROOT / "tools"))
    from build_puzzles import load_words, answers
    from collections import Counter
    word, centre = days[d]
    outer = list(word); outer.remove(centre)
    random.Random(d).shuffle(outer)                 # same seed and steps as build.py, so the post matches the page
    if not hasattr(wheel, "wc"):
        wheel.wc = [(w, Counter(w)) for w in load_words()]
    ans = sorted(answers(word, centre, wheel.wc))
    return {"outer": outer, "centre": centre, "n": len(ans), "nines": [a for a in ans if len(a) == 9]}


def puzzle_of(d):
    kind, lv = ROTA[dt.date.fromisoformat(d).weekday()]
    return kind, lv


def answer_line(days, extra, d):
    """Yesterday's answer for the puzzle we posted yesterday (the site shows yesterday's answers too)."""
    y = (dt.date.fromisoformat(d) - dt.timedelta(days=1)).isoformat()
    if y < FIRST_PUZZLE_DAY or y not in days or y not in extra:
        return ""
    kind, lv = puzzle_of(y)
    if kind == "wheel":
        return f"Yesterday's Wheel: the nine-letter word was {', '.join(w.upper() for w in wheel(days, y)['nines'])}."
    if kind == "ladder":
        return f"Yesterday's Ladder: {' → '.join(w.upper() for w in extra[y]['ladder'][lv])} (other routes may work too)."
    if kind == "numbers":
        return f"Yesterday's Numbers: {'; '.join(extra[y]['numbers'][lv]['w'])} (other ways may work too)."
    return ""                                       # a sudoku answer does not fit in a post; it is on the site


def puzzle_text(days, extra, d):
    kind, lv = puzzle_of(d)
    if kind == "wheel":
        w = wheel(days, d)
        card = "How many words can you make from nine letters?"
        body = (f"Today's Wheel: make words of four letters or more, and every word must use the middle letter, "
                f"{w['centre'].upper()}. There are {w['n']} to find, and one uses all nine letters.")
    elif kind == "ladder":
        p = extra[d]["ladder"][lv]
        card = f"Can you turn {p[0].upper()} into {p[-1].upper()}?"
        body = (f"Today's Ladder ({LEVEL[lv].lower()}): turn {p[0].upper()} into {p[-1].upper()} in {len(p) - 1} steps, "
                f"changing one letter at a time. Every step must be a real word.")
    elif kind == "numbers":
        n = extra[d]["numbers"][lv]
        card = f"Can you make {n['t']}?"
        body = (f"Today's Numbers ({LEVEL[lv].lower()}): make {n['t']} from {', '.join(map(str, n['n'][:-1]))} and {n['n'][-1]}, "
                f"using add, take away, times and divide. Use each number once at most; you do not have to use them all.")
    else:
        card = "Today's sudoku, small enough for a coffee break"
        body = ("Today's sudoku (gentle) is a six-by-six grid: every row, column and outlined box holds 1 to 6 once. "
                "It has exactly one answer.")
    return kind, lv, card, body


# ---------------------------------------------------------------- packs

def _write(folder, meta, today):
    f = folder / "meta.json"
    if f.exists() and meta["date"] < today:
        return False
    if len(meta["posts"]["x"].rsplit("\n\n", 1)[0]) > 254:     # X counts a link as 23; keep the whole post under 280
        sys.exit(f"{folder.name}: text too long for X")
    folder.mkdir(parents=True, exist_ok=True)
    new = json.dumps(meta, indent=2, ensure_ascii=False) + "\n"
    if f.exists() and f.read_text(encoding="utf-8") == new:
        return False
    f.write_text(new, encoding="utf-8")
    return True


def puzzle_packs(today):
    days, extra = _data()
    start = max(dt.date.fromisoformat(today), dt.date.fromisoformat(FIRST_PUZZLE_DAY))
    made = 0
    for i in range(AHEAD + 1):
        d = (start + dt.timedelta(days=i)).isoformat()
        if d not in days or d not in extra:
            continue
        kind, lv, card, body = puzzle_text(days, extra, d)
        ans = answer_line(days, extra, d)
        url = SITE + "/puzzle/"
        more = "Three more puzzles are waiting on the site, each at three levels."
        meta = {
            "title": card, "url": url, "date": d, "category": "think", "kind": "puzzle", "puzzle": kind,
            "level": lv, "slot": "08:00", "same_day": True, "fb_image": True,
            "alt": f"{NAME[kind]} for {dt.date.fromisoformat(d):%-d %B %Y}. {body}",
            "posts": {
                "facebook": f"{body} {more}\n\nPlay free → {utm(url, 'facebook', 'puzzle')}" + (f"\n\n{ans}" if ans else ""),
                "instagram": f"{body} {more}\n\nPlay free: link in our bio (dontdieretired.com/puzzle)."
                             + (f"\n\n{ans}" if ans else "") + f"\n\n{BRAND_TAGS} #KeepLearning #PuzzleOfTheDay #BrainTeaser",
                "x": f"{body}\n\n{utm(url, 'x', 'puzzle')}",
            },
        }
        made += _write(ROOT / "social" / f"{d}-puzzle-{d}", meta, today)
    return made


def _activities():
    acts = {a["id"]: a for a in yaml.safe_load((ROOT / "content" / "challenges.yaml").read_text(encoding="utf-8"))}
    credits = yaml.safe_load((ROOT / "content" / "photo_credits.yaml").read_text(encoding="utf-8")) or {}
    posts = (yaml.safe_load((ROOT / "content" / "activity_posts.yaml").read_text(encoding="utf-8")) or {}).get("posts") or []
    return acts, credits, posts


def check_activity_posts():
    """Run on every build: each post names a real activity, the hook is short, and a photo is only used once checked."""
    acts, credits, posts = _activities()
    seen = set()
    for p in posts:
        a = acts.get(p["id"])
        assert a, f"activity_posts: no activity {p['id']}"
        assert p["date"] not in seen, f"activity_posts: two posts on {p['date']}"; seen.add(p["date"])
        assert len(p["card"].split()) <= 20, f"activity_posts {p['id']}: card hook over 20 words"
        if p.get("photo"):
            assert a.get("photo_checked") and ("list-" + a["id"]) in credits, f"activity_posts {p['id']}: photo not checked"
            c = credits["list-" + a["id"]]
            assert c["licence"].lower().startswith(("cc by", "cc0", "public domain")) and "nc" not in c["licence"].lower() \
                and "nd" not in c["licence"].lower().split("-") and not c.get("restrictions"), f"activity_posts {p['id']}: licence not allowed on social"
    return len(posts)


def activity_packs(today):
    acts, credits, posts = _activities()
    made = 0
    for p in posts:
        a = acts[p["id"]]
        url = f"{SITE}/list/{a['id']}/"
        credit = ""
        if p.get("photo"):
            c = credits["list-" + a["id"]]
            credit = f"Photo: {c['author']}, {c['licence']} ({c.get('licence_url') or 'public domain'}), via Wikimedia Commons: {c['page']} (cropped)."
        tags = f"{BRAND_TAGS} {TOPIC_TAGS.get(a['category'], '')} #ThingsToDo".replace("  ", " ")
        meta = {
            "title": p["card"], "url": url, "date": p["date"], "category": a["category"], "kind": "activity",
            "activity": a["id"], "slot": "18:00", "fb_image": True, "photo": bool(p.get("photo")),
            "alt": a.get("photo_alt") or p["card"],
            "posts": {
                "facebook": f"{p['text']}\n\nHow to start, and where to go → {utm(url, 'facebook', 'things-to-do')}"
                            + (f"\n\n{credit}" if credit else ""),
                "instagram": f"{p['text']}\n\nHow to start, and where to go: link in our bio (dontdieretired.com/list/{a['id']})."
                             + (f"\n\n{credit}" if credit else "") + f"\n\n{tags}",
                "x": f"{p.get('x') or p['card']}\n\n{utm(url, 'x', 'things-to-do')}",
            },
        }
        made += _write(ROOT / "social" / f"{p['date']}-do-{a['id']}", meta, today)
    return made


def write_packs(today=None):
    today = today or dt.date.today().isoformat()
    check_activity_posts()
    return puzzle_packs(today), activity_packs(today)


# ---------------------------------------------------------------- cards (drawn in every build, CI included)

def _sun(d, cx, cy, r, fill):
    import math
    for i in range(7):
        a = math.pi * (i + 0.5) / 7
        d.line((cx - math.cos(a) * r * 1.35, cy - math.sin(a) * r * 1.35, cx - math.cos(a) * r * 1.9, cy - math.sin(a) * r * 1.9),
               fill=fill, width=max(2, r // 7))
    d.pieslice((cx - r, cy - r, cx + r, cy + r), 180, 360, fill=fill)


def _centred(d, text, f, cx, y, fill):
    d.text((cx - d.textlength(text, font=f) / 2, y), text, font=f, fill=fill)


def _wrap(d, text, f, width):
    lines, line = [], ""
    for w in text.split():
        t = (line + " " + w).strip()
        if d.textlength(t, font=f) <= width or not line: line = t
        else: lines.append(line); line = w
    return lines + [line]


def _draw_puzzle(d, kind, lv, data, box):
    """The puzzle itself, cream on the topic blue, inside box (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if kind == "wheel":
        import math
        R = min(w, h) * 0.36; r = R * 0.36
        f = font("Fraunces-Bold.ttf", int(r * 1.05))
        for i, ch in enumerate(data["outer"]):
            a = -math.pi / 2 + i * 2 * math.pi / 8
            px, py = cx + math.cos(a) * R, cy + math.sin(a) * R
            d.ellipse((px - r, py - r, px + r, py + r), fill=CREAM)
            tw = d.textlength(ch.upper(), font=f); bb = d.textbbox((0, 0), ch.upper(), font=f)
            d.text((px - tw / 2, py - (bb[1] + bb[3]) / 2), ch.upper(), font=f, fill=BLUE)
        rc = r * 1.2
        d.ellipse((cx - rc, cy - rc, cx + rc, cy + rc), fill=GOLD)
        ch = data["centre"].upper(); f2 = font("Fraunces-Bold.ttf", int(rc * 1.1))
        tw = d.textlength(ch, font=f2); bb = d.textbbox((0, 0), ch, font=f2)
        d.text((cx - tw / 2, cy - (bb[1] + bb[3]) / 2), ch, font=f2, fill=INK)
    elif kind == "ladder":
        p = data
        n = len(p)
        cell = min(h / (n * 1.18), w / (len(p[0]) * 1.5))
        f = font("Fraunces-Bold.ttf", int(cell * 0.62))
        gap = cell * 0.18
        top = cy - (n * cell + (n - 1) * gap) / 2
        for i in range(n):
            word = p[i] if i in (0, n - 1) else " " * len(p[0])
            left = cx - (len(word) * cell + (len(word) - 1) * gap) / 2
            y = top + i * (cell + gap)
            for j, ch in enumerate(word):
                x = left + j * (cell + gap)
                filled = i in (0, n - 1)
                d.rounded_rectangle((x, y, x + cell, y + cell), radius=cell * 0.12, fill=CREAM if filled else None,
                                    outline=CREAM, width=max(2, int(cell * 0.05)))
                if filled:
                    tw = d.textlength(ch.upper(), font=f); bb = d.textbbox((0, 0), ch.upper(), font=f)
                    d.text((x + (cell - tw) / 2, y + cell / 2 - (bb[1] + bb[3]) / 2), ch.upper(), font=f, fill=BLUE)
    elif kind == "numbers":
        n = data
        tf = font("Fraunces-Bold.ttf", int(h * 0.36))
        _centred(d, str(n["t"]), tf, cx, y0 - h * 0.02, GOLD)
        k = len(n["n"]); tile = min(w / (k * 1.25), h * 0.3)
        gap = tile * 0.22; left = cx - (k * tile + (k - 1) * gap) / 2; y = y0 + h * 0.6
        f = font("Fraunces-Bold.ttf", int(tile * (0.5 if max(n["n"]) < 100 else 0.4)))
        for j, v in enumerate(n["n"]):
            x = left + j * (tile + gap)
            d.rounded_rectangle((x, y, x + tile, y + tile), radius=tile * 0.14, fill=CREAM)
            s = str(v); tw = d.textlength(s, font=f); bb = d.textbbox((0, 0), s, font=f)
            d.text((x + (tile - tw) / 2, y + tile / 2 - (bb[1] + bb[3]) / 2), s, font=f, fill=BLUE)
    else:
        puz = data
        N = int(len(puz) ** .5); br = 2 if N == 6 else 3
        size = min(w, h); cell = size / N
        gx, gy = cx - size / 2, cy - size / 2
        d.rectangle((gx, gy, gx + size, gy + size), fill=CREAM)
        f = font("Fraunces-Bold.ttf", int(cell * 0.6))
        for i in range(N + 1):
            d.line((gx, gy + i * cell, gx + size, gy + i * cell), fill=BLUE, width=6 if i % br == 0 else 2)
            d.line((gx + i * cell, gy, gx + i * cell, gy + size), fill=BLUE, width=6 if i % 3 == 0 else 2)
        for k, ch in enumerate(puz):
            if ch != "0":
                r, c = divmod(k, N)
                tw = d.textlength(ch, font=f); bb = d.textbbox((0, 0), ch, font=f)
                d.text((gx + c * cell + (cell - tw) / 2, gy + r * cell + cell / 2 - (bb[1] + bb[3]) / 2), ch, font=f, fill=INK)


def puzzle_card(d_iso, kind, lv, data, headline, size, out):
    W, H = size
    img = Image.new("RGB", size, BLUE); d = ImageDraw.Draw(img)
    pad = int(min(W, H) * 0.07)
    soft = "#C9D6E4"
    kf = font("SourceSans3-SemiBold.ttf", int(min(W, H) * 0.04))
    day = dt.date.fromisoformat(d_iso)
    kicker = f"Today's puzzle · {day:%A} {day.day} {day:%B}" + (f" · {LEVEL[lv]}" if lv else "")
    ff = font("SourceSans3-SemiBold.ttf", int(min(W, H) * 0.038))
    foot = "Play free at dontdieretired.com/puzzle"
    if W == H:
        d.text((pad, pad), kicker, font=kf, fill=soft)
        hf = font("Fraunces-Bold.ttf", int(W * 0.066))
        lines = _wrap(d, headline, hf, W - 2 * pad); y = pad + int(kf.size * 1.7)
        for l in lines: d.text((pad, y), l, font=hf, fill=CREAM); y += int(hf.size * 1.15)
        box = (pad, y + pad * 0.6, W - pad, H - pad - ff.size * 2.2)
    else:
        tw = int(W * 0.46)
        k1 = f"Today's puzzle · {day:%A} {day.day} {day:%B}"
        d.text((pad, pad), k1, font=kf, fill=soft)
        if lv: d.text((pad, pad + int(kf.size * 1.3)), LEVEL[lv], font=kf, fill=soft)
        hf = font("Fraunces-Bold.ttf", int(H * 0.095))
        lines = _wrap(d, headline, hf, tw - pad); y = pad + int(kf.size * 3)
        for l in lines: d.text((pad, y), l, font=hf, fill=CREAM); y += int(hf.size * 1.15)
        box = (tw + pad * 0.5, pad, W - pad, H - pad)
    _draw_puzzle(d, kind, lv, data, tuple(int(v) for v in box))
    d.text((pad, H - pad - ff.size), foot, font=ff, fill=soft)
    if W == H:
        _sun(d, W - pad - 40, H - pad + 4, 30, GOLD)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def draw_all(dist, make_photo_card=None, make_card=None):
    """Cards for every pack in the window: static/social/<slug>.png (square: Instagram and Facebook) and
    static/img/<slug>.png (landscape: X)."""
    dist = pathlib.Path(dist)
    today = dt.date.today()
    lo, hi = (today - dt.timedelta(days=2)).isoformat(), (today + dt.timedelta(days=AHEAD + 1)).isoformat()
    days, extra = _data()
    n = 0
    for folder in sorted((ROOT / "social").glob("*-puzzle-*")):
        d = folder.name[:10]
        if not (lo <= d <= hi) or d not in days or d not in extra:
            continue
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        kind, lv = meta["puzzle"], meta["level"]
        data = wheel(days, d) if kind == "wheel" else extra[d]["ladder"][lv] if kind == "ladder" else \
            extra[d]["numbers"][lv] if kind == "numbers" else extra[d]["sudoku"][lv][0]
        slug = folder.name[11:]
        puzzle_card(d, kind, lv, data, meta["title"], (1080, 1080), dist / "static" / "social" / f"{slug}.png")
        puzzle_card(d, kind, lv, data, meta["title"], (1200, 675), dist / "static" / "img" / f"{slug}.png")
        n += 1
    acts, credits, posts = _activities()
    for p in posts:
        if not (lo <= p["date"] <= hi):
            continue
        a = acts[p["id"]]; slug = f"do-{a['id']}"
        for size, out in (((1080, 1080), dist / "static" / "social" / f"{slug}.png"), ((1200, 675), dist / "static" / "img" / f"{slug}.png")):
            if p.get("photo") and make_photo_card:
                c = credits["list-" + a["id"]]
                photo = {"src": f"/static/photos/list-{a['id']}.jpg", "author": c["author"], "licence": c["licence"]}
                make_photo_card(p["card"], "Things to do", a["category"], photo, out, size=size)
            elif make_card:
                make_card(p["card"], "Things to do", a["category"], out, size=size)
        n += 1
    return n


if __name__ == "__main__":
    print("daily posts: %d puzzle packs, %d activity packs written" % write_packs())

#!/usr/bin/env python3
"""Christmas gift posts for Planner Plus (RUNBOOK §6t, row 22). HELD until launch.

  python tools/plus_posts.py --check   check every post (lengths, hooks, dates) without writing anything
  python tools/plus_posts.py           write social/<date>-<slug>/meta.json for each post, ONLY when site.yaml → plus.paywall
                                       is true and content/plus_posts.yaml → launch is set (never before Plus is on sale)

build.py calls draw_all(dist) once the paywall is on, to draw the cards (dist/static/social/<slug>.png for Instagram,
dist/static/img/<slug>.png for X) with the site's own make_card.
"""
import datetime as dt, json, pathlib, re, sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://dontdieretired.com"
PAGE = SITE + "/planner-plus/gift/"
CATEGORY = "travel"                     # the card colour: Things to do's trips and days out
HASHTAGS = "#DontDieRetired #NeverRetireFromLife #TryNewThings #ChristmasGifts #GiftIdeas"
LAST = "2026-12-24"
BANNED = ("best", "most popular", "members love", "review", "sale", "discount", "over 50", "senior", "!")


def load():
    data = yaml.safe_load((ROOT / "content" / "plus_posts.yaml").read_text(encoding="utf-8")) or {}
    site = yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))
    return data, bool((site.get("plus") or {}).get("paywall"))


def check(data):
    """Every post must be sendable: returns a list of problems (empty = fine)."""
    bad, seen = [], set()
    for p in data.get("posts") or []:
        s = p.get("slug", "?")
        if not re.fullmatch(r"plus-gift-[a-z0-9-]+", s) or s in seen: bad.append(f"{s}: slug malformed or repeated")
        seen.add(s)
        if ("day" in p) == ("date" in p): bad.append(f"{s}: give exactly one of day or date")
        if "date" in p and not (re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(p["date"])) and str(p["date"]) <= LAST): bad.append(f"{s}: bad date")
        card, text = p.get("card", ""), p.get("text", "")
        if not card or len(card.split()) >= 20: bad.append(f"{s}: card must be under 20 words")
        low = (card + " " + text).lower()
        bad += [f"{s}: says '{w}'" for w in BANNED if w in low]
        if re.search(r"£(?!20\b)\d", text): bad.append(f"{s}: a price other than the gift's £20")
        if len(card) + len(text) + len("\n\n" * 3) + 23 + len("#DontDieRetired") > 280: bad.append(f"{s}: too long for X")   # X counts a link as 23
    return bad


def dated(data):
    launch = dt.date.fromisoformat(data["launch"])
    today = dt.date.today()
    out = []
    for p in data["posts"]:
        d = dt.date.fromisoformat(str(p["date"])) if "date" in p else launch + dt.timedelta(days=int(p["day"]))
        if d < max(launch, today - dt.timedelta(days=1)) or d.isoformat() > LAST:
            continue                                # its day has passed, or it would land after Christmas
        out.append((d.isoformat(), p))
    return out


def draw_all(dist, make_card):
    data, paywall = load()
    if not (paywall and data.get("launch")):
        return 0
    for p in data["posts"]:
        make_card(p["card"], "A gift of Planner Plus", CATEGORY, pathlib.Path(dist) / "static" / "social" / f"{p['slug']}.png", size=(1080, 1080))
        make_card(p["card"], "A gift of Planner Plus", CATEGORY, pathlib.Path(dist) / "static" / "img" / f"{p['slug']}.png")
    return len(data["posts"])


def write_packs():
    data, paywall = load()
    bad = check(data)
    if bad:
        sys.exit("plus posts: " + "; ".join(bad))
    if not (paywall and data.get("launch")):
        sys.exit("plus posts are held: set site.yaml plus.paywall true (launch) and content/plus_posts.yaml launch first")
    made = kept = 0
    today = dt.date.today().isoformat()
    for date, p in dated(data):
        folder = ROOT / "social" / f"{date}-{p['slug']}"
        if (folder / "meta.json").exists() and date < today:
            kept += 1; continue                     # already sent: never change its text
        utm = lambda s: f"{PAGE}?utm_source={s}&utm_medium=social&utm_campaign=plus-gift"
        meta = {
            "title": p["card"], "url": PAGE, "date": date, "category": CATEGORY, "kind": "plus",
            "tags": ["planner", "gift", "christmas"],
            "posts": {
                "facebook": f"{p['card']}\n\n{p['text']}\n\nAbout the gift → {utm('facebook')}\n\n#DontDieRetired",
                "instagram": f"{p['card']}\n\n{p['text']}\n\nLink in our bio (dontdieretired.com).\n\n{HASHTAGS}",
                "x": f"{p['card']}\n\n{p['text']}\n\n{utm('x')}\n\n#DontDieRetired",
            },
        }
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        made += 1
    print(f"plus posts: {made} packs written, {kept} already sent and left alone")


if __name__ == "__main__":
    if "--check" in sys.argv:
        problems = check(load()[0])
        print("plus posts: " + ("; ".join(problems) if problems else "all fine (held until launch)"))
        sys.exit(1 if problems else 0)
    write_packs()

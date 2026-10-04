"""Story artwork: the logo's rising sun over a scene chosen for each story.

Every article keeps the brand's two constants, its topic colour and the sun,
and gets a different foreground: open sea for a swim, a road for a long walk,
a shelf of books for study. Output is a small text-free SVG used on the site;
the PNG card with the headline (build.make_card) is still made for social.

The scene comes from `art:` in the article's front matter if set, otherwise
from keywords in the slug, title and tags, otherwise from the topic.
"""
from __future__ import annotations

import math
import random
import re

W, H = 1200, 630
CREAM = "#FBF6EE"
GOLD = "#F2B45A"
INK = "#101014"


def mix(a: str, b: str, t: float) -> str:
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(pa, pb))


def _ridge(rng, base, amp, n=6, x0=0, x1=W):
    """A smooth rolling line from x0 to x1, closed down to the bottom edge."""
    xs = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    ys = [base + rng.uniform(-amp, amp) for _ in xs]
    d = f"M{x0:.0f},{H} L{x0:.0f},{ys[0]:.0f}"
    for i in range(1, len(xs)):
        mx, my = (xs[i - 1] + xs[i]) / 2, (ys[i - 1] + ys[i]) / 2
        d += f" Q{xs[i - 1]:.0f},{ys[i - 1]:.0f} {mx:.0f},{my:.0f}"
    d += f" L{x1:.0f},{ys[-1]:.0f} L{x1:.0f},{H} Z"
    return d


# ------------------------------------------------------------------ scenes
# Each takes a context (rng, hy = horizon, sx = sun x, r = sun radius and the
# shades c1 far, c2 mid, c3 near, lt light detail) and returns SVG markup.

def sea(c):
    rng, hy, sx, r = c["rng"], c["hy"], c["sx"], c["r"]
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    # the logo's three bars, as the sun's reflection
    for i, (w, op) in enumerate(((2.3, .9), (1.5, .65), (.85, .42))):
        o += f'<rect x="{sx - r * w / 2:.0f}" y="{hy + 20 + i * 34}" width="{r * w:.0f}" height="15" rx="7.5" fill="{GOLD}" opacity="{op}"/>'
    if rng.random() < .6:  # islands on the horizon
        ix = (sx + W * .42) % W
        o += f'<path d="M{ix - 90:.0f},{hy} q30,-34 62,-20 q22,-30 48,-6 q26,-10 44,26 Z" fill="{c["c2"]}"/>'
    for i in range(9):
        y = hy + 140 + i * 22 + rng.uniform(-6, 6)
        x = rng.uniform(40, W - 260)
        w = rng.uniform(90, 220)
        o += f'<path d="M{x:.0f},{y:.0f} q{w / 4:.0f},-12 {w / 2:.0f},0 t{w / 2:.0f},0" fill="none" stroke="{c["lt"]}" stroke-width="5" stroke-linecap="round" opacity=".55"/>'
    return o


def hills(c):
    rng, hy = c["rng"], c["hy"]
    o = f'<path d="{_ridge(rng, hy - 6, 34)}" fill="{c["c1"]}"/>'
    o += f'<path d="{_ridge(rng, hy + 62, 30)}" fill="{c["c2"]}"/>'
    o += f'<path d="{_ridge(rng, hy + 128, 18, n=4)}" fill="{c["c3"]}"/>'
    px = rng.uniform(.25, .75) * W  # a path winding up from the foreground
    o += (f'<path d="M{px - 70:.0f},{H} C{px + 160:.0f},{H - 60} {px - 220:.0f},{hy + 150} {px + 30:.0f},{hy + 118}" '
          f'fill="none" stroke="{c["lt"]}" stroke-width="16" stroke-linecap="round" opacity=".8"/>')
    return o


def mountains(c):
    rng, hy = c["rng"], c["hy"]

    def peaks(base, amp, n, fill):
        pts = [(0, H), (0, base)]
        for i in range(n):
            x = W * (i + .5) / n + rng.uniform(-40, 40)
            pts += [(x, base - rng.uniform(amp * .5, amp)), (W * (i + 1) / n, base + rng.uniform(-10, 24))]
        pts += [(W, H)]
        return f'<polygon points="{" ".join(f"{x:.0f},{y:.0f}" for x, y in pts)}" fill="{fill}"/>'

    o = peaks(hy + 10, 150, 4, c["c1"]) + peaks(hy + 90, 110, 3, c["c2"])
    o += f'<path d="{_ridge(rng, hy + 150, 12, n=4)}" fill="{c["c3"]}"/>'
    return o


def road(c):
    hy, sx = c["hy"], c["sx"]
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    o += f'<polygon points="{sx - 5:.0f},{hy} {sx + 5:.0f},{hy} {sx + 330:.0f},{H} {sx - 330:.0f},{H}" fill="{c["c3"]}"/>'
    for t0, t1 in ((.08, .16), (.26, .40), (.54, .76), (.9, 1.2)):  # centre line, lengthening toward the viewer
        y0, y1 = hy + (H - hy) * t0, min(H, hy + (H - hy) * t1)
        w0, w1 = 2 + 16 * t0, 2 + 16 * t1
        o += f'<polygon points="{sx - w0:.0f},{y0:.0f} {sx + w0:.0f},{y0:.0f} {sx + w1:.0f},{y1:.0f} {sx - w1:.0f},{y1:.0f}" fill="{CREAM}" opacity=".85"/>'
    return o


def rails(c):
    hy, sx = c["hy"], c["sx"]
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    for i in range(9):  # sleepers, closer together toward the horizon
        t = (i / 8) ** 2.2
        y = hy + 10 + (H - hy) * t
        half = 14 + 250 * t
        o += f'<rect x="{sx - half:.0f}" y="{y:.0f}" width="{half * 2:.0f}" height="{4 + 16 * t:.0f}" fill="{c["c3"]}"/>'
    for s in (-1, 1):
        o += f'<polygon points="{sx + s * 6:.0f},{hy} {sx + s * 10:.0f},{hy} {sx + s * 210:.0f},{H} {sx + s * 180:.0f},{H}" fill="{c["lt"]}"/>'
    return o


def books(c):
    rng = c["rng"]
    shelf = H - 46
    o = f'<rect y="{shelf}" width="{W}" height="46" fill="{c["c3"]}"/>'
    x = -10
    while x < W:
        w = rng.choice((34, 42, 50, 58, 70))
        h = rng.uniform(150, 300)
        fill = rng.choice((c["c1"], c["c2"], c["c2"], c["c3"]))
        if rng.random() < .12 and x > 60:  # a gap, so the sun shows through
            x += rng.uniform(50, 110)
            continue
        o += f'<rect x="{x:.0f}" y="{shelf - h:.0f}" width="{w}" height="{h:.0f}" rx="4" fill="{fill}"/>'
        o += f'<rect x="{x + 7:.0f}" y="{shelf - h + 22:.0f}" width="{w - 14}" height="7" rx="3" fill="{c["lt"]}" opacity=".7"/>'
        o += f'<rect x="{x + 7:.0f}" y="{shelf - 40:.0f}" width="{w - 14}" height="5" rx="2.5" fill="{c["lt"]}" opacity=".45"/>'
        x += w + 4
    return o


def city(c):
    rng, hy = c["rng"], c["hy"]
    o = ""
    for layer, (fill, lo, hi) in enumerate(((c["c1"], 90, 250), (c["c2"], 40, 170))):
        x = -20
        while x < W:
            w = rng.uniform(60, 130)
            h = rng.uniform(lo, hi)
            top = hy + 70 - h if layer == 0 else hy + 120 - h
            o += f'<rect x="{x:.0f}" y="{top:.0f}" width="{w:.0f}" height="{H - top:.0f}" fill="{fill}"/>'
            for wy in range(int(top) + 18, H - 40, 34):
                for wx in range(int(x) + 12, int(x + w) - 16, 26):
                    if rng.random() < .38:
                        o += f'<rect x="{wx}" y="{wy}" width="10" height="14" rx="2" fill="{GOLD}" opacity="{.85 if layer else .55}"/>'
            x += w + rng.uniform(0, 14)
    o += f'<rect y="{H - 34}" width="{W}" height="34" fill="{c["c3"]}"/>'
    return o


def houses(c):
    rng, hy = c["rng"], c["hy"]
    o = f'<path d="{_ridge(rng, hy + 20, 18)}" fill="{c["c1"]}"/>'
    x, base = -30, H - 40
    while x < W:
        w = rng.uniform(120, 170)
        h = rng.uniform(110, 160)
        top = base - h
        o += f'<rect x="{x:.0f}" y="{top:.0f}" width="{w:.0f}" height="{h + 40:.0f}" fill="{c["c2"]}"/>'
        o += f'<polygon points="{x - 10:.0f},{top:.0f} {x + w / 2:.0f},{top - 64:.0f} {x + w + 10:.0f},{top:.0f}" fill="{c["c3"]}"/>'
        o += f'<rect x="{x + w * .68:.0f}" y="{top - 70:.0f}" width="18" height="46" fill="{c["c3"]}"/>'
        for i, wx in enumerate((x + w * .2, x + w * .6)):
            lit = rng.random() < .7
            o += f'<rect x="{wx:.0f}" y="{top + 28:.0f}" width="26" height="32" rx="3" fill="{GOLD if lit else c["c1"]}" opacity="{.9 if lit else 1}"/>'
        o += f'<rect x="{x + w * .4:.0f}" y="{base - 48:.0f}" width="28" height="48" rx="3" fill="{c["c3"]}"/>'
        x += w + rng.uniform(6, 26)
    o += f'<rect y="{base}" width="{W}" height="40" fill="{c["c3"]}"/>'
    return o


def fields(c):
    rng, hy, sx = c["rng"], c["hy"], c["sx"]
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    for i in range(-9, 10):  # crop rows running to the horizon under the sun
        x = sx + i * 190
        o += f'<line x1="{sx + i * 9:.0f}" y1="{hy + 34}" x2="{x:.0f}" y2="{H}" stroke="{c["lt"]}" stroke-width="7" stroke-linecap="round" opacity=".45"/>'
    o += f'<rect y="{hy - 4}" width="{W}" height="40" fill="{c["c2"]}"/>'  # hedge
    for _ in range(7):
        tx = rng.uniform(30, W - 30)
        if abs(tx - sx) < c["r"] * .9:
            continue
        tr = rng.uniform(26, 44)
        o += f'<rect x="{tx - 4:.0f}" y="{hy - 20:.0f}" width="8" height="40" fill="{c["c3"]}"/><circle cx="{tx:.0f}" cy="{hy - 30:.0f}" r="{tr:.0f}" fill="{c["c2"]}"/>'
    return o


def forest(c):
    rng, hy = c["rng"], c["hy"]
    o = f'<path d="{_ridge(rng, hy + 10, 16)}" fill="{c["c1"]}"/>'
    for fill, base, lo, hi, step in ((c["c2"], hy + 90, 110, 190, 74), (c["c3"], H + 10, 150, 260, 120)):
        x = rng.uniform(-40, 0)
        while x < W + 40:
            h, w = rng.uniform(lo, hi), rng.uniform(50, 78)
            if fill == c["c3"] and abs(x - c["sx"]) < c["r"] * 1.1:
                x += step
                continue
            for k in range(3):  # three tiers of branches
                ty = base - h + k * h * .22
                tw = w * (.45 + k * .28)
                o += f'<polygon points="{x:.0f},{ty:.0f} {x - tw:.0f},{ty + h * .42:.0f} {x + tw:.0f},{ty + h * .42:.0f}" fill="{fill}"/>'
            o += f'<rect x="{x - 6:.0f}" y="{base - h * .4:.0f}" width="12" height="{h * .4:.0f}" fill="{fill}"/>'
            x += step * rng.uniform(.7, 1.3)
        o += f'<rect y="{base - 6:.0f}" width="{W}" height="{H}" fill="{fill}"/>'
    return o


def cliffs(c):
    rng, hy = c["rng"], c["hy"]
    left = c["sx"] > W / 2  # cliff stands on the side away from the sun
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    for i, (w, op) in enumerate(((2.1, .85), (1.3, .55))):
        o += f'<rect x="{c["sx"] - c["r"] * w / 2:.0f}" y="{hy + 22 + i * 34}" width="{c["r"] * w:.0f}" height="14" rx="7" fill="{GOLD}" opacity="{op}"/>'
    top = hy - rng.uniform(150, 210)
    pts = [(0, H), (0, top), (250, top + 14), (330, top + 70), (400, top + 96), (450, hy + 40), (560, hy + 110), (640, H)]
    if not left:
        pts = [(W - x, y) for x, y in pts]
    o += f'<polygon points="{" ".join(f"{x:.0f},{y:.0f}" for x, y in pts)}" fill="{c["c2"]}"/>'
    for k in range(5):  # strata
        y = top + 60 + k * 58
        x0, x1 = (0, 300 + k * 44) if left else (W - 300 - k * 44, W)
        o += f'<line x1="{x0}" y1="{y:.0f}" x2="{x1}" y2="{y + (18 if left else -18):.0f}" stroke="{c["lt"]}" stroke-width="5" stroke-linecap="round" opacity=".4"/>'
    o += f'<path d="{_ridge(rng, H - 40, 10, n=4)}" fill="{c["c3"]}"/>'
    return o


def grid(c):
    hy, sx = c["hy"], c["sx"]
    o = f'<rect y="{hy}" width="{W}" height="{H - hy}" fill="{c["c1"]}"/>'
    for i in range(-14, 15):
        o += f'<line x1="{sx + i * 26:.0f}" y1="{hy}" x2="{sx + i * 260:.0f}" y2="{H}" stroke="{c["lt"]}" stroke-width="3" opacity=".42"/>'
    for i in range(1, 8):
        y = hy + (H - hy) * (i / 7) ** 1.9
        o += f'<line x1="0" y1="{y:.0f}" x2="{W}" y2="{y:.0f}" stroke="{c["lt"]}" stroke-width="3" opacity=".42"/>'
    return o


def steps(c):
    rng, hy = c["rng"], c["hy"]
    up = c["sx"] > W / 2  # the stairs climb toward the sun
    n = 7
    o = ""
    for i in range(n):
        k = i if up else n - 1 - i
        top = H - 70 - k * (hy - 170) / n * .9
        o += f'<rect x="{i * W / n:.0f}" y="{top:.0f}" width="{W / n + 1:.0f}" height="{H - top:.0f}" fill="{c["c2"] if k % 2 else c["c1"]}"/>'
        o += f'<rect x="{i * W / n:.0f}" y="{top:.0f}" width="{W / n + 1:.0f}" height="9" fill="{c["lt"]}" opacity=".6"/>'
    o += f'<rect y="{H - 40}" width="{W}" height="40" fill="{c["c3"]}"/>'
    return o


SCENES = {f.__name__: f for f in (sea, hills, mountains, road, rails, books, city, houses, fields, forest, cliffs, grid, steps)}

# First match wins. Checked against "<slug> <title> <tags>" in lower case.
RULES = [
    (r"by-train|railway|interrail", "rails"),
    (r"fossil|dinosaur|geolog|coast", "cliffs"),
    (r"swim|surf|ocean|sail|rowing|kayak|hydration", "sea"),
    (r"study|doctorate|learn|language|memory|mind|music|instrument|check|private|appointment", "books"),
    (r"marathon|ironman|cycl|running|walk-home|on foot|solo-travel|returning-to-work", "road"),
    (r"mountain|climb|\\bski|holiday|insurance|long-stays", "mountains"),
    (r"garden|flower|farm|cook|protein|fibre|bones|eating", "fields"),
    (r"bird|nature|wildlife|tree|living-well", "forest"),
    (r"voice-clone|grandparent|friend|communit|sheds|downsiz|volunteer", "houses"),
    (r"\bbus\b|job-hunt|business|freelanc|working-after|video-call", "city"),
    (r"password|banking|scam|fake|first-conversation|accessibility", "grid"),
    (r"pension|money|invest|strength|deadlift|powerlift", "steps"),
    (r"walk|hik|balance|active|football|skat|tap", "hills"),
]
BY_TOPIC = {"move": "hills", "eat": "fields", "think": "books", "money": "steps", "earn": "city", "connect": "houses",
            "travel": "mountains", "tech": "city", "ai": "grid", "explore": "forest", "stories": "hills"}


def pick_scene(a: dict) -> str:
    if a.get("art") in SCENES:
        return a["art"]
    # the slug and headline say what the story is about; tags are broader, so they only break ties
    for text in (f'{a["slug"]} {a["title"]}'.lower(), " ".join(a.get("tags", [])).lower()):
        for pat, name in RULES:
            if re.search(pat, text):
                return name
    return BY_TOPIC.get(a["category"], "hills")


def scene_svg(a: dict, fg: str) -> str:
    rng = random.Random(a["slug"])
    name = pick_scene(a)
    hy = rng.choice((400, 425, 450))
    sx = rng.choice((.27, .38, .5, .62, .73)) * W
    r = rng.randint(118, 160)
    if name in ("books", "city", "houses", "steps", "forest"):
        hy -= 60  # tall foregrounds: lift the sun so it clears them
    c = {"rng": rng, "hy": hy, "sx": sx, "r": r, "c1": mix(fg, INK, .24), "c2": mix(fg, INK, .44),
         "c3": mix(fg, INK, .62), "lt": mix(fg, CREAM, .42)}
    rays = ""
    for i in range(7):
        ang = math.radians(195 + i * 25)
        x1, y1 = sx + math.cos(ang) * r * 1.24, hy + math.sin(ang) * r * 1.24
        x2, y2 = sx + math.cos(ang) * r * 1.62, hy + math.sin(ang) * r * 1.62
        rays += f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
        f'<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{fg}"/>'
        f'<stop offset="1" stop-color="{mix(fg, CREAM, .2)}"/></linearGradient>'
        f'<radialGradient id="g" cx="{sx:.0f}" cy="{hy}" r="{r * 3.2:.0f}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{GOLD}" stop-opacity=".5"/><stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>'
        f'<clipPath id="k"><rect width="{W}" height="{H}"/></clipPath></defs>'
        f'<g clip-path="url(#k)"><rect width="{W}" height="{H}" fill="url(#s)"/><rect width="{W}" height="{H}" fill="url(#g)"/>'
        f'<g stroke="{mix(fg, GOLD, .7)}" stroke-width="{r * .11:.0f}" stroke-linecap="round">{rays}</g>'
        f'<circle cx="{sx:.0f}" cy="{hy}" r="{r}" fill="{GOLD}"/>'
        f'{SCENES[name](c)}</g></svg>'
    )

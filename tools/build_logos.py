#!/usr/bin/env python3
"""Rebuild the brand files that carry the wordmark.

    python tools/build_logos.py

Writes brand/logo-horizontal-light.png, brand/logo-horizontal-dark.png,
brand/og-default.png and static/og-default.png.

The rule (RUNBOOK §1c): "Don't Die Retired" is one phrase in one style. All three
words share the same typeface, weight, upright style and colour. The red lives in
the sunrise mark, never on a word.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "brand" / "fonts"
BOLD = str(FONTS / "Fraunces-Bold.ttf")
SANS = str(FONTS / "SourceSans3-SemiBold.ttf")
NAME = "Don't Die Retired"
RED, PAPER, INK = "#B23A48", "#FBFAF7", "#1B1B1F"
S = 3  # supersample


def _blend(a, b, t):
    a = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def draw_mark(d, x, y, size, disc=RED, fg=PAPER):
    """The sunrise mark from brand/logo-mark.svg, drawn into a size x size box at (x, y)."""
    u = size / 100
    P = lambda px, py: (x + px * u, y + py * u)
    d.ellipse([*P(2, 2), *P(98, 98)], fill=disc)
    # half sun: full circle, then cover the lower half with the disc colour
    d.ellipse([*P(33, 41), *P(67, 75)], fill=fg)
    d.rectangle([*P(30, 58), *P(70, 77)], fill=disc)
    rays = [(27.8, 52.0, 20.1, 50.0), (33.7, 41.7, 28.1, 36.1), (44.0, 35.8, 42.0, 28.1),
            (56.0, 35.8, 58.0, 28.1), (66.3, 41.7, 71.9, 36.1), (72.2, 52.0, 79.9, 50.0)]
    w = 4.5 * u
    for x1, y1, x2, y2 in rays:
        d.line([P(x1, y1), P(x2, y2)], fill=fg, width=round(w))
        for px, py in ((x1, y1), (x2, y2)):
            cx, cy = P(px, py)
            d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill=fg)
    d.rounded_rectangle([*P(16, 60), *P(84, 65)], radius=2.5 * u, fill=fg)
    d.rounded_rectangle([*P(28, 70), *P(72, 74)], radius=2 * u, fill=_blend(disc, fg, .75))
    d.rounded_rectangle([*P(38, 79), *P(62, 82.5)], radius=1.75 * u, fill=_blend(disc, fg, .5))


def horizontal(out, bg, ink, size=(1400, 360)):
    W, H = size[0] * S, size[1] * S
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    mark = round(H * 0.60)
    gap = round(H * 0.15)
    # largest type that keeps the whole name on one line inside the margins
    margin = round(H * 0.235)
    pt = round(H * 0.42)
    while True:
        f = ImageFont.truetype(BOLD, pt)
        l, t, r, b = d.textbbox((0, 0), NAME, font=f)
        if mark + gap + (r - l) <= W - 2 * margin:
            break
        pt -= 2
    total = mark + gap + (r - l)
    x0 = (W - total) // 2
    draw_mark(d, x0, (H - mark) // 2, mark)
    d.text((x0 + mark + gap - l, (H - (b - t)) // 2 - t), NAME, font=f, fill=ink)
    im.resize(size, Image.LANCZOS).save(out, optimize=True)


def og(out, size=(1200, 630)):
    W, H = size[0] * S, size[1] * S
    im = Image.new("RGB", (W, H), RED)
    d = ImageDraw.Draw(im)
    # quiet rings, lower right
    cx, cy = round(W * 0.83), round(H * 0.76)
    for i, rad in enumerate((0.42, 0.31, 0.20)):
        rr = round(H * rad * 1.05)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=_blend(RED, PAPER, .16), width=round(H * 0.035))
    pad = round(W * 0.068)
    mark = round(H * 0.13)
    draw_mark(d, pad, round(H * 0.115), mark, disc=PAPER, fg=RED)
    f = ImageFont.truetype(BOLD, round(H * 0.068))
    l, t, r, b = d.textbbox((0, 0), NAME, font=f)
    d.text((pad + mark + round(H * 0.045) - l, round(H * 0.115) + (mark - (b - t)) // 2 - t), NAME, font=f, fill=PAPER)
    hf = ImageFont.truetype(BOLD, round(H * 0.128))
    y = round(H * 0.335)
    for line in ("Retire from work if", "you like. Never from", "life."):
        d.text((pad, y), line, font=hf, fill=PAPER)
        y += round(hf.size * 1.06)
    sf = ImageFont.truetype(SANS, round(H * 0.043))
    d.text((pad, round(H * 0.855)), "Real stories and practical plans · dontdieretired.com", font=sf, fill=_blend(RED, PAPER, .9))
    im = im.resize(size, Image.LANCZOS)
    for o in out:
        im.save(o, optimize=True)


if __name__ == "__main__":
    horizontal(ROOT / "brand" / "logo-horizontal-light.png", PAPER, INK)
    horizontal(ROOT / "brand" / "logo-horizontal-dark.png", INK, PAPER)
    og([ROOT / "brand" / "og-default.png", ROOT / "static" / "og-default.png"])
    print("logos rebuilt")

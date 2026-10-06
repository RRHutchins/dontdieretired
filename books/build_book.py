"""Build a Don't Die Retired puzzle book: interior PDF, cover PDF and a checks report.

    python books/build_book.py vol1
    python books/build_book.py hard

Output goes to books/out/. Generation is seeded, so a rebuild gives the same book.
To make a new volume, add an entry to BOOKS with a new seed and mix.
"""
from __future__ import annotations

import math
import pickle
import random
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).parent))
import content as C
import layout as L
import puzzles as P

OUT = Path(__file__).parent / "out"
PW, PH = 8.5 * 72, 11 * 72
INNER, OUTER, TOPM, BOTM = .95 * 72, .7 * 72, .75 * 72, .8 * 72
CW = PW - INNER - OUTER

# The copyright holder printed in every book. Robin chose the brand name on 6 Oct 2026;
# it is also the author name he enters on KDP. If it ever changes, change it here and rebuild.
COPYRIGHT_LINE = "\u00a9 2026 Don't Die Retired. All rights reserved."

BOOKS = {
    "vol1": dict(
        seed=2026101, kind="std", title="The Don't Die Retired Puzzle Book", volume="Volume 1",
        title_lines=("The", "Don't Die Retired", "Puzzle Book"), cover_lines=("The", "Don't Die", "Retired", "Puzzle Book"),
        count_word="Thirteen", closing="If these were too gentle, The Hard Ones is the companion volume: thirteen kinds of puzzle, none of them a warm-up.",
        strap="Thirteen kinds of puzzle. No two pages in a row alike.", tiers=["Warm-up", "Steady", "Stretch"],
        colour="#0B6E4F", file="DDR-Puzzle-Book-Volume-1",
        mix={"sudoku": (4, 4, 4), "wordsearch": (4, 4, 4), "kakuro": (2, 2, 2), "futoshiki": (2, 2, 2), "calcudoku": (3, 3, 3),
             "skyscrapers": (2, 2, 2), "binary": (2, 2, 2), "nonogram": (3, 3, 3), "bridges": (2, 2, 2), "logic": (2, 2, 2),
             "cryptogram": (3, 3, 3), "ladder": (2, 2, 2), "anagrams": (2, 2, 2)},
        welcome=["This book is a workout, not a rest.",
                 "It holds {n} puzzles of thirteen kinds, arranged so that no two pages in a row ask the same thing of you. Some will be old friends. Some you may never have met: turn to the next pages for how each one works, and give the unfamiliar ones a fair try before you decide they are not for you. The puzzle you are worst at is the one doing you the most good.",
                 "There are three parts. Warm-up gets you going, Steady asks for more, and Stretch is there to be chewed on. Within each part the kinds are shuffled.",
                 "Every logic puzzle in the book has been checked by computer to have exactly one answer, so when you are stuck there is always a way through that does not need a guess. The solutions are at the back, and the page number is printed at the foot of each puzzle.",
                 "The print is large throughout, with room to write. Use a pencil."]),
    "hard": dict(
        seed=2026102, kind="hard", title="The Don't Die Retired Puzzle Book", volume="The Hard Ones",
        title_lines=("The", "Don't Die Retired", "Puzzle Book"), cover_lines=("The", "Don't Die", "Retired", "Puzzle Book"),
        count_word="Thirteen", closing="If you would like something to hand to a friend who is just getting started, Volume 1 has thirteen kinds of puzzle that build up from a warm-up.",
        strap="These puzzles are hard. That is the point.", tiers=["Hard", "Harder", "Hardest"],
        colour="#1F2A44", file="DDR-Puzzle-Book-The-Hard-Ones",
        mix={"sudoku": (4, 4, 4), "killer": (3, 3, 3), "kakuro": (3, 3, 3), "futoshiki": (3, 3, 3), "calcudoku": (3, 3, 3),
             "skyscrapers": (3, 3, 3), "binary": (2, 3, 3), "nonogram": (3, 3, 3), "bridges": (3, 3, 3), "logic": (3, 3, 3),
             "cryptogram": (3, 3, 3), "ladder": (2, 2, 2), "wordsearch": (2, 2, 2)},
        welcome=["These puzzles are hard. That is the point.",
                 "If you want a gentle half hour, this is the wrong book, and Volume 1 is the right one. This one holds {n} puzzles of thirteen kinds, in three parts: Hard, Harder and Hardest. Nothing here is a warm-up. Expect some of them to take more than one sitting.",
                 "How the grading was done. Sudoku is graded by the reasoning it demands: Hard needs pairs and locked candidates, Harder needs triples or an X-wing, and Hardest cannot be finished with those alone. For futoshiki, and for skyscrapers and binary puzzles in the two harder parts, every clue that could be taken away without allowing a second answer has been taken away. The kakuro grow from eight squares a side to ten. The rest are graded by size and by how little they give you.",
                 "Every logic puzzle has been checked by computer to have exactly one answer. However stuck you are, the answer can be reached by reasoning; none of them needs a lucky guess, though the Hardest sudoku may need you to follow a long chain of consequences.",
                 "The word searches come without a word list. The cryptograms come with almost no help. The solutions are at the back, and the page number is at the foot of each puzzle.",
                 "The print is large throughout, with room to write. Use a pencil, and keep a rubber handy."]),
    "xmas": dict(
        seed=2026103, kind="xmas", title="The Don't Die Retired Christmas Puzzle Book", volume="Christmas Edition",
        title_lines=("The", "Don't Die Retired", "Christmas Puzzle Book"),
        cover_lines=("The", "Don't Die", "Retired", "Christmas", "Puzzle Book"),
        count_word="Seventeen", strap="Seventeen kinds of puzzle for the days when nobody has to be anywhere.",
        tiers=["Gentle", "Steady", "Tricky"], colour="#8E1F2F", file="DDR-Puzzle-Book-Christmas-Edition",
        closing="There are two more books in the series. Volume 1 has thirteen kinds of puzzle that build up from a warm-up. The Hard Ones has thirteen kinds and no warm-up at all.",
        mix={"wordsearch": (3, 3, 3), "cryptogram": (3, 3, 3), "anagrams": (1, 1, 1), "novowels": (1, 1, 1), "ladder": (1, 1, 1),
             "logic": (2, 2, 2), "nonogram": (3, 3, 3), "sudoku": (3, 3, 3), "killer": (1, 1, 1), "kakuro": (2, 2, 2),
             "futoshiki": (2, 2, 2), "calcudoku": (2, 2, 2), "skyscrapers": (2, 2, 2), "binary": (2, 2, 2),
             "bridges": (2, 2, 2), "tents": (3, 3, 3), "starbattle": (2, 2, 2)},
        welcome=["Something to do between the pudding and the walk.",
                 "This book holds {n} puzzles of seventeen kinds, and nearly all of them have something of Christmas or midwinter in them: carols with their vowels missing, lines from Dickens in code, pictures hidden in grids, presents to place beside trees, and a party where you must work out who brought the mince pies.",
                 "There are three parts. Gentle is for the armchair. Steady asks for more. Tricky is for the quiet hour when everyone else has gone for a walk, or should have. Within each part the kinds are shuffled, so no two pages in a row ask the same thing of you.",
                 "Some kinds will be old friends and some you may never have met. The next pages explain how each one works. Give the unfamiliar ones a fair try: a new kind of puzzle is a better present to yourself than a tenth sudoku.",
                 "Every logic puzzle has been checked by computer to have exactly one answer, so there is always a way through that does not need a guess. The solutions are at the back, and the page number is at the foot of each puzzle.",
                 "The puzzles and their instructions are in large print, with room to write. Use a pencil."]),
}

# The Christmas edition sits between the other two for difficulty: its three parts use
# Volume 1's middle and top settings and The Hard Ones' first.
XMAS_LEVEL = {1: ("std", 2), 2: ("std", 3), 3: ("hard", 1)}


# ------------------------------------------------------------------ generation

def _seed(*parts):
    return zlib.crc32("-".join(map(str, parts)).encode())


def _job(a):
    kind, typ, tier, seed = a
    book, level = kind, tier
    if kind == "xmas" and typ not in ("logic", "tents", "starbattle"):
        book, level = ("hard", 1) if typ == "killer" else XMAS_LEVEL[tier]
    for attempt in range(5):            # a seed that finds nothing is retried with the next one
        try:
            p = getattr(P, typ)(level, random.Random(seed + attempt), book=book)
            p["tier"] = tier
            return p
        except RuntimeError:
            continue
    raise RuntimeError(f"{typ} tier {tier}: no puzzle found")


def generate(book_id):
    b = BOOKS[book_id]
    cache = OUT / f"{book_id}.puzzles.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    kind, seed = b["kind"], b["seed"]
    pooled = ("sudoku", "killer", "kakuro", "futoshiki", "calcudoku", "skyscrapers", "binary", "bridges", "logic",
              "tents", "starbattle")
    jobs = [(kind, t, tier, _seed(seed, t, tier, i)) for t in pooled if t in b["mix"]
            for tier in (1, 2, 3) for i in range(b["mix"][t][tier - 1])]
    pool_cache = OUT / f"{book_id}.pool.pkl"      # the slow, solver-checked puzzles, kept apart so layout work is quick
    if pool_cache.exists():
        made = pickle.loads(pool_cache.read_bytes())
    else:
        with ProcessPoolExecutor(2) as ex:
            made = list(ex.map(_job, jobs))
        OUT.mkdir(exist_ok=True)
        pool_cache.write_bytes(pickle.dumps(made))
    P._ladder_used.clear()
    P._nono_used.clear()
    rng = random.Random(seed)
    for tier in (1, 2, 3):
        for i in range(b["mix"].get("nonogram", (0, 0, 0))[tier - 1]):
            made.append(P.nonogram(tier, rng, book=kind))
        for i in range(b["mix"].get("ladder", (0, 0, 0))[tier - 1]):
            if kind == "xmas":
                items = [P.ladder_between(*pair) for pair in C.LADDERS_XMAS[(tier - 1) * 2:tier * 2]]
                assert all(items), "a festive ladder has no route"
            else:
                length, steps = ((4, (3, 4, 5)[tier - 1]) if kind == "std" else (5, (5, 6, 8)[tier - 1]))
                items = [P.ladder(length, steps, rng) for _ in range(2)]
            made.append({"type": "ladder", "tier": tier, "items": items})
    quotes = {"std": C.QUOTES_STD, "hard": C.QUOTES_HARD, "xmas": C.QUOTES_XMAS}[kind]
    hints = {"std": (3, 2, 1), "hard": (1, 0, 0), "xmas": (3, 2, 0)}[kind]
    for i, (text, src) in enumerate(quotes):
        p = P.cryptogram(text, src, rng, hints[i // 3])
        p["tier"] = i // 3 + 1
        made.append(p)
    if kind == "std":
        for i, (theme, words) in enumerate(C.WORDSEARCH_STD):
            p = P.wordsearch(theme, words, rng, n=15)
            p["tier"] = i // 4 + 1
            made.append(p)
        for i, (theme, words) in enumerate(C.ANAGRAMS):
            p = P.anagrams(theme, words, rng)
            p["tier"] = i // 2 + 1
            made.append(p)
    elif kind == "xmas":
        for i, (theme, words) in enumerate(C.WORDSEARCH_XMAS):
            p = P.wordsearch(theme, words, rng, n=15)
            p["tier"] = i // 3 + 1
            made.append(p)
        for i, (theme, words) in enumerate(C.ANAGRAMS_XMAS):
            p = P.anagrams(theme, words, rng)
            p["tier"] = i + 1
            made.append(p)
        for i, (theme, phrases) in enumerate(C.NOVOWELS_XMAS):
            p = P.novowels(theme, phrases, rng)
            p["tier"] = i + 1
            made.append(p)
    else:
        for i, (theme, words) in enumerate(C.WORDSEARCH_HARD):
            p = P.wordsearch(theme, words, rng, n=17, hard=True)
            p["tier"] = i // 2 + 1
            made.append(p)
    # order: by part, kinds dealt out in turn so neighbouring pages differ
    ordered = []
    for tier in (1, 2, 3):
        by = {}
        for p in made:
            if p["tier"] == tier:
                by.setdefault(p["type"], []).append(p)
        kinds = list(by)
        random.Random(seed + tier).shuffle(kinds)
        while any(by.values()):
            for k in kinds:
                if by[k]:
                    ordered.append(by[k].pop(0))
    for i, p in enumerate(ordered, 1):
        p["no"] = i
    OUT.mkdir(exist_ok=True)
    cache.write_bytes(pickle.dumps(ordered))
    return ordered


# ------------------------------------------------------------------ pages

def _x(page_no):
    """Left edge of the text block: the wide margin is on the binding side."""
    return INNER if page_no % 2 == 1 else OUTER


def sun(c, cx, cy, r, colour, bars=True):
    c.setFillColor(colour)
    c.setStrokeColor(colour)
    p = c.beginPath()
    p.moveTo(cx - r, cy)
    p.arcTo(cx - r, cy - r, cx + r, cy + r, 180, -180)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setLineWidth(r * .16)
    c.setLineCap(1)
    for i in range(7):
        a = math.radians(15 + i * 25)
        c.line(cx + math.cos(a) * r * 1.3, cy + math.sin(a) * r * 1.3, cx + math.cos(a) * r * 1.72, cy + math.sin(a) * r * 1.72)
    if bars:
        for i, wd in enumerate((2.5, 1.6, .9)):
            c.setLineWidth(r * .14)
            y = cy - r * (.3 + i * .33)
            c.line(cx - r * wd / 2, y, cx + r * wd / 2, y)
    c.setLineCap(0)
    c.setFillColor(black)
    c.setStrokeColor(black)


def footer(c, n, note=""):
    c.setFont("Body", 14)
    c.setFillColor(L.DARK)
    c.drawCentredString(PW / 2, BOTM - 32, str(n))
    if note:
        x = _x(n)
        if n % 2 == 1:
            c.drawRightString(x + CW, BOTM - 32, note)
        else:
            c.drawString(x, BOTM - 32, note)
    c.setFillColor(black)


def short_rule(b, p):
    k = p["type"]
    if k == "wordsearch" and p["hard"]:
        return C.SHORT["wordsearch_hard"].format(k=len(p["words"]), theme=p["theme"])
    if k == "wordsearch":
        return C.SHORT[k] + f" Theme: {p['theme']}."
    if k in ("anagrams", "novowels"):
        return C.SHORT[k] + f" Theme: {p['theme']}."
    if k == "logic":
        return C.SHORT["logic_xmas" if b["kind"] == "xmas" else k].format(k={4: "Four", 5: "Five"}[len(p["solution"])])
    if k == "cryptogram" and p["given"]:
        return C.SHORT[k] + " A few letters are filled in to start you off."
    if k == "ladder":
        return C.SHORT[k]
    return C.SHORT[k].format(n=p.get("n", ""))


def puzzle_page(c, b, p, n, sol_page):
    x = _x(n)
    top = PH - TOPM
    c.setFont("Head", 34)
    c.drawString(x, top - 28, str(p["no"]))
    nw = pdfmetrics.stringWidth(str(p["no"]), "Head", 34)
    c.setFont("Head", 21)
    c.drawString(x + nw + 14, top - 26, C.TITLES[p["type"]])
    # tier: its name and one to three filled dots
    label = b["tiers"][p["tier"] - 1]
    c.setFont("Semi", 16)
    c.drawRightString(x + CW - 54, top - 25.5, label)
    for i in range(3):
        c.setLineWidth(1)
        c.circle(x + CW - 40 + i * 17, top - 20, 5.5, stroke=1, fill=1 if i < p["tier"] else 0)
    y = L.para(c, short_rule(b, p), x, top - 58, CW, "Body", 16, 20.5, L.DARK) - 6
    box = (x, BOTM, CW, y - BOTM - 2)
    if p["type"] == "ladder":
        half = CW / 2
        for i, item in enumerate(p["items"]):
            c.setFont("Semi", 16)
            c.drawCentredString(x + half * i + half / 2, box[1] + box[3] - 14, "ab"[i] + ".")
            L.ladder(c, item, (x + half * i + 10, box[1], half - 20, box[3] - 34))
    else:
        L.DRAW[p["type"]](c, p, box)
    footer(c, n, f"Solution: page {sol_page}")


PER_SOL_PAGE = 4


def draw_solutions(c, b, puzzles, first_page):
    """Four solutions to a page, so the answers can be read without a magnifying glass."""
    slot_w, slot_h = (CW - 26) / 2, (PH - TOPM - BOTM - 50) / 2
    for i, p in enumerate(puzzles):
        n = first_page + i // PER_SOL_PAGE
        if i % PER_SOL_PAGE == 0:
            x = _x(n)
            c.setFont("Head", 20)
            c.drawString(x, PH - TOPM - 18, "Solutions")
        k = i % PER_SOL_PAGE
        sx = _x(n) + (k % 2) * (slot_w + 26)
        sy = PH - TOPM - 44 - (k // 2 + 1) * slot_h
        title = f"{p['no']}  {C.TITLES[p['type']]}"
        if p["type"] == "nonogram":
            title += f": {p['name']}"
        if p["type"] in ("wordsearch", "anagrams", "novowels"):
            title += f": {p['theme']}"
        yy = sy + slot_h - 18
        for line in L.wrap(title, "Semi", 14, slot_w):
            c.setFont("Semi", 14)
            c.drawString(sx, yy, line)
            yy -= 17
        box = (sx, sy + 12, slot_w, yy - sy - 6)
        if p["type"] == "ladder":
            ty = box[1] + box[3] - 14
            for j, item in enumerate(p["items"]):
                ty = L.para(c, "ab"[j] + ".  " + ", ".join(item["solution"]), box[0], ty, box[2], "Body", 13) - 8
        else:
            L.DRAW[p["type"]](c, p, box, solved=True)
        if k == PER_SOL_PAGE - 1 or i == len(puzzles) - 1:
            footer(c, n)
            c.showPage()


def build(book_id):
    b = BOOKS[book_id]
    puzzles = generate(book_id)
    kinds = [k for k in C.TITLES if k in b["mix"]]
    colour = HexColor(b["colour"])
    gold = HexColor("#C98A2B")
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{b['file']}-interior.pdf"

    def render(count_only=False):
        c = canvas.Canvas(str(path), pagesize=(PW, PH), initialFontName="Body")
        c.setTitle(f"{b['title']}: {b['volume']}")
        c.setAuthor("Don't Die Retired")
        n = 1
        # 1 title
        c.setFont("Head", 40)
        yy = PH - 2.6 * 72
        for line in b["title_lines"]:
            c.drawCentredString(PW / 2, yy, line)
            yy -= 50
        c.setFont("Head", 27)
        if b["kind"] != "xmas":
            c.drawCentredString(PW / 2, yy - 26, b["volume"])
        c.setFont("Body", 16)
        c.drawCentredString(PW / 2, yy - 62, b["strap"])
        sun(c, PW / 2, 2.5 * 72, 62, L.DARK)
        c.setFont("Body", 13)
        c.drawCentredString(PW / 2, 1.05 * 72, "dontdieretired.com")
        c.showPage(); n += 1
        # 2 copyright
        x = _x(n)
        yy = 4.8 * 72
        for t in (f"{b['title']}: {b['volume']}" if b["kind"] != "xmas" else b["title"], COPYRIGHT_LINE,
                  "The puzzles in this book were generated by computer and each logic puzzle was checked by a solver to have exactly one solution. The word lists, instructions and layout are our own. Quotations used in the cryptograms are proverbs or come from works that are out of copyright.",
                  "The puzzles and their instructions are set at 16 point or larger. Page numbers, this page and the solutions are smaller.",
                  "Set in Fraunces and Source Sans 3, used under the SIL Open Font License.",
                  "Found a mistake? Tell us: hello@dontdieretired.com", "dontdieretired.com"):
            yy = L.para(c, t, x, yy, CW, "Body", 14, 19) - 9
        c.showPage(); n += 1
        # 3 welcome
        x = _x(n)
        c.setFont("Head", 28)
        yy = PH - TOPM - 30
        for line in L.wrap(b["welcome"][0], "Head", 28, CW):
            c.drawString(x, yy, line)
            yy -= 36
        yy -= 10
        for t in b["welcome"][1:]:
            yy = L.para(c, t.format(n=sum(len(p["items"]) if p["type"] == "ladder" else 1 for p in puzzles)), x, yy, CW, "Body", 16, 22.5) - 12
        footer(c, n)
        c.showPage(); n += 1
        # rules
        x = _x(n)
        c.setFont("Head", 24)
        c.drawString(x, PH - TOPM - 24, "How each puzzle works")
        yy = PH - TOPM - 64
        entries = []
        for k in kinds:
            if k == "wordsearch" and b["kind"] == "hard":
                entries.append((C.TITLES[k], C.RULES["wordsearch_hard"]))
            elif k == "logic" and b["kind"] == "xmas":
                entries.append((C.TITLES[k], C.RULES["logic_xmas"]))
            else:
                entries.append((C.TITLES[k], C.RULES[k]))
        for title, text in entries:
            need = 26 + len(L.wrap(text, "Body", 16, CW)) * 21.5 + 14
            if yy - need < BOTM:
                footer(c, n)
                c.showPage(); n += 1
                x = _x(n)
                yy = PH - TOPM - 20
            c.setFont("Head", 17)
            c.drawString(x, yy, title)
            yy = L.para(c, text, x, yy - 24, CW, "Body", 16, 21.5) - 14
        footer(c, n)
        c.showPage(); n += 1
        # puzzle pages begin on a right-hand page
        if n % 2 == 0:
            c.showPage(); n += 1
        plan = []
        for tier in (1, 2, 3):
            plan.append(("part", tier))
            plan += [("puzzle", p) for p in puzzles if p["tier"] == tier]
        first_sol = n + len(plan) + 1          # after a "Solutions" divider
        where = {p["no"]: first_sol + i // PER_SOL_PAGE for i, p in enumerate(puzzles)}
        for kind, item in plan:
            if kind == "part":
                c.setFillColor(colour)
                c.rect(0, 0, PW, PH, stroke=0, fill=1)
                c.setFillColor(white)
                c.setFont("Semi", 17)
                c.drawCentredString(PW / 2, PH / 2 + 86, f"Part {item}")
                c.setFont("Head", 54)
                c.drawCentredString(PW / 2, PH / 2 + 24, b["tiers"][item - 1])
                cnt = [p for p in puzzles if p["tier"] == item]
                c.setFont("Body", 16)
                c.drawCentredString(PW / 2, PH / 2 - 14, f"Puzzles {cnt[0]['no']} to {cnt[-1]['no']}")
                sun(c, PW / 2, PH / 2 - 190, 52, gold, bars=False)
                c.setFillColor(black)
            else:
                puzzle_page(c, b, item, n, where[item["no"]])
            c.showPage(); n += 1
        # solutions divider
        c.setFillColor(colour)
        c.rect(0, 0, PW, PH, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("Head", 54)
        c.drawCentredString(PW / 2, PH / 2 + 24, "Solutions")
        c.setFont("Body", 16)
        c.drawCentredString(PW / 2, PH / 2 - 14, "Have one more go first.")
        c.setFillColor(black)
        c.showPage(); n += 1
        assert n == first_sol, (n, first_sol)
        draw_solutions(c, b, puzzles, n)
        n += math.ceil(len(puzzles) / PER_SOL_PAGE)
        # closing page
        x = _x(n)
        c.setFont("Head", 26)
        yy = PH - TOPM - 30
        for line in ("Retire from work if you like.", "Never from life."):
            c.drawString(x, yy, line)
            yy -= 34
        other = b["closing"]
        for t in ("Don't Die Retired is a website for people who have no intention of slowing down. Every day it tells one true story about someone doing something worth reading about, and gives you one thing to try this week, pitched at your level.",
                  other, "dontdieretired.com"):
            yy = L.para(c, t, x, yy - 10, CW, "Body", 16, 22.5) - 6
        sun(c, PW / 2, 2.2 * 72, 56, L.DARK)
        c.showPage(); n += 1
        if (n - 1) % 2:                          # even page count for print
            c.showPage(); n += 1
        c.save()
        return n - 1

    pages = render()
    cover(b, pages)
    print(f"{book_id}: {len(puzzles)} puzzle pages, {pages} pages -> {path.name}")
    return pages


# ------------------------------------------------------------------ cover

def cover(b, pages):
    """Full wraparound paperback cover for KDP: back, spine, front, with 0.125in bleed.
    Spine width is for black ink on white paper (0.002252in per page)."""
    spine = pages * 0.002252 * 72
    bleed = .125 * 72
    W, H = bleed * 2 + PW * 2 + spine, PH + bleed * 2
    colour, cream, gold = HexColor(b["colour"]), HexColor("#FBF6EE"), HexColor("#F2B45A")
    c = canvas.Canvas(str(OUT / f"{b['file']}-cover.pdf"), pagesize=(W, H), initialFontName="Body")
    c.setFillColor(colour)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    fx = bleed + PW + spine                      # left edge of the front cover
    cx = fx + PW / 2
    # front
    sun(c, cx, bleed + 1.95 * 72, 132, gold, bars=False)
    p = c.beginPath()                            # a hill across the foot of the front cover, over the sun's base
    p.moveTo(fx, 0); p.lineTo(fx, bleed + 1.7 * 72)
    p.curveTo(fx + PW * .3, bleed + 2.5 * 72, fx + PW * .62, bleed + 1.25 * 72, W, bleed + 2.1 * 72)
    p.lineTo(W, 0); p.close()
    if b["kind"] == "xmas":                      # a snow-covered hill, and snow falling
        c.setFillColor(cream)
        c.drawPath(p, stroke=0, fill=1)
        flakes = random.Random(12)
        for _ in range(70):
            sx_, sy_ = fx + flakes.uniform(20, PW - 10), bleed + flakes.uniform(2.3 * 72, PH - 20)
            if abs(sx_ - cx) < 150 and bleed + 1.9 * 72 < sy_ < bleed + 4.6 * 72:
                continue                         # keep the sun clear
            c.setFillAlpha(flakes.uniform(.35, .8))
            c.circle(sx_, sy_, flakes.uniform(1.6, 3.6), stroke=0, fill=1)
        c.setFillAlpha(1)
    else:
        c.setFillColor(colour)
        c.drawPath(p, stroke=0, fill=1)
        c.setFillColor(HexColor("#000000")); c.setFillAlpha(.24)
        c.drawPath(p, stroke=0, fill=1)
        c.setFillAlpha(1)
    c.setFillColor(cream)
    yy = bleed + PH - 1.25 * 72
    big = 62 if len(b["cover_lines"]) == 4 else 54
    for line in b["cover_lines"]:
        c.setFont("Head", 30 if line == "The" else big)
        c.drawCentredString(cx, yy, line)
        yy -= big if line == "The" else big + 4
    if b["kind"] != "xmas":
        c.setFillColor(gold)
        c.setFont("Head", 38)
        c.drawCentredString(cx, yy - 6, b["volume"])
        yy -= 36
    c.setFillColor(cream)
    c.setFont("Semi", 19 if b["kind"] != "xmas" else 16.5)
    for line in L.wrap(b["strap"], "Semi", 19 if b["kind"] != "xmas" else 16.5, PW - 90):
        c.drawCentredString(cx, yy - 6, line)
        yy -= 23
    c.setFont("Semi", 16)
    c.setFillColor(HexColor(b["colour"]) if b["kind"] == "xmas" else cream)
    c.drawCentredString(cx, bleed + .8 * 72, f"Large print  \u2022  {b['count_word']} kinds of puzzle  \u2022  Solutions included")
    # spine
    if pages >= 100:
        c.saveState()
        c.translate(bleed + PW + spine / 2, H / 2)
        c.rotate(-90)
        c.setFont("Head", min(11, spine * .45))
        c.setFillColor(cream)
        c.drawCentredString(0, -min(11, spine * .45) * .34, b["title"] if b["kind"] == "xmas" else f"{b['title']}   {b['volume']}")
        c.restoreState()
    # back
    bx = bleed + .8 * 72
    bw = PW - 1.6 * 72
    c.setFillColor(cream)
    c.setFont("Head", 30)
    yy = bleed + PH - 1.5 * 72
    for line in L.wrap(b["welcome"][0], "Head", 30, bw):
        c.drawString(bx, yy, line)
        yy -= 38
    blurb = (["Seventeen kinds of puzzle for the days around Christmas, in large print.",
              "Carols with their vowels missing. Lines from Dickens in code. Pictures hidden in grids. Presents to place beside trees, stars to place in the sky, and a party where you must work out who brought the mince pies. Sudoku, kakuro, word searches and more besides.",
              "Three parts: Gentle, Steady and Tricky. Every logic puzzle is checked to have exactly one answer. Solutions at the back."]
             if b["kind"] == "xmas" else
             ["Thirteen kinds of puzzle in one large-print book, arranged so that no two pages in a row ask the same thing of you.",
              "Three parts: Warm-up, Steady and Stretch. Old friends such as sudoku and word searches sit beside kinds you may not have met: kakuro, futoshiki, skyscrapers, nonograms, bridges and more, each with clear instructions.",
              "Every logic puzzle is checked to have exactly one answer. Solutions at the back."]
             if b["kind"] == "std" else
             ["If you want a gentle half hour, this is the wrong book.",
              "Thirteen kinds of puzzle in three parts: Hard, Harder and Hardest. Killer sudoku with no starting numbers. Word searches with no word list. Cryptograms with no help. Kakuro, futoshiki, skyscrapers, nonograms, bridges and logic puzzles that take more than one sitting.",
              "Every logic puzzle is checked to have exactly one answer, reachable by reasoning. Large print. Solutions at the back."])
    for t in blurb:
        yy = L.para(c, t, bx, yy - 12, bw, "Body", 16.5, 23.5, cream) - 6
    c.setFillColor(cream)
    c.setFont("Semi", 15)
    c.drawString(bx, bleed + 1.0 * 72, "dontdieretired.com")
    # clear panel for the barcode KDP prints (2in x 1.2in, lower right of the back cover)
    c.setFillColor(white)
    c.rect(bleed + PW - .25 * 72 - 2 * 72, bleed + .25 * 72, 2 * 72, 1.2 * 72, stroke=0, fill=1)
    c.save()


if __name__ == "__main__":
    for bid in sys.argv[1:] or list(BOOKS):
        build(bid)

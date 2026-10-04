"""Page drawing for the puzzle books: one function per puzzle type, each able
to draw the puzzle or its solution into any box, plus shared text helpers."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import Color, black, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).parent.parent
pdfmetrics.registerFont(TTFont("Head", str(ROOT / "brand/fonts/Fraunces-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Body", str(ROOT / "brand/fonts/SourceSans3-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Semi", str(ROOT / "brand/fonts/SourceSans3-SemiBold.ttf")))

GREY = Color(.45, .45, .45)
LIGHT = Color(.82, .82, .82)
DARK = Color(.22, .22, .22)


def wrap(text, font, size, width):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def para(c, text, x, y, width, font="Body", size=15, lead=None, color=black):
    """Draw wrapped text with its first baseline at y; returns the y below it."""
    lead = lead or size * 1.38
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap(text, font, size, width):
        c.drawString(x, y, line)
        y -= lead
    c.setFillColor(black)
    return y


def _grid(x, y, w, h, cols, rows, maxcell=None):
    s = min(w / cols, h / rows, 450 / max(cols, rows))   # small grids are drawn big, but not page-filling
    ox = x + (w - s * cols) / 2
    top = y + h - (h - s * rows) / 2
    return s, ox, top


def _txt(c, s, cx, cy, t, font="Semi", scale=.6, color=black):
    size = s * scale
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(cx, cy - size * .34, str(t))
    c.setFillColor(black)


def _lines(c, s, ox, top, cols, rows, thick_every=None, thin=None, thick=None):
    thin = thin or max(.5, s * .022)
    thick = thick or max(1.4, s * .075)
    for i in range(cols + 1):
        c.setLineWidth(thick if (thick_every and i % thick_every == 0) or i in (0, cols) else thin)
        c.line(ox + i * s, top, ox + i * s, top - rows * s)
    for i in range(rows + 1):
        c.setLineWidth(thick if (thick_every and i % thick_every == 0) or i in (0, rows) else thin)
        c.line(ox, top - i * s, ox + cols * s, top - i * s)


# ------------------------------------------------------------------ number grids

def sudoku(c, p, box, solved=False):
    s, ox, top = _grid(*box, 9, 9, 54)
    c.setLineCap(1)
    _lines(c, s, ox, top, 9, 9, 3)
    for i in range(81):
        r, col = divmod(i, 9)
        cx, cy = ox + (col + .5) * s, top - (r + .5) * s
        if p["grid"][i]:
            _txt(c, s, cx, cy, p["grid"][i])
        elif solved:
            _txt(c, s, cx, cy, p["solution"][i], "Body", .56, GREY)


def killer(c, p, box, solved=False):
    s, ox, top = _grid(*box, 9, 9, 54)
    _lines(c, s, ox, top, 9, 9, 3)
    d = s * .09
    c.setLineWidth(max(.6, s * .028))
    c.setDash(s * .09, s * .07)
    for cage in p["cages"]:
        cs = set(cage)
        for (r, col) in cage:
            L, R, T, B = ox + col * s, ox + (col + 1) * s, top - r * s, top - (r + 1) * s
            same = lambda dr, dc: (r + dr, col + dc) in cs
            if not same(-1, 0):
                x0 = L + d if not same(0, -1) else (L - d if same(-1, -1) else L)
                x1 = R - d if not same(0, 1) else (R + d if same(-1, 1) else R)
                c.line(x0, T - d, x1, T - d)
            if not same(1, 0):
                x0 = L + d if not same(0, -1) else (L - d if same(1, -1) else L)
                x1 = R - d if not same(0, 1) else (R + d if same(1, 1) else R)
                c.line(x0, B + d, x1, B + d)
            if not same(0, -1):
                y0 = T - d if not same(-1, 0) else (T + d if same(-1, -1) else T)
                y1 = B + d if not same(1, 0) else (B - d if same(1, -1) else B)
                c.line(L + d, y0, L + d, y1)
            if not same(0, 1):
                y0 = T - d if not same(-1, 0) else (T + d if same(-1, 1) else T)
                y1 = B + d if not same(1, 0) else (B - d if same(1, 1) else B)
                c.line(R - d, y0, R - d, y1)
    c.setDash()
    for cage, total in zip(p["cages"], p["sums"]):
        r, col = min(cage)
        size = s * .27
        c.setFont("Semi", size)
        tw = pdfmetrics.stringWidth(str(total), "Semi", size)
        c.setFillColor(white)
        c.rect(ox + col * s + s * .06, top - r * s - s * .06 - size * .95, tw + s * .07, size * .95, stroke=0, fill=1)
        c.setFillColor(black)
        c.drawString(ox + col * s + s * .1, top - r * s - s * .1 - size * .72, str(total))
    if solved:
        for i in range(81):
            r, col = divmod(i, 9)
            _txt(c, s, ox + (col + .5) * s, top - (r + .56) * s, p["solution"][i], "Body", .5, GREY)


def kakuro(c, p, box, solved=False):
    n = p["n"]
    s, ox, top = _grid(*box, n + 1, n + 1, 58)
    white_cells = set(map(tuple, p["white"]))
    clue = {}
    for horiz, run, total in p["runs"]:
        r, col = run[0]
        key = (r, col - 1) if horiz else (r - 1, col)
        clue.setdefault(key, {})["a" if horiz else "d"] = total
    for r in range(-1, n):
        for col in range(-1, n):
            L, T = ox + (col + 1) * s, top - (r + 1) * s
            if (r, col) in white_cells:
                if solved:
                    _txt(c, s, L + s / 2, T - s / 2, p["solution"][(r, col)], "Body", .56, GREY)
                continue
            c.setFillColor(DARK)
            c.rect(L, T - s, s, s, stroke=0, fill=1)
            k = clue.get((r, col))
            if k:
                c.setStrokeColor(white)
                c.setLineWidth(max(.6, s * .025))
                c.line(L, T, L + s, T - s)
                c.setStrokeColor(black)
                if "a" in k:
                    _txt(c, s, L + s * .68, T - s * .3, k["a"], "Semi", .36, white)
                if "d" in k:
                    _txt(c, s, L + s * .3, T - s * .7, k["d"], "Semi", .36, white)
            c.setFillColor(black)
    _lines(c, s, ox, top, n + 1, n + 1, thin=max(.6, s * .03))


def futoshiki(c, p, box, solved=False):
    n = p["n"]
    x, y, w, h = box
    gap = .5
    s = min(w, h) / (n + (n - 1) * gap)
    s = min(s, 450 / (n + (n - 1) * gap))
    total = s * (n + (n - 1) * gap)
    ox, top = x + (w - total) / 2, y + h - (h - total) / 2
    step = s * (1 + gap)
    given = {tuple(g) for g in p["given"]}
    c.setLineWidth(max(1, s * .05))
    for r in range(n):
        for col in range(n):
            L, T = ox + col * step, top - r * step
            c.rect(L, T - s, s, s)
            if (r, col) in given:
                _txt(c, s, L + s / 2, T - s / 2, p["solution"][r][col])
            elif solved:
                _txt(c, s, L + s / 2, T - s / 2, p["solution"][r][col], "Body", .56, GREY)
    c.setLineWidth(max(1.1, s * .055))
    c.setLineCap(1)
    a = s * gap * .3
    for (r1, c1, r2, c2) in p["ineq"]:  # cell 1 is the smaller
        if r1 == r2:
            left = min(c1, c2)
            mx, my = ox + left * step + s + s * gap / 2, top - r1 * step - s / 2
            tip = mx - a if c1 < c2 else mx + a   # point towards the smaller cell
            back = mx + a if c1 < c2 else mx - a
            c.line(back, my + a, tip, my)
            c.line(back, my - a, tip, my)
        else:
            up = min(r1, r2)
            mx, my = ox + c1 * step + s / 2, top - up * step - s - s * gap / 2
            tip = my + a if r1 < r2 else my - a
            back = my - a if r1 < r2 else my + a
            c.line(mx - a, back, mx, tip)
            c.line(mx + a, back, mx, tip)
    c.setLineCap(0)


def calcudoku(c, p, box, solved=False):
    n = p["n"]
    s, ox, top = _grid(*box, n, n, 68)
    cage_of = {tuple(cell): i for i, cage in enumerate(p["cages"]) for cell in cage}
    thin, thick = max(.5, s * .018), max(1.6, s * .07)
    c.setLineCap(1)
    for r in range(n):
        for col in range(n):
            L, T = ox + col * s, top - r * s
            for (dr, dc, x0, y0, x1, y1) in ((0, 1, L + s, T, L + s, T - s), (1, 0, L, T - s, L + s, T - s)):
                q = (r + dr, col + dc)
                edge = q not in cage_of
                c.setLineWidth(thick if edge or cage_of[q] != cage_of[(r, col)] else thin)
                c.line(x0, y0, x1, y1)
    c.setLineWidth(thick)
    c.rect(ox, top - n * s, n * s, n * s)
    sym = {"+": "+", "-": "−", "x": "×", "/": "÷", "": ""}
    for cage, (op, target) in zip(p["cages"], p["clues"]):
        r, col = min(map(tuple, cage))
        c.setFont("Semi", s * .25)
        c.drawString(ox + col * s + s * .08, top - r * s - s * .29, f"{target}{sym[op]}")
    if solved:
        for r in range(n):
            for col in range(n):
                _txt(c, s, ox + (col + .5) * s, top - (r + .58) * s, p["solution"][r][col], "Body", .5, GREY)


def skyscrapers(c, p, box, solved=False):
    n = p["n"]
    s, ox, top = _grid(*box, n + 2, n + 2, 62)
    _lines(c, s, ox + s, top - s, n, n)
    cl = p["clues"]
    for i in range(n):
        for side, cx, cy in (("L", ox + s * .5, top - (i + 1.5) * s), ("R", ox + (n + 1.5) * s, top - (i + 1.5) * s),
                             ("T", ox + (i + 1.5) * s, top - s * .5), ("B", ox + (i + 1.5) * s, top - (n + 1.5) * s)):
            if (side, i) in cl:
                _txt(c, s, cx, cy, cl[(side, i)], "Semi", .5)
    given = {tuple(g) for g in p["given"]}
    for r in range(n):
        for col in range(n):
            if (r, col) in given:
                _txt(c, s, ox + (col + 1.5) * s, top - (r + 1.5) * s, p["solution"][r][col])
            elif solved:
                _txt(c, s, ox + (col + 1.5) * s, top - (r + 1.5) * s, p["solution"][r][col], "Body", .56, GREY)


def binary(c, p, box, solved=False):
    n = p["n"]
    s, ox, top = _grid(*box, n, n, 54)
    _lines(c, s, ox, top, n, n)
    given = {tuple(g) for g in p["given"]}
    for r in range(n):
        for col in range(n):
            if (r, col) in given:
                _txt(c, s, ox + (col + .5) * s, top - (r + .5) * s, p["solution"][r][col])
            elif solved:
                _txt(c, s, ox + (col + .5) * s, top - (r + .5) * s, p["solution"][r][col], "Body", .56, GREY)


def nonogram(c, p, box, solved=False):
    n = p["n"]
    x, y, w, h = box
    L = max(len(r) for r in p["rows"])
    T = max(len(r) for r in p["cols"])
    k = .62
    s = min(w / (n + k * L), h / (n + k * T), 46)
    ox = x + (w - s * (n + k * L)) / 2 + s * k * L
    top = y + h - (h - s * (n + k * T)) / 2 - s * k * T
    if solved:
        c.setFillColor(DARK)
        for r in range(n):
            for col in range(n):
                if p["solution"][r][col]:
                    c.rect(ox + col * s, top - (r + 1) * s, s, s, stroke=0, fill=1)
        c.setFillColor(black)
    _lines(c, s, ox, top, n, n, 5, thick=max(1.2, s * .06))
    for r, clue in enumerate(p["rows"]):
        for j, v in enumerate(reversed(clue)):
            _txt(c, s, ox - (j + .5) * s * k, top - (r + .5) * s, v, "Semi", .46)
    for col, clue in enumerate(p["cols"]):
        for j, v in enumerate(reversed(clue)):
            _txt(c, s, ox + (col + .5) * s, top + (j + .5) * s * k, v, "Semi", .46)


def bridges(c, p, box, solved=False):
    n = p["n"]
    s, ox, top = _grid(*box, n, n, 52)
    centre = lambda cell: (ox + (cell[1] + .5) * s, top - (cell[0] + .5) * s)
    isl = {tuple(i) for i in p["islands"]}
    c.setFillColor(LIGHT)
    for r in range(n):
        for col in range(n):
            if (r, col) not in isl:
                cx, cy = centre((r, col))
                c.circle(cx, cy, max(.8, s * .03), stroke=0, fill=1)
    c.setFillColor(black)
    if solved:
        c.setLineWidth(max(1, s * .05))
        for a, b, v in p["solution"]:
            (x0, y0), (x1, y1) = centre(a), centre(b)
            if v == 1:
                c.line(x0, y0, x1, y1)
            else:
                o = s * .1
                dx, dy = (0, o) if a[0] == b[0] else (o, 0)
                c.line(x0 + dx, y0 + dy, x1 + dx, y1 + dy)
                c.line(x0 - dx, y0 - dy, x1 - dx, y1 - dy)
    c.setLineWidth(max(1, s * .05))
    for cell, v in zip(p["islands"], p["clues"]):
        cx, cy = centre(cell)
        c.setFillColor(white)
        c.circle(cx, cy, s * .4, stroke=1, fill=1)
        c.setFillColor(black)
        _txt(c, s, cx, cy, v, "Semi", .5)


# ------------------------------------------------------------------ word puzzles

def wordsearch(c, p, box, solved=False):
    n = p["n"]
    x, y, w, h = box
    words = p["display"]
    list_h = 0
    if (not solved and not p["hard"]) or (solved and p["hard"]):   # the hard ones list their words only with the solution
        cols = 3
        fs = 13.5 if w > 300 else 6.6
        list_h = (-(-len(words) // cols)) * fs * 1.4 + fs
    s = min(w / n, (h - list_h) / n, 30)
    ox, top = x + (w - s * n) / 2, y + h
    if solved:
        c.setStrokeColor(LIGHT)
        c.setLineWidth(s * .72)
        c.setLineCap(1)
        for wd, (r, col, dr, dc) in p["placed"].items():
            k = len(wd) - 1
            c.line(ox + (col + .5) * s, top - (r + .5) * s, ox + (col + dc * k + .5) * s, top - (r + dr * k + .5) * s)
        c.setStrokeColor(black)
        c.setLineCap(0)
    for r in range(n):
        for col in range(n):
            _txt(c, s, ox + (col + .5) * s, top - (r + .5) * s, p["grid"][r][col], "Semi", .62)
    c.setLineWidth(max(.8, s * .04))
    c.rect(ox - s * .15, top - n * s - s * .15, n * s + s * .3, n * s + s * .3)
    if list_h:
        cw = w / cols
        rows = -(-len(words) // cols)
        c.setFont("Body", fs)
        for i, wd in enumerate(words):
            c.drawString(x + (i // rows) * cw + (4 if w > 300 else 0), top - n * s - fs * 1.9 - (i % rows) * fs * 1.4, wd)


def cryptogram(c, p, box, solved=False):
    x, y, w, h = box
    if solved:
        yy = para(c, p["plain"].capitalize() if False else p["plain"], x, y + h - 11, w, "Body", 9.5)
        para(c, p["source"], x, yy - 2, w, "Body", 8.5, color=GREY)
        return
    cw, rowh = 25, 66
    words = p["cipher"].split()
    plain_words = p["plain"].split()
    lines, cur, width = [], [], 0
    for cwd, pwd in zip(words, plain_words):
        need = len(cwd) * cw + (cw if cur else 0)
        if width + need > w and cur:
            lines.append(cur)
            cur, width = [], 0
            need = len(cwd) * cw
        cur.append((cwd, pwd))
        width += need
    lines.append(cur)
    yy = y + h - 30
    for line in lines:
        xx = x
        for cwd, pwd in line:
            for ch, pl in zip(cwd, pwd):
                if ch.isalpha():
                    c.setLineWidth(1)
                    c.line(xx + 2, yy, xx + cw - 3, yy)
                    if ch in p["given"]:
                        c.setFont("Semi", 18)
                        c.drawCentredString(xx + cw / 2 - .5, yy + 4, pl)
                    c.setFont("Body", 15)
                    c.setFillColor(GREY)
                    c.drawCentredString(xx + cw / 2 - .5, yy - 17, ch)
                    c.setFillColor(black)
                else:
                    c.setFont("Semi", 18)
                    c.drawCentredString(xx + cw / 2 - .5, yy + 4, ch)
                xx += cw
            xx += cw
        yy -= rowh
    # a place to keep track of the code
    yy -= 6
    c.setFont("Body", 13)
    c.drawString(x, yy, "Your working: write each code letter's real letter underneath.")
    yy -= 28
    bw = w / 13
    for row in range(2):
        for i in range(13):
            ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[row * 13 + i]
            L = x + i * bw
            c.setLineWidth(.7)
            c.rect(L, yy - 26, bw, 52)
            c.line(L, yy, L + bw, yy)
            c.setFont("Semi", 15)
            c.setFillColor(GREY)
            c.drawCentredString(L + bw / 2, yy + 7, ch)
            c.setFillColor(black)
            if ch in p["given"]:
                c.drawCentredString(L + bw / 2, yy - 19, p["given"][ch])
        yy -= 64
    if p["source"]:
        c.setFont("Body", 13)
        c.setFillColor(GREY)
        c.drawString(x, yy + 14, "Source revealed with the solution.")
        c.setFillColor(black)


def ladder(c, p, box, solved=False):
    x, y, w, h = box
    words = p["solution"]
    n, rows = len(words[0]), len(words)
    if solved:
        para(c, ", ".join(words), x, y + h - 11, w, "Body", 9.5)
        return
    s = min(40, w / n, h / rows)
    ox, top = x + (w - s * n) / 2, y + h
    for r in range(rows):
        show = r in (0, rows - 1)
        for i in range(n):
            c.setLineWidth(1.6 if show else .9)
            c.rect(ox + i * s, top - (r + 1) * s + (2 if not show else 0), s - 3, s - 5)
            if show:
                _txt(c, s, ox + i * s + (s - 3) / 2, top - (r + .5) * s - 1, words[r][i], "Semi", .56)


def logic(c, p, box, solved=False):
    x, y, w, h = box
    cats = p["cats"]
    head = {"name": "Name", "activity": "Took up", "place": "From", "age": "Age", "month": "Started in"}
    k = len(p["solution"])
    if solved:
        fs = 8.6
        cw = [w * f for f in ({3: (.24, .42, .34), 4: (.2, .36, .28, .16), 5: (.17, .29, .22, .1, .22)}[len(cats)])]
        yy = y + h - 10
        for row in p["solution"]:
            xx = x
            for i, v in enumerate(row):
                c.setFont("Semi" if i == 0 else "Body", fs)
                c.drawString(xx, yy, v)
                xx += cw[i]
            yy -= fs * 1.45
        return
    rowh = 32
    table_h = (k + 1) * rowh
    fs = 15
    while fs > 12.5:        # shrink the clue text only as far as needed to leave room for the answer table
        need = sum(len(wrap(t, "Body", fs, w - 28)) * fs * 1.34 + 5 for t in p["clues"])
        if need <= h - table_h - 30:
            break
        fs -= .5
    yy = y + h - 16
    for i, text in enumerate(p["clues"], 1):
        c.setFont("Semi", fs)
        c.drawString(x, yy, f"{i}.")
        yy = para(c, text, x + 28, yy, w - 28, "Body", fs, fs * 1.34) - 5
    top = y + table_h
    cwid = w / len(cats)
    c.setLineWidth(1)
    for r in range(k + 1):
        for i, cat in enumerate(cats):
            c.rect(x + i * cwid, top - (r + 1) * rowh, cwid, rowh)
            if r == 0:
                c.setFont("Semi", 13.5)
                c.drawString(x + i * cwid + 8, top - rowh + 10, head[cat])
            elif i == 0:
                c.setFont("Body", 14)
                c.drawString(x + 8, top - (r + 1) * rowh + 10, p["vals"]["name"][r - 1])
    return top - (k + 1) * rowh


def anagrams(c, p, box, solved=False):
    x, y, w, h = box
    if solved:
        para(c, ", ".join(a for _, a in p["items"]), x, y + h - 11, w, "Body", 9.5)
        return
    yy = y + h - 26
    for i, (scr, _ans) in enumerate(p["items"], 1):
        c.setFont("Semi", 15)
        c.drawString(x, yy, f"{i}.")
        c.setFont("Semi", 19)
        c.drawString(x + 34, yy, "  ".join(scr))
        c.setLineWidth(.9)
        c.line(x + w * .56, yy - 3, x + w, yy - 3)
        yy -= min(52, (h - 30) / len(p["items"]))


DRAW = {f.__name__: f for f in (sudoku, killer, kakuro, futoshiki, calcudoku, skyscrapers, binary, nonogram, bridges,
                                wordsearch, cryptogram, ladder, logic, anagrams)}

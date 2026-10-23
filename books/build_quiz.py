"""Build a Don't Die Retired Christmas Quiz Book interior (UK or US edition) from books/quiz/rounds.yaml.

    python books/build_quiz.py uk          # full book: every round for the edition
    python books/build_quiz.py uk --sample # whatever rounds exist, marked as a sample

Output: books/out/DDR-Christmas-Quiz-<EDITION>-interior.pdf (6 x 9 in, no bleed).
Only questions with a `checked:` date are printed (see books/README.md, "Quiz books").
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).parent))
import layout as L  # registers the Head, Body and Semi fonts
from build_book import COPYRIGHT_LINE, sun

HERE = Path(__file__).parent
OUT = HERE / "out"
PW, PH = 6 * 72, 9 * 72
INNER, OUTER, TOPM, BOTM = .8 * 72, .6 * 72, .7 * 72, .75 * 72
CW = PW - INNER - OUTER
RED, GOLD, INK = HexColor("#8E1F2F"), HexColor("#C98A2B"), HexColor("#1B1B1F")
Q_SIZE, Q_LEAD = 16, 21.5          # large print: questions and answers 16 point
NOTE_SIZE, NOTE_LEAD = 14, 18.5    # the "did you know" notes in the answers
DOTS = {1: "●○○", 2: "●●○", 3: "●●●"}
LEVEL = {1: "easy", 2: "medium", 3: "hard"}
NIGHTS = ["Christmas Eve", "Christmas Day", "Boxing Day"]

EDITIONS = {
    "uk": dict(title=("The", "Don't Die Retired", "Christmas Quiz Book"), file="DDR-Christmas-Quiz-UK",
               strap="Three nights of family quizzing: 300 questions, every answer checked."),
    "us": dict(title=("The", "Don't Die Retired", "Christmas Quiz Book"), file="DDR-Christmas-Quiz-US",
               strap="Three nights of family quizzing: 300 questions, every answer checked.",
               edition_line="American edition"),
}


def x0(n):
    return INNER if n % 2 == 1 else OUTER


def folio(c, n, note=""):
    c.setFont("Body", 13)
    c.setFillColor(L.DARK)
    c.drawCentredString(PW / 2, BOTM - 30, str(n))
    if note:
        (c.drawRightString(x0(n) + CW, BOTM - 30, note) if n % 2 == 1 else c.drawString(x0(n), BOTM - 30, note))
    c.setFillColor(black)


def dots(c, x, y, level, r=3.6):
    """Three small circles, `level` of them filled: drawn, because the body font has no circle glyphs."""
    c.setStrokeColor(L.GREY); c.setFillColor(L.GREY); c.setLineWidth(.9)
    for i in range(3):
        c.circle(x + r + i * (2 * r + 3), y, r, stroke=1, fill=1 if i < level else 0)
    c.setStrokeColor(black); c.setFillColor(black)


def load(edition):
    data = yaml.safe_load((HERE / "quiz" / "rounds.yaml").read_text(encoding="utf-8"))
    rounds = []
    for r in data["rounds"]:
        if edition not in r["editions"]:
            continue
        qs = [q for q in r["questions"] if q.get("checked")]
        for q in qs:
            if edition == "us":
                q["q"], q["a"] = q.get("q_us", q["q"]), q.get("a_us", q["a"])
        if qs:
            rounds.append({**r, "questions": qs})
    return rounds


def q_height(q):
    return len(L.wrap(q["q"], "Body", Q_SIZE, CW - 30)) * Q_LEAD + 30


class Book:
    def __init__(self, edition, sample, ans=None):
        self.e, self.b, self.sample, self.ans = edition, EDITIONS[edition], sample, ans
        OUT.mkdir(exist_ok=True)
        self.path = OUT / f"{self.b['file']}{'-sample' if sample else ''}-interior.pdf"
        self.c = canvas.Canvas(str(self.path), pagesize=(PW, PH), initialFontName="Body")
        self.n = 0

    def page(self, note=""):
        if self.n:
            self.c.showPage()
        self.n += 1
        self._note = note

    def end_page(self):
        folio(self.c, self.n, self._note)

    def blank_to_even(self):
        """Rounds start on a left-hand page so the whole round is in front of the quizmaster at once."""
        if self.n % 2 == 0:   # the next page would be odd (right-hand): leave it blank
            self.page(); self.end_page()

    # --- front matter --------------------------------------------------------------------------
    def front(self, rounds):
        c, b = self.c, self.b
        self.page()
        y = PH - 2.0 * 72
        for i, line in enumerate(b["title"]):
            c.setFont("Head", 22 if line == "The" else 30)
            c.setFillColor(INK)
            c.drawCentredString(PW / 2, y, line)
            y -= 30 if line == "The" else 38
        if b.get("edition_line"):
            c.setFont("Semi", 17); c.setFillColor(RED); c.drawCentredString(PW / 2, y - 4, b["edition_line"]); y -= 30
        c.setFillColor(L.DARK)
        for line in L.wrap(b["strap"], "Body", 15, CW):
            c.setFont("Body", 15); c.drawCentredString(PW / 2, y - 10, line); y -= 20
        sun(c, PW / 2, 2.3 * 72, 40, GOLD)
        if self.sample:
            c.setFont("Semi", 15); c.setFillColor(RED)
            c.drawCentredString(PW / 2, 1.2 * 72, "Sample pages: not for sale")
        c.setFillColor(black)

        self.page()
        y = PH - TOPM - 10
        lines = [f"{' '.join(b['title'])}{' (' + b['edition_line'] + ')' if b.get('edition_line') else ''}", COPYRIGHT_LINE,
                 "The questions were written with the help of AI. Every answer was checked against a published source "
                 "that we opened and read, such as a museum, a national library, an official body or a well-edited "
                 "reference. Where accounts differ, the note with the answer says so.",
                 "Questions and answers are set at 16 point or larger; the notes with the answers are smaller.",
                 "Found a mistake? Tell us on Facebook: facebook.com/dontdieretired", "dontdieretired.com"]
        for t in lines:
            y = L.para(c, t, x0(self.n), y, CW, "Body", 12.5, 17, L.DARK) - 10

        self.page()
        c.setFillColor(RED); c.setFont("Head", 26)
        y = PH - TOPM - 20
        c.drawString(x0(self.n), y, "How to play")
        c.setFillColor(black)
        y -= 34
        how = [
            "One person is the quizmaster and reads each round aloud. Everyone else plays alone or in teams; teams of two to four work best.",
            "The book is three nights of quizzing: ten rounds for Christmas Eve, ten for Christmas Day and ten for Boxing Day. "
            "Play them in any order, or all in one go.",
            "Every round has ten questions, a point each. Under each question, the dots show how hard it is: one for easy, "
            "two for medium, three for hard. Each round has easy ones for the youngest player and hard ones for the know-all.",
            "The answers are at the back, with the page given at the foot of each round, so the quizmaster can check them "
            "without anyone seeing. Where we would also accept another answer, we say so.",
            "Pens, paper, no phones.",
        ]
        for t in how:
            y = L.para(c, t, x0(self.n), y, CW, "Body", Q_SIZE, Q_LEAD) - 10
        self.end_page()

    # --- rounds ------------------------------------------------------------------------------
    def rounds(self, rounds):
        c = self.c
        per_night = max(1, (len(rounds) + 2) // 3) if not self.sample else len(rounds)
        night = -1
        for i, r in enumerate(rounds):
            if i // per_night != night:
                night = i // per_night
                if not self.sample:
                    self.page(); self.blank_to_odd_title(NIGHTS[min(night, 2)])
            self.blank_to_even()
            self.page()
            start = self.n
            y = PH - TOPM - 6
            c.setFont("Semi", 14); c.setFillColor(GOLD)
            c.drawString(x0(self.n), y, f"Round {i + 1}")
            y -= 32
            c.setFont("Head", 24); c.setFillColor(RED)
            for line in L.wrap(r["title"], "Head", 24, CW):
                c.drawString(x0(self.n), y, line); y -= 29
            c.setFillColor(L.DARK)
            y = L.para(c, r["intro"], x0(self.n), y - 4, CW, "Body", 15, 20, L.DARK) - 14
            c.setFillColor(black)
            for k, q in enumerate(r["questions"], 1):
                if y - q_height(q) < BOTM + 10:
                    self.end_page(); self.page(); y = PH - TOPM - 6
                    c.setFont("Semi", 13); c.setFillColor(L.GREY)
                    c.drawString(x0(self.n), y, f"Round {i + 1}: {r['title']} (continued)"); c.setFillColor(black)
                    y -= 30
                c.setFont("Head", Q_SIZE); c.setFillColor(RED)
                c.drawString(x0(self.n), y, f"{k}.")
                c.setFillColor(black)
                ytop = y
                y = L.para(c, q["q"], x0(self.n) + 30, y, CW - 30, "Body", Q_SIZE, Q_LEAD)
                dots(c, x0(self.n) + 30, y + 7, q["level"])
                c.setFont("Body", 12); c.setFillColor(L.GREY)
                c.drawString(x0(self.n) + 30 + 34, y + 3, LEVEL[q["level"]])
                c.setFillColor(black)
                y -= 20
            self.end_page_round(i)

    def blank_to_odd_title(self, title):
        c = self.c
        if self.n % 2 == 0:
            self.end_page(); self.page()
        c.setFillColor(RED); c.rect(0, 0, PW, PH, stroke=0, fill=1)
        c.setFillColor(HexColor("#FBF6EE")); c.setFont("Head", 34)
        c.drawCentredString(PW / 2, PH / 2 + 20, title)
        sun(c, PW / 2, PH / 2 - 70, 34, GOLD)
        c.setFillColor(black)

    def end_page_round(self, i):
        """Foot of a round's last page: the folio, and (on the second pass) where its answers are."""
        folio(self.c, self.n)
        if self.ans:
            c = self.c
            c.setFont("Semi", 13); c.setFillColor(L.GREY)
            txt = f"Answers: page {self.ans[i]}"
            (c.drawRightString(x0(self.n) + CW, BOTM - 30, txt) if self.n % 2 == 1 else c.drawString(x0(self.n), BOTM - 30, txt))
            c.setFillColor(black)

    # --- answers -----------------------------------------------------------------------------
    def answers(self, rounds):
        c = self.c
        self.page()
        c.setFillColor(RED); c.setFont("Head", 26)
        y = PH - TOPM - 20
        c.drawString(x0(self.n), y, "Answers")
        c.setFillColor(black)
        y -= 40
        self.ans_page = {}
        for i, r in enumerate(rounds):
            need = 70
            if y - need < BOTM:
                self.end_page(); self.page(); y = PH - TOPM - 6
            self.ans_page[i] = self.n
            c.setFont("Head", 18); c.setFillColor(RED)
            c.drawString(x0(self.n), y, f"Round {i + 1}: {r['title']}")
            c.setFillColor(black)
            y -= 28
            for k, q in enumerate(r["questions"], 1):
                a = q["a"] + (f" (also accept: {q['accept']})" if q.get("accept") else "")
                h = len(L.wrap(a, "Semi", Q_SIZE, CW - 30)) * Q_LEAD
                if q.get("note"):
                    h += len(L.wrap(q["note"], "Body", NOTE_SIZE, CW - 30)) * NOTE_LEAD
                if y - h < BOTM + 6:
                    self.end_page(); self.page(); y = PH - TOPM - 6
                c.setFont("Head", Q_SIZE); c.setFillColor(RED); c.drawString(x0(self.n), y, f"{k}."); c.setFillColor(black)
                y = L.para(c, a, x0(self.n) + 30, y, CW - 30, "Semi", Q_SIZE, Q_LEAD)
                if q.get("note"):
                    y = L.para(c, q["note"], x0(self.n) + 30, y, CW - 30, "Body", NOTE_SIZE, NOTE_LEAD, L.DARK)
                y -= 8
            y -= 18
        self.end_page()


def build(edition, sample=False):
    rounds = load(edition)
    if not rounds:
        raise SystemExit(f"No checked questions for the {edition} edition yet.")
    ans = None
    for _ in (1, 2):   # pass 1 finds where each round's answers fall; pass 2 prints that page under the round
        bk = Book(edition, sample, ans)
        bk.front(rounds)
        bk.rounds(rounds)
        bk.answers(rounds)
        bk.c.save()
        ans = bk.ans_page
    print(f"{edition}: {sum(len(r['questions']) for r in rounds)} questions in {len(rounds)} rounds, {bk.n} pages -> {bk.path.name}")
    return bk.path, bk.n


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    build(args[0] if args else "uk", sample="--sample" in sys.argv)

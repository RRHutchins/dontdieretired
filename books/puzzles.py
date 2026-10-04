"""Puzzle generators for the Don't Die Retired puzzle books.

Every logic puzzle made here is checked by a solver to have exactly one
solution before it is returned (`unique` below, or the type's own counter).
Each generator returns a dict with at least: type, tier, and the fields its
drawing function in layout.py needs, including the full solution.

Tiers are 1, 2, 3. The book decides what to call them (Volume 1: Warm-up,
Steady, Stretch; the Hard volume: Hard, Harder, Hardest).
"""
from __future__ import annotations

import itertools
import math
import random
from pathlib import Path

from ortools.sat.python import cp_model

HERE = Path(__file__).parent


# ------------------------------------------------------------------ solver helpers

class _Collect(cp_model.CpSolverSolutionCallback):
    def __init__(self, vars_, limit, accept=None, cap=4000):
        super().__init__()
        self.vars, self.limit, self.accept, self.cap = vars_, limit, accept, cap
        self.sols, self.seen = [], 0

    def on_solution_callback(self):
        self.seen += 1
        vals = [self.Value(v) for v in self.vars]
        if self.accept is None or self.accept(vals):
            self.sols.append(vals)
        if len(self.sols) >= self.limit or self.seen >= self.cap:
            self.StopSearch()


def solutions(model, vars_, limit=2, accept=None, cap=4000):
    """Up to `limit` solutions of a CP-SAT model (as lists of values of vars_)."""
    s = cp_model.CpSolver()
    s.parameters.enumerate_all_solutions = True
    s.parameters.num_workers = 1
    s.parameters.max_time_in_seconds = 20
    cb = _Collect(vars_, limit, accept, cap)
    status = s.Solve(model, cb)
    # True only when the whole search space was covered: no time-out, no cap, not stopped early
    cb.exhausted_ok = status in (cp_model.OPTIMAL, cp_model.INFEASIBLE) and cb.seen < cap and len(cb.sols) < limit
    cb.exhausted = cb.exhausted_ok
    return cb


def unique(model, vars_, accept=None):
    """Exactly one solution, proved by a search that ran to completion."""
    cb = solutions(model, vars_, 2, accept)
    return len(cb.sols) == 1 and cb.exhausted_ok


def latin(n, rng):
    """A random n x n Latin square (values 1..n) by shuffled backtracking."""
    g = [[0] * n for _ in range(n)]
    rows = [set() for _ in range(n)]
    cols = [set() for _ in range(n)]

    def go(k):
        if k == n * n:
            return True
        r, c = divmod(k, n)
        vals = [v for v in range(1, n + 1) if v not in rows[r] and v not in cols[c]]
        rng.shuffle(vals)
        for v in vals:
            g[r][c] = v; rows[r].add(v); cols[c].add(v)
            if go(k + 1):
                return True
            rows[r].discard(v); cols[c].discard(v)
        g[r][c] = 0
        return False

    go(0)
    return g


def _latin_model(n):
    m = cp_model.CpModel()
    x = [[m.NewIntVar(1, n, f"x{r}_{c}") for c in range(n)] for r in range(n)]
    for i in range(n):
        m.AddAllDifferent(x[i])
        m.AddAllDifferent([x[r][i] for r in range(n)])
    return m, x


def _flat(x):
    return [v for row in x for v in row]


# ------------------------------------------------------------------ sudoku

PEERS = []
UNITS = []
for _r in range(9):
    UNITS.append([_r * 9 + c for c in range(9)])
for _c in range(9):
    UNITS.append([r * 9 + _c for r in range(9)])
for _b in range(9):
    UNITS.append([(_b // 3 * 3 + i) * 9 + _b % 3 * 3 + j for i in range(3) for j in range(3)])
for _i in range(81):
    PEERS.append(sorted({j for u in UNITS if _i in u for j in u} - {_i}))


def sudoku_count(grid, limit=2):
    g = list(grid)
    count = 0

    def cands(i):
        used = {g[j] for j in PEERS[i]}
        return [v for v in range(1, 10) if v not in used]

    def go():
        nonlocal count
        best, bc = -1, None
        for i in range(81):
            if g[i] == 0:
                c = cands(i)
                if not c:
                    return
                if bc is None or len(c) < len(bc):
                    best, bc = i, c
                    if len(c) == 1:
                        break
        if best < 0:
            count += 1
            return
        for v in bc:
            g[best] = v
            go()
            if count >= limit:
                break
        g[best] = 0

    go()
    return count


def sudoku_full(rng):
    g = [0] * 81

    def go(i):
        if i == 81:
            return True
        used = {g[j] for j in PEERS[i]}
        vals = [v for v in range(1, 10) if v not in used]
        rng.shuffle(vals)
        for v in vals:
            g[i] = v
            if go(i + 1):
                return True
        g[i] = 0
        return False

    go(0)
    return g


def sudoku_grade(grid):
    """Hardest technique a person needs: 1 singles, 2 locked candidates and
    pairs, 3 triples and X-wing, 4 beyond those (chains or trial and error)."""
    g = list(grid)
    cand = [set(range(1, 10)) if g[i] == 0 else set() for i in range(81)]
    for i in range(81):
        if g[i]:
            for j in PEERS[i]:
                cand[j].discard(g[i])
    level = 1

    def place(i, v):
        g[i] = v
        cand[i] = set()
        for j in PEERS[i]:
            cand[j].discard(v)

    def singles():
        for i in range(81):
            if g[i] == 0 and len(cand[i]) == 1:
                place(i, next(iter(cand[i])))
                return True
        for u in UNITS:
            for v in range(1, 10):
                spots = [i for i in u if g[i] == 0 and v in cand[i]]
                if len(spots) == 1:
                    place(spots[0], v)
                    return True
        return False

    def locked():
        ch = False
        for u in UNITS:
            for v in range(1, 10):
                spots = [i for i in u if v in cand[i]]
                if 2 <= len(spots) <= 3:
                    for w in UNITS:
                        if w is not u and all(i in w for i in spots):
                            for j in w:
                                if j not in spots and v in cand[j]:
                                    cand[j].discard(v); ch = True
        return ch

    def subsets(k):
        ch = False
        for u in UNITS:
            cells = [i for i in u if g[i] == 0]
            for combo in itertools.combinations(cells, k):  # naked
                vals = set().union(*(cand[i] for i in combo))
                if len(vals) == k:
                    for j in cells:
                        if j not in combo and cand[j] & vals:
                            cand[j] -= vals; ch = True
            vs = sorted(set().union(*(cand[i] for i in cells))) if cells else []
            for combo in itertools.combinations(vs, k):  # hidden
                spots = [i for i in cells if cand[i] & set(combo)]
                if len(spots) == k:
                    for i in spots:
                        if cand[i] - set(combo):
                            cand[i] &= set(combo); ch = True
        return ch

    def xwing():
        ch = False
        for lines, cross in ((UNITS[:9], UNITS[9:18]), (UNITS[9:18], UNITS[:9])):
            for v in range(1, 10):
                pos = {}
                for li, u in enumerate(lines):
                    spots = tuple(k for k, i in enumerate(u) if v in cand[i])
                    if len(spots) == 2:
                        pos.setdefault(spots, []).append(li)
                for spots, ls in pos.items():
                    if len(ls) == 2:
                        for k in spots:
                            for li, u in enumerate(lines):
                                if li not in ls and v in cand[u[k]]:
                                    cand[u[k]].discard(v); ch = True
        return ch

    while 0 in g:
        if singles():
            continue
        if locked() or subsets(2):
            level = max(level, 2)
            continue
        if subsets(3) or xwing():
            level = max(level, 3)
            continue
        return 4
    return level


def sudoku(tier, rng, book="hard"):
    """Volume 1: tier 1-2 need singles only (more givens at tier 1), tier 3
    needs pairs or locked candidates. Hard volume: tier 1 needs level 2,
    tier 2 level 3, tier 3 goes beyond the listed techniques."""
    want = {("std", 1): 1, ("std", 2): 1, ("std", 3): 2, ("hard", 1): 2, ("hard", 2): 3, ("hard", 3): 4}[(book, tier)]
    floor = {("std", 1): 36, ("std", 2): 30}.get((book, tier), 0)
    for _ in range(3000):
        sol = sudoku_full(rng)
        g = list(sol)
        order = list(range(41))
        rng.shuffle(order)
        for i in order:
            j = 80 - i
            if sum(1 for v in g if v) <= floor:
                break
            keep = (g[i], g[j])
            g[i] = g[j] = 0
            if sudoku_count(g) != 1:
                g[i], g[j] = keep
        lvl = sudoku_grade(g)
        if lvl == want:
            return {"type": "sudoku", "tier": tier, "grid": g, "solution": sol, "level": lvl}
    raise RuntimeError("sudoku: no puzzle at requested level")


# ------------------------------------------------------------------ killer sudoku

def _cages(n_rows, n_cols, digit, sizes, rng, distinct=True):
    """Partition a grid into cages by random growth. digit(r, c) gives the
    solution value; with distinct=True a cage never repeats a value."""
    cage_of = {}
    cages = []
    cells = [(r, c) for r in range(n_rows) for c in range(n_cols)]
    rng.shuffle(cells)
    for start in cells:
        if start in cage_of:
            continue
        cage = [start]
        cage_of[start] = len(cages)
        target = rng.choice(sizes)
        while len(cage) < target:
            opts = []
            for (r, c) in cage:
                for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                    q = (r + dr, c + dc)
                    if 0 <= q[0] < n_rows and 0 <= q[1] < n_cols and q not in cage_of:
                        if not distinct or digit(*q) not in {digit(*p) for p in cage}:
                            opts.append(q)
            if not opts:
                break
            q = rng.choice(opts)
            cage.append(q)
            cage_of[q] = len(cages)
        cages.append(sorted(cage))
    return cages


def killer(tier, rng, book="hard"):
    sizes = {1: [2, 2, 2, 3, 3], 2: [2, 2, 3, 3, 4], 3: [2, 3, 3, 3, 4, 4]}[tier]
    for _ in range(2500):
        sol = sudoku_full(rng)
        cages = _cages(9, 9, lambda r, c: sol[r * 9 + c], sizes, rng)
        if sum(1 for cg in cages if len(cg) == 1) > (4 if tier == 1 else 2):
            continue
        m = cp_model.CpModel()
        x = [m.NewIntVar(1, 9, f"x{i}") for i in range(81)]
        for u in UNITS:
            m.AddAllDifferent([x[i] for i in u])
        for cg in cages:
            vs = [x[r * 9 + c] for r, c in cg]
            if len(vs) > 1:
                m.AddAllDifferent(vs)
            m.Add(sum(vs) == sum(sol[r * 9 + c] for r, c in cg))
        if unique(m, x):
            return {"type": "killer", "tier": tier, "cages": cages,
                    "sums": [sum(sol[r * 9 + c] for r, c in cg) for cg in cages], "solution": sol}
    raise RuntimeError("killer: none unique")


# ------------------------------------------------------------------ kakuro

def _kakuro_runs(white, n):
    runs = []
    for horiz in (True, False):
        for a in range(n):
            b = 0
            while b < n:
                cell = (a, b) if horiz else (b, a)
                if cell in white:
                    run = []
                    while b < n and ((a, b) if horiz else (b, a)) in white:
                        run.append((a, b) if horiz else (b, a))
                        b += 1
                    runs.append((horiz, run))
                else:
                    b += 1
    return runs


def _connected(cells):
    cells = set(cells)
    if not cells:
        return False
    seen, stack = set(), [next(iter(cells))]
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        for d in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            q = (p[0] + d[0], p[1] + d[1])
            if q in cells:
                stack.append(q)
    return len(seen) == len(cells)


def _kakuro_pattern(n, maxrun, rng):
    """Black out cells (in symmetric pairs) only where a run is too long."""
    white = {(r, c) for r in range(n) for c in range(n)}
    cells = list(white)
    rng.shuffle(cells)
    for (r, c) in cells:
        runs = _kakuro_runs(white, n)
        if max(len(run) for _, run in runs) <= maxrun:
            break
        if not any((r, c) in run and len(run) > maxrun for _, run in runs):
            continue
        trial = white - {(r, c), (n - 1 - r, n - 1 - c)}
        tr = _kakuro_runs(trial, n)
        if (all(len(run) >= 2 for _, run in tr) and _connected(trial)
                and all(sum(1 for _, run in tr if cell in run) == 2 for cell in trial)):
            white = trial
    runs = _kakuro_runs(white, n)
    if max(len(run) for _, run in runs) > maxrun or not .5 <= len(white) / n / n <= .75:
        return None
    return white, runs


def kakuro(tier, rng, n=None, book="hard"):
    """n is the side of the playing area (the clue row and column are extra).
    Larger grids are filled so that more runs have sums with few possible
    digit sets, which is what makes a unique answer reachable."""
    n, maxrun, forcing = {"std": {1: (5, 3, True), 2: (6, 3, True), 3: (6, 4, True)},
                          "hard": {1: (6, 4, False), 2: (7, 5, True), 3: (7, 5, True)}}[book][tier]
    for _ in range(3000):
        pt = _kakuro_pattern(n, maxrun, rng)
        if not pt:
            continue
        white, runs = pt
        for _fill in range(6):
            m = cp_model.CpModel()
            x = {cell: m.NewIntVar(1, 9, f"k{cell}") for cell in white}
            for _, run in runs:
                m.AddAllDifferent([x[c] for c in run])
            if forcing:
                m.Maximize(sum(rng.choice((-2, -1, 1, 2)) * sum(x[c] for c in run) for _, run in runs)
                           + sum(rng.randint(-1, 1) * x[c] for c in white))
            else:
                m.Maximize(sum(rng.randint(-3, 3) * x[c] for c in white))
            s = cp_model.CpSolver()
            s.parameters.max_time_in_seconds = 3
            s.parameters.num_workers = 1
            if s.Solve(m) not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                continue
            sol = {c: s.Value(x[c]) for c in white}
            m2 = cp_model.CpModel()
            y = {cell: m2.NewIntVar(1, 9, f"k{cell}") for cell in white}
            for _, run in runs:
                m2.AddAllDifferent([y[c] for c in run])
                m2.Add(sum(y[c] for c in run) == sum(sol[c] for c in run))
            order = sorted(white)
            cb = solutions(m2, [y[c] for c in order], 2)
            if len(cb.sols) == 1 and cb.exhausted_ok:
                return {"type": "kakuro", "tier": tier, "n": n, "white": order,
                        "runs": [(h, run, sum(sol[c] for c in run)) for h, run in runs],
                        "solution": {c: sol[c] for c in order}}
    raise RuntimeError("kakuro: none unique")


# ------------------------------------------------------------------ futoshiki

def futoshiki(tier, rng, n=None, book="hard"):
    n = n or ({1: 5, 2: 5, 3: 6}[tier] if book == "std" else {1: 6, 2: 7, 3: 7}[tier])
    while True:
        sol = latin(n, rng)
        ineq = []  # (r, c, r2, c2): cell 1 is less than cell 2
        for r in range(n):
            for c in range(n):
                for r2, c2 in ((r, c + 1), (r + 1, c)):
                    if r2 < n and c2 < n:
                        ineq.append((r, c, r2, c2) if sol[r][c] < sol[r2][c2] else (r2, c2, r, c))
        given = []

        def is_unique(iq, gv):
            m, x = _latin_model(n)
            for a, b, c, d in iq:
                m.Add(x[a][b] < x[c][d])
            for r, c in gv:
                m.Add(x[r][c] == sol[r][c])
            return unique(m, _flat(x))

        cells = [(r, c) for r in range(n) for c in range(n)]
        rng.shuffle(cells)
        while not is_unique(ineq, given) and cells:
            given.append(cells.pop())
        if not is_unique(ineq, given):
            continue
        # strip clues while the answer stays unique; easier tiers keep more
        keep_min = {"std": {1: 2.2, 2: 1.8, 3: 1.5}, "hard": {1: 0, 2: 0, 3: 0}}[book][tier] * n
        items = [("i", q) for q in ineq] + [("g", q) for q in given]
        rng.shuffle(items)
        for it in list(items):
            if len(items) <= keep_min:
                break
            trial = [t for t in items if t is not it]
            if is_unique([q for k, q in trial if k == "i"], [q for k, q in trial if k == "g"]):
                items = trial
        return {"type": "futoshiki", "tier": tier, "n": n, "ineq": [q for k, q in items if k == "i"],
                "given": [q for k, q in items if k == "g"], "solution": sol}


# ------------------------------------------------------------------ calcudoku

def calcudoku(tier, rng, n=None, book="hard"):
    n = n or ({1: 4, 2: 5, 3: 5}[tier] if book == "std" else {1: 6, 2: 6, 3: 7}[tier])
    sizes = [1, 2, 2, 3] if book == "std" and tier == 1 else ([2, 2, 3, 3] if book == "std" else [2, 3, 3, 4])
    for _ in range(300):
        sol = latin(n, rng)
        cages = _cages(n, n, lambda r, c: sol[r][c], sizes, rng, distinct=False)
        if sum(1 for cg in cages if len(cg) == 1) > (2 if book == "std" else 1):
            continue
        clues = []
        for cg in cages:
            vals = [sol[r][c] for r, c in cg]
            if len(cg) == 1:
                clues.append(("", vals[0]))
            elif len(cg) == 2:
                a, b = max(vals), min(vals)
                ops = ["+", "-", "x"] + (["/", "/"] if a % b == 0 else [])
                op = rng.choice(ops)
                clues.append((op, {"+": a + b, "-": a - b, "x": a * b, "/": a // b}[op]))
            else:
                op = rng.choice(["+", "x"])
                clues.append((op, sum(vals) if op == "+" else math.prod(vals)))
        m, x = _latin_model(n)
        for cg, (op, target) in zip(cages, clues):
            vs = [x[r][c] for r, c in cg]
            ok = []
            for tup in itertools.product(range(1, n + 1), repeat=len(cg)):
                if op == "":
                    good = tup[0] == target
                elif op == "+":
                    good = sum(tup) == target
                elif op == "x":
                    good = math.prod(tup) == target
                elif op == "-":
                    good = abs(tup[0] - tup[1]) == target
                else:
                    good = max(tup) == target * min(tup)
                if good:
                    ok.append(tup)
            m.AddAllowedAssignments(vs, ok)
        if unique(m, _flat(x)):
            return {"type": "calcudoku", "tier": tier, "n": n, "cages": cages, "clues": clues, "solution": sol}
    raise RuntimeError("calcudoku: none unique")


# ------------------------------------------------------------------ skyscrapers

def _visible(seq):
    top = count = 0
    for v in seq:
        if v > top:
            top, count = v, count + 1
    return count


def skyscrapers(tier, rng, n=None, book="hard"):
    n = n or ({1: 4, 2: 5, 3: 5}[tier] if book == "std" else {1: 5, 2: 6, 3: 6}[tier])
    perms = list(itertools.permutations(range(1, n + 1)))
    while True:
        sol = latin(n, rng)
        clues = {}
        for i in range(n):
            row = sol[i]
            col = [sol[r][i] for r in range(n)]
            clues[("L", i)] = _visible(row)
            clues[("R", i)] = _visible(row[::-1])
            clues[("T", i)] = _visible(col)
            clues[("B", i)] = _visible(col[::-1])

        def is_unique(cl, gv):
            m, x = _latin_model(n)
            for i in range(n):
                l, r_ = cl.get(("L", i)), cl.get(("R", i))
                if l or r_:
                    m.AddAllowedAssignments(x[i], [p for p in perms if (not l or _visible(p) == l) and (not r_ or _visible(p[::-1]) == r_)])
                t, b = cl.get(("T", i)), cl.get(("B", i))
                if t or b:
                    m.AddAllowedAssignments([x[r][i] for r in range(n)], [p for p in perms if (not t or _visible(p) == t) and (not b or _visible(p[::-1]) == b)])
            for r, c in gv:
                m.Add(x[r][c] == sol[r][c])
            return unique(m, _flat(x))

        given = []
        cells = [(r, c) for r in range(n) for c in range(n)]
        rng.shuffle(cells)
        while not is_unique(clues, given) and len(given) < 3:
            given.append(cells.pop())
        if not is_unique(clues, given):
            continue
        keys = list(clues)
        rng.shuffle(keys)
        keep_min = {"std": {1: 4 * n, 2: 3 * n, 3: 2.5 * n}, "hard": {1: 2.6 * n, 2: 0, 3: 0}}[book][tier]
        for k in keys:
            if len(clues) <= keep_min:
                break
            trial = {a: b for a, b in clues.items() if a != k}
            if is_unique(trial, given):
                clues = trial
        return {"type": "skyscrapers", "tier": tier, "n": n, "clues": clues, "given": given, "solution": sol}


# ------------------------------------------------------------------ binary puzzle

def _binary_model(n):
    m = cp_model.CpModel()
    x = [[m.NewBoolVar(f"b{r}_{c}") for c in range(n)] for r in range(n)]
    lines = [x[r] for r in range(n)] + [[x[r][c] for r in range(n)] for c in range(n)]
    for ln in lines:
        m.Add(sum(ln) == n // 2)
        for i in range(n - 2):
            m.AddLinearConstraint(sum(ln[i:i + 3]), 1, 2)
    for group in (lines[:n], lines[n:]):  # no two rows alike, no two columns alike
        for a, b in itertools.combinations(group, 2):
            diffs = []
            for p, q in zip(a, b):
                d = m.NewBoolVar("")
                m.Add(p != q).OnlyEnforceIf(d)
                m.Add(p == q).OnlyEnforceIf(d.Not())
                diffs.append(d)
            m.AddBoolOr(diffs)
    return m, x


def binary(tier, rng, n=None, book="hard"):
    n = n or ({1: 6, 2: 8, 3: 8}[tier] if book == "std" else {1: 10, 2: 12, 3: 12}[tier])
    m, x = _binary_model(n)
    m.Maximize(sum(rng.randint(-2, 2) * v for v in _flat(x)))
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = 10
    s.parameters.num_workers = 1
    s.Solve(m)
    sol = [[s.Value(x[r][c]) for c in range(n)] for r in range(n)]
    given = {(r, c) for r in range(n) for c in range(n)}
    cells = sorted(given)
    rng.shuffle(cells)
    keep_min = {"std": {1: .42, 2: .36, 3: .30}, "hard": {1: .26, 2: 0, 3: 0}}[book][tier] * n * n

    def is_unique(gv):
        m2, y = _binary_model(n)
        for r, c in gv:
            m2.Add(y[r][c] == sol[r][c])
        return unique(m2, _flat(y))

    for cell in cells:
        if len(given) <= keep_min:
            break
        if is_unique(given - {cell}):
            given.discard(cell)
    return {"type": "binary", "tier": tier, "n": n, "given": sorted(given), "solution": sol}


# ------------------------------------------------------------------ nonogram

# Pictures are drawn from symbol glyphs in DejaVu Sans, so each solved grid shows something.
GLYPHS = [("☀", "the sun"), ("☂", "an umbrella"), ("☃", "a snowman"), ("★", "a star"),
          ("☎", "a telephone"), ("☕", "a hot drink"), ("♘", "a chess knight"), ("♖", "a chess rook"),
          ("♔", "a chess king"), ("♠", "a spade"), ("♣", "a club"), ("♥", "a heart"),
          ("♫", "musical notes"), ("⚓", "an anchor"), ("✂", "scissors"), ("✈", "an aeroplane"),
          ("✉", "an envelope"), ("✎", "a pencil"), ("✿", "a flower"), ("❄", "a snowflake"),
          ("⚽", "a football"), ("⌂", "a house"), ("☾", "the moon"), ("☘", "a shamrock"),
          ("⚑", "a flag"), ("♛", "a chess queen"), ("☢", "a warning sign"), ("☯", "yin and yang"),
          ("☸", "a ship's wheel"), ("☁", "a cloud"), ("☇", "lightning"), ("✄", "scissors"),
          ("⌛", "an hourglass"), ("⌨", "a keyboard"), ("⛵", "a sailing boat"), ("⛄", "a snowman"),
          ("♦", "a diamond"), ("♪", "a musical note"), ("❀", "a flower"), ("❤", "a heart")]


def _glyph_grid(ch, n):
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 400)
    img = Image.new("L", (640, 640), 0)
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), ch, font=font)
    if box[2] - box[0] < 60 or box[3] - box[1] < 60:
        return None
    d.text((-box[0] + 10, -box[1] + 10), ch, font=font, fill=255)
    img = img.crop((10, 10, 10 + box[2] - box[0], 10 + box[3] - box[1]))
    side = max(img.size)
    sq = Image.new("L", (side, side), 0)
    sq.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2))
    small = sq.resize((n, n), Image.BOX)
    return [[1 if small.getpixel((c, r)) > 110 else 0 for c in range(n)] for r in range(n)]


def _line_clue(line):
    return [len(list(g)) for k, g in itertools.groupby(line) if k] or [0]


def _nono_unique(rows, cols):
    n_r, n_c = len(rows), len(cols)
    m = cp_model.CpModel()
    x = [[m.NewBoolVar(f"n{r}_{c}") for c in range(n_c)] for r in range(n_r)]

    def add_line(vars_, clue):
        if clue == [0]:
            for v in vars_:
                m.Add(v == 0)
            return
        # states: one per filled cell of each block, plus gap states
        trans, state = [], 0
        trans.append((0, 0, 0))
        for bi, b in enumerate(clue):
            for k in range(b):
                trans.append((state, 1, state + 1))
                state += 1
            if bi < len(clue) - 1:
                trans.append((state, 0, state + 1))
                state += 1
                trans.append((state, 0, state))
            else:
                trans.append((state, 0, state))
        m.AddAutomaton(vars_, 0, [state], trans)

    for r in range(n_r):
        add_line(x[r], rows[r])
    for c in range(n_c):
        add_line([x[r][c] for r in range(n_r)], cols[c])
    return unique(m, _flat(x))


_nono_used = set()

# Pictures chosen by eye: each was rendered at its grid size and kept only if it is
# recognisable and gives a nonogram with a single solution. (symbol, name, grid size)
PICTURES = {
    "std": {1: [("\u2665", "a heart", 10), ("\u2693", "an anchor", 10), ("\u2302", "a house", 10)],
            2: [("\u2605", "a star", 12), ("\u260e", "a telephone", 12), ("\u2709", "an envelope", 12)],
            3: [("\u2691", "a flag", 12), ("\u263a", "a smiling face", 12), ("\u266c", "musical notes", 12)]},
    "hard": {1: [("\u2702", "scissors", 12), ("\u2692", "crossed hammers", 12), ("\u2646", "a trident", 12)],
             2: [("\u2708", "an aeroplane", 15), ("\u265e", "a chess knight", 15), ("\u2699", "a cog", 15)],
             3: [("\u2654", "a chess king", 15), ("\u269c", "a fleur-de-lis", 15), ("\u2638", "a ship's wheel", 15)]},
}


def nonogram(tier, rng, n=None, book="hard"):
    for ch, name, size in PICTURES[book][tier]:
        if (ch, book) in _nono_used:
            continue
        _nono_used.add((ch, book))
        grid = _glyph_grid(ch, size)
        if grid is None:
            raise RuntimeError(f"nonogram: the font has no symbol for {name}")
        rows = [_line_clue(r) for r in grid]
        cols = [_line_clue([grid[r][c] for r in range(size)]) for c in range(size)]
        if not _nono_unique(rows, cols):
            raise RuntimeError(f"nonogram: {name} at {size} does not have a single solution")
        return {"type": "nonogram", "tier": tier, "n": size, "rows": rows, "cols": cols, "solution": grid, "name": name}
    raise RuntimeError("nonogram: ran out of pictures")


# ------------------------------------------------------------------ bridges (hashi)

def bridges(tier, rng, n=None, book="hard"):
    n = n or ({1: 7, 2: 7, 3: 8}[tier] if book == "std" else {1: 9, 2: 10, 3: 11}[tier])
    want = int(n * n * ({"std": .20, "hard": .22}[book]))
    for _ in range(400):
        isl = {}            # (r, c) -> True
        occ = {}            # bridge cells
        links = {}          # frozenset({a, b}) -> count
        start = (rng.randrange(n), rng.randrange(n))
        isl[start] = True
        for _step in range(want * 30):
            if len(isl) >= want:
                break
            a = rng.choice(list(isl))
            dr, dc = rng.choice(((0, 1), (1, 0), (0, -1), (-1, 0)))
            dist = rng.randint(2, max(2, n // 2))
            path, ok = [], True
            for k in range(1, dist):
                p = (a[0] + dr * k, a[1] + dc * k)
                if not (0 <= p[0] < n and 0 <= p[1] < n) or p in isl or p in occ:
                    ok = False
                    break
                path.append(p)
            b = (a[0] + dr * dist, a[1] + dc * dist)
            if not ok or not (0 <= b[0] < n and 0 <= b[1] < n) or b in occ:
                continue
            # no island may sit directly next to another
            if b not in isl and any((b[0] + e, b[1] + f) in isl for e, f in ((0, 1), (1, 0), (0, -1), (-1, 0))):
                continue
            key = frozenset((a, b))
            if key in links:
                continue
            isl[b] = True
            for p in path:
                occ[p] = True
            links[key] = rng.choice((1, 1, 2, 2) if tier > 1 else (1, 2))
        if len(isl) < want * .8:
            continue
        islands = sorted(isl)
        deg = {i: 0 for i in islands}
        for key, k in links.items():
            for i in key:
                deg[i] += k
        # candidate edges: nearest island in each direction
        edges = []
        for (r, c) in islands:
            for dr, dc in ((0, 1), (1, 0)):
                k = 1
                while 0 <= r + dr * k < n and 0 <= c + dc * k < n:
                    q = (r + dr * k, c + dc * k)
                    if q in isl:
                        edges.append(((r, c), q))
                        break
                    k += 1

        def cells(e):
            (r1, c1), (r2, c2) = e
            return {(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)} - {e[0], e[1]}

        m = cp_model.CpModel()
        x = [m.NewIntVar(0, 2, f"e{i}") for i in range(len(edges))]
        for i in islands:
            m.Add(sum(x[k] for k, e in enumerate(edges) if i in e) == deg[i])
        for (i, e), (j, f) in itertools.combinations(enumerate(edges), 2):
            if cells(e) & cells(f):
                bi, bj = m.NewBoolVar(""), m.NewBoolVar("")
                m.Add(x[i] == 0).OnlyEnforceIf(bi.Not())
                m.Add(x[j] == 0).OnlyEnforceIf(bj.Not())
                m.AddBoolOr([bi.Not(), bj.Not()])

        def joined(vals):
            adj = {i: [] for i in islands}
            for v, (a, b) in zip(vals, edges):
                if v:
                    adj[a].append(b); adj[b].append(a)
            seen, stack = set(), [islands[0]]
            while stack:
                p = stack.pop()
                if p not in seen:
                    seen.add(p); stack.extend(adj[p])
            return len(seen) == len(islands)

        cb = solutions(m, x, 2, joined, cap=3000)
        if len(cb.sols) == 1 and cb.exhausted:
            return {"type": "bridges", "tier": tier, "n": n, "islands": islands, "clues": [deg[i] for i in islands],
                    "solution": [(a, b, v) for v, (a, b) in zip(cb.sols[0], edges) if v]}
    raise RuntimeError("bridges: none unique")


# ------------------------------------------------------------------ word search

def wordsearch(theme, words, rng, n=15, hard=False):
    """hard: all eight directions and the word list is withheld."""
    display = sorted(w.upper() for w in words)
    words = sorted({w.upper().replace(" ", "").replace("-", "").replace("'", "") for w in words}, key=len, reverse=True)
    dirs = [(0, 1), (1, 0), (1, 1), (-1, 1)]
    if hard:
        dirs += [(0, -1), (-1, 0), (-1, -1), (1, -1)]
    for _ in range(300):
        grid = [[""] * n for _ in range(n)]
        placed = {}
        ok = True
        for w in words:
            done = False
            for _try in range(400):
                dr, dc = rng.choice(dirs)
                r, c = rng.randrange(n), rng.randrange(n)
                er, ec = r + dr * (len(w) - 1), c + dc * (len(w) - 1)
                if not (0 <= er < n and 0 <= ec < n):
                    continue
                if all(grid[r + dr * k][c + dc * k] in ("", w[k]) for k in range(len(w))):
                    for k in range(len(w)):
                        grid[r + dr * k][c + dc * k] = w[k]
                    placed[w] = (r, c, dr, dc)
                    done = True
                    break
            if not done:
                ok = False
                break
        if not ok:
            continue
        letters = "".join(words)
        for r in range(n):
            for c in range(n):
                if not grid[r][c]:
                    grid[r][c] = rng.choice(letters)
        # each word must appear exactly once, in any direction
        def count(w):
            k = 0
            for r in range(n):
                for c in range(n):
                    for dr, dc in ((0, 1), (1, 0), (1, 1), (-1, 1), (0, -1), (-1, 0), (-1, -1), (1, -1)):
                        er, ec = r + dr * (len(w) - 1), c + dc * (len(w) - 1)
                        if 0 <= er < n and 0 <= ec < n and all(grid[r + dr * i][c + dc * i] == w[i] for i in range(len(w))):
                            k += 1
            return k
        if all(count(w) == (2 if w == w[::-1] else 1) for w in words):
            return {"type": "wordsearch", "tier": 3 if hard else 1, "n": n, "theme": theme, "grid": grid,
                    "words": sorted(words), "display": display, "placed": placed, "hard": hard}
    raise RuntimeError(f"wordsearch: could not place {theme}")


# ------------------------------------------------------------------ cryptogram

def cryptogram(text, source, rng, hints=0):
    alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    while True:
        perm = list(alpha)
        rng.shuffle(perm)
        if all(a != b for a, b in zip(alpha, perm)):
            break
    key = dict(zip(alpha, perm))
    plain = text.upper()
    cipher = "".join(key.get(ch, ch) for ch in plain)
    used = sorted({ch for ch in plain if ch in key}, key=lambda ch: -plain.count(ch))
    given = {key[ch]: ch for ch in rng.sample(used[:8], hints)} if hints else {}
    return {"type": "cryptogram", "tier": 1 if hints >= 3 else (2 if hints else 3), "cipher": cipher, "plain": plain,
            "source": source, "given": given}


# ------------------------------------------------------------------ word ladder

# Words kept out of the ladders: crude or unpleasant words, names and places, abbreviations
# and slang, and American spellings (the books use British spelling).
_BLOCK = set("""arse damn dick fags gook hell homo jerk kike piss porn sexy shit slut spic tits turd twat wank whore bitch
 cocks dykes pussy rapes raped nazis negro booty horny bimbo cant coon dago jock paki wops gyps slave suck shag sods tart
 dyke fanny prick bang crap drug bust rape nude butt dope scum lust stud cock anal penis sperm urine idiot moron naked queer
 booze fetus bowel vomit jihad opium gypsy caste obese tumor fatty satan slain
 chile ross ness walt peter mater rick ling mike jack john mark paul dale glen bill will pete nick hank earl blake billy
 sally luke dean dell lynn anna mary york june tony hong eric alan jeff jane josh khan carl emma jake kent kyle brad shaw
 lucy ruth hart marc troy wang chad joey seth yang tory yale beth maya kirk nash mick rand shah dong rita rory tate vera
 carr mack bali otto holt beck watt ford hulk jeep cola coke yuan china trump japan smith frank henry harry lewis jimmy
 kelly dutch roger clark maria larry barry jerry terry laura bobby perry swiss tommy costa welsh nancy ralph colin blair
 singh drake lance lynch betty honda marco randy riley homer jenny burke molly brett kerry walsh donna cyrus allan pablo
 silva pedro chang irene brock brent monte piper stein hogan clive malik paddy willy benny sammy weber hanna patty peggy
 dover ariel bowie dolly jenna chevy clint tibet porto manny nicky ryder cisco patel reese
 yeah dont sept prof nope anti semi corp temp para meta sync blah whoa gosh heck dude fest wont thou unto thee dame papa
 thats didnt wasnt arent whats covid yahoo anime manga remix legit admin micro hyper inter turbo ultra karma daddy mommy
 mummy yummy comfy specs props setup login kappa
 math gray labor color honor favor humor rumor fiber armor vapor arbor liter""".split())


def _ladder_words(length):
    f = HERE / f"words{length}.txt"
    if not f.exists():
        from english_words import get_english_words_set
        from wordfreq import top_n_list
        web2 = {w for w in get_english_words_set(["web2"], alpha=True) if w.islower()}
        words = [w for w in top_n_list("en", 16000) if len(w) == length and w in web2 and w not in _BLOCK]
        f.write_text("\n".join(sorted(words)) + "\n")
    return f.read_text().split()


_ladder_used = set()


def ladder(length, steps, rng):
    """A start and end word joined by changing one letter at a time; `steps`
    is the number of changes in the shortest route."""
    words = words_by_rank(length)[:{4: 950, 5: 1500}[length]]   # everyday words only: rungs should be recognisable
    wset = set(words)
    cache = {}

    def nbrs(w):
        if w not in cache:
            cache[w] = [w[:i] + ch + w[i + 1:] for i in range(length) for ch in "abcdefghijklmnopqrstuvwxyz"
                        if ch != w[i] and w[:i] + ch + w[i + 1:] in wset]
        return cache[w]

    common = words[:500]
    for _ in range(4000):
        a = rng.choice(common)
        if a in _ladder_used:
            continue
        dist, frontier = {a: None}, [a]
        for _d in range(steps):
            nxt = []
            for w in frontier:
                for v in nbrs(w):
                    if v not in dist:
                        dist[v] = w
                        nxt.append(v)
            frontier = nxt
        ends = [w for w in frontier if w in common and w not in _ladder_used and sum(x != y for x, y in zip(a, w)) >= min(length, 3)]
        if ends:
            b = rng.choice(ends)
            path = [b]
            while dist[path[-1]] is not None:
                path.append(dist[path[-1]])
            if _ladder_used & set(path):          # no word appears in two ladders of the same book
                continue
            _ladder_used.update(path)
            return {"type": "ladder", "tier": 1 if steps <= 4 else (2 if steps <= 6 else 3), "start": a.upper(),
                    "end": b.upper(), "steps": steps, "solution": [w.upper() for w in path[::-1]]}
    raise RuntimeError("ladder: none found")


def words_by_rank(length):
    f = HERE / f"words{length}_ranked.txt"
    if not f.exists():
        from wordfreq import top_n_list
        ok = set(_ladder_words(length))
        f.write_text("\n".join(w for w in top_n_list("en", 16000) if w in ok) + "\n")
    return f.read_text().split()


# ------------------------------------------------------------------ logic grid

NAMES = ["Anita", "Bernard", "Carol", "Desmond", "Elaine", "Farid", "Gwen", "Hamish", "Imelda", "Joseph", "Kirsty",
         "Leroy", "Moira", "Nikhil", "Olwen", "Patrick", "Rosa", "Stefan", "Tamsin", "Victor", "Wendy", "Yusuf"]
CATS = {
    "activity": dict(values=["sea swimming", "pottery", "the cello", "fell running", "beekeeping", "life drawing", "rowing",
                             "Spanish", "bell ringing", "fencing", "stone carving", "the saxophone", "kayaking", "tap dancing",
                             "astronomy", "woodturning"],
                     subj="the person who took up {}", pred="took up {}", neg="did not take up {}"),
    "place": dict(values=["Whitby", "Bath", "Dundee", "Ludlow", "Tenby", "Kendal", "Truro", "Buxton", "Oban", "Hexham",
                          "Santa Fe", "Savannah", "Asheville", "Duluth", "Sedona", "Portland"],
                  subj="the person from {}", pred="is from {}", neg="is not from {}"),
    "month": dict(values=["January", "March", "May", "July", "September", "November"],
                  subj="the person who started in {}", pred="started in {}", neg="did not start in {}", ordered="earlier in the year"),
    "age": dict(values=None, subj="the {}-year-old", pred="is {}", neg="is not {}", ordered="younger"),
    "name": dict(subj="{}", pred="is {}", neg="is not {}"),
}


def _logic_once(tier, rng, book="hard"):
    k = 4 if book == "std" else 5                       # people
    cats = ["name", "activity", "place"] + (["age"] if book == "std" and tier > 1 else []) + (["age", "month"] if book == "hard" else [])
    if book == "hard" and tier == 1:
        cats = ["name", "activity", "place", "age"]
    vals = {}
    for c in cats:
        if c == "name":
            vals[c] = sorted(rng.sample(NAMES, k))
        elif c == "age":
            base = rng.randint(50, 58)
            vals[c] = [str(base + i * rng.choice((1, 2, 3))) for i in range(k)]
            vals[c] = [str(v) for v in sorted({int(v) for v in vals[c]})]
            while len(vals[c]) < k:
                vals[c].append(str(int(vals[c][-1]) + 2))
        elif c == "month":
            ms = CATS[c]["values"]
            idx = sorted(rng.sample(range(len(ms)), k))
            vals[c] = [ms[i] for i in idx]
        else:
            vals[c] = rng.sample(CATS[c]["values"], k)
    # truth[c][person] = index into vals[c]; names are the identity
    truth = {c: (list(range(k)) if c == "name" else rng.sample(range(k), k)) for c in cats}
    holder = {c: {truth[c][p]: p for p in range(k)} for c in cats}

    def subj(c, v):
        return CATS[c]["subj"].format(vals[c][v])

    clues = []  # (kind, c1, v1, c2, v2, text)
    pairs = [(a, b) for a in cats for b in cats if a != b]
    for c1, c2 in pairs:
        for v1 in range(k):
            p = holder[c1][v1]
            for v2 in range(k):
                same = holder[c2][v2] == p
                if same and cats.index(c1) < cats.index(c2):
                    clues.append(("is", c1, v1, c2, v2, f"{subj(c1, v1)} {CATS[c2]['pred'].format(vals[c2][v2])}."))
                elif not same:
                    clues.append(("not", c1, v1, c2, v2, f"{subj(c1, v1)} {CATS[c2]['neg'].format(vals[c2][v2])}."))
    for oc in [c for c in cats if CATS[c].get("ordered")]:
        word = CATS[oc]["ordered"]
        for (c1, c2) in pairs:
            if oc in (c1, c2):
                continue
            for v1 in range(k):
                for v2 in range(k):
                    p, q = holder[c1][v1], holder[c2][v2]
                    if p != q and truth[oc][p] < truth[oc][q]:
                        text = (f"{subj(c1, v1)} is younger than {subj(c2, v2)}." if oc == "age"
                                else f"{subj(c1, v1)} started earlier in the year than {subj(c2, v2)}.")
                        clues.append(("lt", c1, v1, c2, v2, text, oc))

    def is_unique(cl):
        m = cp_model.CpModel()
        b = {c: [[m.NewBoolVar(f"{c}{p}{v}") for v in range(k)] for p in range(k)] for c in cats}
        for c in cats:
            for p in range(k):
                m.AddExactlyOne(b[c][p])
            for v in range(k):
                m.AddExactlyOne(b[c][p][v] for p in range(k))
            if c == "name":
                for p in range(k):
                    m.Add(b[c][p][p] == 1)
        for cl_ in cl:
            kind, c1, v1, c2, v2 = cl_[:5]
            for p in range(k):
                if kind == "is":
                    m.Add(b[c1][p][v1] == b[c2][p][v2])
                else:  # "not" and "lt" both say these are different people
                    m.AddBoolOr([b[c1][p][v1].Not(), b[c2][p][v2].Not()])
            if kind == "lt":
                oc = cl_[6]
                for p in range(k):
                    for q in range(k):
                        if p == q:
                            continue
                        for x in range(k):
                            for y in range(k):
                                if not x < y:
                                    m.AddBoolOr([b[c1][p][v1].Not(), b[c2][q][v2].Not(), b[oc][p][x].Not(), b[oc][q][y].Not()])
        return unique(m, [v for c in cats for row in b[c] for v in row])

    # favour indirect clues: few plain "is" statements, more comparisons and negatives
    weight = {"is": 1.2, "not": 1.3, "lt": 1.6} if book == "std" else {"is": .6, "not": .7, "lt": 3}
    pool = sorted(clues, key=lambda cl_: rng.random() / weight[cl_[0]])
    chosen = []
    for cl_ in pool:
        chosen.append(cl_)
        if len(chosen) >= 4 and len(chosen) % 2 == 0 and is_unique(chosen):
            break
    for cl_ in list(chosen):  # drop anything not needed
        trial = [t for t in chosen if t is not cl_]
        if is_unique(trial):
            chosen = trial
    rng.shuffle(chosen)
    texts = [cl_[5][0].upper() + cl_[5][1:] for cl_ in chosen]
    return {"type": "logic", "tier": tier, "cats": cats, "vals": vals, "clues": texts, "raw": [cl_[:5] + cl_[6:] for cl_ in chosen],
            "solution": [[vals[c][truth[c][p]] for c in cats] for p in range(k)]}


def logic(tier, rng, book="hard"):
    """Keep the clue list short enough to print in large type: try several and take a compact one."""
    cap = {"std": 9, "hard": 14}[book]
    best = None
    for _ in range(40):
        p = _logic_once(tier, rng, book)
        if best is None or len(p["clues"]) < len(best["clues"]):
            best = p
        if len(best["clues"]) <= cap:
            break
    return best


# ------------------------------------------------------------------ anagrams

def anagrams(theme, words, rng):
    out = []
    for w in words:
        letters = [ch for ch in w.upper() if ch.isalpha()]
        while True:
            s = letters[:]
            rng.shuffle(s)
            if s != letters:
                break
        out.append(("".join(s), w.upper()))
    return {"type": "anagrams", "tier": 2, "theme": theme, "items": out}

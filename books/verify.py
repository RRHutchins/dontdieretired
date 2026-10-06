"""Independent check of a built book: every printed puzzle is re-read from the
cache, its solution is tested against the printed clues with code that shares
nothing with the generators, and uniqueness is proved again.

    python books/verify.py vol1 hard
"""
import itertools
import math
import pickle
import sys
from pathlib import Path

from ortools.sat.python import cp_model

OUT = Path(__file__).parent / "out"


def count(model, vars_, accept=None):
    """Number of solutions, stopping at 2. Returns (count, search_completed)."""
    found = []

    class CB(cp_model.CpSolverSolutionCallback):
        def __init__(self):
            super().__init__()
            self.seen = 0

        def on_solution_callback(self):
            self.seen += 1
            vals = [self.Value(v) for v in vars_]
            if accept is None or accept(vals):
                found.append(vals)
            if len(found) >= 2 or self.seen > 20000:
                self.StopSearch()

    s = cp_model.CpSolver()
    s.parameters.enumerate_all_solutions = True
    s.parameters.num_workers = 1
    s.parameters.max_time_in_seconds = 60
    cb = CB()
    st = s.Solve(model, cb)
    return len(found), st in (cp_model.OPTIMAL, cp_model.INFEASIBLE) or len(found) >= 2, found


def rows_cols(n, m, lo=1):
    x = [[m.NewIntVar(lo, n, "") for _ in range(n)] for _ in range(n)]
    for i in range(n):
        m.AddAllDifferent(x[i])
        m.AddAllDifferent([x[r][i] for r in range(n)])
    return x


def seen_from(seq):
    best = k = 0
    for v in seq:
        if v > best:
            best, k = v, k + 1
    return k


def check(p):
    t = p["type"]
    m = cp_model.CpModel()
    if t == "sudoku":
        x = [m.NewIntVar(1, 9, "") for _ in range(81)]
        for i in range(9):
            m.AddAllDifferent(x[i * 9:i * 9 + 9])
            m.AddAllDifferent(x[i::9])
            m.AddAllDifferent([x[(i // 3 * 3 + a) * 9 + i % 3 * 3 + b] for a in range(3) for b in range(3)])
        for i, v in enumerate(p["grid"]):
            if v:
                m.Add(x[i] == v)
        n, done, sols = count(m, x)
        return n == 1 and done and sols[0] == list(p["solution"])
    if t == "killer":
        x = [m.NewIntVar(1, 9, "") for _ in range(81)]
        for i in range(9):
            m.AddAllDifferent(x[i * 9:i * 9 + 9])
            m.AddAllDifferent(x[i::9])
            m.AddAllDifferent([x[(i // 3 * 3 + a) * 9 + i % 3 * 3 + b] for a in range(3) for b in range(3)])
        cells = sorted(c for cage in p["cages"] for c in cage)
        assert cells == [(r, c) for r in range(9) for c in range(9)], "cages must cover the grid once"
        for cage, total in zip(p["cages"], p["sums"]):
            vs = [x[r * 9 + c] for r, c in cage]
            if len(vs) > 1:
                m.AddAllDifferent(vs)
            m.Add(sum(vs) == total)
        n, done, sols = count(m, x)
        return n == 1 and done and sols[0] == list(p["solution"])
    if t == "kakuro":
        cells = [tuple(c) for c in p["white"]]
        x = {c: m.NewIntVar(1, 9, "") for c in cells}
        for _h, run, total in p["runs"]:
            m.AddAllDifferent([x[tuple(c)] for c in run])
            m.Add(sum(x[tuple(c)] for c in run) == total)
        n, done, sols = count(m, [x[c] for c in cells])
        return n == 1 and done and sols[0] == [p["solution"][c] for c in cells]
    if t == "futoshiki":
        n_ = p["n"]
        x = rows_cols(n_, m)
        for a, b, c, d in p["ineq"]:
            m.Add(x[a][b] < x[c][d])
        for r, c in p["given"]:
            m.Add(x[r][c] == p["solution"][r][c])
        n, done, sols = count(m, [v for row in x for v in row])
        return n == 1 and done and sols[0] == [v for row in p["solution"] for v in row]
    if t == "calcudoku":
        n_ = p["n"]
        x = rows_cols(n_, m)
        for cage, (op, target) in zip(p["cages"], p["clues"]):
            ok = []
            for tup in itertools.product(range(1, n_ + 1), repeat=len(cage)):
                val = {"": tup[0], "+": sum(tup), "x": math.prod(tup),
                       "-": abs(tup[0] - tup[-1]), "/": max(tup) / min(tup)}[op]
                if val == target:
                    ok.append(tup)
            m.AddAllowedAssignments([x[r][c] for r, c in cage], ok)
        n, done, sols = count(m, [v for row in x for v in row])
        return n == 1 and done and sols[0] == [v for row in p["solution"] for v in row]
    if t == "skyscrapers":
        n_ = p["n"]
        x = rows_cols(n_, m)
        for r, c in p["given"]:
            m.Add(x[r][c] == p["solution"][r][c])
        flat = [v for row in x for v in row]

        def ok(vals):
            g = [vals[i * n_:(i + 1) * n_] for i in range(n_)]
            for (side, i), v in p["clues"].items():
                line = g[i] if side in "LR" else [g[r][i] for r in range(n_)]
                if side in "RB":
                    line = line[::-1]
                if seen_from(line) != v:
                    return False
            return True
        # filter Latin squares by the clues; fine for n <= 6 only with givens, so add clue tables instead
        perms = list(itertools.permutations(range(1, n_ + 1)))
        for i in range(n_):
            for line, a, b in ((x[i], ("L", i), ("R", i)), ([x[r][i] for r in range(n_)], ("T", i), ("B", i))):
                ca, cb_ = p["clues"].get(a), p["clues"].get(b)
                if ca or cb_:
                    m.AddAllowedAssignments(line, [q for q in perms if (not ca or seen_from(q) == ca) and (not cb_ or seen_from(q[::-1]) == cb_)])
        n, done, sols = count(m, flat, ok)
        return n == 1 and done and sols[0] == [v for row in p["solution"] for v in row]
    if t == "binary":
        n_ = p["n"]
        x = [[m.NewBoolVar("") for _ in range(n_)] for _ in range(n_)]
        lines = x + [[x[r][c] for r in range(n_)] for c in range(n_)]
        for ln in lines:
            m.Add(sum(ln) == n_ // 2)
            for i in range(n_ - 2):
                m.AddLinearConstraint(sum(ln[i:i + 3]), 1, 2)
        for r, c in p["given"]:
            m.Add(x[r][c] == p["solution"][r][c])

        def ok(vals):
            g = [tuple(vals[i * n_:(i + 1) * n_]) for i in range(n_)]
            cols = list(zip(*g))
            return len(set(g)) == n_ and len(set(cols)) == n_
        n, done, sols = count(m, [v for row in x for v in row], ok)
        return n == 1 and done and sols[0] == [v for row in p["solution"] for v in row]
    if t == "nonogram":
        n_ = p["n"]
        x = [[m.NewBoolVar("") for _ in range(n_)] for _ in range(n_)]

        def line(vars_, clue):
            # position-based encoding (different from the generator's automaton)
            blocks = [b for b in clue if b]
            starts = [m.NewIntVar(0, n_ - b, "") for b in blocks]
            for i in range(len(blocks) - 1):
                m.Add(starts[i + 1] >= starts[i] + blocks[i] + 1)
            for pos, v in enumerate(vars_):
                covers = []
                for s_, b in zip(starts, blocks):
                    lit = m.NewBoolVar("")
                    lo = m.NewBoolVar(""); hi = m.NewBoolVar("")
                    m.Add(s_ <= pos).OnlyEnforceIf(lo); m.Add(s_ > pos).OnlyEnforceIf(lo.Not())
                    m.Add(s_ + b > pos).OnlyEnforceIf(hi); m.Add(s_ + b <= pos).OnlyEnforceIf(hi.Not())
                    m.AddBoolAnd([lo, hi]).OnlyEnforceIf(lit); m.AddBoolOr([lo.Not(), hi.Not()]).OnlyEnforceIf(lit.Not())
                    covers.append(lit)
                m.Add(sum(covers) == v)
        for r in range(n_):
            line(x[r], p["rows"][r])
        for c in range(n_):
            line([x[r][c] for r in range(n_)], p["cols"][c])
        flat = [v for row in x for v in row]
        seen = set()

        def ok(vals):          # several start-variable settings cannot give the same picture, but dedupe anyway
            key = tuple(vals)
            if key in seen:
                return False
            seen.add(key)
            return True
        n, done, sols = count(m, flat, ok)
        return n == 1 and done and sols[0] == [v for row in p["solution"] for v in row]
    if t == "bridges":
        isl = [tuple(i) for i in p["islands"]]
        iset = set(isl)
        n_ = p["n"]
        edges = []
        for (r, c) in isl:
            for dr, dc in ((0, 1), (1, 0)):
                k = 1
                while r + dr * k < n_ and c + dc * k < n_:
                    q = (r + dr * k, c + dc * k)
                    if q in iset:
                        edges.append(((r, c), q))
                        break
                    k += 1
        x = [m.NewIntVar(0, 2, "") for _ in edges]
        for i, v in zip(isl, p["clues"]):
            m.Add(sum(x[k] for k, e in enumerate(edges) if i in e) == v)

        def between(e):
            (r1, c1), (r2, c2) = e
            return {(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)} - set(e)
        for (i, e), (j, f) in itertools.combinations(enumerate(edges), 2):
            if between(e) & between(f):
                a, b = m.NewBoolVar(""), m.NewBoolVar("")
                m.Add(x[i] == 0).OnlyEnforceIf(a.Not()); m.Add(x[j] == 0).OnlyEnforceIf(b.Not())
                m.AddBoolOr([a.Not(), b.Not()])

        def ok(vals):
            adj = {i: set() for i in isl}
            for v, (a, b) in zip(vals, edges):
                if v:
                    adj[a].add(b); adj[b].add(a)
            seen, todo = set(), [isl[0]]
            while todo:
                q = todo.pop()
                if q not in seen:
                    seen.add(q); todo += adj[q]
            return len(seen) == len(isl)
        n, done, sols = count(m, x, ok)
        want = {(tuple(a), tuple(b)): v for a, b, v in p["solution"]}
        return n == 1 and done and {e: v for e, v in zip(edges, sols[0]) if v} == want
    if t == "wordsearch":
        g, n_ = p["grid"], p["n"]
        for w in p["words"]:
            hits = 0
            for r in range(n_):
                for c in range(n_):
                    for dr, dc in itertools.product((-1, 0, 1), repeat=2):
                        if (dr, dc) == (0, 0):
                            continue
                        er, ec = r + dr * (len(w) - 1), c + dc * (len(w) - 1)
                        if 0 <= er < n_ and 0 <= ec < n_ and all(g[r + dr * i][c + dc * i] == w[i] for i in range(len(w))):
                            hits += 1
            if hits != (2 if w == w[::-1] else 1):
                return False
            r, c, dr, dc = p["placed"][w]
            if any(g[r + dr * i][c + dc * i] != w[i] for i in range(len(w))):
                return False
            if not p["hard"] and (dr, dc) not in ((0, 1), (1, 0), (1, 1), (-1, 1)):
                return False
        return True
    if t == "cryptogram":
        fwd, back = {}, {}
        for a, b in zip(p["plain"], p["cipher"]):
            if a.isalpha():
                if fwd.setdefault(a, b) != b or back.setdefault(b, a) != a or a == b:
                    return False
            elif a != b:
                return False
        return all(back[k] == v for k, v in p["given"].items())
    if t == "ladder":
        words = set((Path(__file__).parent / "words4.txt").read_text().split()) | set((Path(__file__).parent / "words5.txt").read_text().split())
        for item in p["items"]:
            sol = [w.lower() for w in item["solution"]]
            if len(sol) != item["steps"] + 1 or any(w not in words for w in sol):
                return False
            if any(sum(a != b for a, b in zip(u, v)) != 1 for u, v in zip(sol, sol[1:])):
                return False
        return True
    if t == "anagrams":
        return all(sorted(s) == sorted(ch for ch in a if ch.isalpha()) and s != a for s, a in p["items"])
    if t == "logic":
        # brute force, category by category, with no solver: count assignments that satisfy every clue
        cats, k = p["cats"], len(p["solution"])
        order = {c: {v: i for i, v in enumerate(p["vals"][c])} for c in cats}
        rest = [c for c in cats if c != "name"]
        found = []

        def holds(assign):
            # assign[c][person] = value index; a clue is tested once every category it mentions is assigned
            for kind, c1, v1, c2, v2, *oc in p["raw"]:
                need = {c1, c2} | set(oc)
                if not need <= set(assign):
                    continue
                a = assign[c1].index(v1)
                b = assign[c2].index(v2)
                if kind == "is" and a != b:
                    return False
                if kind == "not" and a == b:
                    return False
                if kind == "lt" and not (a != b and assign[oc[0]][a] < assign[oc[0]][b]):
                    return False
            return True

        def go(i, assign):
            if len(found) > 1:
                return
            if i == len(rest):
                found.append({c: list(v) for c, v in assign.items()})
                return
            for perm in itertools.permutations(range(k)):
                assign[rest[i]] = list(perm)
                if holds(assign):
                    go(i + 1, assign)
                del assign[rest[i]]
        go(0, {"name": list(range(k))})
        if len(found) != 1:
            return False
        got = [[p["vals"][c][found[0][c][person]] for c in cats] for person in range(k)]
        if got != p["solution"]:
            return False
        # and the printed sentence for each clue must name the same values as the tested clue
        for text, (kind, c1, v1, c2, v2, *oc) in zip(p["clues"], p["raw"]):
            if p["vals"][c1][v1].lower() not in text.lower() or p["vals"][c2][v2].lower() not in text.lower():
                return False
            if (kind == "not") != (" not " in text) or (kind == "lt") != any(w in text for w in p["lt_words"]):
                return False
        return True
    if t == "tents":
        n_ = p["n"]
        trees = [tuple(q) for q in p["trees"]]
        gifts = {tuple(q) for q in p["solution"]}
        side = ((0, 1), (1, 0), (0, -1), (-1, 0))
        x = {(r, c): m.NewBoolVar("") for r in range(n_) for c in range(n_) if (r, c) not in trees}
        # pairing as a flow: pair[t][q] says tree t owns the present at q
        pair = {}
        for t_ in trees:
            for dr, dc in side:
                q = (t_[0] + dr, t_[1] + dc)
                if q in x:
                    pair[(t_, q)] = m.NewBoolVar("")
        for t_ in trees:
            m.Add(sum(v for (a, q), v in pair.items() if a == t_) == 1)
        for q in x:
            m.Add(sum(v for (a, qq), v in pair.items() if qq == q) == x[q])
        for (r, c) in x:
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    q = (r + dr, c + dc)
                    if q in x and q > (r, c):
                        m.Add(x[(r, c)] + x[q] <= 1)
        for i in range(n_):
            m.Add(sum(x[(i, c)] for c in range(n_) if (i, c) in x) == p["rows"][i])
            m.Add(sum(x[(r, i)] for r in range(n_) if (r, i) in x) == p["cols"][i])
        order = sorted(x)
        seen = set()

        def ok(vals):
            key = tuple(vals)
            if key in seen:
                return False
            seen.add(key)
            return True
        n, done, sols = count(m, [x[q] for q in order], ok)
        return n == 1 and done and {q for q, v in zip(order, sols[0]) if v} == gifts
    if t == "starbattle":
        n_ = p["n"]
        reg = p["region"]
        # every region must be one connected piece
        for g in range(n_):
            cells = {(r, c) for r in range(n_) for c in range(n_) if reg[r][c] == g}
            if not cells:
                return False
            seen, todo = set(), [next(iter(cells))]
            while todo:
                q = todo.pop()
                if q in seen:
                    continue
                seen.add(q)
                todo += [(q[0] + dr, q[1] + dc) for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0)) if (q[0] + dr, q[1] + dc) in cells]
            if seen != cells:
                return False
        x = [[m.NewBoolVar("") for _ in range(n_)] for _ in range(n_)]
        for i in range(n_):
            m.Add(sum(x[i]) == 1)
            m.Add(sum(x[r][i] for r in range(n_)) == 1)
            m.Add(sum(x[r][c] for r in range(n_) for c in range(n_) if reg[r][c] == i) == 1)
        for r in range(n_):
            for c in range(n_):
                for dr, dc in ((0, 1), (1, -1), (1, 0), (1, 1)):
                    if 0 <= r + dr < n_ and 0 <= c + dc < n_:
                        m.Add(x[r][c] + x[r + dr][c + dc] <= 1)
        n, done, sols = count(m, [v for row in x for v in row])
        got = {(i // n_, i % n_) for i, v in enumerate(sols[0]) if v} if sols else set()
        return n == 1 and done and got == {tuple(q) for q in p["solution"]}
    if t == "novowels":
        for short, full in p["items"]:
            want = " ".join(("".join(ch for ch in w if ch not in "AEIOU") or "\u2013") if any(ch not in "AEIOU-'" for ch in w) else "\u2013" for w in full.split())
            if short != want or not any(ch in "AEIOU" for ch in full):
                return False
        return True
    raise ValueError(t)


if __name__ == "__main__":
    bad = 0
    for bid in sys.argv[1:]:
        ps = pickle.loads((OUT / f"{bid}.puzzles.pkl").read_bytes())
        tally = {}
        for p in ps:
            res = check(p)
            k = p["type"]
            tally.setdefault(k, [0, 0, 0])
            tally[k][0 if res else (2 if res is None else 1)] += 1
            if res is False:
                bad += 1
                print(f"  FAILED: {bid} puzzle {p['no']} ({k})")
        print(bid, {k: (f"{v[0]} ok" if not v[1] and not v[2] else (f"{v[2]} not re-checked" if v[2] else f"{v[0]} ok, {v[1]} FAILED")) for k, v in tally.items()})
    sys.exit(1 if bad else 0)

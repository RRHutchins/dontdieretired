#!/usr/bin/env python3
"""Make the three extra daily puzzles (RUNBOOK §6g): a word ladder, a sudoku and a numbers target,
each at three levels: g (gentle), s (steady), h (hard).

    python tools/build_daily.py                 # fill every date in puzzle_days.json that has none yet
    python tools/build_daily.py --check         # re-prove every stored puzzle with separate code

Writes content/puzzle_extra.json: {date: {"ladder": {...}, "sudoku": {...}, "numbers": {...}}}.
Standard library only. Seeded by date, so a date always gives the same puzzles. Dates already in the
file are never changed (people may be part-way through them).

What each level means
  ladder   g: four-letter words, 3 changes   s: four-letter words, 5 changes   h: five letters and 5 changes, or four letters and 7, on alternate days
           The rungs of our own answer are everyday words; the reader may use any word in the word list.
  sudoku   g: 6x6, singles only              s: 9x9, singles only              h: 9x9, needs pairs or locked candidates
           Every grid is proved to have exactly one solution, and graded by the techniques a person needs.
  numbers  g: 4 numbers, 2 sums at least     s: 5 numbers, 3 sums at least     h: 6 numbers, 4 sums at least
           "At least" is proved: no shorter way reaches the target.
"""
import argparse, datetime as dt, itertools, json, pathlib, random, sys
from multiprocessing import Pool

ROOT = pathlib.Path(__file__).resolve().parent.parent
DAYS = ROOT / "content" / "puzzle_days.json"
OUT = ROOT / "content" / "puzzle_extra.json"
sys.path.insert(0, str(ROOT / "tools"))
from build_puzzles import load_words   # SCOWL list minus our blocklist

# ------------------------------------------------------------------ word ladder
_BOOK_BLOCK = None


def _book_block():
    """The puzzle books keep their own list of crude words and names (books/puzzles.py, _BLOCK). Read it as text
    so this script does not need the books' dependencies."""
    global _BOOK_BLOCK
    if _BOOK_BLOCK is None:
        src = (ROOT / "books" / "puzzles.py").read_text(encoding="utf-8")
        body = src.split('_BLOCK = set("""', 1)[1].split('"""', 1)[0]
        _BOOK_BLOCK = set(body.split())
    return _BOOK_BLOCK


def accept_words(length):
    """Every word a reader may use as a rung."""
    return sorted(w for w in load_words() if len(w) == length and w not in _book_block())


def everyday_words(length):
    """Words our own answer may use: frequent, in the main word list, not blocked. Most frequent first."""
    ranked = (ROOT / "books" / f"words{length}_ranked.txt").read_text(encoding="utf-8").split()
    ok = set(accept_words(length))
    return [w for w in ranked if w in ok][:{4: 900, 5: 1300}[length]]


def _graph(words):
    wset = set(words)
    return {w: [w[:i] + ch + w[i + 1:] for i in range(len(w)) for ch in "abcdefghijklmnopqrstuvwxyz"
                if ch != w[i] and w[:i] + ch + w[i + 1:] in wset] for w in words}


def shortest(graph, a, b, limit=9):
    prev, frontier = {a: None}, [a]
    for _ in range(limit):
        nxt = []
        for w in frontier:
            for v in graph.get(w, ()):
                if v not in prev:
                    prev[v] = w; nxt.append(v)
        frontier = nxt
        if b in prev:
            path = [b]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])
            return path[::-1]
    return None


_LAD = {}


SPEC = {"g": [(4, 3)], "s": [(4, 5)], "h": [(5, 5), (4, 7)]}   # hard alternates: five-letter words, or a long four-letter climb


def make_ladder(level, rng, avoid, old_steps=frozenset(), which=0):
    length, steps = SPEC[level][which % len(SPEC[level])]
    if length not in _LAD:
        ev = everyday_words(length)
        _LAD[length] = (ev, _graph(ev), _graph(accept_words(length)))
    ev, g_ev, g_all = _LAD[length]
    common = ev[:450]
    for _ in range(1500):
        a = rng.choice(common)
        if a in avoid:
            continue
        dist, frontier = {a: None}, [a]
        for _d in range(steps):
            nxt = []
            for w in frontier:
                for v in g_ev[w]:
                    if v not in dist:
                        dist[v] = w; nxt.append(v)
            frontier = nxt
        ends = [w for w in frontier if w in common and w not in avoid and sum(x != y for x, y in zip(a, w)) >= 3]
        rng.shuffle(ends)
        for b in ends:
            # the reader may use the whole word list, so the number of changes must be the shortest there too
            if len(shortest(g_all, a, b) or []) - 1 != steps:
                continue
            path = [b]
            while dist[path[-1]] is not None:
                path.append(dist[path[-1]])
            path = path[::-1]
            if sum(1 for e in zip(path, path[1:]) if frozenset(e) in old_steps) > 1:
                continue                                    # too much of this route was used in the last few weeks
            return path
    raise RuntimeError("ladder: none found")


def check_ladder(level, path):
    length, steps = len(path[0]), len(path) - 1
    assert (length, steps) in SPEC[level], (level, path)
    ok = set(accept_words(length))
    assert len(path) == steps + 1 and all(w in ok for w in path), path
    assert all(sum(x != y for x, y in zip(p, q)) == 1 for p, q in zip(path, path[1:])), path
    if length not in _LAD:
        ev = everyday_words(length); _LAD[length] = (ev, _graph(ev), _graph(accept_words(length)))
    assert len(shortest(_LAD[length][2], path[0], path[-1])) - 1 == steps, ("a shorter ladder exists", path)


# ------------------------------------------------------------------ sudoku (6x6 and 9x9)
class Geo:
    def __init__(self, n):
        self.n = n
        br, bc = (2, 3) if n == 6 else (3, 3)
        self.units = [[r * n + c for c in range(n)] for r in range(n)] + [[r * n + c for r in range(n)] for c in range(n)]
        for b0 in range(0, n, br):
            for b1 in range(0, n, bc):
                self.units.append([(b0 + i) * n + b1 + j for i in range(br) for j in range(bc)])
        self.peers = [sorted({j for u in self.units if i in u for j in u} - {i}) for i in range(n * n)]


GEO = {6: Geo(6), 9: Geo(9)}


def sud_count(n, grid, limit=2):
    G, g, count = GEO[n], list(grid), 0

    def go():
        nonlocal count
        best, bc = -1, None
        for i in range(n * n):
            if g[i] == 0:
                used = {g[j] for j in G.peers[i]}
                c = [v for v in range(1, n + 1) if v not in used]
                if not c:
                    return
                if bc is None or len(c) < len(bc):
                    best, bc = i, c
                    if len(c) == 1:
                        break
        if best < 0:
            count += 1; return
        for v in bc:
            g[best] = v
            go()
            if count >= limit:
                break
        g[best] = 0
    go()
    return count


def sud_full(n, rng):
    G, g = GEO[n], [0] * (n * n)

    def go(i):
        if i == n * n:
            return True
        used = {g[j] for j in G.peers[i]}
        vals = [v for v in range(1, n + 1) if v not in used]
        rng.shuffle(vals)
        for v in vals:
            g[i] = v
            if go(i + 1):
                return True
        g[i] = 0
        return False
    go(0)
    return g


def sud_grade(n, grid):
    """Hardest technique a person needs: 1 singles; 2 locked candidates and pairs; 3 anything beyond."""
    G, g = GEO[n], list(grid)
    cand = [set(range(1, n + 1)) if g[i] == 0 else set() for i in range(n * n)]
    for i in range(n * n):
        if g[i]:
            for j in G.peers[i]:
                cand[j].discard(g[i])
    level = 1

    def place(i, v):
        g[i] = v; cand[i] = set()
        for j in G.peers[i]:
            cand[j].discard(v)

    def singles():
        for i in range(n * n):
            if g[i] == 0 and len(cand[i]) == 1:
                place(i, next(iter(cand[i]))); return True
        for u in G.units:
            for v in range(1, n + 1):
                spots = [i for i in u if g[i] == 0 and v in cand[i]]
                if len(spots) == 1:
                    place(spots[0], v); return True
        return False

    def locked():
        ch = False
        for u in G.units:
            for v in range(1, n + 1):
                spots = [i for i in u if v in cand[i]]
                if 2 <= len(spots) <= 3:
                    for w in G.units:
                        if w is not u and all(i in w for i in spots):
                            for j in w:
                                if j not in spots and v in cand[j]:
                                    cand[j].discard(v); ch = True
        return ch

    def pairs():
        ch = False
        for u in G.units:
            cells = [i for i in u if g[i] == 0]
            for combo in itertools.combinations(cells, 2):
                vals = cand[combo[0]] | cand[combo[1]]
                if len(vals) == 2:
                    for j in cells:
                        if j not in combo and cand[j] & vals:
                            cand[j] -= vals; ch = True
            vs = sorted(set().union(*(cand[i] for i in cells))) if cells else []
            for combo in itertools.combinations(vs, 2):
                spots = [i for i in cells if cand[i] & set(combo)]
                if len(spots) == 2:
                    for i in spots:
                        if cand[i] - set(combo):
                            cand[i] &= set(combo); ch = True
        return ch

    while 0 in g:
        if singles():
            continue
        if locked() or pairs():
            level = 2; continue
        return 3
    return level


def make_sudoku(level, rng):
    n, want, floor = {"g": (6, 1, 14), "s": (9, 1, 33), "h": (9, 2, 0)}[level]
    N = n * n
    for _ in range(4000):
        sol = sud_full(n, rng)
        g = list(sol)
        order = list(range((N + 1) // 2)); rng.shuffle(order)
        for i in order:
            j = N - 1 - i
            if sum(1 for v in g if v) <= floor:
                break
            keep = (g[i], g[j]); g[i] = g[j] = 0
            if sud_count(n, g) != 1 or sud_grade(n, g) > want:
                g[i], g[j] = keep
        if sud_grade(n, g) == want and sud_count(n, g) == 1:
            return ["".join(map(str, g)), "".join(map(str, sol))]
    raise RuntimeError("sudoku: none at the level asked for")


def check_sudoku(level, pair):
    """Separate from the generator: a plain exhaustive search that stops at two solutions."""
    n = 6 if level == "g" else 9
    puz, sol = [list(map(int, s)) for s in pair]
    G = GEO[n]
    assert len(puz) == len(sol) == n * n and all(p in (0, s) for p, s in zip(puz, sol))
    assert all(sorted(sol[i] for i in u) == list(range(1, n + 1)) for u in G.units), "solution breaks a rule"
    found = []

    def go(g):
        if len(found) > 1:
            return
        try:
            i = g.index(0)
        except ValueError:
            found.append(list(g)); return
        used = {g[j] for j in G.peers[i]}
        for v in range(1, n + 1):
            if v not in used:
                g[i] = v; go(g); g[i] = 0
    # order the search by the most constrained cell first, or 9x9 takes far too long
    def go2(g):
        if len(found) > 1:
            return
        best, bc = -1, None
        for i in range(n * n):
            if g[i] == 0:
                c = [v for v in range(1, n + 1) if v not in {g[j] for j in G.peers[i]}]
                if bc is None or len(c) < len(bc):
                    best, bc = i, c
        if best < 0:
            found.append(list(g)); return
        for v in bc:
            g[best] = v; go2(g); g[best] = 0
    go2(list(puz))
    assert len(found) == 1 and found[0] == sol, "not exactly one solution"
    assert sud_grade(n, puz) == (2 if level == "h" else 1), "wrong difficulty"


# ------------------------------------------------------------------ numbers target
OPS = "+-x/"


def _apply(a, b, op):
    """Whole, positive results only; a >= b. None if the sum is not allowed or is pointless."""
    if op == "+":
        return a + b
    if op == "-":
        return a - b if a - b > 0 and a - b != b else None      # no zero, and a-b=b just gives b back
    if op == "x":
        return a * b if b != 1 else None
    if op == "/":
        return a // b if b != 1 and a % b == 0 and a // b != b else None


def reachable(nums, max_ops):
    """{value: fewest sums needed} for everything that can be made with at most max_ops sums."""
    best = {v: 0 for v in nums}
    seen = set()

    def go(state, used):
        if used == max_ops:
            return
        for i in range(len(state)):
            for j in range(len(state)):
                if i == j or state[i] < state[j] or (state[i] == state[j] and i > j):
                    continue
                rest = [state[k] for k in range(len(state)) if k not in (i, j)]
                for op in OPS:
                    r = _apply(state[i], state[j], op)
                    if r is None:
                        continue
                    if best.get(r, 99) > used + 1:
                        best[r] = used + 1
                    nxt = tuple(sorted(rest + [r]))
                    key = (nxt, used + 1)
                    if key not in seen and len(nxt) > 1:
                        seen.add(key); go(nxt, used + 1)
    go(tuple(sorted(nums)), 0)
    return best


def _random_way(nums, ops, rng):
    """Do `ops` random allowed sums; return (result, steps) with the result being the last number made."""
    state, steps, last = list(nums), [], None
    for _ in range(ops):
        for _try in range(40):
            i, j = rng.sample(range(len(state)), 2)
            a, b = max(state[i], state[j]), min(state[i], state[j])
            if last is not None and len(steps) >= 2 and last not in (state[i], state[j]) and rng.random() < .6:
                continue                                   # mostly keep building on what we just made
            op = rng.choice("++-xx/")
            r = _apply(a, b, op)
            if r is None or r > 3000:
                continue
            state = [state[k] for k in range(len(state)) if k not in (i, j)] + [r]
            steps.append(f"{a} {op} {b} = {r}"); last = r
            break
        else:
            return None, None
    return last, steps


SMALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]


def make_numbers(level, rng):
    count, large, need, lo, hi = {"g": (4, 0, 2, 12, 99), "s": (5, 1, 3, 101, 400), "h": (6, 2, 4, 201, 999)}[level]
    for _ in range(20000):
        nums = rng.sample([25, 50, 75, 100], large) + rng.sample(SMALL + SMALL[1:], count - large)
        if level == "g" and rng.random() < .35:
            nums[0] = rng.choice([15, 20, 25])
        if len(set(nums)) < count - 1:
            continue
        target, steps = _random_way(nums, need + (1 if level == "h" and rng.random() < .4 else 0), rng)
        if target is None or not lo <= target <= hi or target in nums or target % 100 == 0:
            continue
        if not all(s.split(" = ")[1] != s.split()[0] for s in steps):
            continue
        fewest = reachable(nums, need - 1).get(target)          # can it be done in fewer sums? then it is too easy
        if fewest is not None:
            continue
        return {"n": sorted(nums, reverse=True), "t": target, "w": steps}
    raise RuntimeError("numbers: none found")


def check_numbers(level, p):
    count, _l, need, lo, hi = {"g": (4, 0, 2, 12, 99), "s": (5, 1, 3, 101, 400), "h": (6, 2, 4, 201, 999)}[level]
    tiles = list(p["n"]); assert len(tiles) == count and lo <= p["t"] <= hi
    last = None
    for s in p["w"]:                                             # replay our own answer with the tiles
        a, op, b, _eq, r = s.split(); a, b, r = int(a), int(b), int(r)
        tiles.remove(a); tiles.remove(b)
        assert {"+": a + b, "-": a - b, "x": a * b, "/": a // b if a % b == 0 else -1}[op] == r and r > 0, s
        tiles.append(r); last = r
    assert last == p["t"], "our answer does not reach the target"
    assert reachable(p["n"], need - 1).get(p["t"]) is None, "can be done in fewer sums than the level says"


# ------------------------------------------------------------------ putting days together
RECENT = 45   # days over which a ladder's end words are not reused, and its steps mostly not


def make_ladders(dates, have):
    """Ladders are made in date order so each can steer clear of the ones just before it."""
    out = {}
    hist = {lv: [] for lv in "gsh"}                       # (date, path)
    for d in sorted(have):
        for lv in "gsh":
            hist[lv].append((d, have[d]["ladder"][lv]))
    for d in sorted(dates):
        rng = random.Random("ddr-ladder-" + d)
        day, today_words = {}, set()
        cut = (dt.date.fromisoformat(d) - dt.timedelta(days=RECENT)).isoformat()
        for lv in "gsh":
            recent = [p for (dd, p) in hist[lv] if cut <= dd < d]
            ends = {w for p in recent for w in (p[0], p[-1])} | today_words
            steps = frozenset(frozenset(e) for p in recent for e in zip(p, p[1:]))
            last_week = {w for (dd, p) in hist[lv][-7:] for w in (p[0], p[-1])} | today_words
            for avoid, old in ((ends, steps), (ends, frozenset()), (last_week, steps), (last_week, frozenset()), (today_words, frozenset())):
                try:                                       # five-letter everyday words are few: relax step by step
                    day[lv] = make_ladder(lv, rng, avoid, old, dt.date.fromisoformat(d).toordinal()); break
                except RuntimeError:
                    continue
            today_words.update(day[lv]); hist[lv].append((d, day[lv]))
        out[d] = day
    return out


def make_rest(d):
    rng = random.Random("ddr-daily-" + d)
    return d, {"sudoku": {lv: make_sudoku(lv, rng) for lv in "gsh"}, "numbers": {lv: make_numbers(lv, rng) for lv in "gsh"}}


def check_day(item):
    d, day = item
    for lv in "gsh":
        check_ladder(lv, day["ladder"][lv]); check_sudoku(lv, day["sudoku"][lv]); check_numbers(lv, day["numbers"][lv])
    return d


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--check", action="store_true"); ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    have = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    if a.check:
        with Pool() as pool:
            n = sum(1 for _ in pool.imap_unordered(check_day, sorted(have.items()), chunksize=8))
        print(f"checked {n} days, {n * 9} puzzles: every ladder is a shortest route, every sudoku has exactly one solution at its level, every numbers target needs the sums its level says")
        sys.exit(0)
    todo = [d for d in sorted(json.loads(DAYS.read_text(encoding="utf-8"))) if d not in have][: a.limit]
    ladders = make_ladders(todo, have)
    with Pool() as pool:
        for k, (d, day) in enumerate(pool.imap(make_rest, todo, chunksize=4), 1):
            have[d] = {"ladder": ladders[d], **day}
            if k % 80 == 0:
                print(k, "of", len(todo), flush=True)
    OUT.write_text(json.dumps(dict(sorted(have.items())), separators=(",", ":")), encoding="utf-8")
    print(f"{len(todo)} days added; {len(have)} in all, {min(have)} to {max(have)}")

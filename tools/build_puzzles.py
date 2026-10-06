#!/usr/bin/env python3
"""Choose the nine-letter word for each day of the Daily Wheel (RUNBOOK §6g).

    python tools/build_puzzles.py --start 2026-10-07 --days 430     # first run / full rebuild
    python tools/build_puzzles.py --extend 365                      # add days after the last one, keep the rest

Writes content/puzzle_days.json: {date: [nine-letter word, centre letter]}. The answers themselves are
worked out by build.py from tools/wordlist/words.txt each time the site is built, so the word list is the
single source of truth. Days already in the file are never changed (people may be mid-streak).

Needs `pip install wordfreq`, used only to prefer everyday nine-letter words. Nothing from wordfreq is stored.
"""
import argparse, datetime as dt, json, pathlib, random, re
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
WL = ROOT / "tools" / "wordlist"
OUT = ROOT / "content" / "puzzle_days.json"
MIN_ANS, MAX_ANS, IDEAL = 18, 70, 34


def load_words():
    words = [w for w in (WL / "words.txt").read_text(encoding="utf-8").split() if w]
    exact, sub = set(), []
    for line in (WL / "blocklist.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        (sub.append(line[1:]) if line.startswith("~") else exact.add(line))
    ok = [w for w in words if w not in exact and not any(s in w for s in sub)]
    return ok


def answers(word, centre, words_by_len_counter):
    need = Counter(word)
    return [w for w, c in words_by_len_counter if centre in c and all(c[ch] <= need[ch] for ch in c)]


def pick_centre(word, wc):
    best = None
    for ch in sorted(set(word)):
        n = len(answers(word, ch, wc))
        if MIN_ANS <= n <= MAX_ANS and (best is None or abs(n - IDEAL) < abs(best[1] - IDEAL)):
            best = (ch, n)
    return best


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start"); ap.add_argument("--days", type=int, default=430); ap.add_argument("--extend", type=int)
    a = ap.parse_args()
    from wordfreq import zipf_frequency
    words = load_words()
    wc = [(w, Counter(w)) for w in words]
    days = json.loads(OUT.read_text()) if OUT.exists() else {}
    used = {v[0] for v in days.values()}
    if a.extend:
        start = max(dt.date.fromisoformat(d) for d in days) + dt.timedelta(days=1); n = a.extend
    else:
        start = dt.date.fromisoformat(a.start); n = a.days
    # everyday nine-letter words, most familiar first; skip plain plurals and -ing/-ed runs to keep variety
    nine = [w for w in words if len(w) == 9 and w not in used and zipf_frequency(w, "en") >= 3.7]
    nine = [w for w in nine if not re.search(r"(s|ed|ly)$", w) or zipf_frequency(w, "en") >= 4.3]
    rnd = random.Random(20261007 + len(days))
    rnd.shuffle(nine)
    d, made = start, 0
    for w in nine:
        if made >= n:
            break
        if d.isoformat() in days:
            d += dt.timedelta(days=1); continue
        c = pick_centre(w, wc)
        if not c:
            continue
        days[d.isoformat()] = [w, c[0]]
        d += dt.timedelta(days=1); made += 1
    OUT.write_text(json.dumps(dict(sorted(days.items())), separators=(",", ":")), encoding="utf-8")
    print(f"{made} days added; {len(days)} days in all, {min(days)} to {max(days)}")

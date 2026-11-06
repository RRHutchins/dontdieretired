#!/usr/bin/env python3
"""The guidance engine (RUNBOOK §6r): a growing, sourced library of training guidance that plans are built from.

  python3 tools/engine.py check                 validate everything, rank it, write engine/REPORT.md
  python3 tools/engine.py plan <event> [--weeks N] [--level starter|active|advanced]
                                                write engine/plans/<event>-<level>-<N>w.md

How guidance is ranked
  Each source has a tier (5 official health body or international consensus, 4 peer-reviewed review or large study,
  3 governing body or route authority, 2 recognised coach or elite athlete via a reputable publisher, 1 general).
  A statement's weight = the sum of the best tier from each independent group that supports it (sources in the
  same `group` count once). Sources listed under `against` are weighed the same way.
  Status:
    core       weight >= 6, or a tier-5/tier-4 source with nothing against it   -> used in plans
    supported  weight >= 3                                                       -> used in plans, cited
    thin       weight < 3                                                        -> not used until better sources are found
    contested  weight against >= weight for                                     -> not used; resolve it first
  A plan only ever uses core and supported statements, and cites them.
"""
import argparse, datetime as dt, math, pathlib, re, sys
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
E = ROOT / "engine"
KINDS = {"all", "endurance", "running", "walking", "hill", "multiday", "altitude", "cycling", "swimming"}


def load():
    src = {s["id"]: s for s in yaml.safe_load((E / "sources.yaml").read_text(encoding="utf-8"))["sources"]}
    gd = yaml.safe_load((E / "guidance.yaml").read_text(encoding="utf-8"))["guidance"]
    ev = {p.stem: yaml.safe_load(p.read_text(encoding="utf-8")) for p in sorted((E / "events").glob("*.yaml"))}
    return src, gd, ev


def weigh(ids, src):
    best = {}
    for i in ids or []:
        s = src[i]; g = s.get("group", i)
        best[g] = max(best.get(g, 0), s["tier"])
    return sum(best.values()), (max(best.values()) if best else 0), len(best)


def rank(src, gd):
    for g in gd:
        g["weight"], g["top"], g["groups"] = weigh(g.get("for"), src)
        g["against_weight"], _, _ = weigh(g.get("against"), src)
        if g["against_weight"] >= g["weight"]:
            g["status"] = "contested"
        elif g["weight"] >= 6 or (g["top"] >= 4 and not g.get("against")):
            g["status"] = "core"
        elif g["weight"] >= 3:
            g["status"] = "supported"
        else:
            g["status"] = "thin"
    return gd


def validate(src, gd, ev):
    errs = []
    for s in src.values():
        for k in ("tier", "publisher", "title", "url", "opened"):
            if not s.get(k): errs.append(f"source {s.get('id')}: missing {k}")
        if s.get("tier") not in (1, 2, 3, 4, 5): errs.append(f"source {s['id']}: tier must be 1-5")
        if not str(s.get("url", "")).startswith("https://"): errs.append(f"source {s['id']}: url must be https")
    seen = set()
    for g in gd:
        if g["id"] in seen: errs.append(f"guidance {g['id']}: duplicate id")
        seen.add(g["id"])
        for k in ("topic", "applies", "use", "text", "for"):
            if not g.get(k): errs.append(f"guidance {g['id']}: missing {k}")
        if set(g.get("applies", [])) - KINDS: errs.append(f"guidance {g['id']}: unknown kind in applies")
        if g.get("use") not in ("rule", "advice", "safety", "why"): errs.append(f"guidance {g['id']}: use must be rule, advice, safety or why")
        if g.get("use") == "why" and not (g.get("role") and g.get("short")): errs.append(f"guidance {g['id']}: a why statement needs role and short")
        for i in (g.get("for") or []) + (g.get("against") or []):
            if i not in src: errs.append(f"guidance {g['id']}: unknown source {i}")
        if g.get("against") and not g.get("note"): errs.append(f"guidance {g['id']}: say in `note` how the disagreement is resolved")
        for i in g.get("events") or []:
            if i not in ev: errs.append(f"guidance {g['id']}: unknown event {i} in events")
    for k, e in ev.items():
        for f in ("id", "name", "kinds", "demands", "key_session", "weeks"):
            if f not in e: errs.append(f"event {k}: missing {f}")
        for i in e.get("sources") or []:
            if i not in src: errs.append(f"event {k}: unknown source {i}")
    return errs


def applies(g, kinds):
    return bool(set(g["applies"]) & (set(kinds) | {"all"}))


def report(src, gd, ev):
    today = dt.date.today().isoformat()
    by = {}
    for g in gd: by.setdefault(g["status"], []).append(g)
    out = [f"# Guidance engine report ({today})", "",
           f"{len(src)} sources, {len(gd)} statements, {len(ev)} event profiles. "
           f"Core {len(by.get('core', []))}, supported {len(by.get('supported', []))}, thin {len(by.get('thin', []))}, contested {len(by.get('contested', []))}.", "",
           "## Sources by tier", ""]
    names = {5: "Official health body or international consensus", 4: "Peer-reviewed review or large study", 3: "Governing body or route authority", 2: "Recognised coach or elite athlete", 1: "General"}
    for t in (5, 4, 3, 2, 1):
        rows = [s for s in src.values() if s["tier"] == t]
        if rows:
            out.append(f"**{t}. {names[t]}**")
            out += [f"- {s['publisher']}, *{s['title']}* ({s['year']}). Opened {s['opened']}." for s in rows]
            out.append("")
    out += ["## Statements, strongest first", "", "| Status | Weight | Topic | Statement | Sources |", "|---|---|---|---|---|"]
    order = {"core": 0, "supported": 1, "contested": 2, "thin": 3}
    for g in sorted(gd, key=lambda g: (order[g["status"]], -g["weight"])):
        txt = g["text"].replace("|", "/")
        ag = f" (against: {', '.join(g['against'])})" if g.get("against") else ""
        out.append(f"| {g['status']} | {g['weight']} | {g['topic']} | {txt} | {', '.join(g['for'])}{ag} |")
    out += ["", "## Coverage by kind of challenge", ""]
    for k in sorted(KINDS - {"all"}):
        n = [g for g in gd if k in g["applies"] and g["status"] in ("core", "supported")]
        out.append(f"- {k}: {len(n)} usable statements of its own" + (" (needs sources)" if len(n) < 3 else ""))
    out += ["", "## Disagreements and how they were resolved", ""]
    out += [f"- **{g['id']}**: {g['note']}" for g in gd if g.get("against")] or ["- None."]
    (E / "REPORT.md").write_text("\n".join(out) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- plans

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fmt(v, unit):
    if unit == "hours":
        h = round(v * 2) / 2
        return f"{h:g} hour" + ("" if h == 1 else "s")
    if unit == "minutes":
        return f"{max(5, round(v / 5) * 5):g} minutes"
    if unit == "metres":
        return f"{max(50, round(v / 50) * 50):,.0f} metres"
    if unit in ("miles", "km"):
        return f"{round(v):g} {unit}" + (f" ({round(v * 1.609):g} km)" if unit == "miles" else f" ({round(v / 1.609):g} miles)")
    return f"{v:g} {unit}"


def schedule(e, level, weeks, cutback=True):
    ks = e["key_session"]
    start, peak = ks["start"][level], ks["peak"]
    taper = 3 if weeks >= 16 else 2
    build = weeks - taper
    # the long session grows by the same factor each build week, with every third week eased back to about 80 per cent
    rising = [w for w in range(1, build + 1) if not (cutback and w % 3 == 0)]
    steps = max(1, len(rising) - 1)
    f = (peak / start) ** (1 / steps) if peak > start else 1.0
    warn = None
    if f > 1.2:
        warn = (f"From this starting point the long session would have to grow by about {round((f - 1) * 100)} per cent a week, "
                "more than this plan allows. Choose more weeks, or a lower first goal, before you start.")
        f = 1.2
    vals, cur, k = [], start, 0
    for w in range(1, build + 1):
        if cutback and w % 3 == 0:
            vals.append(cur * 0.8)
        else:
            if k: cur = min(peak, cur * f)
            vals.append(cur); k += 1
    vals += [peak * (0.6 if i == 0 else 0.45) for i in range(taper - 1)] + [None]  # last week: event week
    return vals, taper, warn


DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
STRENGTH_ROUTINE = ("Squats, lunges, a core exercise such as a plank, and a balance exercise such as standing on one leg. "
                    "Start with your own body weight, two sets of 8 to 12 slow repetitions, and add load only when that feels easy.")


def weekly(e, has, vals, taper, weeks, use, cite, D):
    """The week-by-week plan, worked out once for both the written plan (plan()) and the planner (export()).
    D names the engine's seven days, Monday first; the key session is on D[5] and the challenge closes the last week.
    `cite` adds the source numbers (the planner passes one that adds nothing). Returns
    {"parts": [(name, text)], "weeks": [{w, v, cut, tue, thu, sat, notes, head, bullets, sessions}]};
    sessions are [(slot 0-6, role, text, detail, why)], rest days left out, the challenge itself left out."""
    ks, unit, sp = e["key_session"], e["key_session"]["unit"], e.get("specific")
    build = weeks - taper
    pack_from = math.ceil(weeks * e["pack_from_fraction"]) if e.get("pack_from_fraction") else None
    b2b_from = math.ceil(weeks * e["back_to_back_from_fraction"]) if e.get("back_to_back_from_fraction") else None
    why = {g["role"]: g for g in use if g["use"] == "why"}
    def W(role, full=False):
        g = why.get(role)
        return (g["text"] if full else g["short"]) + " " + cite(g["id"]) if g else ""
    clean = lambda t: t.strip()
    sname = e['second_session']['name']; easy_name = sname if sname.startswith("easy") else "easy " + sname
    names = {"long": f"The {D[5]} {ks['name']}", "easy": f"The {easy_name}s", "specific": (sp['name'].capitalize() if sp else ""),
             "strength": "Strength and balance", "rest": "Rest days", "cutback": "Easier weeks", "pack": "Carrying your pack", "taper": "The taper"}
    parts = [(names[r], W(r, True)) for r in ("long", "easy", "specific", "strength", "rest", "cutback", "pack", "taper")
             if r in why and (r != "specific" or sp) and (r != "pack" or pack_from)]
    cap = lambda t: t[:1].upper() + t[1:]
    b2b = next((g for g in use if g["id"] == "back-to-back"), None)
    out, prev = [], None
    peak_w = max((w for w, v in enumerate(vals, 1) if v is not None), key=lambda w: vals[w - 1])
    for w, v in enumerate(vals, 1):
        easy = f"{sname}, {e['second_session']['minutes']} min" + ("" if sname.startswith("easy") else ", easy")
        tue = easy
        on_sp = bool(sp and sp.get("from_week", 1) <= w <= build)
        thu = f"{sp['name']}" if on_sp else easy
        notes = []
        cut = "cutback-weeks" in has and w <= build and w % 3 == 0
        if cut: notes.append("easier week")
        if pack_from and w == pack_from: notes.append("start carrying your loaded pack on the long session")
        two = bool(b2b_from and "back-to-back" in has and b2b_from <= w <= build and w % 3 != 0)
        if two: notes.append(f"add a second, shorter long day on {D[6]} instead of strength")
        if w == build + 1: notes.append("taper begins: same sessions, less of each")
        x = {"w": w, "v": v, "cut": cut}
        if v is None:
            tue = f"{sname}, 20 min" + ("" if sname.startswith("easy") else ", easy")
            x.update(tue=tue, thu="rest", sat="**the challenge**", notes=["event week: rest, sleep, eat well"], head="the challenge",
                     bullets=[f"Two short, easy outings early in the week and plenty of rest: {W('taper')}", "No strength sessions this week; arrive rested."],
                     sessions=[(1, "easy", cap(tue), "Event week: rest, sleep, eat well.", clean(W("taper")))])
            out.append(x)
            break
        x.update(tue=tue, thu=thu, sat=fmt(v, unit), notes=notes)
        # ---- the week's heading and reasons ----
        if w > build:
            head, lead = "taper", f"The {ks['name']} drops to {fmt(v, unit)}, but you keep every session"
        elif cut:
            head, lead = "an easier week", f"The {ks['name']} eases back to {fmt(v, unit)}"
        elif w == peak_w:
            head, lead = "your biggest week", f"Your longest {ks['name']} of the plan, {fmt(v, unit)}, as close to the real day as training gets"
        elif w == 1:
            head, lead = "setting the pattern", f"Five sessions and two rest days. The {ks['name']} starts at {fmt(v, unit)}"
        else:
            head, lead = "building", f"The {ks['name']} grows to {fmt(v, unit)}" + (f", up from {fmt(prev, unit)} in your last full week" if prev else "")
        B = [f"{lead}."]
        if w > build:
            B.append(f"Why less now: {W('taper')}")
        elif cut:
            B.append(f"Why ease off: {W('cutback')}")
        else:
            if w == 1 or w == peak_w or w % 3 == 1 or "no-big-jumps" not in has:
                B.append(f"Why the long session: {W('long')}")
            else:
                B.append(f"Why only this much more: big jumps from one week to the next are linked with overuse injuries. {cite('no-big-jumps')}")
        if sp and w == sp.get("from_week", 1) and w <= build:
            B.append(f"New this week, {sp['name']} on {D[3]}: {W('specific')}")
        elif sp and sp.get("from_week", 1) < w <= build and w % 4 == 0:
            B.append(f"{sp['name'].capitalize()} again on {D[3]}: {W('specific')}")
        if pack_from and w == pack_from:
            B.append(f"New this week, your loaded pack on the long session: {W('pack')}")
        if w == 1 or w % 3 == 1 or w == build + 1:
            B.append(f"{D[1]}'s {easy_name}: {W('easy')}")
        if w > build:
            B.append("Keep both strength sessions but make them lighter: same sessions, less of each.")
        elif w in (1, 2) or w % 3 == 2:
            B.append(f"Strength and balance, {D[2]} and {D[6]}: {W('strength')}")
        if w in (1, 3) or w % 3 == 0 or w == build + 1:
            B.append(f"Rest on {D[0]} and {D[4]}: {W('rest')}")
        x.update(head=head, bullets=B)
        # ---- the sessions, for the planner ----
        lighter = "Keep both strength sessions but make them lighter: same sessions, less of each." if w > build else ""
        strength = ("Strength and balance, about 30 minutes", " ".join(filter(None, [STRENGTH_ROUTINE, lighter])), clean(W("strength")))
        key_why = clean(W("taper") if w > build else W("cutback") if cut else W("long"))
        key_detail = " ".join(filter(None, [cap(ks.get("note", "")) + "." if ks.get("note") else "", *[cap(n) + "." for n in notes if "second, shorter" not in n]]))
        S = [(1, "easy", cap(tue), "", clean(W("easy"))), (2, "strength") + strength,
             (3, "specific", cap(thu), sp["text"][:1].upper() + sp["text"][1:] + "." if on_sp else "", clean(W("specific"))) if on_sp else (3, "easy", cap(thu), "", clean(W("easy"))),
             (5, "long", f"{cap(ks['name'])}, {fmt(v, unit)}", key_detail, key_why)]
        if two and b2b:
            S.append((6, "long", f"A second, shorter long day (instead of strength)", "", clean(b2b["text"] + " " + cite("back-to-back"))))
        else:
            S.append((6, "strength") + strength)
        x["sessions"] = S
        out.append(x)
        if not cut and w <= build: prev = v
    return {"parts": parts, "weeks": out}


def plan(event, weeks=None, level="active"):
    src, gd, ev = load(); gd = rank(src, gd)
    e = ev[event]; weeks = weeks or e["weeks"]["default"]
    if weeks < e["weeks"]["min"]:
        sys.exit(f"{e['name']} needs at least {e['weeks']['min']} weeks.")
    # `events:` on a statement limits it to those event profiles (e.g. advice that is only about a 10k)
    use = [g for g in gd if g["status"] in ("core", "supported") and applies(g, e["kinds"]) and (not g.get("events") or event in g["events"])]
    refs, order = {}, []
    def cite(*ids):
        nums = []
        for i in ids:
            for s in next(g for g in gd if g["id"] == i)["for"]:
                if s not in refs: refs[s] = len(refs) + 1; order.append(s)
                nums.append(refs[s])
        return "[" + ", ".join(str(n) for n in sorted(set(nums))) + "]"
    has = {g["id"] for g in use}
    vals, taper, warn = schedule(e, level, weeks, cutback="cutback-weeks" in has)
    ks, unit = e["key_session"], e["key_session"]["unit"]
    pack_from = math.ceil(weeks * e["pack_from_fraction"]) if e.get("pack_from_fraction") else None
    b2b_from = math.ceil(weeks * e["back_to_back_from_fraction"]) if e.get("back_to_back_from_fraction") else None
    sp = e.get("specific")
    L = [f"# {e['name']}: a {weeks}-week plan ({level} start)", "",
         f"*Generated by the Don't Die Retired guidance engine on {dt.date.today().strftime('%-d %B %Y')} from {len(use)} sourced statements. Draft for review: not yet checked by a coach, physiotherapist or doctor.*", "",
         "## The challenge", "", e["demands"] + (" " + cite("route-demands") if "route-demands" in has else ""), ""]
    if e.get("prerequisite"): L += [f"**Before this plan:** {e['prerequisite']} {cite('start-where-you-are')}", ""]
    L += ["## Before you start", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["topic"] == "before you start"]
    if warn: L += ["", f"> **This plan is too short for your starting point.** {warn}"]
    L += ["", "## How the plan works", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["use"] == "rule" and g["topic"] not in ("before you start", "why")]
    # weekly() marks where citations go; they are numbered here, in the order the plan prints them
    mark = lambda *ids: "\x00" + ",".join(ids) + "\x00"
    res = lambda t: re.sub(r"\x00([^\x00]*)\x00", lambda m: cite(*m.group(1).split(",")), t)
    W_ = weekly(e, has, vals, taper, weeks, use, mark, DAYS_FULL)
    D = DAYS_FULL
    L += ["", "## Week by week", "",
          f"Rest on {D[0]}s and {D[4]}s. Strength and balance (about 30 minutes, routine below) on {D[2]}s and {D[6]}s. Why each part is there, and what changes each week, follows the table. "
          f"The {D[5]} {ks['name']} is the key session: {ks.get('note', '')}.", "",
          f"| Week | Tue | Thu | Sat: {ks['name']} | Notes |", "|---|---|---|---|---|"]
    for x in W_["weeks"]:
        L.append(f"| {x['w']} | {x['tue']} | {x['thu']} | {x['sat']} | {'; '.join(x['notes'])} |")
    if sp: L += ["", f"*{sp['name'].capitalize()}*: {sp['text']}. {cite('specific-training') if 'specific-training' in has else ''}"]
    L += ["", "## What each part of the plan is for", ""]
    L += [res(f"- **{n}.** {t}") for n, t in W_["parts"]]
    L += ["", "## Each week, and why", ""]
    for x in W_["weeks"]:
        L += [f"**Week {x['w']}: {x['head']}.**", ""] + [res(f"- {b}") for b in x["bullets"]] + [""]
    L += ["", "## Looking after your body", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["topic"] in ("body maintenance", "recovery") and g["use"] != "rule"]
    L += ["", "**Strength and balance routine (twice a week).** Squats, lunges, a core exercise such as a plank, and a balance exercise such as standing on one leg. "
          "Start with your own body weight, two sets of 8 to 12 slow repetitions, and add load only when that feels easy. "
          f"{cite(*[i for i in ('strength-twice-weekly', 'legs-and-core', 'balance-work') if i in has])}"]
    L += ["", "## Fuel, drink and feet", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["topic"] in ("fuel and drink", "feet") and g["use"] != "safety"]
    if e.get("kit"):
        L += ["", "## Kit for the day", "", e["kit"] + " " + (cite("kit-practice") if "kit-practice" in has else "")]
    L += ["", "## On the day", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["topic"] in ("on the day", "kit") and g["use"] == "advice"]
    L += ["", "## Safety", ""]
    L += [f"- {g['text']} {cite(g['id'])}" for g in use if g["use"] == "safety" and g["topic"] != "before you start"]
    L += ["", "## Where this comes from", "", "Ranked by the engine: tier 5 official health guidance or international consensus, 4 peer-reviewed research, 3 governing bodies and route authorities, 2 recognised coaches and elite athletes.", ""]
    for s in order:
        x = src[s]
        L.append(f"{refs[s]}. {x['publisher']}, *{x['title']}* ({x['year']}). Tier {x['tier']}. {x['url']} (opened {x['opened']})")
    (E / "plans").mkdir(exist_ok=True)
    out = E / "plans" / f"{event}-{level}-{weeks}w.md"
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    return out


def export(event):
    """Everything the planner (tools/planner.py → static/planner.js) needs to date an event's training, for every length
    from the minimum to the default and every starting level, as the engine itself works it out. Day names are left as
    {d0}…{d6} (the engine's Monday…Sunday; the key session is {d5}) so the planner can put the key session on the
    reader's own day of the week. No citation numbers: the plan lists the sources instead.
    Strings are stored once in "t" and referred to by number, which keeps the file small."""
    src, gd, ev = load(); gd = rank(src, gd)
    e = ev[event]
    use = [g for g in gd if g["status"] in ("core", "supported") and applies(g, e["kinds"]) and (not g.get("events") or event in g["events"])]
    has = {g["id"] for g in use}
    D = ["{d%d}" % i for i in range(7)]
    T, idx = [], {}
    def t(x):
        x = " ".join(str(x).split())
        if x not in idx: idx[x] = len(T); T.append(x)
        return idx[x]
    ks = e["key_session"]
    plans, full = {}, {}
    shown = set()   # the statements whose words the planner shows, so only their sources are listed
    def seen(*ids):
        shown.update(ids); return ""
    for level in ("starter", "active", "advanced"):
        # "Choose more weeks" (the engine's own warning): for a starting point that cannot reach the peak safely in the
        # default length, the full plan is the shortest one, up to a year, that can
        full[level] = e["weeks"]["default"]
        while schedule(e, level, full[level], cutback="cutback-weeks" in has)[2] and full[level] < 52: full[level] += 1
        for weeks in range(e["weeks"]["min"], full[level] + 1):
            vals, taper, warn = schedule(e, level, weeks, cutback="cutback-weeks" in has)
            W_ = weekly(e, has, vals, taper, weeks, use, seen, D)
            plans[f"{level}-{weeks}"] = {"warn": t("This plan is too short for your starting point. " + warn) if warn else None,
                "weeks": [[t(x["head"]), [t(b) for b in x["bullets"]], [[sl, role, t(tx), t(de), t(wy)] for sl, role, tx, de, wy in x["sessions"]]] for x in W_["weeks"]]}
    W0 = weekly(e, has, *schedule(e, "active", e["weeks"]["default"], cutback="cutback-weeks" in has)[:2], e["weeks"]["default"], use, seen, D)
    before = [g for g in use if g["topic"] == "before you start"]
    safety = [g for g in use if g["use"] == "safety" and g["topic"] != "before you start"]
    shown.update(g["id"] for g in before + safety)
    if e.get("prerequisite"): shown.add("start-where-you-are")
    cited = []
    for g in use:
        if g["id"] in shown:
            for i in g["for"]:
                if i not in cited: cited.append(i)
    for i in e.get("sources") or []:   # the event profile: the key session's own words come from it
        if i not in cited: cited.append(i)
    return {"id": event, "name": e["name"], "key": ks["name"], "min": e["weeks"]["min"], "default": e["weeks"]["default"],
            "draft": f"Generated by the Don't Die Retired guidance engine from {len(use)} sourced statements. Draft for review: not yet checked by a coach, physiotherapist or doctor.",
            "levels": {lv: fmt(ks["start"][lv], ks["unit"]) for lv in ("starter", "active", "advanced")},
            "intro": f"Rest on {D[0]}s and {D[4]}s. Strength and balance (about 30 minutes) on {D[2]}s and {D[6]}s. The {D[5]} {ks['name']} is the key session: {ks.get('note', '')}.",
            "parts": [[n, " ".join(tx.split())] for n, tx in W0["parts"]],
            "full": full, "before": [g["text"] for g in before], "safety": [g["text"] for g in safety],
            "sources": [{"publisher": src[i]["publisher"], "title": src[i]["title"], "year": src[i].get("year"), "tier": src[i]["tier"], "url": src[i]["url"]} for i in cited],
            "t": T, "plans": plans}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["check", "plan"])
    ap.add_argument("event", nargs="?")
    ap.add_argument("--weeks", type=int)
    ap.add_argument("--level", default="active", choices=["starter", "active", "advanced"])
    a = ap.parse_args()
    src, gd, ev = load()
    errs = validate(src, gd, ev)
    if errs:
        print("\n".join(errs)); sys.exit(1)
    if a.cmd == "check":
        report(src, rank(src, gd), ev)
        st = {}
        for g in gd: st[g["status"]] = st.get(g["status"], 0) + 1
        print(f"ok: {len(src)} sources, {len(gd)} statements {st}, {len(ev)} events -> engine/REPORT.md")
    else:
        print(plan(a.event, a.weeks, a.level))


if __name__ == "__main__":
    main()

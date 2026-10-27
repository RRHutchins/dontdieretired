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
import argparse, datetime as dt, math, pathlib, sys
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


def plan(event, weeks=None, level="active"):
    src, gd, ev = load(); gd = rank(src, gd)
    e = ev[event]; weeks = weeks or e["weeks"]["default"]
    if weeks < e["weeks"]["min"]:
        sys.exit(f"{e['name']} needs at least {e['weeks']['min']} weeks.")
    use = [g for g in gd if g["status"] in ("core", "supported") and applies(g, e["kinds"])]
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
    L += ["", "## Week by week", "",
          "Rest on Mondays and Fridays. Strength and balance (about 30 minutes, routine below) on Wednesdays and Sundays. Why each part is there, and what changes each week, follows the table. "
          f"The Saturday {ks['name']} is the key session: {ks.get('note', '')}.", "",
          f"| Week | Tue | Thu | Sat: {ks['name']} | Notes |", "|---|---|---|---|---|"]
    build = weeks - taper
    for w, v in enumerate(vals, 1):
        tue = f"{e['second_session']['name']}, {e['second_session']['minutes']} min" + ("" if e['second_session']['name'].startswith("easy") else ", easy")
        thu = (f"{sp['name']}" if sp and w >= sp.get("from_week", 1) and w <= build else f"{e['second_session']['name']}, {e['second_session']['minutes']} min" + ("" if e['second_session']['name'].startswith("easy") else ", easy"))
        notes = []
        if "cutback-weeks" in has and w <= build and w % 3 == 0: notes.append("easier week")
        if pack_from and w == pack_from: notes.append("start carrying your loaded pack on the long session")
        if b2b_from and "back-to-back" in has and w >= b2b_from and w <= build and w % 3 != 0: notes.append(f"add a second, shorter long day on Sunday instead of strength")
        if w == build + 1: notes.append("taper begins: same sessions, less of each")
        if v is None:
            sat = "**the challenge**"; tue = f"{e['second_session']['name']}, 20 min" + ("" if e['second_session']['name'].startswith("easy") else ", easy"); thu = "rest"; notes = ["event week: rest, sleep, eat well"]
        else:
            sat = fmt(v, unit)
        L.append(f"| {w} | {tue} | {thu} | {sat} | {'; '.join(notes)} |")
    if sp: L += ["", f"*{sp['name'].capitalize()}*: {sp['text']}. {cite('specific-training') if 'specific-training' in has else ''}"]
    # ---- why each part is there, then week by week (Robin, 27 Oct 2026) ----
    why = {g["role"]: g for g in use if g["use"] == "why"}
    def W(role, full=False):
        g = why.get(role)
        return (g["text"] if full else g["short"]) + " " + cite(g["id"]) if g else ""
    sname = e['second_session']['name']; easy_name = sname if sname.startswith("easy") else "easy " + sname
    names = {"long": f"The Saturday {ks['name']}", "easy": f"The {easy_name}s", "specific": (sp['name'].capitalize() if sp else ""),
             "strength": "Strength and balance", "rest": "Rest days", "cutback": "Easier weeks", "pack": "Carrying your pack", "taper": "The taper"}
    L += ["", "## What each part of the plan is for", ""]
    for r in ("long", "easy", "specific", "strength", "rest", "cutback", "pack", "taper"):
        if r in why and (r != "specific" or sp) and (r != "pack" or pack_from):
            L.append(f"- **{names[r]}.** {W(r, True)}")
    L += ["", "## Each week, and why", ""]
    peak_w = max((w for w, v in enumerate(vals, 1) if v is not None), key=lambda w: vals[w - 1])
    prev = None
    for w, v in enumerate(vals, 1):
        cut = "cutback-weeks" in has and w <= build and w % 3 == 0
        if v is None:
            L += [f"**Week {w}: the challenge.**", "",
                  f"- Two short, easy outings early in the week and plenty of rest: {W('taper')}",
                  "- No strength sessions this week; arrive rested.", ""]
            break
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
        B = [f"**Week {w}: {head}.**", "", f"- {lead}."]
        if w > build:
            B.append(f"- Why less now: {W('taper')}")
        elif cut:
            B.append(f"- Why ease off: {W('cutback')}")
        else:
            if w == 1 or w == peak_w or w % 3 == 1 or "no-big-jumps" not in has:
                B.append(f"- Why the long session: {W('long')}")
            else:
                B.append(f"- Why only this much more: big jumps from one week to the next are linked with overuse injuries. {cite('no-big-jumps')}")
        if sp and w == sp.get("from_week", 1) and w <= build:
            B.append(f"- New this week, {sp['name']} on Thursday: {W('specific')}")
        elif sp and sp.get("from_week", 1) < w <= build and w % 4 == 0:
            B.append(f"- {sp['name'].capitalize()} again on Thursday: {W('specific')}")
        if pack_from and w == pack_from:
            B.append(f"- New this week, your loaded pack on the long session: {W('pack')}")
        if w == 1 or w % 3 == 1 or w == build + 1:
            B.append(f"- Tuesday's {easy_name}: {W('easy')}")
        if w > build:
            B.append("- Keep both strength sessions but make them lighter: same sessions, less of each.")
        elif w in (1, 2) or w % 3 == 2:
            B.append(f"- Strength and balance, Wednesday and Sunday: {W('strength')}")
        if w in (1, 3) or w % 3 == 0 or w == build + 1:
            B.append(f"- Rest on Monday and Friday: {W('rest')}")
        L += B + [""]
        if not cut and w <= build: prev = v
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

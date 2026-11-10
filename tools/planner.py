"""My year: the planner's data (RUNBOOK §6s).

prepare() checks the planning fields on every activity, works out each one's best months, lead time, plan shape and any
engine event, and returns the data the planner pages use. build.py calls it and writes dist/planner/activities.json.

Run on its own for a summary:  python3 tools/planner.py
"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
STRANDS = ("book", "learn", "train", "travel", "kit")
STEP_KEYS = ("first", "second", "ongoing", "after_start", "dates", "book", "travel", "kit_before", "kit_after", "safety", "day", "day_month", "train_start", "look_back", "take_stock", "safety_month", "later", "day_span")
START_AT = ("first", "second", "ongoing", "after_start", "later", "travel", "day")
NO_TEXT = ("first", "second", "ongoing", "after_start", "later")   # an activity's own start step supplies the words
TRIP_KEYS = ("head", "where_label", "where_q", "where_help", "where_hint", "where_save", "where_change", "where_source", "when_none", "getting", "getting_help", "step_detail", "my_needs", "getting_help_span",
             "head_away", "stay", "stay_fold", "stay_help_span", "stay_help_day", "stay_help_month", "stay_more", "eat", "eat_help",
             "near", "near_help", "near_area", "near_tours", "near_tours_help", "goes", "goes_help", "add", "add_on", "added", "see_plan", "pick_date", "pick_why_event", "pick_why_fixed", "pick_why_long")
TOUR_AFF = ("viator", "getyourguide")   # the only travel-side affiliate schemes Robin has joined (site.yaml → affiliates)
NEAR_MAX, GOES_MAX = 6, 4
COUNTRY = re.compile(r"[A-Z]{2}")
NOTE_KEYS = ("squeezed", "outside", "too_soon", "train_short", "past", "suggest_fixed", "suggest_season", "suggest_any", "saved", "saved_past", "affiliate", "moved_you", "moved_day", "moved_busy", "clash_day", "clash_train", "cal_step", "cal_day_month", "cal_why", "cal_plan", "cal_help",
             "level_q", "level_opt", "level_starter", "level_active", "level_advanced", "level_help", "train_month", "train_offline", "train_week", "train_about", "cal_why_train", "train_level_long", "train_level_short", "clash_span", "span_q", "span_last", "span_help", "span_err",
             "trip_train", "trip_train_key", "trip_train_eve", "with_trip")
PLUS_KEYS = ("intro", "diy_head", "diy_tag", "diy_help", "diy_open", "diy_book", "diy_place_help", "diy_nearby", "diy_goes", "head", "head_open", "checking",
             "what", "price", "sample", "join", "signin", "saved_ro", "my_ro", "sample_title", "sample_intro")


def _load(p: Path):
    return yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else None


def _months_ok(m) -> bool:
    return isinstance(m, list) and all(isinstance(x, int) and 1 <= x <= 12 for x in m) and len(set(m)) == len(m)


def prepare(chs: list[dict], root: Path = ROOT, today: dt.date | None = None):
    """Return (data, warnings). Raises AssertionError on a malformed planning field, as build.py does elsewhere."""
    today = today or dt.date.today()
    cfg = _load(root / "content" / "planner.yaml") or {}
    kinds, seasons = cfg.get("kinds") or {}, cfg.get("seasons") or {}
    warn: list[str] = []

    for k, v in kinds.items():
        assert v.get("label") and v.get("why") and isinstance(v.get("lead_weeks"), int) and v["lead_weeks"] >= 0, f"planner kind {k}: needs label, why, lead_weeks"
        assert "lead_weeks_local" not in v or (isinstance(v["lead_weeks_local"], int) and 0 <= v["lead_weeks_local"] <= v["lead_weeks"]), f"planner kind {k}: lead_weeks_local must be a whole number no bigger than lead_weeks"
        assert v.get("strands") and all(s in STRANDS for s in v["strands"]), f"planner kind {k}: strands must be from {STRANDS}"
    for phrase, m in seasons.items():
        assert m is None or _months_ok(m), f"planner season {phrase!r}: months must be distinct numbers 1-12, or null"

    # Step wording (static/planner.js): when and why only; what to do comes from the activity itself
    steps, notes = cfg.get("steps") or {}, cfg.get("notes") or {}
    at_ok = lambda a: isinstance(a, int) or a == "start" or bool(re.fullmatch(r"start\+\d+|lead\*(0(\.\d+)?|1(\.0+)?)", str(a)))
    for k in STEP_KEYS:
        v = steps.get(k) or {}
        assert v.get("why"), f"planner steps.{k}: needs why"
        if k not in ("day_month", "day_span", "train_start"): assert "at" in v and at_ok(v["at"]), f"planner steps.{k}: at must be days, 'start', 'start+N' or 'lead*F'"
        if k not in NO_TEXT: assert v.get("text"), f"planner steps.{k}: needs text"
    for k in NOTE_KEYS: assert notes.get(k), f"planner notes.{k}: missing"
    # Where it is and getting there (Planner Plus day 8): the words, and the searches built from a place
    trip = cfg.get("trip") or {}
    for k in TRIP_KEYS: assert trip.get(k), f"planner trip.{k}: missing"
    tids = set()
    for l in trip.get("links") or []:
        assert l.get("id") and l["id"] not in tids and l.get("label") and l.get("why"), f"planner trip link {l.get('id')}: needs a unique id, label and why"
        tids.add(l["id"])
        near = trip.get("near_q") or {}
        assert isinstance(near, dict) and all(isinstance(v, str) and v.strip() for v in near.values()), "planner trip.near_q: words for each {q_<key>}"
        ph = lambda u: set(re.findall(r"\{([^}]*)\}", u))
        okq = lambda x: x == "q" or (x.startswith("q_") and x[2:] in near)
        u = str(l.get("url", ""))
        assert u.startswith("https://") and all(okq(x) for x in ph(u)), f"planner trip link {l['id']}: url must be https:// and use only {{q}} or {{q_<key in trip.near_q>}}"
        assert l.get("section") in ("where", "getting", "stay", "eat", "near"), f"planner trip link {l['id']}: section is where, getting, stay, eat or near"
        if "url_dated" in l:
            d_ = str(l["url_dated"])
            assert l["section"] == "stay" and d_.startswith("https://") and {"in", "out"} <= ph(d_) and all(okq(x) or x in ("in", "out") for x in ph(d_)), f"planner trip link {l['id']}: url_dated is for stay links, https://, with {{in}} and {{out}}"
        # affiliate ids only where Robin has sent one: tours (Viator, GetYourGuide) under "While you're there" (day 10);
        # none yet for trains or hotels (RUNBOOK §6t)
        assert not l.get("aff") or (l["section"] == "near" and l["aff"] in TOUR_AFF), f"planner trip link {l['id']}: affiliate ids only on tour searches (section near, aff {'/'.join(TOUR_AFF)}); none yet for travel or hotels"
        c_ = l.get("countries")
        assert c_ == "any" or (isinstance(c_, list) and c_ and all(isinstance(x, str) and COUNTRY.fullmatch(x) for x in c_)), f"planner trip link {l['id']}: countries is any or a list of two-letter codes"
    assert any(l["section"] == "where" for l in trip.get("links") or []), "planner trip: needs a map link (section: where)"
    plus = cfg.get("plus") or {}   # Planner Plus day 15: the two ways to plan, the paywall and the sample plan
    for k in PLUS_KEYS: assert isinstance(plus.get(k), str) and plus[k].strip(), f"planner plus.{k}: missing"
    sp = plus.get("sample_plan") or {}
    assert sp.get("activity") and sp.get("place") and all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(sp.get(k, ""))) for k in ("date", "made")), "planner plus.sample_plan: needs activity, place, date and made (YYYY-MM-DD)"
    assert str(sp["made"]) < str(sp["date"]) and (not sp.get("until") or str(sp["until"]) > str(sp["date"])), "planner plus.sample_plan: made before the date, until after it"
    busy = cfg.get("busy_day", 3)
    assert isinstance(busy, int) and 2 <= busy <= 10, "planner busy_day: a whole number from 2 to 10"

    # Engine events (engine/events/*.yaml): the only source of training plans.
    events = {}
    for f in sorted((root / "engine" / "events").glob("*.yaml")):
        e = _load(f) or {}
        eid = e.get("id") or f.stem
        w = e.get("weeks") or {}
        assert isinstance(w.get("default"), int) and isinstance(w.get("min"), int) and w["min"] <= w["default"], f"engine event {eid}: weeks.default and weeks.min needed"
        ks = e.get("key_session") or {}
        events[eid] = {"id": eid, "name": e.get("name", eid), "activity": e.get("activity"), "weeks": w["default"], "min_weeks": w["min"], "prerequisite": e.get("prerequisite", ""),
                       "key": ks.get("name", ""), "levels": {lv: _engine(root).fmt(ks["start"][lv], ks["unit"]) for lv in ("starter", "active", "advanced")}}
    by_act = {e["activity"]: e["id"] for e in events.values() if e.get("activity")}

    ids = {c["id"] for c in chs}
    for a, eid in by_act.items():
        if a not in ids: warn.append(f"engine event {eid} points at activity {a}, which is not in the catalogue")

    # Dated things (content/dates.yaml)
    dates = {}
    for d in (_load(root / "content" / "dates.yaml") or {}).get("dates") or []:
        a = d.get("activity")
        assert a in ids, f"dates.yaml: unknown activity {a}"
        assert _months_ok(d.get("months")) and d["months"], f"dates.yaml {a}: months must be distinct numbers 1-12"
        s = d.get("source") or {}
        assert str(s.get("url", "")).startswith("https://") and s.get("label") and s.get("checked"), f"dates.yaml {a}: source needs url, label, checked"
        if (today - dt.date.fromisoformat(str(s["checked"]))).days > 366: warn.append(f"dates.yaml {a}: last checked over a year ago; dates move, re-check it")
        nxt = None
        if d.get("next"):
            n = dt.date.fromisoformat(str(d["next"]))
            ns = d.get("next_source") or s
            assert str(ns.get("url", "")).startswith("https://"), f"dates.yaml {a}: next needs a next_source (or the main source) with a url"
            nxt = n.isoformat() if n >= today else None
        dates[a] = {"months": d["months"], "note": d.get("note", ""), "next": nxt, "source": {"label": s["label"], "url": s["url"]}}

    out = []
    for c in chs:
        cid, kind = c["id"], c["kind"]
        assert isinstance(c.get("start"), list) and c["start"] and all(isinstance(x, str) for x in c["start"]), f"challenge {cid}: every start step must be plain text (quote a step that contains a colon)"
        assert kind in kinds, f"challenge {cid}: kind {kind} has no plan shape in content/planner.yaml"
        k = kinds[kind]
        # best months: explicit `when`, else a fixed date's months, else our reading of the season line
        if "when" in c:
            assert _months_ok(c["when"]), f"challenge {cid}: when must be distinct month numbers 1-12 (or [] for any time)"
            when, when_from = c["when"], "when"
        elif cid in dates:
            when, when_from = dates[cid]["months"], "dates"
        elif c.get("season"):
            if c["season"] in seasons:
                when, when_from = seasons[c["season"]] or [], "season"
            else:
                warn.append(f"challenge {cid}: season {c['season']!r} is not read in content/planner.yaml, so the planner treats it as any time")
                when, when_from = [], "unread"
        else:
            when, when_from = [], "any"
        # training: only from the engine
        eid = c.get("plan_event") or by_act.get(cid)
        if c.get("plan_event"):
            assert eid in events, f"challenge {cid}: plan_event {eid} is not in engine/events"
        ev = events.get(eid) if eid else None
        if "lead_weeks" in c:
            assert isinstance(c["lead_weeks"], int) and 0 <= c["lead_weeks"] <= 104, f"challenge {cid}: lead_weeks must be a whole number from 0 to 104"
            lead = c["lead_weeks"]
            if ev: assert lead >= ev["min_weeks"], f"challenge {cid}: lead_weeks {lead} is shorter than the engine's minimum for {eid} ({ev['min_weeks']})"
        else:
            local = c["time"] == "afternoon" and not c.get("places") and cid not in dates
            lead = ev["weeks"] if ev else k.get("lead_weeks_local", k["lead_weeks"]) if local else k["lead_weeks"]
        if "start_at" in c:
            assert isinstance(c["start_at"], list) and len(c["start_at"]) == len(c["start"]) and all(x in START_AT for x in c["start_at"]), f"challenge {cid}: start_at needs one of {START_AT} per start step"
        where = None
        if "where" in c:   # the activity's own place (Planner Plus day 8), from its official page
            w = c["where"]
            assert isinstance(w, dict) and set(w) <= {"town", "venue", "postcode", "country", "note", "source"}, f"challenge {cid}: where takes town, venue, postcode, country, note, source"
            assert isinstance(w.get("town"), str) and w["town"].strip(), f"challenge {cid}: where needs a town"
            assert isinstance(w.get("country"), str) and COUNTRY.fullmatch(w["country"]), f"challenge {cid}: where.country is a two-letter code (GB, US, FR...)"
            for f_ in ("venue", "postcode", "note"):
                assert f_ not in w or (isinstance(w[f_], str) and w[f_].strip()), f"challenge {cid}: where.{f_} must be text"
            src = w.get("source") or {}
            assert str(src.get("url", "")).startswith("https://") and src.get("label") and src.get("checked"), f"challenge {cid}: where needs a source with url, label and checked (the official page it came from)"
            dt.date.fromisoformat(str(src["checked"]))
            where = {"town": w["town"], "venue": w.get("venue", ""), "postcode": w.get("postcode", ""), "country": w["country"], "note": w.get("note", ""),
                     "source": {"label": src["label"], "url": src["url"], "checked": str(src["checked"])}}
        regs = c.get("regions") or []
        country = where["country"] if where else "GB" if regs == ["uk"] else "US" if regs == ["us"] else ""
        strands = list(k["strands"])
        if ev and "train" not in strands: strands.insert(1, "train")
        if c.get("book") and "book" not in strands: strands.insert(0, "book")
        if c.get("kit") and "kit" not in strands: strands.append("kit")
        out.append({
            "id": cid, "title": c["title"], "category": c["category"], "kind": kind, "effort": c["effort"], "time": c["time"],
            "when": sorted(when), "when_from": when_from, "season": c.get("season", ""),
            "lead_weeks": lead, "strands": strands, "event": ({"id": ev["id"], "name": ev["name"], "weeks": ev["weeks"], "min_weeks": ev["min_weeks"], "prerequisite": ev["prerequisite"], "key": ev["key"], "levels": ev["levels"]} if ev else None),
            "dates": dates.get(cid), "place_tied": bool(c.get("places")),
            "where": where, "country": country, "area": c.get("place_label", ""),
            "start": c["start"], "start_at": c.get("start_at"), "safety": c.get("safety", ""),
            "links": [{"label": l["label"], "url": l["url"], "region": l.get("region", "any")} for l in c["links"]],
            "book": [{"label": b["label"], "why": b["why"], "url": b["url"], "aff": b.get("aff")} for b in c.get("book") or []],
            "kit": [{"name": x["name"], "why": x["why"], "url": x["url"]} for x in c.get("kit") or []],
        })
    # Planner Plus day 10: "While you're there" (other activities tied to the same area: same `places` key; not a weekly
    # habit, which is not something you do on a trip) and "Goes well with" (the activity's `related`, then the activities
    # that list it as related, then the rest of its collection). Ids only; the pages look up titles and plans.
    area_names = _areas(root)
    by_c = {c["id"]: c for c in chs}
    for a in out:
        c = by_c[a["id"]]
        mine = list(c.get("places") or [])
        near = []
        if mine:
            for m in chs:
                if m is c or m.get("kind") == "habit": continue
                shared = [pl for pl in mine if pl in (m.get("places") or [])]
                if shared: near.append((-len(shared), m.get("time") != "afternoon", m["title"].lower(), m["id"], area_names.get(shared[0], shared[0])))
        a["nearby"] = [[x[3], x[4]] for x in sorted(near)[:NEAR_MAX]]
        goes = []
        for r in c.get("related") or []:
            assert r in by_c and r != c["id"], f"challenge {c['id']}: related id {r} does not exist"
            if r not in goes: goes.append(r)
        goes += [m["id"] for m in chs if m is not c and c["id"] in (m.get("related") or []) and m["id"] not in goes]
        if c.get("collection"):
            goes += [m["id"] for m in chs if m is not c and m.get("collection") == c["collection"] and m["id"] not in goes]
        a["goes"] = goes[:GOES_MAX]
    data = {"version": 1, "built": today.isoformat(),
            "kinds": {k: {"label": v["label"], "why": v["why"], "why_train": v.get("why_train", ""), "lead_weeks": v["lead_weeks"], "strands": v["strands"]} for k, v in kinds.items()},
            "steps": steps, "notes": notes, "trip": trip, "plus": {k: v for k, v in (cfg.get("plus") or {}).items() if k != "sample_plan"}, "sample": (cfg.get("plus") or {}).get("sample_plan"), "busy": busy, "events": events, "activities": out}
    return data, warn


def _areas(root: Path = ROOT) -> dict:
    """Area key → name, from content/map_shapes.json (the same names build.py shows as an activity's place label)."""
    shapes = _load(root / "content" / "map_shapes.json") or {}
    return {a["id"]: a["name"] for k in ("uk", "us", "world") for a in (shapes.get(k) or {}).get("areas", [])
            if not (k == "world" and a["id"] in ("GBR", "USA"))}


_ENG = {}
def _engine(root: Path = ROOT):
    """tools/engine.py, loaded once (it is a script, not a package)."""
    if root not in _ENG:
        import importlib.util as ilu
        spec = ilu.spec_from_file_location("ddr_engine", root / "tools" / "engine.py")
        m = ilu.module_from_spec(spec); spec.loader.exec_module(m); _ENG[root] = m
    return _ENG[root]


def training(data: dict, root: Path = ROOT) -> dict:
    """The engine's dated-training data (tools/engine.py export()) for every event an activity plans with: one file each,
    dist/planner/training/<event>.json, loaded by the planner pages only when a plan has training (RUNBOOK §6s, day 6)."""
    eng = _engine(root)
    out = {}
    for a in data["activities"]:
        e = a.get("event")
        if e and e["id"] not in out:
            x = eng.export(e["id"])
            assert x["min"] == e["min_weeks"] and x["default"] == e["weeks"], f"engine event {e['id']}: export and planner disagree on weeks"
            for k, p in x["plans"].items():
                for wk in p["weeks"]:
                    assert all(s[0] in (1, 2, 3, 5, 6) and x["t"][s[2]] for s in wk[2]), f"engine event {e['id']} {k}: a session with no day or no words"
            out[e["id"]] = x
    return out


if __name__ == "__main__":
    import collections, json, sys
    chs = _load(ROOT / "content" / "challenges.yaml")
    data, warn = prepare(chs)
    if "--json" in sys.argv:   # for tools/test_planner.js (with the engine's training, which the site serves separately)
        data["training"] = training(data)
        print(json.dumps(data, ensure_ascii=False)); sys.exit(0)
    acts = data["activities"]
    print(f"{len(acts)} activities ready to plan")
    print("best months from:", dict(collections.Counter(a["when_from"] for a in acts)))
    print("with an engine training plan:", [a["id"] for a in acts if a["event"]])
    print("with a fixed date:", [a["id"] for a in acts if a["dates"]])
    print("with something else in the same area:", sum(1 for a in acts if a["nearby"]), "· with goes-well-with:", sum(1 for a in acts if a["goes"]))
    by_m = collections.Counter(m for a in acts for m in a["when"])
    print("month-bound activities per month:", {m: by_m[m] for m in range(1, 13)})
    tr = training(data)
    print("dated training from the engine:", {k: f"{v['min']}-{v['default']} weeks, {len(v['plans'])} plans" for k, v in tr.items()})
    for w in warn: print("LIST WARNING:", w)

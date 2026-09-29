#!/usr/bin/env python3
"""Turn product content JSON into app data: plans -> days -> guided steps.
Usage: python3 app/build_data.py <out.json>"""
import json, re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = [
    {"id": "restart7", "src": "restart7-free", "title": "The 7-Day Restart", "subtitle": "One week of ten-minute sessions to prove you can start",
     "colour": "#B23A48", "free": True, "open_days": 99, "shop": None},
    {"id": "restart30", "src": "restart30", "title": "The 30-Day Restart", "subtitle": "Ten minutes a day, from your chair to the top of the stairs",
     "colour": "#0B6E4F", "free": False, "open_days": 3, "shop": "/shop/#restart30", "price": "£9"},
]

def movements(blocks):
    for b in blocks:
        t = b.get("table")
        if t and t["headers"][0] == "Movement":
            return {r[0].lower(): {"name": r[0], "how": r[1]} for r in t["rows"]}
    return {}

def match(name, mv):
    n = name.lower().strip()
    best = None
    for k in mv:
        if n.startswith(k) or k.startswith(n.split(" at ")[0]) or k in n:
            if not best or len(k) > len(best): best = k
    return mv[best] if best else None

def parse_step(item, mv):
    item = item.strip().rstrip(".")
    m = re.match(r"^(.*?)(?:\s+(?:×|x)(\d+)(.*)|\s+(\d+)\s*(min|sec)(.*)|\s+up and down(.*))?$", item)
    name = item; reps = None; secs = None; extra = ""
    mm = re.search(r"×\s*(\d+)", item)
    tt = re.search(r"(\d+)\s*(min|sec)\b", item)
    if mm:
        name = item[:mm.start()].strip(); reps = int(mm.group(1)); extra = item[mm.end():].strip()
    elif tt:
        name = item[:tt.start()].strip(); secs = int(tt.group(1)) * (60 if tt.group(2) == "min" else 1); extra = item[tt.end():].strip()
    each = bool(re.search(r"\beach\b", extra))
    ref = match(name, mv)
    return {"name": (ref["name"] if ref and len(name) < len(ref["name"]) + 25 else name[:1].upper() + name[1:]),
            "label": name[:1].upper() + name[1:], "reps": reps, "secs": secs, "each": each,
            "detail": extra.replace("each", "").strip(" ,") or None, "how": ref["how"] if ref else None}

def parse_day(d, mv):
    task = re.sub(r"\s*\(\d+ min\)\s*$", "", d["task"]).strip()
    title = None
    head = task.split(":", 1)
    if len(head) == 2 and "×" not in head[0] and len(head[0]) < 45:
        title, task = head[0].strip(), head[1].strip()
    if task.lower().startswith("retest") or (title or "").lower().startswith("retest"):
        return {"day": d["day"], "title": "Retest day", "note": d.get("note"), "test": "end", "steps": [
            parse_step("outdoor walk 6 min", mv)]}
    items = [x for x in re.split(r",\s*(?:then\s+)?|\s+then\s+", task) if x.strip()]
    return {"day": d["day"], "title": title or d["day"], "note": d.get("note"), "steps": [parse_step(x, mv) for x in items]}

def build():
    out = {"plans": []}
    for P in PLANS:
        C = json.load(open(f"{ROOT}/products/content/{P['src']}.json"))
        mv = movements(C["blocks"])
        days = []
        for b in C["blocks"]:
            if "week" in b:
                for d in b["week"]["days"]:
                    days.append({**parse_day(d, mv), "week": b["week"]["title"]})
        safety = next((b["callout"] for b in C["blocks"] if b.get("callout") and re.search(r"stop|before", b["callout"]["title"], re.I)), None)
        out["plans"].append({**{k: v for k, v in P.items() if k != "src"}, "days": days, "safety": safety,
                             "movements": sorted(mv.values(), key=lambda x: x["name"])})
    out["two_minute"] = [{"name": "Sit-to-stand", "label": "Sit-to-stand", "reps": 3, "secs": None, "each": False, "detail": None,
                          "how": "Feet flat, slightly back. Lean forward, stand, then lower slowly to sit. Use your hands if you need to."},
                         {"name": "Heel raises", "label": "Heel raises", "reps": 10, "secs": None, "each": False, "detail": None,
                          "how": "Standing, holding the back of a chair. Rise onto your toes, pause, lower slowly."},
                         {"name": "Marching", "label": "March on the spot", "reps": None, "secs": 30, "each": False, "detail": None,
                          "how": "Seated or standing. Lift your knees in turn, arms swinging if comfortable."},
                         {"name": "One slow breath", "label": "One slow breath", "reps": None, "secs": 10, "each": False, "detail": None,
                          "how": "Breathe in slowly through your nose, and out even more slowly. That's it — well done."}]
    return out

if __name__ == "__main__":
    data = build()
    json.dump(data, open(sys.argv[1] if len(sys.argv) > 1 else "/dev/stdout", "w"), ensure_ascii=False, indent=1)

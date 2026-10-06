#!/usr/bin/env python3
"""Pull last week's visitor numbers from Plausible into reports/data/ for the weekly report.

Runs in GitHub Actions (.github/workflows/stats.yml) with the secret PLAUSIBLE_API_KEY, because the
cloud session's shell cannot reach plausible.io. Uses the Stats API v2 (POST /api/v2/query), which
needs a Plausible Business plan. Writes one JSON file per run: the last seven full days, plus the
four weeks before it for comparison, so RUNBOOK §5 (the improvement loop) has something to read.

Never prints the key. Every query that fails is recorded in the file under "errors" and as a
GitHub annotation, and the rest still run.
"""
import datetime as dt, json, os, pathlib, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).parent
SITE = os.environ.get("PLAUSIBLE_SITE", "dontdieretired.com")
KEY = os.environ.get("PLAUSIBLE_API_KEY", "").strip()
API = "https://plausible.io/api/v2/query"
EVENTS = ["newsletter_submit", "affiliate_click", "product_click", "scroll_depth", "article_fit", "profile",
          "plan_view", "share", "say_vote", "say_suggest", "local_click"]
errors = []


def note(kind, msg):
    print(f"::{kind} title=Plausible stats::" + msg.replace("\n", " "))


def q(body, label):
    body = {"site_id": SITE, **body}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r).get("results", [])
    except urllib.error.HTTPError as e:
        errors.append(f"{label}: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200]}")
    except Exception as e:
        errors.append(f"{label}: {type(e).__name__}")
    return None


def rows(res, names):
    return None if res is None else [{"key": " / ".join(map(str, r.get("dimensions", []))), **dict(zip(names, r.get("metrics", [])))} for r in res]


def main():
    if not KEY:
        note("warning", "No PLAUSIBLE_API_KEY secret, so no numbers were fetched. See RUNBOOK §3a.")
        return 0
    today = dt.date.today()
    end = today - dt.timedelta(days=1)            # yesterday: last full day
    start = end - dt.timedelta(days=6)
    rng = [start.isoformat(), end.isoformat()]
    top = ["visitors", "visits", "pageviews", "bounce_rate", "visit_duration"]
    out = {"site": SITE, "from": rng[0], "to": rng[1], "fetched": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    t = q({"metrics": top, "date_range": rng}, "totals")
    out["totals"] = dict(zip(top, t[0]["metrics"])) if t else None
    out["previous_weeks"] = []
    for k in range(1, 5):
        e2 = start - dt.timedelta(days=1 + 7 * (k - 1)); s2 = e2 - dt.timedelta(days=6)
        p = q({"metrics": top, "date_range": [s2.isoformat(), e2.isoformat()]}, f"week -{k}")
        out["previous_weeks"].append({"from": s2.isoformat(), "to": e2.isoformat(), **(dict(zip(top, p[0]["metrics"])) if p else {})})
    pg = {"limit": 25}
    out["top_pages"] = rows(q({"metrics": ["visitors", "pageviews"], "date_range": rng, "dimensions": ["event:page"], "order_by": [["visitors", "desc"]], "pagination": pg}, "top pages"), ["visitors", "pageviews"])
    out["entry_pages"] = rows(q({"metrics": ["visitors"], "date_range": rng, "dimensions": ["visit:entry_page"], "order_by": [["visitors", "desc"]], "pagination": pg}, "entry pages"), ["visitors"])
    out["sources"] = rows(q({"metrics": ["visitors"], "date_range": rng, "dimensions": ["visit:source"], "order_by": [["visitors", "desc"]], "pagination": pg}, "sources"), ["visitors"])
    out["countries"] = rows(q({"metrics": ["visitors"], "date_range": rng, "dimensions": ["visit:country_name"], "order_by": [["visitors", "desc"]], "pagination": {"limit": 10}}, "countries"), ["visitors"])
    out["goals"] = rows(q({"metrics": ["visitors", "events"], "date_range": rng, "dimensions": ["event:goal"]}, "goals"), ["visitors", "events"])
    # property splits the improvement loop asks for (need the events added as goals in Plausible)
    props = {"scroll_depth": "pct", "article_fit": "v", "profile": "level", "product_click": "id"}
    out["props"] = {}
    for ev, prop in props.items():
        out["props"][f"{ev}.{prop}"] = rows(q({"metrics": ["visitors", "events"], "date_range": rng, "dimensions": [f"event:props:{prop}"],
                                                "filters": [["is", "event:goal", [ev]]]}, f"{ev} by {prop}"), ["visitors", "events"])
    out["errors"] = errors
    iso = end.isocalendar()
    d = ROOT / "reports" / "data"; d.mkdir(parents=True, exist_ok=True)
    f = d / f"{iso[0]}-{iso[1]:02d}.json"
    f.write_text(json.dumps(out, indent=1), encoding="utf-8")
    if out["totals"] is None:
        note("error", "Plausible returned no totals. " + " | ".join(errors)[:600])
        return 1
    note("warning" if errors else "notice",
         f"{rng[0]} to {rng[1]}: {out['totals']['visitors']} visitors, {out['totals']['pageviews']} pageviews. Saved {f.relative_to(ROOT)}."
         + (f" {len(errors)} query(ies) failed: " + " | ".join(errors)[:400] if errors else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())

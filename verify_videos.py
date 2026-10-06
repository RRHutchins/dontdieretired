#!/usr/bin/env python3
"""Check every film in content/videos.yaml against YouTube before the site is built.

Runs in the deploy workflow (GitHub Actions can reach YouTube; the cloud session's shell cannot).
For each film it asks YouTube's oEmbed endpoint whether the ID exists and is embeddable, and
compares the returned title with ours. The result goes to .videos_check.json, which build.py
reads: a film that fails is left off the Videos page, so an unverified ID never goes live.

Outcomes per film:
  ok        YouTube knows the ID and the title matches ours
  bad       YouTube says the ID does not exist / cannot be embedded, or the title is a different film
  unknown   YouTube could not be reached (network error, rate limit). Films already on the site for
            more than GRACE_DAYS stay; newer ones are held back until a later run can check them.

The summary is written as a GitHub annotation (::notice / ::warning) so the daily job can read it:
  gh api repos/RRHutchins/dontdieretired/commits/<sha>/check-runs      -> id of the `build` job
  gh api repos/RRHutchins/dontdieretired/check-runs/<id>/annotations
Never fails the build: a YouTube outage must not stop the day's story going out.
"""
import datetime as dt, difflib, json, pathlib, re, sys, urllib.error, urllib.parse, urllib.request
import yaml

ROOT = pathlib.Path(__file__).parent
GRACE_DAYS = 7
OEMBED = "https://www.youtube.com/oembed?format=json&url="


def norm(s):
    return re.sub(r"[^a-z0-9 ]+", " ", str(s).lower()).split()


def same_film(ours, theirs):
    a, b = norm(ours), norm(theirs)
    if not a or not b:
        return False
    ratio = difflib.SequenceMatcher(None, " ".join(a), " ".join(b)).ratio()
    overlap = len(set(a) & set(b)) / max(1, min(len(set(a)), len(set(b))))
    return ratio >= 0.6 or overlap >= 0.6


def check(v):
    url = OEMBED + urllib.parse.quote(f"https://www.youtube.com/watch?v={v['id']}", safe="")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "dontdieretired-video-check"}), timeout=20) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403, 404):
            return "bad", f"YouTube returned {e.code} (removed, private or not embeddable)"
        return "unknown", f"YouTube returned {e.code}"
    except Exception as e:  # network trouble, bad JSON
        return "unknown", f"could not reach YouTube ({type(e).__name__})"
    if not same_film(v.get("title", ""), data.get("title", "")):
        return "bad", f"title mismatch: YouTube says “{data.get('title', '')}” by {data.get('author_name', '?')}"
    return "ok", f"{data.get('title', '')} — {data.get('author_name', '')}"


def main():
    videos = (yaml.safe_load((ROOT / "content" / "videos.yaml").read_text(encoding="utf-8")) or {}).get("videos", [])
    today = dt.date.today()
    results, hidden, unknown_kept = {}, [], []
    for v in videos:
        status, detail = check(v)
        added = v.get("added")
        age = (today - added).days if isinstance(added, dt.date) else 999
        show = status == "ok" or (status == "unknown" and age > GRACE_DAYS)
        results[v["id"]] = {"status": status, "detail": detail, "show": show}
        if not show:
            hidden.append(f"{v['id']} ({v.get('title', '')[:50]}): {detail}")
        elif status == "unknown":
            unknown_kept.append(v["id"])
    (ROOT / ".videos_check.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    newest = max((v["added"] for v in videos if isinstance(v.get("added"), dt.date) and results[v["id"]]["show"]), default=None)
    ok = sum(1 for r in results.values() if r["status"] == "ok")
    msg = f"Videos: {ok} of {len(videos)} verified with YouTube; {len(hidden)} held back; newest film shown was added {newest}."
    if unknown_kept:
        msg += f" Could not check {len(unknown_kept)} older film(s) this run; kept."
    if hidden:
        print("::warning title=Videos check::" + (msg + " Held back: " + " | ".join(hidden)).replace("\n", " "))
    else:
        print("::notice title=Videos check::" + msg)
    return 0


if __name__ == "__main__":
    sys.exit(main())

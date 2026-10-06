#!/usr/bin/env python3
"""Check the outside links the site vouches for.

    python tools/check_links.py            # scam help tools and routes (+ the challenge catalogue once it exists)

Reads content/scam_help.yaml and content/challenges.yaml and requests every link once.
Prints the ones that do not answer, and exits 1 if any are broken, so it can be used in the weekly job.
A 403 or 405 usually means the site refuses automated requests, not that the link is dead: those are
listed as "check by hand" and do not count as broken. Run it where the shell can reach the web (the
cloud session often cannot: then fetch the listed links with the web tools instead).
"""
import sys, urllib.request, urllib.error, pathlib
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (compatible; dontdieretired-linkcheck)"}


def collect():
    links = []
    f = ROOT / "content" / "scam_help.yaml"
    if f.exists():
        d = yaml.safe_load(f.read_text(encoding="utf-8"))
        for t in d.get("types", []):
            for reg in ("uk", "us"):
                for x in t.get("tools", {}).get(reg, []):
                    links.append((f"scam help / {t['id']} / {x['name']}", x["url"]))
        for reg in ("uk", "us"):
            for x in d.get("routes", {}).get(reg, []):
                links.append((f"scam help / route / {x['label']}", x["source"]))
        for key in ("question_sources", "reviews"):
            for x in d.get(key, []):
                links.append((f"scam help / {key}", x["url"]))
    f = ROOT / "content" / "challenges.yaml"
    if f.exists():
        for c in yaml.safe_load(f.read_text(encoding="utf-8")) or []:
            for x in c.get("links", []):
                links.append((f"challenge / {c['id']} / {x['label']}", x["url"]))
    return links


def check(url):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # DNS, TLS, timeout
        return str(e)[:80]


if __name__ == "__main__":
    seen, broken, by_hand = {}, [], []
    for label, url in collect():
        if url not in seen:
            seen[url] = check(url)
        st = seen[url]
        if st in (200, 301, 302, 303, 307, 308):
            continue
        (by_hand if st in (401, 403, 405, 429) else broken).append((st, label, url))
    for st, label, url in by_hand:
        print(f"CHECK BY HAND  {st}  {label}  {url}")
    for st, label, url in broken:
        print(f"BROKEN  {st}  {label}  {url}")
    print(f"{len(seen)} links checked, {len(broken)} broken, {len(by_hand)} to check by hand")
    sys.exit(1 if broken else 0)

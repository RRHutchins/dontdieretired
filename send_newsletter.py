#!/usr/bin/env python3
"""Put each weekly edition (newsletters/YYYY-WW.md) into Buttondown as a DRAFT. RUNBOOK §3.

Runs in GitHub Actions (.github/workflows/newsletter.yml); the cloud session cannot reach Buttondown.
Needs the repository secret BUTTONDOWN_API_KEY. It never sends: it creates a draft, which the owner
reads and sends from Buttondown. Safe to re-run: an edition whose subject Buttondown already holds is skipped.
Only editions whose `send_on` date is today or later are considered, so old files are never re-created.
Results are written as a GitHub annotation.
"""
import datetime as dt, json, os, pathlib, re, sys, urllib.request, urllib.error
import yaml

ROOT = pathlib.Path(__file__).resolve().parent
API = "https://api.buttondown.com/v1/emails"


def note(kind, title, msg):
    msg = msg.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
    print(f"::{kind} title={title}::{msg}")


def call(method, url, key, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Token {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")


def main():
    key = os.environ.get("BUTTONDOWN_API_KEY", "").strip()
    today = dt.date.today()
    eds = []
    for f in sorted((ROOT / "newsletters").glob("*.md")):
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", f.read_text(encoding="utf-8"), re.S)
        if not m:
            continue
        fm, body = yaml.safe_load(m.group(1)) or {}, m.group(2).strip()
        send_on = fm.get("send_on")
        if isinstance(send_on, str):
            send_on = dt.date.fromisoformat(send_on)
        if fm.get("subject") and send_on and send_on >= today:
            eds.append((f.name, fm["subject"], body))
    if not eds:
        note("notice", "Newsletter", "No edition due (no newsletters/*.md with send_on today or later).")
        return 0
    if not key:
        note("warning", "Newsletter", "BUTTONDOWN_API_KEY is not set, so nothing was put into Buttondown. Due: "
             + "; ".join(f"{n}: {s}" for n, s, _ in eds))
        return 0
    try:
        held = set()
        url = API + "?page_size=100"
        while url:
            page = call("GET", url, key)
            held |= {e.get("subject", "") for e in page.get("results", [])}
            url = page.get("next")
    except urllib.error.HTTPError as e:
        note("error", "Newsletter", f"Buttondown refused the key or the request (HTTP {e.code}): {e.read().decode()[:300]}")
        return 1
    out = []
    for name, subject, body in eds:
        if subject in held:
            out.append(f"{name}: already in Buttondown, skipped")
            continue
        try:
            r = call("POST", API, key, {"subject": subject, "body": body, "status": "draft"})
            out.append(f"{name}: draft created ({r.get('id', '?')}). Read it and send it from Buttondown.")
        except urllib.error.HTTPError as e:
            out.append(f"{name}: FAILED (HTTP {e.code}) {e.read().decode()[:300]}")
    failed = any("FAILED" in x for x in out)
    note("error" if failed else "notice", "Newsletter", "\n".join(out))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Send each new article's social posts to Buffer (Facebook, Instagram, X).

Runs in the deploy workflow after the site is live (GitHub Actions has the
BUFFER_API_KEY secret; the cloud session's shell cannot reach Buffer).

  python post_social.py            post today's and yesterday's packs that are not in Buffer yet
  python post_social.py --check    read-only: list the connected channels and the API's input shapes
  python post_social.py --pack social/2026-10-06-slug   post one named pack

Results are written as GitHub annotations (::notice / ::error) so they can be
read back from the run without opening the log. Never prints the key.
"""
import argparse, datetime as dt, json, os, pathlib, re, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).parent
API = "https://api.buffer.com"
KEY = os.environ.get("BUFFER_API_KEY", "").strip()


def say(level, msg):
    """GitHub annotation; newlines must be escaped for workflow commands."""
    esc = str(msg).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{level}::{esc}", flush=True)


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + KEY,
        "User-Agent": "dontdieretired-site/1.0 (+https://dontdieretired.com)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='replace')[:600]}")
    if out.get("errors"):
        raise RuntimeError("; ".join(e.get("message", "?") for e in out["errors"])[:900])
    return out["data"]


def channels():
    orgs = gql("query { account { organizations { id name } } }")["account"]["organizations"]
    found = []
    for o in orgs:
        for c in gql("query($o: OrganizationId!) { channels(input: {organizationId: $o}) { id name service } }",
                     {"o": o["id"]})["channels"]:
            found.append({**c, "org": o["id"]})
    return found


# ---------------------------------------------------------------- --check

TYPE_Q = """query($n: String!) { __type(name: $n) { name kind
  inputFields { name type { ...T } } fields { name type { ...T } }
  enumValues { name } possibleTypes { name } } }
fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }"""


def tstr(t):
    if t["kind"] == "NON_NULL": return tstr(t["ofType"]) + "!"
    if t["kind"] == "LIST": return "[" + tstr(t["ofType"]) + "]"
    return t["name"]


def base(t):
    while t.get("ofType"): t = t["ofType"]
    return t["name"]


def check():
    lines = []
    try:
        ch = channels()
        lines.append("CHANNELS " + ", ".join(f"{c['service']}:{c['name']}" for c in ch) or "none")
    except Exception as e:
        say("error", f"Buffer check failed at channels: {e}"); return 1
    seen, todo = set(), ["CreatePostInput", "PostsInput", "Post", "PostActionPayload"]
    keep_meta = {"instagram", "facebook", "twitter"}
    while todo:
        n = todo.pop(0)
        if n in seen or n in ("String", "Boolean", "Int", "Float", "ID", "DateTime"): continue
        seen.add(n)
        try:
            t = gql(TYPE_Q, {"n": n})["__type"]
        except Exception as e:
            lines.append(f"{n}: introspection failed: {e}"); continue
        if not t: lines.append(f"{n}: unknown"); continue
        if t["kind"] == "ENUM":
            lines.append(f"enum {n}: " + " ".join(v["name"] for v in t["enumValues"]))
        elif t["kind"] == "UNION":
            lines.append(f"union {n}: " + " ".join(p["name"] for p in t["possibleTypes"]))
        else:
            fs = t["inputFields"] or t["fields"] or []
            lines.append(f"{n}: " + ", ".join(f"{f['name']}:{tstr(f['type'])}" for f in fs))
            if t["kind"] == "INPUT_OBJECT":
                for f in fs:
                    if n == "PostInputMetaData" and f["name"] not in keep_meta: continue
                    todo.append(base(f["type"]))
            elif n == "Post":
                todo += [base(f["type"]) for f in fs if f["name"] in ("status", "assets")]
    text, level = "\n".join(lines), ["notice", "warning"]
    chunks = [text[i:i + 3000] for i in range(0, len(text), 3000)]
    for i, c in enumerate(chunks[:18]):
        say(level[i // 9], f"[check {i + 1}/{len(chunks)}]\n{c}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--pack")
    args = ap.parse_args()
    if not KEY:
        say("error", "BUFFER_API_KEY is not set, so nothing was sent to Buffer."); sys.exit(1)
    if args.check:
        sys.exit(check())
    say("error", "Posting is not switched on yet."); sys.exit(1)

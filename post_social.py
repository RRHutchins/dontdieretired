#!/usr/bin/env python3
"""Push a day's social pack to a scheduler (Buffer by default).
Requires env BUFFER_TOKEN and BUFFER_PROFILE_IDS (comma list) — or set SCHEDULER=publer with PUBLER_TOKEN.
Usage: python post_social.py social/2026-09-27-slug
Runs on the daily job after build.py. Safe to re-run: skips packs with a .posted marker.
"""
import json, os, sys, pathlib, urllib.request, urllib.parse
pack = pathlib.Path(sys.argv[1]); meta = json.loads((pack / "meta.json").read_text())
marker = pack / ".posted"
if marker.exists(): sys.exit("already posted")
token = os.environ.get("BUFFER_TOKEN"); profiles = os.environ.get("BUFFER_PROFILE_IDS", "").split(",")
if not token or not profiles[0]:
    sys.exit("No scheduler credentials set — posts are in posts.md for manual/Zapier posting.")
# Buffer's public API accepts one update per profile; each profile maps to a network.
NETWORK_TEXT = {"facebook": meta["posts"]["facebook"], "instagram": meta["posts"]["instagram"],
                "x": meta["posts"]["x"], "linkedin": meta["posts"]["linkedin"], "pinterest": meta["posts"]["pinterest"]}
for pid in profiles:
    net, _, prof = pid.partition(":")          # e.g. "facebook:5f3a...,x:5f3b..."
    body = {"profile_ids[]": prof, "text": NETWORK_TEXT.get(net, meta["posts"]["facebook"]),
            "media[link]": meta["url"], "shorten": "false", "now": "false"}
    data = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in body.items()).encode()
    req = urllib.request.Request("https://api.bufferapp.com/1/updates/create.json?access_token=" + token, data=data)
    with urllib.request.urlopen(req) as r: print(net, r.status)
marker.write_text("ok")

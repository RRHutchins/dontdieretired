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

from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).parent
API = "https://api.buffer.com"
KEY = os.environ.get("BUFFER_API_KEY", "").strip()
SITE = "https://dontdieretired.com"
UK = ZoneInfo("Europe/London")
START_DATE = "2026-10-06"                # packs dated before this are never posted (no back-catalogue flood)
SLOTS_UK = ["13:00", "18:00", "08:00"]   # in order of preference: 13:00 UK is 8am US Eastern, 18:00 UK is 1pm. One slot per article
SERVICES = {"facebook": "facebook", "instagram": "instagram", "twitter": "x"}   # Buffer service -> key in meta.json posts


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


# ---------------------------------------------------------------- posting

def norm(t):
    return re.sub(r"\s+", " ", t or "").strip()


def existing_posts(org, channel_ids):
    """The 50 newest posts Buffer holds for our channels (any state), for de-duplication and slot picking."""
    q = """query($o: OrganizationId!, $c: [ChannelId!]) {
      posts(first: 50, input: {organizationId: $o, filter: {channelIds: $c},
                               sort: [{field: createdAt, direction: desc}]}) {
        edges { node { id text status dueAt sentAt channelId channelService externalLink error { message } } } } }"""
    return [e["node"] for e in gql(q, {"o": org, "c": channel_ids})["posts"]["edges"]]


def kind_of(slug):
    """'guide' or 'story', read from the article's front matter (file names do not always match the slug)."""
    for f in (ROOT / "content" / "articles").glob("*.md"):
        head = f.read_text(encoding="utf-8")[:1500]
        if re.search(rf"^slug:\s*['\"]?{re.escape(slug)}['\"]?\s*$", head, re.M) or f.stem.endswith(slug):
            m = re.search(r"^kind:\s*['\"]?(\w+)", head, re.M)
            return m.group(1) if m else "story"
    return "story"


def packs_to_post(named=None):
    if named:
        return [pathlib.Path(named)]
    today = dt.datetime.now(UK).date()
    days = {d.isoformat() for d in (today, today - dt.timedelta(days=1))}
    found = [p for p in sorted((ROOT / "social").iterdir())
             if p.name[:10] in days and p.name[:10] >= START_DATE and (p / "meta.json").exists()]
    return sorted(found, key=lambda p: (p.name[:10], kind_of(p.name[11:]) == "guide", p.name))   # stories before guides


def wait_for(url, tries=12):
    """The deploy has finished, but give the CDN up to two minutes to serve a brand-new file."""
    import time
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "dontdieretired-site/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 200: return True
        except Exception:
            pass
        time.sleep(10)
    return False


def pick_slot(taken, now):
    """First free preferred UK slot still ahead today; if none, ten minutes from now, then every half hour."""
    for hhmm in SLOTS_UK:
        h, m = map(int, hhmm.split(":"))
        t = now.astimezone(UK).replace(hour=h, minute=m, second=0, microsecond=0)
        if t > now + dt.timedelta(minutes=10) and all(abs((t - x).total_seconds()) > 300 for x in taken):
            return t
    t = now + dt.timedelta(minutes=10)
    while any(abs((t - x).total_seconds()) < 1500 for x in taken):
        t += dt.timedelta(minutes=30)
    return t


CREATE = """mutation($input: CreatePostInput!) { createPost(input: $input) {
  __typename ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } } }"""


def post(named=None):
    packs = packs_to_post(named)
    if not packs:
        say("notice", "Social: no new article packs to post."); return 0
    ch = [c for c in channels() if c["service"] in SERVICES]
    missing = set(SERVICES) - {c["service"] for c in ch}
    if missing:
        say("warning", "Social: not connected in Buffer, so skipped: " + ", ".join(sorted(missing)))
    if not ch:
        say("error", "Social: Buffer has no Facebook, Instagram or X channel connected."); return 1
    have = existing_posts(ch[0]["org"], [c["id"] for c in ch])     # if this fails we stop: never post blind
    live = [p for p in have if p["status"] != "error"]
    now = dt.datetime.now(dt.timezone.utc)
    taken = [dt.datetime.fromisoformat(p["dueAt"].replace("Z", "+00:00")) for p in live
             if p["status"] in ("scheduled", "needs_approval") and p.get("dueAt")]
    failed, lines = 0, []
    for pack in packs:
        meta = json.loads((pack / "meta.json").read_text(encoding="utf-8"))
        slug = pack.name[11:]
        same = lambda c, pool: [p for p in pool if p["channelId"] == c["id"]
                                and norm(p["text"]) == norm(meta["posts"][SERVICES[c["service"]]])]
        # skip what Buffer already holds; retry a post that failed to publish once, not for ever
        todo = [c for c in ch if not same(c, live) and len(same(c, have)) < 2]
        if not todo:
            lines.append(f"{slug}: already in Buffer on every channel"); continue
        when = pick_slot(taken, now); taken.append(when)
        cards = {"instagram": f"{SITE}/static/social/{slug}.png", "twitter": f"{SITE}/static/img/{slug}.png"}
        for c in todo:
            svc = c["service"]
            inp = {"channelId": c["id"], "text": meta["posts"][SERVICES[svc]], "assets": [], "needsApproval": False,
                   "schedulingType": "automatic", "mode": "customScheduled",
                   "dueAt": when.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
            if svc == "facebook":      # link post: Facebook draws the preview card from the article's own og:image
                inp["metadata"] = {"facebook": {"type": "post", "linkAttachment": {
                    "url": meta["url"] + "?utm_source=facebook&utm_medium=social&utm_campaign=daily"}}}
            else:
                if not wait_for(cards[svc]):
                    failed += 1; lines.append(f"{slug} / {svc}: FAILED, image not live at {cards[svc]}"); continue
                inp["assets"] = [{"image": {"url": cards[svc], "metadata": {"altText": meta["title"][:400]}}}]
                if svc == "instagram":
                    inp["metadata"] = {"instagram": {"type": "post", "shouldShareToFeed": True}}
            try:
                r = gql(CREATE, {"input": inp})["createPost"]
            except Exception as e:
                r = {"__typename": "RequestError", "message": str(e)}
            if r["__typename"] == "PostActionSuccess":
                lines.append(f"{slug} / {svc}: {r['post']['status']} for {when.astimezone(UK):%a %d %b %H:%M} UK")
            else:
                failed += 1; lines.append(f"{slug} / {svc}: FAILED ({r['__typename']}) {r.get('message', '')[:300]}")
    # what happened to the posts already handed over: Buffer only reports a publishing failure after the event
    recent = [p for p in have if (p.get("sentAt") or p.get("dueAt") or "") >= (now - dt.timedelta(days=2)).strftime("%Y-%m-%d")]
    for p in recent:
        if p["status"] == "error":
            lines.append(f"EARLIER POST FAILED on {p['channelService']}: {((p.get('error') or {}).get('message') or 'no reason given')[:300]} | {norm(p['text'])[:60]}")
    sent = [p for p in recent if p["status"] == "sent"]
    lines.append(f"Last two days in Buffer: {len(sent)} published, "
                 f"{sum(p['status'] in ('scheduled', 'sending') for p in recent)} waiting, {sum(p['status'] == 'error' for p in recent)} failed")
    lines += [f"published on {p['channelService']}: {p['externalLink']}" for p in sent[:6] if p.get("externalLink")]
    bad = failed or any(p["status"] == "error" for p in recent)
    say("error" if failed else "warning" if bad else "notice", "Social posting\n" + "\n".join(lines))
    return 1 if failed else 0


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
    try:
        sys.exit(post(args.pack))
    except Exception as e:
        say("error", f"Social posting stopped before sending anything further: {e}"); sys.exit(1)

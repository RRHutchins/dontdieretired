#!/usr/bin/env python3
"""Post a one-off video (social_video/<date>-<slug>/meta.json) to every DDR channel in Buffer, straight away.

Runs in the deploy workflow's social job after the site (and so the .mp4) is live. Safe to re-run: a channel that
already holds a post with the same text is skipped, and a pack older than two days is never posted.
Video input shapes are read from the API by introspection at run time (logged as annotations), because Buffer's
schema for video, reels and Shorts was not visible from the cloud session. Added 25 Nov 2026 (Robin: "Deploy the post
immediately"; first video: the Christmas books).
"""
import datetime as dt, json, pathlib, sys, time, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import post_social as ps  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
CREATE = ps.CREATE if hasattr(ps, "CREATE") else None


def itype(name):
    t = ps.gql(ps.TYPE_Q, {"n": name})["__type"]
    return t or {}


def fields(name):
    t = itype(name)
    return {f["name"]: f["type"] for f in (t.get("inputFields") or [])}


def enum(name):
    return [v["name"] for v in (itype(name).get("enumValues") or [])]


def live(url, tries=20):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as r:
                if r.status == 200: return True
        except Exception:
            pass
        time.sleep(15)
    return False


def main():
    today = dt.date.today()
    packs = [p for p in sorted((ROOT / "social_video").glob("*/meta.json"))
             if (today - dt.date.fromisoformat(p.parent.name[:10])).days <= 2]
    if not packs:
        ps.say("notice", "Video posts: nothing new."); return 0
    shapes = []
    ci = fields("CreatePostInput"); shapes.append("CreatePostInput: " + ", ".join(ci))
    asset_t = ps.base(ci["assets"]) if "assets" in ci else None
    af = fields(asset_t) if asset_t else {}; shapes.append(f"{asset_t}: " + ", ".join(af))
    vid_t = ps.base(af["video"]) if "video" in af else ps.base(af["videos"]) if "videos" in af else None
    vf = fields(vid_t) if vid_t else {}; shapes.append(f"{vid_t}: " + ", ".join(vf))
    vmeta_t = ps.base(vf["metadata"]) if "metadata" in vf else None
    vmf = fields(vmeta_t) if vmeta_t else {}
    if vmeta_t: shapes.append(f"{vmeta_t}: " + ", ".join(f"{k}:{ps.tstr(v)}" for k, v in vmf.items()))
    mode = enum(ps.base(ci["mode"])) if "mode" in ci else []; shapes.append("ShareMode: " + " ".join(mode))
    md = fields(ps.base(ci["metadata"])) if "metadata" in ci else {}
    svc_meta = {}
    for svc, f in md.items():
        sf = fields(ps.base(f)); svc_meta[svc] = sf
        shapes.append(f"{svc}: " + ", ".join(f"{k}:{ps.tstr(v)}" for k, v in sf.items()))
        if "type" in sf:
            shapes.append(f"  {svc} types: " + " ".join(enum(ps.base(sf['type']))))
    ps.say("notice", "Video post: API shapes\n" + "\n".join(shapes))
    if not vid_t:
        ps.say("error", "Video post: Buffer's asset input has no video field; nothing sent."); return 1

    ch = ps.channels()
    have = ps.existing_posts(ch[0]["org"], [c["id"] for c in ch]) if ch else []
    lines, failed = ["CHANNELS " + ", ".join(f"{c['service']}:{c['name']}" for c in ch)], 0
    for pack in packs:
        meta = json.loads(pack.read_text(encoding="utf-8"))
        if not live(meta["video"]):
            ps.say("error", f"Video post: {meta['video']} is not live; nothing sent."); return 1
        for c in ch:
            svc = c["service"]
            text = meta["posts"].get(svc)
            if not text:
                lines.append(f"{svc}: no text in the pack, skipped"); continue
            if any(p["channelId"] == c["id"] and ps.norm(p["text"]) == ps.norm(text) and p["status"] != "error" for p in have):
                lines.append(f"{svc}: already in Buffer"); continue
            v = {"url": meta["video"]}   # Buffer refuses thumbnailUrl; Instagram/TikTok/Pinterest take a thumbnailOffset
            if "metadata" in vf:
                m = {}
                if "title" in vmf: m["title"] = meta["title"]
                if "thumbnailOffset" in vmf and svc in ("instagram", "tiktok", "pinterest"): m["thumbnailOffset"] = 2000
                if m: v["metadata"] = m
            inp = {"channelId": c["id"], "text": text, "assets": [{"video": v}] if "video" in af else {"videos": [v]},
                   "needsApproval": False, "schedulingType": "automatic"}
            if "shareNow" in mode:
                inp["mode"] = "shareNow"
            else:
                inp["mode"] = "customScheduled"
                inp["dueAt"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            sm = svc_meta.get(svc) or {}
            mm = {}
            if "type" in sm:
                kinds = enum(ps.base(sm["type"]))
                for want in (("short",) if svc == "youtube" else ()) + ("reel", "regularVideo", "post"):
                    if want in kinds: mm["type"] = want; break
            if svc == "instagram" and "shouldShareToFeed" in sm: mm["shouldShareToFeed"] = True
            if "title" in sm: mm["title"] = meta["title"][:100]
            if "categoryId" in sm: mm["categoryId"] = "22"
            if "privacy" in sm: mm["privacy"] = "public"
            if mm: inp["metadata"] = {svc: mm}
            try:
                r = ps.gql(ps.CREATE, {"input": inp})["createPost"]
            except Exception as e:
                r = {"__typename": "RequestError", "message": str(e)}
            if r["__typename"] == "PostActionSuccess":
                lines.append(f"{svc}: {r['post']['status']}")
            else:
                failed += 1; lines.append(f"{svc}: FAILED ({r['__typename']}) {r.get('message', '')[:400]}")
    ps.say("error" if failed else "notice", "Video post\n" + "\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    if not ps.KEY:
        ps.say("error", "BUFFER_API_KEY is not set."); sys.exit(1)
    try:
        sys.exit(main())
    except Exception as e:
        ps.say("error", f"Video post stopped: {e}"); sys.exit(1)

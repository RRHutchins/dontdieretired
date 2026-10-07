#!/usr/bin/env python3
"""Openly licensed photographs from Wikimedia Commons (RUNBOOK §6l).

Runs in GitHub Actions (.github/workflows/photos.yml): the cloud session cannot reach Wikimedia.

  python tools/photos.py fetch [--research DIR]
      For every article whose front matter names a Commons file (`photo_file: "File:….jpg"`), ask the
      Commons API for that file's author and licence, refuse anything outside the licence list below,
      download it, and save two resized copies in static/photos/ (<slug>.jpg at 1600px wide,
      <slug>-800.jpg). The author, licence and source page are written to content/photo_credits.yaml,
      which the site prints under the picture and on /photo-credits/, and to docs/IMAGE_CREDITS.md.
      A photo is only resized, never cropped, retouched or drawn on.

  python tools/photos.py search --research DIR
      For every query in tools/photo_queries.yaml, list candidate files (title, size, author, licence,
      description) in DIR/candidates.json and save a small preview of each in DIR/<slug>/, so a
      session can look at them before choosing. The workflow pushes DIR to the `photo-research`
      branch, which is never deployed.

The build shows a photo only when the article also has `photo_checked: <date>`, which a session sets
after it has opened the downloaded file and looked at it. Until then the article keeps its artwork.
"""
import argparse, datetime as dt, html, io, json, pathlib, re, sys, time, urllib.error, urllib.parse, urllib.request

import yaml
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://commons.wikimedia.org/w/api.php"
UA = "DontDieRetiredPhotos/1.0 (https://dontdieretired.com/photo-credits/; hello@dontdieretired.com)"
CREDITS = ROOT / "content" / "photo_credits.yaml"
PHOTOS = ROOT / "static" / "photos"

# Licences we accept: public domain, CC0, and Creative Commons Attribution / Attribution-ShareAlike.
# Nothing "non-commercial" or "no derivatives" (Commons does not host those), no GFDL-only files.
OK_LICENCE = re.compile(r"^(cc0|public domain|pd\b.*|cc[ -]by(-sa)?[ -][1-4]\.[05]( [a-z-]+)?|cc by(-sa)? [1-4]\.[05].*)$", re.I)
META = "LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|Restrictions|UsageTerms|AttributionRequired|DateTimeOriginal"


def get(url, tries=4, binary=False):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                data = r.read()
            time.sleep(1.0)          # be a polite client
            return data if binary else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(8 * (i + 1)); continue
            raise
        except Exception:
            if i < tries - 1:
                time.sleep(5 * (i + 1)); continue
            raise


def text(s, n=300):
    """Plain text from the API's HTML snippets."""
    s = html.unescape(re.sub(r"<[^>]+>", " ", str(s or "")))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n]


def describe(page, width):
    ii = (page.get("imageinfo") or [{}])[0]
    em = {k: v.get("value", "") for k, v in (ii.get("extmetadata") or {}).items()}
    return {
        "file": page.get("title", ""),
        "page": ii.get("descriptionurl", ""),
        "width": ii.get("width", 0), "height": ii.get("height", 0), "mime": ii.get("mime", ""),
        "thumb": ii.get("thumburl", ""),
        "licence": text(em.get("LicenseShortName"), 60),
        "licence_url": text(em.get("LicenseUrl"), 200),
        "author": text(em.get("Artist"), 160),
        "credit_line": text(em.get("Credit"), 200),
        "description": text(em.get("ImageDescription"), 400),
        "restrictions": text(em.get("Restrictions"), 100),
        "taken": text(em.get("DateTimeOriginal"), 40),
    }


def info(title, width=1600):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": title, "prop": "imageinfo",
                                "iiprop": "url|size|mime|extmetadata", "iiurlwidth": width, "iiextmetadatafilter": META, "redirects": 1})
    pages = (get(f"{API}?{q}").get("query") or {}).get("pages") or {}
    for p in pages.values():
        if "imageinfo" in p:
            return describe(p, width)
    return None


def licence_ok(d):
    return bool(OK_LICENCE.match(d["licence"].strip()))


def front_matter(p):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", p.read_text(encoding="utf-8"), re.S)
    return yaml.safe_load(m.group(1)) if m else {}


def save_sizes(raw, slug):
    im = Image.open(io.BytesIO(raw))
    im = im.convert("RGB")
    out = {}
    for w, name in ((1600, f"{slug}.jpg"), (800, f"{slug}-800.jpg")):
        c = im.copy()
        if c.width > w:
            c = c.resize((w, round(c.height * w / c.width)), Image.LANCZOS)
        PHOTOS.mkdir(parents=True, exist_ok=True)
        c.save(PHOTOS / name, "JPEG", quality=82, optimize=True, progressive=True)
        out[w] = (c.width, c.height)
    return out


def write_credits_doc(credits):
    lines = ["# Image credits", "",
             "Every photograph on the site that we did not make ourselves, with its author, licence and source.",
             "Written by `tools/photos.py`; do not edit by hand. The same list is public at /photo-credits/.",
             "Each photo is resized for the web and not otherwise changed.", "",
             "| Article | File | Author | Licence | Source | Fetched |", "|---|---|---|---|---|---|"]
    for slug, c in sorted(credits.items()):
        lines.append(f"| {slug} | {c['file']} | {c['author']} | {c['licence']} | {c['page']} | {c['fetched']} |")
    (ROOT / "docs" / "IMAGE_CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def fetch():
    credits = (yaml.safe_load(CREDITS.read_text(encoding="utf-8")) if CREDITS.exists() else None) or {}
    done, refused = [], []
    wanted = {}
    for p in sorted((ROOT / "content" / "articles").glob("*.md")):
        fm = front_matter(p)
        if fm.get("photo_file"):
            wanted[fm.get("slug")] = str(fm["photo_file"]).strip()
    for slug, title in wanted.items():
        have = credits.get(slug, {})
        if have.get("file") == title and (PHOTOS / f"{slug}.jpg").exists():
            continue
        try:
            d = info(title)
            if not d:
                refused.append(f"{slug}: Commons has no file called {title}"); continue
            if not licence_ok(d):
                refused.append(f"{slug}: licence “{d['licence']}” is not on our list ({title})"); continue
            if not d["author"] and not re.match(r"^(cc0|public domain|pd)", d["licence"], re.I):
                refused.append(f"{slug}: no author given, so it cannot be credited ({title})"); continue
            if d["mime"] not in ("image/jpeg", "image/png"):
                refused.append(f"{slug}: {d['mime']} is not a photograph format we use ({title})"); continue
            sizes = save_sizes(get(d["thumb"], binary=True), slug)
        except Exception as e:
            refused.append(f"{slug}: could not fetch {title} ({type(e).__name__}: {e})"); continue
        credits[slug] = {"file": d["file"], "page": d["page"], "author": d["author"] or "Unknown author", "licence": d["licence"],
                         "licence_url": d["licence_url"], "description": d["description"], "restrictions": d["restrictions"],
                         "width": sizes[1600][0], "height": sizes[1600][1], "fetched": dt.date.today().isoformat()}
        done.append(slug)
    # an article that no longer names a photo gives it up
    for slug in [s for s in credits if s not in wanted]:
        for f in (PHOTOS / f"{slug}.jpg", PHOTOS / f"{slug}-800.jpg"):
            f.unlink(missing_ok=True)
        del credits[slug]
    CREDITS.write_text("# Written by tools/photos.py from the Wikimedia Commons API. Do not edit by hand.\n"
                       + yaml.safe_dump(credits, allow_unicode=True, sort_keys=True, width=200), encoding="utf-8")
    write_credits_doc(credits)
    msg = f"Photos: {len(credits)} held, {len(done)} fetched this run" + (f" ({', '.join(done)})" if done else "") + f"; {len(refused)} refused."
    if refused:
        print("::warning title=Photos::" + (msg + " Refused: " + " | ".join(refused)).replace("\n", " "))
    else:
        print("::notice title=Photos::" + msg)


def search(research):
    qfile = ROOT / "tools" / "photo_queries.yaml"
    queries = (yaml.safe_load(qfile.read_text(encoding="utf-8")) if qfile.exists() else None) or {}
    research.mkdir(parents=True, exist_ok=True)
    out, n = {}, 0
    for slug, qs in queries.items():
        seen, cands = set(), []
        for q in qs or []:
            if str(q).startswith("File:"):
                pages = []
                try:
                    d = info(str(q), 640)
                except Exception as e:
                    d = None
                if d: pages = [d]
            else:
                params = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
                                                 "gsrsearch": f"{q} filetype:bitmap", "gsrlimit": 10, "prop": "imageinfo",
                                                 "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 640, "iiextmetadatafilter": META})
                try:
                    res = (get(f"{API}?{params}").get("query") or {}).get("pages") or {}
                except Exception as e:
                    print(f"search failed for {q}: {e}"); continue
                pages = [describe(p, 640) for p in sorted(res.values(), key=lambda p: p.get("index", 99))]
            for d in pages:
                if d["file"] in seen or d["mime"] != "image/jpeg":
                    continue
                seen.add(d["file"])
                d["query"] = str(q)
                d["usable"] = licence_ok(d) and d["width"] >= 1400 and d["width"] >= d["height"] * 1.2
                if not d["usable"]:
                    continue
                i = len(cands) + 1
                try:
                    raw = get(d["thumb"], binary=True)
                    (research / slug).mkdir(parents=True, exist_ok=True)
                    im = Image.open(io.BytesIO(raw)).convert("RGB")
                    im.thumbnail((640, 640))
                    im.save(research / slug / f"{i:02d}.jpg", "JPEG", quality=70)
                    d["preview"] = f"{slug}/{i:02d}.jpg"
                except Exception as e:
                    d["preview"] = ""
                del d["thumb"]
                cands.append(d); n += 1
                if len(cands) >= 14:
                    break
            if len(cands) >= 14:
                break
        out[slug] = cands
    (research / "candidates.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"::notice title=Photo search::{n} candidates for {len(out)} articles written to the photo-research branch.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["fetch", "search"])
    ap.add_argument("--research", default="/tmp/photo-research")
    a = ap.parse_args()
    if a.mode == "fetch":
        fetch()
    else:
        search(pathlib.Path(a.research))
    sys.exit(0)

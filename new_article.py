#!/usr/bin/env python3
"""Scaffold a new article file with the front matter the site expects.
Usage: python new_article.py "Title" --category move --tags running,men --segments mover
Claude fills in the body, quotes and sources from verified reporting, then runs build.py.
"""
import argparse, datetime as dt, re, pathlib
ap = argparse.ArgumentParser()
ap.add_argument("title"); ap.add_argument("--category", required=True, choices=["move","eat","think","money","earn","connect","travel","tech","ai","explore","stories"])
ap.add_argument("--level", default="any", choices=["starter","active","advanced","any"], help="who the practical advice is pitched at")
ap.add_argument("--age", default="", help="age of the person in the story, if there is one")
ap.add_argument("--tags", default=""); ap.add_argument("--segments", default="")
ap.add_argument("--date", default=dt.date.today().isoformat())
a = ap.parse_args()
# House style (RUNBOOK §1a): no pronoun openers, no "X at 60. At 65 ..." formula, no "still"/"despite".
_t = a.title.strip()
_bad = []
if re.match(r"^(he|she|they|his|her)\b", _t, re.I): _bad.append("starts with a pronoun")
if re.search(r"\bat \d{2}\b.*[.!?] *at \d{2}\b", _t, re.I): _bad.append("uses the two-sentence age formula")
if re.search(r"\b(still|despite)\b", _t, re.I): _bad.append("uses 'still' or 'despite'")
if re.match(r"^(at \d{2}|an? \d{2}-year-old|\d{2}-year-old)", _t, re.I): _bad.append("leads with the age — lead with the person and the deed")
if re.search(r"\bat \d{2}\b|-year-old", _t, re.I): print("Warning: headline contains an age. House style is to keep the age for the standfirst unless it is itself the record.")
if _bad:
    raise SystemExit("Headline rejected (" + "; ".join(_bad) + "). See RUNBOOK §1a and rewrite it.")
slug = re.sub(r"[^a-z0-9]+", "-", a.title.lower()).strip("-")[:70]
p = pathlib.Path(__file__).parent / "content/articles" / f"{a.date}-{slug}.md"
p.write_text(f'''---
title: "{a.title}"
slug: {slug}
date: {a.date}
category: {a.category}
tags: [{a.tags}]
segments: [{a.segments}]
level: {a.level}
{("subject_age: " + a.age + chr(10)) if a.age else ""}hook: ""
lesson: ""
standfirst: ""
summary: ""
try_this:
  - ""
  - ""
  - ""
try_this_plus:
  - ""
  - ""
  - ""
sources:
  - {{title: "", publisher: "", date: "", url: ""}}
---
Body here. Quote only what the sources say. Link related articles with relative URLs.
''', encoding="utf-8")
print(p)

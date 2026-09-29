#!/usr/bin/env python3
"""Render a product and auto-tighten any section that spills a few lines onto an extra page.
Usage: python3 fit.py <id>  → out/<id>.pdf"""
import sys, subprocess, json, os, re
ID = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__)); PDF = f"{HERE}/out/{ID}.pdf"
def render(tight):
    env = dict(os.environ, TIGHT=json.dumps(tight))
    subprocess.run(["node", f"{HERE}/build_pdf.js", f"{HERE}/content/{ID}.json"], env=env, check=True, capture_output=True)
def pages():
    n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", PDF], capture_output=True, text=True).stdout).group(1))
    return n, [subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", PDF, "-"], capture_output=True, text=True).stdout for p in range(1, n + 1)]
tight = {}
for it in range(6):
    render(tight); n, txt = pages()
    secs = json.load(open(f"{HERE}/out/{ID}-sections.json"))
    cur, spills = 0, []
    for p in range(2, n):  # skip cover (1) and inside page (2 in list index 1)
        t = txt[p - 1]; norm = re.sub(r"\s+", " ", t)
        for i, title in enumerate(secs, 1):
            if re.sub(r"\*\*", "", title)[:22] in norm: cur = i
        dense = len(re.sub(r"\s", "", t))
        nxt = txt[p] if p < n else ""
        next_is_head = any(re.sub(r"\*\*", "", tt)[:22] in re.sub(r"\s+", " ", nxt) for tt in secs)
        if dense < 450 and (next_is_head or p == n - 1) and p > 2:
            spills.append((p, cur))
    if not spills: break
    changed = False
    for p, sec in spills:
        if tight.get(sec, 0) < 4: tight[sec] = tight.get(sec, 0) + 1; changed = True
    if not changed: break
print(ID, "pages", n, "tightened", tight, "remaining spills", spills if spills else "none")

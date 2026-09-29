#!/usr/bin/env python3
"""Gumroad cover (1280x720) and thumbnail (600x600) mock-ups from a rendered product PDF.
Usage: python3 build_mockup.py <id>   (needs out/<id>.pdf from build_pdf.js)"""
import sys, json, subprocess, glob, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ID = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__))
if ID == "bundle":
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    F = f"{HERE}/fonts"; serif = lambda s: ImageFont.truetype(f"{F}/fraunces-latin-900-normal.ttf", s)
    sans = lambda s: ImageFont.truetype(f"{F}/source-sans-3-latin-400-normal.ttf", s); sansb = lambda s: ImageFont.truetype(f"{F}/source-sans-3-latin-700-normal.ttf", s)
    ids = ["restart30","strong60","eatstrong","sharp","moneyreset","secondact","reconnect","slowtravel","techconfident"]
    covers = [Image.open(f"{HERE}/out/{i}-cover.png").convert("RGBA") for i in ids]
    def sh(img, h, ang):
        w = int(img.width*h/img.height); img = img.resize((w,h), Image.LANCZOS); pad=30
        b = Image.new("RGBA",(w+2*pad,h+2*pad),(0,0,0,0)); s_ = Image.new("RGBA", b.size,(0,0,0,0))
        ImageDraw.Draw(s_).rectangle([pad+5,pad+10,pad+w+5,pad+h+10], fill=(0,0,0,120)); b.alpha_composite(s_.filter(ImageFilter.GaussianBlur(12))); b.alpha_composite(img,(pad,pad))
        return b.rotate(ang, resample=Image.BICUBIC, expand=True)
    W,H=1280,720; bg=Image.new("RGBA",(W,H),"#1B1B1F"); d=ImageDraw.Draw(bg)
    d.text((70,92),"THE EVERYTHING BUNDLE",font=sansb(22),fill="#C98A2B")
    d.text((70,130),"All nine plans",font=serif(64),fill="#FFFDF9"); d.text((70,200),"and workbooks",font=serif(64),fill="#FFFDF9")
    y=300
    for t in ["Move · Eat · Think · Money · Earn","Connect · Travel · Tech","200+ printable pages","Every new release for a year"]:
        d.ellipse([70,y+8,86,y+24],fill="#C98A2B"); d.text((98,y),t,font=sans(27),fill="#EDE9E1"); y+=42
    d.text((70,H-70),"Don't Die Retired  ·  dontdieretired.com",font=sansb(18),fill="#9a9aa3")
    pos=[(610,40,-8),(735,30,-3),(860,40,3),(985,60,8),(645,250,-5),(770,240,0),(895,250,5),(1015,270,9),(765,440,-2)]
    for (x,y,a),c in zip(pos,covers): bg.alpha_composite(sh(c,300,a),(x,y))
    bg.convert("RGB").save(f"{HERE}/out/bundle-gumroad-cover.png", optimize=True)
    T=Image.new("RGBA",(600,600),"#1B1B1F")
    for k,(x,y,a) in enumerate([(20,30,-8),(160,20,-2),(300,30,6),(90,250,-4),(230,240,3)]): T.alpha_composite(sh(covers[k],260,a),(x,y))
    T.convert("RGB").save(f"{HERE}/out/bundle-gumroad-thumb.png", optimize=True); print("bundle mock-ups"); sys.exit()
C = json.load(open(f"{HERE}/content/{ID}.json"))
THEME = {"restart30": "#0B6E4F", "strong60": "#1B2A41", "eatstrong": "#A4452C", "sharp": "#1F4E79", "moneyreset": "#0F5E63",
         "secondact": "#8A4B08", "reconnect": "#6D2E72", "slowtravel": "#56662B", "techconfident": "#3A4556", "restart7-free": "#B23A48"}[ID]
pdf = f"{HERE}/out/{ID}.pdf"; tmp = f"/tmp/mock-{ID}"; os.makedirs(tmp, exist_ok=True)
pages = int([l for l in subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout.splitlines() if l.startswith("Pages")][0].split()[-1])
def page(n, res=110):
    for f in glob.glob(f"{tmp}/p{n}-*"): os.remove(f)
    subprocess.run(["pdftoppm", "-png", "-r", str(res), "-f", str(n), "-l", str(n), pdf, f"{tmp}/p{n}"], check=True)
    return Image.open(glob.glob(f"{tmp}/p{n}-*.png")[0]).convert("RGBA")
# pick interior pages: a section/tracker page roughly a third and two-thirds through
cover, inner1, inner2 = page(1), page(max(3, pages // 3)), page(max(4, 2 * pages // 3))
F = f"{HERE}/fonts"
def font(name, size):
    try: return ImageFont.truetype(f"{F}/{name}", size)
    except Exception: return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", size)
# woff2 isn't loadable by PIL; fall back to DejaVu for headline type on the mock-up
serif = lambda s: ImageFont.truetype(f"{F}/fraunces-latin-900-normal.ttf", s)
sans = lambda s: ImageFont.truetype(f"{F}/source-sans-3-latin-400-normal.ttf", s)
sansb = lambda s: ImageFont.truetype(f"{F}/source-sans-3-latin-700-normal.ttf", s)

def shadowed(img, h, angle=0):
    w = int(img.width * h / img.height); img = img.resize((w, h), Image.LANCZOS)
    pad = 40; base = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rectangle([pad + 6, pad + 12, pad + w + 6, pad + h + 12], fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(14)); base.alpha_composite(sh); base.alpha_composite(img, (pad, pad))
    return base.rotate(angle, resample=Image.BICUBIC, expand=True)

def wrap(d, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw: cur = t
        else: lines.append(cur); cur = w
    lines.append(cur); return lines

# ---- 1280x720 cover
W, H = 1280, 720; bg = Image.new("RGBA", (W, H), "#F4F1EA"); d = ImageDraw.Draw(bg)
d.rectangle([0, 0, 12, H], fill=THEME)
x = 70; y = 90
d.text((x, y), C["kind"].upper(), font=sansb(20), fill=THEME); y += 44
for line in wrap(d, C["title"], serif(60), 520): d.text((x, y), line, font=serif(60), fill="#1B1B1F"); y += 68
y += 6
for line in wrap(d, C["subtitle"], sans(27), 500): d.text((x, y), line, font=sans(27), fill="#3a3a3a"); y += 34
y += 26
for t in [f"{pages}-page printable PDF", "Beginner-friendly, step by step", "Trackers and tick boxes included", "UK & US friendly"]:
    d.ellipse([x, y + 7, x + 16, y + 23], fill=THEME); d.text((x + 28, y), t, font=sans(25), fill="#1B1B1F"); y += 38
d.text((x, H - 70), "Don't Die Retired  ·  dontdieretired.com", font=sansb(18), fill="#6b6b6b")
bg.alpha_composite(shadowed(inner2, 470, -7), (820, 150))
bg.alpha_composite(shadowed(inner1, 490, 4), (735, 110))
bg.alpha_composite(shadowed(cover, 540, -2), (610, 60))
bg.convert("RGB").save(f"{HERE}/out/{ID}-gumroad-cover.png", optimize=True)

# ---- 600x600 thumbnail
T = Image.new("RGBA", (600, 600), THEME)
T.alpha_composite(shadowed(inner1, 470, 6), (250, 60))
T.alpha_composite(shadowed(cover, 500, -3), (50, 25))
T.convert("RGB").save(f"{HERE}/out/{ID}-gumroad-thumb.png", optimize=True)
print("mock-ups:", ID, pages, "pages")

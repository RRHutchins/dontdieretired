#!/usr/bin/env python3
"""Make the outline shapes for the Get involved map (RUNBOOK §6h, "The map").

Source: Natural Earth 1:10m admin-1 states and provinces (public domain, naturalearthdata.com), from
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
Download that file anywhere, then:  python tools/build_map.py <path to the .geojson>
Writes content/map_shapes.json: SVG path data for the 50 US states plus DC (Alaska and Hawaii as insets)
and twelve UK areas (the nine English regions, Scotland, Wales, Northern Ireland). Run it again only to
change the shapes; the build reads the JSON and never needs the big file.
Needs: pip install shapely
"""
import json, math, pathlib, sys
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform

ROOT = pathlib.Path(__file__).resolve().parent.parent
UK_AREAS = {  # key: (label, Natural Earth geonunit, region or None for the whole nation)
    "north-east": ("North East England", "England", "North East"),
    "north-west": ("North West England", "England", "North West"),
    "yorkshire": ("Yorkshire and the Humber", "England", "Yorkshire and the Humber"),
    "east-midlands": ("East Midlands", "England", "East Midlands"),
    "west-midlands": ("West Midlands", "England", "West Midlands"),
    "east": ("East of England", "England", "East"),
    "london": ("London", "England", "Greater London"),
    "south-east": ("South East England", "England", "South East"),
    "south-west": ("South West England", "England", "South West"),
    "wales": ("Wales", "Wales", None),
    "scotland": ("Scotland", "Scotland", None),
    "northern-ireland": ("Northern Ireland", "Northern Ireland", None),
}


def albers(lon, lat, lon0=-96, lat0=23, p1=29.5, p2=45.5):
    r = math.radians
    n = (math.sin(r(p1)) + math.sin(r(p2))) / 2
    c = math.cos(r(p1)) ** 2 + 2 * n * math.sin(r(p1))
    rho = lambda la: math.sqrt(c - 2 * n * math.sin(r(la))) / n
    th = n * r(lon - lon0)
    return rho(lat) * math.sin(th), rho(lat0) - rho(lat) * math.cos(th)


def to_d(geom, fx, nd=1):
    """SVG path data for a (multi)polygon after projecting with fx(lon, lat) -> (x, y) in page units."""
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    out = []
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            pts = [fx(x, y) for x, y in ring.coords]
            if len(pts) < 4: continue
            out.append("M" + "L".join(f"{x:.{nd}f},{y:.{nd}f}" for x, y in pts[:-1]) + "Z")
    return "".join(out)


def fit(geoms, w, h, proj, pad=6):
    """Return fx mapping lon/lat into a w*h box (y down) for the union bounds of geoms under proj."""
    pts = [proj(x, y) for g in geoms for poly in ([g] if g.geom_type == "Polygon" else g.geoms) for x, y in poly.exterior.coords]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    s = min((w - 2 * pad) / (max(xs) - min(xs)), (h - 2 * pad) / (max(ys) - min(ys)))
    ox = pad + ((w - 2 * pad) - s * (max(xs) - min(xs))) / 2
    oy = pad + ((h - 2 * pad) - s * (max(ys) - min(ys))) / 2
    return lambda lon, lat: (ox + s * (proj(lon, lat)[0] - min(xs)), oy + s * (max(ys) - proj(lon, lat)[1]))


def main(src):
    feats = json.loads(pathlib.Path(src).read_text(encoding="utf-8"))["features"]
    # ---- UK: dissolve counties into the twelve areas
    gb = [f for f in feats if f["properties"].get("adm0_a3") == "GBR"]
    uk = {}
    for k, (label, unit, region) in UK_AREAS.items():
        parts = [shape(f["geometry"]).buffer(0) for f in gb if f["properties"].get("geonunit") == unit and (region is None or f["properties"].get("region") == region)]
        assert parts, f"no shapes for {k}"
        uk[k] = (label, unary_union(parts).buffer(0.004).buffer(-0.004).simplify(0.012, preserve_topology=True))
    k0 = math.cos(math.radians(54.5))
    ukfx = fit([g for _, g in uk.values()], 360, 560, lambda lon, lat: (lon * k0, lat))
    uk_out = [{"id": k, "name": label, "d": to_d(g, ukfx)} for k, (label, g) in uk.items()]
    # ---- US: states, lower 48 in Albers, Alaska and Hawaii as insets bottom left
    us = {f["properties"]["postal"]: (f["properties"]["name"], shape(f["geometry"]).buffer(0)) for f in feats if f["properties"].get("adm0_a3") == "USA"}
    W, H = 960, 600
    lower = {k: v for k, v in us.items() if k not in ("AK", "HI")}
    lfx = fit([g.simplify(0.02) for _, g in lower.values()], W, H - 20, albers, pad=10)
    us_out = []
    for k, (name, g) in sorted(lower.items()):
        us_out.append({"id": k, "name": name, "d": to_d(g.simplify(0.03 if k not in ("RI", "DC", "DE") else 0.005, preserve_topology=True), lfx)})
    ak_name, ak = us["AK"]
    ak = unary_union([p for p in (ak.geoms if ak.geom_type == "MultiPolygon" else [ak]) if p.bounds[0] < 0])  # drop the Aleutian tail that crosses 180°
    akfx_raw = fit([ak], 190, 130, lambda lon, lat: albers(lon, lat, lon0=-154, lat0=50, p1=55, p2=65))
    us_out.append({"id": "AK", "name": ak_name, "d": to_d(ak.simplify(0.08, preserve_topology=True), lambda x, y: (akfx_raw(x, y)[0] + 20, akfx_raw(x, y)[1] + H - 150))})
    hi_name, hi = us["HI"]
    hi = unary_union([p for p in (hi.geoms if hi.geom_type == "MultiPolygon" else [hi]) if p.bounds[0] > -161])  # the eight main islands only
    hifx_raw = fit([hi], 120, 80, lambda lon, lat: (lon * math.cos(math.radians(20.5)), lat))
    us_out.append({"id": "HI", "name": hi_name, "d": to_d(hi.simplify(0.01, preserve_topology=True), lambda x, y: (hifx_raw(x, y)[0] + 230, hifx_raw(x, y)[1] + H - 100))})
    out = {"source": "Natural Earth 1:10m admin-1 (public domain), simplified by tools/build_map.py",
           "uk": {"viewBox": "0 0 360 560", "areas": uk_out}, "us": {"viewBox": f"0 0 {W} {H}", "areas": us_out}}
    dest = ROOT / "content" / "map_shapes.json"
    dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB): {len(uk_out)} UK areas, {len(us_out)} US states")


if __name__ == "__main__":
    main(sys.argv[1])

"""Consensus scores for the Kit section (Robin, 20 Nov 2026: "use multiple reviews to select recommended products...
provide a score for products and recommend, like best according to reviews, cheapest but good, all-round value").

One content/kit/<type>.yaml per product type records the independent reviews read and what each said about each product.
This module turns that into a score out of 10 and a set of awards. The same maths is explained to readers on /kit/how-we-score/;
change both together.

Score (0 to 10), for a product mentioned in n of the N reviews read:
  coverage  = n / N                           how widely it is recommended (4 points)
  placement = mean of 3 (the review's overall pick), 2 (any other named award) or 1 (recommended without an award), / 3   (3 points)
  rating    = mean of the reviews' own star or number ratings, put on a 0 to 1 scale; where no review rated it, placement again   (3 points)
  score     = 10 * (0.4 * coverage + 0.3 * placement + 0.3 * rating), to one decimal place
Awards need a product to be recommended in at least 2 reviews (MIN_N) and are given in this order, each to a different product:
  top      "Top rated across reviews"          the highest score
  budget   "Best budget pick"                  the highest score in the lowest price band (only if it is not the top product)
  value    "All-round value"                   the highest score in the middle band
  premium  "Best if budget is no object"       the highest score in the top band, only if it beats the top product's placement
  for-<tag> "Reviewers' choice for <tag>"      a best_for tag supported by 2+ reviews: the highest-scoring product with that tag
Ties break on n, then placement.
"""
from __future__ import annotations

MIN_N = 2
PTS = {"top": 3, "named": 2, "listed": 1}
SKIP_TAGS = {"value", "budget", "cheap", "price", "overall", "best overall"}   # covered by the price-band awards


def _band(p, b):
    """Band from a UK price printed in the reviews; failing that, a US price against the US edges. Never a converted price."""
    if p.get("price_gbp") is not None:
        price, (lo, hi) = p["price_gbp"], b.get("edges") or [0, 0]
    elif p.get("price_usd") is not None and b.get("edges_usd"):
        price, (lo, hi) = p["price_usd"], b["edges_usd"]
    else:
        return ""
    return "£" if price < lo else ("££" if price <= hi else "£££")


def score_type(d: dict) -> dict:
    N = len(d.get("reviews") or [])
    rev = {r["id"]: r for r in d.get("reviews") or []}
    ranked = []
    for p in d.get("products") or []:
        vs = p.get("verdicts") or []
        n = len({v["review"] for v in vs})
        if not n or not N:
            continue
        cov = n / N
        place = sum(PTS[v["award"]] for v in vs) / (3 * len(vs))
        rts = [float(v["rating"]) / float(v["scale"]) for v in vs if v.get("rating") is not None and v.get("scale")]
        rating = sum(rts) / len(rts) if rts else place
        score = round(10 * (0.4 * cov + 0.3 * place + 0.3 * rating), 1)
        tags = {}
        for v in vs:
            for t in v.get("for") or []:
                tags.setdefault(t, set()).add(v["review"])
        ranked.append(dict(p, n=n, coverage=cov, placement=place, rating_avg=(round(sum(rts) / len(rts) * 10, 1) if rts else None),
                           n_rated=len(rts), score=score, band=_band(p, d.get("bands") or {}), tag_support={t: len(s) for t, s in tags.items()},
                           labels=[(rev.get(v["review"], {}).get("outlet", v["review"]), v.get("label") or "Recommended") for v in vs]))
    ranked.sort(key=lambda p: (-p["score"], -p["n"], -p["placement"], p["name"]))
    main = [p for p in ranked if p["n"] >= MIN_N]
    def pick(pool_all):
        awards, used = [], set()

        def give(key, label, pool, why):
            pool = [p for p in pool if p["id"] not in used]
            if pool:
                used.add(pool[0]["id"])
                awards.append({"key": key, "label": label, "product": pool[0], "why": why})

        give("top", "Top rated across reviews", pool_all, "the highest score: recommended most widely, placed highest and rated best")
        give("budget", "Best budget pick", [p for p in pool_all if p["band"] == "£"], "the highest score among the lowest-priced products")
        give("value", "All-round value", [p for p in pool_all if p["band"] == "££"], "the highest score in the middle price band")
        if awards and awards[0]["key"] == "top":
            top = awards[0]["product"]
            give("premium", "Best if budget is no object", [p for p in pool_all if p["band"] == "£££" and p["placement"] > top["placement"]],
                 "the highest-placed product in the top price band")
        tagc = {}
        for p in pool_all:
            for t, k in p["tag_support"].items():
                if k >= MIN_N and t not in SKIP_TAGS:
                    tagc[t] = tagc.get(t, 0) + k
        for t in sorted(tagc, key=lambda t: -tagc[t])[:3]:
            give("for-" + t, f"Reviewers' choice for {t}", [p for p in pool_all if p["tag_support"].get(t, 0) >= MIN_N],
                 f"the highest score among products at least {MIN_N} reviews pick out for {t}")
        return awards

    # Picks by market (20 Nov 2026): a UK reader's picks come only from products that at least one UK review recommends, a US
    # reader's from products at least one US review recommends, so nobody is pointed at kit their own country's reviewers never
    # covered. Scores are the same for everyone. Which set a reader sees follows the site's region (app.js, body[data-region]).
    def market(p, m):
        return any(rev.get(v["review"], {}).get("country") == m for v in p.get("verdicts") or [])
    awards = pick([p for p in main if market(p, "UK")])
    awards_us = pick([p for p in main if market(p, "US")])
    for a in awards:
        a["product"]["awards"] = a["product"].get("awards", []) + [a["label"]]
    for a in awards_us:
        a["product"]["awards_us"] = a["product"].get("awards_us", []) + [a["label"]]
    return {"N": N, "ranked": ranked, "main": main, "also": [p for p in ranked if p["n"] < MIN_N], "awards": awards, "awards_us": awards_us,
            "uk": sum(1 for r in rev.values() if r.get("country") == "UK"), "us": sum(1 for r in rev.values() if r.get("country") == "US")}

# Evergreen content brief — Don't Die Retired

This brief governs every evergreen guide, article and product on dontdieretired.com. It sits alongside RUNBOOK.md (which governs the daily news-story articles).

## Non-negotiables (honesty)
1. **Nothing invented.** No made-up people, names, ages, quotes, testimonials, reader stories, case studies or "one of our readers". If you want an example, write it as a clearly hypothetical illustration ("Suppose you're 58 and…"), never as a person who exists.
2. **No statistics you have not verified.** Every number, guideline or research claim must come from a source you have actually fetched and read, and that source must be listed in `sources`. If you can't verify it, leave it out. Established general knowledge (muscles weaken without use; walking is low-impact) needs no citation; specific figures do.
3. **Preferred sources:** NHS, NICE, UK Chief Medical Officers' guidelines, WHO, CDC, US Physical Activity Guidelines, British Dietetic Association, British Heart Foundation, Royal Osteoporosis Society, Alzheimer's Society, Age UK, AARP, MoneyHelper, Gov.uk, Citizens Advice, FCA, FTC, National Cyber Security Centre, Which?, Ramblers, Sport England, National Institute on Aging. Academic papers are fine if you fetched them. Avoid content farms and other blogs.
4. **No medical, dietary or financial advice.** Frame as general information; "check with your GP (family doctor)" for exercise and diet changes; "this is general information, not financial advice — a regulated adviser can look at your own situation" for money. Never give doses, supplement regimes, or specific investment recommendations.
5. **No ageist framing.** No "despite their age", no "still", no body-shaming, no "seniors" as a label (say "people over 50", "in your sixties").
6. **Positive and plain.** Encouraging, practical, warm, occasionally funny. No hype, no "you must", no guilt.

## Audience and voice
- Readers are 50–85, UK (~40%) and USA (~40%), plus rest of world. Assume intelligent adults with no specialist knowledge.
- **British spelling**, but gloss UK-only terms on first use: "GP (family doctor)", "NHS (the UK health service)", "State Pension (the UK's government pension; Social Security in the US)". Give distances and weights in both units where they matter; money as £/$ where it matters.
- Second person ("you"), short paragraphs, sub-headings every 150–250 words, one idea per section.
- Every article ends with practical steps the reader can take this week.

## Article front matter (content/articles/YYYY-MM-DD-slug.md)
```
---
title: "Plain, specific, benefit-led title"
slug: kebab-case-slug
date: 2026-09-28
kind: guide            # guide = evergreen (pillar or article); omit for daily news stories
pillar: true           # only on the ONE pillar guide per category
category: eat          # move | think | earn | connect | eat | money | travel | tech
tags: [protein, cooking, beginner]
segments: [restarter, mover]   # from site.yaml audience_segments: restarter, mover, learner, carer, changer
hook: "≤120 chars, the one-line takeaway used on social cards"
lesson: "One sentence: what to do about it."
standfirst: "One or two sentences under the title."
summary: "Two sentences for cards and search."
try_this:
  - "A concrete action for this week."
  - "Another."
  - "Another."
sources:
  - {title: "Page title", publisher: "NHS", date: "2024", url: "https://..."}
---
Body in Markdown.
```
- Pillar guides: 1,200–1,600 words, a "Start here" overview of the whole category, linking to the category's other articles by relative URL `/<category>/<slug>/` and to the category's product with `/shop/#<product-id>`.
- Standard articles: 700–1,000 words, one specific question answered well, linking to the pillar guide and one other article.
- Mention the category's product once, naturally, where it genuinely helps ("If you want this laid out week by week, our Eat Strong planner does exactly that"), never more than once in the body.

## Products (products/content/<id>.json → build_product.js → PDF)
- Own IP, printable, structured: a plan or workbook the reader can start on Monday. 12–25 pages when rendered.
- Same honesty rules. Disclaimer text set in the JSON `disclaimer` field (exercise, diet, money, or tech as appropriate).
- Block types available: h1, h2, p, lead, bullets, numbers, checklist, table {headers, rows, widths}, callout {title, text, color}, week {title, days:[{day, task, note}]}, quote {text, who — only from a fetched, named, public source}, pagebreak.

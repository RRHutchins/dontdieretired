# The guidance engine

A growing library of training guidance that every Don't Die Retired plan is built from (RUNBOOK §6r).

- `sources.yaml`: every source, with its tier (5 official health body or international consensus, 4 peer-reviewed research,
  3 governing body or route authority, 2 recognised coach or elite athlete, 1 general) and the date it was opened.
- `guidance.yaml`: statements in our own words, each with the sources for (and any against) it.
- `events/`: profiles of challenges (demands, the key session, how it builds).
- `python3 tools/engine.py check` validates everything, ranks every statement and writes `REPORT.md`.
- `python3 tools/engine.py plan <event> [--weeks N] [--level starter|active|advanced]` writes a plan to `plans/`.

A statement's weight is the sum of the best tier from each independent group of sources that supports it.
Core (weight 6 or more, or backed by tier 4-5 with nothing against) and supported (3 or more) statements are used in plans;
thin and contested ones are not, until better sources are found.

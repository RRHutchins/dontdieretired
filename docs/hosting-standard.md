# Hosting standard for Robin's websites

Agreed 23 Nov 2026. Applies to every site in the websites company (Paws on the Sand, Level Going,
Paddling Daze, Don't Die Retired and any new site). Any session working on a site follows it.

## Who does what

| Job | Where it runs | Why |
|---|---|---|
| Store the code and history | GitHub, private repo, in the websites company's organisation | Standard, free, works with Claude Code |
| Build and host the site | Cloudflare Pages, connected to the repo (build command `npm run build` or the site's own) | Builds on Cloudflare, so pushes use no GitHub Actions minutes |
| Forms, APIs, sign-in | Cloudflare Pages Functions or a Worker | Same account, no extra host |
| Customer and member data | Cloudflare D1 (or another database), Stripe, the email service | Never in the repo |
| Secrets (API keys) | Cloudflare variables and secrets, or GitHub Actions secrets | Never in a file in the repo |
| Data refreshes from outside sources | A GitHub Action, monthly at most, results to a review branch | Kept rare because these runs are the main cost |

## Rules for GitHub Actions (private repos have a monthly minutes allowance)

1. No build-and-deploy workflow. Cloudflare Pages deploys on push by itself.
2. No `push:` trigger on long data jobs. They run on a schedule or by hand (`workflow_dispatch`) only.
3. Schedules are monthly at most, spread over different days. Weekly or more needs Robin's OK.
4. Every workflow has `timeout-minutes` and a `concurrency` group, so a stuck or repeated run can't burn hours.
5. A bot commit that should not start other workflows ends its message with `[skip ci]`.
6. Jobs that take more than about an hour (route lines, whole-country fetches) are by hand only, and the session
   says roughly how many minutes a run will use before asking Robin to start it.
7. Before adding a new workflow, check usage in GitHub: Settings → Billing and licensing → Usage.

## Rules for code and data

- No API keys, passwords, tokens or customer details in any file, ever, including old commits.
  If one is found, tell Robin to rotate it (make a new key, revoke the old one), then remove it.
- Public data (OpenStreetMap and so on) can live in the repo; anything about a real customer can't.

## New site checklist

1. New private repo in the websites organisation.
2. Copy `package.json`, `tools/build.js` pattern and `docs/` layout from the nearest existing site.
3. Cloudflare → Workers & Pages → Create → Pages → connect the repo; set the build command and output folder.
4. Add the custom domain in the Cloudflare Pages project.
5. Secrets in Cloudflare (Settings → Variables and secrets), not in the repo.
6. Only add GitHub Actions for monthly data refreshes, following the rules above.

## Don't Die Retired: current exception and move plan

Until it moves, this repo is **public** and the site is built by `.github/workflows/deploy.yml` and served by
**GitHub Pages**. That is why it is public: on the free plan GitHub Pages and Actions minutes are free only for
public repos. Do **not** make the repo private before the move below, or the site goes offline and every
push starts using minutes. A scan of all 451 commits on 23 Nov 2026 found no API keys in the history.

Move to the standard (needs Robin in the Cloudflare dashboard; a session prepares and checks each step):

1. Cloudflare → Workers & Pages → Create → Pages → connect `dontdieretired`. Build command
   `pip install -r requirements.txt && python verify_videos.py && python build.py --no-social`, output `dist`,
   environment variable `PYTHON_VERSION=3.12`. (DejaVu fonts are only a fallback in build.py; the brand fonts are in the repo.)
2. Check the `*.pages.dev` preview matches the live site page for page.
3. Add `dontdieretired.com` and `www` as custom domains on that Pages project; Cloudflare swaps the DNS records.
4. Replace the build/deploy jobs in `deploy.yml` with the social step only (or move it to a Cloudflare deploy hook),
   then turn off GitHub Pages (Settings → Pages).
5. Only then make the repo private, and move it into the websites organisation.

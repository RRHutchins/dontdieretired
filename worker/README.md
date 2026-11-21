# Accounts Worker (Planner Plus)

Sign-in by emailed link for dontdieretired.com, on Cloudflare Workers + D1. See RUNBOOK §6t (day 12 in the build log) for the
design, the security review and what Robin sets up.

- `src/accounts.js`: all the logic (tested by `node tools/test_accounts.js`, which runs it against Node's own SQLite with the real migration).
- `src/plus.js` (day 14, Stripe), `src/gifts.js` (day 16, gift codes), `src/feed.js` (day 17, the members' live calendar feed at `/feed/<secret>.ics`, built with `static/planner.js` from the site's `/planner/activities.json`; tested by `node tools/test_feed.js`, which needs Python and the site's requirements for `tools/planner.py`).
- `src/index.js`: the Worker entry (a Worker module may export only handlers) and the hourly clean-up.
- `tools/e2e_plus.js` (day 20): the whole member journey in Chromium against this code and a stand-in Stripe (how to run it is at the top of the file).
- `migrations/`: the D1 schema. Add a new numbered file for any change; never edit an applied one.
- Deployed by `.github/workflows/worker.yml` once the four repository secrets exist.

Local test (no email sent; the link comes back in the response):

    cd worker
    printf 'SALT=local-test-salt-not-secret-123456\nSITE_ORIGIN=http://localhost:8000\nDEV_MAIL=1\n' > .dev.vars
    npx wrangler@3.114.0 d1 migrations apply ddr-accounts --local
    npx wrangler@3.114.0 dev --port 8787
    # in another shell, from the repo root:
    DDR_ACCOUNTS_API=http://localhost:8787 python3 build.py --no-social && (cd dist && python3 -m http.server 8000)
    # open http://localhost:8000/account/

## Stripe test and live mode (live switch added 21 Nov 2026)

- `STRIPE_SECRET_KEY` (repository secret) is always the **test** key. The **live** key goes in a separate repository secret, `STRIPE_LIVE_SECRET_KEY`.
- The workflow runs in live mode only when the repository variable `PLUS_STRIPE_MODE` is `live` **and** `STRIPE_LIVE_SECRET_KEY` exists (variable set without the key: the deploy stops). Any other value of the variable stops the deploy; unset or `test` means test mode.
- In live mode the deploy sets the Worker's `STRIPE_LIVE` var to `"1"` (it is `"0"` in `wrangler.toml` and is set afresh on every deploy), runs `stripe-setup.mjs` with `ALLOW_LIVE=1`, puts the live webhook's signing secret into `STRIPE_WEBHOOK_SECRET_LIVE`, and gives the Worker the live key last. The Worker checks webhooks with the secret for its key's mode (`hookSecret()` in `src/plus.js`), so going back to test never mixes the two.
- If the Worker has no webhook secret for the current mode, the deploy makes that mode's endpoint afresh so its secret is caught (Stripe shows it only once).
- Back to test: set `PLUS_STRIPE_MODE` to `test` (or delete it) and run the workflow (changing a variable does not start it; deleting the live key does not switch anything off). The test key goes back in only if `STRIPE_SECRET_KEY` still exists; without it payments are simply closed. Memberships and gifts made in one mode never count in the other.
- **Going back to test does not stop live billing.** Live subscriptions keep renewing in Stripe while their memberships stop counting here, and live webhook events are refused (no live secret in test mode; Stripe gives up after about three days). So a rollback with paying members means pausing or cancelling their subscriptions in the live Dashboard; and on switching to live again, resend the missed events from the Dashboard (Developers → Webhooks → the endpoint → failed events).
- If a run made a new endpoint but failed to put its secret, it says so: run the workflow again with `rotate_webhook` ticked.

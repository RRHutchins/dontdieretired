# Accounts Worker (Planner Plus)

Sign-in by emailed link for dontdieretired.com, on Cloudflare Workers + D1. See RUNBOOK §6t (day 12 in the build log) for the
design, the security review and what Robin sets up.

- `src/accounts.js`: all the logic (tested by `node tools/test_accounts.js`, which runs it against Node's own SQLite with the real migration).
- `src/index.js`: the Worker entry (a Worker module may export only handlers) and the hourly clean-up.
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

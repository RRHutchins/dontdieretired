// Entry point of the accounts Worker. The logic is in accounts.js (tested by tools/test_accounts.js).
// The hourly cron (wrangler.toml) deletes spent links, ended sessions and old throttle counts.
import { handle, tidy } from './accounts.js';

export default {
  fetch: (req, env) => handle(req, env),
  scheduled: (event, env, ctx) => { if (env.DB) ctx.waitUntil(tidy(env)); },
};

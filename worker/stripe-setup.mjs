// Sets up Planner Plus in Stripe (RUNBOOK §6t, day 14). Safe to run again: it only adds what is missing.
//   STRIPE_SECRET_KEY=sk_test_... node worker/stripe-setup.mjs [--secret-out FILE] [--rotate-webhook]
// Run by .github/workflows/worker.yml after each deploy, once Robin has added the STRIPE_SECRET_KEY repository secret.
//
// Makes: the "Planner Plus" product with a £2 monthly and a £20 yearly price, a "Planner Plus gift" product with a
// £20 one-off price (the gift, sold from day 16), all VAT-inclusive and found by lookup key; a Customer Portal set-up (cancel at
// the end of the paid period, switch monthly/yearly, change card, receipts); and the webhook endpoint
// https://api.dontdieretired.com/stripe/webhook. Its signing secret is shown by Stripe only when the endpoint is
// made, so it is written to --secret-out (for `wrangler secret put STRIPE_WEBHOOK_SECRET`) and never printed.
//
// TEST MODE ONLY: a live key is refused unless ALLOW_LIVE=1, which is Robin's step when he switches to live.
import { writeFileSync } from 'node:fs';
import { form, STRIPE_VERSION, LOOKUP, EVENTS } from './src/plus.js';

const KEY = process.env.STRIPE_SECRET_KEY || '';
const API_ORIGIN = process.env.API_ORIGIN || 'https://api.dontdieretired.com';
const SITE = process.env.SITE_ORIGIN || 'https://dontdieretired.com';
const args = process.argv.slice(2);
const out = args.includes('--secret-out') ? args[args.indexOf('--secret-out') + 1] : '';
const rotate = args.includes('--rotate-webhook');
const live = /^(sk|rk)_live_/.test(KEY);
if (!/^(sk|rk)_(test|live)_/.test(KEY)) { console.error('STRIPE_SECRET_KEY is not a Stripe secret key'); process.exit(1); }
if (live && process.env.ALLOW_LIVE !== '1') { console.error('Refusing a live key: Planner Plus is set up in test mode until Robin switches it (RUNBOOK §6t).'); process.exit(1); }

async function call(method, path, params) {
  let url = 'https://api.stripe.com/v1/' + path; const init = { method, headers: { authorization: `Bearer ${KEY}`, 'stripe-version': STRIPE_VERSION } };
  if (params && method === 'GET') url += '?' + form(params);
  else if (params) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = form(params); }
  const r = await fetch(url, init); const d = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${d && d.error && d.error.message}`);
  return d;
}
const say = s => console.log((live ? '[LIVE] ' : '[test] ') + s);

async function product(tag, name, description) {
  const list = await call('GET', 'products', { active: 'true', limit: 100 });
  const p = list.data.find(x => x.metadata && x.metadata.ddr === tag);
  if (p) { say(`product ${name}: exists (${p.id})`); return p.id; }
  const made = await call('POST', 'products', { name, description, metadata: { ddr: tag } });
  say(`product ${name}: made (${made.id})`); return made.id;
}
async function price(lookup, prod, amount, recurring, nickname) {
  const list = await call('GET', 'prices', { 'lookup_keys[]': lookup, active: 'true', limit: 1 });
  const p = list.data[0];
  if (p) {
    if (p.unit_amount !== amount || p.currency !== 'gbp') console.warn(`WARNING: price ${lookup} is ${p.unit_amount} ${p.currency}, expected ${amount} gbp: not changed, check it in Stripe`);
    say(`price ${lookup}: exists (${p.id})`); return p.id;
  }
  const made = await call('POST', 'prices', { product: prod, currency: 'gbp', unit_amount: amount, tax_behavior: 'inclusive', lookup_key: lookup, nickname, ...(recurring ? { recurring: { interval: recurring } } : {}) });
  say(`price ${lookup}: made (${made.id})`); return made.id;
}

const plus = await product('plus', 'Planner Plus', "Don't Die Retired's planner: your year's activities on one calendar, with get-ready steps and trip links.");
const gift = await product('plus_gift', 'Planner Plus gift (12 months)', 'Twelve months of Planner Plus as a gift. Does not renew.');
const month = await price(LOOKUP.month, plus, 200, 'month', 'Planner Plus monthly, £2');
const year = await price(LOOKUP.year, plus, 2000, 'year', 'Planner Plus yearly, £20');
await price(LOOKUP.gift, gift, 2000, null, 'Planner Plus gift, £20');

const confs = await call('GET', 'billing_portal/configurations', { active: 'true', limit: 100 });
const PROFILE = { headline: "Don't Die Retired: manage your Planner Plus membership", privacy_policy_url: `${SITE}/privacy/`, terms_of_service_url: `${SITE}/planner-plus/terms/` };
const conf = confs.data.find(c => c.metadata && c.metadata.ddr === 'plus');
if (conf) {
  say('customer portal set-up: exists');
  // day 19 added the terms page: bring a set-up made before then up to date
  if (!conf.business_profile || conf.business_profile.terms_of_service_url !== PROFILE.terms_of_service_url) {
    await call('POST', 'billing_portal/configurations/' + conf.id, { business_profile: PROFILE }); say('customer portal set-up: terms link added');
  }
}
else {
  const c = await call('POST', 'billing_portal/configurations', {
    business_profile: PROFILE,
    features: {
      customer_update: { enabled: 'false' },
      invoice_history: { enabled: 'true' },
      payment_method_update: { enabled: 'true' },
      subscription_cancel: { enabled: 'true', mode: 'at_period_end' },
      subscription_update: { enabled: 'true', default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{ product: plus, prices: [month, year] }] },
    },
    metadata: { ddr: 'plus' },
  });
  say(`customer portal set-up: made (${c.id})`);
}

const hookUrl = `${API_ORIGIN}/stripe/webhook`;
const hooks = await call('GET', 'webhook_endpoints', { limit: 100 });
let mine = hooks.data.filter(h => h.url === hookUrl);
if (mine.length && rotate) { for (const h of mine) await call('DELETE', 'webhook_endpoints/' + h.id); say('webhook endpoint: removed to make a new secret'); mine = []; }
if (mine.length) {
  say('webhook endpoint: exists (its secret is already in the Worker; run with --rotate-webhook to replace it)');
  // day 16 added gift events: bring an older endpoint's list up to date (its secret does not change)
  for (const h of mine) {
    const have = new Set(h.enabled_events || []);
    if (!have.has('*') && EVENTS.some(e => !have.has(e))) { await call('POST', 'webhook_endpoints/' + h.id, { enabled_events: EVENTS }); say('webhook endpoint: events brought up to date'); }
  }
}
else {
  const h = await call('POST', 'webhook_endpoints', {
    url: hookUrl, api_version: STRIPE_VERSION, description: 'Planner Plus memberships (dontdieretired.com)', metadata: { ddr: 'plus' },
    enabled_events: EVENTS,
  });
  if (out) { writeFileSync(out, h.secret, { mode: 0o600 }); say('webhook endpoint: made; signing secret written for the Worker'); }
  else say('webhook endpoint: made, but no --secret-out was given: reveal its signing secret in Stripe and add it to the Worker');
}

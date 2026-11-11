// Planner Plus payments (RUNBOOK §6t, day 14): Stripe Checkout for the monthly and yearly subscriptions, Stripe's
// Customer Portal for cancelling and changing card, and a webhook that keeps each member's status. Called from
// accounts.js (which owns sessions, throttles and responses); tested by tools/test_plus.js.
//
// TEST MODE ONLY until Robin decides otherwise: a live key ("sk_live_" / "rk_live_") is refused unless the Worker
// has STRIPE_LIVE = "1", which only Robin sets, after he has tried the whole thing in test mode (house rules).
//
// Secrets (wrangler secret put, never in the repo): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Prices are found by their lookup keys (made by worker/stripe-setup.mjs), so no price ids live in config.
//
// What we keep: the member's Stripe customer id (on users) and, per subscription, its status, plan and the end of
// the paid period (memberships). No card details ever reach us: Stripe's own pages take the payment.
// Nothing personal goes in any URL: Checkout and the portal are reached by addresses Stripe makes for one visit.

import * as Gifts from './gifts.js';                 // day 16: gift codes, paid for through the same webhook

export const STRIPE_VERSION = '2025-03-31.basil';   // pinned, so Stripe's answers keep the shape this file reads
export const LOOKUP = { month: 'ddr_plus_month', year: 'ddr_plus_year', gift: 'ddr_plus_gift' };
const PLAN_OF = { [LOOKUP.month]: 'month', [LOOKUP.year]: 'year' };
// past_due: a renewal failed and Stripe is retrying; the member keeps Plus while it does (Stripe ends it if all fail)
export const MEMBER = new Set(['active', 'trialing', 'past_due']);
const DONE = new Set(['canceled', 'incomplete_expired']);   // final in Stripe: such a subscription never starts again
export const SIG_TOLERANCE = 300;            // seconds: a signed webhook older or newer than this is refused (replays)
export const HOOK_MAX = 65536;               // bytes: Stripe events are a few KB
const LIMIT_PAY_HOUR = 20;                   // checkout and portal visits per member per hour
export const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.dispute.created',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused',
  'customer.subscription.resumed'];   // worker/stripe-setup.mjs subscribes the webhook to exactly these
const EVENT_SET = new Set(EVENTS);
const TRIAL_MIN = 3 * 86400, TRIAL_MAX = 700 * 86400;   // Stripe wants a trial end at least 48 hours and at most two years ahead
const now = () => Math.floor(Date.now() / 1000);

// Payments are open only with a test key, or a live key that Robin has explicitly allowed.
export function keyMode(env) {
  const k = String(env.STRIPE_SECRET_KEY || '');
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  if (/^(sk|rk)_live_/.test(k)) return env.STRIPE_LIVE === '1' ? 'live' : null;
  return null;
}
export const payReady = env => !!keyMode(env) && /^whsec_/.test(String(env.STRIPE_WEBHOOK_SECRET || ''));

// Stripe's API takes form-encoded bodies with nested keys: a[b][0]=c
export function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
export async function stripe(env, method, path, params, idem) {
  const init = { method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'stripe-version': STRIPE_VERSION } };
  if (idem) init.headers['idempotency-key'] = idem;
  let url = 'https://api.stripe.com/v1/' + path;
  if (params && method === 'GET') url += '?' + form(params);
  else if (params) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = form(params); }
  try {
    const r = await fetch(url, init);
    let data = null; try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

// ---- webhook signature (Stripe's documented scheme: HMAC-SHA256 of "<t>.<raw body>", compared in constant time,
// only the v1 scheme, timestamp within the tolerance) ----
async function hmacHex(key, s) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifySignature(secret, header, raw, at = now()) {
  if (!secret || !header || typeof raw !== 'string') return false;
  let t = null; const v1 = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || !v1.length || Math.abs(at - t) > SIG_TOLERANCE) return false;
  const want = await hmacHex(secret, `${t}.${raw}`);
  let good = false; for (const s of v1) good = sameText(s, want) || good;   // check them all: no early exit
  return good;
}

// ---- prices and the portal set-up, found by lookup key / metadata and kept for ten minutes ----
const cache = new Map();
async function cached(key, fn) {
  const c = cache.get(key); if (c && c.until > Date.now()) return c.value;
  const value = await fn(); if (value) cache.set(key, { value, until: Date.now() + 600000 });
  return value;
}
export const clearCache = () => cache.clear();
export async function priceId(env, plan) {
  return cached('price:' + keyMode(env) + ':' + plan, async () => {
    const r = await stripe(env, 'GET', 'prices', { 'lookup_keys[]': LOOKUP[plan], active: 'true', limit: 1 });
    const p = r.ok && r.data && Array.isArray(r.data.data) ? r.data.data[0] : null;
    return p && p.lookup_key === LOOKUP[plan] ? p.id : null;
  });
}
async function portalConfig(env) {
  return cached('portal:' + keyMode(env), async () => {
    const r = await stripe(env, 'GET', 'billing_portal/configurations', { active: 'true', limit: 100 });
    const c = r.ok && r.data && Array.isArray(r.data.data) ? r.data.data.find(x => x.metadata && x.metadata.ddr === 'plus') : null;
    return c ? c.id : null;
  });
}

// ---- membership ----
// The member's best membership: one that gives Plus first, then the latest to end (a subscription before a gift on a
// tie, as it is the one that carries on). A gift (day 16, plan "gift", never renews) gives Plus until its end.
export function liveRow(m, t = now()) { return m.plan === 'gift' ? m.status === 'active' && (m.period_end || 0) > t : MEMBER.has(m.status); }
export async function membership(env, userId) {
  const rows = (await env.DB.prepare(`SELECT subscription, status, plan, period_end, cancel_at_end FROM memberships WHERE user_id = ?`).bind(userId).all()).results || [];
  const t = now();
  rows.sort((a, b) => (liveRow(b, t) - liveRow(a, t)) || ((b.period_end || 0) - (a.period_end || 0)) || ((a.plan === 'gift') - (b.plan === 'gift')));
  const m = rows[0];
  if (!m) return { member: false };
  const member = liveRow(m, t), gift = m.plan === 'gift';
  // the latest end of a gift still running, and whether a subscription is set to take over from it
  const gifts = rows.filter(r => r.plan === 'gift' && liveRow(r, t)).map(r => r.period_end);
  const next = rows.find(r => r.plan !== 'gift' && MEMBER.has(r.status) && !r.cancel_at_end);
  return { member, status: gift ? (member ? 'active' : 'ended') : m.status, plan: m.plan || null, until: m.period_end || null, ending: member && !!m.cancel_at_end,
    subscription: m.subscription, gift_until: gifts.length ? Math.max(...gifts) : null, then: gift && next ? (next.plan || 'subscription') : null };
}

// Read the subscription fresh from Stripe and store what it says now. Events can arrive late, twice or out of
// order (Stripe's documentation says so), so we never trust an event's own copy: every event just triggers this.
async function syncSubscription(env, subId, hintUser) {
  if (!/^sub_[A-Za-z0-9]{1,250}$/.test(String(subId || ''))) return true;
  const r = await stripe(env, 'GET', 'subscriptions/' + subId);
  if (r.status === 404) return true;
  if (!r.ok || !r.data || r.data.object !== 'subscription') return false;
  const sub = r.data, customer = typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id);
  if (!customer) return true;
  let user = await env.DB.prepare(`SELECT id FROM users WHERE stripe_customer = ?`).bind(customer).first();
  if (!user) {
    // first sight of this customer: the account comes from our own Checkout (client_reference_id, or the
    // subscription's metadata, both set by the Worker), and is linked only if it has no other customer yet
    for (const id of [hintUser, sub.metadata && sub.metadata.user_id]) {
      if (typeof id !== 'string' || !id) continue;
      const u = await env.DB.prepare(`UPDATE users SET stripe_customer = ? WHERE id = ? AND (stripe_customer IS NULL OR stripe_customer = ?) RETURNING id`).bind(customer, id, customer).first();
      if (u) { user = u; break; }
    }
  }
  if (!user) {
    // made by our own Checkout for an account that has since been deleted (paid in a tab left open, say): end it, so
    // nobody is charged for an account that no longer exists. Only for this site's own subscriptions.
    const md = sub.metadata || {};
    if (md.site === env.SITE_ORIGIN && typeof md.user_id === 'string' && !DONE.has(sub.status)) {
      const gone = !(await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?`).bind(md.user_id).first());
      if (gone) { const x = await stripe(env, 'DELETE', 'subscriptions/' + sub.id); return x.ok || x.status === 404; }
    }
    return true;   // not one of ours: nothing to keep
  }
  const item = sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const lk = item && item.price && item.price.lookup_key;
  const end = (item && item.current_period_end) || sub.current_period_end || null;
  const ending = sub.cancel_at_period_end || !!sub.cancel_at;
  await env.DB.prepare(`INSERT INTO memberships (subscription, user_id, status, plan, period_end, cancel_at_end, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subscription) DO UPDATE SET user_id = excluded.user_id, status = excluded.status, plan = excluded.plan, period_end = excluded.period_end, cancel_at_end = excluded.cancel_at_end, updated = excluded.updated
    WHERE memberships.status NOT IN ('canceled', 'incomplete_expired')`)   // a slower read of an earlier state never undoes an ending
    .bind(sub.id, user.id, String(sub.status || 'unknown').slice(0, 32), PLAN_OF[lk] || null, end, ending ? 1 : 0, now()).run();
  // Day 16 (review): a subscription that will renew while a gift still covers the member (they pressed "Renew" in the
  // portal after redeeming a gift behind it, or paid in another tab while redeeming) would charge for time the gift
  // already gives. Push its next payment to the gift's end instead (a trial, no proration): never two payments for one
  // stretch of time.
  if (MEMBER.has(sub.status) && !ending && end) {
    const g = await env.DB.prepare(`SELECT MAX(period_end) AS until FROM memberships WHERE user_id = ? AND plan = 'gift' AND status = 'active' AND period_end > ?`).bind(user.id, now()).first();
    const until = g && g.until;
    if (until && until > end + 86400 && until - now() >= TRIAL_MIN && until - now() <= TRIAL_MAX) {
      const x = await stripe(env, 'POST', 'subscriptions/' + sub.id, { trial_end: until, proration_behavior: 'none' }, 'ddr-gift-trial-' + sub.id + '-' + until);
      if (!x.ok) return false;   // Stripe will send the event again, and we try again
      await env.DB.prepare(`UPDATE memberships SET status = 'trialing', period_end = ? WHERE subscription = ?`).bind(until, sub.id).run();
    }
  }
  return true;
}

async function readCapped(req, max) {
  if (!req.body) return '';
  const reader = req.body.getReader(), parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* gone */ } return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size); let at = 0; for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

// POST /stripe/webhook: from Stripe, not the site, so no origin check: the signature is the check.
export async function webhook(env, req, h) {
  if (!payReady(env)) return h.json(env, { error: 'not configured' }, 503);
  if (Number(req.headers.get('content-length') || 0) > HOOK_MAX) return h.json(env, { error: 'too big' }, 413);
  const raw = await readCapped(req, HOOK_MAX);   // counted as it arrives, so a body without a length cannot run on
  if (raw === null) return h.json(env, { error: 'too big' }, 413);
  if (!(await verifySignature(env.STRIPE_WEBHOOK_SECRET, req.headers.get('stripe-signature'), raw))) return h.json(env, { error: 'signature' }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return h.json(env, { error: 'bad json' }, 400); }
  if (!ev || ev.object !== 'event' || typeof ev.type !== 'string') return h.json(env, { error: 'bad json' }, 400);
  if (!!ev.livemode !== (keyMode(env) === 'live')) return h.json(env, { ok: true, ignored: 'mode' });   // a test event never touches a live member, nor the other way round
  if (!EVENT_SET.has(ev.type)) return h.json(env, { ok: true, ignored: 'type' });
  const o = (ev.data && ev.data.object) || {};
  let done = true;
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    if (o.mode === 'subscription' && o.subscription) done = await syncSubscription(env, typeof o.subscription === 'string' ? o.subscription : o.subscription.id, o.client_reference_id);
    else if (o.mode === 'payment') done = await Gifts.fromCheckout(env, o.id);
  } else if (ev.type === 'charge.refunded') done = await Gifts.fromRefund(env, o.id);
  else if (ev.type === 'charge.dispute.created') done = await Gifts.fromDispute(env, o.id);
  else done = await syncSubscription(env, o.id);
  // a 500 makes Stripe try again later (it retries for up to three days)
  return done ? h.json(env, { ok: true }) : h.json(env, { error: 'stripe' }, 500);
}

// The account's one Stripe customer, made the first time it is needed, so every checkout and subscription of an
// account sits under the same customer (two tabs cannot make two). The idempotency key makes a repeat of the same
// request return the same customer.
export async function customerFor(env, s) {
  const u = await env.DB.prepare(`SELECT stripe_customer FROM users WHERE id = ?`).bind(s.id).first();
  if (!u) return null;
  if (u.stripe_customer) return u.stripe_customer;
  const c = await stripe(env, 'POST', 'customers', { email: s.email, metadata: { user_id: s.id, site: env.SITE_ORIGIN } }, 'ddr-customer-' + s.id);
  if (!c.ok || !c.data || !/^cus_\w+$/.test(String(c.data.id))) return null;
  await env.DB.prepare(`UPDATE users SET stripe_customer = ? WHERE id = ? AND stripe_customer IS NULL`).bind(c.data.id, s.id).run();
  const again = await env.DB.prepare(`SELECT stripe_customer FROM users WHERE id = ?`).bind(s.id).first();
  return again && again.stripe_customer;
}

// POST /plus/checkout {plan: "month" | "year"}: a signed-in account starts paying on Stripe's own page.
export async function checkout(env, s, body, h) {
  if (!payReady(env)) return h.json(env, { error: 'payments closed' }, 503);
  const plan = body.plan;
  if (plan !== 'month' && plan !== 'year') return h.json(env, { error: 'plan' }, 400);
  if (await h.over(env, 'pay', s.id, LIMIT_PAY_HOUR)) return h.json(env, { error: 'slow down' }, 429);
  // a member by a gift alone may choose a plan to follow it: the first payment is taken when the gift ends (a trial)
  const m = await membership(env, s.id);
  let trialEnd = null;
  if (m.member) {
    if (m.plan !== 'gift' || m.then) return h.json(env, { error: 'already' }, 409);
    const left = (m.gift_until || 0) - now();
    if (left > TRIAL_MAX) return h.json(env, { error: 'already' }, 409);
    if (left >= TRIAL_MIN) trialEnd = m.gift_until;   // under three days left: it starts now, a day or two early
  }
  const price = await priceId(env, plan);
  if (!price) return h.json(env, { error: 'payments closed' }, 503);
  const customer = await customerFor(env, s);
  if (!customer) return h.json(env, { error: 'stripe' }, 502);
  // ask Stripe, not only our table: a payment in another tab may not have reached us yet (review, day 14)
  const open = await stripe(env, 'GET', 'subscriptions', { customer, status: 'all', limit: 20 });
  if (!open.ok || !open.data || !Array.isArray(open.data.data)) return h.json(env, { error: 'stripe' }, 502);
  const live = open.data.data.filter(x => MEMBER.has(x.status) || x.status === 'incomplete');
  if (live.length) { for (const x of live) await syncSubscription(env, x.id, s.id); return h.json(env, { error: 'already' }, 409); }
  const site = env.SITE_ORIGIN;
  const r = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: s.id,                            // our opaque account id: how the webhook knows whose it is
    metadata: { user_id: s.id, site },
    subscription_data: { metadata: { user_id: s.id, site }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    customer,
    billing_address_collection: 'required',              // the buyer's country, for Norifico's VAT records
    success_url: `${site}/account/?plus=welcome`,
    cancel_url: `${site}/account/?plus=cancelled`,
  });
  const url = r.ok && r.data && r.data.url;
  if (typeof url !== 'string' || !url.startsWith('https://checkout.stripe.com/')) return h.json(env, { error: 'stripe' }, 502);
  return h.json(env, { ok: true, url });
}

// POST /plus/portal: Stripe's page for cancelling, switching between monthly and yearly, changing card and receipts.
export async function portal(env, s, h) {
  if (!payReady(env)) return h.json(env, { error: 'payments closed' }, 503);
  if (await h.over(env, 'pay', s.id, LIMIT_PAY_HOUR)) return h.json(env, { error: 'slow down' }, 429);
  const u = await env.DB.prepare(`SELECT stripe_customer FROM users WHERE id = ?`).bind(s.id).first();
  if (!u || !u.stripe_customer) return h.json(env, { error: 'no subscription' }, 404);
  const conf = await portalConfig(env);
  const r = await stripe(env, 'POST', 'billing_portal/sessions', { customer: u.stripe_customer, return_url: `${env.SITE_ORIGIN}/account/`, ...(conf ? { configuration: conf } : {}) });
  const url = r.ok && r.data && r.data.url;
  if (typeof url !== 'string' || !url.startsWith('https://billing.stripe.com/')) return h.json(env, { error: 'stripe' }, 502);
  return h.json(env, { ok: true, url });
}

// Deleting an account first deletes its Stripe customer, which ends every subscription it has at once (Stripe's rule),
// after closing any payment page still open, so nobody goes on paying for an account that has gone and Stripe no
// longer holds the address as our customer (its payment records stay with Stripe). false if Stripe could not be
// reached: the account is then kept, and the member is asked to try again.
export async function endSubscriptions(env, userId) {
  const u = await env.DB.prepare(`SELECT stripe_customer FROM users WHERE id = ?`).bind(userId).first();
  const customer = u && u.stripe_customer;
  if (!customer) return true;
  if (!keyMode(env)) return false;
  const open = await stripe(env, 'GET', 'checkout/sessions', { customer, status: 'open', limit: 100 });
  if (!open.ok || !open.data || !Array.isArray(open.data.data)) return false;
  for (const cs of open.data.data) {
    if (!/^cs_\w+$/.test(String(cs.id))) continue;
    const x = await stripe(env, 'POST', 'checkout/sessions/' + cs.id + '/expire');
    if (!x.ok && x.status !== 400 && x.status !== 404) return false;   // 400: it closed in the meantime
  }
  const d = await stripe(env, 'DELETE', 'customers/' + customer);
  return d.ok || d.status === 404;
}

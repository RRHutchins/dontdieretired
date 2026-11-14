// Planner Plus gifts (RUNBOOK §6t, day 16): a £20 one-off payment on Stripe Checkout makes one gift code, worth twelve
// months of Plus with no automatic renewal. Called from accounts.js (sessions, throttles, responses) and from the
// Stripe webhook in plus.js; tested by tools/test_gifts.js.
//
// The buyer is signed in (an account costs nothing), so the code is shown on their account page, where they can print
// the card as often as they like; the code never goes in an email, a URL or a log. Whoever is given the card signs in
// (or creates an account) and types the code. Codes are 16 characters from a 31-letter alphabet (about 79 bits),
// made with the Worker's cryptographic random source, work once (spent in one statement), and are kept only as a hash
// (to redeem) and an AES-GCM box under the GIFT_KEY secret (so the buyer can see it again until it is used).
//
// Secrets: GIFT_KEY (64 hex characters; made once by the deploy workflow and never changed, or unused codes could no
// longer be shown, though they would still redeem). Gifts are on sale only with payments set up and GIFT_KEY present.

import { stripe, payReady, keyMode, modeNow, priceId, customerFor, membership } from './plus.js';

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: easy to read off a card and type
export const CODE_LEN = 16;
export const GIFT_PRICE = 2000;                                  // pence; the price itself lives in Stripe (lookup key)
const LIMIT_REDEEM_MEMBER = 10, LIMIT_REDEEM_NET = 30;          // tries per hour
const LIMIT_GIFTS_LISTED = 50;
const now = () => Math.floor(Date.now() / 1000);

export const giftReady = env => payReady(env) && /^[0-9a-f]{64}$/.test(String(env.GIFT_KEY || ''));

export function newCode() {
  const out = [];
  while (out.length < CODE_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < CODE_LEN) out.push(ALPHABET[b % 31]);   // 248 = 8 × 31: no bias
    }
  }
  return out.join('');
}
export const showCode = c => c.match(/.{4}/g).join('-');
// What the member typed, made comparable: case, spaces and dashes do not matter. null if it cannot be a code.
export function normCode(s) {
  const c = String(s || '').toUpperCase().replace(/[\s\-–—.]/g, '');
  return c.length === CODE_LEN && [...c].every(ch => ALPHABET.includes(ch)) ? c : null;
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ddr-gift|' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const hexBytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const b64 = u => btoa(String.fromCharCode(...u));
const unb64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
async function aesKey(env) { return crypto.subtle.importKey('raw', hexBytes(env.GIFT_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function seal(env, id, code) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await aesKey(env), new TextEncoder().encode(code)));
  return b64(iv) + '.' + b64(ct);
}
export async function open(env, id, box) {
  try {
    const [iv, ct] = String(box || '').split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(id) }, await aesKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
// A snapshot of one account's memberships in one mode (bind: user id, mode), compared when a gift code is spent
const FPRINT = `(SELECT COALESCE(group_concat(f, ','), '') FROM (SELECT subscription || '/' || status || '/' || COALESCE(period_end, '') || '/' || cancel_at_end AS f FROM memberships WHERE user_id = ? AND mode = ? ORDER BY subscription))`;
// Twelve calendar months on from a moment (29 February runs to 1 March).
export function yearOn(t) { const d = new Date(t * 1000); d.setUTCFullYear(d.getUTCFullYear() + 1); return Math.floor(d.getTime() / 1000); }

// POST /gift/checkout: a signed-in account pays £20 on Stripe's own page for one gift.
export async function checkout(env, s, h) {
  if (!giftReady(env)) return h.json(env, { error: 'gifts closed' }, 503);
  if (await h.over(env, 'pay', s.id, 20)) return h.json(env, { error: 'slow down' }, 429);
  const price = await priceId(env, 'gift');
  if (!price) return h.json(env, { error: 'gifts closed' }, 503);
  const customer = await customerFor(env, s);
  if (!customer) return h.json(env, { error: 'stripe' }, 502);
  const site = env.SITE_ORIGIN, md = { kind: 'gift', user_id: s.id, site };
  const r = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: s.id,
    metadata: md,
    payment_intent_data: { metadata: md },
    customer,
    billing_address_collection: 'required',              // the buyer's country, for Norifico's VAT records
    success_url: `${site}/account/?gift=thanks`,
    cancel_url: `${site}/account/?gift=cancelled`,
  });
  const url = r.ok && r.data && r.data.url;
  if (typeof url !== 'string' || !url.startsWith('https://checkout.stripe.com/')) return h.json(env, { error: 'stripe' }, 502);
  return h.json(env, { ok: true, url });
}

// From the webhook: read the Checkout session fresh from Stripe (never the event's copy) and, if it is one of our
// gifts and fully paid, make its one gift. true = done (or nothing to do); false = ask Stripe to send it again.
export async function fromCheckout(env, csId) {
  if (!/^cs_[A-Za-z0-9_]{1,250}$/.test(String(csId || ''))) return true;
  const r = await stripe(env, 'GET', 'checkout/sessions/' + csId);
  if (r.status === 404) return true;
  if (!r.ok || !r.data || r.data.object !== 'checkout.session') return false;
  const cs = r.data, md = cs.metadata || {};
  if (cs.mode !== 'payment' || md.kind !== 'gift' || md.site !== env.SITE_ORIGIN) return true;   // not one of our gifts
  if (!!cs.livemode !== (keyMode(env) === 'live')) return true;
  if (cs.payment_status !== 'paid') return true;            // a slower payment method: async_payment_succeeded comes later
  if (cs.currency !== 'gbp' || cs.amount_total !== GIFT_PRICE) {
    // paid, but not what a gift costs (a price changed by hand in Stripe?): make the gift anyway, the buyer paid for it,
    // and say so in the log for Robin to look at
    console.warn('gift checkout with an unexpected amount', cs.id, cs.amount_total, cs.currency);
  }
  const exists = await env.DB.prepare(`SELECT id FROM gifts WHERE checkout = ?`).bind(cs.id).first();
  if (exists) return true;                                   // Stripe says things more than once
  if (!giftReady(env)) { console.error('gift not made: GIFT_KEY missing; Stripe will retry for three days', cs.id); return false; }
  const pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : (cs.payment_intent && cs.payment_intent.id) || null;
  // review: a payment refunded or disputed before this message reached us (Stripe retries for days) makes a dead gift
  let status = 'paid';
  if (pi) {
    const p = await stripe(env, 'GET', 'payment_intents/' + pi, { 'expand[]': 'latest_charge' });
    if (!p.ok || !p.data) return false;
    const ch = p.data.latest_charge;
    if (ch && typeof ch === 'object' && (ch.refunded === true || ch.disputed === true)) status = ch.disputed ? 'disputed' : 'refunded';
  }
  const buyer = typeof md.user_id === 'string' && (await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(md.user_id).first());
  const id = crypto.randomUUID(), code = newCode();
  await env.DB.prepare(`INSERT INTO gifts (id, code_hash, code_box, checkout, payment_intent, buyer_id, status, created, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(checkout) DO NOTHING`)
    .bind(id, await sha256(code), buyer && status === 'paid' ? await seal(env, id, code) : null, cs.id, pi, buyer ? buyer.id : null, status, now(), cs.livemode ? 'live' : 'test').run();
  if (!buyer) console.warn('gift paid for an account that has since been deleted: refund it in Stripe', cs.id);
  return true;
}

// From the webhook (charge.refunded): a gift refunded in full before it is used stops working. One already used is
// left alone: the person given it keeps their year (Robin decides any exception by hand).
export async function fromRefund(env, chargeId) {
  if (!/^(ch|py)_[A-Za-z0-9_]{1,250}$/.test(String(chargeId || ''))) return true;
  const r = await stripe(env, 'GET', 'charges/' + chargeId);
  if (r.status === 404) return true;
  if (!r.ok || !r.data || r.data.object !== 'charge') return false;
  const ch = r.data, pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : (ch.payment_intent && ch.payment_intent.id);
  if (!pi || ch.refunded !== true) return true;              // partly refunded: the gift stands
  await env.DB.prepare(`UPDATE gifts SET status = 'refunded', code_box = NULL WHERE payment_intent = ? AND status = 'paid'`).bind(pi).run();
  return true;
}

// From the webhook (charge.dispute.created): a payment disputed with the card issuer (a chargeback) cancels its gift if
// it has not been used, so a code bought with a stolen card cannot be passed on. Read fresh from Stripe.
export async function fromDispute(env, disputeId) {
  if (!/^(dp|du)_[A-Za-z0-9_]{1,250}$/.test(String(disputeId || ''))) return true;
  const r = await stripe(env, 'GET', 'disputes/' + disputeId);
  if (r.status === 404) return true;
  if (!r.ok || !r.data || r.data.object !== 'dispute') return false;
  const pi = typeof r.data.payment_intent === 'string' ? r.data.payment_intent : (r.data.payment_intent && r.data.payment_intent.id);
  if (!pi) return true;
  await env.DB.prepare(`UPDATE gifts SET status = 'disputed', code_box = NULL WHERE payment_intent = ? AND status = 'paid'`).bind(pi).run();
  return true;
}

// POST /gift/mine: the gifts this account has bought, newest first, with the code while it is unused.
export async function mine(env, s, h) {
  const rows = (await env.DB.prepare(`SELECT id, code_box, status, created, redeemed_at FROM gifts WHERE buyer_id = ? AND mode = ? ORDER BY created DESC, rowid DESC LIMIT ?`).bind(s.id, modeNow(env), LIMIT_GIFTS_LISTED).all()).results || [];
  const out = [];
  for (const g of rows) {
    const code = g.status === 'paid' && giftReady(env) ? await open(env, g.id, g.code_box) : null;
    out.push({ ref: g.id.slice(0, 8), status: g.status, bought: g.created, used: g.redeemed_at || null, code: code ? showCode(code) : null });
  }
  return h.json(env, { ok: true, gifts: out, open: giftReady(env) });
}

// POST /gift/redeem {code}: twelve months of Plus for this account, starting now, or when Plus it already has ends.
export async function redeem(env, req, s, body, h) {
  if (!payReady(env)) return h.json(env, { error: 'gifts closed' }, 503);
  if (await h.over(env, 'redeem', s.id, LIMIT_REDEEM_MEMBER)) return h.json(env, { error: 'slow down' }, 429);
  if (await h.over(env, 'redeem-net', h.netKey(req.headers.get('cf-connecting-ip')), LIMIT_REDEEM_NET)) return h.json(env, { error: 'slow down' }, 429);
  const code = normCode(body.code);
  if (!code) return h.json(env, { error: 'code' }, 400);
  // a code bought in the other Stripe mode (a test-card gift, once the key is live) is as good as no code (review, day 20)
  const g = await env.DB.prepare(`SELECT id, status, mode FROM gifts WHERE code_hash = ? AND mode = ?`).bind(await sha256(code), modeNow(env)).first();
  if (!g) return h.json(env, { error: 'code' }, 404);
  if (g.status === 'redeemed') return h.json(env, { error: 'used' }, 409);
  if (g.status !== 'paid') return h.json(env, { error: 'void' }, 410);   // refunded or disputed
  // when does the year start? Now, unless Plus already runs to a known end: then from that end, so nothing is lost.
  // A subscription that renews would bill on top of the gift, so the member is asked to stop its renewal first.
  // Two codes redeemed by one account at the same instant (or a webhook changing its membership meanwhile) must not
  // give overlapping years: the code is spent only if the account's memberships are still exactly as they were read
  // (FPRINT); otherwise read again and work the start out afresh, up to three times.
  for (let tries = 0; tries < 3; tries++) {
    const t = now();
    const fp = (await env.DB.prepare(`SELECT ${FPRINT} AS f`).bind(s.id, g.mode).first())?.f ?? null;
    const rows = (await env.DB.prepare(`SELECT subscription, status, plan, period_end, cancel_at_end FROM memberships WHERE user_id = ? AND mode = ?`).bind(s.id, g.mode).all()).results || [];
    let start = t;
    for (const m of rows) {
      const gift = m.plan === 'gift';
      const live = gift ? (m.period_end || 0) > t : ['active', 'trialing', 'past_due'].includes(m.status);
      if (!live) continue;
      if (!gift && !m.cancel_at_end) return h.json(env, { error: 'renewing', until: m.period_end || null }, 409);
      start = Math.max(start, m.period_end || t);
    }
    const until = yearOn(start);
    // spend the code and start the year together: either both happen or neither does, and a code spent by someone
    // else a moment earlier gives this account nothing (the INSERT only runs if this account is the one recorded)
    await env.DB.batch([
      env.DB.prepare(`UPDATE gifts SET status = 'redeemed', redeemed_by = ?, redeemed_at = ?, code_box = NULL WHERE id = ? AND status = 'paid' AND (SELECT ${FPRINT}) IS ?`).bind(s.id, t, g.id, s.id, g.mode, fp),
      env.DB.prepare(`INSERT OR IGNORE INTO memberships (subscription, user_id, status, plan, period_end, cancel_at_end, updated, mode)
        SELECT 'gift_' || id, ?, 'active', 'gift', ?, 1, ?, mode FROM gifts WHERE id = ? AND redeemed_by = ? AND redeemed_at = ? AND status = 'redeemed'`).bind(s.id, until, t, g.id, s.id, t),
    ]);
    const won = await env.DB.prepare(`SELECT period_end FROM memberships WHERE subscription = ? AND user_id = ?`).bind('gift_' + g.id, s.id).first();
    if (won) {
      const m = await membership(env, s.id);
      return h.json(env, { ok: true, from: start, until: won.period_end, plus: { member: m.member, plan: m.plan || null, until: m.until || null, ending: !!m.ending } });
    }
    const st = await env.DB.prepare(`SELECT status FROM gifts WHERE id = ?`).bind(g.id).first();
    if (!st || st.status !== 'paid') return h.json(env, st && st.status !== 'redeemed' ? { error: 'void' } : { error: 'used' }, st && st.status !== 'redeemed' ? 410 : 409);
  }
  return h.json(env, { error: 'busy' }, 503);   // the membership kept changing: nothing spent, try again
}

// Deleting an account: gifts it bought keep working (someone may have the card), but its copy of the codes goes;
// gifts it used stay used. Only our account ids are touched.
export function forget(env, userId) {
  return [
    env.DB.prepare(`UPDATE gifts SET buyer_id = NULL, code_box = NULL WHERE buyer_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE gifts SET redeemed_by = NULL WHERE redeemed_by = ?`).bind(userId),
  ];
}

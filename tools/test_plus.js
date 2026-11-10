// Tests for Planner Plus payments (worker/src/plus.js through worker/src/accounts.js, RUNBOOK §6t day 14).
// Run: node tools/test_plus.js. Stripe is a stand-in here (no network): it answers the calls the Worker makes the way
// Stripe's API does, and every webhook is signed the way Stripe signs them.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const crypto = require('crypto');
const d1 = require('./d1_stub.js');

const SITE = 'https://dontdieretired.com';
const WHSEC = 'whsec_test_0123456789abcdef';
const calls = [];
// ---- a stand-in for Stripe ----
let stripeDown = false;
const S = { subs: {}, n: 0, customers: {}, sessions: {}, idem: {}, configs: [{ id: 'bpc_other', metadata: {} }, { id: 'bpc_plus', metadata: { ddr: 'plus' } }] };
const PRICES = { ddr_plus_month: 'price_month', ddr_plus_year: 'price_year', ddr_plus_gift: 'price_gift' };
function parseForm(b) { const o = {}; for (const [k, v] of new URLSearchParams(b || '')) o[k] = v; return o; }
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  calls.push({ url, method, headers: init.headers || {}, body: parseForm(init.body) });
  const reply = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url.startsWith('https://api.resend.com/')) return reply({ id: 'm' });
  if (!url.startsWith('https://api.stripe.com/v1/')) throw new Error('unexpected fetch ' + url);
  if (stripeDown) return reply({ error: { message: 'down' } }, 500);
  const u = new URL(url), p = u.pathname.replace('/v1/', '');
  if (p === 'prices' && method === 'GET') {
    const lk = u.searchParams.get('lookup_keys[]');
    return reply({ object: 'list', data: PRICES[lk] ? [{ id: PRICES[lk], lookup_key: lk }] : [] });
  }
  if (p === 'billing_portal/configurations') return reply({ object: 'list', data: S.configs });
  if (p === 'customers' && method === 'POST') {
    const k = (init.headers || {})['idempotency-key'];
    if (k && S.idem[k]) return reply(S.customers[S.idem[k]]);
    const id = 'cus_m' + (++S.n); S.customers[id] = { id, object: 'customer' }; if (k) S.idem[k] = id; return reply(S.customers[id]);
  }
  const cu = /^customers\/(cus_\w+)$/.exec(p);
  if (cu && method === 'DELETE') {   // Stripe: deleting a customer cancels its subscriptions at once
    for (const x of Object.values(S.subs)) if (x.customer === cu[1]) x.status = 'canceled';
    delete S.customers[cu[1]]; return reply({ id: cu[1], deleted: true });
  }
  if (p === 'subscriptions' && method === 'GET') return reply({ object: 'list', data: Object.values(S.subs).filter(x => x.customer === u.searchParams.get('customer')) });
  if (p === 'checkout/sessions' && method === 'POST') {
    const id = 'cs_test_' + (++S.n); S.sessions[id] = { id, status: 'open', customer: parseForm(init.body).customer };
    return reply({ id, url: 'https://checkout.stripe.com/c/pay/' + id });
  }
  if (p === 'checkout/sessions' && method === 'GET') return reply({ object: 'list', data: Object.values(S.sessions).filter(x => x.customer === u.searchParams.get('customer') && x.status === 'open') });
  const ex = /^checkout\/sessions\/(cs_\w+)\/expire$/.exec(p);
  if (ex) { S.sessions[ex[1]].status = 'expired'; return reply(S.sessions[ex[1]]); }
  if (p === 'billing_portal/sessions' && method === 'POST') return reply({ id: 'bps_1', url: 'https://billing.stripe.com/p/session/test_1' });
  const m = /^subscriptions\/(sub_\w+)$/.exec(p);
  if (m) {
    const sub = S.subs[m[1]];
    if (!sub) return reply({ error: { type: 'invalid_request_error' } }, 404);
    if (method === 'DELETE') { sub.status = 'canceled'; return reply(sub); }
    return reply(sub);
  }
  return reply({ error: { message: 'no route ' + p } }, 404);
};
function makeSub(id, customer, o = {}) {
  S.subs[id] = { id, object: 'subscription', customer, status: 'active', cancel_at_period_end: false, cancel_at: null, metadata: o.metadata || {},
    items: { data: [{ current_period_end: o.end || 1900000000, price: { id: 'price_year', lookup_key: o.lk || 'ddr_plus_year' } }] }, ...(o.extra || {}) };
  return S.subs[id];
}
function sign(raw, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')},v0=deadbeef`;
}

(async () => {
  const W = await import('../worker/src/accounts.js');
  const P = await import('../worker/src/plus.js');
  let n = 0; const t = async (name, fn) => { calls.length = 0; stripeDown = false; P.clearCache(); await fn(); n++; console.log('ok  ' + name); };
  const env = (o = {}) => ({ DB: d1(), SALT: 'test-salt-0123456789', SITE_ORIGIN: SITE, MAIL_FROM: 'x', RESEND_API_KEY: 'k',
    STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, ...o });
  const req = (route, body, h = {}) => new Request('https://api.dontdieretired.com' + route, {
    method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const post = (e, route, body, h) => W.handle(req(route, body, h), e);
  const me = async (e, cookie) => (await W.handle(new Request('https://api.dontdieretired.com/auth/me', { headers: { cookie } }), e)).json();
  // sign in by reading the token straight from the email the stand-in "sent"
  const realFetch = globalThis.fetch; let lastMail = '';
  globalThis.fetch = async (url, init = {}) => { if (String(url).startsWith('https://api.resend.com/')) lastMail = JSON.parse(init.body).text; return realFetch(url, init); };
  const login = async (e, email = 'robin@example.com') => {
    await post(e, '/auth/start', { email });
    const tok = lastMail.match(/#t=([A-Za-z0-9_-]{43})/)[1];
    const r = await post(e, '/auth/verify', { token: tok }); const d = await r.json();
    return { cookie: `${W.COOKIE}=${(r.headers.get('set-cookie') || '').match(/__Host-ddr_s=([^;]*)/)[1]}`, id: d.account, email };
  };
  const hook = (e, ev, h = {}) => { const raw = JSON.stringify(ev); return W.handle(new Request('https://api.dontdieretired.com/stripe/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sign(raw), ...h }, body: raw }), e); };
  const evt = (type, object, o = {}) => ({ id: 'evt_' + Math.random().toString(36).slice(2), object: 'event', type, livemode: false, data: { object }, ...o });
  const completed = (sub, user, customer = 'cus_1') => evt('checkout.session.completed', { id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', subscription: sub, customer, client_reference_id: user });
  const stripeCalls = () => calls.filter(c => c.url.startsWith('https://api.stripe.com/'));

  await t('form encoding nests keys the way Stripe reads them', () => {
    assert.strictEqual(P.form({ a: 1, line_items: [{ price: 'p', quantity: 1 }], m: { k: 'a b&c' }, skip: undefined }),
      'a=1&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&m%5Bk%5D=a%20b%26c');
  });
  await t('signatures: only a v1 HMAC of "<t>.<body>" with our secret, inside five minutes', async () => {
    const raw = '{"a":1}', at = 1800000000;
    const good = sign(raw, WHSEC, at);
    assert.strictEqual(await P.verifySignature(WHSEC, good, raw, at), true);
    assert.strictEqual(await P.verifySignature(WHSEC, good, raw, at + 299), true);
    assert.strictEqual(await P.verifySignature(WHSEC, good, raw, at + 301), false, 'too old: a replay');
    assert.strictEqual(await P.verifySignature(WHSEC, good, raw, at - 301), false, 'from the future');
    assert.strictEqual(await P.verifySignature(WHSEC, good, '{"a":2}', at), false, 'body changed');
    assert.strictEqual(await P.verifySignature('whsec_other', good, raw, at), false, 'another secret');
    const v0only = `t=${at},v0=${crypto.createHmac('sha256', WHSEC).update(`${at}.${raw}`).digest('hex')}`;
    assert.strictEqual(await P.verifySignature(WHSEC, v0only, raw, at), false, 'v0 is never trusted');
    const two = `t=${at},v1=${'0'.repeat(64)},v1=${good.match(/v1=(\w+)/)[1]}`;
    assert.strictEqual(await P.verifySignature(WHSEC, two, raw, at), true, 'any one v1 may match (a secret being rolled)');
    for (const bad of ['', 'garbage', `t=abc,v1=${'a'.repeat(64)}`, `v1=${good.match(/v1=(\w+)/)[1]}`]) assert.strictEqual(await P.verifySignature(WHSEC, bad, raw, at), false, bad);
    assert.strictEqual(await P.verifySignature('', good, raw, at), false, 'no secret, no trust');
  });
  await t('test keys only: a live key is refused unless Robin sets STRIPE_LIVE', () => {
    assert.strictEqual(P.keyMode({ STRIPE_SECRET_KEY: 'sk_test_x' }), 'test');
    assert.strictEqual(P.keyMode({ STRIPE_SECRET_KEY: 'rk_test_x' }), 'test');
    assert.strictEqual(P.keyMode({ STRIPE_SECRET_KEY: 'sk_live_x' }), null);
    assert.strictEqual(P.keyMode({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_LIVE: '1' }), 'live');
    assert.strictEqual(P.keyMode({ STRIPE_SECRET_KEY: 'pk_test_x' }), null, 'a publishable key is not a secret key');
    assert.strictEqual(P.payReady({ STRIPE_SECRET_KEY: 'sk_test_x' }), false, 'no webhook secret: closed');
    assert.strictEqual(P.payReady({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC }), true);
  });
  await t('closed until set up: no buttons, checkout refused, webhook refused', async () => {
    const e = env({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }), a = await login(e);
    const m = await me(e, a.cookie); assert.strictEqual(m.payments, false); assert.strictEqual(m.plus.member, false);
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie })).status, 503);
    assert.strictEqual((await hook(e, completed('sub_1', a.id))).status, 503);
    const live = env({ STRIPE_SECRET_KEY: 'sk_live_x' }), b = await login(live);
    assert.strictEqual((await me(live, b.cookie)).payments, false);
    assert.strictEqual((await post(live, '/plus/checkout', { plan: 'year' }, { cookie: b.cookie })).status, 503);
    assert.strictEqual(stripeCalls().length, 0, 'Stripe never called');
  });
  await t('checkout needs a session, our origin, JSON and a real plan', async () => {
    const e = env(), a = await login(e);
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' })).status, 401);
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie, origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie, 'content-type': 'text/plain' })).status, 415);
    for (const plan of ['week', 'gift', '', null, 'YEAR']) assert.strictEqual((await post(e, '/plus/checkout', { plan }, { cookie: a.cookie })).status, 400, String(plan));
    assert.strictEqual(stripeCalls().length, 0);
  });
  await t('checkout makes one Stripe session for this account, with nothing personal in our URLs', async () => {
    const e = env(), a = await login(e);
    const r = await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie }); const d = await r.json();
    assert.strictEqual(r.status, 200); assert.ok(d.url.startsWith('https://checkout.stripe.com/'));
    const c = stripeCalls().find(x => x.url.endsWith('/checkout/sessions'));
    assert.strictEqual(c.headers.authorization, 'Bearer sk_test_abc'); assert.strictEqual(c.headers['stripe-version'], P.STRIPE_VERSION);
    assert.strictEqual(c.body.mode, 'subscription'); assert.strictEqual(c.body['line_items[0][price]'], 'price_year');
    assert.strictEqual(c.body.client_reference_id, a.id); assert.strictEqual(c.body['subscription_data[metadata][user_id]'], a.id);
    const cus = stripeCalls().find(x => x.url.endsWith('/customers'));
    assert.strictEqual(cus.body.email, 'robin@example.com'); assert.strictEqual(cus.body['metadata[user_id]'], a.id);
    assert.strictEqual(cus.headers['idempotency-key'], 'ddr-customer-' + a.id, 'a repeat cannot make a second customer');
    assert.strictEqual(c.body.customer, cus.url && e.DB.raw.prepare('SELECT stripe_customer FROM users').get().stripe_customer);
    assert.strictEqual(c.body.customer_email, undefined); assert.strictEqual(c.body['subscription_data[metadata][site]'], SITE);
    assert.strictEqual(c.body.success_url, SITE + '/account/?plus=welcome'); assert.strictEqual(c.body.cancel_url, SITE + '/account/?plus=cancelled');
    for (const u of [c.body.success_url, c.body.cancel_url]) assert.ok(!/robin|@|%40|cus_|sub_/.test(u));
    const m = stripeCalls().find(x => x.url.includes('/prices'));
    assert.ok(m.url.includes('lookup_keys%5B%5D=ddr_plus_year'));
    await post(e, '/plus/checkout', { plan: 'month' }, { cookie: a.cookie });
    assert.strictEqual(stripeCalls().filter(x => x.url.endsWith('/checkout/sessions') && x.method === 'POST').pop().body['line_items[0][price]'], 'price_month');
    assert.strictEqual(stripeCalls().filter(x => x.url.endsWith('/customers')).length, 1, 'the same customer every time');
  });
  await t('Stripe unreachable at checkout: payments read as closed and nothing is passed on', async () => {
    const e = env(), a = await login(e);
    stripeDown = true;
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie })).status, 503, 'no price: closed');
  });
  await t('webhooks must be signed with our secret: unsigned, forged, stale and oversized are refused', async () => {
    const e = env(), a = await login(e); makeSub('sub_1', 'cus_1');
    const ev = completed('sub_1', a.id), raw = JSON.stringify(ev);
    const send = h => W.handle(new Request('https://api.dontdieretired.com/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: raw }), e);
    assert.strictEqual((await send({})).status, 400);
    assert.strictEqual((await send({ 'stripe-signature': sign(raw, 'whsec_attacker') })).status, 400);
    assert.strictEqual((await send({ 'stripe-signature': sign(raw, WHSEC, Math.floor(Date.now() / 1000) - 3600) })).status, 400);
    assert.strictEqual((await send({ 'stripe-signature': sign(raw + ' ') })).status, 400);
    const big = 'x'.repeat(P.HOOK_MAX + 1);
    assert.strictEqual((await W.handle(new Request('https://api.dontdieretired.com/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sign(big) }, body: big }), e)).status, 413);
    assert.strictEqual((await me(e, a.cookie)).plus.member, false);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships').get().n, 0);
  });
  await t('paying makes a member: the webhook links the customer and reads the subscription fresh from Stripe', async () => {
    const e = env(), a = await login(e); makeSub('sub_2', 'cus_2', { end: 1893456000 });
    const r = await hook(e, completed('sub_2', a.id, 'cus_2'));
    assert.strictEqual(r.status, 200);
    assert.ok(stripeCalls().some(c => c.method === 'GET' && c.url.includes('/subscriptions/sub_2')), 'fetched fresh');
    const m = await me(e, a.cookie);
    assert.deepStrictEqual(m.plus, { member: true, plan: 'year', until: 1893456000, ending: false, status: 'active' });
    assert.strictEqual(m.payments, true);
    assert.strictEqual(e.DB.raw.prepare('SELECT stripe_customer FROM users').get().stripe_customer, 'cus_2');
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'month' }, { cookie: a.cookie })).status, 409, 'cannot pay twice');
    assert.strictEqual((await hook(e, completed('sub_2', a.id, 'cus_2'))).status, 200, 'the same event twice is harmless');
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships').get().n, 1);
  });
  await t('subscription.created arriving before checkout.session.completed still finds the account', async () => {
    const e = env(), a = await login(e); makeSub('sub_3', 'cus_3', { metadata: { user_id: a.id }, lk: 'ddr_plus_month' });
    await hook(e, evt('customer.subscription.created', { id: 'sub_3', object: 'subscription', customer: 'cus_3' }));
    const m = await me(e, a.cookie); assert.strictEqual(m.plus.member, true); assert.strictEqual(m.plus.plan, 'month');
  });
  await t('an event\'s own copy is never trusted: Stripe\'s current state wins (late or out-of-order events)', async () => {
    const e = env(), a = await login(e); makeSub('sub_4', 'cus_4');
    await hook(e, completed('sub_4', a.id, 'cus_4'));
    S.subs.sub_4.status = 'canceled';
    await hook(e, evt('customer.subscription.updated', { id: 'sub_4', object: 'subscription', customer: 'cus_4', status: 'active' }));
    assert.strictEqual((await me(e, a.cookie)).plus.member, false);
  });
  await t('cancelling at the end of the period keeps Plus until then; deleted ends it', async () => {
    const e = env(), a = await login(e); makeSub('sub_5', 'cus_5');
    await hook(e, completed('sub_5', a.id, 'cus_5'));
    S.subs.sub_5.cancel_at_period_end = true;
    await hook(e, evt('customer.subscription.updated', { id: 'sub_5', object: 'subscription' }));
    let m = await me(e, a.cookie); assert.strictEqual(m.plus.member, true); assert.strictEqual(m.plus.ending, true);
    S.subs.sub_5.status = 'canceled';
    await hook(e, evt('customer.subscription.deleted', { id: 'sub_5', object: 'subscription' }));
    m = await me(e, a.cookie); assert.strictEqual(m.plus.member, false); assert.strictEqual(m.plus.ending, false);
    makeSub('sub_5b', 'cus_5', { extra: { status: 'past_due' } });
    await hook(e, evt('customer.subscription.updated', { id: 'sub_5b', object: 'subscription' }));
    assert.strictEqual((await me(e, a.cookie)).plus.member, true, 'past_due: Stripe is retrying the card, Plus stays meanwhile');
  });
  await t('a new subscription after an old one ended: the paying one counts, and checkout reuses the customer', async () => {
    const e = env(), a = await login(e); makeSub('sub_6', 'cus_6', { end: 1800000000 });
    await hook(e, completed('sub_6', a.id, 'cus_6'));
    S.subs.sub_6.status = 'canceled'; await hook(e, evt('customer.subscription.deleted', { id: 'sub_6', object: 'subscription' }));
    await post(e, '/plus/checkout', { plan: 'month' }, { cookie: a.cookie });
    const c = stripeCalls().filter(x => x.url.endsWith('/checkout/sessions') && x.method === 'POST').pop();
    assert.strictEqual(c.body.customer, 'cus_6'); assert.strictEqual(c.body.customer_email, undefined);
    assert.ok(!stripeCalls().some(x => x.url.endsWith('/customers')), 'no new customer');
    makeSub('sub_7', 'cus_6', { end: 1700000000, lk: 'ddr_plus_month' });
    await hook(e, completed('sub_7', a.id, 'cus_6'));
    const m = await me(e, a.cookie); assert.strictEqual(m.plus.member, true); assert.strictEqual(m.plus.plan, 'month');
    S.subs.sub_6.status = 'canceled'; await hook(e, evt('customer.subscription.updated', { id: 'sub_6', object: 'subscription' }));
    assert.strictEqual((await me(e, a.cookie)).plus.member, true, 'a late event for the old one does not end the new one');
  });
  await t('one account\'s payment can never make someone else a member', async () => {
    const e = env(), a = await login(e, 'a@example.com'), b = await login(e, 'b@example.com');
    makeSub('sub_8', 'cus_8');
    await hook(e, completed('sub_8', a.id, 'cus_8'));
    makeSub('sub_9', 'cus_8', { metadata: { user_id: b.id } });   // the same customer, claimed for another account
    await hook(e, completed('sub_9', b.id, 'cus_8'));
    assert.strictEqual((await me(e, b.cookie)).plus.member, false);
    assert.strictEqual(e.DB.raw.prepare('SELECT user_id FROM memberships WHERE subscription = ?').get('sub_9').user_id, a.id, 'it stays with the customer\'s own account');
    makeSub('sub_10', 'cus_10', { metadata: { user_id: b.id } });
    e.DB.raw.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').run('cus_b', b.id);
    await hook(e, completed('sub_10', b.id, 'cus_10'));
    assert.strictEqual(e.DB.raw.prepare('SELECT stripe_customer FROM users WHERE id = ?').get(b.id).stripe_customer, 'cus_b', 'an account\'s customer is never swapped');
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships WHERE subscription = ?').get('sub_10').n, 0);
  });
  await t('test events never touch a live member, and unknown events are ignored without calling Stripe', async () => {
    const e = env(), a = await login(e); makeSub('sub_11', 'cus_11');
    const r = await hook(e, completed('sub_11', a.id, 'cus_11'), {});
    assert.strictEqual(r.status, 200);
    calls.length = 0;
    const live = { ...completed('sub_11', a.id, 'cus_11'), livemode: true };
    assert.deepStrictEqual(await (await hook(e, live)).json(), { ok: true, ignored: 'mode' });
    assert.deepStrictEqual(await (await hook(e, evt('invoice.created', { id: 'in_1' }))).json(), { ok: true, ignored: 'type' });
    assert.strictEqual(stripeCalls().length, 0);
    const pay = await hook(e, evt('checkout.session.completed', { mode: 'payment', client_reference_id: a.id }));
    assert.strictEqual(pay.status, 200, 'a one-off payment (gifts, day 16) is not a subscription');
  });
  await t('Stripe unreachable: the webhook answers 500 so Stripe tries again; an unknown subscription is let go', async () => {
    const e = env(), a = await login(e); makeSub('sub_12', 'cus_12');
    stripeDown = true;
    assert.strictEqual((await hook(e, completed('sub_12', a.id, 'cus_12'))).status, 500);
    stripeDown = false;
    assert.strictEqual((await hook(e, completed('sub_12', a.id, 'cus_12'))).status, 200);
    assert.strictEqual((await me(e, a.cookie)).plus.member, true);
    assert.strictEqual((await hook(e, evt('customer.subscription.updated', { id: 'sub_nope', object: 'subscription' }))).status, 200);
    assert.strictEqual((await hook(e, evt('customer.subscription.updated', { id: '../customers', object: 'subscription' }))).status, 200);
    assert.ok(!stripeCalls().some(c => c.url.includes('customers')), 'ids are checked before they go in a Stripe address');
  });
  await t('a subscription for nobody we know is not stored', async () => {
    const e = env(); makeSub('sub_13', 'cus_13');
    assert.strictEqual((await hook(e, evt('customer.subscription.created', { id: 'sub_13', object: 'subscription' }))).status, 200);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships').get().n, 0);
  });
  await t('the portal: only for an account that has paid, on our Plus set-up, back to the account page', async () => {
    const e = env(), a = await login(e);
    assert.strictEqual((await post(e, '/plus/portal', {})).status, 401);
    assert.strictEqual((await post(e, '/plus/portal', {}, { cookie: a.cookie })).status, 404);
    makeSub('sub_14', 'cus_14'); await hook(e, completed('sub_14', a.id, 'cus_14'));
    const r = await post(e, '/plus/portal', {}, { cookie: a.cookie }); const d = await r.json();
    assert.strictEqual(r.status, 200); assert.ok(d.url.startsWith('https://billing.stripe.com/'));
    const c = stripeCalls().find(x => x.url.endsWith('/billing_portal/sessions'));
    assert.strictEqual(c.body.customer, 'cus_14'); assert.strictEqual(c.body.configuration, 'bpc_plus'); assert.strictEqual(c.body.return_url, SITE + '/account/');
    assert.strictEqual((await post(e, '/plus/portal', {}, { cookie: a.cookie, origin: 'https://evil.example' })).status, 403);
  });
  await t('checkout and portal visits are limited per member', async () => {
    const e = env(), a = await login(e);
    for (let i = 0; i < 20; i++) assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie })).status, 200);
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie })).status, 429);
  });
  await t('deleting the account ends the subscription at Stripe first; if Stripe cannot be reached nothing is deleted', async () => {
    const e = env(), a = await login(e); makeSub('sub_15', 'cus_15');
    await hook(e, completed('sub_15', a.id, 'cus_15'));
    stripeDown = true;
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 502);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1, 'kept, so the member is not charged for an account they cannot reach');
    stripeDown = false;
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.ok(stripeCalls().some(c => c.method === 'DELETE' && c.url.endsWith('/customers/cus_15')));
    assert.strictEqual(S.subs.sub_15.status, 'canceled');
    for (const tb of ['users', 'memberships', 'sessions']) assert.strictEqual(e.DB.raw.prepare(`SELECT COUNT(*) n FROM ${tb}`).get().n, 0, tb);
    await hook(e, evt('customer.subscription.deleted', { id: 'sub_15', object: 'subscription' }));
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships').get().n, 0, 'a late event does not bring anything back');
  });
  await t('review fix: a payment in another tab that has not reached us yet still stops a second checkout', async () => {
    const e = env(), a = await login(e);
    await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie });
    const cus = e.DB.raw.prepare('SELECT stripe_customer c FROM users').get().c;
    makeSub('sub_20', cus, { metadata: { user_id: a.id, site: SITE } });   // paid in tab 1; the webhook is still on its way
    const r = await post(e, '/plus/checkout', { plan: 'month' }, { cookie: a.cookie });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await me(e, a.cookie)).plus.member, true, 'and the account learns about it at once');
  });
  await t('review fix: deleting the account closes open payment pages and deletes the Stripe customer', async () => {
    const e = env(), a = await login(e);
    const d = await (await post(e, '/plus/checkout', { plan: 'year' }, { cookie: a.cookie })).json();
    const cs = d.url.split('/').pop(), cus = e.DB.raw.prepare('SELECT stripe_customer c FROM users').get().c;
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.strictEqual(S.sessions[cs].status, 'expired'); assert.ok(!S.customers[cus]);
  });
  await t('review fix: a subscription paid for an account deleted meanwhile is ended at Stripe', async () => {
    const e = env(), a = await login(e);
    makeSub('sub_21', 'cus_21', { metadata: { user_id: a.id, site: SITE } });
    e.DB.raw.exec('DELETE FROM users');
    assert.strictEqual((await hook(e, evt('customer.subscription.created', { id: 'sub_21', object: 'subscription' }))).status, 200);
    assert.strictEqual(S.subs.sub_21.status, 'canceled');
    makeSub('sub_22', 'cus_22', { metadata: { user_id: 'someone', site: 'https://another.example' } });
    await hook(e, evt('customer.subscription.created', { id: 'sub_22', object: 'subscription' }));
    assert.strictEqual(S.subs.sub_22.status, 'active', 'never another site\'s subscription');
  });
  await t('review fix: an ended subscription is never brought back by a slower, older read', async () => {
    const e = env(), a = await login(e); makeSub('sub_23', 'cus_23');
    await hook(e, completed('sub_23', a.id, 'cus_23'));
    S.subs.sub_23.status = 'canceled'; await hook(e, evt('customer.subscription.deleted', { id: 'sub_23', object: 'subscription' }));
    S.subs.sub_23.status = 'active'; await hook(e, evt('customer.subscription.updated', { id: 'sub_23', object: 'subscription' }));
    assert.strictEqual((await me(e, a.cookie)).plus.member, false);
  });
  await t('review fix: a webhook body without a length is counted as it arrives', async () => {
    const e = env(); const big = 'x'.repeat(P.HOOK_MAX + 10);
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const r = await W.handle(new Request('https://api.dontdieretired.com/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sign(big) }, body, duplex: 'half' }), e);
    assert.strictEqual(r.status, 413);
  });
  await t('an account that never paid deletes without calling Stripe; the clean-up removes orphaned memberships', async () => {
    const e = env(), a = await login(e);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.strictEqual(stripeCalls().length, 0);
    e.DB.raw.exec(`INSERT INTO memberships (subscription, user_id, status, cancel_at_end, updated) VALUES ('sub_x', 'gone', 'active', 0, 0)`);
    await W.tidy(e);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM memberships').get().n, 0);
  });
  await t('the set-up script makes the product, prices, portal and webhook once, and refuses a live key', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const st = { products: [], prices: [], confs: [], hooks: [], posts: [] };
    const saved = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url)), p = u.pathname.replace('/v1/', ''), m = init.method || 'GET', b = parseForm(init.body);
      const R = d => new Response(JSON.stringify(d), { status: 200 });
      if (m === 'POST') st.posts.push({ p, b });
      if (p === 'products') return m === 'GET' ? R({ data: st.products }) : R((st.products.push({ id: 'prod_' + st.products.length, metadata: { ddr: b['metadata[ddr]'] } }), st.products.at(-1)));
      if (p === 'prices') return m === 'GET' ? R({ data: st.prices.filter(x => x.lookup_key === u.searchParams.get('lookup_keys[]')) })
        : R((st.prices.push({ id: 'price_' + st.prices.length, lookup_key: b.lookup_key, unit_amount: +b.unit_amount, currency: b.currency }), st.prices.at(-1)));
      if (p === 'billing_portal/configurations') return m === 'GET' ? R({ data: st.confs }) : R((st.confs.push({ id: 'bpc_1', metadata: { ddr: 'plus' } }), st.confs[0]));
      if (p === 'webhook_endpoints') return m === 'GET' ? R({ data: st.hooks }) : R((st.hooks.push({ id: 'we_1', url: b.url }), { id: 'we_1', secret: 'whsec_made' }));
      throw new Error('setup called ' + p);
    };
    const out = path.join(os.tmpdir(), 'ddr-whsec-' + process.pid);
    const run = async (key, k, extra = {}) => {
      process.env.STRIPE_SECRET_KEY = key; Object.assign(process.env, extra);
      process.argv = ['node', 'stripe-setup.mjs', '--secret-out', out];
      const exit = process.exit; let code = 0; process.exit = c => { code = c; throw new Error('exit'); };
      const err = console.error, log = console.log; console.error = () => {}; console.log = () => {};
      try { await import('../worker/stripe-setup.mjs?run=' + k); } catch (e) { if (e.message !== 'exit') throw e; }
      finally { process.exit = exit; console.error = err; console.log = log; }
      return code;
    };
    try {
      assert.strictEqual(await run('sk_live_x', 1), 1, 'a live key is refused'); assert.strictEqual(st.posts.length, 0);
      assert.strictEqual(await run('sk_test_x', 2), 0);
      const pr = st.posts.filter(x => x.p === 'prices').map(x => x.b);
      assert.deepStrictEqual(pr.map(x => [x.lookup_key, x.unit_amount, x.currency, x['recurring[interval]'], x.tax_behavior]),
        [['ddr_plus_month', '200', 'gbp', 'month', 'inclusive'], ['ddr_plus_year', '2000', 'gbp', 'year', 'inclusive'], ['ddr_plus_gift', '2000', 'gbp', undefined, 'inclusive']]);
      const conf = st.posts.find(x => x.p === 'billing_portal/configurations').b;
      assert.strictEqual(conf['features[subscription_cancel][mode]'], 'at_period_end');
      assert.strictEqual(conf['features[subscription_update][products][0][prices][1]'], 'price_1');
      const hk = st.posts.find(x => x.p === 'webhook_endpoints').b;
      assert.strictEqual(hk.url, 'https://api.dontdieretired.com/stripe/webhook'); assert.strictEqual(hk.api_version, P.STRIPE_VERSION);
      assert.strictEqual(fs.readFileSync(out, 'utf8'), 'whsec_made');
      const before = st.posts.length; fs.unlinkSync(out);
      assert.strictEqual(await run('sk_test_x', 3), 0);
      assert.strictEqual(st.posts.length, before, 'a second run adds nothing'); assert.ok(!fs.existsSync(out));
    } finally { globalThis.fetch = saved; delete process.env.STRIPE_SECRET_KEY; try { fs.unlinkSync(out); } catch (e) { /* gone */ } }
  });
  console.log(`\n${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

// Tests for Planner Plus gifts (worker/src/gifts.js through worker/src/accounts.js, RUNBOOK §6t day 16).
// Run: node tools/test_gifts.js. Stripe is a stand-in (no network) answering the calls the Worker makes; every webhook is
// signed the way Stripe signs them.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const crypto = require('crypto');
const d1 = require('./d1_stub.js');

const SITE = 'https://dontdieretired.com';
const WHSEC = 'whsec_test_gifts_0123456789';
const GIFT_KEY = 'a1'.repeat(32);
const calls = [];
const S = { n: 0, sessions: {}, charges: {}, subs: {}, customers: {}, piCharge: {}, disputes: {} };
const PRICES = { ddr_plus_month: 'price_month', ddr_plus_year: 'price_year', ddr_plus_gift: 'price_gift' };
function parseForm(b) { const o = {}; for (const [k, v] of new URLSearchParams(b || '')) o[k] = v; return o; }
let lastMail = '';
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  const reply = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url.startsWith('https://api.resend.com/')) { lastMail = JSON.parse(init.body).text; return reply({ id: 'm' }); }
  calls.push({ url, method, body: parseForm(init.body) });
  if (!url.startsWith('https://api.stripe.com/v1/')) throw new Error('unexpected fetch ' + url);
  const u = new URL(url), p = u.pathname.replace('/v1/', '');
  if (p === 'prices') { const lk = u.searchParams.get('lookup_keys[]'); return reply({ data: PRICES[lk] ? [{ id: PRICES[lk], lookup_key: lk }] : [] }); }
  if (p === 'customers' && method === 'POST') { const id = 'cus_g' + (++S.n); S.customers[id] = { id }; return reply({ id }); }
  if (/^customers\/cus_\w+$/.test(p) && method === 'DELETE') { for (const x of Object.values(S.subs)) if (x.customer === p.split('/')[1]) x.status = 'canceled'; return reply({ deleted: true }); }
  if (p === 'subscriptions' && method === 'GET') return reply({ data: Object.values(S.subs).filter(x => x.customer === u.searchParams.get('customer')) });
  const sm = /^subscriptions\/(sub_\w+)$/.exec(p);
  if (sm && method === 'POST') { const b = parseForm(init.body), x = S.subs[sm[1]]; x.status = 'trialing'; x.trial_end = +b.trial_end; x.items.data[0].current_period_end = +b.trial_end; x.updated_with = b; return reply(x); }
  if (sm) return S.subs[sm[1]] ? reply(S.subs[sm[1]]) : reply({}, 404);
  const pm = /^payment_intents\/(pi_\w+)$/.exec(p);
  if (pm) return reply({ id: pm[1], object: 'payment_intent', latest_charge: S.piCharge[pm[1]] || { id: 'ch_ok', refunded: false, disputed: false } });
  const dp = /^disputes\/(du_\w+)$/.exec(p);
  if (dp) return S.disputes[dp[1]] ? reply(S.disputes[dp[1]]) : reply({}, 404);
  if (p === 'checkout/sessions' && method === 'POST') {
    const b = parseForm(init.body), id = 'cs_test_g' + (++S.n);
    S.sessions[id] = { id, object: 'checkout.session', mode: b.mode, livemode: false, status: 'open', payment_status: 'unpaid', currency: 'gbp', amount_total: 2000,
      customer: b.customer, payment_intent: 'pi_' + id.slice(8), metadata: { kind: b['metadata[kind]'], user_id: b['metadata[user_id]'], site: b['metadata[site]'] }, form: b };
    return reply({ id, url: 'https://checkout.stripe.com/c/pay/' + id });
  }
  if (p === 'checkout/sessions' && method === 'GET') return reply({ data: Object.values(S.sessions).filter(x => x.customer === u.searchParams.get('customer') && x.status === 'open') });
  const cs = /^checkout\/sessions\/(cs_\w+)$/.exec(p);
  if (cs) return S.sessions[cs[1]] ? reply(S.sessions[cs[1]]) : reply({}, 404);
  const ex = /^checkout\/sessions\/(cs_\w+)\/expire$/.exec(p);
  if (ex) { S.sessions[ex[1]].status = 'expired'; return reply(S.sessions[ex[1]]); }
  const ch = /^charges\/(ch_\w+)$/.exec(p);
  if (ch) return S.charges[ch[1]] ? reply(S.charges[ch[1]]) : reply({}, 404);
  return reply({ error: { message: 'no route ' + p } }, 404);
};
function sign(raw, secret = WHSEC, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; }

(async () => {
  const W = await import('../worker/src/accounts.js');
  const P = await import('../worker/src/plus.js');
  const G = await import('../worker/src/gifts.js');
  let n = 0; const t = async (name, fn) => { calls.length = 0; P.clearCache(); await fn(); n++; console.log('ok  ' + name); };
  const env = (o = {}) => ({ DB: d1(), SALT: 'test-salt-gifts', SITE_ORIGIN: SITE, MAIL_FROM: 'x', RESEND_API_KEY: 'k',
    STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, GIFT_KEY, ...o });
  let ip = 1;
  const post = (e, route, body, h = {}) => W.handle(new Request('https://api.dontdieretired.com' + route, {
    method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.' + (ip % 250), ...h }, body: JSON.stringify(body) }), e);
  const me = async (e, cookie) => (await W.handle(new Request('https://api.dontdieretired.com/auth/me', { headers: { cookie } }), e)).json();
  const login = async (e, email) => {
    ip++; await post(e, '/auth/start', { email });
    const tok = lastMail.match(/#t=([A-Za-z0-9_-]{43})/)[1];
    const r = await post(e, '/auth/verify', { token: tok }); const d = await r.json();
    return { cookie: `${W.COOKIE}=${(r.headers.get('set-cookie') || '').match(/__Host-ddr_s=([^;]*)/)[1]}`, id: d.account, email };
  };
  const hook = (e, ev, h = {}) => { const raw = JSON.stringify(ev); return W.handle(new Request('https://api.dontdieretired.com/stripe/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sign(raw), ...h }, body: raw }), e); };
  const evt = (type, object, o = {}) => ({ id: 'evt_' + Math.random().toString(36).slice(2), object: 'event', type, livemode: false, data: { object }, ...o });
  const done = cs => evt('checkout.session.completed', { id: cs, object: 'checkout.session', mode: 'payment' });
  // a signed-in buyer pays for one gift; returns the code as their account page shows it
  const buy = async (e, a) => {
    const r = await post(e, '/gift/checkout', {}, { cookie: a.cookie }); const d = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(d));
    const id = d.url.split('/').pop(); S.sessions[id].payment_status = 'paid'; S.sessions[id].status = 'complete';
    assert.strictEqual((await hook(e, done(id))).status, 200);
    const mine = await (await post(e, '/gift/mine', {}, { cookie: a.cookie })).json();
    return { cs: id, code: mine.gifts[0].code, pi: S.sessions[id].payment_intent };
  };
  const redeem = (e, a, code) => post(e, '/gift/redeem', { code }, { cookie: a.cookie });
  const YEAR = 365 * 86400, nowS = () => Math.floor(Date.now() / 1000);

  await t('codes: 16 characters from the 31-letter alphabet, all different, typed any way', async () => {
    const seen = new Set();
    for (let i = 0; i < 3000; i++) { const c = G.newCode(); assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{16}$/); seen.add(c); }
    assert.strictEqual(seen.size, 3000);
    const c = G.newCode(), shown = G.showCode(c);
    assert.match(shown, /^\w{4}-\w{4}-\w{4}-\w{4}$/);
    for (const typed of [c, shown, shown.toLowerCase(), ' ' + shown.replace(/-/g, ' ') + ' ', shown.replace(/-/g, '–')]) assert.strictEqual(G.normCode(typed), c, typed);
    for (const bad of ['', 'ABCD', c + 'A', c.slice(0, 15) + '0', c.slice(0, 15) + 'O', c.slice(0, 15) + 'I', null, 12345]) assert.strictEqual(G.normCode(bad), null, String(bad));
    assert.ok(Math.log2(31) * 16 > 79, 'about 79 bits: not guessable');
  });
  await t('the sealed copy opens only with the key and for its own gift', async () => {
    const e = env(), box = await G.seal(e, 'gift-1', 'ABCDEFGHJKMNPQRS');
    assert.ok(!box.includes('ABCD'));
    assert.strictEqual(await G.open(e, 'gift-1', box), 'ABCDEFGHJKMNPQRS');
    assert.strictEqual(await G.open(e, 'gift-2', box), null, 'moved to another gift: refused');
    assert.strictEqual(await G.open(env({ GIFT_KEY: 'b2'.repeat(32) }), 'gift-1', box), null, 'another key');
    assert.strictEqual(await G.open(e, 'gift-1', 'garbage'), null);
  });
  await t('twelve calendar months, leap days included', () => {
    assert.strictEqual(G.yearOn(Date.UTC(2026, 11, 25, 9) / 1000), Date.UTC(2027, 11, 25, 9) / 1000);
    assert.strictEqual(G.yearOn(Date.UTC(2028, 1, 29) / 1000), Date.UTC(2029, 2, 1) / 1000);
  });
  await t('closed without payments or without GIFT_KEY: nothing offered, nothing sold', async () => {
    for (const o of [{ GIFT_KEY: '' }, { GIFT_KEY: 'short' }, { STRIPE_SECRET_KEY: '' }, { STRIPE_SECRET_KEY: 'sk_live_x' }]) {
      const e = env(o), a = await login(e, 'closed@example.com');
      assert.strictEqual((await me(e, a.cookie)).gifts, false, JSON.stringify(o));
      assert.strictEqual((await post(e, '/gift/checkout', {}, { cookie: a.cookie })).status, 503);
    }
    assert.strictEqual(calls.length, 0, 'Stripe never called');
    const e = env(), a = await login(e, 'open@example.com');
    assert.strictEqual((await me(e, a.cookie)).gifts, true);
  });
  await t('buying needs a session, our origin and JSON; Stripe gets a one-off £20 payment with nothing personal in our URLs', async () => {
    const e = env(), a = await login(e, 'buyer@example.com');
    assert.strictEqual((await post(e, '/gift/checkout', {})).status, 401);
    assert.strictEqual((await post(e, '/gift/checkout', {}, { cookie: a.cookie, origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await post(e, '/gift/checkout', {}, { cookie: a.cookie, 'content-type': 'text/plain' })).status, 415);
    const r = await post(e, '/gift/checkout', {}, { cookie: a.cookie }); const d = await r.json();
    assert.ok(d.url.startsWith('https://checkout.stripe.com/'));
    const f = S.sessions[d.url.split('/').pop()].form;
    assert.strictEqual(f.mode, 'payment'); assert.strictEqual(f['line_items[0][price]'], 'price_gift'); assert.strictEqual(f['line_items[0][quantity]'], '1');
    assert.strictEqual(f['metadata[kind]'], 'gift'); assert.strictEqual(f['payment_intent_data[metadata][kind]'], 'gift');
    assert.strictEqual(f.success_url, SITE + '/account/?gift=thanks'); assert.strictEqual(f.cancel_url, SITE + '/account/?gift=cancelled');
    assert.ok(!JSON.stringify(f).includes('buyer@example.com'), 'no email in the session form');
    assert.strictEqual(f.billing_address_collection, 'required');
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n, 0, 'no gift until Stripe says it is paid');
  });
  await t('paid: exactly one gift per payment, shown to its buyer, never stored as plain text', async () => {
    const e = env(), a = await login(e, 'buyer@example.com');
    const g = await buy(e, a);
    assert.match(g.code, /^\w{4}-\w{4}-\w{4}-\w{4}$/);
    assert.ok(calls.some(c => c.method === 'GET' && c.url.includes('/checkout/sessions/' + g.cs)), 'read fresh from Stripe');
    for (let i = 0; i < 3; i++) await hook(e, done(g.cs));
    await hook(e, evt('checkout.session.async_payment_succeeded', { id: g.cs, object: 'checkout.session', mode: 'payment' }));
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n, 1, 'Stripe repeating itself makes no more gifts');
    const row = e.DB.raw.prepare('SELECT * FROM gifts').get();
    const plain = G.normCode(g.code);
    assert.ok(!JSON.stringify(row).includes(plain), 'the code is not in the database as text');
    assert.strictEqual(row.status, 'paid'); assert.strictEqual(row.buyer_id, a.id); assert.strictEqual(row.payment_intent, g.pi);
    // someone else's account sees none of it
    const b = await login(e, 'other@example.com');
    assert.deepStrictEqual((await (await post(e, '/gift/mine', {}, { cookie: b.cookie })).json()).gifts, []);
    assert.strictEqual((await post(e, '/gift/mine', {})).status, 401);
  });
  await t('not paid yet, not ours, other mode or forged: no gift', async () => {
    const e = env(), a = await login(e, 'buyer@example.com');
    const id = (await (await post(e, '/gift/checkout', {}, { cookie: a.cookie })).json()).url.split('/').pop();
    await hook(e, done(id));   // a bank payment still on its way
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n, 0);
    S.sessions[id].payment_status = 'paid';
    assert.strictEqual((await hook(e, done(id), { 'stripe-signature': sign(JSON.stringify(done(id)), 'whsec_wrong') })).status, 400, 'forged');
    await hook(e, done(id), {});
    const ev = done(id); ev.livemode = true; await hook(e, ev);
    S.sessions[id].metadata.site = 'https://pawsonthesand.com';
    await hook(e, evt('checkout.session.completed', { id, object: 'checkout.session', mode: 'payment' }));
    S.sessions[id].metadata.site = SITE; S.sessions[id].livemode = true;
    await hook(e, evt('checkout.session.completed', { id, object: 'checkout.session', mode: 'payment' }));
    assert.ok(e.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n <= 1);
    const e2 = env(), a2 = await login(e2, 'b2@example.com');
    const id2 = (await (await post(e2, '/gift/checkout', {}, { cookie: a2.cookie })).json()).url.split('/').pop();
    S.sessions[id2].payment_status = 'paid'; S.sessions[id2].livemode = true;
    await hook(e2, done(id2));
    assert.strictEqual(e2.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n, 0, 'a live session never makes a gift in test mode');
    S.sessions[id2].livemode = false;
    assert.strictEqual((await hook(e2, done(id2))).status, 200);
    assert.strictEqual(e2.DB.raw.prepare('SELECT COUNT(*) n FROM gifts').get().n, 1);
    // without GIFT_KEY the webhook asks Stripe to try again rather than lose the gift
    const e3 = env(), a3 = await login(e3, 'b3@example.com');
    const id3 = (await (await post(e3, '/gift/checkout', {}, { cookie: a3.cookie })).json()).url.split('/').pop();
    S.sessions[id3].payment_status = 'paid';
    assert.strictEqual((await hook({ ...e3, GIFT_KEY: '' }, done(id3))).status, 500);
    assert.strictEqual((await hook(e3, done(id3))).status, 200);
  });
  await t('redeeming: twelve months of Plus, no renewal; the code works once', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'friend@example.com'), c = await login(e, 'third@example.com');
    const g = await buy(e, a);
    assert.strictEqual((await redeem(e, b, 'ABCD')).status, 400);
    assert.strictEqual((await redeem(e, b, 'ABCD-EFGH-JKMN-PQRS')).status, 404);
    assert.strictEqual((await post(e, '/gift/redeem', { code: g.code })).status, 401, 'needs a session');
    assert.strictEqual((await post(e, '/gift/redeem', { code: g.code }, { cookie: b.cookie, origin: 'https://evil.example' })).status, 403);
    const r = await redeem(e, b, g.code.toLowerCase().replace(/-/g, ' ')); const d = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(d));
    assert.ok(Math.abs(d.until - (nowS() + YEAR)) < 2 * 86400);
    const m = (await me(e, b.cookie)).plus;
    assert.strictEqual(m.member, true); assert.strictEqual(m.plan, 'gift'); assert.strictEqual(m.ending, true, 'never renews'); assert.strictEqual(m.until, d.until);
    assert.strictEqual(m.gift_until, d.until);
    assert.strictEqual((await redeem(e, b, g.code)).status, 409, 'not twice');
    assert.strictEqual((await redeem(e, c, g.code)).status, 409, 'not by anyone else');
    assert.strictEqual((await me(e, c.cookie)).plus.member, false);
    const mine = (await (await post(e, '/gift/mine', {}, { cookie: a.cookie })).json()).gifts[0];
    assert.strictEqual(mine.status, 'redeemed'); assert.strictEqual(mine.code, null); assert.ok(mine.used);
    assert.ok(!JSON.stringify(mine).includes('friend'), 'the buyer is not told who used it');
    assert.strictEqual(e.DB.raw.prepare('SELECT code_box FROM gifts').get().code_box, null, 'the sealed copy goes once used');
    assert.ok(!calls.some(c2 => c2.url.includes('subscriptions') && c2.method === 'POST'), 'no subscription is made');
  });
  await t('two people using the same code at once: one gets it', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com'), c = await login(e, 'c@example.com');
    const g = await buy(e, a);
    const [rb, rc] = await Promise.all([redeem(e, b, g.code), redeem(e, c, g.code)]);
    assert.deepStrictEqual([rb.status, rc.status].sort(), [200, 409]);
    assert.strictEqual(e.DB.raw.prepare(`SELECT COUNT(*) n FROM memberships WHERE plan = 'gift'`).get().n, 1);
  });
  await t('guessing is throttled: ten tries an hour per account, thirty per network', async () => {
    const e = env(), b = await login(e, 'guess@example.com');
    let last; for (let i = 0; i < 11; i++) last = await redeem(e, b, G.showCode(G.newCode()));
    assert.strictEqual(last.status, 429);
    const e2 = env(); const many = []; for (let i = 0; i < 4; i++) many.push(await login(e2, `n${i}@example.com`));
    let st = []; for (let i = 0; i < 32; i++) st.push((await post(e2, '/gift/redeem', { code: G.showCode(G.newCode()) }, { cookie: many[i % 4].cookie, 'cf-connecting-ip': '198.51.100.7' })).status);
    assert.strictEqual(st.at(-1), 429);
  });
  await t('a gift on top of Plus that is ending starts when it ends; on top of a renewing subscription it waits', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'payer@example.com');
    const g1 = await buy(e, a), g2 = await buy(e, a);
    const end = nowS() + 40 * 86400;
    e.DB.raw.prepare(`INSERT INTO memberships (subscription, user_id, status, plan, period_end, cancel_at_end, updated) VALUES ('sub_r', ?, 'active', 'year', ?, 0, 0)`).run(b.id, end);
    let r = await redeem(e, b, g1.code); let d = await r.json();
    assert.strictEqual(r.status, 409); assert.strictEqual(d.error, 'renewing');
    assert.strictEqual(e.DB.raw.prepare(`SELECT COUNT(*) n FROM gifts WHERE status = 'paid'`).get().n, 2, 'the code is not spent');
    e.DB.raw.prepare(`UPDATE memberships SET cancel_at_end = 1 WHERE subscription = 'sub_r'`).run();
    r = await redeem(e, b, g1.code); d = await r.json();
    assert.strictEqual(r.status, 200); assert.strictEqual(d.from, end); assert.strictEqual(d.until, G.yearOn(end), 'starts where the paid time ends');
    r = await redeem(e, b, g2.code); d = await r.json();
    assert.strictEqual(d.from, G.yearOn(end), 'a second gift follows the first');
    const m = (await me(e, b.cookie)).plus;
    assert.strictEqual(m.until, G.yearOn(G.yearOn(end))); assert.strictEqual(m.plan, 'gift');
  });
  await t('a gift ends: no longer a member, and the account says it has ended', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g = await buy(e, a); await redeem(e, b, g.code);
    e.DB.raw.prepare(`UPDATE memberships SET period_end = ? WHERE plan = 'gift'`).run(nowS() - 10);
    const m = (await me(e, b.cookie)).plus;
    assert.strictEqual(m.member, false); assert.strictEqual(m.status, 'ended'); assert.strictEqual(m.gift_until, null);
    // and the paywall treats it the same way
    const pe = { ...e, PLUS_PAYWALL: '1' };
    const d = await (await post(pe, '/list/sync', { list: { version: 1, items: [] }, fields: 6 }, { cookie: b.cookie })).json();
    assert.strictEqual(d.readonly, true);
  });
  await t('a member by gift keeps their list on the account behind the paywall', async () => {
    const e = env({ PLUS_PAYWALL: '1' }), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g = await buy(e, a); await redeem(e, b, g.code);
    const list = { version: 1, items: [{ id: 'beekeeping', cid: 'beekeeping', pos: 1, status: 'want', added_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' }] };
    const d = await (await post(e, '/list/sync', { list, fields: 6 }, { cookie: b.cookie })).json();
    assert.strictEqual(d.plus, true); assert.strictEqual(d.readonly, undefined);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 1);
  });
  await t('choosing a plan during a gift: the first payment is taken when the gift ends', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g = await buy(e, a); const until = (await (await redeem(e, b, g.code)).json()).until;
    const r = await post(e, '/plus/checkout', { plan: 'year' }, { cookie: b.cookie }); const d = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(d));
    const f = S.sessions[d.url.split('/').pop()].form;
    assert.strictEqual(f['subscription_data[trial_end]'], String(until));
    // Stripe makes the subscription (trialing until the gift ends) and tells us
    const cust = e.DB.raw.prepare('SELECT stripe_customer FROM users WHERE id = ?').get(b.id).stripe_customer;
    S.subs.sub_t = { id: 'sub_t', object: 'subscription', customer: cust, status: 'trialing', cancel_at_period_end: false, metadata: { user_id: b.id, site: SITE },
      items: { data: [{ current_period_end: until, price: { lookup_key: 'ddr_plus_year' } }] } };
    await hook(e, evt('customer.subscription.created', { id: 'sub_t', object: 'subscription' }));
    const m = (await me(e, b.cookie)).plus;
    assert.strictEqual(m.member, true); assert.strictEqual(m.gift_until, until); assert.strictEqual(m.plan, 'year', 'the plan that carries on is shown');
    assert.strictEqual((await post(e, '/plus/checkout', { plan: 'month' }, { cookie: b.cookie })).status, 409, 'not a second plan');
    // under three days left: no trial (Stripe needs 48 hours); the plan starts straight away
    const e2 = env(), a2 = await login(e2, 'x@example.com'), b2 = await login(e2, 'y@example.com');
    const g2 = await buy(e2, a2); await redeem(e2, b2, g2.code);
    e2.DB.raw.prepare(`UPDATE memberships SET period_end = ? WHERE plan = 'gift'`).run(nowS() + 86400);
    const d2 = await (await post(e2, '/plus/checkout', { plan: 'month' }, { cookie: b2.cookie })).json();
    assert.strictEqual(S.sessions[d2.url.split('/').pop()].form['subscription_data[trial_end]'], undefined);
  });
  await t('refunds: an unused gift stops working; a used one is left with its owner; a part refund changes nothing', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g1 = await buy(e, a), g2 = await buy(e, a), g3 = await buy(e, a);
    S.charges.ch_1 = { id: 'ch_1', object: 'charge', payment_intent: g1.pi, refunded: true };
    S.charges.ch_2 = { id: 'ch_2', object: 'charge', payment_intent: g2.pi, refunded: true };
    S.charges.ch_3 = { id: 'ch_3', object: 'charge', payment_intent: g3.pi, refunded: false, amount_refunded: 500 };
    await redeem(e, b, g2.code);
    for (const id of ['ch_1', 'ch_2', 'ch_3']) assert.strictEqual((await hook(e, evt('charge.refunded', { id, object: 'charge' }))).status, 200);
    const st = Object.fromEntries(e.DB.raw.prepare('SELECT payment_intent, status FROM gifts').all().map(r => [r.payment_intent, r.status]));
    assert.deepStrictEqual([st[g1.pi], st[g2.pi], st[g3.pi]], ['refunded', 'redeemed', 'paid']);
    assert.strictEqual((await redeem(e, b, g1.code)).status, 410);
    assert.strictEqual((await me(e, b.cookie)).plus.member, true);
    const mine = (await (await post(e, '/gift/mine', {}, { cookie: a.cookie })).json()).gifts;
    assert.deepStrictEqual(mine.map(x => x.status).sort(), ['paid', 'redeemed', 'refunded']);
    assert.strictEqual(mine.find(x => x.status === 'refunded').code, null);
  });
  await t('deleting accounts: a bought gift still works but its buyer\'s copy goes; a used gift stays used', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com'), c = await login(e, 'c@example.com');
    const g1 = await buy(e, a), g2 = await buy(e, a);
    await redeem(e, b, g1.code);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    let rows = e.DB.raw.prepare('SELECT buyer_id, code_box, status FROM gifts').all();
    assert.ok(rows.every(r => r.buyer_id === null && r.code_box === null));
    assert.strictEqual((await redeem(e, c, g2.code)).status, 200, 'the card under the tree still works');
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: b.cookie })).status, 200);
    rows = e.DB.raw.prepare('SELECT redeemed_by, status FROM gifts').all();
    assert.ok(rows.some(r => r.redeemed_by === null && r.status === 'redeemed'));
    assert.strictEqual(e.DB.raw.prepare(`SELECT COUNT(*) n FROM memberships WHERE user_id = ?`).get(b.id).n, 0);
    assert.strictEqual((await redeem(e, c, g1.code)).status, 409, 'still used');
    // a gift paid for an account deleted before Stripe's message arrived is recorded for a refund, with no one's copy
    const e2 = env(), x = await login(e2, 'x@example.com');
    const id = (await (await post(e2, '/gift/checkout', {}, { cookie: x.cookie })).json()).url.split('/').pop();
    e2.DB.raw.prepare('DELETE FROM users WHERE id = ?').run(x.id);
    S.sessions[id].payment_status = 'paid';
    const warn = console.warn; console.warn = () => {};
    try { assert.strictEqual((await hook(e2, done(id))).status, 200); } finally { console.warn = warn; }
    const row = e2.DB.raw.prepare('SELECT buyer_id, code_box FROM gifts').get();
    assert.strictEqual(row.buyer_id, null); assert.strictEqual(row.code_box, null);
    // the hourly clean-up does the same for anything left behind
    e2.DB.raw.prepare(`INSERT INTO gifts (id, code_hash, code_box, checkout, buyer_id, status, created) VALUES ('g', 'h', 'box', 'cs_x', 'gone', 'paid', 0)`).run();
    await W.tidy(e2);
    assert.strictEqual(e2.DB.raw.prepare(`SELECT code_box FROM gifts WHERE id = 'g'`).get().code_box, null);
  });
  await t('review: a payment refunded or disputed before Stripe\'s message reached us makes a dead gift', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    for (const [k, ch] of [['refunded', { refunded: true, disputed: false }], ['disputed', { refunded: false, disputed: true }]]) {
      const id = (await (await post(e, '/gift/checkout', {}, { cookie: a.cookie })).json()).url.split('/').pop();
      S.sessions[id].payment_status = 'paid'; S.piCharge[S.sessions[id].payment_intent] = { id: 'ch_x', ...ch };
      assert.strictEqual((await hook(e, done(id))).status, 200);
      const row = e.DB.raw.prepare('SELECT status, code_box FROM gifts WHERE checkout = ?').get(id);
      assert.strictEqual(row.status, k); assert.strictEqual(row.code_box, null, 'no code to show or give');
    }
    const mine = (await (await post(e, '/gift/mine', {}, { cookie: a.cookie })).json()).gifts;
    assert.ok(mine.every(g => g.code === null));
    void b;
  });
  await t('review: a chargeback cancels an unused gift, and leaves a used one', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g1 = await buy(e, a), g2 = await buy(e, a);
    await redeem(e, b, g2.code);
    S.disputes.du_1 = { id: 'du_1', object: 'dispute', payment_intent: g1.pi }; S.disputes.du_2 = { id: 'du_2', object: 'dispute', payment_intent: g2.pi };
    for (const d of ['du_1', 'du_2']) assert.strictEqual((await hook(e, evt('charge.dispute.created', { id: d, object: 'dispute' }))).status, 200);
    assert.strictEqual((await redeem(e, b, g1.code)).status, 410);
    assert.strictEqual((await me(e, b.cookie)).plus.member, true);
    const st = e.DB.raw.prepare('SELECT status FROM gifts ORDER BY rowid').all().map(r => r.status);
    assert.deepStrictEqual(st, ['disputed', 'redeemed']);
  });
  await t('review: renewing a subscription while a gift covers the member moves its next payment to the gift\'s end', async () => {
    const e = env(), a = await login(e, 'buyer@example.com'), b = await login(e, 'b@example.com');
    const g = await buy(e, a);
    // b pays yearly, cancels at period end, then redeems a gift that follows it
    const end = nowS() + 30 * 86400;
    const cust = 'cus_renew'; e.DB.raw.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').run(cust, b.id);
    S.subs.sub_rn = { id: 'sub_rn', object: 'subscription', customer: cust, status: 'active', cancel_at_period_end: true, metadata: {}, items: { data: [{ current_period_end: end, price: { lookup_key: 'ddr_plus_year' } }] } };
    await hook(e, evt('customer.subscription.updated', { id: 'sub_rn', object: 'subscription' }));
    const until = (await (await redeem(e, b, g.code)).json()).until;
    assert.strictEqual(until, G.yearOn(end));
    assert.ok(!S.subs.sub_rn.updated_with, 'nothing to change while it is set to end');
    // then presses "Renew" in Stripe's portal: it would charge at `end`, inside the gift
    S.subs.sub_rn.cancel_at_period_end = false;
    assert.strictEqual((await hook(e, evt('customer.subscription.updated', { id: 'sub_rn', object: 'subscription' }))).status, 200);
    assert.strictEqual(S.subs.sub_rn.updated_with.trial_end, String(until)); assert.strictEqual(S.subs.sub_rn.updated_with.proration_behavior, 'none');
    const row = e.DB.raw.prepare(`SELECT status, period_end FROM memberships WHERE subscription = 'sub_rn'`).get();
    assert.deepStrictEqual([row.status, row.period_end], ['trialing', until]);
    // Stripe's next message (the subscription now trialing to the gift's end) changes nothing more
    const before = calls.filter(c => c.method === 'POST' && c.url.includes('subscriptions/')).length;
    await hook(e, evt('customer.subscription.updated', { id: 'sub_rn', object: 'subscription' }));
    assert.strictEqual(calls.filter(c => c.method === 'POST' && c.url.includes('subscriptions/')).length, before);
  });
  console.log(`\n${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

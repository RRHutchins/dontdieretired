// Planner Plus end to end (RUNBOOK §6t, day 20): the whole member journey in a real browser, against the real Worker
// code (worker/src/*.js on Node's own SQLite with the real migrations) and a stand-in Stripe that answers the calls the
// Worker makes and sends webhooks signed the way Stripe signs them. Nothing leaves this machine; no Stripe account is used.
//
//   1. a local paywall build of the site:
//        DDR_ACCOUNTS_API=http://localhost:8787 DDR_PLUS_PAYWALL=1 python3 build.py --no-social && cp -r dist /some/dir/site
//   2. node tools/e2e_plus.js /some/dir/site [/some/dir/shots]      (then rebuild normally: python3 build.py)
//
// The journey: a reader is a guest (free links, sample, price); signs in on a phone and buys yearly; plans two things;
// signs in on a laptop and sees them (and a plan made there reaches the phone); cancels in the portal (keeps Plus to the
// end of the paid time); the time runs out (plans read-only, nothing stored); a friend buys a gift, prints the card; the
// first person redeems it (Plus again, saving works again); the friend sees "used"; a second gift is refunded unused and
// can no longer be redeemed; deleting the friend's account ends nothing it gave. Every page is checked at its width for
// sideways scroll and console errors, and every address the browsers asked for is checked for anything personal.
//
// With Robin's TEST key in place, the same journey is then done once by hand on the real site (RUNBOOK §6t, day 20 log).
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const d1 = require('./d1_stub.js');

const SITE_DIR = process.argv[2];
const SHOTS = process.argv[3] || null;
if (!SITE_DIR || !fs.existsSync(path.join(SITE_DIR, 'account/index.html'))) { console.error('usage: node tools/e2e_plus.js <paywall build of the site> [screenshot dir]'); process.exit(2); }
const built = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
if (!built.includes('name="ddr-plus" content="paywall"') || !built.includes('http://localhost:8787')) { console.error('the site must be a local paywall build (see the top of this file)'); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const SITE = 'http://localhost:8000', API = 'http://localhost:8787', CTL = 'http://localhost:8789';
const WHSEC = 'whsec_e2e_' + crypto.randomBytes(12).toString('hex');
const env = { DB: d1(), SALT: 'e2e-salt-' + crypto.randomBytes(8).toString('hex'), SITE_ORIGIN: SITE, MAIL_FROM: 'x', DEV_MAIL: '1', PLUS_PAYWALL: '1',
  STRIPE_SECRET_KEY: 'sk_test_e2e', STRIPE_WEBHOOK_SECRET: WHSEC, GIFT_KEY: crypto.randomBytes(32).toString('hex') };
const now = () => Math.floor(Date.now() / 1000);
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}){3}$/;

// ---------------- the stand-in Stripe (only the calls the Worker makes) ----------------
const S = { n: 0, customers: {}, subs: {}, sessions: {}, charges: {}, pis: {}, deleted: [] };
const PRICES = { ddr_plus_month: 'price_month', ddr_plus_year: 'price_year', ddr_plus_gift: 'price_gift' };
const LK = Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [v, k]));
const parseForm = b => { const o = {}; for (const [k, v] of new URLSearchParams(b || '')) o[k] = v; return o; };
const realFetch = globalThis.fetch;
const stripeCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (!url.startsWith('https://api.stripe.com/')) {
    if (url.startsWith(SITE + '/')) return realFetch(url, init);   // the calendar feed reads the site's planner data
    throw new Error('unexpected fetch from the Worker: ' + url);
  }
  const method = init.method || 'GET', u = new URL(url), p = u.pathname.replace('/v1/', ''), b = parseForm(init.body);
  stripeCalls.push({ method, p, b });
  assert.match(init.headers.authorization, /^Bearer sk_test_/, 'only a test key is ever sent');
  const reply = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  if (p === 'prices') { const lk = u.searchParams.get('lookup_keys[]'); return reply({ data: PRICES[lk] ? [{ id: PRICES[lk], lookup_key: lk }] : [] }); }
  if (p === 'billing_portal/configurations') return reply({ data: [] });
  if (p === 'billing_portal/sessions') { assert.ok(S.customers[b.customer]); return reply({ url: 'https://billing.stripe.com/p/session/test_' + b.customer.slice(4) + '_' + (++S.n) }); }
  if (p === 'customers' && method === 'POST') { const id = 'cus_e' + (++S.n); S.customers[id] = { id, email: b.email }; return reply({ id }); }
  let m;
  if ((m = /^customers\/(cus_\w+)$/.exec(p)) && method === 'DELETE') {
    S.deleted.push(m[1]); for (const x of Object.values(S.subs)) if (x.customer === m[1]) x.status = 'canceled';
    delete S.customers[m[1]]; return reply({ deleted: true });
  }
  if (p === 'subscriptions' && method === 'GET') return reply({ data: Object.values(S.subs).filter(x => x.customer === u.searchParams.get('customer')) });
  if ((m = /^subscriptions\/(sub_\w+)$/.exec(p))) {
    const x = S.subs[m[1]]; if (!x) return reply({}, 404);
    if (method === 'DELETE') x.status = 'canceled';
    if (method === 'POST') { if (b.trial_end) { x.status = 'trialing'; x.items.data[0].current_period_end = +b.trial_end; } }
    return reply(x);
  }
  if (p === 'checkout/sessions' && method === 'POST') {
    const id = 'cs_test_e' + (++S.n) + crypto.randomBytes(6).toString('hex');
    const md = k => ({ kind: b[k + '[kind]'], user_id: b[k + '[user_id]'], site: b[k + '[site]'] });
    S.sessions[id] = { id, object: 'checkout.session', mode: b.mode, livemode: false, status: 'open', payment_status: 'unpaid', currency: 'gbp', amount_total: 2000,
      customer: b.customer, client_reference_id: b.client_reference_id, metadata: md('metadata'), sub_md: md('subscription_data[metadata]'),
      price: b['line_items[0][price]'], success_url: b.success_url, cancel_url: b.cancel_url, payment_intent: null, subscription: null, form: b };
    return reply({ id, url: 'https://checkout.stripe.com/c/pay/' + id });
  }
  if (p === 'checkout/sessions' && method === 'GET') return reply({ data: Object.values(S.sessions).filter(x => x.customer === u.searchParams.get('customer') && x.status === 'open') });
  if ((m = /^checkout\/sessions\/(cs_\w+)\/expire$/.exec(p))) { S.sessions[m[1]].status = 'expired'; return reply(S.sessions[m[1]]); }
  if ((m = /^checkout\/sessions\/(cs_\w+)$/.exec(p))) return S.sessions[m[1]] ? reply(S.sessions[m[1]]) : reply({}, 404);
  if ((m = /^payment_intents\/(pi_\w+)$/.exec(p))) { const pi = S.pis[m[1]]; return pi ? reply({ id: pi.id, object: 'payment_intent', latest_charge: S.charges[pi.charge] }) : reply({}, 404); }
  if ((m = /^charges\/(ch_\w+)$/.exec(p))) return S.charges[m[1]] ? reply(S.charges[m[1]]) : reply({}, 404);
  return reply({ error: { message: 'stand-in has no route ' + method + ' ' + p } }, 404);
};
// a webhook, signed as Stripe signs them, posted to the Worker's real route
const W = { handle: null };
async function hook(type, object) {
  const raw = JSON.stringify({ id: 'evt_' + crypto.randomBytes(8).toString('hex'), object: 'event', type, livemode: false, data: { object } });
  const t = now(), sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex');
  const r = await W.handle(new Request(API + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: raw }), env);
  assert.strictEqual(r.status, 200, type + ' webhook: ' + (await r.text()));
}
// what happens on Stripe's own pages, done by the stand-in when the browser presses its buttons
async function pay(csId) {
  const cs = S.sessions[csId]; assert.ok(cs && cs.status === 'open', 'an open checkout');
  cs.status = 'complete'; cs.payment_status = 'paid';
  if (cs.mode === 'subscription') {
    const id = 'sub_e' + (++S.n), month = LK[cs.price] === 'ddr_plus_month';
    S.subs[id] = { id, object: 'subscription', customer: cs.customer, status: 'active', cancel_at_period_end: false, cancel_at: null, metadata: cs.sub_md,
      items: { data: [{ price: { id: cs.price, lookup_key: LK[cs.price] }, current_period_end: now() + (month ? 31 : 365) * 86400 }] } };
    cs.subscription = id;
    await hook('customer.subscription.created', { id, object: 'subscription' });
    await hook('checkout.session.completed', { id: csId, object: 'checkout.session', mode: 'subscription', subscription: id, client_reference_id: cs.client_reference_id });
  } else {
    const pi = 'pi_e' + (++S.n), ch = 'ch_e' + (++S.n);
    S.charges[ch] = { id: ch, object: 'charge', payment_intent: pi, refunded: false, disputed: false };
    S.pis[pi] = { id: pi, charge: ch }; cs.payment_intent = pi;
    await hook('checkout.session.completed', { id: csId, object: 'checkout.session', mode: 'payment' });
  }
  return cs.success_url;
}
async function cancelAtEnd(cus) {
  for (const x of Object.values(S.subs)) if (x.customer === cus && x.status === 'active') { x.cancel_at_period_end = true; await hook('customer.subscription.updated', { id: x.id, object: 'subscription' }); }
}
async function periodEnds(cus) {
  for (const x of Object.values(S.subs)) if (x.customer === cus && x.status !== 'canceled') { x.status = 'canceled'; await hook('customer.subscription.deleted', { id: x.id, object: 'subscription' }); }
}
async function refundGift(csId) {
  const cs = S.sessions[csId], ch = S.charges[S.pis[cs.payment_intent].charge];
  ch.refunded = true; await hook('charge.refunded', { id: ch.id, object: 'charge' });
}

// ---------------- three local servers: the Worker, the site, and the stand-in's control (Stripe's pages) ----------------
function serve(port, fn) { return new Promise(res => { const s = http.createServer((q, r) => fn(q, r).catch(e => { console.error(e); r.statusCode = 500; r.end('error'); })); s.listen(port, '127.0.0.1', () => res(s)); }); }
const body = q => new Promise(res => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res(Buffer.concat(c))); });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.ics': 'text/calendar', '.txt': 'text/plain', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

(async () => {
  const A = await import('../worker/src/accounts.js');
  W.handle = A.handle;
  const servers = [];
  servers.push(await serve(8787, async (q, r) => {
    const b = await body(q), h = { ...q.headers, 'cf-connecting-ip': '127.0.0.1' };
    const res = await A.handle(new Request(API + q.url, { method: q.method, headers: h, body: ['GET', 'HEAD'].includes(q.method) ? undefined : b }), env);
    const out = {}; res.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; if (sc.length) out['set-cookie'] = sc;
    r.writeHead(res.status, out); r.end(Buffer.from(await res.arrayBuffer()));
  }));
  servers.push(await serve(8000, async (q, r) => {
    let p = decodeURIComponent(new URL(q.url, SITE).pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.resolve(SITE_DIR)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
  }));
  servers.push(await serve(8789, async (q, r) => {
    const u = new URL(q.url, CTL); let to = SITE + '/account/', m;
    if ((m = /^\/pay\/(cs_\w+)$/.exec(u.pathname))) to = await pay(m[1]);
    else if ((m = /^\/leave\/(cs_\w+)$/.exec(u.pathname))) to = S.sessions[m[1]].cancel_url;
    else if ((m = /^\/portal-cancel\/(cus_\w+)$/.exec(u.pathname))) await cancelAtEnd(m[1]);
    r.writeHead(303, { location: to }); r.end();
  }));

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const seen = [], problems = [];
  let shot = 0;
  async function device(name, width) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
    // anything else off this machine (fonts, analytics): not needed, never sent. Registered first: Playwright tries the last route first
    await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    // Stripe's own pages, played by the stand-in: Checkout and the Customer Portal
    await ctx.route('https://checkout.stripe.com/**', route => {
      const id = route.request().url().split('/').pop(), cs = S.sessions[id];
      route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width"><title>Stand-in Stripe Checkout</title><h1>Stand-in Stripe Checkout (test)</h1><p>${cs ? cs.mode : 'unknown'}</p><p><a id="pay" href="${CTL}/pay/${id}">Pay</a> <a id="leave" href="${CTL}/leave/${id}">Back</a></p>` });
    });
    await ctx.route('https://billing.stripe.com/**', route => {
      const cus = 'cus_' + route.request().url().split('/').pop().replace(/^test_/, '').replace(/_\d+$/, '');
      route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Stand-in Stripe portal</title><h1>Stand-in customer portal (test)</h1><p><a id="cancel" href="${CTL}/portal-cancel/${cus}">Cancel plan</a> <a id="back" href="${SITE}/account/">Return</a></p>` });
    });
    const page = await ctx.newPage();
    page.on('request', q => seen.push({ who: name, url: q.url() }));
    page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|ERR_BLOCKED/.test(msg.text())) problems.push(name + ' console: ' + msg.text() + ' @ ' + page.url()); });
    page.on('pageerror', e => problems.push(name + ' page error: ' + e.message + ' @ ' + page.url()));
    page.width = width; page.who = name;
    return page;
  }
  async function look(page, label) {
    await page.waitForTimeout(150);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 0) problems.push(`${page.who} sideways scroll ${wide}px on ${label}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, String(++shot).padStart(2, '0') + '-' + page.who + '-' + label + '.png'), fullPage: false });
  }
  const step = async (name, fn) => { await fn(); console.log('ok  ' + name); };
  const vis = (page, sel) => page.locator(sel).first().waitFor({ state: 'visible', timeout: 15000 });
  async function signIn(page, email) {
    await page.goto(SITE + '/account/');
    await vis(page, '[data-acct-form]');
    await page.fill('#acct-email', email); await page.click('[data-acct-form] button[type=submit]');
    await vis(page, '[data-acct-devlink]');
    const link = await page.getAttribute('[data-acct-devlink]', 'href');
    assert.match(link, /^http:\/\/localhost:8000\/account\/#t=[A-Za-z0-9_-]{43}$/, 'the link carries the token after #, never in the query');
    await page.goto(link);
    await vis(page, '[data-acct-finish]'); assert.ok(!page.url().includes('#t='), 'token out of the address at once');
    await page.click('[data-acct-finish]');
    await vis(page, '[data-acct-in]');
    assert.strictEqual(await page.textContent('[data-acct-email]'), email);
  }
  const plusState = page => page.locator('[data-acct-plus-state]').textContent();
  async function planOn(page, slug, date) {
    await page.goto(SITE + '/list/' + slug + '/#plan');
    await vis(page, '[data-pl-form]');
    const day = page.locator('[data-pl-by][value=date]');
    if (await day.count() && await day.isVisible()) await day.check();
    await page.fill('[data-pl-date]', date);
    await page.locator('[data-pl-form] button[type=submit]').click();
    await vis(page, '[data-pl-save]'); await page.click('[data-pl-save]');
    await vis(page, '.pl-saved');
  }
  const myYearHas = async (page, text) => { await page.goto(SITE + '/my-year/'); await page.waitForFunction(t => { const m = document.querySelector('[data-my-main]'); return m && !m.hidden && m.textContent.includes(t); }, text, { timeout: 15000 }); };

  const phone = await device('phone', 390), laptop = await device('laptop', 1280), friend = await device('friend', 390);
  const ALEX = 'alex.e2e@example.com', BEA = 'bea.e2e@example.com';
  let alexCus = null, giftCode = null, gift2 = null;

  await step('a reader who has never signed in is a guest: free links, the price and the sample, never the Worker', async () => {
    await phone.goto(SITE + '/list/take-up-beekeeping/#plan');
    await vis(phone, '[data-pl-guest]');
    assert.ok(await phone.locator('[data-pl-form]').isHidden(), 'no dated planner for a guest');
    assert.ok((await phone.textContent('[data-pl-guest]')).includes('£2'), 'the price is shown');
    assert.ok(!seen.some(s => s.url.startsWith(API)), 'a reader who never signed in is never sent to the Worker');
    await look(phone, 'guest-plan-this');
    await phone.goto(SITE + '/planner-plus/sample/'); await phone.waitForLoadState('networkidle'); await look(phone, 'sample');
  });
  await step('phone: sign in by emailed link, buy yearly on (stand-in) Stripe, back to "Planner Plus is on"', async () => {
    await signIn(phone, ALEX);
    await vis(phone, '[data-acct-buy=year]'); await look(phone, 'account-join');
    await phone.click('[data-acct-buy=year]');
    await phone.waitForURL(/checkout\.stripe\.com/);
    const cs = S.sessions[phone.url().split('/').pop()];
    assert.strictEqual(cs.mode, 'subscription'); assert.strictEqual(cs.price, 'price_year');
    assert.strictEqual(cs.form.success_url, SITE + '/account/?plus=welcome'); assert.strictEqual(cs.form.billing_address_collection, 'required');
    assert.ok(!JSON.stringify(cs.form).includes(ALEX), 'no email address in the checkout form we send');
    alexCus = cs.customer; assert.strictEqual(S.customers[alexCus].email, ALEX, 'the email goes only to the Stripe customer');
    await phone.click('#pay');
    await phone.waitForURL(SITE + '/account/**');
    await phone.waitForFunction(() => /Planner Plus is on|You have Planner Plus/.test(document.querySelector('[data-acct-plus-state]').textContent), null, { timeout: 25000 });
    assert.ok(!phone.url().includes('plus=welcome'), 'the welcome flag is cleared from the address');
    await look(phone, 'account-member');
  });
  await step('phone: a member plans two things and they are kept on the account', async () => {
    await planOn(phone, 'take-up-beekeeping', '2027-03-13'); await look(phone, 'plan-saved');
    await planOn(phone, 'visit-an-open-garden', '2027-06-20');
    await myYearHas(phone, 'garden'); await look(phone, 'my-year');
    await phone.waitForTimeout(2500);   // the change is sent 1.5 s after it is made
    const row = env.DB.raw.prepare('SELECT data FROM lists').get();
    assert.ok(row && row.data.includes('take-up-beekeeping') && row.data.includes('visit-an-open-garden'), 'both plans stored on the account');
  });
  await step('laptop: the same member signs in and sees both; a plan made there reaches the phone', async () => {
    await signIn(laptop, ALEX);
    await laptop.waitForFunction(() => /You have Planner Plus/.test(document.querySelector('[data-acct-plus-state]').textContent), null, { timeout: 15000 });
    await myYearHas(laptop, 'beekeeping'); await myYearHas(laptop, 'garden'); await look(laptop, 'my-year');
    await planOn(laptop, 'big-garden-birdwatch', '2027-01-30');
    await laptop.waitForTimeout(2500);
    await myYearHas(phone, 'Birdwatch');
  });
  await step('laptop: cancel in the portal keeps Plus to the end of the paid year and says it will not renew', async () => {
    await laptop.goto(SITE + '/account/');
    await vis(laptop, '[data-acct-portal]'); await laptop.click('[data-acct-portal]');
    await laptop.waitForURL(/billing\.stripe\.com/);
    await laptop.click('#cancel');
    await laptop.waitForURL(SITE + '/account/**');
    await laptop.waitForFunction(() => /will not renew/.test(document.querySelector('[data-acct-plus-state]').textContent), null, { timeout: 15000 });
    await look(laptop, 'account-ending');
    await planOn(laptop, 'brew-your-own-beer', '2027-03-20');   // still a member until the end
  });
  await step('the paid time runs out: plans stay readable but nothing changes, and the account stores nothing new', async () => {
    await periodEnds(alexCus);
    const before = env.DB.raw.prepare('SELECT data, rev FROM lists').get();
    await phone.goto(SITE + '/account/');
    await vis(phone, '[data-acct-buy=year]');
    await phone.goto(SITE + '/list/take-up-beekeeping/#plan');
    await phone.waitForFunction(() => document.querySelector('[data-pl-ro]') || document.querySelector('.pl-ro'), null, { timeout: 15000 });
    assert.strictEqual(await phone.locator('[data-pl-save], [data-pl-change]').count() === 0 || await phone.locator('[data-pl-save]:visible, [data-pl-change]:visible').count() === 0, true, 'no change buttons on a read-only plan');
    await look(phone, 'plan-read-only');
    await phone.goto(SITE + '/my-year/'); await vis(phone, '[data-my-ro]'); await look(phone, 'my-year-read-only');
    await phone.waitForTimeout(2000);
    const after = env.DB.raw.prepare('SELECT data, rev FROM lists').get();
    assert.strictEqual(after.rev, before.rev, 'a lapsed account stores nothing');
  });
  await step('friend: buys a gift, gets the code on the account and can print the card', async () => {
    // this browser already holds a list (saved before accounts): it goes to the account only when she says so (day 20)
    await friend.goto(SITE + '/list/'); await friend.waitForFunction(() => window.DDRList);
    await friend.evaluate(() => window.DDRList.add('learn-the-ukulele'));
    await signIn(friend, BEA);
    await vis(friend, '[data-acct-first]');
    assert.match(await friend.textContent('[data-acct-first]'), /1 thing\).*bea\.e2e@example\.com/s);
    await look(friend, 'first-list-ask');
    await friend.click('[data-acct-first-add]');
    await friend.waitForFunction(() => document.querySelector('[data-acct-first]').hidden && document.querySelector('[data-acct-sync]').textContent.length > 0, null, { timeout: 15000 });
    await vis(friend, '[data-acct-gift-buy]'); await friend.click('[data-acct-gift-buy]');
    await friend.waitForURL(/checkout\.stripe\.com/);
    const id = friend.url().split('/').pop(); assert.strictEqual(S.sessions[id].mode, 'payment'); assert.strictEqual(S.sessions[id].price, 'price_gift');
    await friend.click('#pay');
    await friend.waitForURL(SITE + '/account/**');
    await vis(friend, '.acct-giftcode');
    giftCode = (await friend.textContent('.acct-giftcode')).trim();
    assert.match(giftCode, CODE);
    assert.ok(!friend.url().includes('gift='), 'the thanks flag is cleared from the address');
    await friend.locator('.acct-cardopt summary').click();
    await friend.fill('#gift-to', 'Alex'); await friend.fill('#gift-from', 'Bea');
    await look(friend, 'gift-bought');
    await friend.emulateMedia({ media: 'print' });
    await friend.evaluate(() => { window.print = () => {}; });
    await friend.locator('[data-acct-gift-list] button', { hasText: 'Print the card' }).first().click();
    await friend.waitForTimeout(300);
    if (SHOTS) await friend.screenshot({ path: path.join(SHOTS, String(++shot).padStart(2, '0') + '-friend-gift-card-print.png') });
    await friend.emulateMedia({ media: 'screen' });
    const g = env.DB.raw.prepare('SELECT code_hash, code_box FROM gifts').get();
    assert.ok(!g.code_box.includes(giftCode.replace(/-/g, '')), 'the code is not stored as plain text');
  });
  await step('phone: the first person redeems the code on /redeem/ (typed in lower case) and can plan again', async () => {
    await phone.goto(SITE + '/redeem/');
    await vis(phone, '#acct-code');
    await phone.fill('#acct-code', 'ABCD-EFGH-JKMN-PQRS'); await phone.click('[data-acct-redeem-form] button[type=submit]');
    await vis(phone, '#acct-code-err');
    await phone.fill('#acct-code', giftCode.toLowerCase()); await phone.click('[data-acct-redeem-form] button[type=submit]');
    await vis(phone, '[data-acct-code-ok]');
    assert.match(await phone.textContent('[data-acct-code-ok]'), /until .*2027/);
    await look(phone, 'gift-redeemed');
    await planOn(phone, 'learn-the-ukulele', '2027-07-04');
  });
  await step('friend: the gift shows as used (never by whom); a second gift refunded unused can no longer be used', async () => {
    await friend.goto(SITE + '/account/');
    await friend.waitForFunction(() => /used on/.test((document.querySelector('[data-acct-gift-list]') || {}).textContent || ''), null, { timeout: 15000 });
    assert.ok(!(await friend.textContent('[data-acct-gift-list]')).includes(ALEX));
    await friend.click('[data-acct-gift-buy]'); await friend.waitForURL(/checkout\.stripe\.com/);
    gift2 = friend.url().split('/').pop(); await friend.click('#pay'); await friend.waitForURL(SITE + '/account/**');
    await friend.waitForFunction(() => /not used yet/.test((document.querySelector('[data-acct-gift-list]') || {}).textContent || ''), null, { timeout: 25000 });
    const code2 = (await friend.textContent('.acct-giftcode')).trim(); assert.match(code2, CODE);
    await refundGift(gift2);
    await friend.reload(); await friend.waitForFunction(() => /refunded/.test((document.querySelector('[data-acct-gift-list]') || {}).textContent || ''), null, { timeout: 15000 });
    assert.ok(!(await friend.textContent('[data-acct-gift-list]')).includes(code2), 'a refunded code is no longer shown');
    await laptop.goto(SITE + '/redeem/'); await vis(laptop, '#acct-code');
    await laptop.fill('#acct-code', code2); await laptop.click('[data-acct-redeem-form] button[type=submit]');
    await vis(laptop, '#acct-code-err');
    await look(friend, 'gifts-used-refunded');
  });
  await step('friend deletes their account: the gift they gave keeps working, their Stripe customer goes', async () => {
    const friendCus = env.DB.raw.prepare("SELECT stripe_customer c FROM users WHERE stripe_customer IS NOT NULL AND stripe_customer != ?").get(alexCus).c;
    await friend.locator('.acct-del summary').click();
    await friend.click('[data-acct-delete]');
    await friend.waitForFunction(() => !document.querySelector('[data-acct-in]') || document.querySelector('[data-acct-in]').hidden, null, { timeout: 15000 });
    assert.ok(S.deleted.includes(friendCus), 'the Stripe customer is deleted');
    await phone.goto(SITE + '/account/');
    await phone.waitForFunction(() => /gift until/.test(document.querySelector('[data-acct-plus-state]').textContent), null, { timeout: 15000 });
  });
  await step('nothing personal in any address the browsers asked for, and no token or code in a query', async () => {
    const bad = seen.filter(s => /alex\.e2e|bea\.e2e|%40example|@example/i.test(s.url) || (giftCode && s.url.toUpperCase().includes(giftCode.replace(/-/g, ''))) || s.url.includes(giftCode) || /[?&](t|token|code)=/i.test(s.url));
    assert.deepStrictEqual(bad.map(b => b.who + ' ' + b.url), []);
    assert.ok(stripeCalls.every(c => !/[?&]email=/.test(c.p)), 'no email in a Stripe address');
  });
  await browser.close(); servers.forEach(s => s.close());
  if (problems.length) { console.error('PROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('end to end: all passed (' + seen.length + ' requests checked)');
})().catch(e => { console.error(e); process.exit(1); });

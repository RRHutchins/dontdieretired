// Tests for the members' live calendar feed (worker/src/feed.js through worker/src/accounts.js, RUNBOOK §6t day 17).
// Run: node tools/test_feed.js. The Worker runs against the D1 stand-in (tools/d1_stub.js) with the real migrations; the
// site's planner data comes from tools/planner.py, served by a stand-in for the site.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const d1 = require('./d1_stub.js');
const P = require('../static/planner.js');
const L = require('../static/list-store.js');

const SITE = 'https://dontdieretired.com', API = 'https://api.dontdieretired.com';
const data = JSON.parse(execFileSync('python3', [path.join(__dirname, 'planner.py'), '--json'], { maxBuffer: 64 << 20 }).toString());
const { training: TRAINING, ...published } = data;
const byId = Object.fromEntries(data.activities.map(a => [a.id, a]));
const mails = [], site = { hits: 0, down: false, body: JSON.stringify(published) };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}'); }
  if (url.startsWith(SITE + '/planner/')) {
    site.hits++;
    if (site.down) return new Response('down', { status: 502 });
    if (url === SITE + '/planner/activities.json') return new Response(site.body);
    const m = /\/planner\/training\/([^/]+)\.json$/.exec(url);
    if (m && TRAINING[decodeURIComponent(m[1])]) return new Response(JSON.stringify(TRAINING[decodeURIComponent(m[1])]));
    return new Response('not found', { status: 404 });
  }
  throw new Error('unexpected fetch ' + url);
};

(async () => {
  const W = await import('../worker/src/accounts.js');
  const F = await import('../worker/src/feed.js');
  let n = 0; const t = async (name, fn) => { F.forgetData(); site.hits = 0; site.down = false; await fn(); n++; console.log('ok  ' + name); };
  const env = (o = {}) => ({ DB: d1(), SALT: 'test-salt-0123456789', SITE_ORIGIN: SITE, MAIL_FROM: 'DDR <signin@dontdieretired.com>', RESEND_API_KEY: 'k', ...o });
  const post = (e, route, body, h = {}) => W.handle(new Request(API + route, {
    method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...h }, body: JSON.stringify(body),
  }), e);
  const get = (e, route, h = {}, method = 'GET') => W.handle(new Request(API + route, { method, headers: { 'cf-connecting-ip': '198.51.100.7', ...h } }), e);
  const signIn = async (e, email) => {
    await post(e, '/auth/start', { email });
    const tok = mails[mails.length - 1].text.match(/#t=([A-Za-z0-9_-]{43})/)[1];
    const r = await post(e, '/auth/verify', { token: tok });
    const c = (r.headers.get('set-cookie') || '').match(new RegExp(W.COOKIE + '=([^;]*)'))[1];
    return { cookie: `${W.COOKIE}=${c}`, id: (await r.json()).account };
  };
  const TODAY = F.ukToday();
  const later = n => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // a member's list: a beekeeping month, the Great North Run with the engine's training, a stay at the Fringe, and their own thing
  function sampleList() {
    let d = L.empty();
    const add = (id, extra) => { d.items.push(Object.assign({ id, cid: id, status: 'planned', added: TODAY, updated_at: new Date().toISOString(), pos: d.items.length, plan_made: TODAY }, extra)); };
    add('take-up-beekeeping', { month: later(120).slice(0, 7) });
    add('run-great-north-run', { date: later(150), level: 'active' });
    add('go-to-edinburgh-fringe', { date: later(200), until: later(203), where: 'Edinburgh' });
    d.items.push({ id: 'own-1', title: 'Paint the shed', status: 'planned', added: TODAY, updated_at: new Date().toISOString(), pos: 3, date: later(10) });
    return L.clean(d);
  }
  const sync = (e, who, list) => post(e, '/list/sync', { list, fields: L.FIELDS }, { cookie: who.cookie });
  const makeFeed = async (e, who) => { const r = await post(e, '/feed/make', {}, { cookie: who.cookie }); assert.strictEqual(r.status, 200); return (await r.json()).url; };
  const pathOf = u => new URL(u).pathname;
  const strip = s => s.replace(/^DTSTAMP:.*\r\n/gm, '');
  const expected = list => P.calendar(L.live(L.merge(list, null)), Object.assign({}, published, { training: TRAINING }), byId,
    { today: TODAY, site: SITE, name: "My year · Don't Die Retired", refresh: F.REFRESH }).text;

  await t('calendar() is My year\'s file: combine() then ics(), plans still to come only', () => {
    const items = L.live(sampleList()), S = Object.assign({}, published, { training: TRAINING });
    const entries = items.map(it => ({ id: it.id, title: it.cid ? byId[it.cid].title : it.title, item: it, activity: it.cid ? byId[it.cid] : null }));
    const all = P.combine(entries, S, { today: TODAY });
    const groups = all.plans.filter(p => p.status !== 'done').map(p => ({ id: p.id, cid: p.cid, title: p.title, by_month: !p.date, label: p.label, steps: all.steps.filter(s => s.pid === p.id) }));
    const a = P.ics(groups, S, { today: TODAY, stamp: '20270101T000000Z', name: 'My year' }), b = P.calendar(items, S, byId, { today: TODAY, stamp: '20270101T000000Z', name: 'My year' });
    assert.strictEqual(b.text, a.text); assert.strictEqual(b.count, a.count); assert.strictEqual(b.plans, 4);
    assert.ok(b.count > 40, 'training sessions are in it'); assert.ok(!/REFRESH-INTERVAL/.test(b.text), 'a downloaded file asks for no refresh');
    const c = P.calendar(items, S, byId, { today: TODAY, refresh: 'PT6H' }).text;
    assert.ok(/\r\nREFRESH-INTERVAL;VALUE=DURATION:PT6H\r\nX-PUBLISHED-TTL:PT6H\r\n/.test(c));
    assert.ok(!/REFRESH/.test(P.calendar(items, S, byId, { today: TODAY, refresh: 'PT6H\r\nX:1' }).text), 'only a plain duration is written');
    // a thing whose activity we no longer list is left out, as on My year; a done plan too
    const gone = items.concat([{ id: 'gone', cid: 'no-such-activity', status: 'planned', date: later(5), plan_made: TODAY }]);
    assert.strictEqual(P.calendar(gone, S, byId, { today: TODAY }).plans, 4);
    const done = items.map(it => (it.id === 'own-1' ? Object.assign({}, it, { status: 'done' }) : it));
    assert.strictEqual(P.calendar(done, S, byId, { today: TODAY }).plans, 3);
  });

  await t('making an address needs a session, our origin and JSON; only a hash is kept', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    assert.strictEqual((await post(e, '/feed/make', {})).status, 401);
    assert.strictEqual((await post(e, '/feed/make', {}, { cookie: a.cookie, origin: 'https://evil.example' })).status, 403);
    const r0 = await W.handle(new Request(API + '/feed/make', { method: 'POST', headers: { origin: SITE, 'content-type': 'text/plain', cookie: a.cookie }, body: '{}' }), e);
    assert.strictEqual(r0.status, 415);
    assert.strictEqual((await get(e, '/feed/make', { cookie: a.cookie })).status, 404, 'GET cannot make one');
    const u = await makeFeed(e, a);
    assert.match(u, /^https:\/\/api\.dontdieretired\.com\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const tok = u.match(/feed\/(.*)\.ics/)[1];
    const dump = JSON.stringify(e.DB.raw.prepare('SELECT * FROM feeds').all());
    assert.ok(!dump.includes(tok), 'the token is never stored'); assert.ok(!dump.includes('robin'), 'no email address');
    const me = await (await get(e, '/auth/me', { cookie: a.cookie })).json();
    assert.deepStrictEqual(Object.keys(me.feed).sort(), ['made', 'ok', 'on', 'read']); assert.strictEqual(me.feed.on, true); assert.strictEqual(me.feed.ok, true);
    assert.ok(!JSON.stringify(me).includes(tok), 'the address is shown once, never again');
  });

  await t('the feed is the account\'s plans, as My year would save them, with safe headers', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    const list = sampleList(); await sync(e, a, list);
    const u = await makeFeed(e, a);
    const r = await get(e, pathOf(u));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), null, 'no other site may read it');
    assert.strictEqual(r.headers.get('set-cookie'), null);
    const text = await r.text();
    assert.strictEqual(strip(text), strip(expected(list)));
    assert.ok(/X-WR-CALNAME:My year · Don't Die Retired/.test(text) && /Paint the shed/.test(text) && /REFRESH-INTERVAL/.test(text));
    for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'folded: ' + line);
    assert.ok(!/(aid|partner_id|tag)=/.test(text), 'no affiliate ids in a calendar');
    const me = await (await get(e, '/auth/me', { cookie: a.cookie })).json();
    assert.strictEqual(me.feed.read, TODAY, 'the account page can say when the calendar last looked');
    const h = await get(e, pathOf(u), {}, 'HEAD');
    assert.strictEqual(h.status, 200); assert.strictEqual(await h.text(), '');
  });

  await t('a change on any device is in the next fetch; an unchanged list is served without rebuilding', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    let list = sampleList(); await sync(e, a, list);
    const u = await makeFeed(e, a);
    const first = await (await get(e, pathOf(u))).text();
    F.forgetData(); site.hits = 0;
    const again = await (await get(e, pathOf(u))).text();
    assert.strictEqual(again, first, 'kept calendar served as it was');
    assert.strictEqual(site.hits, 1, 'only the data file is checked, no training fetched, nothing rebuilt');
    // a second device ticks the shed off and moves nothing else
    const other = L.clean(JSON.parse(JSON.stringify(list)));
    const shed = other.items.find(x => x.id === 'own-1'); shed.status = 'done'; shed.updated_at = new Date(Date.now() + 1000).toISOString();
    await sync(e, a, other);
    const after = await (await get(e, pathOf(u))).text();
    assert.ok(/Paint the shed/.test(first) && !/Paint the shed/.test(after), 'a thing done drops out');
    // the site publishes new planner data: rebuilt
    site.body = JSON.stringify(Object.assign({}, published, { built: 'x' })); F.forgetData();
    const row0 = e.DB.raw.prepare('SELECT cache_key FROM feeds').get().cache_key;
    await get(e, pathOf(u));
    assert.notStrictEqual(e.DB.raw.prepare('SELECT cache_key FROM feeds').get().cache_key, row0);
    site.body = JSON.stringify(published);
  });

  await t('a new address stops the old one; stopping ends it; unknown and malformed addresses get 404', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    const u1 = await makeFeed(e, a), u2 = await makeFeed(e, a);
    assert.notStrictEqual(u1, u2);
    assert.strictEqual((await get(e, pathOf(u1))).status, 404);
    assert.strictEqual((await get(e, pathOf(u2))).status, 200);
    assert.strictEqual((await post(e, '/feed/stop', {}, { cookie: a.cookie })).status, 200);
    assert.strictEqual((await get(e, pathOf(u2))).status, 404);
    const me = await (await get(e, '/auth/me', { cookie: a.cookie })).json(); assert.strictEqual(me.feed.on, false);
    for (const bad of ['/feed/short.ics', '/feed/' + 'a'.repeat(43), '/feed/' + 'a'.repeat(42) + '!.ics', '/feed/../auth/me.ics']) assert.strictEqual((await get(e, bad)).status, 404, bad);
  });

  await t('each account sees only its own plans', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com'), b = await signIn(e, 'sam@example.com');
    await sync(e, a, sampleList());
    const ub = await makeFeed(e, b), ua = await makeFeed(e, a);
    const tb = await (await get(e, pathOf(ub))).text(), ta = await (await get(e, pathOf(ua))).text();
    assert.ok(!/BEGIN:VEVENT/.test(tb), 'an empty list is an empty calendar'); assert.ok(/BEGIN:VEVENT/.test(ta));
  });

  await t('limits: one feed, guessing, and making addresses', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    const u = await makeFeed(e, a);
    for (let i = 0; i < F.LIMIT_FEED_HOUR; i++) assert.strictEqual((await get(e, pathOf(u))).status, 200);
    const r = await get(e, pathOf(u)); assert.strictEqual(r.status, 429); assert.strictEqual(r.headers.get('retry-after'), '3600');
    const fake = '/feed/' + 'b'.repeat(43) + '.ics';
    let last; for (let i = 0; i < 31; i++) last = await get(e, fake);
    assert.strictEqual(last.status, 429);
    let m; for (let i = 0; i < 9; i++) m = await post(e, '/feed/make', {}, { cookie: a.cookie });
    assert.strictEqual(m.status, 200); assert.strictEqual((await post(e, '/feed/make', {}, { cookie: a.cookie })).status, 429);
  });

  await t('with the paywall on: Plus only; a lapsed feed says it has stopped and starts again on rejoining', async () => {
    const e = env({ PLUS_PAYWALL: '1', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    const a = await signIn(e, 'robin@example.com');
    const me0 = await (await get(e, '/auth/me', { cookie: a.cookie })).json(); assert.strictEqual(me0.feed.ok, false);
    assert.strictEqual((await post(e, '/feed/make', {}, { cookie: a.cookie })).status, 403);
    const t0 = Math.floor(Date.now() / 1000);
    e.DB.raw.prepare(`INSERT INTO memberships (subscription, user_id, status, plan, period_end, cancel_at_end, updated) VALUES ('sub_1', ?, 'active', 'year', ?, 0, ?)`).run(a.id, t0 + 86400 * 300, t0);
    await sync(e, a, sampleList());
    const u = await makeFeed(e, a);
    assert.ok(/Paint the shed/.test(await (await get(e, pathOf(u))).text()));
    e.DB.raw.prepare(`UPDATE memberships SET status = 'canceled'`).run();
    const stopped = await (await get(e, pathOf(u))).text();
    assert.strictEqual((stopped.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(/stopped updating/.test(stopped) && !/Paint the shed/.test(stopped));
    for (const line of stopped.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'folded: ' + line);
    e.DB.raw.prepare(`UPDATE memberships SET status = 'active'`).run();
    assert.ok(/Paint the shed/.test(await (await get(e, pathOf(u))).text()), 'rejoining brings it back, same address');
  });

  await t('the site down: the last calendar, or 503 for the app to try later', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    await sync(e, a, sampleList());
    const u = await makeFeed(e, a);
    site.down = true;
    const r0 = await get(e, pathOf(u)); assert.strictEqual(r0.status, 503);
    site.down = false; const good = await (await get(e, pathOf(u))).text();
    const shed = sampleList(); shed.items.find(x => x.id === 'own-1').status = 'done'; shed.items.find(x => x.id === 'own-1').updated_at = new Date(Date.now() + 5000).toISOString();
    await sync(e, a, shed);
    F.forgetData(); site.down = true;
    const r1 = await get(e, pathOf(u)); assert.strictEqual(r1.status, 200); assert.strictEqual(await r1.text(), good);
  });

  await t('review fixes: training outage not kept, unreadable data falls back, plans capped, stray line breaks escaped', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    await sync(e, a, sampleList());
    const u = await makeFeed(e, a);
    const good = await (await get(e, pathOf(u))).text();
    const nGood = (good.match(/BEGIN:VEVENT/g) || []).length;
    // a new list rev while training files are down: sent without training, not kept, and whole again once they are back
    const keep = TRAINING['half-marathon']; delete TRAINING['half-marathon']; F.forgetData();
    const l2 = sampleList(); l2.items.find(x => x.id === 'own-1').title = 'Paint the fence'; l2.items.find(x => x.id === 'own-1').updated_at = new Date(Date.now() + 3000).toISOString();
    await sync(e, a, l2);
    const thin = await (await get(e, pathOf(u))).text();
    assert.ok((thin.match(/BEGIN:VEVENT/g) || []).length < nGood);
    assert.ok(/Paint the shed/.test(e.DB.raw.prepare('SELECT cache FROM feeds').get().cache), 'the last good calendar is still the one kept');
    TRAINING['half-marathon'] = keep;
    const whole = await (await get(e, pathOf(u))).text();
    assert.strictEqual((whole.match(/BEGIN:VEVENT/g) || []).length, nGood); assert.ok(/Paint the fence/.test(whole));
    // the site sends an error page with 200: the last calendar, never an exception
    site.body = '<html>oops</html>'; F.forgetData();
    const l3 = JSON.parse(JSON.stringify(l2)); l3.items.find(x => x.id === 'own-1').title = 'Paint the gate'; l3.items.find(x => x.id === 'own-1').updated_at = new Date(Date.now() + 6000).toISOString();
    await sync(e, a, L.clean(l3));
    const r = await get(e, pathOf(u)); assert.strictEqual(r.status, 200); assert.ok(/Paint the fence/.test(await r.text()));
    site.body = JSON.stringify(published); F.forgetData();
    assert.ok(/Paint the gate/.test(await (await get(e, pathOf(u))).text()));
    // the cap: soonest plans first, none beyond the horizon, nothing done
    const many = Array.from({ length: F.FEED_PLANS + 30 }, (_, i) => ({ id: 'o' + i, title: 'T' + i, status: 'planned', date: later(i + 1) }));
    many.push({ id: 'far', title: 'Far', status: 'planned', date: later(800) }, { id: 'dn', title: 'Done', status: 'done', date: later(1) });
    const got = F.feedItems(many, TODAY);
    assert.strictEqual(got.length, F.FEED_PLANS); assert.strictEqual(got[0].id, 'o0'); assert.ok(!got.some(x => x.id === 'far' || x.id === 'dn'));
    // a lone carriage return in a member's own title cannot start a new line in the file
    const S = Object.assign({}, published, { training: {} });
    const txt = P.calendar([{ id: 'x', title: 'A\rBEGIN:VEVENT\u0007', status: 'planned', date: later(3) }], S, byId, { today: TODAY }).text;
    assert.ok(!/\r(?!\n)/.test(txt), 'no bare CR'); assert.ok(!/\u0007/.test(txt), 'no control characters');
    assert.strictEqual(txt.split('\r\n').filter(l => l === 'BEGIN:VEVENT').length, 1, 'still one entry');
  });

  await t('deleting the account deletes its feed; the clean-up removes any left over', async () => {
    const e = env(), a = await signIn(e, 'robin@example.com');
    const u = await makeFeed(e, a);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.strictEqual((await get(e, pathOf(u))).status, 404);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM feeds').get().n, 0);
    e.DB.raw.prepare(`INSERT INTO feeds (hash, user_id, created) VALUES ('h', 'nobody', 1)`).run();
    await W.tidy(e);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM feeds').get().n, 0);
  });

  console.log(`\n${n} feed tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

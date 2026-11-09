// Tests for the accounts Worker (worker/src/accounts.js, RUNBOOK §6t day 12). Run: node tools/test_accounts.js
// The Worker runs against a stand-in for Cloudflare D1 built on Node's own SQLite, with the real migration applied.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

function d1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '../worker/migrations');
  fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().forEach(f => db.exec(fs.readFileSync(path.join(dir, f), 'utf8')));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) || null,
    run: async () => (db.prepare(sql).run(...args), { success: true }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { list.forEach(s => s._exec()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; } };
}

const SITE = 'https://dontdieretired.com';
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('{}', { status: 200 }); };

(async () => {
  const W = await import('../worker/src/accounts.js');
  let n = 0; const t = async (name, fn) => { sent.length = 0; await fn(); n++; console.log('ok  ' + name); };
  const env = (o = {}) => ({ DB: d1(), SALT: 'test-salt-0123456789', SITE_ORIGIN: SITE, MAIL_FROM: 'DDR <signin@dontdieretired.com>', RESEND_API_KEY: 'k', ...o });
  const post = (e, route, body, h = {}) => W.handle(new Request('https://api.dontdieretired.com' + route, {
    method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), e);
  const get = (e, route, h = {}) => W.handle(new Request('https://api.dontdieretired.com' + route, { headers: h }), e);
  const linkFrom = () => JSON.parse(sent[sent.length - 1].init.body).text.match(/#t=([A-Za-z0-9_-]{43})/)[1];
  const cookieFrom = r => (r.headers.get('set-cookie') || '').match(new RegExp(W.COOKIE + '=([^;]*)'))[1];
  const signIn = async (e, email = 'Robin@Example.com') => {
    await post(e, '/auth/start', { email }); const tok = linkFrom();
    const r = await post(e, '/auth/verify', { token: tok });
    return { r, tok, cookie: `${W.COOKIE}=${cookieFrom(r)}` };
  };

  await t('emails are tidied and checked', () => {
    assert.strictEqual(W.normEmail('  Robin@Example.COM '), 'robin@example.com');
    for (const bad of ['', 'robin', 'a@b', 'a b@c.com', '<x>@y.com', 'a@b..com', 'x'.repeat(250) + '@e.com']) assert.strictEqual(W.normEmail(bad), null, bad);
  });
  await t('tokens are 32 random bytes and never repeat', () => {
    const s = new Set(Array.from({ length: 200 }, W.randomToken));
    assert.strictEqual(s.size, 200); for (const x of s) assert.match(x, /^[A-Za-z0-9_-]{43}$/);
  });
  await t('start sends one email with the link after #, and stores only a hash', async () => {
    const e = env(); const r = await post(e, '/auth/start', { email: 'robin@example.com' });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(await r.json(), { ok: true });
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].url, 'https://api.resend.com/emails');
    const b = JSON.parse(sent[0].init.body); assert.deepStrictEqual(b.to, ['robin@example.com']);
    assert.ok(b.text.includes(SITE + '/account/#t=')); assert.ok(!/[@%]|robin/.test(b.text.match(/https:\S+/)[0]), 'no email address in the link');
    const tok = linkFrom(); const rows = e.DB.raw.prepare('SELECT * FROM signin').all();
    assert.strictEqual(rows.length, 1); assert.notStrictEqual(rows[0].hash, tok); assert.strictEqual(rows[0].hash.length, 64);
  });
  await t('the answer is the same for a known and an unknown address', async () => {
    const e = env(); await signIn(e, 'known@example.com');
    const a = await (await post(e, '/auth/start', { email: 'known@example.com' })).json();
    const b = await (await post(e, '/auth/start', { email: 'nobody@example.com' })).json();
    assert.deepStrictEqual(a, b);
  });
  await t('a bad address is refused and sends nothing', async () => {
    const r = await post(env(), '/auth/start', { email: 'not an email' }); assert.strictEqual(r.status, 400); assert.strictEqual(sent.length, 0);
  });
  await t('verify signs in, sets a secure host-only cookie and creates one member', async () => {
    const e = env(); const { r } = await signIn(e);
    assert.strictEqual(r.status, 200); const v = await r.json();
    assert.strictEqual(v.ok, true); assert.strictEqual(v.email, 'robin@example.com');
    assert.strictEqual(v.account, e.DB.raw.prepare('SELECT id FROM users').get().id, 'the opaque account id (a random UUID) for the shared-browser check');
    const c = r.headers.get('set-cookie');
    for (const part of ['__Host-ddr_s=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(c.includes(part), part);
    assert.ok(!/Domain=/i.test(c));
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    const s = e.DB.raw.prepare('SELECT hash FROM sessions').get(); assert.notStrictEqual(s.hash, cookieFrom(r));
  });
  await t('a link works once only', async () => {
    const e = env(); const { tok } = await signIn(e);
    const again = await post(e, '/auth/verify', { token: tok }); assert.strictEqual(again.status, 400); assert.strictEqual(again.headers.get('set-cookie'), null);
  });
  await t('a link stops working after 30 minutes', async () => {
    const e = env(); await post(e, '/auth/start', { email: 'robin@example.com' }); const tok = linkFrom();
    e.DB.raw.exec(`UPDATE signin SET expires = ${Math.floor(Date.now() / 1000) - 1}`);
    assert.strictEqual((await post(e, '/auth/verify', { token: tok })).status, 400);
  });
  await t('signing in with one link spends the other links sent to that address', async () => {
    const e = env(); await post(e, '/auth/start', { email: 'robin@example.com' }); const first = linkFrom();
    await post(e, '/auth/start', { email: 'robin@example.com' }); const second = linkFrom();
    assert.strictEqual((await post(e, '/auth/verify', { token: second })).status, 200);
    assert.strictEqual((await post(e, '/auth/verify', { token: first })).status, 400);
  });
  await t('a made-up or malformed token is refused', async () => {
    const e = env();
    assert.strictEqual((await post(e, '/auth/verify', { token: W.randomToken() })).status, 400);
    assert.strictEqual((await post(e, '/auth/verify', { token: "x' OR 1=1 --" })).status, 400);
  });
  await t('signing in again keeps the same member', async () => {
    const e = env(); await signIn(e, 'robin@example.com'); await signIn(e, 'ROBIN@example.com');
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  });
  await t('me: signed out without a cookie, signed in with one, never with a made-up one', async () => {
    const e = env(); const { cookie } = await signIn(e);
    assert.deepStrictEqual(await (await get(e, '/auth/me')).json(), { signed_in: false });
    const me = await (await get(e, '/auth/me', { cookie })).json();
    assert.strictEqual(me.signed_in, true); assert.strictEqual(me.email, 'robin@example.com'); assert.match(me.account, /^[0-9a-f-]{36}$/);
    assert.deepStrictEqual(await (await get(e, '/auth/me', { cookie: `${W.COOKIE}=${W.randomToken()}` })).json(), { signed_in: false });
  });
  await t('a session is renewed at most once a day; an expired one is signed out', async () => {
    const e = env(); const { cookie } = await signIn(e); const t0 = Math.floor(Date.now() / 1000);
    assert.strictEqual((await get(e, '/auth/me', { cookie })).headers.get('set-cookie'), null, 'not renewed on the day it began');
    e.DB.raw.exec(`UPDATE sessions SET expires = ${t0 + 86400}, renewed = ${t0 - 86400}`);
    const r = await get(e, '/auth/me', { cookie }); assert.ok(r.headers.get('set-cookie').includes('Max-Age=' + 90 * 86400));
    assert.ok(e.DB.raw.prepare('SELECT expires FROM sessions').get().expires > t0 + 80 * 86400);
    e.DB.raw.exec(`UPDATE sessions SET expires = ${t0 - 1}`);
    assert.deepStrictEqual(await (await get(e, '/auth/me', { cookie })).json(), { signed_in: false });
  });
  await t('sign out ends the session on the server and clears the cookie', async () => {
    const e = env(); const { cookie } = await signIn(e);
    const r = await post(e, '/auth/signout', {}, { cookie }); assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'));
    assert.deepStrictEqual(await (await get(e, '/auth/me', { cookie })).json(), { signed_in: false });
  });
  await t('delete needs a session and a confirmation, then removes the member and every session', async () => {
    const e = env(); const a = await signIn(e); const b = await signIn(e);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true })).status, 401);
    assert.strictEqual((await post(e, '/auth/delete', {}, { cookie: a.cookie })).status, 400);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    assert.deepStrictEqual(await (await get(e, '/auth/me', { cookie: b.cookie })).json(), { signed_in: false });
  });
  await t('changes from another site, or not as JSON, are refused', async () => {
    const e = env(); const { cookie } = await signIn(e);
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie, origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await post(e, '/auth/start', { email: 'a@example.com' }, { origin: '' })).status, 403);
    assert.strictEqual((await post(e, '/auth/delete', 'confirm=true', { cookie, 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.strictEqual((await post(e, '/auth/start', JSON.stringify({ email: 'a@example.com', pad: 'x'.repeat(5000) }))).status, 413);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  });
  await t('CORS answers only our own site, with credentials', async () => {
    const r = await W.handle(new Request('https://api.dontdieretired.com/auth/me', { method: 'OPTIONS' }), env());
    assert.strictEqual(r.status, 204); assert.strictEqual(r.headers.get('access-control-allow-origin'), SITE);
    assert.strictEqual(r.headers.get('access-control-allow-credentials'), 'true');
  });
  await t('too many emails to one address: same answer, nothing more sent', async () => {
    const e = env();
    for (let i = 0; i < 5; i++) await post(e, '/auth/start', { email: 'robin@example.com' }, { 'cf-connecting-ip': '192.0.2.' + i });
    const count = sent.length; const r = await post(e, '/auth/start', { email: 'robin@example.com' }, { 'cf-connecting-ip': '192.0.2.99' });
    assert.strictEqual(count, 5); assert.strictEqual(sent.length, 5); assert.deepStrictEqual(await r.json(), { ok: true });
    const keys = e.DB.raw.prepare('SELECT key FROM throttle').all().map(x => x.key).join(' ');
    assert.ok(!keys.includes('robin') && !keys.includes('192.0.2'), 'throttle keeps no email or IP');
  });
  await t('too many requests from one network are slowed down', async () => {
    const e = env(); let last;
    for (let i = 0; i < 31; i++) last = await post(e, '/auth/start', { email: `p${i}@example.com` });
    assert.strictEqual(last.status, 429);
  });
  await t('the local test mode hands back the link, but never on the real site', async () => {
    const dev = env({ SITE_ORIGIN: 'http://localhost:8000', DEV_MAIL: '1', RESEND_API_KEY: '' });
    const r = await post(dev, '/auth/start', { email: 'robin@example.com' }, { origin: 'http://localhost:8000' });
    assert.match((await r.json()).dev_link, /^http:\/\/localhost:8000\/account\/#t=[A-Za-z0-9_-]{43}$/); assert.strictEqual(sent.length, 0);
    const live = env({ DEV_MAIL: '1', RESEND_API_KEY: '' });
    const r2 = await post(live, '/auth/start', { email: 'robin@example.com' });
    assert.strictEqual(r2.status, 503); assert.ok(!('dev_link' in await r2.json()));
  });
  await t('the throttle counts one inbox and one IPv6 network', () => {
    assert.strictEqual(W.inboxKey('robin+1@example.com'), 'robin@example.com');
    assert.strictEqual(W.inboxKey('robin@example.com'), 'robin@example.com');
    assert.strictEqual(W.netKey('2001:db8:1:2:aaaa::1'), W.netKey('2001:0db8:0001:0002:ffff:1:2:3'));
    assert.notStrictEqual(W.netKey('2001:db8:1:2::1'), W.netKey('2001:db8:1:3::1'));
    assert.strictEqual(W.netKey('192.0.2.7'), '192.0.2.7');
  });
  await t('plus-addresses share one inbox limit', async () => {
    const e = env();
    for (let i = 0; i < 7; i++) await post(e, '/auth/start', { email: `robin+${i}@example.com` });
    assert.strictEqual(sent.length, 5);
  });
  await t('an overall hourly cap stops a flood of different addresses', async () => {
    const e = env(); let last;
    for (let i = 0; i < 301; i++) last = await post(e, '/auth/start', { email: `p${i}@example.com` }, { 'cf-connecting-ip': `198.51.${i >> 8}.${i & 255}` });
    assert.strictEqual(last.status, 503); assert.strictEqual(sent.length, 300);
  });
  await t('if the email service fails, the page is told and no session exists', async () => {
    const e = env(); const keep = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network'); };
    const r = await post(e, '/auth/start', { email: 'robin@example.com' }); globalThis.fetch = keep;
    assert.strictEqual(r.status, 502); assert.strictEqual(r.headers.get('access-control-allow-origin'), SITE);
  });
  await t('the hourly clean-up removes spent links, ended sessions and old counts only', async () => {
    const e = env(); await signIn(e, 'a@example.com'); await post(e, '/auth/start', { email: 'b@example.com' });
    const old = Math.floor(Date.now() / 1000) - 10;
    await signIn(e, 'c@example.com'); e.DB.raw.exec(`UPDATE sessions SET expires = ${old} WHERE user_id = (SELECT id FROM users WHERE email = 'c@example.com')`);
    e.DB.raw.exec(`INSERT INTO throttle (key, n, expires) VALUES ('old', 1, ${old})`);
    await W.tidy(e);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM signin').get().n, 1);
    assert.strictEqual(e.DB.raw.prepare("SELECT COUNT(*) n FROM throttle WHERE key = 'old'").get().n, 0);
  });
  /* ---- day 13: the member's list and plans ---- */
  const L = require('../static/list-store.js');
  const item = (id, o = {}) => ({ id, cid: id, status: 'want', pos: 0, added_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', ...o });
  const lst = (...items) => ({ version: 1, title: 'My list', target: 50, settings_updated_at: '', items });
  const sync = async (e, cookie, list, h = {}) => { const r = await post(e, '/list/sync', { list }, { cookie, ...h }); return { status: r.status, d: await r.json().catch(() => ({})) }; };
  await t('list sync needs a session, our origin and JSON', async () => {
    const e = env(), a = await signIn(e);
    assert.strictEqual((await sync(e, '', lst())).status, 401);
    assert.strictEqual((await sync(e, a.cookie, lst(), { origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await post(e, '/list/sync', 'list=1', { cookie: a.cookie, 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.strictEqual((await sync(e, a.cookie, 'nope')).status, 400);
    assert.strictEqual((await sync(e, a.cookie, [])).status, 400);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
  });
  await t('first sign-in: the browser list becomes the account list, cleaned', async () => {
    const e = env(), a = await signIn(e);
    const mine = lst(item('learn-to-sail', { status: 'planned', date: '2027-06-12', plan_made: '2026-11-09', evil: '<script>' }), item('x-abc', { cid: null, title: 'Visit Aunt May' }));
    const r = await sync(e, a.cookie, mine);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.d.rev, 1);
    assert.deepStrictEqual(r.d.list, L.merge(null, mine));
    assert.ok(!JSON.stringify(r.d.list).includes('evil'), 'only known fields are stored');
    const row = e.DB.raw.prepare('SELECT * FROM lists').get();
    assert.deepStrictEqual(JSON.parse(row.data), r.d.list);
  });
  await t('two devices: each keeps what the other did (merge, never overwrite)', async () => {
    const e = env(), a = await signIn(e), b = await signIn(e);   // phone and laptop, same account
    await sync(e, a.cookie, lst(item('beekeeping', { status: 'planned', month: '2027-03', plan_made: '2026-11-09', updated_at: '2026-11-09T09:00:00.000Z' })));
    const r = await sync(e, b.cookie, lst(item('pickleball', { updated_at: '2026-11-09T10:00:00.000Z' })));
    assert.deepStrictEqual(r.d.list.items.map(i => i.id).sort(), ['beekeeping', 'pickleball']);
    assert.strictEqual(r.d.rev, 2);
    // the phone ticks a step; the laptop, which never saw the tick, syncs an older copy of the same plan
    const plan = { status: 'planned', month: '2027-03', plan_made: '2026-11-09' };
    await sync(e, a.cookie, lst(item('beekeeping', { ...plan, ticks: { first: { done: true, at: '2026-11-09T11:00:00.000Z' } }, updated_at: '2026-11-09T11:00:00.000Z' })));
    const back = await sync(e, b.cookie, lst(item('beekeeping', { ...plan, ticks: { safety: { done: true, at: '2026-11-09T11:30:00.000Z' } }, updated_at: '2026-11-09T11:30:00.000Z' })));
    const bee = back.d.list.items.find(i => i.id === 'beekeeping');
    assert.deepStrictEqual(Object.keys(bee.ticks).sort(), ['first', 'safety']);
    assert.ok(back.d.list.items.some(i => i.id === 'pickleball'));
  });
  await t('a deletion on one device is not undone by an older copy on another', async () => {
    const e = env(), a = await signIn(e);
    await sync(e, a.cookie, lst(item('surf', { deleted: true, updated_at: '2026-11-09T12:00:00.000Z' })));
    const r = await sync(e, a.cookie, lst(item('surf', { updated_at: '2026-11-09T08:00:00.000Z' })));
    assert.strictEqual(r.d.list.items[0].deleted, true);
  });
  await t('nothing new: no write; members never see each other\'s lists', async () => {
    const e = env(), a = await signIn(e, 'a@example.com'), b = await signIn(e, 'b@example.com');
    const one = lst(item('tango'));
    const r1 = await sync(e, a.cookie, one), r2 = await sync(e, a.cookie, r1.d.list);
    assert.strictEqual(r2.d.rev, r1.d.rev);
    const rb = await sync(e, b.cookie, lst());
    assert.strictEqual(rb.d.list.items.length, 0);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 2);
  });
  await t('a write that loses a race reads again and merges, so neither device loses its change', async () => {
    const e = env(), a = await signIn(e);
    await sync(e, a.cookie, lst(item('harp', { updated_at: '2026-11-09T09:00:00.000Z' })));
    // another device writes between our read and our write: simulate by bumping the row the first time it is updated
    const realPrepare = e.DB.prepare; let raced = false;
    e.DB.prepare = sql => {
      if (!raced && sql.startsWith('UPDATE lists')) {
        raced = true;
        const other = L.merge(JSON.parse(e.DB.raw.prepare('SELECT data FROM lists').get().data), lst(item('banjo', { updated_at: '2026-11-09T09:30:00.000Z' })));
        e.DB.raw.prepare('UPDATE lists SET data = ?, rev = rev + 1').run(JSON.stringify(other));
      }
      return realPrepare(sql);
    };
    const r = await sync(e, a.cookie, lst(item('flute', { updated_at: '2026-11-09T10:00:00.000Z' })));
    e.DB.prepare = realPrepare;
    assert.strictEqual(r.status, 200); assert.strictEqual(r.d.rev, 3);
    assert.deepStrictEqual(r.d.list.items.map(i => i.id).sort(), ['banjo', 'flute', 'harp']);
  });
  await t('too big, too new or too often is refused and nothing is stored', async () => {
    const e = env(), a = await signIn(e);
    const big = lst(...Array.from({ length: 3000 }, (_, i) => item('x-' + i, { cid: null, title: 'y'.repeat(100), note: 'n'.repeat(100) })));
    assert.strictEqual((await sync(e, a.cookie, big)).status, 413);
    assert.strictEqual((await sync(e, a.cookie, { ...lst(), version: 2 })).status, 409);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
    const e2 = env(), b = await signIn(e2); let last;
    for (let i = 0; i <= 600; i++) last = await sync(e2, b.cookie, lst());
    assert.strictEqual(last.status, 429);
  });
  await t('a list of too many things is refused before any merging', async () => {
    const e = env(), a = await signIn(e);
    const many = lst(...Array.from({ length: 2001 }, (_, i) => ({ id: String(i) })));
    assert.strictEqual((await sync(e, a.cookie, many)).status, 413);
  });
  await t('a page newer than the Worker (more fields) is refused, not squeezed', async () => {
    const e = env(), a = await signIn(e);
    const r = await post(e, '/list/sync', { list: lst(), fields: L.FIELDS + 1 }, { cookie: a.cookie });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await post(e, '/list/sync', { list: lst(), fields: L.FIELDS }, { cookie: a.cookie })).status, 200);
  });
  await t('list: null sends back the account copy without changing it', async () => {
    const e = env(), a = await signIn(e);
    const none = await sync(e, a.cookie, null);
    assert.strictEqual(none.status, 200); assert.deepStrictEqual(none.d.list.items, []);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
    await sync(e, a.cookie, lst(item('tap')));
    const r = await sync(e, a.cookie, null);
    assert.deepStrictEqual(r.d.list.items.map(i => i.id), ['tap']); assert.strictEqual(r.d.rev, 1);
  });
  await t('removed things keep only what a merge needs', async () => {
    const e = env(), a = await signIn(e);
    const r = await sync(e, a.cookie, lst(item('x-1', { cid: null, title: 'Private', note: 'secret', deleted: true, where: 'Leeds', plan_made: '2026-11-09', date: '2027-01-01' })));
    const it = r.d.list.items[0];
    assert.strictEqual(it.deleted, true); assert.strictEqual(it.title, ''); assert.strictEqual(it.note, ''); assert.strictEqual(it.where, ''); assert.strictEqual(it.date, '');
  });
  await t('a sync that races the account being deleted leaves nothing behind', async () => {
    const e = env(), a = await signIn(e);
    const realPrepare = e.DB.prepare; let done = false;
    e.DB.prepare = sql => {   // the member is deleted between the session check and the write
      if (!done && sql.startsWith('SELECT data, rev FROM lists')) { done = true; e.DB.raw.exec('DELETE FROM users'); }
      return realPrepare(sql);
    };
    const r = await sync(e, a.cookie, lst(item('salsa')));
    e.DB.prepare = realPrepare;
    assert.strictEqual(r.status, 401);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
    e.DB.raw.exec(`INSERT INTO lists (user_id, data, rev, updated) VALUES ('gone', '{}', 1, 0)`);
    await W.tidy(e);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0, 'the hourly clean-up removes any list without a member');
  });
  await t('other requests are still limited to 4 KB', async () => {
    const e = env();
    assert.strictEqual((await post(e, '/auth/start', { email: 'a@example.com', pad: 'p'.repeat(5000) })).status, 413);
  });
  await t('deleting the account deletes the list and plans', async () => {
    const e = env(), a = await signIn(e);
    await sync(e, a.cookie, lst(item('padel')));
    assert.strictEqual((await post(e, '/auth/delete', { confirm: true }, { cookie: a.cookie })).status, 200);
    assert.strictEqual(e.DB.raw.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
  });
  await t('not configured: refuses everything', async () => {
    assert.strictEqual((await get({ DB: d1(), SITE_ORIGIN: SITE }, '/auth/me')).status, 503);
  });
  console.log(`\n${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

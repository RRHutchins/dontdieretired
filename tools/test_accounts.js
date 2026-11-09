// Tests for the accounts Worker (worker/src/accounts.js, RUNBOOK §6t day 12). Run: node tools/test_accounts.js
// The Worker runs against a stand-in for Cloudflare D1 built on Node's own SQLite, with the real migration applied.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../worker/migrations/0001_accounts.sql'), 'utf8'));
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
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(await r.json(), { ok: true, email: 'robin@example.com' });
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
    assert.deepStrictEqual(await (await get(e, '/auth/me', { cookie })).json(), { signed_in: true, email: 'robin@example.com' });
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
  await t('not configured: refuses everything', async () => {
    assert.strictEqual((await get({ DB: d1(), SITE_ORIGIN: SITE }, '/auth/me')).status, 503);
  });
  console.log(`\n${n} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });

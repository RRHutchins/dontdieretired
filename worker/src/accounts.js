// Don't Die Retired accounts (Planner Plus, RUNBOOK §6t, days 12 and 13: sign-in, then the member's list and plans). The Worker's entry is index.js (a Worker module may
// export only handlers, so everything else lives here).
// A Cloudflare Worker with a D1 database, at https://api.dontdieretired.com once Robin deploys it.
//
// Sign-in is by an emailed link: no passwords. Nothing personal ever goes in a URL. The link carries only a
// random, single-use token in the part after "#", which browsers never send to any server; the account page
// posts it here and the token is spent. We store only a hash of each token, never the token itself.
//
// Bindings (worker/wrangler.toml): DB (D1). Vars: SITE_ORIGIN, MAIL_FROM.
// Secrets (wrangler secret put): SALT (long random string), RESEND_API_KEY (the sign-in email sender).
// Local test only (worker/.dev.vars, never committed): DEV_MAIL=1 returns the link instead of emailing it,
// and is refused unless SITE_ORIGIN is a localhost address.

import DDRList from '../../static/list-store.js';   // the browser's own merge(), so both sides combine lists the same way

export const LINK_MINUTES = 30;            // a sign-in link works once, for this long
export const SESSION_DAYS = 90;            // then the member signs in again
const RENEW_AFTER = 86400;                 // a session used a day or more after its last renewal is extended to SESSION_DAYS
                                           // (daily, because Safari caps cookies from some servers at 7 days)
const LIMIT_EMAIL_HOUR = 5;                // sign-in emails to one address per hour
const LIMIT_IP_HOUR = 30;                  // sign-in requests from one network per hour
const LIMIT_ALL_HOUR = 300;                // sign-in emails in total per hour (protects the sender's quota and reputation)
export const COOKIE = '__Host-ddr_s';
export const LIST_MAX = 262144;            // bytes: a list and its plans, stored as JSON (a busy year is a few tens of KB)
const LIST_ITEMS = 2000;                   // things on one list, kept or removed
const LIMIT_SYNC_HOUR = 600;               // list syncs per member per hour (a device syncs after changes and on each visit)
const BODY_MAX = 4096;                     // every other request

const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;       // 32 random bytes, base64url
const now = () => Math.floor(Date.now() / 1000);

function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function hmac(key, s) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return s.length <= 254 && EMAIL.test(s) ? s : null;
}
// the throttle counts one inbox, not each spelling of it: "a+1@x.com" and "a+2@x.com" count as "a@x.com"
export const inboxKey = e => e.replace(/\+[^@]*@/, '@');
// and one network, not each address: IPv6 hands a whole /64 to one connection
export function netKey(ip) {
  ip = String(ip || 'x');
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return full.slice(0, 4).map(x => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
const isLocal = o => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || '');

function headers(env, extra = {}) {
  return {
    'content-type': 'application/json', 'cache-control': 'no-store',
    'access-control-allow-origin': env.SITE_ORIGIN, 'access-control-allow-credentials': 'true', vary: 'Origin',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra,
  };
}
const json = (env, d, s = 200, extra) => new Response(JSON.stringify(d), { status: s, headers: headers(env, extra) });

function cookieOf(req) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}
const setCookie = (v, maxAge) => `${COOKIE}=${v}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

// at most `limit` hits per key per hour; the key is a keyed hash, so the table holds no email or IP address
async function over(env, kind, value, limit) {
  const hour = Math.floor(now() / 3600);
  const key = await hmac(env.SALT, `${kind}|${value}|${hour}`);
  const r = await env.DB.prepare(`INSERT INTO throttle (key, n, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n`)
    .bind(key, (hour + 2) * 3600).first();
  return !r || r.n > limit;
}

export async function tidy(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM signin WHERE expires < ?`).bind(t),
    env.DB.prepare(`DELETE FROM sessions WHERE expires < ?`).bind(t),
    env.DB.prepare(`DELETE FROM throttle WHERE expires < ?`).bind(t),
    env.DB.prepare(`DELETE FROM lists WHERE user_id NOT IN (SELECT id FROM users)`),
  ]);
}

export function mailText(link) {
  const text = `Here is your link to sign in to Don't Die Retired:\n\n${link}\n\nIt works once, in the next ${LINK_MINUTES} minutes. ` +
    `If you did not ask for it, you can ignore this email: nobody can sign in without the link.\n\nDon't Die Retired\nhttps://dontdieretired.com`;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>Here is your link to sign in to Don't Die Retired:</p><p><a href="${esc(link)}">Sign in to Don't Die Retired</a></p>` +
    `<p>It works once, in the next ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email: nobody can sign in without the link.</p>`;
  return { subject: "Your sign-in link for Don't Die Retired", text, html };
}

// The one place that sends email. Resend's HTTP API (chosen 9 Nov 2026; swap here if Robin picks another sender).
async function sendMail(env, to, link) {
  const m = mailText(link);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: m.subject, text: m.text, html: m.html }),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function session(env, req) {
  const tok = cookieOf(req);
  if (!TOKEN.test(tok)) return null;
  const h = await sha256(tok);
  const s = await env.DB.prepare(`SELECT s.hash, s.expires, s.renewed, u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires > ?`)
    .bind(h, now()).first();
  return s ? { ...s, token: tok } : null;
}

async function start(env, req, body) {
  const email = normEmail(body.email);
  if (!email) return json(env, { error: 'email' }, 400);
  if (await over(env, 'ip', netKey(req.headers.get('cf-connecting-ip')), LIMIT_IP_HOUR)) return json(env, { error: 'slow down' }, 429);
  // the same answer whether or not the address has an account, and whether or not it was throttled
  if (await over(env, 'email', inboxKey(email), LIMIT_EMAIL_HOUR)) return json(env, { ok: true });
  if (await over(env, 'all', '', LIMIT_ALL_HOUR)) return json(env, { error: 'busy' }, 503);
  const dev = env.DEV_MAIL === '1' && isLocal(env.SITE_ORIGIN);
  if (!dev && !env.RESEND_API_KEY) return json(env, { error: 'not configured' }, 503);
  const tok = randomToken();
  await env.DB.prepare(`INSERT INTO signin (hash, email, expires, created) VALUES (?, ?, ?, ?)`)
    .bind(await sha256(tok), email, now() + LINK_MINUTES * 60, now()).run();
  const link = `${env.SITE_ORIGIN}/account/#t=${tok}`;
  if (dev) return json(env, { ok: true, dev_link: link });
  if (!(await sendMail(env, email, link))) return json(env, { error: 'send' }, 502);
  return json(env, { ok: true });
}

async function verify(env, req, body) {
  const tok = String(body.token || '');
  if (!TOKEN.test(tok)) return json(env, { error: 'link' }, 400);
  if (await over(env, 'verify', netKey(req.headers.get('cf-connecting-ip')), LIMIT_IP_HOUR)) return json(env, { error: 'slow down' }, 429);
  // spend the token in one statement, so two tabs (or a replay) cannot both use it
  const row = await env.DB.prepare(`UPDATE signin SET used = 1 WHERE hash = ? AND used = 0 AND expires > ? RETURNING email`)
    .bind(await sha256(tok), now()).first();
  if (!row) return json(env, { error: 'link' }, 400);
  const email = row.email, t = now();
  await env.DB.prepare(`INSERT INTO users (id, email, created) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING`).bind(crypto.randomUUID(), email, t).run();
  const u = await env.DB.prepare(`SELECT id, email FROM users WHERE email = ?`).bind(email).first();
  const st = randomToken(), maxAge = SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (hash, user_id, expires, created, renewed) VALUES (?, ?, ?, ?, ?)`).bind(await sha256(st), u.id, t + maxAge, t, t),
    env.DB.prepare(`DELETE FROM signin WHERE email = ?`).bind(email),   // any other links sent to this address stop working
  ]);
  return json(env, { ok: true, email: u.email, account: u.id }, 200, { 'set-cookie': setCookie(st, maxAge) });
}

// Planner Plus day 13: the member's list and plans. The device sends its whole list; we merge it with the account's
// copy (never overwrite), store the result and send it back for the device to merge in turn. The write only lands
// if the row is still the one we read (rev), so two devices syncing at once cannot lose each other's changes.
async function syncList(env, s, body) {
  const inc = body.list, pull = inc === null;   // null: just send the account's copy back (a shared browser starting afresh)
  if (!pull && (!inc || typeof inc !== 'object' || Array.isArray(inc))) return json(env, { error: 'list' }, 400);
  // a newer browser's data must not be squeezed through an older Worker's clean(): refuse until the Worker is updated
  if (!pull && typeof inc.version === 'number' && inc.version > DDRList.VERSION) return json(env, { error: 'version' }, 409);
  if (typeof body.fields === 'number' && body.fields > DDRList.FIELDS) return json(env, { error: 'version' }, 409);
  if (!pull && Array.isArray(inc.items) && inc.items.length > LIST_ITEMS) return json(env, { error: 'too big' }, 413);
  if (await over(env, 'sync', s.id, LIMIT_SYNC_HOUR)) return json(env, { error: 'slow down' }, 429);
  const mine = pull ? null : DDRList.clean(inc);
  if (mine && JSON.stringify(mine).length > LIST_MAX) return json(env, { error: 'too big' }, 413);
  for (let i = 0; i < 4; i++) {
    const row = await env.DB.prepare(`SELECT data, rev FROM lists WHERE user_id = ?`).bind(s.id).first();
    let stored = null;
    if (row) { try { stored = JSON.parse(row.data); } catch { stored = null; } }
    const merged = DDRList.merge(stored, mine), text = JSON.stringify(merged);
    if (pull && !row) return json(env, { ok: true, list: merged, rev: 0, account: s.id });
    if (row && text === row.data) return json(env, { ok: true, list: merged, rev: row.rev, account: s.id });   // nothing new: no write
    if (text.length > LIST_MAX) return json(env, { error: 'too big' }, 413);
    // written only while the member still exists, so a sync racing an account deletion cannot leave a list behind
    const r = row
      ? await env.DB.prepare(`UPDATE lists SET data = ?, rev = rev + 1, updated = ? WHERE user_id = ? AND rev = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?) RETURNING rev`).bind(text, now(), s.id, row.rev, s.id).first()
      : await env.DB.prepare(`INSERT INTO lists (user_id, data, rev, updated) SELECT ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) ON CONFLICT(user_id) DO NOTHING RETURNING rev`).bind(s.id, text, now(), s.id).first();
    if (r) return json(env, { ok: true, list: merged, rev: r.rev, account: s.id });
    if (!(await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?`).bind(s.id).first())) return json(env, { error: 'signed out' }, 401);
    // another device wrote in between: read again and merge with that
  }
  return json(env, { error: 'busy' }, 503);
}

export async function handle(req, env) {
  if (!env.DB || !env.SALT || !env.SITE_ORIGIN) return new Response('{"error":"not configured"}', { status: 503, headers: { 'content-type': 'application/json' } });
  const url = new URL(req.url), route = url.pathname.replace(/\/+$/, ''), method = req.method;
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers(env, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }) });
  }

  if (route === '/auth/me' && method === 'GET') {
    const s = await session(env, req);
    if (!s) return json(env, { signed_in: false });
    let extra;
    if (now() - s.renewed >= RENEW_AFTER) {
      const maxAge = SESSION_DAYS * 86400;
      await env.DB.prepare(`UPDATE sessions SET expires = ?, renewed = ? WHERE hash = ?`).bind(now() + maxAge, now(), s.hash).run();
      extra = { 'set-cookie': setCookie(s.token, maxAge) };
    }
    return json(env, { signed_in: true, email: s.email, account: s.id }, 200, extra);
  }

  if (method !== 'POST') return json(env, { error: 'not found' }, 404);
  // every change comes from our own pages, as JSON: this blocks forms posted from other sites
  if (req.headers.get('origin') !== env.SITE_ORIGIN) return json(env, { error: 'origin' }, 403);
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json(env, { error: 'type' }, 415);
  const max = route === '/list/sync' ? LIST_MAX + 64 : BODY_MAX;
  if (Number(req.headers.get('content-length') || 0) > max) return json(env, { error: 'too big' }, 413);
  const raw = await req.text();
  if (raw.length > max) return json(env, { error: 'too big' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json(env, { error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object') return json(env, { error: 'bad json' }, 400);

  if (route === '/auth/start') return start(env, req, body);
  if (route === '/auth/verify') return verify(env, req, body);

  if (route === '/list/sync') {
    const s = await session(env, req);
    if (!s) return json(env, { error: 'signed out' }, 401);
    return syncList(env, s, body);
  }
  if (route === '/auth/signout') {
    const s = await session(env, req);
    if (s) await env.DB.prepare(`DELETE FROM sessions WHERE hash = ?`).bind(s.hash).run();
    return json(env, { ok: true }, 200, { 'set-cookie': setCookie('', 0) });
  }
  if (route === '/auth/delete') {
    const s = await session(env, req);
    if (!s) return json(env, { error: 'signed out' }, 401);
    if (body.confirm !== true) return json(env, { error: 'confirm' }, 400);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM lists WHERE user_id = ?`).bind(s.id),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(s.id),
      env.DB.prepare(`DELETE FROM signin WHERE email = ?`).bind(s.email),
      env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(s.id),
    ]);
    return json(env, { ok: true }, 200, { 'set-cookie': setCookie('', 0) });
  }
  return json(env, { error: 'not found' }, 404);
}


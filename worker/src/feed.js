// Planner Plus day 17 (RUNBOOK §6t): the member's live calendar feed.
//
// A member makes one secret calendar address on /account/ and adds it to their own calendar (Apple, Google, Outlook)
// once. Each time the calendar app looks, this builds the calendar afresh from the list and plans kept on the account,
// with the browser's own planner (static/planner.js → DDRPlan.calendar(), the very function My year's "Add to my
// calendar" uses), so the feed and the file can never differ. Ticks, moves and new plans made on any device show up
// the next time the calendar app looks.
//
// The address: https://api.dontdieretired.com/feed/<43 random characters>.ics. Calendar apps cannot sign in, so the
// address itself is the key, like any calendar subscription. Nothing personal is in it: 32 random bytes, of which we
// keep only a SHA-256 hash (the address is shown once; "Make a new address" replaces it and the old one stops at once).
// No affiliate ids are ever put in it (ics() writes plain links).
//
// Plus only, once the paywall is on: a lapsed account's feed is not deleted, but serves one entry saying it has
// stopped updating, and starts again by itself if the member rejoins. Until the paywall is on, every account may
// have a feed, as every account may sync (day 15).
//
// Work: the planner data (dist/planner/activities.json, about 650 KB) is fetched from the site and parsed only when
// the calendar must be rebuilt; the last calendar is kept with its key (list rev | data hash | day), so most fetches
// cost one hash and one read.
import DDRList from '../../static/list-store.js';
import DDRPlan from '../../static/planner.js';
import * as Plus from './plus.js';

export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const REFRESH = 'PT6H';             // asked of calendar apps; each app decides how often it really looks
export const LIMIT_FEED_HOUR = 60;         // fetches of one feed an hour (apps look every few minutes at most)
const LIMIT_MISS_HOUR = 30;                // unknown addresses tried from one network an hour
const LIMIT_MAKE_HOUR = 10;                // new addresses made by one account an hour
export const CACHE_MAX = 1500000;          // bytes: a bigger calendar is built each time rather than kept (the plan cap keeps them well under)
export const FEED_PLANS = 120;             // plans in one feed at most, the soonest first (review, day 17: building costs CPU,
export const FEED_MONTHS = 24;             // growing faster than the list), and none more than this far ahead
const FEED_CODE = 'f1';                    // raise when this file or the planner changes what a feed says, so kept calendars are rebuilt
const DATA_MS = 10 * 60 * 1000;            // the planner data is fetched again after this long (per Worker instance)
export const STOPPED = {
  summary: "Your Don't Die Retired calendar has stopped updating",
  text: 'Planner Plus has ended on this account, so this calendar no longer shows your plans. They are still kept with your account: '
    + 'sign in at https://dontdieretired.com/account/ to see them, or to join again. If you join again, this calendar starts updating by itself. '
    + 'To keep your plans in your calendar without Planner Plus, use "Add to my calendar" on My year, which saves them as a file.',
};
const now = () => Math.floor(Date.now() / 1000);

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s);
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// "today" for the plan is the day in the UK (most members); a US evening may still see the next UK day
export function ukToday(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
// may this account have a feed that updates? the same rule as keeping the list on the account (accounts.js syncList)
export async function feedOk(env, userId) {
  const gated = env.PLUS_PAYWALL === '1' && Plus.payReady(env);
  return !gated || (await Plus.membership(env, userId)).member;
}

// ---- the planner data, as the site publishes it ----
let DATA = null;   // { at, origin, text, version, parsed: { S, byId } | null, training: {} }
export const forgetData = () => { DATA = null; };
async function plannerData(env) {
  const t = Date.now();
  if (DATA && DATA.origin === env.SITE_ORIGIN && t - DATA.at < DATA_MS) return DATA;
  const r = await fetch(env.SITE_ORIGIN + '/planner/activities.json', { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error('planner data ' + r.status);
  const text = await r.text();
  const version = (await sha256(text)).slice(0, 16);
  if (DATA && DATA.origin === env.SITE_ORIGIN && DATA.version === version) { DATA.at = t; return DATA; }
  DATA = { at: t, origin: env.SITE_ORIGIN, text, version, parsed: null, training: {} };
  return DATA;
}
function parsed(D) {
  if (!D.parsed) {
    const S = JSON.parse(D.text), byId = {};
    if (!S || !Array.isArray(S.activities) || !S.notes || !S.steps) throw new Error('planner data');
    (S.activities || []).forEach(a => { byId[a.id] = a; });
    D.parsed = { S, byId }; D.text = null;   // keep one copy, not two
  }
  return D.parsed;
}
// the engine's training for the events in this list (as My year loads them)
async function training(env, D, items, byId) {
  const evs = [...new Set(items.filter(it => it.cid && it.plan_made && byId[it.cid] && byId[it.cid].event).map(it => byId[it.cid].event.id))];
  const out = {}; let complete = true;
  await Promise.all(evs.map(async ev => {
    if (!D.training[ev]) {   // a failed fetch is never remembered: the next request tries again
      try {
        const r = await fetch(env.SITE_ORIGIN + '/planner/training/' + encodeURIComponent(ev) + '.json', { cf: { cacheTtl: 600, cacheEverything: true } });
        if (r.ok) D.training[ev] = await r.json();
      } catch { /* left out of this calendar, which is then not kept */ }
    }
    if (D.training[ev]) out[ev] = D.training[ev]; else complete = false;
  }));
  return { training: out, complete };
}
// the plans a feed covers: undone things with a day or month up to FEED_MONTHS ahead, the soonest FEED_PLANS of them
export function feedItems(items, today) {
  const end = new Date(Date.parse(today + 'T00:00:00Z')); end.setUTCMonth(end.getUTCMonth() + FEED_MONTHS);
  const last = end.toISOString().slice(0, 10), key = it => it.date || (it.month + '-01');
  return items.filter(it => (it.date || it.month) && it.status !== 'done' && key(it) <= last)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, FEED_PLANS);
}

function fold(line) {   // at most 75 octets a line (RFC 5545), never splitting a character, as planner.js does
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) { const b = new TextEncoder().encode(ch).length; if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
  out.push(cur); return out.join('\r\n');
}
const icsText = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
export function stoppedCalendar(today, site = 'https://dontdieretired.com') {
  const d = today.replace(/-/g, ''), next = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Don't Die Retired//My year//EN", 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText("My year · Don't Die Retired"), 'REFRESH-INTERVAL;VALUE=DURATION:' + REFRESH, 'X-PUBLISHED-TTL:' + REFRESH,
    'BEGIN:VEVENT', 'UID:ddr-feed-stopped@dontdieretired.com', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next,
    'SUMMARY:' + icsText(STOPPED.summary), 'DESCRIPTION:' + icsText(STOPPED.text), 'URL:' + site + '/account/', 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR'];
  return L.map(fold).join('\r\n') + '\r\n';
}

function calHeaders(extra = {}) {
  return {
    'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="my-year.ics"',
    'cache-control': 'no-cache',   // a stopped or replaced address must stop at once, not after a client's cache runs out
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; sandbox", 'x-robots-tag': 'noindex, nofollow', ...extra,
  };
}
const plain = (status, text, extra = {}) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', ...extra } });

// GET (or HEAD) /feed/<token>.ics: from a calendar app, no cookie, no origin
export async function serve(env, req, tok, h) {
  const head = req.method === 'HEAD';
  if (!FEED_TOKEN.test(tok)) return plain(404, 'Not found');
  const hash = await sha256(tok);
  const f = await env.DB.prepare(`SELECT f.hash, f.user_id, f.read_day, f.cache_key, f.cache FROM feeds f JOIN users u ON u.id = f.user_id WHERE f.hash = ?`).bind(hash).first();
  if (!f) {
    if (await h.over(env, 'feedmiss', h.netKey(req.headers.get('cf-connecting-ip')), LIMIT_MISS_HOUR)) return plain(429, 'Too many requests', { 'retry-after': '3600' });
    return plain(404, 'Not found');
  }
  if (await h.over(env, 'feed', f.user_id, LIMIT_FEED_HOUR)) return plain(429, 'Too many requests', { 'retry-after': '3600' });
  const today = ukToday();
  const send = async (text, key) => {
    // remember the day it was read (shown on the account page) and the calendar made, in one write, only when either changed
    if (key === null) {   // not to be kept (some training could not be fetched): the last good calendar stays
      if (f.read_day !== today) await env.DB.prepare(`UPDATE feeds SET read_day = ? WHERE hash = ?`).bind(today, hash).run();
    } else if (f.read_day !== today || f.cache_key !== key) {
      const keep = new TextEncoder().encode(text).length <= CACHE_MAX;
      await env.DB.prepare(`UPDATE feeds SET read_day = ?, cache_key = ?, cache = ? WHERE hash = ?`).bind(today, keep ? key : null, keep ? text : null, hash).run();
    }
    return new Response(head ? null : text, { status: 200, headers: calHeaders() });
  };
  if (!(await feedOk(env, f.user_id))) {
    const key = 'stopped|' + today;
    return send(f.cache_key === key && f.cache ? f.cache : stoppedCalendar(today, env.SITE_ORIGIN), key);
  }
  const row = await env.DB.prepare(`SELECT data, rev FROM lists WHERE user_id = ?`).bind(f.user_id).first();
  let D;
  const fallback = () => {
    // the site could not be reached, or sent something unreadable: the last calendar made is better than none;
    // otherwise the calendar app keeps what it has and tries later
    if (f.cache) return new Response(head ? null : f.cache, { status: 200, headers: calHeaders() });
    return plain(503, 'Try again later', { 'retry-after': '1800' });
  };
  try { D = await plannerData(env); } catch { return fallback(); }
  const key = `${FEED_CODE}.${DDRPlan.VERSION}|${row ? row.rev : 0}|${D.version}|${today}`;
  if (f.cache_key === key && f.cache) return send(f.cache, key);
  let stored = null;
  if (row) { try { stored = JSON.parse(row.data); } catch { stored = null; } }
  const items = feedItems(DDRList.live(DDRList.merge(stored, null)), today);
  let P;
  try { P = parsed(D); } catch { forgetData(); return fallback(); }
  const { S, byId } = P;
  const tr = await training(env, D, items, byId);
  const cal = DDRPlan.calendar(items, Object.assign({}, S, { training: tr.training }), byId, { today, site: env.SITE_ORIGIN, name: "My year · Don't Die Retired", refresh: REFRESH });
  return send(cal.text, tr.complete ? key : null);   // a calendar missing some training is sent but not kept
}

// POST /feed/make: a new secret address (any old one stops working); shown once
export async function make(env, req, s, h) {
  if (!(await feedOk(env, s.id))) return h.json(env, { error: 'plus' }, 403);
  if (await h.over(env, 'feedmake', s.id, LIMIT_MAKE_HOUR)) return h.json(env, { error: 'slow down' }, 429);
  const tok = h.randomToken(), t = now();
  const r = await env.DB.prepare(`INSERT INTO feeds (hash, user_id, created) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
      ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash, created = excluded.created, read_day = NULL, cache_key = NULL, cache = NULL RETURNING created`)
    .bind(await sha256(tok), s.id, t, s.id).first();
  if (!r) return h.json(env, { error: 'signed out' }, 401);
  return h.json(env, { ok: true, url: new URL(req.url).origin + '/feed/' + tok + '.ics', made: t });
}
// POST /feed/stop: the address stops working
export async function stop(env, s, h) {
  await env.DB.prepare(`DELETE FROM feeds WHERE user_id = ?`).bind(s.id).run();
  return h.json(env, { ok: true });
}
// for /auth/me: whether there is an address, when it was made and last read; never the address
export async function state(env, userId) {
  const f = await env.DB.prepare(`SELECT created, read_day FROM feeds WHERE user_id = ?`).bind(userId).first();
  return { ok: await feedOk(env, userId), on: !!f, made: f ? f.created : null, read: f ? f.read_day : null };
}

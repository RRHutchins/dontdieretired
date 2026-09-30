// "Your say" API: votes, interests and suggestions.
// Runs as a Cloudflare Pages Function when the site is hosted on Cloudflare Pages.
// Bindings (Pages → Settings → Functions): D1 database bound as DB.
// Secrets (Pages → Settings → Environment variables): SALT (any long random string), ADMIN_TOKEN (for Claude's monthly export).
//
// Privacy: we never store IP addresses or cookies. Each browser makes a random id kept in its own storage;
// we store only a salted hash of it (so one vote per browser), plus a salted, day-scoped hash of the IP
// used solely to stop floods. Suggestions store the text and an email only if the reader chose to give one.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS votes (proposal TEXT NOT NULL, voter TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (proposal, voter))`,
  `CREATE TABLE IF NOT EXISTS interests (interest TEXT NOT NULL, voter TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (interest, voter))`,
  `CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, email TEXT, kind TEXT, voter TEXT, ts INTEGER NOT NULL, status TEXT DEFAULT 'new')`,
  `CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, n INTEGER NOT NULL)`,
];
const ID = /^[a-z0-9-]{2,40}$/;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const now = () => Math.floor(Date.now() / 1000);

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function ready(env) { await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q))); }

// max actions per IP per day (votes + interests + suggestions)
async function throttled(env, req, limit = 60) {
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const key = await sha(`${env.SALT}|ip|${ip}|${new Date().toISOString().slice(0, 10)}`);
  await env.DB.prepare(`INSERT INTO throttle (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1`).bind(key).run();
  const r = await env.DB.prepare(`SELECT n FROM throttle WHERE key = ?`).bind(key).first();
  return r && r.n > limit;
}

async function counts(env) {
  const v = await env.DB.prepare(`SELECT proposal, COUNT(*) n FROM votes GROUP BY proposal`).all();
  const i = await env.DB.prepare(`SELECT interest, COUNT(*) n FROM interests GROUP BY interest`).all();
  return { votes: Object.fromEntries(v.results.map(r => [r.proposal, r.n])), interests: Object.fromEntries(i.results.map(r => [r.interest, r.n])) };
}

export async function onRequest({ request, env, params }) {
  if (!env.DB || !env.SALT) return json({ error: 'not configured' }, 503);
  await ready(env);
  const route = (params.path || []).join('/');
  const method = request.method;

  if (route === 'say' && method === 'GET') return json(await counts(env));

  if (route === 'admin' && method === 'GET') {
    const t = new URL(request.url).searchParams.get('token') || request.headers.get('x-admin-token');
    if (!env.ADMIN_TOKEN || t !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
    const s = await env.DB.prepare(`SELECT id, text, email, kind, ts, status FROM suggestions ORDER BY ts DESC LIMIT 500`).all();
    return json({ ...(await counts(env)), suggestions: s.results });
  }

  if (method !== 'POST') return json({ error: 'not found' }, 404);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body.cid !== 'string' || body.cid.length < 16 || body.cid.length > 64) return json({ error: 'bad id' }, 400);
  if (body.website) return json({ ok: true }); // honeypot: bots fill every field
  if (await throttled(env, request)) return json({ error: 'slow down' }, 429);
  const voter = await sha(`${env.SALT}|cid|${body.cid}`);

  if (route === 'vote') {
    if (!ID.test(body.id || '')) return json({ error: 'bad proposal' }, 400);
    if (body.on === false) await env.DB.prepare(`DELETE FROM votes WHERE proposal = ? AND voter = ?`).bind(body.id, voter).run();
    else await env.DB.prepare(`INSERT OR IGNORE INTO votes (proposal, voter, ts) VALUES (?, ?, ?)`).bind(body.id, voter, now()).run();
    return json({ ok: true, ...(await counts(env)) });
  }

  if (route === 'interests') {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)].filter(x => ID.test(x)).slice(0, 20) : null;
    if (!ids) return json({ error: 'bad interests' }, 400);
    const st = [env.DB.prepare(`DELETE FROM interests WHERE voter = ?`).bind(voter)];
    for (const i of ids) st.push(env.DB.prepare(`INSERT INTO interests (interest, voter, ts) VALUES (?, ?, ?)`).bind(i, voter, now()));
    await env.DB.batch(st);
    return json({ ok: true });
  }

  if (route === 'suggest') {
    const text = String(body.text || '').trim().slice(0, 800);
    const email = String(body.email || '').trim().slice(0, 200);
    const kind = ['content', 'product', 'site', 'other'].includes(body.kind) ? body.kind : 'other';
    if (text.length < 5) return json({ error: 'too short' }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad email' }, 400);
    await env.DB.prepare(`INSERT INTO suggestions (text, email, kind, voter, ts) VALUES (?, ?, ?, ?, ?)`).bind(text, email || null, kind, voter, now()).run();
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

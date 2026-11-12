/* Fifty at Fifty: the ONE place the reader's list is read and written (RUNBOOK §6h).
   Page code must go through DDRList and never touch localStorage for the list itself.
   This is what makes a later move to accounts seamless: sync only has to replace load/save
   and call merge(), which is a pure function with tests (tools/test_list_merge.js).

   Stored shape, version 1:
   { version: 1, title, target, settings_updated_at,
     items: [ { id, cid, title, status, date, until, month, plan_made, level, ticks, moves, where, with, note, pos, added_at, updated_at, deleted } ] }
   - id: for a catalogue challenge it IS the challenge id (so two devices adding the same challenge
     merge into one); for a reader's own challenge it is "x-" + random.
   - cid: the catalogue id, or null for the reader's own. title is kept only for the reader's own.
   - status: want | planned | doing | done.   - deleted: true instead of removing, so merges are safe.
   - updated_at: ISO time of the last change to that item. Newest wins in a merge.
   - My year (RUNBOOK §6s, added 3 Nov 2026; additive, so still version 1): a planned item has EITHER a `date`
     (YYYY-MM-DD, the day itself) OR a `month` (YYYY-MM, "some time in"), never both, and `plan_made` (YYYY-MM-DD),
     the day the plan was made. The plan's steps are not stored: static/planner.js rebuilds them from these fields
     with today = plan_made, so a saved plan does not shift as the days pass.
   - My year page (added 4 Nov 2026; additive, still version 1): `ticks` { stepId: { done, at } } and `moves`
     { stepId: { date, at } } (date '' = back to the plan's own date) belong to the plan they were made on. They are
     cleared when the plan's date, month or plan_made changes, and merge() unions them key by key (newest `at` wins)
     when both copies are the same plan, so ticking different steps on two devices loses neither.
   - Dated training (added 6 Nov 2026; additive, still version 1): `level` ('starter' | 'active' | 'advanced', or ''
     for none chosen, which the planner reads as the engine's default, active) is the starting point the engine's
     training sessions were worked out for. It is part of the plan: changing it is a new plan, so ticks and moves are
     cleared. A plan with training has a step per session (up to about a hundred), so up to MAX_STEPS marks are kept.
   - Where (Planner Plus day 8, 8 Nov 2026; additive, still version 1): `where` is the town, venue or postcode the reader
     typed for an activity with no place of its own (up to 120 characters, control characters and < > removed). It belongs
     to the item, not to one plan, so changing the date keeps it; removing the plan clears it. Newest wins in a merge,
     like the rest of the item.
   - More than one day (Robin, 7 Nov 2026; additive, still version 1): `until` (YYYY-MM-DD) is the last day of a stay that
     starts on `date`: after it, and no more than MAX_SPAN (30) days later; never with a month. It is not part of the
     plan's identity (the get-ready steps hang off the first day), so it does not clear ticks in a merge.
   - While you're there (Planner Plus day 10, 8 Nov 2026; additive, still version 1): `with` is the catalogue id of the
     trip a plan was added to from that trip's "While you're there" (only with a date or month; never the item itself).
     It belongs to the plan: a new plan without it, or removing the plan, clears it. Not part of the plan's identity.
     static/planner.js combine() only honours it while the date still falls inside that trip. Newest wins in a merge.
   - Accounts (Planner Plus day 13, 9 Nov 2026): no change to the data. A signed-in device sends this same shape to the
     accounts Worker, which merges it with the account's copy using this file's merge() (worker/src/accounts.js imports
     it), so the browser and the account can never disagree about how two lists combine. See "account sync" below. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DDRList = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'ddr_list', VERSION = 1;
  // FIELDS counts the additive changes made inside version 1 (My year, ticks and moves, training level, where, until,
  // with). Raise it whenever a field is added: an accounts Worker older than the page refuses to merge (409) rather
  // than drop a field it does not know (day 13 review).
  const FIELDS = 6;
  const STATUSES = ['want', 'planned', 'doing', 'done'];
  const now = () => new Date().toISOString();
  const empty = () => ({ version: VERSION, title: 'My list', target: 50, settings_updated_at: '', items: [] });
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
  const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const CID = /^[a-z0-9-]{1,80}$/;
  const STEP = /^[a-z0-9-]{1,40}$/, MAX_STEPS = 300, LEVELS = ['starter', 'active', 'advanced'];
  // per-step marks on a saved plan: { stepId: { done: bool, at } } or { stepId: { date: 'YYYY-MM-DD' | '', at } }
  function cleanMarks(m, field) {
    const out = {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
    Object.keys(m).slice(0, MAX_STEPS).forEach(k => {
      const v = m[k];
      if (!STEP.test(k) || !v || typeof v !== 'object') return;
      if (field === 'done') out[k] = { done: !!v.done, at: str(v.at, 30) };
      else if (v.date === '' || DAY.test(v.date || '')) out[k] = { date: v.date, at: str(v.at, 30) };
    });
    return out;
  }
  const cleanPlace = t => (typeof t === 'string' ? t : '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const MAX_SPAN = 30;
  const spanOk = (date, until) => { if (!DAY.test(date || '') || !DAY.test(until || '')) return false; const n = Math.round((Date.parse(until + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000); return n >= 1 && n <= MAX_SPAN; };
  const planKey = it => (it.date || '') + '|' + (it.month || '') + '|' + (it.plan_made || '') + '|' + (it.level || '');

  // Make anything (old data, a backup file, a hand-edited file) into a well-formed list. Never throws.
  function clean(d) {
    const out = empty();
    if (!d || typeof d !== 'object') return out;
    if (typeof d.title === 'string' && d.title.trim()) out.title = d.title.trim().slice(0, 60);
    const t = parseInt(d.target, 10); if (t >= 1 && t <= 500) out.target = t;
    out.settings_updated_at = str(d.settings_updated_at, 30);
    const seen = new Set();
    (Array.isArray(d.items) ? d.items : []).forEach((it, i) => {
      if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || seen.has(it.id)) return;
      seen.add(it.id);
      out.items.push({
        id: it.id.slice(0, 80), cid: typeof it.cid === 'string' ? it.cid.slice(0, 80) : null,
        title: str(it.title, 120), status: STATUSES.includes(it.status) ? it.status : 'want',
        date: DAY.test(it.date || '') ? it.date : '', month: '', plan_made: DAY.test(it.plan_made || '') ? it.plan_made : '', level: '', note: str(it.note, 500),
        pos: typeof it.pos === 'number' && isFinite(it.pos) ? it.pos : i,
        added_at: str(it.added_at, 30) || str(it.updated_at, 30), updated_at: str(it.updated_at, 30), deleted: !!it.deleted,
      });
      const o = out.items[out.items.length - 1];
      if (!o.date && MONTH.test(it.month || '')) o.month = it.month;   // a date wins over a month: never both
      if (o.plan_made && LEVELS.includes(it.level)) o.level = it.level;
      o.ticks = o.plan_made ? cleanMarks(it.ticks, 'done') : {};
      o.moves = o.plan_made ? cleanMarks(it.moves, 'date') : {};
      o.where = cleanPlace(it.where);
      o.until = o.date && spanOk(o.date, it.until) ? it.until : '';
      o.with = (o.date || o.month) && o.plan_made && typeof it.with === 'string' && CID.test(it.with) && it.with !== o.id ? it.with : '';
      // a removed item keeps only what a merge needs (so the removal reaches other devices); its plan, notes and
      // place go, so removed things never pile up in an account (Planner Plus day 13 review)
      if (o.deleted) Object.assign(o, { title: '', status: 'want', date: '', until: '', month: '', plan_made: '', level: '', note: '', ticks: {}, moves: {}, where: '', with: '' });
    });
    return out;
  }

  // PURE. Union of both lists. Where the same item is in both, the one changed most recently wins.
  // Nothing is dropped: an item in only one list is always kept (including deleted markers, so a
  // deletion on one device is not undone by an older copy on another).
  function merge(a, b) {
    a = clean(a); b = clean(b);
    const out = empty(), by = new Map();
    const newer = (x, y) => (x.updated_at || '') > (y.updated_at || '');
    a.items.forEach(it => by.set(it.id, it));
    b.items.forEach(it => {
      const cur = by.get(it.id);
      if (!cur) by.set(it.id, it);
      else if (newer(it, cur)) by.set(it.id, it);
      else if (!newer(cur, it) && cur.deleted && !it.deleted) by.set(it.id, it);   // exact tie: keep the live one
      // the same saved plan on both sides: keep every tick and move, newest per step
      const win = by.get(it.id), lose = win === it ? cur : it;
      if (lose && win.plan_made && planKey(win) === planKey(lose)) {
        const union = (x, y) => { const o = { ...x }; Object.keys(y).forEach(k => { if (!o[k] || (y[k].at || '') > (o[k].at || '')) o[k] = y[k]; }); return o; };
        by.set(it.id, { ...win, ticks: union(win.ticks, lose.ticks), moves: union(win.moves, lose.moves) });
      }
    });
    out.items = [...by.values()].map(it => ({ ...it })).sort((x, y) => x.pos - y.pos || (x.added_at < y.added_at ? -1 : x.added_at > y.added_at ? 1 : 0) || (x.id < y.id ? -1 : 1));
    out.items.forEach((it, i) => { it.pos = i; });
    const s = (b.settings_updated_at || '') > (a.settings_updated_at || '') ? b : a;
    out.title = s.title; out.target = s.target; out.settings_updated_at = s.settings_updated_at;
    return out;
  }

  /* ---- device storage (the only code that touches localStorage for the list) ---- */
  function load() { try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return empty(); } }
  function save(d, quiet) {
    try { localStorage.setItem(KEY, JSON.stringify(clean(d))); } catch (e) { return false; }
    if (!quiet) changed();   // a change the reader made on this device: send it to their account, if signed in
    return true;
  }

  /* ---- helpers used by the pages; each returns the saved list ---- */
  const live = d => d.items.filter(it => !it.deleted);
  const find = (d, id) => d.items.find(it => it.id === id);
  function add(cid, customTitle) {
    const d = load(), t = now();
    const id = cid || 'x-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const cur = find(d, id), pos = d.items.reduce((m, it) => Math.max(m, it.pos), -1) + 1;
    if (cur) Object.assign(cur, { deleted: false, status: cur.deleted ? 'want' : cur.status, updated_at: t, pos: cur.deleted ? pos : cur.pos });
    else d.items.push({ id, cid: cid || null, title: cid ? '' : str(customTitle, 120), status: 'want', date: '', until: '', month: '', plan_made: '', level: '', ticks: {}, moves: {}, where: '', with: '', note: '', pos, added_at: t, updated_at: t, deleted: false });
    save(d); return d;
  }
  function update(id, changes) {
    const d = load(), it = find(d, id); if (!it) return d;
    const key = planKey(it);
    ['status', 'date', 'note', 'title'].forEach(k => { if (k in changes) it[k] = changes[k]; });
    if (changes.date) it.month = '';   // a day chosen on the list replaces a month
    if (!spanOk(it.date, it.until)) it.until = '';   // a last day must still follow the first
    if (planKey(it) !== key) { it.ticks = {}; it.moves = {}; }   // a new date is a new plan: old ticks and moves do not carry over
    it.updated_at = now(); save(d); return load();
  }
  /* My year: save a plan for a catalogue activity (adding it to the list if needed), or clear it with when = null.
     when = { date: 'YYYY-MM-DD' } or { month: 'YYYY-MM' }, with an optional level for a plan with training and an optional
     `with` (the trip it was added to, Planner Plus day 10); today = the reader's day (YYYY-MM-DD) the plan is made. */
  function plan(cid, when, today) {
    if (!has(cid)) add(cid);
    const d = load(), it = find(d, cid);
    it.ticks = {}; it.moves = {};   // a new or removed plan starts clean
    if (when && (DAY.test(when.date || '') || MONTH.test(when.month || ''))) {
      it.date = when.date && DAY.test(when.date) ? when.date : '';
      it.month = it.date ? '' : when.month;
      it.until = it.date && spanOk(it.date, when.until) ? when.until : '';
      it.plan_made = DAY.test(today || '') ? today : now().slice(0, 10);
      it.level = LEVELS.includes(when.level) ? when.level : '';
      it.with = typeof when.with === 'string' && CID.test(when.with) && when.with !== cid ? when.with : '';
      if (it.status === 'want') it.status = 'planned';
    } else {
      it.date = ''; it.until = ''; it.month = ''; it.plan_made = ''; it.level = ''; it.where = ''; it.with = '';
      if (it.status === 'planned') it.status = 'want';
    }
    it.updated_at = now(); save(d); return load();
  }
  /* My year: tick a step of a saved plan done (or not), or move one of its flexible steps to another day ('' = back to
     where the plan put it). Which steps may move, and to where, is the page's job (static/planner.js combine()). */
  function mark(id, stepId, field, value) {
    const d = load(), it = find(d, id);
    if (!it || it.deleted || !it.plan_made || !STEP.test(stepId || '')) return d;
    const t = now();
    if (field === 'done') it.ticks[stepId] = { done: !!value, at: t };
    else if (value === '' || DAY.test(value || '')) it.moves[stepId] = { date: value, at: t };
    else return d;
    it.updated_at = t; save(d); return load();
  }
  /* Planner Plus: the place the reader typed for an activity ('' clears it) */
  function where(id, text) {
    const d = load(), it = find(d, id); if (!it || it.deleted) return d;
    it.where = cleanPlace(text); it.updated_at = now(); save(d); return load();
  }
  const tick = (id, stepId, done) => mark(id, stepId, 'done', done);
  const shift = (id, stepId, date) => mark(id, stepId, 'date', date);
  const get = id => { const it = find(load(), id); return it && !it.deleted ? it : null; };
  function remove(id) { const d = load(), it = find(d, id); if (it) { it.deleted = true; it.updated_at = now(); save(d); } return d; }
  function move(id, dir) {   // dir -1 up, +1 down, among the items still on the list
    const d = load(), l = live(d).sort((x, y) => x.pos - y.pos), i = l.findIndex(it => it.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return d;
    const t = now(), p = l[i].pos; l[i].pos = l[j].pos; l[j].pos = p; l[i].updated_at = t; l[j].updated_at = t;
    save(d); return load();
  }
  function settings(changes) { const d = load(); Object.assign(d, changes, { settings_updated_at: now() }); save(d); return load(); }
  function restore(incoming) { const d = merge(load(), incoming); save(d); return d; }   // "Restore from backup" = merge, never overwrite
  // small per-device notes about the list (last backup, reminder closed, month counted): not list data, never synced
  const flag = (name, value) => { try { if (value === undefined) return localStorage.getItem(KEY + '_' + name); localStorage.setItem(KEY + '_' + name, value); } catch (e) {} return null; };
  const has = id => { const it = find(load(), id); return !!(it && !it.deleted); };

  /* ---- account sync (Planner Plus day 13, 9 Nov 2026; RUNBOOK §6t) ----
     Only in a browser, only when the site has an accounts address (<meta name="ddr-accounts">) and this device has
     signed in (flag 'acct', set by the account page; it holds no personal data). The device posts its whole list to
     the Worker, which merges it with the account's copy using this same merge() and sends the result back; the device
     merges that into whatever it holds by then. Both sides only ever merge, so nothing is overwritten or dropped and a
     plan made on a phone and a tick made on a laptop both survive. If anything changed here, the page is told with the
     same 'storage' event another tab would send, so the pages' existing redraws apply. Sync is best effort: offline or
     signed out, the list simply stays on the device as before. */
  let api = '', timer = 0, busy = false, again = false, follow = 0, waiting = [];
  const signedIn = () => !!api && flag('acct') === '1';
  function changed() { follow = 0; if (signedIn()) { clearTimeout(timer); timer = setTimeout(sync, 1500); } }
  function absorb(remote) {   // merge the account's copy into this device's; true if the list here changed
    // the account's copy goes first, so where nothing differs but the order the account's order is kept on every device;
    // a change made here while the request was in flight is newer, so it still wins
    const before = JSON.stringify(load()), after = merge(remote, load());
    save(after, true);
    return JSON.stringify(clean(after)) !== before;
  }
  function tell() {
    const a = document.activeElement;   // never redraw under someone typing: wait until they leave the box
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(a.type)))) {
      a.addEventListener('blur', () => setTimeout(tell, 0), { once: true }); return;
    }
    try { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); }
    catch (e) { const ev = document.createEvent('Event'); ev.initEvent('storage', false, false); ev.key = KEY; window.dispatchEvent(ev); }
  }
  async function sync(opts) {
    if (!signedIn()) return { ok: false, reason: 'signed-out' };
    if (busy) { again = true; return new Promise(done => waiting.push(done)); }   // answered by the sync that follows this one
    busy = true; clearTimeout(timer); timer = 0;
    const owner = flag('acct_owner') || '';
    const replace = !!(opts && opts.replace);
    const body = JSON.stringify({ list: replace ? null : load(), fields: FIELDS });
    let res = { ok: false, reason: 'offline' };
    try {
      const keep = !!(opts && opts.keepalive) && new TextEncoder().encode(body).length < 60000;   // browsers cap keepalive bodies at 64 KiB
      const r = await fetch(api + '/list/sync', { method: 'POST', credentials: 'include', keepalive: keep, headers: { 'content-type': 'application/json' }, body });
      if (r.status === 401) { flag('acct', ''); res = { ok: false, reason: 'signed-out' }; }
      else if (r.ok) {
        const d = await r.json();
        if (owner && d.account && owner !== d.account) { flag('acct', ''); busy = false; waiting.splice(0).forEach(f => f({ ok: false, reason: 'other-account' })); return { ok: false, reason: 'other-account' }; }
        // a read-only account (no Planner Plus, day 15) keeps nothing, so the list here may be the other person's only copy:
        // never empty it then; the account page says why
        if (replace && d.readonly) { flag('acct', ''); busy = false; waiting.splice(0).forEach(f => f({ ok: false, reason: 'readonly-keep' })); return { ok: false, reason: 'readonly-keep' }; }
        if (replace) { save(empty(), true); }
        if (d.account) flag('acct_owner', d.account);
        const here = absorb(d.list);
        if (here) tell();
        if (typeof d.plus === 'boolean') flag('plus', d.plus ? '1' : '');   // what the account said last time (static/plus.js uses it only when offline); sent only once the paywall is on
        // this device holds something the account does not yet (a change made while the post was in flight): send it too.
        // Not when the account is read-only (no Planner Plus, day 15): it keeps nothing we send, so there is no point.
        if (!d.readonly && JSON.stringify(load()) !== JSON.stringify(clean(d.list)) && follow < 3) { follow++; again = true; }
        res = { ok: true, changed: here, readonly: !!d.readonly };
      } else {
        res = { ok: false, reason: r.status === 413 ? 'too-big' : r.status === 409 ? 'old-service' : r.status === 429 ? 'slow' : 'status-' + r.status };
        if (r.status === 409 || r.status === 413) flag('acct', '');   // retrying cannot help: stop until the account page is opened again
      }
    } catch (e) { /* offline: try again on the next change or visit */ }
    busy = false;
    const w = waiting; waiting = [];
    if (again) { again = false; setTimeout(() => sync().then(r => w.forEach(f => f(r))), 300); }
    else w.forEach(f => f(res));
    return res;
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const m = document.querySelector('meta[name="ddr-accounts"]');
    api = m ? (m.getAttribute('content') || '').replace(/\/$/, '') : '';
    if (api) {
      const kick = () => { if (signedIn()) { follow = 0; sync(); } };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick); else setTimeout(kick, 0);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); else if (timer) sync({ keepalive: true }); });
      window.addEventListener('online', kick);
    }
  }
  /* The account page says when this device signs in or out. `who` is the account's opaque id from the Worker.
     A browser list that belongs to a different account (a shared computer) is never sent to this one by itself: the
     page asks first (day 13 review), and so is a list that belongs to no account yet (day 20 review). how = 'merge' adds this browser's list to the account; 'replace' shows only the
     account's list here (the other account keeps its own copy on its account). */
  function account(on, who, how) {
    if (!on) { flag('acct', ''); clearTimeout(timer); return Promise.resolve({ ok: true }); }
    const prev = flag('acct_owner') || '';
    const mine = live(load()).length > 0;
    if (who && prev && prev !== who && mine && !how) { flag('acct', ''); return Promise.resolve({ ok: false, reason: 'other-account' }); }
    // Day 20 (review): a browser list that belongs to no account yet is added only once the member says so on the account
    // page, which shows the address signed in. Someone could send a sign-in link for their own account ("open this to see
    // my plan"), and the list here would otherwise go to their account without a word.
    if (who && !prev && mine && !how) { flag('acct', ''); return Promise.resolve({ ok: false, reason: 'first-list' }); }
    if (who && prev !== who) flag('acct_owner', who);
    flag('acct', '1'); follow = 0;
    return sync({ replace: how === 'replace' });
  }
  // "Sign out and remove my list from this browser": the copy on the account is untouched
  function forget() { try { localStorage.removeItem(KEY); } catch (e) {} flag('acct', ''); flag('acct_owner', ''); clearTimeout(timer); }

  return { KEY, VERSION, STATUSES, LEVELS, MAX_SPAN, empty, clean, merge, load, save, live, add, update, remove, move, settings, restore, has, flag, plan, get, tick, shift, where, cleanPlace, sync, account, forget, FIELDS };
});

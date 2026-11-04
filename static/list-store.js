/* Fifty at Fifty: the ONE place the reader's list is read and written (RUNBOOK §6h).
   Page code must go through DDRList and never touch localStorage for the list itself.
   This is what makes a later move to accounts seamless: sync only has to replace load/save
   and call merge(), which is a pure function with tests (tools/test_list_merge.js).

   Stored shape, version 1:
   { version: 1, title, target, settings_updated_at,
     items: [ { id, cid, title, status, date, month, plan_made, note, pos, added_at, updated_at, deleted } ] }
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
     when both copies are the same plan, so ticking different steps on two devices loses neither. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DDRList = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'ddr_list', VERSION = 1;
  const STATUSES = ['want', 'planned', 'doing', 'done'];
  const now = () => new Date().toISOString();
  const empty = () => ({ version: VERSION, title: 'My list', target: 50, settings_updated_at: '', items: [] });
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
  const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const STEP = /^[a-z0-9-]{1,40}$/, MAX_STEPS = 80;
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
  const planKey = it => (it.date || '') + '|' + (it.month || '') + '|' + (it.plan_made || '');

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
        date: DAY.test(it.date || '') ? it.date : '', month: '', plan_made: DAY.test(it.plan_made || '') ? it.plan_made : '', note: str(it.note, 500),
        pos: typeof it.pos === 'number' && isFinite(it.pos) ? it.pos : i,
        added_at: str(it.added_at, 30) || str(it.updated_at, 30), updated_at: str(it.updated_at, 30), deleted: !!it.deleted,
      });
      const o = out.items[out.items.length - 1];
      if (!o.date && MONTH.test(it.month || '')) o.month = it.month;   // a date wins over a month: never both
      o.ticks = o.plan_made ? cleanMarks(it.ticks, 'done') : {};
      o.moves = o.plan_made ? cleanMarks(it.moves, 'date') : {};
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
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(clean(d))); return true; } catch (e) { return false; } }

  /* ---- helpers used by the pages; each returns the saved list ---- */
  const live = d => d.items.filter(it => !it.deleted);
  const find = (d, id) => d.items.find(it => it.id === id);
  function add(cid, customTitle) {
    const d = load(), t = now();
    const id = cid || 'x-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const cur = find(d, id), pos = d.items.reduce((m, it) => Math.max(m, it.pos), -1) + 1;
    if (cur) Object.assign(cur, { deleted: false, status: cur.deleted ? 'want' : cur.status, updated_at: t, pos: cur.deleted ? pos : cur.pos });
    else d.items.push({ id, cid: cid || null, title: cid ? '' : str(customTitle, 120), status: 'want', date: '', month: '', plan_made: '', ticks: {}, moves: {}, note: '', pos, added_at: t, updated_at: t, deleted: false });
    save(d); return d;
  }
  function update(id, changes) {
    const d = load(), it = find(d, id); if (!it) return d;
    const key = planKey(it);
    ['status', 'date', 'note', 'title'].forEach(k => { if (k in changes) it[k] = changes[k]; });
    if (changes.date) it.month = '';   // a day chosen on the list replaces a month
    if (planKey(it) !== key) { it.ticks = {}; it.moves = {}; }   // a new date is a new plan: old ticks and moves do not carry over
    it.updated_at = now(); save(d); return load();
  }
  /* My year: save a plan for a catalogue activity (adding it to the list if needed), or clear it with when = null.
     when = { date: 'YYYY-MM-DD' } or { month: 'YYYY-MM' }; today = the reader's day (YYYY-MM-DD) the plan is made. */
  function plan(cid, when, today) {
    if (!has(cid)) add(cid);
    const d = load(), it = find(d, cid);
    it.ticks = {}; it.moves = {};   // a new or removed plan starts clean
    if (when && (DAY.test(when.date || '') || MONTH.test(when.month || ''))) {
      it.date = when.date && DAY.test(when.date) ? when.date : '';
      it.month = it.date ? '' : when.month;
      it.plan_made = DAY.test(today || '') ? today : now().slice(0, 10);
      if (it.status === 'want') it.status = 'planned';
    } else {
      it.date = ''; it.month = ''; it.plan_made = '';
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

  return { KEY, VERSION, STATUSES, empty, clean, merge, load, save, live, add, update, remove, move, settings, restore, has, flag, plan, get, tick, shift };
});

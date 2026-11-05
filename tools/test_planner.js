// Tests for the plan generator (static/planner.js, RUNBOOK §6s). Run: node tools/test_planner.js
// Uses the real settings and every real activity (from `python3 tools/planner.py --json`), so a new activity or a change
// to content/planner.yaml is tested too.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const P = require('../static/planner.js');
const data = JSON.parse(execFileSync('python3', [path.join(__dirname, 'planner.py'), '--json'], { maxBuffer: 64 << 20 }).toString());
const acts = data.activities, byId = Object.fromEntries(acts.map(a => [a.id, a]));
const TODAY = '2026-11-02';
const plus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fills = t => new RegExp('^' + String(t).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '.+') + '$');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// Every word a plan shows must come from the activity, dates.yaml, the engine or planner.yaml.
function checkSourced(a, plan) {
  const S = data.steps;
  const texts = new Set(a.start);
  const okText = s => texts.has(s.text) || Object.values(S).some(v => v.text && fills(v.text).test(s.text));
  const okWhy = s => Object.values(S).some(v => fills(v.why).test(s.why));
  const urls = new Set([...a.links, ...a.book].map(l => l.url).concat(a.dates ? [a.dates.source.url] : []));
  const kit = new Set(a.kit.map(k => k.url));
  for (const s of plan.steps) {
    assert.ok(okText(s), `${a.id}: step text not from the activity or settings: ${s.text}`);
    assert.ok(s.why && okWhy(s), `${a.id}: step reason not from settings: ${s.why}`);
    (s.links || []).forEach(l => assert.ok(urls.has(l.url), `${a.id}: link not from the activity: ${l.url}`));
    (s.items || []).forEach(k => assert.ok(kit.has(k.url), `${a.id}: kit not from the activity: ${k.url}`));
    if (s.detail) {
      const pieces = [a.safety, a.dates && a.dates.note, a.event && a.event.prerequisite, ...a.start].filter(Boolean);
      let rest = s.detail; pieces.forEach(p => { rest = rest.split(p).join(''); });
      assert.strictEqual(rest.trim(), '', `${a.id}: step detail not from the activity: ${s.detail}`);
    }
  }
}

t('monthsText reads runs, wraps the year end and joins with "and"', () => {
  assert.strictEqual(P.monthsText([5, 6, 7, 8, 9]), 'May to September');
  assert.strictEqual(P.monthsText([12, 1, 2]), 'December to February');
  assert.strictEqual(P.monthsText([6, 12]), 'June and December');
  assert.strictEqual(P.monthsText([3, 4, 5, 9, 10, 11]), 'March to May and September to November');
  assert.strictEqual(P.monthsText([8]), 'August');
  assert.strictEqual(P.monthsText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'all year');
});

t('a bad date is refused, not guessed', () => {
  const a = acts[0];
  assert.throws(() => P.build(a, data, { date: '2027-02-29', today: TODAY }));
  assert.throws(() => P.build(a, data, { date: 'next summer', today: TODAY }));
  assert.throws(() => P.build(a, data, { today: TODAY }));
});

t('a date that has gone gives no steps; the current month still counts', () => {
  const a = byId['take-up-beekeeping'];
  const p = P.build(a, data, { date: '2026-11-01', today: TODAY });
  assert.strictEqual(p.status, 'past'); assert.strictEqual(p.steps.length, 0);
  assert.strictEqual(P.build(a, data, { month: '2026-11', today: TODAY }).status, 'ok');
});

const dates = [plus(TODAY, 0), plus(TODAY, 3), plus(TODAY, 20), plus(TODAY, 60), plus(TODAY, 200), '2027-08', '2027-01'];
t('every activity, at every kind of date: well formed, in order, never before today, every safety line kept, all words sourced', () => {
  for (const a of acts) for (const d of dates) {
    const p = P.build(a, data, /^\d{4}-\d{2}$/.test(d) ? { month: d, today: TODAY } : { date: d, today: TODAY });
    if (p.status === 'too_soon') { assert.ok(a.event, `${a.id}: too_soon without an engine event`); assert.strictEqual(p.steps.length, 0); continue; }
    assert.strictEqual(p.status, 'ok', `${a.id} ${d}: ${p.status}`);
    const ds = p.steps.map(s => s.date);
    assert.deepStrictEqual(ds, [...ds].sort(), `${a.id} ${d}: steps out of order`);
    assert.ok(ds.every(x => x >= TODAY), `${a.id} ${d}: a step before today`);
    assert.strictEqual(new Set(p.steps.map(s => s.id)).size, p.steps.length, `${a.id}: step ids not unique`);
    const day = p.steps.filter(s => s.strand === 'day');
    assert.strictEqual(day.length, 1); assert.strictEqual(day[0].date, p.date);
    assert.ok(p.steps.filter(s => s.strand !== 'after').every(s => s.date <= p.date || s.id.startsWith('start-') || s.id === 'kit'), `${a.id}: a get-ready step after the day`);
    if (a.safety) { assert.strictEqual(p.safety, a.safety); assert.ok(p.steps.some(s => s.strand === 'safety' && s.detail === a.safety), `${a.id}: safety step missing`); }
    // each of the activity's start steps appears once (as a step, or with the day, or with the engine's training step)
    const all = p.steps.map(s => s.text + ' ' + (s.detail || '')).join('\n');
    a.start.forEach(st => assert.ok(all.includes(st), `${a.id}: start step dropped: ${st}`));
    if (a.kit.length) assert.strictEqual(p.steps.find(s => s.id === 'kit').items.length, a.kit.length);
    checkSourced(a, p);
  }
});

t('training comes only from the engine, never shorter than its minimum', () => {
  for (const a of acts) {
    const p = P.build(a, data, { date: plus(TODAY, 400), today: TODAY });
    const tr = p.steps.filter(s => s.strand === 'train');
    if (!a.event) { assert.strictEqual(tr.length, 0, `${a.id}: training without an engine event`); continue; }
    assert.strictEqual(tr.length, 1); assert.strictEqual(tr[0].weeks, a.event.weeks);
    assert.strictEqual(tr[0].date, plus(p.date, -7 * a.event.weeks));
    // one day short of the minimum: no plan, and the earliest date offered does work
    const short = P.build(a, data, { date: plus(TODAY, 7 * a.event.min_weeks - 1), today: TODAY });
    assert.strictEqual(short.status, 'too_soon'); assert.strictEqual(short.earliest, plus(TODAY, 7 * a.event.min_weeks));
    const ok = P.build(a, data, { date: short.earliest, today: TODAY });
    assert.strictEqual(ok.status, 'ok'); assert.strictEqual(ok.steps.find(s => s.strand === 'train').weeks, a.event.min_weeks);
    if (a.event.min_weeks < a.event.weeks) assert.ok(ok.notes.some(x => x.includes('usually takes')));
  }
});

t('a short run-up squeezes the steps and says so; a full one does not', () => {
  const a = byId['take-up-beekeeping'];
  const near = P.build(a, data, { date: plus(TODAY, 14), today: TODAY });
  assert.ok(near.notes.some(x => x.includes('closer together'))); assert.strictEqual(near.steps[0].date, TODAY);
  const far = P.build(a, data, { date: plus(TODAY, 7 * a.lead_weeks + 1), today: TODAY });
  assert.ok(!far.notes.some(x => x.includes('closer together')));
});

t('a date outside the best months is flagged with the season it came from', () => {
  const a = acts.find(x => x.when.length && !x.when.includes(1) && !x.event);
  const p = P.build(a, data, { month: '2027-01', today: TODAY });
  assert.ok(p.notes.some(x => x.includes('outside the best months') && x.includes(P.monthsText(a.when))), a.id);
  const ok = P.build(a, data, { month: '2027-' + String(a.when[0]).padStart(2, '0'), today: TODAY });
  assert.ok(!ok.notes.some(x => x.includes('outside the best months')));
});

t('a fixed yearly date adds a "check this year\'s dates" step with its source', () => {
  for (const a of acts.filter(x => x.dates)) {
    const p = P.build(a, data, { month: '2027-' + String(a.dates.months[0]).padStart(2, '0'), today: TODAY });
    const s = p.steps.find(x => x.id === 'dates');
    assert.ok(s); assert.strictEqual(s.links[0].url, a.dates.source.url);
  }
});

t('the suggested date gives a full, unsqueezed plan in the best months', () => {
  for (const a of acts) {
    const s = P.suggest(a, { today: TODAY }), p = P.build(a, data, Object.assign({ today: TODAY }, s));
    assert.strictEqual(p.status, 'ok', a.id);
    assert.ok(!p.notes.some(x => x.includes('closer together') || x.includes('outside the best months') || x.includes('usually takes')), `${a.id}: ${p.notes}`);
  }
});

t('affiliate links are marked so the page can show the disclosure', () => {
  const a = acts.find(x => x.book.some(b => b.aff) && x.kit.length);
  const p = P.build(a, data, P.suggest(a, { today: TODAY }));
  assert.ok(p.steps.find(s => s.id === 'book').links.every(l => l.aff));
  assert.ok(p.steps.find(s => s.id === 'kit').items.every(k => k.aff === 'amazon'));
  assert.ok(p.steps.find(s => s.id.startsWith('start-0')).links.every(l => !l.aff));
});

t('build is pure: the activity and settings are not changed', () => {
  const a = byId['walk-yorkshire-three-peaks'], sa = JSON.stringify(a), ss = JSON.stringify(data.steps);
  P.build(a, data, { date: '2027-06-19', today: TODAY });
  assert.strictEqual(JSON.stringify(a), sa); assert.strictEqual(JSON.stringify(data.steps), ss);
});

t('same inputs, same plan', () => {
  const a = byId['climb-kilimanjaro'];
  assert.deepStrictEqual(P.build(a, data, { date: '2027-06-20', today: TODAY }), P.build(a, data, { date: '2027-06-20', today: TODAY }));
});
/* ---- My year (day 4): combine() puts every saved plan together ---- */
const entry = (id, item) => ({ id, title: byId[id] ? byId[id].title : id, item: Object.assign({ status: 'planned', plan_made: TODAY }, item), activity: byId[id] || null });
const anyFlex = acts.filter(a => !a.event && !a.dates && a.kit.length && a.kind === 'experience');
t('one plan alone: the same steps as build(), nothing moved, no clashes', () => {
  const a = byId['walk-yorkshire-three-peaks'], c = P.combine([entry(a.id, { date: '2027-06-19' })], data, { today: TODAY });
  const b = P.build(a, data, { date: '2027-06-19', today: TODAY });
  assert.deepStrictEqual(c.steps.map(s => [s.id, s.date]), b.steps.map(s => [s.id, s.date]));
  assert.ok(c.steps.every(s => !s.moved && s.pid === a.id)); assert.strictEqual(c.clashes.length, 0);
});
t('two things on the same day are flagged, not moved', () => {
  const [a, b] = anyFlex;
  const c = P.combine([entry(a.id, { date: '2027-05-15' }), entry(b.id, { date: '2027-05-15' })], data, { today: TODAY });
  const cl = c.clashes.filter(x => x.kind === 'day'); assert.strictEqual(cl.length, 1); assert.deepStrictEqual(cl[0].ids.sort(), [a.id, b.id].sort());
  assert.ok(cl[0].text.includes(a.title) && cl[0].text.includes('15 May 2027'));
  assert.ok(c.steps.filter(s => s.id === 'day').every(s => s.date === '2027-05-15'));
});
t('a done item does not clash', () => {
  const [a, b] = anyFlex;
  assert.strictEqual(P.combine([entry(a.id, { date: '2027-05-15', status: 'done' }), entry(b.id, { date: '2027-05-15' })], data, { today: TODAY }).clashes.length, 0);
});
t('two training plans at once are flagged with the overlap', () => {
  const c = P.combine([entry('climb-kilimanjaro', { date: '2027-09-10' }), entry('walk-yorkshire-three-peaks', { date: '2027-08-14' })], data, { today: TODAY });
  const cl = c.clashes.find(x => x.kind === 'train'); assert.ok(cl, 'overlap flagged');
  const ts = c.steps.filter(s => s.strand === 'train').map(s => s.date).sort();
  assert.strictEqual(cl.from, ts[1]); assert.strictEqual(cl.to, '2027-08-14');
  const far = P.combine([entry('climb-kilimanjaro', { date: '2027-09-10' }), entry('walk-yorkshire-three-peaks', { date: '2027-03-06' })], data, { today: TODAY });
  assert.ok(!far.clashes.some(x => x.kind === 'train'), 'no overlap, no flag');
});
t('a flexible step on the day of another plan moves off it, inside its own run-up, and says why', () => {
  // find a plan with a flexible step, then put another activity's day on that step's date
  const a = anyFlex[0], pa = P.build(a, data, { date: '2027-06-19', today: TODAY }), st = pa.steps.find(s => s.flexible && s.date < pa.date);
  const b = anyFlex.find(x => x.id !== a.id && x.time === 'afternoon') || anyFlex[1];
  const c = P.combine([entry(a.id, { date: '2027-06-19' }), entry(b.id, { date: st.date })], data, { today: TODAY });
  const moved = c.steps.find(s => s.pid === a.id && s.id === st.id);
  assert.ok(moved.moved && moved.moved.by === 'day'); assert.notStrictEqual(moved.date, st.date);
  assert.ok(moved.date >= TODAY && moved.date < pa.date, 'stays in its run-up');
  assert.ok(moved.moved.why.includes(b.title));
  assert.ok(fills(data.notes.moved_day).test(moved.moved.why));
});
t('a busy day is spread out; fixed steps never move', () => {
  const four = anyFlex.slice(0, 4).map(a => entry(a.id, { date: '2027-07-24' }));
  const c = P.combine(four, data, { today: TODAY });
  const per = {}; c.steps.forEach(s => { per[s.date] = (per[s.date] || 0) + 1; });
  const kitDay = '2027-07-10';
  assert.ok(per[kitDay] <= data.busy, 'kit day no longer over-full: ' + per[kitDay]);
  c.steps.filter(s => s.moved).forEach(s => { assert.ok(s.flexible); assert.strictEqual(s.moved.by, 'busy'); assert.ok(fills(data.notes.moved_busy).test(s.moved.why)); });
  assert.ok(c.steps.some(s => s.moved));
});
t('the reader\'s own moves and ticks are kept; a move outside the run-up is ignored', () => {
  const a = anyFlex[0], pa = P.build(a, data, { date: '2027-06-19', today: TODAY }), st = pa.steps.find(s => s.flexible && s.date < pa.date);
  const fixed = pa.steps.find(s => !s.flexible && s.id !== 'day');
  const ok = P.combine([entry(a.id, { date: '2027-06-19', moves: { [st.id]: { date: '2027-06-18' } }, ticks: { [fixed.id]: { done: true } } })], data, { today: TODAY });
  const m = ok.steps.find(s => s.id === st.id); assert.strictEqual(m.date, '2027-06-18'); assert.strictEqual(m.moved.by, 'you');
  assert.ok(ok.steps.find(s => s.id === fixed.id).done);
  const bad = P.combine([entry(a.id, { date: '2027-06-19', moves: { [st.id]: { date: '2027-06-25' }, [fixed.id]: { date: '2027-06-01' } } })], data, { today: TODAY });
  assert.strictEqual(bad.steps.find(s => s.id === st.id).date, st.date); assert.strictEqual(bad.steps.find(s => s.id === fixed.id).date, fixed.date);
});
t('a date on the list without a saved plan, and the reader\'s own items, show as the day only', () => {
  const c = P.combine([{ id: 'x-abc', title: 'Paint the shed', item: { status: 'want', date: '2027-04-03' }, activity: null }, entry('parkrun', { month: '2027-05', plan_made: '' })], data, { today: TODAY });
  assert.strictEqual(c.steps.length, 2); assert.ok(c.steps.every(s => s.bare && s.id === 'day'));
  assert.strictEqual(c.steps[1].date, '2027-05-01'); assert.ok(c.steps[1].by_month);
});
t('combine over many random mixes: nothing lost, only flexible steps move, always inside their window', () => {
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let r = 0; r < 150; r++) {
    const picks = [...new Set(Array.from({ length: 2 + rnd(6) }, () => acts[rnd(acts.length)]))];
    const es = picks.map(a => { const sug = P.suggest(a, { today: TODAY }); return entry(a.id, rnd(3) ? { date: plus('2027-01-01', rnd(240)) } : sug.month ? { month: sug.month } : { date: sug.date }); });
    const c = P.combine(es, data, { today: TODAY });
    let total = 0;
    es.forEach(e => {
      const b = P.build(e.activity, data, Object.assign({ today: TODAY }, e.item.date ? { date: e.item.date } : { month: e.item.month }));
      const mine = c.steps.filter(s => s.pid === e.id);
      if (b.status !== 'ok') { assert.strictEqual(mine.length, 0); return; }
      total += b.steps.length;
      assert.deepStrictEqual(mine.map(s => s.id).sort(), b.steps.map(s => s.id).sort(), e.id + ': steps lost');
      mine.forEach(s => {
        const o = b.steps.find(x => x.id === s.id);
        if (!o.flexible) assert.strictEqual(s.date, o.date, e.id + ': a fixed step moved: ' + s.id);
        if (s.moved) { assert.ok(s.date >= TODAY); assert.ok(o.date < b.date ? s.date < b.date : s.date > b.date, e.id + ': moved across its day'); }
      });
    });
    assert.strictEqual(c.steps.length, total);
    assert.deepStrictEqual(P.combine(es, data, { today: TODAY }), c, 'same inputs, same result');
  }
});

/* ---- Add to my calendar (day 5): ics() ---- */
const unfold = txt => txt.replace(/\r\n /g, '');
const events = txt => unfold(txt).split('BEGIN:VEVENT').slice(1).map(b => Object.fromEntries(b.split('\r\n').filter(l => /^[A-Z-]+[;:]/.test(l)).map(l => { const i = l.search(/[;:]/); return [l.slice(0, i), l.slice(l.indexOf(':') + 1)]; })));
const unesc = s => s.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
const grp = (a, p, steps) => ({ id: a.id, cid: a.id, title: a.title, by_month: p.by_month, label: p.label, steps: steps || p.steps });
const STAMP = '20261102T090000Z';
t('calendar file: well formed, CRLF, every line at most 75 octets, one event per step still to do', () => {
  for (const a of acts) {
    const s = P.suggest(a, { today: TODAY }), p = P.build(a, data, Object.assign({ today: TODAY }, s.month ? { month: s.month } : { date: s.date }));
    if (p.status !== 'ok') continue;
    const f = P.ics([grp(a, p)], data, { today: TODAY, stamp: STAMP });
    assert.ok(f.text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && f.text.endsWith('END:VCALENDAR\r\n'), a.id);
    assert.ok(!/[^\r]\n/.test(f.text), a.id + ': bare LF');
    f.text.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 75, a.id + ': long line ' + l));
    const ev = events(f.text);
    assert.strictEqual(ev.length, p.steps.length); assert.strictEqual(f.count, p.steps.length);
    assert.strictEqual(new Set(ev.map(e => e.UID)).size, ev.length, a.id + ': UIDs not unique');
    ev.forEach((e, i) => {
      const st = p.steps[i];
      assert.strictEqual(e.DTSTART, st.date.replace(/-/g, '')); assert.strictEqual(e.DTEND, plus(st.date, 1).replace(/-/g, ''));
      const d = unesc(e.DESCRIPTION);
      if (st.detail) assert.ok(d.includes(st.detail), a.id + ': detail missing');
      if (st.strand === 'safety') assert.ok(d.includes(a.safety), a.id + ': safety line missing from the calendar');
      (st.links || []).forEach(l => assert.ok(d.includes(l.url), a.id + ': link missing'));
      (st.items || []).forEach(k => assert.ok(d.includes(k.name) && d.includes(k.url), a.id + ': kit missing'));
      assert.ok(d.includes('/list/' + a.id + '/#plan'));
      assert.ok(!/[?&](tag|pid|partner_id)=/.test(d), a.id + ': affiliate tag in the calendar');
    });
  }
});
t('calendar file: summaries and reasons come from planner.yaml; a month plan says so; text is escaped', () => {
  const a = byId['take-up-beekeeping'], p = P.build(a, data, { month: '2027-03', today: TODAY });
  const ev = events(P.ics([grp(a, p)], data, { today: TODAY, stamp: STAMP }).text);
  const day = ev.find(e => e.UID.endsWith('-day@dontdieretired.com'));
  assert.strictEqual(unesc(day.SUMMARY), data.notes.cal_day_month.replace('{title}', a.title).replace('{month}', 'March 2027'));
  assert.strictEqual(day.TRANSP, 'OPAQUE');
  ev.filter(e => e !== day).forEach(e => { assert.ok(fills(data.notes.cal_step).test(unesc(e.SUMMARY))); assert.strictEqual(e.TRANSP, 'TRANSPARENT'); assert.ok(/Why then: /.test(unesc(e.DESCRIPTION))); });
  const odd = { id: 'x-1', cid: null, title: 'Tea; cake, and a\\nap\nnow', by_month: false, label: '', steps: [{ id: 'day', strand: 'day', date: '2026-12-01', text: 'Tea; cake, and a\\nap\nnow', why: '', links: [], bare: true }] };
  const t2 = P.ics([odd], data, { today: TODAY, stamp: STAMP }).text;
  assert.ok(unfold(t2).includes('SUMMARY:Tea\\; cake\\, and a\\\\nap\\nnow\r\n'));
  assert.ok(unfold(t2).includes('UID:ddr-x-1-day@dontdieretired.com'));
});
t('calendar file: ticked steps and steps gone by are left out; moved steps go on their new day; long Unicode folds whole', () => {
  const a = byId['take-up-beekeeping'], p = P.build(a, data, { date: '2027-04-10', today: TODAY });
  const flex = p.steps.find(s => s.flexible && s.date < p.date), fixed = p.steps.find(s => !s.flexible && s.strand !== 'day');
  const to = plus(flex.date, -2);
  const marked = P.applyMarks(p, { ticks: { [fixed.id]: { done: true, at: 'x' } }, moves: { [flex.id]: { date: to, at: 'x' } } }, data);
  const ev = events(P.ics([grp(a, p, marked)], data, { today: TODAY, stamp: STAMP }).text);
  assert.strictEqual(ev.length, p.steps.length - 1);
  assert.ok(!ev.some(e => e.UID.endsWith('-' + fixed.id + '@dontdieretired.com')));
  const m = ev.find(e => e.UID.endsWith('-' + flex.id + '@dontdieretired.com'));
  assert.strictEqual(m.DTSTART, to.replace(/-/g, '')); assert.ok(unesc(m.DESCRIPTION).includes('You moved this from'));
  const later = P.ics([grp(a, p)], data, { today: plus(p.steps[2].date, 1), stamp: STAMP });
  assert.strictEqual(later.count, p.steps.filter(s => s.date > p.steps[2].date).length);
  const u = { id: 'x-2', cid: null, title: 'Café ☕ '.repeat(30), by_month: false, label: '', steps: [{ id: 'day', strand: 'day', date: '2026-12-01', text: 'x', why: '', links: [], bare: true }] };
  const tx = P.ics([u], data, { today: TODAY, stamp: STAMP }).text;
  tx.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 75));
  assert.ok(Buffer.from(tx).toString() === tx && !tx.includes('�'));
  assert.strictEqual(unesc(events(tx)[0].SUMMARY), u.title);
});
t('calendar file from My year: every plan together, auto-moves kept, done plans and their steps still left to the caller', () => {
  const ids = anyFlex.slice(0, 3).map(a => a.id);
  const es = ids.map(id => entry(id, { date: '2027-05-15' }));
  const c = P.combine(es, data, { today: TODAY });
  const groups = c.plans.map(p => ({ id: p.id, cid: p.cid, title: p.title, by_month: !p.date, label: p.label, steps: c.steps.filter(s => s.pid === p.id) }));
  const ev = events(P.ics(groups, data, { today: TODAY, stamp: STAMP }).text);
  assert.strictEqual(ev.length, c.steps.length);
  c.steps.filter(s => s.moved).forEach(s => { const e = ev.find(x => x.UID === 'ddr-' + s.pid + '-' + s.id + '@dontdieretired.com'); assert.strictEqual(e.DTSTART, s.date.replace(/-/g, '')); assert.ok(unesc(e.DESCRIPTION).includes(s.moved.why)); });
  assert.deepStrictEqual(P.ics(groups, data, { today: TODAY, stamp: STAMP }), P.ics(groups, data, { today: TODAY, stamp: STAMP }), 'same inputs, same file');
});
console.log(n + ' tests passed');

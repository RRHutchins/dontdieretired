// Tests for the Fifty at Fifty merge (static/list-store.js). Run: node tools/test_list_merge.js
// merge() is what "Restore from backup" uses today and what account sync will use later, so it must never lose anything.
const assert = require('assert');
const L = require('../static/list-store.js');
const item = (id, o = {}) => ({ id, cid: id.startsWith('x-') ? null : id, title: '', status: 'want', date: '', note: '', pos: 0, added_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', deleted: false, ...o });
const list = (items, o = {}) => ({ version: 1, title: 'Fifty at Fifty', target: 50, settings_updated_at: '', items, ...o });
const ids = d => d.items.map(i => i.id);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('empty with empty', () => assert.deepStrictEqual(L.merge(L.empty(), L.empty()).items, []));
t('empty account keeps the device list', () => assert.deepStrictEqual(ids(L.merge(list([item('parkrun'), item('wild-swim', { pos: 1 })]), L.empty())), ['parkrun', 'wild-swim']));
t('empty device takes the other list', () => assert.deepStrictEqual(ids(L.merge(null, list([item('parkrun')]))), ['parkrun']));
t('union: nothing dropped from either side', () => {
  const m = L.merge(list([item('a'), item('b', { pos: 1 })]), list([item('c'), item('b', { pos: 1 })]));
  assert.deepStrictEqual(ids(m).sort(), ['a', 'b', 'c']);
});
t('same item in both: newest change wins, whichever side', () => {
  const old = item('a', { status: 'want' }), neu = item('a', { status: 'done', note: 'Did it', updated_at: '2026-10-05T00:00:00.000Z' });
  assert.strictEqual(L.merge(list([old]), list([neu])).items[0].status, 'done');
  assert.strictEqual(L.merge(list([neu]), list([old])).items[0].note, 'Did it');
});
t('deletion on one side survives an older live copy', () => {
  const del = item('a', { deleted: true, updated_at: '2026-10-05T00:00:00.000Z' });
  const m = L.merge(list([item('a')]), list([del]));
  assert.strictEqual(m.items.length, 1); assert.strictEqual(m.items[0].deleted, true);
});
t('re-adding after a deletion wins when it is newer', () => {
  const del = item('a', { deleted: true, updated_at: '2026-10-05T00:00:00.000Z' }), back = item('a', { updated_at: '2026-10-06T00:00:00.000Z' });
  assert.strictEqual(L.merge(list([del]), list([back])).items[0].deleted, false);
});
t('exact tie keeps the live copy', () => assert.strictEqual(L.merge(list([item('a', { deleted: true })]), list([item('a')])).items[0].deleted, false));
t('own challenges from both sides are all kept, with their words', () => {
  const m = L.merge(list([item('x-one', { title: 'Paint the shed' })]), list([item('x-two', { title: 'Learn the tango', note: 'With Sam' })]));
  assert.deepStrictEqual(m.items.map(i => i.title).sort(), ['Learn the tango', 'Paint the shed']);
  assert.strictEqual(m.items.find(i => i.id === 'x-two').note, 'With Sam');
});
t('settings: newest wins', () => {
  const a = list([], { title: 'Sixty at Sixty', target: 60, settings_updated_at: '2026-10-05T00:00:00.000Z' });
  const m = L.merge(a, list([], { title: 'Old', target: 10, settings_updated_at: '2026-10-01T00:00:00.000Z' }));
  assert.strictEqual(m.title, 'Sixty at Sixty'); assert.strictEqual(m.target, 60);
});
t('merge is pure: inputs are not changed', () => {
  const a = list([item('a')]), b = list([item('b')]), sa = JSON.stringify(a), sb = JSON.stringify(b);
  L.merge(a, b); assert.strictEqual(JSON.stringify(a), sa); assert.strictEqual(JSON.stringify(b), sb);
});
t('merging twice changes nothing more', () => {
  const a = list([item('a'), item('b', { pos: 1 })]), b = list([item('c', { pos: 5 }), item('a', { status: 'done', updated_at: '2026-10-09T00:00:00.000Z' })]);
  const once = L.merge(a, b); assert.deepStrictEqual(L.merge(once, b), once); assert.deepStrictEqual(L.merge(once, a), once);
});
t('positions come out as 0..n-1 in order', () => assert.deepStrictEqual(L.merge(list([item('a', { pos: 7 })]), list([item('b', { pos: 3 })])).items.map(i => [i.id, i.pos]), [['b', 0], ['a', 1]]));
t('rubbish in a backup file is cleaned, not fatal', () => {
  const m = L.merge(list([item('a')]), { items: [null, 5, { id: '' }, { id: 'b', status: 'nonsense', note: 7 }, { id: 'a' }], target: 'lots', title: 9 });
  assert.deepStrictEqual(ids(m).sort(), ['a', 'b']); assert.strictEqual(m.items.find(i => i.id === 'b').status, 'want'); assert.strictEqual(m.target, 50);
});

/* ---- My year (RUNBOOK §6s): a plan is a date OR a month on the item, plus the day it was made ---- */
t('a plan date survives a merge with an older copy', () => {
  const planned = item('parkrun', { status: 'planned', date: '2027-03-06', plan_made: '2026-11-03', updated_at: '2026-11-03T00:00:00.000Z' });
  const m = L.merge(list([item('parkrun')]), list([planned]));
  assert.strictEqual(m.items[0].date, '2027-03-06'); assert.strictEqual(m.items[0].plan_made, '2026-11-03'); assert.strictEqual(m.items[0].status, 'planned');
});
t('a month plan is kept through clean and merge', () => {
  const m = L.merge(list([item('a', { month: '2027-06', plan_made: '2026-11-03', updated_at: '2026-11-03T00:00:00.000Z' })]), L.empty());
  assert.strictEqual(m.items[0].month, '2027-06'); assert.strictEqual(m.items[0].date, '');
});
t('never both: a date wins over a month', () => {
  const c = L.clean(list([item('a', { date: '2027-06-12', month: '2027-06' })]));
  assert.strictEqual(c.items[0].date, '2027-06-12'); assert.strictEqual(c.items[0].month, '');
});
t('bad plan fields are cleaned away', () => {
  const c = L.clean(list([item('a', { month: '2027-13', plan_made: 'yesterday', date: '2027-02-30x' })]));
  assert.strictEqual(c.items[0].month, ''); assert.strictEqual(c.items[0].plan_made, ''); assert.strictEqual(c.items[0].date, '');
});
t('old lists without plan fields still load', () => {
  const c = L.clean({ version: 1, items: [{ id: 'parkrun', cid: 'parkrun', status: 'want', updated_at: '2026-10-01T00:00:00.000Z' }] });
  assert.strictEqual(c.items[0].month, ''); assert.strictEqual(c.items[0].plan_made, '');
});
t('re-planning on another device: newest plan wins', () => {
  const a = item('a', { status: 'planned', month: '2027-06', plan_made: '2026-11-03', updated_at: '2026-11-03T00:00:00.000Z' });
  const b = item('a', { status: 'planned', date: '2027-07-04', plan_made: '2026-11-05', updated_at: '2026-11-05T00:00:00.000Z' });
  for (const m of [L.merge(list([a]), list([b])), L.merge(list([b]), list([a]))]) { assert.strictEqual(m.items[0].date, '2027-07-04'); assert.strictEqual(m.items[0].month, ''); }
});
/* ---- My year page (RUNBOOK §6s, day 4): ticks and moves on a saved plan ---- */
const P1 = { status: 'planned', date: '2027-06-19', plan_made: '2026-11-04' };
const T = (h) => '2026-11-0' + h + 'T00:00:00.000Z';
t('the starting level survives clean only on a saved plan, and two copies at different levels are different plans', () => {
  assert.strictEqual(L.clean(list([item('a', { ...P1, level: 'advanced' })])).items[0].level, 'advanced');
  assert.strictEqual(L.clean(list([item('a', { level: 'advanced' })])).items[0].level, '', 'no plan, no level');
  assert.strictEqual(L.clean(list([item('a', { ...P1, level: 'pro' })])).items[0].level, '');
  const a = item('a', { ...P1, level: 'starter', ticks: { 't1-5': { done: true, at: T(5) } }, updated_at: T(5) });
  const b = item('a', { ...P1, level: 'active', ticks: { 't2-5': { done: true, at: T(6) } }, updated_at: T(6) });
  const m = L.merge(list([a]), list([b])).items[0];
  assert.strictEqual(m.level, 'active'); assert.deepStrictEqual(Object.keys(m.ticks), ['t2-5'], 'ticks from the other level are not carried over');
});
t('ticks and moves are kept through clean', () => {
  const c = L.clean(list([item('a', { ...P1, ticks: { 'start-0': { done: true, at: T(5) } }, moves: { kit: { date: '2027-06-01', at: T(5) } } })]));
  assert.deepStrictEqual(c.items[0].ticks, { 'start-0': { done: true, at: T(5) } }); assert.deepStrictEqual(c.items[0].moves, { kit: { date: '2027-06-01', at: T(5) } });
});
t('bad ticks and moves are cleaned away, and none without a saved plan', () => {
  const c = L.clean(list([item('a', { ...P1, ticks: { 'Bad Key!': { done: true }, ok: 'yes', kit: { done: 1 } }, moves: { kit: { date: 'soon' }, book: { date: '' } } }), item('b', { ticks: { kit: { done: true } } })]));
  assert.deepStrictEqual(c.items[0].ticks, { kit: { done: true, at: '' } }); assert.deepStrictEqual(c.items[0].moves, { book: { date: '', at: '' } });
  assert.deepStrictEqual(c.items[1].ticks, {});
  assert.deepStrictEqual(L.clean(list([item('c', { ...P1, ticks: [1, 2] })])).items[0].ticks, {});
});
t('old saved plans without ticks or moves still load', () => {
  const c = L.clean(list([item('a', P1)])); assert.deepStrictEqual(c.items[0].ticks, {}); assert.deepStrictEqual(c.items[0].moves, {});
});
t('same plan on two devices: ticks of different steps are both kept', () => {
  const a = item('a', { ...P1, updated_at: T(5), ticks: { 'start-0': { done: true, at: T(5) } } });
  const b = item('a', { ...P1, updated_at: T(6), ticks: { book: { done: true, at: T(6) } }, moves: { kit: { date: '2027-06-02', at: T(6) } } });
  for (const m of [L.merge(list([a]), list([b])), L.merge(list([b]), list([a]))]) {
    assert.deepStrictEqual(Object.keys(m.items[0].ticks).sort(), ['book', 'start-0']); assert.strictEqual(m.items[0].moves.kit.date, '2027-06-02');
  }
});
t('same step on two devices: the newest tick wins, even inside the older copy', () => {
  const a = item('a', { ...P1, updated_at: T(7), ticks: { kit: { done: false, at: T(5) } } });
  const b = item('a', { ...P1, updated_at: T(6), ticks: { kit: { done: true, at: T(6) } } });
  for (const m of [L.merge(list([a]), list([b])), L.merge(list([b]), list([a]))]) assert.strictEqual(m.items[0].ticks.kit.done, true);
});
t('a re-planned item does not take ticks from the old plan', () => {
  const old = item('a', { ...P1, updated_at: T(5), ticks: { kit: { done: true, at: T(5) } } });
  const neu = item('a', { ...P1, date: '2027-07-10', plan_made: '2026-11-06', updated_at: T(6) });
  for (const m of [L.merge(list([old]), list([neu])), L.merge(list([neu]), list([old]))]) { assert.strictEqual(m.items[0].date, '2027-07-10'); assert.deepStrictEqual(m.items[0].ticks, {}); }
});
t('merging ticks twice changes nothing more', () => {
  const a = list([item('a', { ...P1, updated_at: T(5), ticks: { 'start-0': { done: true, at: T(5) } } })]);
  const b = list([item('a', { ...P1, updated_at: T(6), ticks: { book: { done: true, at: T(6) } } })]);
  const once = L.merge(a, b); assert.deepStrictEqual(L.merge(once, a), once); assert.deepStrictEqual(L.merge(once, b), once);
});
// The helpers, with a stand-in for the browser's storage
{
  const mem = {}; global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  t('plan() adds the activity, sets planned, the date and the day made', () => {
    L.plan('parkrun', { date: '2027-03-06' }, '2026-11-03');
    const it = L.get('parkrun'); assert.strictEqual(it.status, 'planned'); assert.strictEqual(it.date, '2027-03-06'); assert.strictEqual(it.month, ''); assert.strictEqual(it.plan_made, '2026-11-03');
  });
  t('plan() with a month clears the date', () => {
    L.plan('parkrun', { month: '2027-05' }, '2026-11-04');
    const it = L.get('parkrun'); assert.strictEqual(it.date, ''); assert.strictEqual(it.month, '2027-05'); assert.strictEqual(it.plan_made, '2026-11-04');
  });
  t('a date chosen on the list replaces the month', () => {
    L.update('parkrun', { date: '2027-05-15' }); const it = L.get('parkrun'); assert.strictEqual(it.month, ''); assert.strictEqual(it.date, '2027-05-15');
  });
  t('plan() does not undo "doing" or "done"', () => {
    L.update('parkrun', { status: 'done' }); L.plan('parkrun', { date: '2027-09-04' }, '2026-11-05'); assert.strictEqual(L.get('parkrun').status, 'done');
  });
  t('clearing a plan keeps the item and puts planned back to want', () => {
    L.update('parkrun', { status: 'planned' }); L.plan('parkrun', null);
    const it = L.get('parkrun'); assert.ok(it); assert.strictEqual(it.status, 'want'); assert.strictEqual(it.date, ''); assert.strictEqual(it.month, ''); assert.strictEqual(it.plan_made, '');
  });
  t('a nonsense plan is treated as clearing, never stored', () => {
    L.plan('wild-swim', { month: 'June' }, '2026-11-03'); const it = L.get('wild-swim'); assert.strictEqual(it.month, ''); assert.strictEqual(it.status, 'want');
  });
  t('tick() and shift() mark a saved plan, and newest wins per step', () => {
    L.plan('climb-ben-nevis', { date: '2027-06-19' }, '2026-11-04');
    L.tick('climb-ben-nevis', 'start-0', true); L.shift('climb-ben-nevis', 'kit', '2027-06-01');
    let it = L.get('climb-ben-nevis'); assert.strictEqual(it.ticks['start-0'].done, true); assert.strictEqual(it.moves.kit.date, '2027-06-01');
    L.tick('climb-ben-nevis', 'start-0', false); L.shift('climb-ben-nevis', 'kit', '');
    it = L.get('climb-ben-nevis'); assert.strictEqual(it.ticks['start-0'].done, false); assert.strictEqual(it.moves.kit.date, '');
  });
  t('tick() and shift() refuse bad input and items without a plan', () => {
    L.shift('climb-ben-nevis', 'kit', 'next week'); assert.strictEqual(L.get('climb-ben-nevis').moves.kit.date, '');
    L.tick('climb-ben-nevis', 'Not A Step', true); assert.ok(!('Not A Step' in L.get('climb-ben-nevis').ticks));
    L.add('learn-to-knit'); L.tick('learn-to-knit', 'kit', true); assert.deepStrictEqual(L.get('learn-to-knit').ticks, {});
  });
  t('changing the date, on the plan or on the list, clears ticks and moves', () => {
    L.tick('climb-ben-nevis', 'book', true); L.update('climb-ben-nevis', { date: '2027-07-03' });
    assert.deepStrictEqual(L.get('climb-ben-nevis').ticks, {});
    L.tick('climb-ben-nevis', 'book', true); L.update('climb-ben-nevis', { note: 'With Jo' }); assert.strictEqual(L.get('climb-ben-nevis').ticks.book.done, true);
    L.plan('climb-ben-nevis', { month: '2027-08' }, '2026-11-05'); assert.deepStrictEqual(L.get('climb-ben-nevis').ticks, {});
  });
  /* Day 6: a plan with dated training stores the starting level */
  t('plan() stores a starting level for training; a bad one, or none, is stored as none', () => {
    L.plan('walk-yorkshire-three-peaks', { date: '2027-06-19', level: 'starter' }, '2026-11-06');
    assert.strictEqual(L.get('walk-yorkshire-three-peaks').level, 'starter');
    L.plan('walk-yorkshire-three-peaks', { date: '2027-06-19', level: 'elite' }, '2026-11-06'); assert.strictEqual(L.get('walk-yorkshire-three-peaks').level, '');
    L.plan('walk-yorkshire-three-peaks', { date: '2027-06-19' }, '2026-11-06'); assert.strictEqual(L.get('walk-yorkshire-three-peaks').level, '');
    L.plan('walk-yorkshire-three-peaks', null); assert.strictEqual(L.get('walk-yorkshire-three-peaks').level, '');
  });
  t('changing the level is a new plan: ticks and moves go', () => {
    L.plan('walk-yorkshire-three-peaks', { date: '2027-06-19', level: 'active' }, '2026-11-06');
    L.tick('walk-yorkshire-three-peaks', 't1-5', true); assert.ok(L.get('walk-yorkshire-three-peaks').ticks['t1-5'].done);
    L.plan('walk-yorkshire-three-peaks', { date: '2027-06-19', level: 'starter' }, '2026-11-06');
    assert.deepStrictEqual(L.get('walk-yorkshire-three-peaks').ticks, {});
  });
  t('a plan with a hundred training sessions keeps every tick', () => {
    L.plan('climb-kilimanjaro', { date: '2027-09-10', level: 'active' }, '2026-11-06');
    for (let w = 1; w <= 20; w++) for (const sl of [1, 2, 3, 5, 6]) L.tick('climb-kilimanjaro', 't' + w + '-' + sl, true);
    assert.strictEqual(Object.keys(L.get('climb-kilimanjaro').ticks).length, 100);
  });
  /* Planner Plus day 8: the place the reader typed */
  t('where() stores a typed place, cleaned; a date change keeps it; removing the plan clears it', () => {
    L.plan('visit-an-open-garden', { date: '2027-06-12' }, '2026-11-08');
    L.where('visit-an-open-garden', '  Great   Dixter,\n Northiam <b>  ');
    assert.strictEqual(L.get('visit-an-open-garden').where, 'Great Dixter, Northiam b');
    L.where('visit-an-open-garden', 'x'.repeat(300)); assert.strictEqual(L.get('visit-an-open-garden').where.length, 120);
    L.where('visit-an-open-garden', 'Northiam');
    L.plan('visit-an-open-garden', { date: '2027-07-10' }, '2026-11-08'); assert.strictEqual(L.get('visit-an-open-garden').where, 'Northiam');
    L.update('visit-an-open-garden', { date: '2027-07-17' }); assert.strictEqual(L.get('visit-an-open-garden').where, 'Northiam');
    L.plan('visit-an-open-garden', null); assert.strictEqual(L.get('visit-an-open-garden').where, '');
    L.where('not-on-the-list', 'Leeds'); assert.strictEqual(L.get('not-on-the-list'), null);
  });
  t('a typed place merges like the rest of the item: newest wins, an old copy without one does not wipe it', () => {
    const a = list([item('visit-an-open-garden', { where: 'Northiam', updated_at: '2026-11-08T10:00:00.000Z' })]);
    const b = list([item('visit-an-open-garden', { where: 'Sissinghurst', updated_at: '2026-11-08T11:00:00.000Z' })]);
    assert.strictEqual(L.merge(a, b).items[0].where, 'Sissinghurst'); assert.strictEqual(L.merge(b, a).items[0].where, 'Sissinghurst');
    const old = list([item('visit-an-open-garden', { updated_at: '2026-10-01T00:00:00.000Z' })]);
    assert.strictEqual(L.merge(old, a).items[0].where, 'Northiam');
    assert.strictEqual(L.clean(list([item('parkrun', { where: 42 })])).items[0].where, '');
  });
  /* More than one day (Robin, 7 Nov 2026) */
  t('plan() stores a last day only after the first and within 30 days; a month never has one', () => {
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-08-18' }, '2026-11-07');
    assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '2027-08-18');
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-08-14' }, '2026-11-07'); assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '');
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-09-14' }, '2026-11-07'); assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '');
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-09-13' }, '2026-11-07'); assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '2027-09-13');
    L.plan('go-to-edinburgh-fringe', { month: '2027-08', until: '2027-08-18' }, '2026-11-07'); assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '');
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-08-18' }, '2026-11-07');
    L.update('go-to-edinburgh-fringe', { date: '2027-08-20' }); assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '');
    L.plan('go-to-edinburgh-fringe', { date: '2027-08-14', until: '2027-08-18' }, '2026-11-07'); L.plan('go-to-edinburgh-fringe', null);
    assert.strictEqual(L.get('go-to-edinburgh-fringe').until, '');
  });
  t('a last day is cleaned and merged with the item, and does not clear the plan\'s ticks', () => {
    assert.strictEqual(L.clean(list([item('parkrun', { date: '2027-01-01', until: 'soon' })])).items[0].until, '');
    assert.strictEqual(L.clean(list([item('parkrun', { until: '2027-01-02' })])).items[0].until, '');
    const base = { date: '2027-08-14', plan_made: '2026-11-07' };
    const a = list([item('go-to-edinburgh-fringe', { ...base, until: '2027-08-16', ticks: { book: { done: true, at: '2026-11-08T10:00:00.000Z' } }, updated_at: '2026-11-08T10:00:00.000Z' })]);
    const b = list([item('go-to-edinburgh-fringe', { ...base, until: '2027-08-18', ticks: { kit: { done: true, at: '2026-11-08T11:00:00.000Z' } }, updated_at: '2026-11-08T11:00:00.000Z' })]);
    const m = L.merge(a, b).items[0];
    assert.strictEqual(m.until, '2027-08-18'); assert.deepStrictEqual(Object.keys(m.ticks).sort(), ['book', 'kit']);
  });
  /* While you're there (Planner Plus day 10): `with`, the trip a plan was added to */
  t('plan() stores the trip a plan was added to; a new plan without it, or removing the plan, clears it', () => {
    L.plan('climb-ben-nevis', { date: '2027-08-16', with: 'go-to-edinburgh-fringe' }, '2026-11-08');
    assert.strictEqual(L.get('climb-ben-nevis').with, 'go-to-edinburgh-fringe');
    L.plan('climb-ben-nevis', { date: '2027-08-17' }, '2026-11-08'); assert.strictEqual(L.get('climb-ben-nevis').with, '');
    L.plan('climb-ben-nevis', { month: '2027-08', with: 'go-to-edinburgh-fringe' }, '2026-11-08'); assert.strictEqual(L.get('climb-ben-nevis').with, 'go-to-edinburgh-fringe');
    L.plan('climb-ben-nevis', null); assert.strictEqual(L.get('climb-ben-nevis').with, '');
    L.plan('climb-ben-nevis', { date: '2027-08-16', with: 'climb-ben-nevis' }, '2026-11-08'); assert.strictEqual(L.get('climb-ben-nevis').with, '', 'never itself');
    L.plan('climb-ben-nevis', { date: '2027-08-16', with: '<script>' }, '2026-11-08'); assert.strictEqual(L.get('climb-ben-nevis').with, '', 'only an id');
  });
  t('`with` is cleaned (an id, only on a saved plan) and newest wins in a merge without clearing ticks', () => {
    assert.strictEqual(L.clean(list([item('parkrun', { with: 'go-to-edinburgh-fringe' })])).items[0].with, '', 'no plan, no trip');
    assert.strictEqual(L.clean(list([item('parkrun', { date: '2027-01-01', plan_made: '2026-11-08', with: 'Bad Id!' })])).items[0].with, '');
    assert.strictEqual(L.clean(list([item('parkrun', { date: '2027-01-01', plan_made: '2026-11-08', with: 7 })])).items[0].with, '');
    const base = { date: '2027-08-16', plan_made: '2026-11-08' };
    const a = list([item('climb-ben-nevis', { ...base, ticks: { book: { done: true, at: '2026-11-08T10:00:00.000Z' } }, updated_at: '2026-11-08T10:00:00.000Z' })]);
    const b = list([item('climb-ben-nevis', { ...base, with: 'go-to-edinburgh-fringe', ticks: { kit: { done: true, at: '2026-11-08T11:00:00.000Z' } }, updated_at: '2026-11-08T11:00:00.000Z' })]);
    for (const m of [L.merge(a, b).items[0], L.merge(b, a).items[0]]) {
      assert.strictEqual(m.with, 'go-to-edinburgh-fringe'); assert.deepStrictEqual(Object.keys(m.ticks).sort(), ['book', 'kit']);
    }
  });
}
// Account sync (Planner Plus day 13) leans on merge() settling: merging again with what came back changes nothing
t('merge settles: merging the result again with either side changes nothing', () => {
  const plan = { status: 'planned', date: '2027-06-12', plan_made: '2026-11-09' };
  const a = list([item('a', { pos: 0 }), item('c', { ...plan, pos: 1, ticks: { book: { done: true, at: '2026-11-09T10:00:00.000Z' } }, updated_at: '2026-11-09T10:00:00.000Z' }), item('x-1', { title: 'Mine', pos: 2 })], { title: 'One', settings_updated_at: '2026-11-02T00:00:00.000Z' });
  const b = list([item('b', { pos: 0 }), item('c', { ...plan, pos: 0, ticks: { kit: { done: true, at: '2026-11-09T11:00:00.000Z' } }, updated_at: '2026-11-09T11:00:00.000Z' }), item('a', { deleted: true, updated_at: '2026-11-03T00:00:00.000Z' })]);
  const m = L.merge(a, b);
  assert.deepStrictEqual(L.merge(a, m), m); assert.deepStrictEqual(L.merge(m, b), m);
  assert.deepStrictEqual(L.merge(m, m), m); assert.deepStrictEqual(L.merge(m, a), m);
  assert.deepStrictEqual(L.merge(b, a).items.map(i => i.id).sort(), m.items.map(i => i.id).sort());
});

/* ---- the browser side of account sync, with a stand-in browser and a stand-in Worker that merges as the real one does ---- */
(async () => {
  const API = 'https://api.example.test';
  let account = null, calls = 0, status = 200, who = 'acct-1';
  global.fetch = async (url, init) => {
    calls++;
    assert.strictEqual(url, API + '/list/sync'); assert.strictEqual(init.credentials, 'include'); assert.strictEqual(init.method, 'POST');
    if (status !== 200) return { status, ok: false, json: async () => ({}) };
    const sent = JSON.parse(init.body);
    assert.strictEqual(sent.fields, L.FIELDS);
    if (sent.list !== null) account = L.merge(account, sent.list);
    const reply = { ok: true, list: JSON.parse(JSON.stringify(L.merge(account, null))), account: who };
    return { status: 200, ok: true, json: async () => reply };
  };
  const device = () => {
    const store = new Map(), events = [];
    const env = {
      localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
      document: { readyState: 'complete', querySelector: q => (q === 'meta[name="ddr-accounts"]' ? { getAttribute: () => API + '/' } : null), addEventListener() {} },
      window: { addEventListener() {}, dispatchEvent: ev => events.push(ev) },
    };
    const use = () => Object.assign(global, env, { StorageEvent: class { constructor(type, o) { this.type = type; Object.assign(this, o); } } });
    use();
    delete require.cache[require.resolve('../static/list-store.js')];
    const D = require('../static/list-store.js');
    return { D, store, events, use };
  };
  let m2 = 0; const at = async (name, fn) => { await fn(); m2++; console.log('ok  ' + name); };
  const phone = device(), laptop = device();
  await new Promise(r => setTimeout(r, 5));   // each page's sync-on-load runs first (neither device has signed in yet)

  await at('sync: a device that has not signed in never contacts the account', async () => {
    phone.use(); phone.D.add('learn-to-sail'); phone.D.plan('learn-to-sail', { date: '2027-06-12' }, '2026-11-09');
    const r = await phone.D.sync();
    assert.strictEqual(r.ok, false); assert.strictEqual(calls, 0);
  });
  await at('sync: signing in sends the browser list to the account; the device keeps it', async () => {
    phone.use(); const before = phone.store.get('ddr_list');
    const r = await phone.D.account(true, 'acct-1');
    assert.ok(r.ok); assert.strictEqual(calls, 1); assert.strictEqual(r.changed, false);
    assert.deepStrictEqual(account.items.map(i => i.id), ['learn-to-sail']);
    assert.strictEqual(phone.store.get('ddr_list'), before); assert.strictEqual(phone.events.length, 0);
  });
  await at('sync: a second device signing in merges both ways and tells its page to redraw', async () => {
    laptop.use(); laptop.D.add('beekeeping');
    const r = await laptop.D.account(true, 'acct-1');
    assert.ok(r.ok && r.changed);
    assert.deepStrictEqual(laptop.D.live(laptop.D.load()).map(i => i.id).sort(), ['beekeeping', 'learn-to-sail']);
    assert.strictEqual(laptop.D.get('learn-to-sail').date, '2027-06-12');
    assert.strictEqual(laptop.events.length, 1); assert.strictEqual(laptop.events[0].type, 'storage'); assert.strictEqual(laptop.events[0].key, 'ddr_list');
    phone.use(); const p = await phone.D.sync();
    assert.ok(p.changed); assert.ok(phone.D.has('beekeeping'));
  });
  await at('sync: both devices end up in the same order as the account, with no extra requests', async () => {
    phone.use(); phone.D.add('a1'); phone.D.add('a2'); await phone.D.sync();
    laptop.use(); laptop.D.add('b1'); laptop.D.add('b2'); const c = calls; await laptop.D.sync();
    await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(calls, c + 1, 'one request, no follow-ups');
    phone.use(); await phone.D.sync();
    const order = d => d.items.map(i => i.id).join(',');
    assert.strictEqual(order(phone.D.load()), order(account)); laptop.use(); assert.strictEqual(order(laptop.D.load()), order(account));
  });
  await at('sync: a change on the device is sent by itself shortly after', async () => {
    laptop.use(); const c = calls;
    laptop.D.tick('learn-to-sail', 'first', true);
    await new Promise(r => setTimeout(r, 1700));
    assert.strictEqual(calls, c + 1);
    assert.strictEqual(account.items.find(i => i.id === 'learn-to-sail').ticks.first.done, true);
  });
  await at('sync: asking while a sync is under way waits for the next one instead of failing', async () => {
    laptop.use(); const c = calls;
    const [a, b] = await Promise.all([laptop.D.sync(), laptop.D.sync()]);
    assert.ok(a.ok && b.ok); assert.strictEqual(calls, c + 2);
  });
  await at('sync: the account answering "signed out" stops syncing on this device; data stays', async () => {
    phone.use(); status = 401;
    const r = await phone.D.sync(); status = 200;
    assert.strictEqual(r.reason, 'signed-out'); assert.strictEqual(phone.D.flag('acct'), '');
    const c = calls; await phone.D.sync(); assert.strictEqual(calls, c);
    assert.ok(phone.D.has('beekeeping'));
  });
  await at('sync: a shared browser never sends one account\'s list to another without asking', async () => {
    laptop.use(); who = 'acct-2'; const c = calls; const before = account;
    const r = await laptop.D.account(true, 'acct-2');
    assert.strictEqual(r.reason, 'other-account'); assert.strictEqual(calls, c); assert.strictEqual(laptop.D.flag('acct'), '');
    // the member chooses to see only their own account's list here
    account = L.merge(null, list([item('kayak')]));
    const s2 = await laptop.D.account(true, 'acct-2', 'replace');
    assert.ok(s2.ok); assert.deepStrictEqual(laptop.D.live(laptop.D.load()).map(i => i.id), ['kayak']);
    assert.deepStrictEqual(account.items.map(i => i.id), ['kayak'], 'nothing from the other account was sent');
    assert.strictEqual(laptop.D.flag('acct_owner'), 'acct-2');
    account = before; who = 'acct-1';
    laptop.D.forget(); assert.strictEqual(laptop.D.live(laptop.D.load()).length, 0); assert.strictEqual(laptop.D.flag('acct_owner'), '');
    // a browser whose list belongs to nobody yet (saved before accounts) is added to the account on first sign-in
    laptop.D.add('pottery'); account = null;
    const s3 = await laptop.D.account(true, 'acct-1');
    assert.ok(s3.ok); assert.deepStrictEqual(account.items.map(i => i.id), ['pottery']);
    account = before; await laptop.D.sync();
  });
  await at('sync: signing out on purpose stops it too', async () => {
    laptop.use(); await laptop.D.account(false); const c = calls;
    laptop.D.add('pickleball'); await new Promise(r => setTimeout(r, 1700));
    assert.strictEqual(calls, c);
  });
  console.log(n + m2 + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });

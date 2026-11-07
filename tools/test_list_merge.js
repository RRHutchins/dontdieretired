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
}
console.log(n + ' tests passed');

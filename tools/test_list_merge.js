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
}
console.log(n + ' tests passed');

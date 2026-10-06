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
console.log(n + ' tests passed');

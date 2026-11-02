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
console.log(n + ' tests passed');

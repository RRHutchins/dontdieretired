// Print a plan as text, to check the generator by eye (RUNBOOK §6s). Needs a build first (dist/planner/activities.json).
// Usage: node tools/plan_sample.js <activity-id> <YYYY-MM-DD | YYYY-MM | suggest> [today YYYY-MM-DD]
const P = require('../static/planner.js');
const data = require('../dist/planner/activities.json');
const [id, when, today] = process.argv.slice(2);
const a = data.activities.find(x => x.id === id);
if (!a) { console.error('No activity ' + id); process.exit(1); }
const o = when === 'suggest' || !when ? P.suggest(a, { today }) : (/^\d{4}-\d{2}$/.test(when) ? { month: when } : { date: when });
const plan = P.build(a, data, Object.assign({ today }, o));
console.log(`${plan.title} — ${plan.label} (${a.kind}, ${plan.status})`);
plan.notes.forEach(n => console.log('  NOTE: ' + n));
if (plan.safety) console.log('  SAFETY: ' + plan.safety);
plan.steps.forEach(s => {
  console.log(`\n${P.longDate(s.date)}  [${s.strand}${s.flexible ? ', can move' : ''}]  ${s.text}`);
  if (s.detail) console.log('    ' + s.detail);
  console.log('    Why: ' + s.why);
  (s.links || []).forEach(l => console.log(`    → ${l.label}${l.aff ? ' (affiliate)' : ''}${l.why ? ': ' + l.why : ''}`));
  (s.items || []).forEach(k => console.log(`    • ${k.name}: ${k.why}${k.aff ? ' (affiliate)' : ''}`));
});

/* My year: the plan generator (RUNBOOK §6s, day 2).
   DDRPlan.build(activity, settings, { date | month, today }) turns one activity and the reader's date (or month) into
   dated get-ready steps, each with the reason for its timing. PURE: no storage, no network, no clock unless `today`
   is left out. Tests: node tools/test_planner.js.

   Where the words come from (house rule: nothing freehand):
   - what to do: the activity's own sourced fields (start, links, book, kit, safety) and content/dates.yaml;
   - when and why: content/planner.yaml → steps and notes (passed in as `settings`, from dist/planner/activities.json);
   - training: only the guidance engine. Today the plan carries one "start the N-week plan" step whose length is the
     engine's (never below its minimum); day 6 expands it into the engine's dated sessions.

   `activity` and `settings` are the shapes tools/planner.py writes to dist/planner/activities.json
   (settings = that file's { kinds, steps, notes }). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DDRPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STRAND_ORDER = { book: 0, learn: 1, train: 2, travel: 3, kit: 4, safety: 5, day: 6, after: 7 };

  /* ---- dates, all as UTC midnight so no daylight-saving surprises ---- */
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCDate() === +m[3] ? d : null; };
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);   // b - a
  const longDate = d => d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const monthYear = d => MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  function todayUTC(today) {
    if (today) return typeof today === 'string' ? parse(today) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));   // the reader's own calendar day
  }

  // [5,6,7,8,9] → "May to September"; [12,1,2] → "December to February"; [6,12] → "June and December"
  function monthsText(ms) {
    if (!ms || !ms.length) return '';
    const set = new Set(ms), prev = m => (m === 1 ? 12 : m - 1), next = m => (m === 12 ? 1 : m + 1);
    if (set.size === 12) return 'all year';
    const runs = [];
    for (let s = 1; s <= 12; s++) {
      if (!set.has(s) || set.has(prev(s))) continue;
      let e = s; while (set.has(next(e))) e = next(e);
      runs.push(s === e ? MONTHS[s - 1] : MONTHS[s - 1] + ' to ' + MONTHS[e - 1]);
    }
    return runs.length === 1 ? runs[0] : runs.slice(0, -1).join(', ') + ' and ' + runs[runs.length - 1];
  }
  const lc = t => t.charAt(0).toLowerCase() + t.slice(1);   // engine names start "A first…", "The…", "Climbing…"
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

  // "start", "start+7", "lead*0.5", or a number of days from the date
  function offset(at, leadDays) {
    if (typeof at === 'number') return at;
    const s = String(at);
    if (s === 'start') return -leadDays;
    let m = /^start\+(\d+)$/.exec(s); if (m) return -leadDays + +m[1];
    m = /^lead\*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(s); if (m) return -Math.round(leadDays * +m[1]);
    throw new Error('planner: cannot read step time ' + s);
  }

  // A start step that is about booking, entering or enrolling is shown in the Book strand; the rest are Learn.
  // A start step that is itself training advice (only checked when the engine supplies the training).
  const TRAINING = /\b(train|training|build (?:up|your)|back-to-back)\b/i;
  const BOOKISH = /\b(book|enter|register|apply|enrol|enroll|sign up|reserve|buy (?:a |your )?tickets?)\b/i;

  /* The suggested date for an activity: this year's fixed date if dates.yaml has one far enough ahead, else the start of
     the next best month that leaves the full run-up, else (any time) the full run-up from today. */
  function suggest(a, opts) {
    const today = todayUTC(opts && opts.today), lead = a.lead_weeks * 7;
    if (a.dates && a.dates.next) { const n = parse(a.dates.next); if (n && diffDays(today, n) >= lead) return { date: a.dates.next }; }
    const months = (a.dates && a.dates.months) || a.when || [];
    if (!months.length) return { date: iso(addDays(today, Math.max(lead, 7))) };
    for (let i = 0; i < 36; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
      if (months.includes(d.getUTCMonth() + 1) && diffDays(today, d) >= lead) return { month: iso(d).slice(0, 7) };
    }
    return { date: iso(addDays(today, lead)) };
  }

  function build(a, settings, opts) {
    opts = opts || {};
    const S = settings.steps, N = settings.notes, today = todayUTC(opts.today);
    let anchor, byMonth = false;
    if (opts.month) { const m = /^(\d{4})-(\d{2})$/.exec(opts.month); anchor = m && parse(m[1] + '-' + m[2] + '-01'); byMonth = !!anchor; }
    else anchor = parse(opts.date);
    if (!anchor) throw new Error('planner: give a date (YYYY-MM-DD) or a month (YYYY-MM)');
    const plan = { version: VERSION, activity: a.id, title: a.title, kind: a.kind, date: iso(anchor), by_month: byMonth,
      label: byMonth ? monthYear(anchor) : longDate(anchor), made: iso(today), lead_weeks: a.lead_weeks,
      status: 'ok', notes: [], safety: a.safety || '', steps: [] };
    const label = plan.label;
    // a month that has already begun counts as now, not as gone
    if (diffDays(today, byMonth ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)) : anchor) < 0) {
      plan.status = 'past'; plan.notes.push(N.past); return plan;
    }
    const leadDays = a.lead_weeks * 7, avail = Math.max(0, diffDays(today, anchor));
    const squeeze = avail < leadDays ? avail / leadDays : 1;

    // Training: only from the engine, never shorter than its minimum.
    let trainWeeks = 0;
    if (a.event) {
      const w = Math.floor(avail / 7);
      if (w < a.event.min_weeks) {
        plan.status = 'too_soon';
        plan.earliest = iso(addDays(today, a.event.min_weeks * 7));
        plan.notes.push(fill(N.too_soon, { event: a.event.name, weeks: a.event.min_weeks, earliest: longDate(addDays(today, a.event.min_weeks * 7)) }));
        return plan;   // no plan at all rather than one without enough training
      }
      trainWeeks = Math.min(a.event.weeks, w);
      if (trainWeeks < a.event.weeks) plan.notes.push(fill(N.train_short, { event: a.event.name, usual: a.event.weeks, weeks: trainWeeks, min: a.event.min_weeks }));
    }
    if (squeeze < 1 && !a.event) plan.notes.push(fill(N.squeezed, { weeks: a.lead_weeks }));
    const when = (a.dates && a.dates.months) || a.when || [];
    if (when.length && !when.includes(anchor.getUTCMonth() + 1)) {
      plan.notes.push(fill(N.outside, { date: label, months: monthsText(when), season: a.season || (a.dates && a.dates.note) || '' }).replace(/ by our reading of its season: ""\./, '.'));
    }

    const vars = { title: a.title, date: label };
    const steps = plan.steps;
    // before the date: squeezed into the time there is, never before today, never after the day before
    const place = (at, flexible) => {
      let off = offset(at, leadDays);
      if (off < 0) { off = Math.round(off * squeeze); if (off >= 0) off = avail > 0 ? -1 : 0; if (-off > avail) off = -avail; }
      return { date: iso(addDays(anchor, off)), flexible };
    };
    const add = (id, strand, at, flexible, s) => steps.push(Object.assign({ id, strand }, place(at, flexible), s));
    const links = ls => (ls || []).map(l => ({ label: l.label, url: l.url, region: l.region || 'any', why: l.why || '', aff: l.aff || (/amazon\./.test(l.url) ? 'amazon' : null) }));
    const strands = new Set(a.strands);

    // 1. The activity's own three start steps, in order. The first is the first day of the plan, the second a week on.
    //    The last: on the day for a one-off afternoon or a habit (it is what you do then); after the start for a longer
    //    course or project (it is the next stretch); in the run-up for anything else. An activity's `start_at` (one of first, second,
    //    ongoing, after_start, day for each step) overrides this.
    //    With an engine plan, a start step about training is not dated on its own: it goes with the engine's training step,
    //    because the engine's plan is the training (house rule).
    const st = a.start || [];
    const lastOnDay = a.time === 'afternoon' || a.kind === 'habit';
    const lastAfter = !lastOnDay && (a.kind === 'skill' || a.kind === 'project');
    const startStrand = t => (strands.has('book') && BOOKISH.test(t) ? 'book' : 'learn');
    let dayDetail = '';
    const trainNotes = [];
    st.forEach((t, i) => {
      if (a.event && i > 0 && TRAINING.test(t)) { trainNotes.push(t); return; }   // kept, with the engine's training step
      const last = i === st.length - 1;
      const name = a.start_at ? a.start_at[i] : i === 0 ? 'first' : i === 1 ? 'second' : last && lastOnDay ? 'day' : last && lastAfter ? 'after_start' : 'ongoing';
      if (name === 'day') { dayDetail = dayDetail ? dayDetail + ' ' + t : t; return; }
      add('start-' + i, startStrand(t), S[name].at, i > 0, { text: t, why: S[name].why, links: i === 0 ? links(a.links) : [] });
    });
    // 2. Fixed yearly dates (dates.yaml)
    if (a.dates) add('dates', 'book', S.dates.at, false, { text: S.dates.text, detail: a.dates.note, why: S.dates.why, links: [{ label: a.dates.source.label, url: a.dates.source.url, region: 'any', why: '', aff: null }] });
    // 3. Booking options the activity lists
    if (a.book && a.book.length) add('book', 'book', S.book.at, false, { text: S.book.text, why: S.book.why, links: links(a.book) });
    // 4. Training, from the engine only
    if (a.event && trainWeeks) {
      steps.push({ id: 'train-start', strand: 'train', date: iso(addDays(anchor, -trainWeeks * 7)), flexible: false,
        text: fill(S.train_start.text, { weeks: trainWeeks, event: lc(a.event.name) }), detail: [a.event.prerequisite].concat(trainNotes).filter(Boolean).join(' '),
        why: fill(S.train_start.why, { weeks: trainWeeks, event: lc(a.event.name) }), links: [], event: a.event.id, weeks: trainWeeks });
    }
    // 5. Getting there, only for something tied to a place
    if (strands.has('travel') && a.place_tied) add('travel', 'travel', S.travel.at, true, { text: S.travel.text, why: S.travel.why, links: [] });
    // 6. Kit the activity lists: after the first session for a course, two weeks before anything else
    if (a.kit && a.kit.length) {
      const k = a.kind === 'skill' ? S.kit_after : S.kit_before;
      add('kit', 'kit', k.at, true, { text: k.text, why: k.why, links: [], items: a.kit.map(x => ({ name: x.name, why: x.why, url: x.url, aff: /amazon\./.test(x.url) ? 'amazon' : null })) });
    }
    // 7. Safety, every line kept
    if (a.safety) add('safety', 'safety', S.safety.at, false, { text: S.safety.text, detail: a.safety, why: S.safety.why, links: [] });
    // 8. The day (or the month)
    const D = byMonth ? S.day_month : S.day;
    steps.push({ id: 'day', strand: 'day', date: iso(anchor), flexible: false, text: fill(D.text, vars), detail: dayDetail, why: fill(D.why, vars), links: [] });
    // 9. After: a look back for a habit, a check a month into a longer project
    if (a.kind === 'habit') add('look-back', 'after', S.look_back.at, true, { text: S.look_back.text, why: S.look_back.why, links: [] });
    if (a.kind === 'project' && !a.event && (a.time === 'months' || a.time === 'year')) add('take-stock', 'after', S.take_stock.at, true, { text: S.take_stock.text, why: S.take_stock.why, links: [] });

    steps.forEach((s, i) => { s._i = i; });
    steps.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (STRAND_ORDER[x.strand] - STRAND_ORDER[y.strand]) || x._i - y._i);
    steps.forEach(s => { delete s._i; if (!s.detail) delete s.detail; });
    plan.starts = steps.length ? steps[0].date : plan.date;
    return plan;
  }

  return { VERSION, build, suggest, monthsText, longDate: s => longDate(parse(s)), parse };
});

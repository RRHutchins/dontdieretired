/* My year: the plan generator (RUNBOOK §6s, day 2).
   DDRPlan.build(activity, settings, { date | month, today }) turns one activity and the reader's date (or month) into
   dated get-ready steps, each with the reason for its timing. PURE: no storage, no network, no clock unless `today`
   is left out. Tests: node tools/test_planner.js.

   Where the words come from (house rule: nothing freehand):
   - what to do: the activity's own sourced fields (start, links, book, kit, safety) and content/dates.yaml;
   - when and why: content/planner.yaml → steps and notes (passed in as `settings`, from dist/planner/activities.json);
   - training: only the guidance engine. A "start the N-week plan" step whose length is the engine's (never below its
     minimum), then (day 6) every session of the engine's plan for that length and starting level, dated
     (settings.training, from tools/engine.py export; opts.level = starter | active | advanced, default active).

   `activity` and `settings` are the shapes tools/planner.py writes to dist/planner/activities.json
   (settings = that file's { kinds, steps, notes }). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DDRPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const LEVELS = ['starter', 'active', 'advanced'];   // the engine's starting levels (RUNBOOK §6r)
  const STRAND_ORDER = { book: 0, learn: 1, train: 2, travel: 3, kit: 4, safety: 5, day: 6, after: 7 };

  /* ---- dates, all as UTC midnight so no daylight-saving surprises ---- */
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCDate() === +m[3] ? d : null; };
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);   // b - a
  const longDate = d => d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const monthYear = d => MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  /* More than one day (Robin, 7 Nov 2026): a plan on a day may also have a last day, `until`, up to MAX_SPAN days later.
     Everything gets ready by the first day; the stay is one block. "14 to 18 August 2027", "30 July to 2 August 2027". */
  const MAX_SPAN = 30;
  function spanLabel(a, b) {
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return longDate(a) + ' to ' + longDate(b);
    if (a.getUTCMonth() !== b.getUTCMonth()) return a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + ' to ' + longDate(b);
    return a.getUTCDate() + ' to ' + longDate(b);
  }
  // the last day, if it is a real date after the first and no more than MAX_SPAN days on; else ''
  const okUntil = (date, until) => { const a = parse(date), b = parse(until); if (!a || !b) return ''; const n = diffDays(a, b); return n >= 1 && n <= MAX_SPAN ? until : ''; };
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
     the next best month that leaves the full run-up, else (any time) the full run-up from today.
     `why` says which: fixed | season | any (the words are content/planner.yaml → notes.suggest_*). */
  function suggest(a, opts) {
    const today = todayUTC(opts && opts.today), lead = a.lead_weeks * 7;
    if (a.dates && a.dates.next) { const n = parse(a.dates.next); if (n && diffDays(today, n) >= lead) return { date: a.dates.next, why: 'fixed' }; }
    const months = (a.dates && a.dates.months) || a.when || [];
    if (!months.length) return { date: iso(addDays(today, Math.max(lead, 7))), why: 'any' };
    for (let i = 0; i < 36; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
      if (months.includes(d.getUTCMonth() + 1) && diffDays(today, d) >= lead) return { month: iso(d).slice(0, 7), why: 'season' };
    }
    return { date: iso(addDays(today, lead)), why: 'any' };
  }

  /* Where it is and getting there (RUNBOOK §6t, Planner Plus day 8). PURE. The same links serve the free "plan it
     yourself" box and the paid plan. The place is the activity's own sourced `where`, else what the member typed
     (opts.place); with neither, `needs` is true and the page asks. Every link is one of content/planner.yaml → trip.links,
     a search the reader runs themselves; the place goes into it URL-encoded and nothing else does (no home address:
     the map asks for, or uses, the reader's own starting point).
     trip(activity, settings, { place, when, from, to, date, until, by_month }) (from/to: a stay's first and last days, in
     words; date/until: the plan's days, YYYY-MM-DD) → { needs, label, sourced, note, source, away, head, where: [links],
     getting: [links], help, stay: { open, help, links, more }, eat: { help, links } }
     Day 9: a trip away (a stay over more than one day, or an activity tied to a place, not a weekly habit) gets "Where to
     stay": dated hotel searches for those nights (the first to the last day; a single day, that night; a month, no
     dates), and the hostels and campsites; open for a stay, folded ("Staying the night?") for a single day. Everything
     but a habit gets "Where to eat": map searches near the place. Nothing names a place to stay or eat. */
  const cleanPlace = t => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  function trip(a, settings, opts) {
    opts = opts || {};
    const T = settings.trip || {}, w = a.where || null, own = cleanPlace(opts.place);
    const away = !!opts.until || (!!a.place_tied && a.kind !== 'habit');
    const out = { needs: false, label: '', sourced: false, note: '', source: null, away, head: (away && T.head_away) || T.head || '', where: [], getting: [], help: '',
      stay: null, eat: null, near: null };
    if (w) {
      out.label = [w.venue, w.town, w.postcode].filter(Boolean).join(', '); out.sourced = true; out.note = w.note || '';
      out.source = { label: w.source.label, url: w.source.url, checked: w.source.checked };
    } else if (own) out.label = own;
    else { out.needs = true; return out; }
    const country = (w && w.country) || a.country || '';
    const cq = (T.country_q || {})[country];
    const q = cq && out.label.toLowerCase().indexOf(cq.toLowerCase()) < 0 ? out.label + ', ' + cq : out.label;
    // the nights for a hotel search: first to last day of a stay, the night of a single day, none for a month
    const d0 = !opts.by_month && parse(opts.date), d1 = d0 && opts.until && parse(opts.until) > d0 ? parse(opts.until) : null;
    const nights = d0 ? { in: iso(d0), out: iso(d1 || addDays(d0, 1)) } : null;
    const near = T.near_q || {};
    const put = u => u.replace(/\{(q(?:_[a-z]+)?|in|out)\}/g, (m, k) => k === 'q' ? encodeURIComponent(q) : k === 'in' || k === 'out' ? (nights ? nights[k] : m)
      : near[k.slice(2)] ? encodeURIComponent(near[k.slice(2)] + ' ' + q) : m);
    if (away && T.stay) out.stay = { open: !!d1, help: d1 ? fill(T.stay_help_span, { from: opts.from || longDate(d0), to: opts.to || longDate(d1) })
      : nights ? fill(T.stay_help_day, { day: longDate(d0) }) : T.stay_help_month, links: [], more: [] };
    if (a.kind !== 'habit' && T.eat) out.eat = { help: fill(T.eat_help, { place: out.label }), links: [] };
    if (away && T.near) out.near = { head: fill(T.near_tours, { place: out.label }), help: T.near_tours_help, links: [] };
    (T.links || []).forEach(l => {
      if (l.countries !== 'any' && !(country && l.countries.indexOf(country) >= 0)) return;
      const sec = l.section || 'getting';
      if ((sec === 'stay' && !out.stay) || (sec === 'eat' && !out.eat) || (sec === 'near' && !out.near)) return;
      // affiliate ids only on the tour searches (tools/planner.py refuses one anywhere else)
      const link = { id: l.id, label: l.label, url: put(nights && l.url_dated ? l.url_dated : l.url), why: l.why, region: 'any', aff: sec === 'near' && l.aff ? l.aff : null };
      if (sec === 'where') out.where.push(link); else if (sec === 'stay') out.stay[l.more ? 'more' : 'links'].push(link);
      else if (sec === 'eat') out.eat.links.push(link); else if (sec === 'near') out.near.links.push(link); else out.getting.push(link);
    });
    out.help = opts.from && opts.to && T.getting_help_span ? fill(T.getting_help_span, { from: opts.from, to: opts.to }) : fill(T.getting_help, { when: opts.when || T.when_none });
    return out;
  }

  /* While you're there and Goes well with (RUNBOOK §6t, Planner Plus day 10).   PURE.
     extras(activity, settings, { plan, items, acts, today }) → { nearby: [entry], goes: [entry] }
     plan: this activity's plan (build()); items: the reader's list items by id (from static/list-store.js); acts: planner
     entries by id (activities.json, or the few a page carries). An entry is { id, title, area, url, when, with, planned,
     pick }: `when` is what Add to my year saves ({ date } or { month }), or null with `pick` saying why the reader should
     choose on its own page ('event': it has training; 'fixed': it happens on set dates; 'long': it takes more than an
     afternoon, so more than a free day on a trip; 'date': no date here works). Only an afternoon's activity goes on a trip.
     `planned` is the label of a date or month the reader already gave it (then nothing is offered, so nothing is
     overwritten). Nearby (only for a trip away): activities tied to the same area, each on a free day of THIS trip
     (a stay: its second day on, the first day last; one day: that day; a month: that month), with `with` = this
     activity's id so My year does not flag it as a clash with the trip. Goes well with: each on its own suggested date. */
  function whenLabel(it) {
    if (!it) return '';
    if (it.date) { const u = okUntil(it.date, it.until); return u ? spanLabel(parse(it.date), parse(u)) : longDate(parse(it.date)); }
    return it.month ? monthYear(parse(it.month + '-01')) : '';
  }
  function tripWhen(plan, items, self, target) {
    if (plan.by_month) return { month: plan.date.slice(0, 7) };
    const taken = new Set();
    Object.keys(items || {}).forEach(k => {
      const it = items[k]; if (!it || it.deleted || k === self || k === target || !it.date) return;
      const end = okUntil(it.date, it.until) || it.date;
      for (let d = it.date; d <= end; d = iso(addDays(parse(d), 1))) taken.add(d);
    });
    const days = [];
    if (plan.until) for (let d = iso(addDays(parse(plan.date), 1)); d <= plan.until; d = iso(addDays(parse(d), 1))) days.push(d);
    days.push(plan.date);
    return { date: days.find(d => !taken.has(d)) || days[0] };
  }
  function extras(a, settings, opts) {
    opts = opts || {};
    const plan = opts.plan, items = opts.items || {}, acts = opts.acts || {}, today = iso(todayUTC(opts.today));
    const out = { nearby: [], goes: [] };
    if (!plan || plan.status !== 'ok') return out;
    const entry = (id, area, nearby) => {
      const t = acts[id]; if (!t) return null;
      const e = { id, title: t.title, area: area || '', url: '/list/' + id + '/', when: null, with: nearby ? a.id : '', planned: whenLabel(items[id]), pick: '' };
      if (e.planned) return e;
      if (t.event) { e.pick = 'event'; return e; }
      if (nearby) {
        if (t.dates || t.kind === 'event') { e.pick = 'fixed'; return e; }
        if (t.time !== 'afternoon') { e.pick = 'long'; return e; }   // weeks, months or a year: more than a free day on a trip
        e.when = tripWhen(plan, items, a.id, id);
      } else {
        const sg = suggest(t, { today });
        if (t.kind === 'event' && sg.why === 'any') { e.pick = 'fixed'; return e; }
        e.when = sg.date ? { date: sg.date } : { month: sg.month };
      }
      // only a date its own plan can work from (not gone by; no training needed, as checked above)
      const b = build(t, settings, Object.assign({ today }, e.when));
      if (b.status !== 'ok') { e.when = null; e.pick = 'date'; }
      return e;
    };
    const away = !!plan.until || (!!a.place_tied && a.kind !== 'habit');
    if (away) (a.nearby || []).forEach(n => { const e = entry(n[0], n[1], true); if (e) out.nearby.push(e); });
    (a.goes || []).forEach(id => { if (out.nearby.some(e => e.id === id)) return; const e = entry(id, '', false); if (e) out.goes.push(e); });
    return out;
  }

  /* "Plan it yourself" (RUNBOOK §6t, Planner Plus day 15): the free links, with no dates and nothing saved.   PURE.
     diy(activity, settings, { place, acts }) → { links, trip, nearby, goes }: the activity's own links (book it, find
     out more), trip() with no dates (the map, journey planners, hotel and food searches, tour searches), and the nearby
     and goes-with activities as links to their own pages (no Add to my year: that is Planner Plus). */
  function diy(a, settings, opts) {
    opts = opts || {};
    const acts = opts.acts || {}, t = trip(a, settings, { place: opts.place });
    const link = (id, area) => (acts[id] ? { id, title: acts[id].title, area: area || '', url: '/list/' + id + '/' } : null);
    const nearby = t.away ? (a.nearby || []).map(n => link(n[0], n[1])).filter(Boolean) : [];
    const goes = (a.goes || []).filter(id => !nearby.some(e => e.id === id)).map(id => link(id)).filter(Boolean);
    return { links: (a.links || []).slice(), trip: t, nearby, goes };
  }

  function build(a, settings, opts) {
    opts = opts || {};
    const S = settings.steps, N = settings.notes, today = todayUTC(opts.today);
    let anchor, byMonth = false;
    if (opts.month) { const m = /^(\d{4})-(\d{2})$/.exec(opts.month); anchor = m && parse(m[1] + '-' + m[2] + '-01'); byMonth = !!anchor; }
    else anchor = parse(opts.date);
    if (!anchor) throw new Error('planner: give a date (YYYY-MM-DD) or a month (YYYY-MM)');
    const until = byMonth || a.kind === 'habit' ? '' : okUntil(iso(anchor), opts.until);
    const plan = { version: VERSION, activity: a.id, title: a.title, kind: a.kind, date: iso(anchor), until, by_month: byMonth,
      label: byMonth ? monthYear(anchor) : until ? spanLabel(anchor, parse(until)) : longDate(anchor), made: iso(today), lead_weeks: a.lead_weeks,
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
      // the engine's full length for this starting point: its default, or longer where the engine says the default would
      // build too fast from there ("choose more weeks"); only with its dated data and a day, as that is where it shows
      const lv = LEVELS.includes(opts.level) ? opts.level : 'active', TRd = settings.training && settings.training[a.event.id];
      const full = TRd && !byMonth && TRd.full ? Math.max(a.event.weeks, TRd.full[lv] || 0) : a.event.weeks;
      trainWeeks = Math.min(full, w);
      if (trainWeeks < a.event.weeks) plan.notes.push(fill(N.train_short, { event: a.event.name, usual: a.event.weeks, weeks: trainWeeks, min: a.event.min_weeks }));
      if (full > a.event.weeks) {
        plan.notes.push(fill(trainWeeks < full ? N.train_level_short : N.train_level_long, { level: lc(N['level_' + lv]), full, usual: a.event.weeks, earliest: longDate(addDays(today, full * 7)) }));
        if (trainWeeks < full) plan.fuller = iso(addDays(today, full * 7));
      }
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
    let dayDetail = '', travelOwn = false;
    const trainNotes = [];
    st.forEach((t, i) => {
      if (a.event && i > 0 && TRAINING.test(t)) { trainNotes.push(t); return; }   // kept, with the engine's training step
      const last = i === st.length - 1;
      const name = a.start_at ? a.start_at[i] : i === 0 ? 'first' : i === 1 ? 'second' : last && lastOnDay ? 'day' : last && lastAfter ? 'after_start' : 'ongoing';
      if (name === 'day') { dayDetail = dayDetail ? dayDetail + ' ' + t : t; return; }
      // 'travel': shown with getting there (e.g. "reserve your train and somewhere to stay"), at the same point in the run-up
      // it then stands in for the general "Sort out getting there" step, so the plan does not say the same thing twice
      if (name === 'travel') travelOwn = true;
      add('start-' + i, name === 'travel' ? 'travel' : startStrand(t), S[name].at, i > 0, Object.assign({ text: t, why: S[name].why, links: i === 0 ? links(a.links) : [] }, name === 'travel' && settings.trip ? { detail: settings.trip.step_detail } : {}));
    });
    // 2. Fixed yearly dates (dates.yaml)
    if (a.dates) add('dates', 'book', S.dates.at, false, { text: S.dates.text, detail: a.dates.note, why: S.dates.why, links: [{ label: a.dates.source.label, url: a.dates.source.url, region: 'any', why: '', aff: null }] });
    // 3. Booking options the activity lists
    if (a.book && a.book.length) add('book', 'book', S.book.at, false, { text: S.book.text, why: S.book.why, links: links(a.book) });
    // 4. Training, from the engine only. With the engine's dated data (settings.training[event], from tools/engine.py
    //    export) and a day, every session is a dated step; for a month, or if the data could not be loaded, the plan
    //    shows only when to start and says why.
    if (a.event && trainWeeks) {
      const level = LEVELS.includes(opts.level) ? opts.level : 'active', W = trainWeeks;
      const TR = settings.training && settings.training[a.event.id];
      const tp = TR && !byMonth ? TR.plans[level + '-' + W] : null;
      if (TR && !byMonth && !tp) throw new Error('planner: the engine has no ' + level + ' plan of ' + W + ' weeks for ' + a.event.id);
      // the engine's week runs Monday to Sunday with the key session on Saturday (slot 5) and the challenge closing the
      // last week; here slot 5 is the reader's own day of the week, and the rest keep their places around it
      const at = (w, slot) => iso(addDays(anchor, -(W - w) * 7 + (slot - 5)));
      steps.push({ id: 'train-start', strand: 'train', date: tp ? at(1, 0) : iso(addDays(anchor, -W * 7)), flexible: false,
        text: fill(S.train_start.text, { weeks: W, event: lc(a.event.name) }), detail: [a.event.prerequisite].concat(trainNotes).filter(Boolean).join(' '),
        why: fill(S.train_start.why, { weeks: W, event: lc(a.event.name) }), links: [], event: a.event.id, weeks: W });
      if (byMonth) plan.notes.push(N.train_month);
      else if (!TR) plan.notes.push(N.train_offline);
      if (tp) {
        const T = TR.t, dn = [0, 1, 2, 3, 4, 5, 6].map(i => DAY_NAMES[addDays(anchor, i - 5).getUTCDay()]);
        const fd = x => String(x).replace(/\{d(\d)\}/g, (m, i) => dn[+i]);
        const tr = plan.train = { event: a.event.id, level, weeks: W, key: TR.key, start: TR.levels[level], draft: TR.draft, intro: fd(TR.intro),
          warn: tp.warn != null ? T[tp.warn] : '', parts: TR.parts.map(x => [fd(x[0]), fd(x[1])]), before: TR.before.slice(), safety: TR.safety.slice(),
          sources: TR.sources.map(x => Object.assign({}, x)), list: [] };
        if (tr.warn) plan.notes.push(tr.warn);
        tp.weeks.forEach((wk, i) => {
          const w = i + 1, ss = [];
          wk[2].forEach(x => {
            const st = { id: 't' + w + '-' + x[0], strand: 'train', date: at(w, x[0]), flexible: false, text: fd(T[x[2]]), detail: fd(T[x[3]]), why: fd(T[x[4]]), links: [], week: w, role: x[1] };
            if (st.date < plan.date) { steps.push(st); ss.push(st.date); }
          });
          tr.list.push({ w, head: fd(T[wk[0]]), bullets: wk[1].map(b => fd(T[b])), from: ss[0] || '', to: ss[ss.length - 1] || '' });
        });
      }
    }
    // 5. Getting there, only for something tied to a place
    if (strands.has('travel') && a.place_tied && !travelOwn) add('travel', 'travel', S.travel.at, true, { text: S.travel.text, detail: settings.trip ? settings.trip.step_detail : '', why: S.travel.why, links: [] });
    // 6. Kit the activity lists: after the first session for a course, two weeks before anything else
    if (a.kit && a.kit.length) {
      const k = a.kind === 'skill' ? S.kit_after : S.kit_before;
      add('kit', 'kit', k.at, true, { text: k.text, why: k.why, links: [], items: a.kit.map(x => ({ name: x.name, why: x.why, url: x.url, aff: /amazon\./.test(x.url) ? 'amazon' : null })) });
    }
    // 7. Safety, every line kept
    //    (for a month plan the step is "before you start": there is no single day to be the day before)
    const SF = byMonth && S.safety_month ? S.safety_month : S.safety;
    if (a.safety) add('safety', 'safety', SF.at, false, { text: SF.text, detail: a.safety, why: SF.why, links: [] });
    // 8. The day (or the month)
    const D = byMonth ? S.day_month : until && S.day_span ? S.day_span : S.day;
    steps.push(Object.assign({ id: 'day', strand: 'day', date: iso(anchor), flexible: false, text: fill(D.text, vars), detail: dayDetail, why: fill(D.why, vars), links: [] }, until ? { until } : {}));
    // 9. After: a look back for a habit, a check a month into a longer project
    if (a.kind === 'habit') add('look-back', 'after', S.look_back.at, true, { text: S.look_back.text, why: S.look_back.why, links: [] });
    if (a.kind === 'project' && !a.event && (a.time === 'months' || a.time === 'year')) add('take-stock', 'after', S.take_stock.at, true, { text: S.take_stock.text, why: S.take_stock.why, links: [] });

    steps.forEach((s, i) => { s._i = i; });
    steps.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (STRAND_ORDER[x.strand] - STRAND_ORDER[y.strand]) || x._i - y._i);
    steps.forEach(s => { delete s._i; if (!s.detail) delete s.detail; });
    plan.starts = steps.length ? steps[0].date : plan.date;
    return plan;
  }


  /* ---------------- My year (RUNBOOK §6s, day 4): all of a reader's plans together ----------------
     window(plan, step, today): the days a flexible step may move to. A step before the day stays between the day the plan
     was made (or today, if later) and the day before; a step after the day stays after it (up to 90 days). null = it
     cannot move (not flexible, or already gone by). */
  function window_(plan, st, today) {
    if (!st.flexible || st.date < today) return null;
    const day = plan.date, end = plan.until || day;
    if (st.date < day) { const min = plan.made > today ? plan.made : today, max = iso(addDays(parse(day), -1)); return min <= max ? { min, max } : null; }
    if (st.date > day) { const min = iso(addDays(parse(end), 1)); return { min: min > today ? min : today, max: iso(addDays(parse(end), 90)) }; }
    return null;
  }
  // Where a stored move may land, whatever today is: inside the plan's own run-up, or within 90 days after the day.
  function allowed(plan, st, to) {
    if (!st.flexible || !parse(to)) return false;
    if (st.date < plan.date) return to >= plan.made && to < plan.date;
    if (st.date > plan.date) { const end = plan.until || plan.date; return to > end && to <= iso(addDays(parse(end), 90)); }
    return false;
  }
  // The reader's own marks on one saved plan (ticks and moves, from static/list-store.js). Returns new steps, sorted.
  function applyMarks(plan, item, settings, opts) {
    const N = settings.notes, ticks = (item && item.ticks) || {}, moves = (item && item.moves) || {};
    const steps = plan.steps.map(st => {
      const o = Object.assign({}, st, { done: !!(ticks[st.id] && ticks[st.id].done) });
      const to = moves[st.id] && moves[st.id].date;
      if (to && to !== st.date && st.flexible && allowed(plan, st, to)) {
        o.moved = { from: st.date, by: 'you', why: fill(N.moved_you, { from: longDate(parse(st.date)) }) };
        o.date = to;
      }
      return o;
    });
    return sortSteps(steps);
  }
  function sortSteps(steps) {
    steps.forEach((s, i) => { s._i = i; });
    steps.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (STRAND_ORDER[x.strand] - STRAND_ORDER[y.strand]) || x._i - y._i);
    steps.forEach(s => { delete s._i; });
    return steps;
  }

  /* combine(entries, settings, { today }) → { plans, steps, clashes }   PURE.
     entries: [{ id, title, item, activity }]: item is the list item (date | month, plan_made, ticks, moves, status),
     activity the planner entry for a catalogue activity, or null (the reader's own, or no longer listed).
     - Every saved plan is rebuilt with today = the day it was made, then the reader's ticks and moves are applied.
     - Clashes are flagged, never fixed for the reader: two things on the same day; two training plans that overlap.
     - Flexible steps (never training, safety, booking dates or the day itself) are moved automatically, and each says why:
       off the day of another of the reader's plans, and off a day where several plans already have more than
       settings.busy steps. They move to the nearest day that is free, inside their own plan's run-up. A step the reader
       moved or ticked, or one already gone by, stays where it is. */
  function combine(entries, settings, opts) {
    const N = settings.notes, today = iso(todayUTC(opts && opts.today)), BUSY = settings.busy || 3;
    const plans = [], steps = [], clashes = [];
    (entries || []).forEach(e => {
      const it = e.item || {};
      if (!it.date && !it.month) return;
      const until = it.date ? okUntil(it.date, it.until) : '';
      const p = { id: e.id, title: e.title, cid: e.activity ? e.activity.id : null, date: it.date || '', until, month: it.month || '', status: it.status || 'planned',
        label: it.date ? (until ? spanLabel(parse(it.date), parse(until)) : longDate(parse(it.date))) : monthYear(parse(it.month + '-01')), plan: null,
        with: typeof it.with === 'string' ? it.with : '', away: !!until || !!(e.activity && e.activity.place_tied && e.activity.kind !== 'habit') };
      if (e.activity && it.plan_made) {
        const b = build(e.activity, settings, Object.assign({ today: it.plan_made, level: it.level }, it.date ? { date: it.date, until } : { month: it.month }));
        if (b.status === 'ok' && !b.until) p.until = '';   // e.g. a habit: no stay
        if (b.status === 'ok') p.label = b.label;
        p.plan = b;
        if (b.status === 'ok') applyMarks(b, it, settings, { today }).forEach(st => steps.push(Object.assign(st, { pid: e.id, ptitle: e.title, by_month: b.by_month })));
      } else {
        // a date or month on the list with no saved plan: shown as the day only
        steps.push(Object.assign({ id: 'day', strand: 'day', date: it.date || it.month + '-01', flexible: false, text: e.title, why: '', links: [], done: false, pid: e.id, ptitle: e.title, by_month: !it.date, bare: true }, until ? { until } : {}));
      }
      plans.push(p);
    });
    plans.sort((a, b) => ((a.date || a.month + '-01') < (b.date || b.month + '-01') ? -1 : (a.date || a.month + '-01') > (b.date || b.month + '-01') ? 1 : a.id < b.id ? -1 : 1));
    // Planner Plus day 10: something added from a trip's "While you're there" belongs to that trip while it still falls
    // inside it (same days, or the same month); otherwise it stands on its own again
    const endOf = p => p.until || p.date;
    plans.forEach(p => {
      const t = p.with && p.with !== p.id ? plans.find(x => x.id === p.with) : null;
      const inside = t && (p.date ? !!t.date && p.date >= t.date && p.date <= endOf(t) : !!p.month && (t.month || t.date.slice(0, 7)) === p.month);
      p.with = inside ? t.id : '';
      if (inside) steps.forEach(s => { if (s.pid === p.id && s.strand === 'day') s.with = fill(N.with_trip, { title: t.title }); });
    });
    const sameTrip = (x, y) => x.with === y.id || y.with === x.id || (!!x.with && x.with === y.with);
    const live = plans.filter(p => p.status !== 'done');
    const titles = ps => { const t = ps.map(p => p.title); return t.length < 3 ? t.join(' and ') : t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1]; };

    // Clash: two (or more) things on the same day
    const byDay = {};
    live.filter(p => p.date && !p.until && p.date >= today).forEach(p => { (byDay[p.date] = byDay[p.date] || []).push(p); });
    // things on one trip together are not a clash with each other (only with something else on that day)
    const tripsOn = ps => new Set(ps.map(p => (p.with && ps.some(x => x.id === p.with) ? p.with : p.id))).size;
    Object.keys(byDay).sort().forEach(d => { const ps = byDay[d]; if (tripsOn(ps) > 1) clashes.push({ kind: 'day', date: d, ids: ps.map(p => p.id), text: fill(N.clash_day, { titles: titles(ps), date: longDate(parse(d)) }) }); });
    // Clash: a stay of more than one day that overlaps another of the reader's days or stays
    const dated = live.filter(p => p.date && endOf(p) >= today);
    for (let i = 0; i < dated.length; i++) for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i], b = dated[j];
      if ((!a.until && !b.until) || sameTrip(a, b)) continue;
      const from = a.date > b.date ? a.date : b.date, to = endOf(a) < endOf(b) ? endOf(a) : endOf(b);
      if (from <= to) clashes.push({ kind: 'span', date: from, from, to, ids: [a.id, b.id], text: fill(N.clash_span, { a: a.title, b: b.title, adates: a.label, bdates: b.label }) });
    }
    // Clash: two training plans at once (the engine builds each one on its own)
    const trains = live.filter(p => p.plan && p.plan.status === 'ok').map(p => ({ p, st: steps.find(s => s.pid === p.id && s.strand === 'train') })).filter(x => x.st);
    for (let i = 0; i < trains.length; i++) for (let j = i + 1; j < trains.length; j++) {
      const a = trains[i], b = trains[j];
      const from = a.st.date > b.st.date ? a.st.date : b.st.date, to = a.p.plan.date < b.p.plan.date ? a.p.plan.date : b.p.plan.date;
      if (from <= to && to >= today) clashes.push({ kind: 'train', from, to, ids: [a.p.id, b.p.id], text: fill(N.clash_train, { a: a.p.title, b: b.p.title, from: longDate(parse(from > today ? from : today)), to: longDate(parse(to)) }) });
    }

    // Planner Plus day 10: a trip away over the training sessions of another plan, or ending the day before its key
    // session (the engine's long session). Said as a fact; the reader decides.
    const sessions = id => steps.filter(s => s.pid === id && s.week && s.date >= today);
    // (something added to a trip is covered by the trip's own note)
    live.filter(p => p.date && p.away && !p.with && endOf(p) >= today).forEach(t => {
      trains.forEach(({ p: r }) => {
        if (r.id === t.id || !r.plan.train) return;
        const ss = sessions(r.id), on = ss.filter(s => s.date >= t.date && s.date <= endOf(t)), key = r.plan.train.key;
        if (on.length) {
          const k = on.find(s => s.role === 'long');
          clashes.push({ kind: 'trip', date: t.date, ids: [t.id, r.id], text: fill(N.trip_train, { a: t.title, dates: t.label, n: on.length === 1 ? 'one' : on.length, b: r.title,
            key: k ? fill(N.trip_train_key, { key, day: longDate(parse(k.date)) }) : '' }) });
          return;
        }
        const next = iso(addDays(parse(endOf(t)), 1)), k = ss.find(s => s.date === next && s.role === 'long');
        if (k) clashes.push({ kind: 'trip', date: t.date, ids: [t.id, r.id], text: fill(N.trip_train_eve, { a: t.title, dates: t.label, key, b: r.title, day: longDate(parse(k.date)) }) });
      });
    });

    // Moving flexible steps
    const dayOf = {};   // date → the reader's things on that day (date plans only; every day of a stay)
    live.filter(p => p.date).forEach(p => { for (let d = p.date; d <= endOf(p); d = iso(addDays(parse(d), 1))) (dayOf[d] = dayOf[d] || []).push(p); });
    const count = {}, pidsOn = {};
    steps.forEach(s => { count[s.date] = (count[s.date] || 0) + 1; (pidsOn[s.date] = pidsOn[s.date] || new Set()).add(s.pid); });
    const planOf = id => plans.find(p => p.id === id);
    const otherDay = (date, pid) => (dayOf[date] || []).filter(p => p.id !== pid);
    const free = (date, pid) => !otherDay(date, pid).length && (count[date] || 0) < BUSY;
    const movable = s => s.flexible && !s.moved && !s.done && !s.bare && s.date >= today;
    function relocate(s, why, other) {
      const p = planOf(s.pid), w = window_(p.plan, s, today); if (!w) return false;
      const after = s.date > p.plan.date;
      for (let k = 1; k <= 10; k++) {
        for (const d of after ? [k, -k] : [-k, k]) {
          const to = iso(addDays(parse(s.date), d));
          if (to < w.min || to > w.max || !free(to, s.pid)) continue;
          count[s.date]--; count[to] = (count[to] || 0) + 1; (pidsOn[to] = pidsOn[to] || new Set()).add(s.pid);
          s.moved = { from: s.date, by: why, why: fill(why === 'day' ? N.moved_day : N.moved_busy, { from: longDate(parse(s.date)), other, n: BUSY }) };
          s.date = to; return true;
        }
      }
      return false;
    }
    // the plans whose own day is furthest off have the most room, so their steps move first
    const order = plans.map(p => p.id).reverse();
    const queue = steps.filter(movable).sort((x, y) => order.indexOf(x.pid) - order.indexOf(y.pid) || (x.date < y.date ? -1 : 1));
    queue.forEach(s => { const o = otherDay(s.date, s.pid); if (o.length) relocate(s, 'day', titles(o)); });
    queue.forEach(s => { if (!s.moved && count[s.date] > BUSY && pidsOn[s.date].size > 1) relocate(s, 'busy', ''); });

    return { plans, steps: sortSteps(steps), clashes };
  }

  /* ---------------- Add to my calendar (RUNBOOK §6s, day 5) ----------------
     ics(groups, settings, { today, stamp, site, name }) → the text of an iCalendar (.ics) file.   PURE.
     groups: [{ id, cid, title, by_month, label, steps }], one per plan (steps as build/applyMarks/combine give them).
     One all-day event per step from today on that is not ticked off; a month plan's day sits on the 1st and says
     "some time in <month>". Every word is the step's own (text, detail, why, links, kit) or content/planner.yaml →
     notes.cal_*. Links are written plain, without affiliate tags: the plan page, where the disclosure is shown, carries
     those. No alarms: the reader's own calendar decides about reminders. UIDs are stable per activity and step, so a
     calendar that honours them updates a step when the file is added again rather than copying it. */
  const utf8len = ch => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
  function fold(line) {   // at most 75 octets a line; a continuation line starts with one space; never split a character
    const out = []; let cur = '', bytes = 0;
    for (const ch of line) { const b = utf8len(ch); if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n');
  }
  const icsText = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  const icsDate = s => s.replace(/-/g, '');
  const uidPart = s => String(s).replace(/[^A-Za-z0-9._-]/g, '-');
  function ics(groups, settings, opts) {
    opts = opts || {};
    const N = settings.notes, today = iso(todayUTC(opts.today)), site = (opts.site || 'https://dontdieretired.com').replace(/\/$/, '');
    const stamp = opts.stamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Don\'t Die Retired//My year//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) L.push('X-WR-CALNAME:' + icsText(opts.name));
    // a subscribed calendar (day 17's live feed): how often calendar apps should look again (RFC 7986, and Outlook's own)
    if (/^PT\d{1,2}H$/.test(opts.refresh || '')) L.push('REFRESH-INTERVAL;VALUE=DURATION:' + opts.refresh, 'X-PUBLISHED-TTL:' + opts.refresh);
    let count = 0;
    (groups || []).forEach(g => {
      const page = g.cid ? site + '/list/' + encodeURIComponent(g.cid) + '/#plan' : site + '/list/#mine';
      (g.steps || []).forEach(st => {
        if (st.done || st.date < today) return;
        const isDay = st.strand === 'day';
        const summary = isDay ? (g.by_month ? fill(N.cal_day_month, { title: g.title, month: g.label }) : g.title) : fill(N.cal_step, { title: g.title, text: st.text });
        const body = [];
        if (isDay && st.text && st.text !== g.title) body.push(st.text);
        if (st.detail) body.push(st.detail);
        (st.items || []).forEach(x => body.push(x.name + (x.why ? ': ' + x.why : '') + '\n' + x.url));
        (st.links || []).forEach(l => body.push(l.label + (l.region === 'uk' ? ' (UK)' : l.region === 'us' ? ' (US)' : '') + '\n' + l.url));
        if (st.why && !st.bare) body.push(fill(st.week ? N.cal_why_train : N.cal_why, { why: st.why }));
        if (st.moved) body.push(st.moved.why);
        body.push(fill(N.cal_plan, { url: page }));
        const end = iso(addDays(parse(isDay && st.until ? st.until : st.date), 1));   // a stay is one block
        L.push('BEGIN:VEVENT', 'UID:ddr-' + uidPart(g.cid || g.id) + '-' + uidPart(st.id) + '@dontdieretired.com', 'DTSTAMP:' + stamp,
          'DTSTART;VALUE=DATE:' + icsDate(st.date), 'DTEND;VALUE=DATE:' + icsDate(end),
          'SUMMARY:' + icsText(summary), 'DESCRIPTION:' + icsText(body.join('\n\n')), 'URL:' + page,
          'TRANSP:' + (isDay ? 'OPAQUE' : 'TRANSPARENT'), 'END:VEVENT');
        count++;
      });
    });
    L.push('END:VCALENDAR');
    return { text: L.map(fold).join('\r\n') + '\r\n', count };
  }

  /* ---------------- The whole year as one calendar (Planner Plus day 17) ----------------
     calendar(items, settings, byId, { today, stamp, site, name }) → { text, count, plans }.   PURE.
     items: the live things on a list (DDRList.live(list)); byId: activity id → planner entry; settings.training as
     My year loads it. Every plan still to come, exactly as My year shows it (combine(): clashes, moves, ticks), through
     ics(). Used by My year's "Add to my calendar" and by the members' live calendar feed on the accounts Worker, so the
     file and the feed can never differ. */
  function calendar(items, settings, byId, opts) {
    opts = opts || {};
    const entries = (items || []).filter(it => it && (it.date || it.month)).map(it => {
      const a = it.cid ? (byId[it.cid] || null) : null;
      return { id: it.id, title: it.cid ? (a ? a.title : null) : it.title, item: it, activity: a };
    }).filter(e => e.title);   // an activity we no longer list has no title to show
    const all = combine(entries, settings, { today: opts.today });
    const groups = all.plans.filter(p => p.status !== 'done').map(p => ({ id: p.id, cid: p.cid, title: p.title, by_month: !p.date, label: p.label,
      steps: all.steps.filter(s => s.pid === p.id) }));
    const f = ics(groups, settings, opts);
    return { text: f.text, count: f.count, plans: groups.length };
  }

  /* A long plan on the page (Planner Plus day 21, checkpoint item 8): the next n training weeks that still have a session
     on or after today are drawn in full; later ones as one line each. Weeks wholly gone by are not "later". */
  function openWeeks(plan, today, n) {
    const ahead = [...new Set((plan.steps || []).filter(x => x.week && x.date >= today).map(x => x.week))];
    return { open: new Set(ahead.slice(0, n)), later: new Set(ahead.slice(n)) };
  }

  return { VERSION, LEVELS, MAX_SPAN, openWeeks, okUntil, build, suggest, trip, extras, diy, whenLabel, cleanPlace, combine, applyMarks, ics, calendar, window: window_, monthsText, longDate: s => longDate(parse(s)), monthYear: s => monthYear(parse(s + '-01')), parse, MONTHS };
});

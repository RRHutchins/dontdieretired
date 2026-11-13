/* My year: "Plan this" on an activity page (RUNBOOK §6s, day 3).
   The reader picks a day or a month; static/planner.js (DDRPlan) builds the steps; a saved plan is stored ONLY through
   static/list-store.js (DDRList.plan): the date or month and the day it was made. The steps are rebuilt from those, with
   today = the day it was made, so a saved plan does not shift. Every word shown comes from the activity's own fields
   or content/planner.yaml (in the page as #pl-data), and a plan's training sessions from the guidance engine
   (/planner/training/<event>.json, day 6), drawn a week at a time. Nothing leaves the browser.
   Planner Plus day 15 (RUNBOOK §6t): the box offers two ways. "Plan it yourself" (free): the links only (DDRPlan.diy),
   nothing saved. The dated planner: for everyone while the paywall is off ('open'), for members once it is on
   ('member'); anyone else ('guest', static/plus.js) sees what Plus does, the price and the sample plan, and a plan
   already saved in this browser stays visible read-only (calendar file and Remove still work: it is their own data).
   The sample page (/planner-plus/sample/) uses this file too, with data-pl-sample: one fixed plan, read-only. */
(function () {
  const P = window.DDRPlan, L = window.DDRList, box = document.querySelector('[data-pl]'), raw = document.getElementById('pl-data');
  if (!P || !L || !box || !raw) return;
  let data; try { data = JSON.parse(raw.textContent); } catch (e) { return; }
  const A = data.a, S = data.s, N = S.notes, id = A.id, X = data.x || {}, PP = S.plus || {};
  let sample = null; try { sample = box.dataset.plSample ? JSON.parse(box.dataset.plSample) : null; } catch (e) { return; }
  // 'pending' until static/plus.js answers, then 'open' | 'member' | 'guest'; 'sample' on the sample page
  let mode = sample ? 'sample' : 'pending';
  const ro = () => mode !== 'open' && mode !== 'member';   // nothing can be changed or added (pending counts, so nothing slips through)   // X: the planner entries of the nearby and goes-well-with activities (day 10)
  const $ = (s, r = box) => r.querySelector(s), $$ = (s, r = box) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(), today = sample ? sample.made : now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());   // the reader's own day
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = P.MONTHS.map(m => m.slice(0, 3));
  const dayText = s => { const d = P.parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
  const STRAND = { book: 'Book', learn: 'Get ready', train: 'Train', travel: 'Getting there', kit: 'Kit', safety: 'Stay safe', day: 'The day', after: 'Afterwards' };
  const AFF_REL = 'sponsored nofollow noopener', affUrl = (u, k) => (window.DDR && DDR.affUrl ? DDR.affUrl(u, k) : u);

  const form = $('[data-pl-form]'), out = $('[data-pl-out]'), err = $('[data-pl-err]');
  const dateIn = $('[data-pl-date]'), monthSel = $('[data-pl-month]'), sug = $('[data-pl-suggest]');
  const radios = $$('[data-pl-by]'), levels = $$('[data-pl-level]');
  // more than one day (Robin, 7 Nov 2026): a last day as well as the first; not offered for a habit (no box on the page)
  const spanBox = $('[data-pl-span]'), untilIn = $('[data-pl-until]'), spanPick = $('[data-pl-spanpick]'), spanWrap = $('[data-pl-spanwrap]');
  const spanOn = () => !!(spanBox && spanBox.checked && by() === 'date');
  function setSpan(on, until) {
    if (!spanBox) return;
    spanBox.checked = !!on; spanPick.hidden = !on;
    $('[data-pl-firstlbl]').hidden = !on; $('[data-pl-daylbl]').hidden = !!on;
    if (until !== undefined) untilIn.value = until || '';
    spanLimits();
  }
  function spanLimits() {
    if (!untilIn) return;
    const d = P.parse(dateIn.value); if (!d) { untilIn.removeAttribute('min'); untilIn.removeAttribute('max'); return; }
    const plus = n => { const x = new Date(d.getTime() + n * 86400000); return x.toISOString().slice(0, 10); };
    untilIn.min = plus(1); untilIn.max = plus(P.MAX_SPAN);
  }
  const level = () => (levels.find(r => r.checked) || {}).value || 'active';
  const setLevel = v => { const lv = P.LEVELS.includes(v) ? v : 'active'; levels.forEach(r => { r.checked = r.value === lv; }); };

  // Months from this one, two years ahead
  const ty = now.getFullYear(), tm = now.getMonth();
  if (form) for (let i = 0; i < 25; i++) { const y = ty + Math.floor((tm + i) / 12), m = (tm + i) % 12; const o = document.createElement('option'); o.value = y + '-' + pad(m + 1); o.textContent = P.MONTHS[m] + ' ' + y; monthSel.appendChild(o); }
  if (dateIn) dateIn.min = today;

  const by = () => (radios.find(r => r.checked) || {}).value || 'date';
  function setBy(v) {
    radios.forEach(r => { r.checked = r.value === v; });
    if (!form) return;
    $('[data-pl-datewrap]').hidden = v !== 'date'; $('[data-pl-monthwrap]').hidden = v !== 'month';
    if (spanWrap) spanWrap.hidden = v !== 'date';
  }
  if (spanBox) { spanBox.addEventListener('change', () => { setSpan(spanBox.checked); if (spanBox.checked) untilIn.focus(); }); dateIn.addEventListener('change', spanLimits); }
  radios.forEach(r => r.addEventListener('change', () => setBy(r.value)));
  function setWhen(w) {
    if (!form) return;
    if (w.month) { if (![...monthSel.options].some(o => o.value === w.month)) { const o = document.createElement('option'); o.value = w.month; o.textContent = P.monthYear(w.month); monthSel.insertBefore(o, monthSel.firstChild); } monthSel.value = w.month; setBy('month'); }
    else { dateIn.value = w.date; setBy('date'); }
    setSpan(!!w.until, w.until || '');
  }
  function suggestion() {
    const s = P.suggest(A, { today });
    sug.textContent = fill(N['suggest_' + s.why], { months: P.monthsText(A.when), weeks: A.lead_weeks });
    return s;
  }

  /* ---------- drawing a plan ---------- */
  function linkHtml(l, multi) {
    const aff = l.aff || null;
    const reg = multi && l.region === 'uk' ? ' <span class="fl-reg">UK</span>' : multi && l.region === 'us' ? ' <span class="fl-reg">US</span>' : '';
    return '<li><a href="' + esc(aff ? affUrl(l.url, aff) : l.url) + '" target="_blank" rel="' + (aff ? AFF_REL : 'noopener') + '">' + esc(l.label) + '</a>' + reg + (l.why ? '<span class="pl-lwhy">' + esc(l.why) + '</span>' : '') + '</li>';
  }
  /* ---------- the training (day 6): the engine's sessions, a week at a time ---------- */
  const OPEN_WEEKS = 4;
  const range = (a, b) => (a === b ? dayText(a) : dayText(a) + ' to ' + dayText(b));
  function sesHtml(st) {
    const gone = st.date < today && !st.done;
    return '<li class="pl-ses' + (st.done ? ' is-done' : '') + (gone ? ' is-gone' : '') + '"><p class="pl-date"><time datetime="' + st.date + '">' + esc(dayText(st.date)) + '</time>'
      + (st.done ? ' <span class="pl-tag">Done</span>' : '') + (gone ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
      + '<p class="pl-stext">' + esc(st.text) + '</p>' + (st.detail ? '<p class="pl-detail">' + esc(st.detail) + '</p>' : '')
      + '<p class="pl-why"><span>Why:</span> ' + esc(st.why) + '</p></li>';
  }
  function weekHtml(plan, w, later) {
    const tr = plan.train, wk = tr.list[w - 1], ss = plan.steps.filter(x => x.week === w), done = ss.filter(x => x.done).length;
    const gone = ss.every(x => x.date < today || x.done);
    if (later) {   // beyond the next four weeks: one line, the week's detail and sessions folded under it (checkpoint item 8)
      return '<li class="pl-step pl-week pl-week-later" data-strand="train"><details class="pl-wk pl-wkl"><summary><span class="pl-wkd"><time datetime="' + ss[0].date + '">'
        + esc(range(ss[0].date, ss[ss.length - 1].date)) + '</time>' + (done ? ', ' + done + ' of ' + ss.length + ' done' : '') + '</span> '
        + '<span class="pl-wkt">' + esc(fill(N.train_week, { w, weeks: tr.weeks, head: wk.head })) + '</span></summary>'
        + '<p class="pl-detail">' + esc(wk.bullets[0]) + '</p><ol class="pl-sessions">' + ss.map(sesHtml).join('') + '</ol>'
        + (wk.bullets.length > 1 ? '<p class="pl-wkh">Why this week looks like this</p><ul class="pl-wkwhy">' + wk.bullets.slice(1).map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '')
        + '</details></li>';
    }
    return '<li class="pl-step pl-week' + (done === ss.length ? ' is-done' : gone ? ' is-gone' : '') + '" data-strand="train">'
      + '<p class="pl-date"><time datetime="' + ss[0].date + '">' + esc(range(ss[0].date, ss[ss.length - 1].date)) + '</time> <span class="pl-tag">Train</span>'
      + (done ? ' <span class="pl-tag">' + done + ' of ' + ss.length + ' done</span>' : '') + '</p>'
      + '<p class="pl-text">' + esc(fill(N.train_week, { w, weeks: tr.weeks, head: wk.head })) + '</p>'
      + '<p class="pl-detail">' + esc(wk.bullets[0]) + '</p>'
      + '<details class="pl-wk"><summary>The ' + ss.length + (ss.length === 1 ? ' session' : ' sessions') + ' this week, and why</summary>'
      + '<ol class="pl-sessions">' + ss.map(sesHtml).join('') + '</ol>'
      + (wk.bullets.length > 1 ? '<p class="pl-wkh">Why this week looks like this</p><ul class="pl-wkwhy">' + wk.bullets.slice(1).map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '')
      + '</details></li>';
  }
  function aboutHtml(tr) {
    const lv = N['level_' + tr.level];
    return '<div class="pl-about"><p class="pl-draft">' + esc(tr.draft) + '</p>'
      + '<p><strong>Starting point:</strong> ' + esc(fill(N.level_opt, { label: lv, key: tr.key, start: tr.start })) + '</p>'
      + '<p>' + esc(tr.intro) + '</p>'
      + (tr.safety.length ? '<p class="pl-wkh">Stay safe while you train</p><ul class="pl-wkwhy">' + tr.safety.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + '<details class="pl-wk"><summary>About this training plan</summary>'
      + (tr.before.length ? '<p class="pl-wkh">Before you start</p><ul class="pl-wkwhy">' + tr.before.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + '<p class="pl-wkh">What each part of the plan is for</p><ul class="pl-wkwhy">' + tr.parts.map(x => '<li><strong>' + esc(x[0]) + '.</strong> ' + esc(x[1]) + '</li>').join('') + '</ul>'
      + '<p class="pl-wkh">Where this comes from</p><ul class="pl-links pl-src">' + tr.sources.map(x => '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.publisher + ', ' + x.title) + '</a>' + (x.year ? ' (' + esc(x.year) + ')' : '') + '</li>').join('') + '</ul>'
      + '</details></div>';
  }

  /* ---------- where it is and getting there (Planner Plus day 8): with the day itself ---------- */
  function tripHtml(plan) {
    const T = S.trip; if (!T || !current) return '';
    const r = P.trip(A, S, Object.assign({ place: current.place || '', when: plan.label, date: plan.date, until: plan.until, by_month: plan.by_month }, plan.until ? { from: P.longDate(plan.date), to: P.longDate(plan.until) } : {}));
    let h = '<div class="pl-trip" data-pl-trip><h5 class="pl-triph" tabindex="-1" data-pl-triph>' + esc(r.head) + '</h5>';
    if (r.needs && ro()) return '';   // read-only: no place was saved with it, so nothing to show
    if (r.needs || (current.editPlace && !r.sourced)) {
      return h + '<div class="pl-where-ask"><label class="pl-whereq" for="pl-where-in">' + esc(T.where_q) + '</label>'
        + '<input id="pl-where-in" class="pl-wherein" type="text" maxlength="120" autocomplete="off" spellcheck="false" value="' + esc(current.place || '') + '" data-pl-where-in>'
        + (A.area ? '<p class="meta">' + esc(fill(T.where_hint, { area: A.area })) + '</p>' : '')
        + '<p class="meta">' + esc(T.where_help) + '</p>'
        + '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-where-save>' + esc(T.where_save) + '</button></p></div></div>';
    }
    h += '<p class="pl-where"><strong>' + esc(T.where_label) + ':</strong> ' + esc(r.label) + '</p>' + (r.note ? '<p class="pl-detail">' + esc(r.note) + '</p>' : '');
    if (r.source) h += '<p class="meta">' + esc(T.where_source).replace('{label}', '<a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>').replace('{checked}', esc(P.longDate(r.source.checked))) + '</p>';
    h += '<ul class="pl-links">' + r.where.map(l => linkHtml(l, false)).join('') + '</ul>';
    if (!r.sourced && !ro()) h += '<p class="pl-acts"><button type="button" class="btn btn-small btn-ghost" data-pl-where-change>' + esc(T.where_change) + '</button></p>';
    h += '<p class="pl-wkh">' + esc(T.getting) + '</p><p class="meta">' + esc(r.help) + '</p><ul class="pl-links">' + r.getting.map(l => linkHtml(l, false)).join('') + '</ul>';
    return h + stayEatHtml(r, T, l => linkHtml(l, false)) + nearHtml(r, T, plan) + '</div>';
  }
  /* While you're there and Goes well with (Planner Plus day 10). Add to my year only once this plan is saved (a nearby
     one goes on a free day of this trip); before that, links to the activities' own pages. */
  const items = () => (sample ? {} : Object.fromEntries(L.live(L.load()).map(it => [it.id, it])));   // the sample ignores the reader's own list
  const ex = plan => P.extras(A, S, { plan, items: items(), acts: X, today });
  function xHtml(e, T, saved) {
    let h = '<li class="pl-x" data-pl-x="' + esc(e.id) + '"><p class="pl-xt"><a href="' + esc(e.url) + '" data-pl-xt>' + esc(e.title) + '</a>'
      + (e.area ? ' <span class="pl-lwhy pl-xarea">' + esc(fill(T.near_area, { area: e.area })) + '</span>' : '') + '</p>';
    if (e.planned) h += '<p class="meta">' + esc(fill(T.added, { when: e.planned })) + ' · <a href="' + esc(e.url) + '#plan">' + esc(T.see_plan) + '</a></p>';
    else if (e.when && saved) h += '<p class="pl-acts"><button type="button" class="btn btn-small btn-ghost" data-pl-add="' + esc(e.id) + '" data-pl-when="' + esc(JSON.stringify(e.when)) + '"' + (e.with ? ' data-pl-with="' + esc(e.with) + '"' : '') + '>'
      + esc(T.add) + ' <span class="pl-xwhen">' + esc(fill(T.add_on, { when: e.when.date ? P.longDate(e.when.date) : P.monthYear(e.when.month) })) + '</span></button></p>';
    else h += '<p class="meta"><a href="' + esc(e.url) + '#plan">' + esc(T.pick_date) + '</a>' + (e.pick === 'event' ? ': ' + esc(T.pick_why_event) : e.pick === 'fixed' ? ': ' + esc(T.pick_why_fixed) : e.pick === 'long' ? ': ' + esc(T.pick_why_long) : '') + '</p>';
    return h + '</li>';
  }
  function nearHtml(r, T, plan) {
    if (!r.near || !T.near) return '';
    const n = ex(plan).nearby, saved = !!(current && current.saved) && !ro();
    let h = '<p class="pl-wkh">' + esc(T.near) + '</p>';
    if (n.length) h += '<p class="meta">' + esc(T.near_help) + '</p><ul class="pl-xs">' + n.map(e => xHtml(e, T, saved)).join('') + '</ul>';
    return h + '<p class="pl-wkh pl-wkh-sub">' + esc(r.near.head) + '</p><p class="meta">' + esc(r.near.help) + '</p><ul class="pl-links">' + r.near.links.map(l => linkHtml(l, false)).join('') + '</ul>';
  }
  function goesHtml(plan) {
    const T = S.trip; if (!T || !T.goes) return '';
    const g = ex(plan).goes; if (!g.length) return '';
    return '<div class="pl-goes"><h4 class="pl-month">' + esc(T.goes) + '</h4><p class="meta">' + esc(T.goes_help) + '</p><ul class="pl-xs">' + g.map(e => xHtml(e, T, !ro())).join('') + '</ul></div>';
  }
  /* Where to stay and where to eat (Planner Plus day 9): open for a stay, folded for a single day away */
  function stayEatHtml(r, T, li) {
    let h = '';
    if (r.stay) {
      const body = '<p class="meta">' + esc(r.stay.help) + '</p><ul class="pl-links">' + r.stay.links.map(li).join('') + '</ul>'
        + (r.stay.more.length ? '<p class="pl-wkh pl-wkh-sub">' + esc(T.stay_more) + '</p><ul class="pl-links">' + r.stay.more.map(li).join('') + '</ul>' : '');
      h += r.stay.open ? '<p class="pl-wkh">' + esc(T.stay) + '</p>' + body
        : '<details class="pl-stay"><summary>' + esc(T.stay) + ': ' + esc(T.stay_fold) + '</summary>' + body + '</details>';
    }
    if (r.eat) h += '<p class="pl-wkh">' + esc(T.eat) + '</p><p class="meta">' + esc(r.eat.help) + '</p><ul class="pl-links">' + r.eat.links.map(li).join('') + '</ul>';
    return h;
  }
  function setPlace(v) {
    current.place = P.cleanPlace(v); current.editPlace = false;
    if (current.saved) L.where(id, current.place);
    draw(current.plan, current.saved);
    const h = $('[data-pl-triph]'); if (h) h.focus();
  }

  function draw(plan, saved) {
    let html = '', hasAff = false;
    if (current) current.saved = !!saved;
    const notes = plan.notes.slice();
    if (saved) {
      const end = plan.by_month ? P.parse(plan.date.slice(0, 8) + '01') : P.parse(plan.date);
      if (plan.by_month) end.setUTCMonth(end.getUTCMonth() + 1, 0);
      if (end && end.toISOString().slice(0, 10) < today) notes.unshift(fill(N.saved_past, { date: plan.label }));
    }
    html += '<div class="pl-head"><h3 tabindex="-1" data-pl-h>' + (plan.status === 'ok' ? 'Your plan for ' + esc(plan.label) : esc(plan.label)) + '</h3>';
    if (plan.status === 'ok') {
      const ses = plan.steps.filter(x => x.week).length, other = plan.steps.length - ses;
      html += '<p class="meta">' + other + ' steps' + (ses ? ' and ' + ses + ' training sessions' : '') + ', from ' + esc(P.longDate(plan.starts)) + '. Each one says why it comes when it does.</p>';
    }
    html += '</div>';
    if (notes.length) html += '<ul class="pl-notes">' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    if (plan.fuller && !saved && !ro()) html += '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-use="' + esc(plan.fuller) + '">Use ' + esc(P.longDate(plan.fuller)) + '</button></p>';
    if (plan.status === 'too_soon' && !ro()) html += '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-use="' + esc(plan.earliest) + '">Use ' + esc(P.longDate(plan.earliest)) + '</button></p>';
    if (plan.status !== 'ok') { out.innerHTML = html; return; }
    const multi = new Set(A.links.map(l => l.region)).size > 1;
    let month = '';
    const weeksDone = new Set();
    // the next four training weeks (not yet over) are drawn in full; the weeks after them one line each
    const wks = P.openWeeks(plan, today, OPEN_WEEKS);
    plan.steps.forEach(st => {
      if (st.week && weeksDone.has(st.week)) return;   // drawn with its week
      const m = st.date.slice(0, 7);
      if (m !== month) { html += (month ? '</ol>' : '') + '<h4 class="pl-month">' + esc(P.monthYear(m)) + '</h4><ol class="pl-steps">'; month = m; }
      if (st.week) { weeksDone.add(st.week); html += weekHtml(plan, st.week, wks.later.has(st.week)); return; }
      const gone = st.date < today;
      const links = st.links || [];
      if (links.some(l => l.aff) || (st.items || []).some(x => x.aff)) hasAff = true;
      html += '<li class="pl-step' + (st.strand === 'day' ? ' is-day' : '') + (gone && !st.done ? ' is-gone' : '') + (st.done ? ' is-done' : '') + '" data-strand="' + esc(st.strand) + '">'
        + '<p class="pl-date"><time datetime="' + st.date + '">' + esc(st.until ? range(st.date, st.until) : dayText(st.date)) + '</time> <span class="pl-tag">' + esc(STRAND[st.strand] || st.strand) + '</span>'
        + (st.done ? ' <span class="pl-tag">Done</span>' : '') + (st.moved ? ' <span class="pl-tag my-tag-moved">Moved</span>' : '') + (gone && !st.done ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
        + '<p class="pl-text">' + esc(st.text) + '</p>'
        + (st.detail ? '<p class="pl-detail">' + esc(st.detail) + '</p>' : '')
        + (links.length ? '<ul class="pl-links">' + links.map(l => linkHtml(l, multi)).join('') + '</ul>' : '')
        + ((st.items || []).length ? '<ul class="pl-links pl-kit">' + st.items.map(x => '<li><a href="' + esc(x.aff ? affUrl(x.url, x.aff) : x.url) + '" target="_blank" rel="' + (x.aff ? AFF_REL : 'noopener') + '">' + esc(x.name) + '</a><span class="pl-lwhy">' + esc(x.why) + '</span></li>').join('') + '</ul>' : '')
        + '<p class="pl-why"><span>Why then:</span> ' + esc(st.why) + '</p>'
        + (st.moved ? '<p class="pl-why my-moved">' + esc(st.moved.why) + '</p>' : '')
        + (st.id === 'train-start' && plan.train ? aboutHtml(plan.train) : '') + (st.strand === 'day' ? tripHtml(plan) : '') + '</li>';
    });
    html += '</ol>' + goesHtml(plan);
    if (plan.steps.some(st => st.strand === 'day') && S.trip && P.trip(A, S, { place: (current && current.place) || '', until: plan.until }).near) hasAff = true;   // the tour searches
    // the safety line is its own dated step ("Before you go: stay safe"), and stays on the page above
    if (hasAff) html += '<p class="disclosure">' + esc(N.affiliate) + '</p>';
    if (mode === 'sample') { out.innerHTML = html; return; }
    if (mode === 'guest') {   // a plan saved in this browser before the paywall (or by a lapsed member): see it, keep it, remove it
      html += '<div class="pl-saved pl-ro"><p>' + esc(PP.saved_ro) + '</p><p><a href="/my-year/#' + plan.date.slice(0, 7) + '">See it with your other plans in My year</a></p>'
        + '<div class="pl-cal"><p class="pl-acts"><button type="button" class="btn btn-small" data-pl-ics>Add to my calendar</button></p><p class="meta">' + esc(N.cal_help) + '</p><p class="pl-calmsg" data-pl-calmsg role="status" aria-live="polite"></p></div>'
        + '<p class="pl-acts"><a class="btn btn-small" href="/account/">' + esc(PP.join) + '</a><button type="button" class="btn btn-small btn-ghost" data-pl-clear>Remove this plan</button></p></div>';
      out.innerHTML = html; return;
    }
    html += saved
      ? '<div class="pl-saved"><p><strong>Saved to your list ✓</strong> <a href="/list/#mine">See my list</a> · <a href="/my-year/#' + plan.date.slice(0, 7) + '">See it with your other plans in My year</a></p><p class="meta">' + esc(N.saved) + '</p>'
        + '<div class="pl-cal"><p class="pl-acts"><button type="button" class="btn btn-small" data-pl-ics>Add to my calendar</button></p><p class="meta">' + esc(N.cal_help) + '</p><p class="pl-calmsg" data-pl-calmsg role="status" aria-live="polite"></p></div>'
        + '<p class="pl-acts"><button type="button" class="btn btn-small btn-ghost" data-pl-change>' + (A.event ? 'Change the date or starting point' : 'Change the date') + '</button><button type="button" class="btn btn-small btn-ghost" data-pl-clear>Remove this plan</button></p></div>'
      : '<p class="pl-acts"><button type="button" class="btn" data-pl-save>Save this plan to my list</button></p><p class="meta">' + esc(N.saved) + '</p>';
    out.innerHTML = html;
  }
  function saveFile(text, name) {   // a download made in the browser: nothing is sent anywhere
    const u = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })), a = document.createElement('a');
    a.href = u; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }
  function focusHead() {
    const h = $('[data-pl-h]'); if (!h) return;
    h.focus({ preventScroll: true }); h.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- state ---------- */
  let current = null;   // the plan on screen and the choice it came from
  function make(when, madeOn, lv) { return P.build(A, S, Object.assign({ today: madeOn, level: lv }, when)); }
  // the engine's training for this activity, loaded only on pages that have some (dist/planner/training/<event>.json)
  const ready = A.event ? fetch('/planner/training/' + encodeURIComponent(A.event.id) + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { S.training = {}; S.training[A.event.id] = d; }).catch(() => {}) : Promise.resolve();
  function showSaved() {
    const it = L.get(id);
    if (!it || !(it.date || it.month) || !it.plan_made) return false;
    const when = it.date ? (it.until ? { date: it.date, until: it.until } : { date: it.date }) : { month: it.month };
    setWhen(when); setLevel(it.level); sug.textContent = '';
    const plan = make(when, it.plan_made, it.level);
    if (plan.status === 'ok') plan.steps = P.applyMarks(plan, it, S);   // the reader's ticks and moves from My year
    current = { when, level: it.level, plan, place: it.where || '' }; draw(current.plan, true); form.hidden = true;
    return true;
  }
  const guestBox = $('[data-pl-guest]'), checking = $('[data-pl-checking]');
  function reset() {
    if (!form) return;
    if (mode === 'guest') { form.hidden = true; if (guestBox) guestBox.hidden = false; return; }   // what Plus does, the price, the sample
    form.hidden = false; setWhen(suggestion());
  }
  function paintList() {   // the page's own "Add to my list" button, which list.js drew before the plan was saved
    const on = L.has(id);
    document.querySelectorAll('[data-fl-add="' + id + '"]').forEach(b => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'On my list ✓' : 'Add to my list'; });
    const ml = document.querySelector('[data-fl-minelink]'); if (ml) ml.hidden = !on;
  }

  if (form) form.addEventListener('submit', e => {
    e.preventDefault(); err.hidden = true;
    if (ro()) return;
    const when = by() === 'month' ? { month: monthSel.value } : { date: dateIn.value };
    if (when.date !== undefined && !P.parse(when.date)) { err.textContent = 'Choose a day, or pick "Some time in a month".'; err.hidden = false; dateIn.focus(); return; }
    if (spanOn()) {
      if (!P.okUntil(when.date, untilIn.value)) { err.textContent = N.span_err; err.hidden = false; untilIn.focus(); return; }
      when.until = untilIn.value;
    }
    const lv = A.event ? level() : '';
    const place = current ? current.place : ((L.get(id) || {}).where || '');   // a place already typed stays
    ready.then(() => { current = { when, level: lv, plan: make(when, today, lv), place }; draw(current.plan, false); focusHead(); });
  });
  out.addEventListener('click', e => {
    const use = e.target.closest('[data-pl-use]');
    if (use) { if (!form || ro()) return; setWhen({ date: use.dataset.plUse }); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); return; }
    if (ro() && (e.target.closest('[data-pl-save]') || e.target.closest('[data-pl-add]') || e.target.closest('[data-pl-change]') || e.target.closest('[data-pl-where-save]') || e.target.closest('[data-pl-where-change]'))) return;
    if (e.target.closest('[data-pl-save]') && current && current.plan.status === 'ok') { L.plan(id, Object.assign({ level: current.level }, current.when), today); if (current.place) L.where(id, current.place); showSaved(); paintList(); focusHead(); return; }
    if (e.target.closest('[data-pl-where-save]') && current) { const i = $('[data-pl-where-in]'); if (i && P.cleanPlace(i.value)) setPlace(i.value); else if (i) i.focus(); return; }
    if (e.target.closest('[data-pl-where-change]') && current) { current.editPlace = true; draw(current.plan, current.saved); const i = $('[data-pl-where-in]'); if (i) i.focus(); return; }
    if (e.target.closest('[data-pl-ics]') && current && current.plan.status === 'ok') {
      const p = current.plan, msg = $('[data-pl-calmsg]');
      const f = P.ics([{ id, cid: id, title: A.title, by_month: p.by_month, label: p.label, steps: p.steps }], S, { today, site: location.origin, name: 'My year: ' + A.title });
      if (!f.count) { msg.textContent = 'Nothing left to add: every step is done or has gone by.'; return; }
      saveFile(f.text, 'my-year-' + id + '.ics');
      msg.textContent = 'Calendar file saved, with ' + f.count + (f.count === 1 ? ' entry.' : ' entries.') + ' Open it to add them to your calendar.';
      return;
    }
    const add = e.target.closest('[data-pl-add]');
    if (add && current) {   // Add to my year (day 10): a plan of its own for that activity, on the date shown
      let w; try { w = JSON.parse(add.dataset.plWhen); } catch (x) { return; }
      const xid = add.dataset.plAdd;
      L.plan(xid, Object.assign({}, w, add.dataset.plWith ? { with: add.dataset.plWith } : {}), today);
      draw(current.plan, current.saved); paintList();
      const row = $$('[data-pl-x]').find(x => x.dataset.plX === xid), t = row && $('[data-pl-xt]', row); if (t) t.focus();
      return;
    }
    if (e.target.closest('[data-pl-change]')) { form.hidden = false; suggestion(); (by() === 'month' ? monthSel : dateIn).focus(); return; }
    if (e.target.closest('[data-pl-clear]')) {
      L.plan(id, null); paintList(); out.innerHTML = '<p role="status">Plan removed. The activity stays on your list.</p>'; current = null; reset();
      const r0 = mode === 'guest' ? null : radios.find(r => r.checked); if (r0) r0.focus();
    }
  });
  out.addEventListener('keydown', e => {   // Enter in the place box shows the links (it is not inside a form)
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-pl-where-in]')) { e.preventDefault(); if (P.cleanPlace(e.target.value)) setPlace(e.target.value); }
  });
  // A saved plan changes elsewhere (the list page in another tab): show the new one
  window.addEventListener('storage', ev => { if (!sample && mode !== 'pending' && ev.key === L.KEY && !showSaved()) { if (form && form.hidden) { out.innerHTML = ''; reset(); } } });

  /* ---------- Plan it yourself (Planner Plus day 15): the links only, free, nothing saved ---------- */
  const diyBox = $('[data-pl-diyd]'), diyOut = $('[data-pl-diyout]');
  let diyPlace = '';
  function diyHtml() {
    const T = S.trip || {}, d = P.diy(A, S, { place: diyPlace || ((L.get(id) || {}).where || ''), acts: X }), r = d.trip;
    let h = '', aff = false;
    const li = l => { if (l.aff) aff = true; return linkHtml(l, multi); }, multi = new Set(d.links.map(l => l.region)).size > 1;
    if (d.links.length) h += '<p class="pl-wkh">' + esc(PP.diy_book) + '</p><ul class="pl-links">' + d.links.map(li).join('') + '</ul>';
    h += '<p class="pl-wkh">' + esc(T.where_label) + '</p>';
    if (r.needs || (!r.sourced && diyPlace === null)) {
      h += '<div class="pl-where-ask"><label class="pl-whereq" for="pl-diy-where">' + esc(T.where_q) + '</label>'
        + '<input id="pl-diy-where" class="pl-wherein" type="text" maxlength="120" autocomplete="off" spellcheck="false" value="" data-pl-diy-in>'
        + (A.area ? '<p class="meta">' + esc(fill(T.where_hint, { area: A.area })) + '</p>' : '')
        + '<p class="meta">' + esc(PP.diy_place_help) + '</p>'
        + '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-diy-save>' + esc(T.where_save) + '</button></p></div>';
    } else {
      h += '<p class="pl-where" tabindex="-1" data-pl-diy-where>' + esc(r.label) + '</p>' + (r.note ? '<p class="pl-detail">' + esc(r.note) + '</p>' : '');
      if (r.source) h += '<p class="meta">' + esc(T.where_source).replace('{label}', '<a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>').replace('{checked}', esc(P.longDate(r.source.checked))) + '</p>';
      h += '<ul class="pl-links">' + r.where.map(li).join('') + '</ul>';
      if (!r.sourced) h += '<p class="pl-acts"><button type="button" class="btn btn-small btn-ghost" data-pl-diy-change>' + esc(T.where_change) + '</button></p>';
      h += '<p class="pl-wkh">' + esc(T.getting) + '</p><p class="meta">' + esc(r.help) + '</p><ul class="pl-links">' + r.getting.map(li).join('') + '</ul>';
      if (r.stay) r.stay.open = true;   // no dates here, so nothing to fold under "Staying the night?"
      h += stayEatHtml(r, T, li);
      if (r.near) h += '<p class="pl-wkh">' + esc(r.near.head) + '</p><p class="meta">' + esc(r.near.help) + '</p><ul class="pl-links">' + r.near.links.map(li).join('') + '</ul>';
    }
    const xs = list => '<ul class="pl-links">' + list.map(e => '<li><a href="' + esc(e.url) + '">' + esc(e.title) + '</a>' + (e.area ? '<span class="pl-lwhy">' + esc(fill(T.near_area, { area: e.area })) + '</span>' : '') + '</li>').join('') + '</ul>';
    if (d.nearby.length) h += '<p class="pl-wkh">' + esc(PP.diy_nearby) + '</p>' + xs(d.nearby);
    if (d.goes.length) h += '<p class="pl-wkh">' + esc(PP.diy_goes) + '</p>' + xs(d.goes);
    if (aff) h += '<p class="disclosure">' + esc(N.affiliate) + '</p>';
    return h;
  }
  function diyDraw(focus) {
    diyOut.innerHTML = diyHtml();
    if (focus === 'in') { const i = $('[data-pl-diy-in]'); if (i) i.focus(); }
    else if (focus) { const w = $('[data-pl-diy-where]'); if (w) w.focus(); }
  }
  function diySet(v) { const c = P.cleanPlace(v); if (!c) { const i = $('[data-pl-diy-in]'); if (i) i.focus(); return; } diyPlace = c; diyDraw(true); }
  if (diyBox && diyOut) {
    diyBox.addEventListener('toggle', () => { if (diyBox.open && !diyOut.innerHTML) diyDraw(); });
    diyOut.addEventListener('click', e => {
      if (e.target.closest('[data-pl-diy-save]')) { const i = $('[data-pl-diy-in]'); diySet(i ? i.value : ''); return; }
      if (e.target.closest('[data-pl-diy-change]')) { diyPlace = null; diyDraw('in'); }
    });
    diyOut.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-pl-diy-in]')) { e.preventDefault(); diySet(e.target.value); } });
  }

  box.hidden = false;
  const open = document.querySelector('[data-pl-open]'); if (open) { open.hidden = false; open.addEventListener('click', e => { e.preventDefault(); box.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); box.focus({ preventScroll: true }); try { history.replaceState(null, '', '#plan'); } catch (x) {} }); }
  if (sample) {   // the sample page: one fixed plan, as a member would see it
    ready.then(() => {
      const when = sample.until ? { date: sample.date, until: sample.until } : { date: sample.date };
      current = { when, level: sample.level || '', plan: make(when, sample.made, sample.level || ''), place: sample.place || '' };
      draw(current.plan, true);
    });
    return;
  }
  const gate = window.DDRPlus ? DDRPlus.access() : Promise.resolve('open');
  Promise.all([ready, gate]).then(([, m]) => {
    mode = m === 'guest' || m === 'member' ? m : 'open';
    if (checking) checking.hidden = true;
    if (!showSaved()) reset();
    if (location.hash === '#plan') box.scrollIntoView({ block: 'start' });
  });
})();

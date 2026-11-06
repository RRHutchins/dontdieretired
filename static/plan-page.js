/* My year: "Plan this" on an activity page (RUNBOOK §6s, day 3).
   The reader picks a day or a month; static/planner.js (DDRPlan) builds the steps; a saved plan is stored ONLY through
   static/list-store.js (DDRList.plan): the date or month and the day it was made. The steps are rebuilt from those, with
   today = the day it was made, so a saved plan does not shift. Every word shown comes from the activity's own fields
   or content/planner.yaml (in the page as #pl-data), and a plan's training sessions from the guidance engine
   (/planner/training/<event>.json, day 6), drawn a week at a time. Nothing leaves the browser. */
(function () {
  const P = window.DDRPlan, L = window.DDRList, box = document.querySelector('[data-pl]'), raw = document.getElementById('pl-data');
  if (!P || !L || !box || !raw) return;
  let data; try { data = JSON.parse(raw.textContent); } catch (e) { return; }
  const A = data.a, S = data.s, N = S.notes, id = A.id;
  const $ = (s, r = box) => r.querySelector(s), $$ = (s, r = box) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(), today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());   // the reader's own day
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = P.MONTHS.map(m => m.slice(0, 3));
  const dayText = s => { const d = P.parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
  const STRAND = { book: 'Book', learn: 'Get ready', train: 'Train', travel: 'Getting there', kit: 'Kit', safety: 'Stay safe', day: 'The day', after: 'Afterwards' };
  const AFF_REL = 'sponsored nofollow noopener', affUrl = (u, k) => (window.DDR && DDR.affUrl ? DDR.affUrl(u, k) : u);

  const form = $('[data-pl-form]'), out = $('[data-pl-out]'), err = $('[data-pl-err]');
  const dateIn = $('[data-pl-date]'), monthSel = $('[data-pl-month]'), sug = $('[data-pl-suggest]');
  const radios = $$('[data-pl-by]'), levels = $$('[data-pl-level]');
  const level = () => (levels.find(r => r.checked) || {}).value || 'active';
  const setLevel = v => { const lv = P.LEVELS.includes(v) ? v : 'active'; levels.forEach(r => { r.checked = r.value === lv; }); };

  // Months from this one, two years ahead
  const ty = now.getFullYear(), tm = now.getMonth();
  for (let i = 0; i < 25; i++) { const y = ty + Math.floor((tm + i) / 12), m = (tm + i) % 12; const o = document.createElement('option'); o.value = y + '-' + pad(m + 1); o.textContent = P.MONTHS[m] + ' ' + y; monthSel.appendChild(o); }
  dateIn.min = today;

  const by = () => (radios.find(r => r.checked) || {}).value || 'date';
  function setBy(v) {
    radios.forEach(r => { r.checked = r.value === v; });
    $('[data-pl-datewrap]').hidden = v !== 'date'; $('[data-pl-monthwrap]').hidden = v !== 'month';
  }
  radios.forEach(r => r.addEventListener('change', () => setBy(r.value)));
  function setWhen(w) {
    if (w.month) { if (![...monthSel.options].some(o => o.value === w.month)) { const o = document.createElement('option'); o.value = w.month; o.textContent = P.monthYear(w.month); monthSel.insertBefore(o, monthSel.firstChild); } monthSel.value = w.month; setBy('month'); }
    else { dateIn.value = w.date; setBy('date'); }
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
  const range = (a, b) => (a === b ? dayText(a) : dayText(a) + ' to ' + dayText(b));
  function sesHtml(st) {
    const gone = st.date < today && !st.done;
    return '<li class="pl-ses' + (st.done ? ' is-done' : '') + (gone ? ' is-gone' : '') + '"><p class="pl-date"><time datetime="' + st.date + '">' + esc(dayText(st.date)) + '</time>'
      + (st.done ? ' <span class="pl-tag">Done</span>' : '') + (gone ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
      + '<p class="pl-stext">' + esc(st.text) + '</p>' + (st.detail ? '<p class="pl-detail">' + esc(st.detail) + '</p>' : '')
      + '<p class="pl-why"><span>Why:</span> ' + esc(st.why) + '</p></li>';
  }
  function weekHtml(plan, w) {
    const tr = plan.train, wk = tr.list[w - 1], ss = plan.steps.filter(x => x.week === w), done = ss.filter(x => x.done).length;
    const gone = ss.every(x => x.date < today || x.done);
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

  function draw(plan, saved) {
    let html = '', hasAff = false;
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
    if (plan.fuller && !saved) html += '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-use="' + esc(plan.fuller) + '">Use ' + esc(P.longDate(plan.fuller)) + '</button></p>';
    if (plan.status === 'too_soon') html += '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-use="' + esc(plan.earliest) + '">Use ' + esc(P.longDate(plan.earliest)) + '</button></p>';
    if (plan.status !== 'ok') { out.innerHTML = html; return; }
    const multi = new Set(A.links.map(l => l.region)).size > 1;
    let month = '';
    const weeksDone = new Set();
    plan.steps.forEach(st => {
      if (st.week && weeksDone.has(st.week)) return;   // drawn with its week
      const m = st.date.slice(0, 7);
      if (m !== month) { html += (month ? '</ol>' : '') + '<h4 class="pl-month">' + esc(P.monthYear(m)) + '</h4><ol class="pl-steps">'; month = m; }
      if (st.week) { weeksDone.add(st.week); html += weekHtml(plan, st.week); return; }
      const gone = st.date < today;
      const links = st.links || [];
      if (links.some(l => l.aff) || (st.items || []).some(x => x.aff)) hasAff = true;
      html += '<li class="pl-step' + (st.strand === 'day' ? ' is-day' : '') + (gone && !st.done ? ' is-gone' : '') + (st.done ? ' is-done' : '') + '" data-strand="' + esc(st.strand) + '">'
        + '<p class="pl-date"><time datetime="' + st.date + '">' + esc(dayText(st.date)) + '</time> <span class="pl-tag">' + esc(STRAND[st.strand] || st.strand) + '</span>'
        + (st.done ? ' <span class="pl-tag">Done</span>' : '') + (st.moved ? ' <span class="pl-tag my-tag-moved">Moved</span>' : '') + (gone && !st.done ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
        + '<p class="pl-text">' + esc(st.text) + '</p>'
        + (st.detail ? '<p class="pl-detail">' + esc(st.detail) + '</p>' : '')
        + (links.length ? '<ul class="pl-links">' + links.map(l => linkHtml(l, multi)).join('') + '</ul>' : '')
        + ((st.items || []).length ? '<ul class="pl-links pl-kit">' + st.items.map(x => '<li><a href="' + esc(x.aff ? affUrl(x.url, x.aff) : x.url) + '" target="_blank" rel="' + (x.aff ? AFF_REL : 'noopener') + '">' + esc(x.name) + '</a><span class="pl-lwhy">' + esc(x.why) + '</span></li>').join('') + '</ul>' : '')
        + '<p class="pl-why"><span>Why then:</span> ' + esc(st.why) + '</p>'
        + (st.moved ? '<p class="pl-why my-moved">' + esc(st.moved.why) + '</p>' : '')
        + (st.id === 'train-start' && plan.train ? aboutHtml(plan.train) : '') + '</li>';
    });
    html += '</ol>';
    // the safety line is its own dated step ("Before you go: stay safe"), and stays on the page above
    if (hasAff) html += '<p class="disclosure">' + esc(N.affiliate) + '</p>';
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
    const when = it.date ? { date: it.date } : { month: it.month };
    setWhen(when); setLevel(it.level); sug.textContent = '';
    const plan = make(when, it.plan_made, it.level);
    if (plan.status === 'ok') plan.steps = P.applyMarks(plan, it, S);   // the reader's ticks and moves from My year
    current = { when, level: it.level, plan }; draw(current.plan, true); form.hidden = true;
    return true;
  }
  function reset() { form.hidden = false; setWhen(suggestion()); }
  function paintList() {   // the page's own "Add to my list" button, which list.js drew before the plan was saved
    const on = L.has(id);
    document.querySelectorAll('[data-fl-add="' + id + '"]').forEach(b => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'On my list ✓' : 'Add to my list'; });
    const ml = document.querySelector('[data-fl-minelink]'); if (ml) ml.hidden = !on;
  }

  form.addEventListener('submit', e => {
    e.preventDefault(); err.hidden = true;
    const when = by() === 'month' ? { month: monthSel.value } : { date: dateIn.value };
    if (when.date !== undefined && !P.parse(when.date)) { err.textContent = 'Choose a day, or pick "Some time in a month".'; err.hidden = false; dateIn.focus(); return; }
    const lv = A.event ? level() : '';
    ready.then(() => { current = { when, level: lv, plan: make(when, today, lv) }; draw(current.plan, false); focusHead(); });
  });
  out.addEventListener('click', e => {
    const use = e.target.closest('[data-pl-use]');
    if (use) { setWhen({ date: use.dataset.plUse }); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); return; }
    if (e.target.closest('[data-pl-save]') && current && current.plan.status === 'ok') { L.plan(id, Object.assign({ level: current.level }, current.when), today); showSaved(); paintList(); focusHead(); return; }
    if (e.target.closest('[data-pl-ics]') && current && current.plan.status === 'ok') {
      const p = current.plan, msg = $('[data-pl-calmsg]');
      const f = P.ics([{ id, cid: id, title: A.title, by_month: p.by_month, label: p.label, steps: p.steps }], S, { today, site: location.origin, name: 'My year: ' + A.title });
      if (!f.count) { msg.textContent = 'Nothing left to add: every step is done or has gone by.'; return; }
      saveFile(f.text, 'my-year-' + id + '.ics');
      msg.textContent = 'Calendar file saved, with ' + f.count + (f.count === 1 ? ' entry.' : ' entries.') + ' Open it to add them to your calendar.';
      return;
    }
    if (e.target.closest('[data-pl-change]')) { form.hidden = false; suggestion(); (by() === 'month' ? monthSel : dateIn).focus(); return; }
    if (e.target.closest('[data-pl-clear]')) {
      L.plan(id, null); paintList(); out.innerHTML = '<p role="status">Plan removed. The activity stays on your list.</p>'; current = null; reset();
      radios.find(r => r.checked).focus();
    }
  });
  // A saved plan changes elsewhere (the list page in another tab): show the new one
  window.addEventListener('storage', ev => { if (ev.key === L.KEY && !showSaved()) { if (form.hidden) { out.innerHTML = ''; reset(); } } });

  box.hidden = false;
  const open = document.querySelector('[data-pl-open]'); if (open) { open.hidden = false; open.addEventListener('click', e => { e.preventDefault(); box.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); box.focus({ preventScroll: true }); try { history.replaceState(null, '', '#plan'); } catch (x) {} }); }
  ready.then(() => {
    if (!showSaved()) reset();
    if (location.hash === '#plan') box.scrollIntoView({ block: 'start' });
  });
})();

/* My year: "Plan this" on an activity page (RUNBOOK §6s, day 3).
   The reader picks a day or a month; static/planner.js (DDRPlan) builds the steps; a saved plan is stored ONLY through
   static/list-store.js (DDRList.plan): the date or month and the day it was made. The steps are rebuilt from those, with
   today = the day it was made, so a saved plan does not shift. Every word shown comes from the activity's own fields
   or content/planner.yaml (in the page as #pl-data). Nothing leaves the browser. */
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
  const radios = $$('[data-pl-by]');

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
  function draw(plan, saved) {
    let html = '', hasAff = false;
    const notes = plan.notes.slice();
    if (saved) {
      const end = plan.by_month ? P.parse(plan.date.slice(0, 8) + '01') : P.parse(plan.date);
      if (plan.by_month) end.setUTCMonth(end.getUTCMonth() + 1, 0);
      if (end && end.toISOString().slice(0, 10) < today) notes.unshift(fill(N.saved_past, { date: plan.label }));
    }
    html += '<div class="pl-head"><h3 tabindex="-1" data-pl-h>' + (plan.status === 'ok' ? 'Your plan for ' + esc(plan.label) : esc(plan.label)) + '</h3>';
    if (plan.status === 'ok') html += '<p class="meta">' + plan.steps.length + ' steps, from ' + esc(P.longDate(plan.starts)) + '. Each one says why it comes when it does.</p>';
    html += '</div>';
    if (notes.length) html += '<ul class="pl-notes">' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    if (plan.status === 'too_soon') html += '<p class="pl-acts"><button type="button" class="btn btn-small" data-pl-use="' + esc(plan.earliest) + '">Use ' + esc(P.longDate(plan.earliest)) + '</button></p>';
    if (plan.status !== 'ok') { out.innerHTML = html; return; }
    const multi = new Set(A.links.map(l => l.region)).size > 1;
    let month = '';
    plan.steps.forEach(st => {
      const m = st.date.slice(0, 7);
      if (m !== month) { html += (month ? '</ol>' : '') + '<h4 class="pl-month">' + esc(P.monthYear(m)) + '</h4><ol class="pl-steps">'; month = m; }
      const gone = st.date < today;
      const links = st.links || [];
      if (links.some(l => l.aff) || (st.items || []).some(x => x.aff)) hasAff = true;
      html += '<li class="pl-step' + (st.strand === 'day' ? ' is-day' : '') + (gone ? ' is-gone' : '') + '" data-strand="' + esc(st.strand) + '">'
        + '<p class="pl-date"><time datetime="' + st.date + '">' + esc(dayText(st.date)) + '</time> <span class="pl-tag">' + esc(STRAND[st.strand] || st.strand) + '</span>' + (gone ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
        + '<p class="pl-text">' + esc(st.text) + '</p>'
        + (st.detail ? '<p class="pl-detail">' + esc(st.detail) + '</p>' : '')
        + (links.length ? '<ul class="pl-links">' + links.map(l => linkHtml(l, multi)).join('') + '</ul>' : '')
        + ((st.items || []).length ? '<ul class="pl-links pl-kit">' + st.items.map(x => '<li><a href="' + esc(x.aff ? affUrl(x.url, x.aff) : x.url) + '" target="_blank" rel="' + (x.aff ? AFF_REL : 'noopener') + '">' + esc(x.name) + '</a><span class="pl-lwhy">' + esc(x.why) + '</span></li>').join('') + '</ul>' : '')
        + '<p class="pl-why"><span>Why then:</span> ' + esc(st.why) + '</p></li>';
    });
    html += '</ol>';
    // the safety line is its own dated step ("Before you go: stay safe"), and stays on the page above
    if (hasAff) html += '<p class="disclosure">' + esc(N.affiliate) + '</p>';
    html += saved
      ? '<div class="pl-saved"><p><strong>Saved to your list ✓</strong> <a href="/list/#mine">See my list</a></p><p class="meta">' + esc(N.saved) + '</p>'
        + '<p class="pl-acts"><button type="button" class="btn btn-small btn-ghost" data-pl-change>Change the date</button><button type="button" class="btn btn-small btn-ghost" data-pl-clear>Remove this plan</button></p></div>'
      : '<p class="pl-acts"><button type="button" class="btn" data-pl-save>Save this plan to my list</button></p><p class="meta">' + esc(N.saved) + '</p>';
    out.innerHTML = html;
  }
  function focusHead() {
    const h = $('[data-pl-h]'); if (!h) return;
    h.focus({ preventScroll: true }); h.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- state ---------- */
  let current = null;   // the plan on screen and the choice it came from
  function make(when, madeOn) { return P.build(A, S, Object.assign({ today: madeOn }, when)); }
  function showSaved() {
    const it = L.get(id);
    if (!it || !(it.date || it.month) || !it.plan_made) return false;
    const when = it.date ? { date: it.date } : { month: it.month };
    setWhen(when); sug.textContent = '';
    current = { when, plan: make(when, it.plan_made) }; draw(current.plan, true); form.hidden = true;
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
    current = { when, plan: make(when, today) };
    draw(current.plan, false); focusHead();
  });
  out.addEventListener('click', e => {
    const use = e.target.closest('[data-pl-use]');
    if (use) { setWhen({ date: use.dataset.plUse }); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); return; }
    if (e.target.closest('[data-pl-save]') && current && current.plan.status === 'ok') { L.plan(id, current.when, today); showSaved(); paintList(); focusHead(); return; }
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
  if (!showSaved()) reset();
  if (location.hash === '#plan') box.scrollIntoView({ block: 'start' });
})();

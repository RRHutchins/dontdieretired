/* My year: every saved plan together (RUNBOOK §6s, day 4).
   Reads the reader's list ONLY through static/list-store.js (DDRList) and the planner data from /planner/activities.json;
   static/planner.js (DDRPlan.combine) rebuilds each saved plan, flags clashes and moves flexible steps, each with its reason.
   Ticks and the reader's own moves are saved through DDRList.tick / DDRList.shift. A plan's training sessions (from the
   guidance engine, /planner/training/<event>.json, day 6) are shown a week at a time, each with its own Done box. Every word of a plan comes from the
   activity's own fields or content/planner.yaml; the words around it (headings, buttons) are this page's. Nothing leaves
   the browser. */
(function () {
  const P = window.DDRPlan, L = window.DDRList, root = document.querySelector('[data-my]');
  if (!P || !L || !root) return;
  const $ = (s, r = root) => r.querySelector(s), $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(), today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()), thisMonth = today.slice(0, 7);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = P.MONTHS.map(m => m.slice(0, 3));
  const dayText = s => { const d = P.parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
  const daysText = s => (s.until ? dayText(s.date) + ' to ' + dayText(s.until) : dayText(s.date));   // a stay of more than one day
  const STRAND = { book: 'Book', learn: 'Get ready', train: 'Train', travel: 'Getting there', kit: 'Kit', safety: 'Stay safe', day: 'The day', after: 'Afterwards' };
  const AFF_REL = 'sponsored nofollow noopener', affUrl = (u, k) => (window.DDR && DDR.affUrl ? DDR.affUrl(u, k) : u);
  const addMonths = (m, n) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + n; return (y + Math.floor(mo / 12)) + '-' + pad(((mo % 12) + 12) % 12 + 1); };

  let S = null, byId = {}, view = 'year', month = thisMonth, all = null;

  /* ---------- put everything together ---------- */
  function gather() {
    const d = L.load(), live = L.live(d);
    const entries = live.filter(it => it.date || it.month).map(it => {
      const a = it.cid ? byId[it.cid] : null;
      return { id: it.id, title: it.cid ? (a ? a.title : null) : it.title, item: it, activity: a || null };
    }).filter(e => e.title);   // an activity we no longer list has no title to show; it stays on the list page
    all = P.combine(entries, S, { today });
    all.undated = live.filter(it => !it.date && !it.month && it.status !== 'done').length;
    all.items = Object.fromEntries(live.map(it => [it.id, it]));
  }
  const planOf = id => all.plans.find(p => p.id === id);
  const link = p => (p.cid ? '/list/' + encodeURIComponent(p.cid) + '/#plan' : '/list/#mine');

  /* ---------- the clashes box ---------- */
  function drawClashes() {
    const box = $('[data-my-clashes]');
    box.hidden = !all.clashes.length;
    $('[data-my-clash-list]').innerHTML = all.clashes.map(c => '<li>' + esc(c.text) + ' <span class="my-cl-links">'
      + c.ids.map(id => { const p = planOf(id); return '<a href="' + link(p) + '">Change the date for ' + esc(p.title) + '</a>'; }).join(' ') + '</span></li>').join('');
  }

  /* ---------- the year: one card per month ---------- */
  function months() {
    let last = addMonths(thisMonth, 11);
    all.plans.forEach(p => { const m = (p.date || p.month + '-01').slice(0, 7); if (m > last) last = m; });
    const out = []; for (let m = thisMonth; m <= last && out.length < 37; m = addMonths(m, 1)) out.push(m);
    return out;
  }
  function drawYear() {
    const clashDays = new Set(all.clashes.filter(c => c.kind === 'day').map(c => c.date));
    const overlaps = new Set([].concat(...all.clashes.filter(c => c.kind === 'span').map(c => c.ids)));
    $('[data-my-grid]').innerHTML = months().map(m => {
      const days = all.steps.filter(s => s.id === 'day' && s.date.slice(0, 7) === m);
      const inM = all.steps.filter(s => s.id !== 'day' && s.date.slice(0, 7) === m);
      const prep = inM.filter(s => !s.week), ses = inM.filter(s => s.week);
      const open = prep.filter(s => !s.done && s.date >= today).length, sopen = ses.filter(s => !s.done && s.date >= today).length;
      const things = days.map(s => {
        const p = planOf(s.pid);
        return '<li class="my-thing' + (p.status === 'done' ? ' is-done' : '') + '"><span class="my-when">' + (s.by_month ? 'Some time this month' : '<time datetime="' + s.date + '">' + esc(daysText(s)) + '</time>') + '</span> '
          + '<a href="' + link(p) + '">' + esc(p.title) + '</a>' + (p.status === 'done' ? ' <span class="pl-tag">Done</span>' : '') + (clashDays.has(s.date) && !s.by_month ? ' <span class="pl-tag my-tag-clash">Same day</span>' : overlaps.has(s.pid) && !s.by_month ? ' <span class="pl-tag my-tag-clash">Overlaps</span>' : '') + '</li>';
      }).join('');
      const label = P.monthYear(m);
      return '<li class="my-card' + (days.length ? ' has-day' : '') + '"><h3 class="h4">' + esc(label) + '</h3>'
        + (things ? '<ul class="my-things">' + things + '</ul>' : '<p class="meta">' + (inM.length ? 'Getting ready' : 'Nothing planned') + '</p>')
        + (prep.length ? '<p class="meta">' + prep.length + (prep.length === 1 ? ' step' : ' steps') + ' to get ready' + (open && open < prep.length ? ', ' + open + ' still to do' : '') + '</p>' : '')
        + (ses.length ? '<p class="meta">' + ses.length + (ses.length === 1 ? ' training session' : ' training sessions') + (sopen && sopen < ses.length ? ', ' + sopen + ' still to do' : '') + '</p>' : '')
        + (days.length || inM.length ? '<button type="button" class="chip my-open" data-my-goto="' + m + '">See ' + esc(P.MONTHS[+m.slice(5) - 1]) + '<span class="sr-only"> ' + m.slice(0, 4) + '</span></button>' : '')
        + '</li>';
    }).join('');
  }

  /* ---------- one month, every step ---------- */
  function linkHtml(l) {
    const aff = l.aff || null, reg = l.region === 'uk' ? ' <span class="fl-reg">UK</span>' : l.region === 'us' ? ' <span class="fl-reg">US</span>' : '';
    return '<li><a href="' + esc(aff ? affUrl(l.url, aff) : l.url) + '" target="_blank" rel="' + (aff ? AFF_REL : 'noopener') + '">' + esc(l.label) + '</a>' + reg + (l.why ? '<span class="pl-lwhy">' + esc(l.why) + '</span>' : '') + '</li>';
  }
  /* Where it is and getting there (Planner Plus day 8): opens from the day; the place is changed on the activity's plan page */
  function tripHtml(p, s) {
    const T = S.trip, a = p.cid ? byId[p.cid] : null; if (!T || !a) return '';
    const it = all.items[p.id] || {}, r = P.trip(a, S, Object.assign({ place: it.where || '', when: p.plan.label }, p.plan.until ? { from: P.longDate(p.plan.date), to: P.longDate(p.plan.until) } : {}));
    let h = '<details class="pl-trip my-trip"><summary>' + esc(T.head) + '</summary>';
    if (r.needs) return h + '<p class="meta"><a href="' + link(p) + '">' + esc(T.my_needs) + '</a></p></details>';
    h += '<p class="pl-where"><strong>' + esc(T.where_label) + ':</strong> ' + esc(r.label) + '</p>' + (r.note ? '<p class="pl-detail">' + esc(r.note) + '</p>' : '');
    if (r.source) h += '<p class="meta">' + esc(T.where_source).replace('{label}', '<a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + '</a>').replace('{checked}', esc(P.longDate(r.source.checked))) + '</p>';
    return h + '<ul class="pl-links">' + r.where.map(linkHtml).join('') + '</ul><p class="pl-wkh">' + esc(T.getting) + '</p><p class="meta">' + esc(r.help) + '</p><ul class="pl-links">' + r.getting.map(linkHtml).join('') + '</ul></details>';
  }
  function stepHtml(s, n) {
    const p = planOf(s.pid), gone = s.date < today && !s.done, uid = 'my-s' + n;
    if (s.bare) {
      return '<li class="pl-step is-day" data-strand="day"><p class="pl-date"><time datetime="' + s.date + '">' + esc(s.by_month ? 'Some time this month' : daysText(s)) + '</time> <span class="pl-tag">The day</span>' + (p.status === 'done' ? ' <span class="pl-tag">Done</span>' : '') + '</p>'
        + '<p class="pl-text">' + esc(s.text) + '</p>'
        + '<p class="pl-why">' + (p.cid ? 'No get-ready plan saved for this yet. <a href="' + link(p) + '">Plan this</a>' : 'One of your own, so there is no get-ready plan for it. <a href="/list/#mine">Change it on your list</a>') + '</p></li>';
    }
    // where it may move: judged from where the plan first put it, so a step moved once can still be moved again
    const w = s.done ? null : P.window(p.plan, Object.assign({}, s, { date: s.moved ? s.moved.from : s.date }), today) || P.window(p.plan, s, today);
    const after = (s.moved ? s.moved.from : s.date) > p.plan.date;
    const links = s.links || [], items = s.items || [];
    return '<li class="pl-step' + (s.strand === 'day' ? ' is-day' : '') + (gone ? ' is-gone' : '') + (s.done ? ' is-done' : '') + '" data-strand="' + esc(s.strand) + '" data-pid="' + esc(s.pid) + '" data-sid="' + esc(s.id) + '">'
      + '<p class="pl-date"><time datetime="' + s.date + '">' + esc(s.by_month && s.strand === 'day' ? 'Some time this month' : s.strand === 'day' ? daysText(s) : dayText(s.date)) + '</time> <span class="pl-tag">' + esc(STRAND[s.strand] || s.strand) + '</span>'
      + (s.moved ? ' <span class="pl-tag my-tag-moved">Moved</span>' : '') + (gone ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
      + (s.strand === 'day' ? '<p class="pl-text"><a href="' + link(p) + '">' + esc(s.text) + '</a></p>' : '<p class="my-for"><a href="' + link(p) + '">' + esc(p.title) + '</a></p><p class="pl-text">' + esc(s.text) + '</p>')
      + (s.detail ? '<p class="pl-detail">' + esc(s.detail) + '</p>' : '')
      + (links.length ? '<ul class="pl-links">' + links.map(linkHtml).join('') + '</ul>' : '')
      + (items.length ? '<ul class="pl-links pl-kit">' + items.map(x => '<li><a href="' + esc(x.aff ? affUrl(x.url, x.aff) : x.url) + '" target="_blank" rel="' + (x.aff ? AFF_REL : 'noopener') + '">' + esc(x.name) + '</a><span class="pl-lwhy">' + esc(x.why) + '</span></li>').join('') + '</ul>' : '')
      + (s.why ? '<p class="pl-why"><span>Why then:</span> ' + esc(s.why) + '</p>' : '')
      + (s.moved ? '<p class="pl-why my-moved">' + esc(s.moved.why) + '</p>' : '')
      + (s.strand === 'day' ? tripHtml(p, s) : '<div class="my-acts">'
        + '<label class="my-tick"><input type="checkbox" data-my-tick' + (s.done ? ' checked' : '') + '> Done</label>'
        + (w ? '<details class="my-move"><summary>Move this step</summary><div class="my-move-in"><label for="' + uid + '">Move to</label> <input type="date" id="' + uid + '" min="' + w.min + '" max="' + w.max + '" value="' + s.date + '" data-my-to> '
          + '<button type="button" class="btn btn-small" data-my-shift>Move</button>' + (s.moved && s.moved.by === 'you' ? ' <button type="button" class="btn btn-small btn-ghost" data-my-back>Put it back</button>' : '')
          + '<p class="meta">Between ' + esc(P.longDate(w.min)) + ' and ' + esc(P.longDate(w.max)) + ', so it stays ' + (after ? 'after the day.' : 'before the day.') + '</p></div></details>' : '')
        + '</div>')
      + '</li>';
  }
  /* the engine's training sessions (day 6): one block per plan and week, each session with its own Done box */
  function weekHtml(s, steps, n) {
    const p = planOf(s.pid), tr = p.plan.train, wk = tr.list[s.week - 1];
    const ss = steps.filter(x => x.pid === s.pid && x.week === s.week), done = ss.filter(x => x.done).length;
    const first = ss[0].date, last = ss[ss.length - 1].date;
    return '<li class="pl-step pl-week' + (done === ss.length ? ' is-done' : '') + '" data-strand="train">'
      + '<p class="pl-date"><time datetime="' + first + '">' + esc(first === last ? dayText(first) : dayText(first) + ' to ' + dayText(last)) + '</time> <span class="pl-tag">Train</span>'
      + (done ? ' <span class="pl-tag">' + done + ' of ' + ss.length + ' done</span>' : '') + '</p>'
      + '<p class="my-for"><a href="' + link(p) + '">' + esc(p.title) + '</a></p>'
      + '<p class="pl-text">' + esc(fill(S.notes.train_week, { w: s.week, weeks: tr.weeks, head: wk.head })) + '</p>'
      + '<p class="pl-detail">' + esc(wk.bullets[0]) + '</p>'
      + '<details class="pl-wk"' + (ss.some(x => x.date === today) ? ' open' : '') + '><summary>The ' + ss.length + (ss.length === 1 ? ' session' : ' sessions') + (wk.from.slice(0, 7) !== month || wk.to.slice(0, 7) !== month ? ' of this week in ' + P.MONTHS[+month.slice(5) - 1] : ' this week') + ', and why</summary><ol class="pl-sessions">'
      + ss.map(x => { const gone = x.date < today && !x.done; return '<li class="pl-ses' + (x.done ? ' is-done' : '') + (gone ? ' is-gone' : '') + '" data-pid="' + esc(x.pid) + '" data-sid="' + esc(x.id) + '">'
        + '<p class="pl-date"><time datetime="' + x.date + '">' + esc(dayText(x.date)) + '</time>' + (gone ? ' <span class="pl-tag pl-tag-gone">Gone by</span>' : '') + '</p>'
        + '<p class="pl-stext">' + esc(x.text) + '</p>' + (x.detail ? '<p class="pl-detail">' + esc(x.detail) + '</p>' : '')
        + '<p class="pl-why"><span>Why:</span> ' + esc(x.why) + '</p>'
        + '<div class="my-acts"><label class="my-tick"><input type="checkbox" data-my-tick' + (x.done ? ' checked' : '') + '> Done<span class="sr-only">: ' + esc(dayText(x.date) + ', ' + x.text) + '</span></label></div></li>'; }).join('')
      + '</ol>' + (wk.bullets.length > 1 ? '<p class="pl-wkh">Why this week looks like this</p><ul class="pl-wkwhy">' + wk.bullets.slice(1).map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '')
      + '</details></li>';
  }
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  function listHtml(steps, n0) {
    let n = n0; const seen = new Set();
    return steps.map(s => {
      if (s.week) { const k = s.pid + '|' + s.week; if (seen.has(k)) return ''; seen.add(k); return weekHtml(s, steps, n++); }
      return stepHtml(s, n++);
    }).join('');
  }
  function drawMonth(focus) {
    const ms = months(), first = all.steps.length && all.steps[0].date.slice(0, 7) < thisMonth ? all.steps[0].date.slice(0, 7) : thisMonth, last = ms[ms.length - 1];
    if (month < first) month = first; if (month > last) month = last;
    $('[data-my-mtitle]').textContent = P.monthYear(month);
    const prev = addMonths(month, -1), next = addMonths(month, 1), bp = $('[data-my-step="-1"]'), bn = $('[data-my-step="1"]');
    bp.hidden = prev < first; bn.hidden = next > last;
    $('[data-my-prev]').textContent = P.MONTHS[+prev.slice(5) - 1]; $('[data-my-next]').textContent = P.MONTHS[+next.slice(5) - 1];
    const steps = all.steps.filter(s => s.date.slice(0, 7) === month);
    // a month plan's "day" is the month itself, so it heads the month rather than sitting on the 1st
    const head = steps.filter(s => s.strand === 'day' && s.by_month), rest = steps.filter(s => !(s.strand === 'day' && s.by_month));
    let html = '', n = 0;
    if (head.length) html += '<h3 class="pl-month">Some time this month</h3><ol class="pl-steps">' + head.map(s => stepHtml(s, n++)).join('') + '</ol>';
    if (rest.length) html += (head.length ? '<h3 class="pl-month">Day by day</h3>' : '') + '<ol class="pl-steps">' + listHtml(rest, n) + '</ol>';
    if (!steps.length) html = '<p class="meta">Nothing planned this month.</p>';
    $('[data-my-mbody]').innerHTML = html;
    if (focus) { const sec = $('[data-my-month]'); sec.focus({ preventScroll: true }); sec.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); }
  }

  /* ---------- the whole page ---------- */
  function draw(focus) {
    gather();
    root.removeAttribute('aria-busy'); $('[data-my-loading]').hidden = true;
    const any = all.plans.length > 0;
    $('[data-my-empty]').hidden = any; $('[data-my-main]').hidden = !any;
    if (!any) return;
    drawClashes();
    $$('[data-my-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.myView === view)));
    $('[data-my-year]').hidden = view !== 'year'; $('[data-my-month]').hidden = view !== 'month';
    if (view === 'year') drawYear(); else drawMonth(focus);
    const u = $('[data-my-undated]');
    u.hidden = !all.undated; u.innerHTML = all.undated ? (all.undated === 1 ? 'One more thing on <a href="/list/#mine">your list</a> has no date yet.' : all.undated + ' more things on <a href="/list/#mine">your list</a> have no date yet.') + ' Give one a day or a month with Plan this on its page.' : '';
    const aff = all.steps.some(s => (s.links || []).some(l => l.aff) || (s.items || []).some(x => x.aff));
    const ad = $('[data-my-aff]'); ad.hidden = !(aff && view === 'month'); ad.textContent = S.notes.affiliate;
    $('[data-my-saved]').textContent = S.notes.saved;
    $('[data-my-calhelp]').textContent = S.notes.cal_help;
  }
  /* ---------- Add to my calendar (day 5): every plan still to come, as this page shows it (moves included) ---------- */
  function saveCalendar() {
    gather();
    const msg = $('[data-my-calmsg]');
    const groups = all.plans.filter(p => p.status !== 'done').map(p => ({ id: p.id, cid: p.cid, title: p.title, by_month: !p.date, label: p.label,
      steps: all.steps.filter(s => s.pid === p.id) }));
    const f = P.ics(groups, S, { today, site: location.origin, name: 'My year' });
    if (!f.count) { msg.textContent = 'Nothing left to add: every step is done or has gone by.'; return; }
    const u = URL.createObjectURL(new Blob([f.text], { type: 'text/calendar;charset=utf-8' })), a = document.createElement('a');
    a.href = u; a.download = 'my-year.ics'; a.hidden = true; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
    msg.textContent = 'Calendar file saved, with ' + f.count + (f.count === 1 ? ' entry' : ' entries') + ' from ' + groups.length + (groups.length === 1 ? ' plan.' : ' plans.') + ' Open it to add them to your calendar.';
  }
  function setHash() { try { history.replaceState(null, '', view === 'month' ? '#' + month : '#year'); } catch (e) {} }
  const say = t => { const m = $('[data-my-msg]'); m.textContent = ''; setTimeout(() => { m.textContent = t; }, 30); };

  root.addEventListener('click', e => {
    const v = e.target.closest('[data-my-view]');
    if (v) { view = v.dataset.myView; draw(); setHash(); return; }
    const g = e.target.closest('[data-my-goto]');
    if (g) { view = 'month'; month = g.dataset.myGoto; draw(true); setHash(); return; }
    const st = e.target.closest('[data-my-step]');
    if (st) { month = addMonths(month, +st.dataset.myStep); draw(); setHash(); if (st.hidden) $('[data-my-month]').focus({ preventScroll: true }); return; }
    if (e.target.closest('[data-my-ics]')) { saveCalendar(); return; }
    const li = e.target.closest('[data-sid]'); if (!li) return;
    const pid = li.dataset.pid, sid = li.dataset.sid;
    if (e.target.closest('[data-my-shift]')) {
      const to = $('[data-my-to]', li).value, inp = $('[data-my-to]', li);
      if (!P.parse(to) || to < inp.min || to > inp.max) { say('Choose a day between ' + P.longDate(inp.min) + ' and ' + P.longDate(inp.max) + '.'); inp.focus(); return; }
      L.shift(pid, sid, to); month = to.slice(0, 7); draw(); setHash(); say('Moved to ' + P.longDate(to) + '.');
      const back = $$('[data-sid]').find(x => x.dataset.pid === pid && x.dataset.sid === sid);
      if (back) { const t = $('.pl-text', back); t.setAttribute('tabindex', '-1'); t.focus(); }
      return;
    }
    if (e.target.closest('[data-my-back]')) {
      L.shift(pid, sid, ''); draw(); say('Put back where the plan had it.');
    }
  });
  root.addEventListener('change', e => {
    if (!e.target.matches('[data-my-tick]')) return;
    const li = e.target.closest('[data-sid]'), done = e.target.checked;
    L.tick(li.dataset.pid, li.dataset.sid, done);
    li.classList.toggle('is-done', done);   // no full redraw, so keyboard focus stays on the box
    gather(); say(done ? 'Ticked off.' : 'Not done yet.');
  });
  // A plan changed in another tab (an activity page, the list): redraw
  window.addEventListener('storage', ev => { if (ev.key === L.KEY && S) draw(); });

  const h = location.hash.slice(1);
  if (/^\d{4}-\d{2}$/.test(h)) { view = 'month'; month = h; }
  fetch('/planner/activities.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
    S = d; d.activities.forEach(a => { byId[a.id] = a; });
    // the engine's training (day 6), only for the events in the reader's saved plans; without it a plan shows when to start
    const evs = [...new Set(L.live(L.load()).filter(it => it.cid && it.plan_made && byId[it.cid] && byId[it.cid].event).map(it => byId[it.cid].event.id))];
    S.training = {};
    return Promise.all(evs.map(e => fetch('/planner/training/' + encodeURIComponent(e) + '.json').then(r => (r.ok ? r.json() : null)).then(x => { if (x) S.training[e] = x; }).catch(() => {})))
      .then(() => draw());
  }).catch(() => { root.removeAttribute('aria-busy'); $('[data-my-loading]').hidden = true; $('[data-my-fail]').hidden = false; });
})();

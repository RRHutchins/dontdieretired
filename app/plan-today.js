/* The app's Today card for the planner (RUNBOOK §6t row 18, 27 Nov 2026).
   What is due this week from the plans in Planner (My year): the steps dated today, the rest of the week, how many
   earlier steps are not ticked off, and the next day planned. Reads the list ONLY through static/list-store.js (DDRList);
   the plans are rebuilt exactly as My year does it (DDRPlan.combine, then DDRPlan.upcoming), from /planner/activities.json,
   which is fetched only when this device has something with a date on it. Ticking a step off goes through DDRList.tick,
   as on My year, and only for Planner Plus members (DDRPlus.access(): 'member', or 'open' before the paywall); anyone
   else sees the steps read-only, with Planner Plus's own words. Step words are the plan's own; nothing is reworded,
   and no affiliate links are shown here (the steps' links are on My year, with the disclosure). */
(function () {
  const L = window.DDRList, P = window.DDRPlan;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STRAND = { book: 'Book', learn: 'Get ready', train: 'Train', travel: 'Getting there', kit: 'Kit', safety: 'Stay safe', day: 'The day', after: 'Afterwards' };
  const SHOW = 5;   // steps on the card; the rest are on My year
  let S = null, loading = null, byId = {};

  function dated() { try { return L.live(L.load()).filter(it => it.date || it.month); } catch (e) { return []; } }
  function data() {
    if (S) return Promise.resolve(S);
    if (loading) return loading;
    loading = fetch('/planner/activities.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
      d.activities.forEach(a => { byId[a.id] = a; });
      d.training = {};
      const evs = [...new Set(dated().filter(it => it.cid && it.plan_made && byId[it.cid] && byId[it.cid].event).map(it => byId[it.cid].event.id))];
      return Promise.all(evs.map(e => fetch('/planner/training/' + encodeURIComponent(e) + '.json').then(r => (r.ok ? r.json() : null)).then(x => { if (x) d.training[e] = x; }).catch(() => {})))
        .then(() => { S = d; return d; });
    }).catch(e => { loading = null; throw e; });
    return loading;
  }
  const dayText = (s, today) => {
    if (s === today) return 'Today';
    const d = P.parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + P.MONTHS[d.getUTCMonth()].slice(0, 3);
  };
  const planLink = p => (p && p.cid ? '/list/' + encodeURIComponent(p.cid) + '/' : '/list/#mine');

  // with nothing dated, the card stays out of the way: a tile lower down, beside My list ([data-plan-later]), not at the top
  const laterBox = () => document.querySelector('[data-plan-later]');
  function empty(box) {
    const t = laterBox() || box; if (t !== box) box.innerHTML = '';
    t.innerHTML = '<a class="tile tile-plan" href="/my-year/"><p class="kick">Planner</p><h3>Your year, a week at a time</h3>'
      + '<p class="muted">With Planner Plus, give something on Things to do a date, and the steps to get ready for it show here each week. Opens Planner (needs a connection).</p>'
      + '<p class="muted pt-ios">On an iPhone, this home-screen app keeps its own list, separate from Safari’s.</p></a>';
  }

  function stepHtml(s, all, today, ro) {
    const p = all.plans.find(x => x.id === s.pid);
    return '<li class="pt-step" data-pid="' + esc(s.pid) + '" data-sid="' + esc(s.id) + '">'
      + '<p class="pt-when"><time datetime="' + s.date + '">' + esc(dayText(s.date, today)) + '</time> <span class="tag">' + esc(STRAND[s.strand] || s.strand) + '</span></p>'
      + '<p class="pt-for"><a href="' + planLink(p) + '">' + esc(p ? p.title : s.ptitle) + '</a></p>'
      + '<p class="pt-text">' + esc(s.text) + '</p>'
      + (s.detail ? '<p class="muted pt-detail">' + esc(s.detail) + '</p>' : '')
      + ((s.links || []).length || (s.items || []).length || s.picks ? '<a class="pt-more" href="/my-year/#' + s.date + '">The links for this step, in Planner</a>' : '')
      + (ro ? '' : '<label class="pt-tick"><input type="checkbox" data-pt-tick> Done<span class="sr-only">: ' + esc(s.text) + '</span></label>')
      + '</li>';
  }

  function draw(box, mode) {
    const today = localToday(), ro = mode === 'guest';
    const entries = dated().map(it => {
      const a = it.cid ? byId[it.cid] : null;
      return { id: it.id, title: it.cid ? (a ? a.title : null) : it.title, item: it, activity: a || null };
    }).filter(e => e.title);
    if (!entries.length) { empty(box); return; }
    const lb = laterBox(); if (lb) lb.innerHTML = '';
    const all = P.combine(entries, S, { today }), u = P.upcoming(all, { today });
    const due = u.now.concat(u.soon), shown = due.slice(0, SHOW);
    const np = u.next ? all.plans.find(x => x.id === u.next.pid) : null;
    const later = due.length ? null : all.steps.find(s => s.strand !== 'day' && !s.bare && !s.done && s.date > today && !all.plans.some(p => p.id === s.pid && p.status === 'done'));
    let h = '<div class="card pt"><p class="kick">Planner</p><h3 id="pt-h">' + (u.now.length ? 'Today and this week' : 'This week') + '</h3>';
    if (np) h += '<p class="pt-next"><span class="muted">Next in your year:</span> <a href="' + planLink(np) + '">' + esc(np.title) + '</a>, ' + esc(u.next.by_month ? 'some time in ' + P.monthYear(u.next.date.slice(0, 7)) : np.label) + '</p>';
    if (shown.length) h += '<ul class="pt-steps" aria-labelledby="pt-h">' + shown.map(s => stepHtml(s, all, today, ro)).join('') + '</ul>'
      + (due.length > SHOW ? '<p class="muted">' + (due.length - SHOW) + ' more this week in Planner.</p>' : '');
    else h += '<p>Nothing to get ready this week.' + (later ? ' The next step is on ' + esc(P.longDate(later.date)) + ': ' + esc(later.text) : '') + '</p>';
    if (u.late) h += '<p class="pt-late">' + u.late + (u.late === 1 ? ' earlier step is' : ' earlier steps are') + ' not ticked off yet.</p>';
    if (ro && S.plus && S.plus.my_ro) h += '<p class="muted">' + esc(S.plus.my_ro) + ' <a href="/planner-plus/">Planner Plus</a></p>';
    h += '<a class="btn ghost small" href="/my-year/">Open Planner</a><p class="muted pt-net">Planner opens on the website and needs a connection.</p></div>';
    box.innerHTML = h;
  }

  function fill(box) {
    if (!box) return;
    if (!L || !P) { box.innerHTML = ''; return; }
    if (!dated().length) { empty(box); return; }
    box.innerHTML = '<div class="card pt"><p class="kick">Planner</p><p class="muted" role="status">Getting this week’s steps…</p></div>';
    data().then(() => (window.DDRPlus ? DDRPlus.access() : 'open')).then(mode => {
      if (!box.isConnected) return;
      box.dataset.mode = mode;
      draw(box, mode);
    }).catch(() => {
      if (!box.isConnected) return;
      box.innerHTML = '<div class="card pt"><p class="kick">Planner</p><p>This week’s steps could not be loaded. They need a connection the first time.</p><a class="btn ghost small" href="/my-year/">Open Planner</a></div>';
    });
  }

  document.addEventListener('change', e => {
    if (!e.target.matches || !e.target.matches('[data-pt-tick]')) return;
    const box = e.target.closest('[data-plan-today]'), li = e.target.closest('[data-sid]');
    if (!box || !li || box.dataset.mode === 'guest') return;
    L.tick(li.dataset.pid, li.dataset.sid, e.target.checked);
    const say = document.createElement('p'); say.className = 'sr-only'; say.setAttribute('role', 'status');
    draw(box, box.dataset.mode);
    say.textContent = e.target.checked ? 'Ticked off.' : 'Not done yet.'; box.appendChild(say);
    const h = box.querySelector('#pt-h'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  });
  // the list changed in another tab, or the account sync brought plans from another device
  window.addEventListener('storage', ev => { if (L && ev.key === L.KEY) { const b = document.querySelector('[data-plan-today]'); if (b) { if (S) { if (dated().length) draw(b, b.dataset.mode || 'guest'); else empty(b); } else fill(b); } } });

  window.DDRAppPlan = { fill };
})();

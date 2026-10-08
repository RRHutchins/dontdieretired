/* Fifty at Fifty (RUNBOOK §6h): the catalogue page, the reader's own list, and the challenge pages.
   The list itself is read and written ONLY through DDRList (static/list-store.js).
   Nothing here leaves the browser except anonymous Plausible events (never a note or an own-challenge title). */
(function () {
  const L = window.DDRList; if (!L) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const track = (name, props) => { if (window.plausible) window.plausible(name, { props }); };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = { want: 'Want to', planned: 'Planned', doing: 'Doing', done: 'Done' };
  const count = () => { const l = L.live(L.load()); return { n: l.length, done: l.filter(i => i.status === 'done').length }; };

  /* ---------- "Add to my list" buttons (catalogue cards, challenge pages, invite line) ---------- */
  function paintAdds() {
    $$('[data-fl-add]').forEach(b => {
      const on = L.has(b.dataset.flAdd);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'On my list ✓' : 'Add to my list';
    });
    const ml = $('[data-fl-minelink]'), pg = $('[data-fl-challenge]');
    if (ml && pg) ml.hidden = !L.has(pg.dataset.flChallenge);
    const c = count();
    $$('[data-fl-n]').forEach(e => { e.textContent = c.n ? '(' + c.n + ')' : ''; });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-fl-add]'); if (!b) return;
    const id = b.dataset.flAdd;
    if (L.has(id)) { if ($('[data-fl]')) showView('mine'); else location.href = '/list/#mine'; return; }
    L.add(id); track('list_add', { id, from: b.closest('[data-fl-invited]') ? 'invite' : b.closest('[data-fl-suggest]') ? 'suggestion' : $('[data-fl]') ? 'catalogue' : 'challenge' });
    paintAdds(); if (root) { renderMine(); renderSuggest(); }
  });

  /* ---------- challenge page: invite a friend, and the line a friend sees ---------- */
  const page = $('[data-fl-challenge]');
  if (page) {
    const id = page.dataset.flChallenge, qs = new URLSearchParams(location.search);
    const inv = $('[data-fl-invited]', page);
    if (qs.get('do') === id && inv) {
      inv.hidden = false;   // one slim line in the page flow; never blocks reading
      $('[data-fl-invited-close]', inv).addEventListener('click', () => { inv.hidden = true; });
      qs.delete('do'); qs.delete('via');
      try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch (e) {}
      track('list_invite_arrival', { id });
    }
    const ib = $('[data-fl-invite]', page), msg = $('[data-fl-invite-msg]', page);
    if (ib) ib.addEventListener('click', async () => {
      const url = ib.dataset.url, title = 'Fancy doing this with me? ' + page.dataset.title;
      if (navigator.share) { try { await navigator.share({ title, text: title, url }); track('list_invite', { id, via: 'device' }); } catch (e) {} return; }
      let ok = false;
      try { await navigator.clipboard.writeText(title + ' ' + url); ok = true; } catch (e) {
        try { const t = document.createElement('textarea'); t.value = title + ' ' + url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e2) {}
      }
      msg.textContent = ok ? 'Invite copied. Paste it into a message to your friend.' : 'Could not copy. Share this page with the Share button instead.';
      if (ok) track('list_invite', { id, via: 'copy' });
    });
    $$('[data-fl-out]', page).forEach(a => a.addEventListener('click', () => track('list_link', { id })));
  }

  /* ---------- home page and anywhere else: a quiet progress badge ---------- */
  $$('[data-fl-badge]').forEach(el => { const c = count(), d = L.load(); if (c.n) { el.textContent = c.done ? c.done + ' of ' + d.target + ' done' : c.n + ' on your list'; el.hidden = false; } });

  const root = $('[data-fl]');
  if (!root) { paintAdds(); return; }

  /* ================= the /list/ page ================= */
  const items = $$('.fl-item', root);
  const cat = {}; items.forEach(li => { cat[li.dataset.id] = li; });
  const titleOf = it => it.cid ? (cat[it.cid] ? cat[it.cid].dataset.title : null) : it.title;

  /* ---------- views ---------- */
  function showView(v) {
    $$('[data-fl-view]', root).forEach(s => { s.hidden = s.dataset.flView !== v; });
    $$('.fl-tab', root).forEach(t => t.setAttribute('aria-selected', String(t.dataset.flTab === v)));
    try { history.replaceState(null, '', v === 'mine' ? '#mine' : location.pathname + location.search); } catch (e) {}
    if (v === 'mine') { renderMine(); active(); }
  }
  root.addEventListener('click', e => { const t = e.target.closest('[data-fl-tab]'); if (t) { showView(t.dataset.flTab); if (!t.classList.contains('fl-tab')) window.scrollTo({ top: root.offsetTop - 80 }); } });

  /* ---------- region: time zone only, as elsewhere on the site ---------- */
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const region = /^Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)$/.test(tz) ? 'uk'
    : (/^(America\/(New_York|Detroit|Chicago|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Menominee|Indiana|Kentucky|North_Dakota)|Pacific\/Honolulu|US\/)/.test(tz) ? 'us' : '');
  const inRegion = (li, r) => !r || (r === 'anywhere' ? li.dataset.regions === 'anywhere' : (' ' + li.dataset.regions + ' ').includes(' ' + r + ' ') || li.dataset.regions === 'anywhere');

  /* ---------- search and filters ---------- */
  const q = $('[data-fl-q]', root), sels = $$('[data-fl-f]', root), countEl = $('[data-fl-count]', root), none = $('[data-fl-none]', root), clear = $('[data-fl-clear]', root);
  const regSel = sels.find(s => s.dataset.flF === 'region');
  try { const tp = new URLSearchParams(location.search).get('topic'), cs = sels.find(s => s.dataset.flF === 'category'); if (tp && cs && [...cs.options].some(o => o.value === tp)) cs.value = tp; } catch (e) {}   // /list/?topic=move arrives with that topic chosen
  if (region) regSel.value = region;   // start with what can be done from where the reader is; one tap shows everything
  function matches(li) {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(w => li.dataset.text.includes(w))) return false;
    return sels.every(s => {
      const k = s.dataset.flF, v = s.value; if (!v) return true;
      if (k === 'region') return inRegion(li, v);
      if (k === 'setting' || k === 'company') return li.dataset[k] === v || li.dataset[k] === 'either';
      return li.dataset[k] === v;
    });
  }
  function filter() {
    let n = 0; items.forEach(li => { const m = matches(li); li.hidden = !m; if (m) n++; li.classList.remove('fl-picked'); });
    const filtered = q.value.trim() || sels.some(s => s.value);
    countEl.textContent = n === items.length ? 'All ' + n + ' activities' : 'Showing ' + n + ' of ' + items.length + ' activities' + (regSel.value === region && region && !q.value.trim() && sels.every(s => s === regSel || !s.value) ? ' (the ones you can do from the ' + region.toUpperCase() + ')' : '');
    none.hidden = n > 0; clear.hidden = !filtered;
    return n;
  }
  const reset = () => { q.value = ''; sels.forEach(s => { s.value = ''; }); filter(); };
  q.addEventListener('input', filter); sels.forEach(s => s.addEventListener('change', filter));
  clear.addEventListener('click', reset); $('[data-fl-clear2]', root).addEventListener('click', reset);
  $('[data-fl-surprise]', root).addEventListener('click', () => {
    let pool = items.filter(li => !li.hidden && !L.has(li.dataset.id));
    if (!pool.length) pool = items.filter(li => !li.hidden);
    if (!pool.length) return;
    const li = pool[Math.floor(Math.random() * pool.length)];
    items.forEach(x => x.classList.remove('fl-picked')); li.classList.add('fl-picked');
    li.scrollIntoView({ behavior: 'smooth', block: 'center' }); const a = $('a', li); if (a) a.focus({ preventScroll: true });
    track('list_surprise', { id: li.dataset.id });
  });

  /* ---------- suggestions from the profile the reader has already given (never asked for here) ---------- */
  const profile = () => {
    let p = {}; try { p = JSON.parse(localStorage.getItem('ddr_profile') || '{}'); } catch (e) {}
    try { p.interests = JSON.parse(localStorage.getItem('ddr_interests') || '[]'); } catch (e) { p.interests = []; }
    return p;
  };
  const FIT = { starter: { gentle: 3, moderate: 0, demanding: -5 }, active: { gentle: 1, moderate: 3, demanding: 1 }, advanced: { gentle: -2, moderate: 1, demanding: 3 } };
  const LEVEL_WHY = { starter: 'A gentle way in', active: 'A good fit for someone already active', advanced: 'A proper challenge' };
  const catLabel = li => $('.kicker', li).textContent.split(' · ')[0];
  let turn = 0;
  function renderSuggest() {
    const box = $('[data-fl-suggest]', root), ask = $('[data-fl-ask]', root), p = profile();
    const ints = p.interests || [], lvl = FIT[p.level] ? p.level : '';
    if (!ints.length && !lvl) { box.hidden = true; ask.hidden = false; return; }
    ask.hidden = true;
    const pool = items.filter(li => inRegion(li, region) && !L.has(li.dataset.id));
    const score = li => (lvl ? FIT[lvl][li.dataset.effort] : 0);
    const by = arr => arr.map((li, i) => [score(li), i, li]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[2]);
    const rot = (arr, n) => { if (arr.length <= n) return arr; const s = (turn * n) % arr.length; return arr.slice(s).concat(arr.slice(0, s)).slice(0, n); };
    // spread the picks across the reader's interests rather than six from one topic
    let mine = [];
    if (ints.length) {
      const groups = ints.map(c => by(pool.filter(li => li.dataset.category === c && score(li) >= 0))).filter(g => g.length);
      for (let r = 0; mine.length < 40 && groups.some(g => g[r]); r++) groups.forEach(g => { if (g[r]) mine.push(g[r]); });
    } else mine = by(pool.filter(li => score(li) > 0));
    const picks = rot(mine, 4);
    const stretch = ints.length ? rot(by(pool.filter(li => !ints.includes(li.dataset.category) && score(li) >= 0)), 2) : [];
    if (!picks.length && !stretch.length) { box.hidden = true; return; }
    const why = li => ints.includes(li.dataset.category) ? 'Because you picked ' + catLabel(li) + (lvl && FIT[lvl][li.dataset.effort] === 3 ? '. ' + LEVEL_WHY[lvl] : '') : LEVEL_WHY[lvl] || '';
    const cardOf = (li, reason) => '<li><p class="kicker">' + esc(reason) + '</p><h3><a href="/list/' + li.dataset.id + '/">' + esc(li.dataset.title) + '</a></h3><p class="fl-meta">' + esc($('.fl-meta', li).textContent) + '</p><button type="button" class="chip fl-add" data-fl-add="' + li.dataset.id + '" aria-pressed="false">Add to my list</button></li>';
    box.innerHTML = '<div class="fl-suggest-head"><h2>Suggested for you</h2><p class="meta">From the interests and starting point you gave us. <button type="button" class="linklike" data-open-segments2>Change them</button></p></div><ul class="fl-grid">'
      + picks.map(li => cardOf(li, why(li))).join('') + stretch.map(li => cardOf(li, 'Something different: ' + catLabel(li))).join('')
      + '</ul>' + (mine.length > 4 ? '<p><button type="button" class="linklike" data-fl-more>Show me different ones</button></p>' : '');
    box.hidden = false; paintAdds();
  }
  root.addEventListener('click', e => {
    if (e.target.closest('[data-fl-more]')) { turn++; renderSuggest(); }
    if (e.target.closest('[data-open-segments2]')) { if (window.DDR && DDR.openProfile) DDR.openProfile(); }
  });
  // when the reader finishes or skips the profile questions, refresh the suggestions
  document.addEventListener('click', e => { if (e.target.closest('[data-profile-done],[data-close-segments]')) setTimeout(renderSuggest, 50); });

  /* ---------- my list ---------- */
  const rows = $('[data-fl-rows]', root), prog = $('[data-fl-progress]', root), kind = $('[data-fl-kind]', root), toolmsg = $('[data-fl-toolmsg]', root);
  const KIND = n => n === 1 ? 'First one done. That is how every list starts.' : n === 5 ? 'Five done. You are properly under way.' : n === 10 ? 'Ten done. Most people never write the list, never mind this.' : n === 25 ? 'Twenty-five. That is a lot of living.' : '';
  function renderHead() {
    const d = L.load(), c = count();
    $$('[data-fl-title]').forEach(e => { e.textContent = d.title; });
    prog.innerHTML = c.n ? '<p><strong>' + c.done + ' of ' + d.target + ' done</strong><span class="meta"> · ' + c.n + ' on your list</span></p><div class="fl-bar" role="img" aria-label="' + c.done + ' of ' + d.target + ' done"><i style="width:' + Math.min(100, Math.round(c.done / d.target * 100)) + '%"></i></div>' : '';
    $('[data-fl-empty]', root).hidden = c.n > 0;
    const nm = $('[data-fl-name]', root), tg = $('[data-fl-target]', root);
    if (document.activeElement !== nm) nm.value = d.title; if (document.activeElement !== tg) tg.value = d.target;
    const rem = $('[data-fl-remind]', root), last = L.flag('backup_at'), closed = L.flag('remind_closed');
    rem.hidden = !(c.n >= 5 && !last && !closed);
    paintAdds(); mail();
  }
  function renderMine() {
    if (!rows) return;
    const l = L.live(L.load()).sort((a, b) => a.pos - b.pos);
    rows.innerHTML = l.map((it, i) => {
      const t = titleOf(it), gone = it.cid && t === null;
      return '<li class="fl-row' + (it.status === 'done' ? ' is-done' : '') + '" data-id="' + esc(it.id) + '">'
        + '<div class="fl-row-main"><span class="fl-row-title">' + (it.cid && !gone ? '<a href="/list/' + esc(it.cid) + '/">' + esc(t) + '</a>' : esc(gone ? 'An activity we no longer list (' + it.cid + ')' : t)) + (it.cid ? '' : ' <span class="fl-reg">Yours</span>') + '</span>'
        + '<label class="sr-only" for="st-' + i + '">Status</label><select id="st-' + i + '" data-fl-status>' + L.STATUSES.map(s => '<option value="' + s + '"' + (s === it.status ? ' selected' : '') + '>' + STATUS[s] + '</option>').join('') + '</select></div>'
        + '<details><summary>' + (it.date || it.note ? esc([it.date ? new Date(it.date + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '', it.note].filter(Boolean).join(' · ').slice(0, 70)) : 'Date, note, move') + '</summary>'
        + '<div class="fl-row-more"><label>Date <small>(planned for, or done on)</small><input type="date" data-fl-date value="' + esc(it.date) + '"></label>'
        + '<label>Note<textarea rows="2" maxlength="500" data-fl-note placeholder="Who with, where, how it went">' + esc(it.note) + '</textarea></label>'
        + '<p class="fl-row-acts"><button type="button" class="chip" data-fl-move="-1"' + (i === 0 ? ' disabled' : '') + '>Move up</button><button type="button" class="chip" data-fl-move="1"' + (i === l.length - 1 ? ' disabled' : '') + '>Move down</button><button type="button" class="chip" data-fl-remove>Remove</button></p></div></details></li>';
    }).join('');
    renderPrintOnly();
    renderHead();
  }
  if (rows) {
    rows.addEventListener('change', e => {
      const li = e.target.closest('.fl-row'); if (!li) return; const id = li.dataset.id;
      if (e.target.matches('[data-fl-status]')) {
        const before = count().done; L.update(id, { status: e.target.value });
        li.classList.toggle('is-done', e.target.value === 'done');
        const c = count(), d = L.load();
        if (e.target.value === 'done') { track('list_done', { id: id.startsWith('x-') ? 'own' : id }); if (c.done > before) kind.textContent = c.done === d.target ? 'That is your whole list done. Remarkable. Time for a new number?' : (c.done * 2 === d.target ? 'Halfway to your number.' : KIND(c.done)) || 'Done. Well played.'; }
        else kind.textContent = '';
        renderHead(); renderPrintOnly();
      }
      if (e.target.matches('[data-fl-date]')) { L.update(id, { date: e.target.value }); renderPrintOnly(); mail(); }
      if (e.target.matches('[data-fl-note]')) { L.update(id, { note: e.target.value.slice(0, 500) }); renderPrintOnly(); }
    });
    rows.addEventListener('click', e => {
      const li = e.target.closest('.fl-row'); if (!li) return; const id = li.dataset.id;
      const mv = e.target.closest('[data-fl-move]');
      if (mv) { L.move(id, +mv.dataset.flMove); renderMine(); const again = $('.fl-row[data-id="' + CSS.escape(id) + '"] details', rows); if (again) again.open = true; }
      if (e.target.closest('[data-fl-remove]')) { L.remove(id); kind.textContent = ''; renderMine(); renderSuggest(); }
    });
  }
  function renderPrintOnly() {
    const l = L.live(L.load()).sort((a, b) => a.pos - b.pos);
    $('[data-fl-printout]', root).innerHTML = l.map(it => '<li>' + (it.status === 'done' ? '☑ ' : '☐ ') + esc(titleOf(it) || it.cid) + ' <small>' + STATUS[it.status] + (it.date ? ', ' + esc(it.date) : '') + (it.note ? '. ' + esc(it.note) : '') + '</small></li>').join('');
  }
  $('[data-fl-custom]', root).addEventListener('submit', e => {
    e.preventDefault(); const inp = $('input', e.target), v = inp.value.trim(); if (!v) return;
    L.add(null, v); inp.value = ''; track('list_custom', {});   // count only: never the words
    renderMine();
  });
  $('[data-fl-name]', root).addEventListener('change', e => { const v = e.target.value.trim(); if (v) L.settings({ title: v.slice(0, 60) }); renderHead(); });
  $('[data-fl-target]', root).addEventListener('change', e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 500) L.settings({ target: v }); renderHead(); });

  /* ---------- print, backup, restore, email ---------- */
  $('[data-fl-print]', root).addEventListener('click', () => { track('list_print', {}); window.print(); });
  $$('[data-fl-backup]', root).forEach(b => b.addEventListener('click', () => {
    const d = L.load(), day = new Date().toISOString().slice(0, 10);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'dontdieretired-list', saved: new Date().toISOString(), ...d }, null, 1)], { type: 'application/json' }));
      a.download = 'my-list-backup-' + day + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      L.flag('backup_at', day); toolmsg.textContent = 'Backup saved to your downloads as ' + a.download + '. Keep it somewhere safe.'; track('list_backup', { kind: 'save' }); renderHead();
    } catch (e) { toolmsg.textContent = 'This browser would not save the file. Try "Email my list to myself" instead.'; }
  }));
  $('[data-fl-remind-close]', root).addEventListener('click', () => { L.flag('remind_closed', '1'); renderHead(); });
  $('[data-fl-restore]', root).addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const inc = JSON.parse(r.result);
        if (!inc || !Array.isArray(inc.items)) throw 0;
        const before = count().n; L.restore(inc); const after = count().n;
        toolmsg.textContent = 'Backup restored. ' + (after > before ? (after - before) + ' added to what was here.' : 'Everything in it was already here, or newer here.') + ' Nothing was removed.';
        track('list_backup', { kind: 'restore' }); renderMine(); renderSuggest();
      } catch (err) { toolmsg.textContent = 'That file is not one of our backups, so nothing was changed.'; }
      e.target.value = '';
    };
    r.readAsText(f);
  });
  function mail() {
    const a = $('[data-fl-email]', root); if (!a) return;
    const d = L.load(), l = L.live(d).sort((x, y) => x.pos - y.pos);
    let body = d.title + '\n\n', left = 0;
    l.forEach(it => { const line = (it.status === 'done' ? '[x] ' : '[ ] ') + (titleOf(it) || it.cid) + (it.status !== 'want' && it.status !== 'done' ? ' (' + STATUS[it.status].toLowerCase() + ')' : '') + (it.date ? ' ' + it.date : '') + '\n'; if (body.length + line.length < 1500) body += line; else left++; });
    if (left) body += '...and ' + left + ' more. Use "Save a backup" for the full list.\n';
    body += '\nhttps://dontdieretired.com/list/';
    a.href = 'mailto:?subject=' + encodeURIComponent(d.title + ': my list') + '&body=' + encodeURIComponent(body);
  }
  $('[data-fl-email]', root).addEventListener('click', () => track('list_backup', { kind: 'email' }));

  /* ---------- one anonymous "still using it" count per browser per month (3 or more items) ---------- */
  function active() {
    const m = new Date().toISOString().slice(0, 7), c = count();
    if (c.n >= 3 && L.flag('active') !== m) { L.flag('active', m); track('list_active', { items: c.n >= 25 ? '25+' : c.n >= 10 ? '10-24' : '3-9' }); }
  }

  const topic = new URLSearchParams(location.search).get('topic'), catSel = sels.find(s => s.dataset.flF === 'category');
  if (topic && [...catSel.options].some(o => o.value === topic)) catSel.value = topic;
  filter(); renderSuggest(); renderMine();
  if (location.hash === '#mine') showView('mine'); else if (count().n >= 3) active();
})();

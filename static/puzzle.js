/* Daily puzzles (RUNBOOK §6g). Four a day: the Wheel, the Ladder, Sudoku and Numbers, each at three levels
   (g gentle, s steady, h hard). The same for everyone on a given date, changing at the reader's own midnight.
   Everything runs in this browser; nothing is sent anywhere except anonymous Plausible counts.
   Progress, level and streak live in localStorage under "ddr_puzzle".

   Streak rule: a day counts when the reader finishes any one puzzle at any level. Consecutive counted days
   make the streak. Hints never affect it. A missed day ends it, kindly: no warnings, no nagging. */
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = $('[data-puzzle]');
  const track = (n, p) => { if (window.plausible) window.plausible(n, { props: p || {} }); };
  const KEY = 'ddr_puzzle';
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const shift = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const unscramble = (b64, key) => { const raw = atob(b64); let out = ''; for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length) ^ 0x5A); return out; };
  const RANK = { g: 1, s: 2, h: 3 }, LNAME = { g: 'Gentle', s: 'Steady', h: 'Hard' };
  const TYPES = ['wheel', 'ladder', 'sudoku', 'numbers'], TNAME = { wheel: 'Wheel', ladder: 'Ladder', sudoku: 'Sudoku', numbers: 'Numbers' };

  // What the streak is right now: it only stands if the last counted day was today or yesterday.
  function streakNow(S, today) {
    const k = S.streak || { cur: 0, best: 0, last: '' };
    const live = k.last === today || k.last === shift(today, -1);
    return { cur: live ? k.cur : 0, best: k.best || 0, lapsed: !live && k.cur > 1 ? k.cur : 0, doneToday: k.last === today };
  }
  window.DDRPuzzle = { streak: () => streakNow(read(), iso(new Date())) };   // used by the home-page card

  // Home page and other pages: fill in any streak badge, then stop if this is not the puzzle page.
  $$('[data-pz-badge]').forEach(el => { const k = streakNow(read(), iso(new Date())); el.textContent = k.cur ? k.cur + '-day streak' + (k.doneToday ? ' · done today' : '') : ''; el.hidden = !k.cur; });
  if (!root) return;

  const today = iso(new Date());
  let S = read(), P = null;
  if (S.day !== today) { S.day = today; S.found = []; S.hints = 0; S.started = false; S.done = {}; S.lad = {}; S.sud = {}; S.num = {}; write(S); }
  ['done', 'lad', 'sud', 'num'].forEach(k => { if (!S[k] || typeof S[k] !== 'object') S[k] = {}; });
  if ((S.streak || {}).last === today && !Object.keys(S.done).length) S.done.wheel = 's';   // counted today before there were four
  const lv = () => RANK[S.lv] ? S.lv : 's';
  const started = type => { if (!S.started) { S.started = true; write(S); track('puzzle_start', { type }); } };
  const say = (el, t, kind) => { el.textContent = t || ' '; el.dataset.kind = kind || ''; };

  const els = { streak: $('[data-pz-streak]'), levelbox: $('[data-pz-levelbox]'), tabs: $('[data-pz-tabs]'), share: $('[data-pz-share]'),
    next: $('[data-pz-next]'), yest: $('[data-pz-yesterday]'), yestBody: $('[data-pz-yest-body]'), empty: $('[data-pz-empty]') };
  const mods = {};   // one per puzzle type: { ok(): is there data, draw(): render for the current level }

  /* ------------------------------------------------------------------ the day: streak, levels, tabs, share */
  function complete(type) {
    const l = lv();
    if (S.done[type] && RANK[S.done[type]] >= RANK[l]) return;
    S.done[type] = l;
    const k = S.streak || { cur: 0, best: 0, last: '' };
    if (k.last !== today) {
      k.cur = k.last === shift(today, -1) ? k.cur + 1 : 1; k.last = today; k.best = Math.max(k.best || 0, k.cur);
      track('puzzle_streak', { length: k.cur === 1 ? '1' : k.cur < 7 ? '2-6' : k.cur < 30 ? '7-29' : '30+' });
    }
    S.streak = k; write(S);
    track('puzzle_done', { type, level: l });
    if (type === 'wheel') track('puzzle_good');
    drawDay();
  }
  function drawDay() {
    const k = streakNow(S, today), n = TYPES.filter(t => S.done[t]).length, have = TYPES.filter(t => mods[t] && mods[t].ok()).length;
    let extra = '';
    if (k.cur === 7 || k.cur === 30 || k.cur === 100) extra = k.cur === 7 ? ' A full week.' : k.cur === 30 ? ' Thirty days running.' : ' One hundred days. Remarkable.';
    els.streak.innerHTML = (k.cur
      ? `<strong>${k.cur}</strong> day streak${k.doneToday ? ' · today counted' : ''}.${extra}`
      : (k.lapsed ? `Your last streak ran to <strong>${k.lapsed}</strong> days. Good going. A new one starts today.` : 'Finish any one puzzle today to start a streak.'))
      + (n ? ` <span class="pz-count">${n} of ${have} done today</span>` : '') + (Math.max(k.best, k.cur) > 1 ? ` <span class="meta">Best: ${Math.max(k.best, k.cur)}</span>` : '');
    $$('[data-pz-level]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pzLevel === lv())));
    $$('[data-pz-tab]', root).forEach(b => {
      const t = b.dataset.pzTab; b.hidden = !(mods[t] && mods[t].ok());
      b.setAttribute('aria-pressed', String(S.open === t)); b.classList.toggle('pz-done', !!S.done[t]);
      $('[data-pz-status]', b).textContent = S.done[t] ? '✓ ' + LNAME[S.done[t]] : 'To do';
    });
    if (!n) { els.share.hidden = true; return; }
    const nice = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const text = `Don't Die Retired daily puzzles, ${nice}: ` + TYPES.filter(t => S.done[t]).map(t => `${TNAME[t]} (${LNAME[S.done[t]].toLowerCase()})`).join(', ') + (k.cur > 1 ? `. ${k.cur}-day streak` : '') + '.';
    els.share.hidden = false;
    els.share.innerHTML = `<p><strong>${n === have ? 'All ' + have + ' done.' : n + ' done.'}</strong> ${n === have ? 'A clean sweep. New ones tomorrow.' : 'Today counts towards your streak. The others are there if you want them.'}</p>
      <button type="button" class="share-btn" data-pz-act="share" data-text="${text.replace(/"/g, '&quot;')}" data-url="${location.origin}/puzzle/?via=friend">Share my result</button> <span class="meta" data-pz-shared></span>`;
  }
  function open(type, focus) {
    if (!mods[type] || !mods[type].ok()) type = TYPES.find(t => mods[t] && mods[t].ok());
    if (!type) return;
    S.open = type; write(S);
    $$('[data-pz-panel]', root).forEach(p => p.hidden = p.dataset.pzPanel !== type);
    mods[type].draw(); drawDay();
    try { history.replaceState(null, '', '#' + type); } catch (e) {}
    if (focus) { const h = $('[data-pz-panel="' + type + '"] h2', root); if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); } }
  }
  root.addEventListener('click', e => {
    const L = e.target.closest('[data-pz-level]'), T = e.target.closest('[data-pz-tab]'), a = e.target.closest('[data-pz-act="share"]');
    if (L && L.dataset.pzLevel !== lv()) { S.lv = L.dataset.pzLevel; write(S); track('puzzle_level', { level: S.lv }); if (mods[S.open]) mods[S.open].draw(); drawDay(); }
    if (T) open(T.dataset.pzTab, true);
    if (a) {
      const text = a.dataset.text, url = a.dataset.url, note = $('[data-pz-shared]', root);
      if (navigator.share) navigator.share({ text, url }).then(() => track('share', { via: 'device', kind: 'puzzle' })).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(() => { note.textContent = 'Copied. Paste it wherever you like.'; track('share', { via: 'Copy link', kind: 'puzzle' }); }).catch(() => { note.textContent = text + ' ' + url; });
      else note.textContent = text + ' ' + url;
    }
  });

  /* ------------------------------------------------------------------ 1. the Wheel */
  (function () {
    const box = $('[data-pz-panel="wheel"]', root);
    const w = { word: $('[data-pz-word]', box), msg: $('[data-pz-msg]', box), wheel: $('[data-pz-wheel]', box), prog: $('[data-pz-progress]', box), found: $('[data-pz-found]', box), goal: $('[data-pz-goal]', box) };
    let answers = null, word = [], order = [];
    const LEVELS = ['', 'Good', 'Very good', 'Excellent'];
    const level = n => n >= P.t[2] ? 3 : n >= P.t[1] ? 2 : n >= P.t[0] ? 1 : 0;
    const goal = () => ({ g: Math.max(4, Math.round(P.n * .15)), s: P.t[0], h: P.t[2] })[lv()];
    function drawWheel() {
      w.wheel.innerHTML = `<button type="button" class="pz-l pz-c" data-l="${P.c}" aria-label="${P.c}, the middle letter">${P.c}</button>` +
        order.map((l, i) => `<button type="button" class="pz-l" style="--i:${i}" data-l="${l}">${l}</button>`).join('');
    }
    function drawWord() { w.word.innerHTML = word.length ? word.map(l => `<span${l === P.c ? ' class="pz-mid"' : ''}>${l}</span>`).join('') : '<span class="pz-ph">Tap or type</span>'; }
    function drawProgress() {
      const n = S.found.length, lvl = level(n), g = goal(), left = g - n;
      const pct = Math.min(100, Math.round(n / P.t[2] * 100));
      w.goal.textContent = `Today's goal at ${LNAME[lv()]}: ${g} words.`;
      w.prog.innerHTML = `<div class="pz-bar"><i style="width:${pct}%"></i>${P.t.map((t, i) => `<b style="left:${Math.min(100, t / P.t[2] * 100)}%" title="${LEVELS[i + 1]}"></b>`).join('')}</div>
        <p><strong>${n}</strong> of ${P.n} words${lvl ? ' · <strong>' + LEVELS[lvl] + '</strong>' : ''} · ${left > 0 ? left + ' more for today\'s goal' : 'goal reached; the rest are for the fun of it'}</p>
        <p class="meta">Good ${P.t[0]} · Very good ${P.t[1]} · Excellent ${P.t[2]}</p>`;
      w.found.innerHTML = S.found.length ? [...S.found].sort().map(x => `<span${x.length === 9 ? ' class="pz-nine"' : ''}>${x}</span>`).join(' ') : '<span class="meta">Nothing yet. The four-letter words are a good way in.</span>';
      if (n >= g) complete('wheel');
    }
    function submit() {
      const x = word.join('');
      if (!x) return;
      if (x.length < 4) return say(w.msg, 'Too short: four letters or more.', 'no');
      if (!x.includes(P.c)) return say(w.msg, 'It needs the middle letter, ' + P.c.toUpperCase() + '.', 'no');
      if (S.found.includes(x)) { word = []; drawWord(); return say(w.msg, 'You already have that one.', 'no'); }
      if (!answers.has(x)) return say(w.msg, 'Not in our word list.', 'no');
      const before = level(S.found.length), wasDone = S.found.length >= goal();
      S.found.push(x); write(S); word = []; drawWord();
      const after = level(S.found.length);
      say(w.msg, x.length === 9 ? 'The nine-letter word. Well found.' : (!wasDone && S.found.length >= goal()) ? 'Today\'s goal reached.' : after > before ? LEVELS[after] + '.' : ['Yes.', 'Good one.', 'That counts.', 'Nice.'][S.found.length % 4], 'yes');
      if (after === 3 && before < 3) track('puzzle_excellent');
      drawProgress();
    }
    function hint() {
      const left = [...answers].filter(x => !S.found.includes(x)).sort((a, b) => a.length - b.length || a.localeCompare(b));
      if (!left.length) return say(w.msg, 'You have found every word.', 'yes');
      const x = left[Math.min(left.length - 1, (S.hints || 0) % Math.max(1, Math.min(left.length, 6)))];
      S.hints = (S.hints || 0) + 1; write(S);
      say(w.msg, `Try a ${x.length}-letter word beginning with ${x[0].toUpperCase()}.`, 'hint'); track('puzzle_hint', { type: 'wheel' });
    }
    function press(l) {
      started('wheel');
      const have = word.filter(x => x === l).length, max = (P.c + P.o).split('').filter(x => x === l).length;
      if (have >= max) return say(w.msg, max ? 'No more ' + l.toUpperCase() + 's to use.' : 'That letter is not in today\'s wheel.', 'no');
      if (word.length >= 9) return;
      word.push(l); drawWord(); say(w.msg, '');
    }
    box.addEventListener('click', e => {
      const l = e.target.closest('[data-l]'), a = e.target.closest('[data-pz-act]');
      if (l) return press(l.dataset.l);
      if (!a) return;
      const act = a.dataset.pzAct;
      if (act === 'del') { word.pop(); drawWord(); say(w.msg, ''); }
      if (act === 'shuffle') { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } drawWheel(); }
      if (act === 'enter') submit();
      if (act === 'hint') hint();
    });
    document.addEventListener('keydown', e => {
      if (!P || S.open !== 'wheel' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter') { if (e.target.closest('button') && !e.target.closest('[data-l]')) return; e.preventDefault(); submit(); }
      else if (e.key === 'Backspace') { e.preventDefault(); word.pop(); drawWord(); say(w.msg, ''); }
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
    });
    mods.wheel = { ok: () => !!(P && P.a), draw() {
      if (!answers) { answers = new Set(unscramble(P.a, P.d).split(',')); S.found = (S.found || []).filter(x => answers.has(x)); write(S); order = P.o.split(''); drawWheel(); }
      drawWord(); drawProgress();
    } };
  })();

  /* ------------------------------------------------------------------ 2. the Ladder */
  (function () {
    const box = $('[data-pz-panel="ladder"]', root), holder = $('[data-lad]', box), msg = $('[data-lad-msg]', box);
    const lists = {};   // word length -> Promise<Set>
    const words = len => lists[len] || (lists[len] = fetch('/puzzle/w' + len + '.txt').then(r => { if (!r.ok) throw 0; return r.text(); }).then(t => new Set(t.split('\n').filter(Boolean))));
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    const data = () => { const d = P.L[lv()]; return { a: d.a, b: d.b, n: d.n, len: d.a.length, path: unscramble(d.s, P.d).split(',') }; };
    const state = d => { const cur = S.lad[lv()]; if (!Array.isArray(cur) || cur.length !== d.n - 1) S.lad[lv()] = Array(d.n - 1).fill(''); return S.lad[lv()]; };
    const tiles = x => x.split('').map(c => `<span>${c}</span>`).join('');
    // What is wrong with each rung, if anything. '' = fine or not finished yet.
    function judge(d, rungs, set) {
      const chain = [d.a, ...rungs, d.b], out = [];
      for (let i = 1; i < chain.length - 1; i++) {
        const x = chain[i], up = chain[i - 1];
        if (x.length < d.len) { out.push(x ? 'short' : 'empty'); continue; }
        if (!set.has(x)) { out.push('word'); continue; }
        if (up.length === d.len && diff(up, x) !== 1) { out.push('step'); continue; }
        if (i === chain.length - 2 && diff(x, d.b) !== 1) { out.push('end'); continue; }
        out.push('');
      }
      return out;
    }
    const WHY = { word: 'Not a word we know', step: 'Change one letter only', end: 'Must be one letter from the last word' };
    function mark(showAll) {
      const d = data(), rungs = state(d);
      return words(d.len).then(set => {
        const j = judge(d, rungs, set), solved = j.every(x => x === '');
        $$('[data-lad-mark]', holder).forEach((m, i) => {
          const bad = WHY[j[i]]; m.textContent = bad ? bad : (j[i] === '' ? '✓' : ''); m.dataset.kind = bad ? 'no' : 'yes';
          $$('input', holder)[i].setAttribute('aria-invalid', bad ? 'true' : 'false');
        });
        if (solved) { say(msg, `Climbed in ${d.n} changes. Well done.`, 'yes'); complete('ladder'); }
        else if (showAll) {
          const gaps = j.filter(x => x === 'empty' || x === 'short').length, wrong = j.filter(x => WHY[x]).length;
          say(msg, wrong ? `${wrong} ${wrong === 1 ? 'rung needs' : 'rungs need'} another look.` : `${gaps} ${gaps === 1 ? 'rung' : 'rungs'} still to fill.`, wrong ? 'no' : 'hint');
        }
        return solved;
      }).catch(() => say(msg, 'The word list did not load. Check your connection and try again.', 'no'));
    }
    function draw() {
      const d = data(), rungs = state(d);
      holder.innerHTML = `<ol class="lad" style="--len:${d.len}"><li class="lad-fixed" aria-label="Start: ${d.a}">${tiles(d.a)}</li>` +
        rungs.map((x, i) => `<li><label class="sr-only" for="lad-${i}">Rung ${i + 1} of ${rungs.length}, ${d.len} letters</label><input id="lad-${i}" data-lad-i="${i}" type="text" value="${x}" maxlength="${d.len}" size="${d.len}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="${i === rungs.length - 1 ? 'done' : 'next'}"><span class="lad-mark" data-lad-mark="${i}"></span></li>`).join('') +
        `<li class="lad-fixed" aria-label="Finish: ${d.b}">${tiles(d.b)}</li></ol>`;
      say(msg, `${d.len}-letter words, ${d.n} changes.`, '');
      if (rungs.some(Boolean)) mark(false);
    }
    holder.addEventListener('input', e => {
      const inp = e.target.closest('[data-lad-i]'); if (!inp) return;
      started('ladder');
      const d = data(), rungs = state(d), i = +inp.dataset.ladI;
      const v = inp.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, d.len);
      if (inp.value !== v) inp.value = v;
      rungs[i] = v; write(S);
      mark(false).then(() => {
        if (v.length === d.len && inp.getAttribute('aria-invalid') === 'false' && document.activeElement === inp) { const nx = $$('input', holder)[i + 1]; if (nx && !nx.value) nx.focus(); }
      });
    });
    holder.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-lad-i]')) { e.preventDefault(); const all = $$('input', holder), nx = all[+e.target.dataset.ladI + 1]; if (nx) nx.focus(); else mark(true); } });
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-lad-act]'); if (!a) return;
      const d = data(), rungs = state(d), act = a.dataset.ladAct;
      if (act === 'check') mark(true);
      if (act === 'clear') { S.lad[lv()] = Array(d.n - 1).fill(''); write(S); draw(); }
      if (act === 'hint') {
        // our own route: fill in up to the first rung where the reader's ladder leaves it
        let i = 0; while (i < rungs.length && rungs[i] === d.path[i + 1]) i++;
        if (i >= rungs.length) return mark(true);
        for (let k = 0; k <= i; k++) rungs[k] = d.path[k + 1];
        write(S); draw(); track('puzzle_hint', { type: 'ladder' });
        mark(false).then(done => { if (!done) say(msg, `Rung ${i + 1} filled in: ${d.path[i + 1].toUpperCase()}.`, 'hint'); });
      }
    });
    mods.ladder = { ok: () => !!(P && P.L), draw };
  })();

  /* ------------------------------------------------------------------ 3. Sudoku */
  (function () {
    const box = $('[data-pz-panel="sudoku"]', root), grid = $('[data-sud]', box), pad = $('[data-sud-pad]', box), msg = $('[data-sud-msg]', box), how = $('[data-sud-how]', box), notesBtn = $('[data-sud-act="notes"]', box), checkBtn = $('[data-sud-act="check"]', box);
    let sel = -1, notesMode = false, flagged = new Set(), shownFor = '';
    const data = () => { const d = P.K[lv()], n = Math.round(Math.sqrt(d.p.length)); return { p: d.p, sol: unscramble(d.s, P.d), n, br: n === 6 ? 2 : 3, bc: 3 }; };
    const state = d => { const cur = S.sud[lv()]; if (!cur || typeof cur.v !== 'string' || cur.v.length !== d.p.length) S.sud[lv()] = { v: d.p, notes: {} }; return S.sud[lv()]; };
    const setAt = (s, i, c) => s.slice(0, i) + c + s.slice(i + 1);
    function draw(keepFocus) {
      const d = data(), st = state(d), n = d.n, easy = lv() === 'g';
      if (shownFor !== lv()) { shownFor = lv(); sel = -1; flagged = new Set(); notesMode = false; }
      how.textContent = `Fill the grid so that every row, column and outlined box holds each number from 1 to ${n} once. ` +
        (easy ? 'A wrong number shows in red straight away.' : lv() === 's' ? 'Press Check to see any that are wrong.' : 'This one cannot be done by spotting single gaps alone: use Notes to keep track of what could go where.');
      checkBtn.hidden = easy; notesBtn.setAttribute('aria-pressed', String(notesMode));
      const sr = sel >= 0 ? Math.floor(sel / n) : -1, sc = sel >= 0 ? sel % n : -1, sv = sel >= 0 ? st.v[sel] : '0';
      const sbox = i => Math.floor(Math.floor(i / n) / d.br) * 10 + Math.floor((i % n) / d.bc);
      grid.style.setProperty('--n', n); pad.style.setProperty('--n', n);
      grid.innerHTML = st.v.split('').map((c, i) => {
        const r = Math.floor(i / n), col = i % n, given = d.p[i] !== '0', wrong = c !== '0' && !given && c !== d.sol[i] && (easy || flagged.has(i));
        const notes = (st.notes[i] || '');
        const cls = ['sud-c', given ? 'given' : '', (col + 1) % d.bc === 0 && col < n - 1 ? 'br' : '', (r + 1) % d.br === 0 && r < n - 1 ? 'bb' : '',
          i === sel ? 'sel' : (sel >= 0 && (r === sr || col === sc || sbox(i) === sbox(sel)) ? 'peer' : ''), sv !== '0' && c === sv && i !== sel ? 'same' : '', wrong ? 'bad' : ''].filter(Boolean).join(' ');
        const label = `Row ${r + 1}, column ${col + 1}: ` + (c !== '0' ? c + (given ? ', given' : wrong ? ', wrong' : '') : notes ? 'empty, notes ' + notes.split('').join(' ') : 'empty');
        const inner = c !== '0' ? c : notes ? `<span class="sud-notes">${notes.split('').map(x => `<i>${x}</i>`).join('')}</span>` : '';
        return `<button type="button" class="${cls}" data-sud-i="${i}" aria-label="${label}" tabindex="${i === (sel >= 0 ? sel : 0) ? 0 : -1}">${inner}</button>`;
      }).join('');
      const counts = {}; st.v.split('').forEach(c => counts[c] = (counts[c] || 0) + 1);
      pad.innerHTML = Array.from({ length: n }, (_, k) => `<button type="button" data-sud-d="${k + 1}" class="${counts[k + 1] >= n ? 'full' : ''}" aria-label="${k + 1}${counts[k + 1] >= n ? ', all placed' : ''}">${k + 1}</button>`).join('');
      if (keepFocus && sel >= 0) { const b = $('[data-sud-i="' + sel + '"]', grid); if (b) b.focus({ preventScroll: true }); }
      if (st.v === d.sol) { say(msg, 'Solved. Every row, column and box is right.', 'yes'); complete('sudoku'); }
    }
    function put(digit, viaKeys) {
      const d = data(), st = state(d);
      if (sel < 0) return say(msg, 'Choose a square first.', 'hint');
      if (d.p[sel] !== '0') return say(msg, 'That number was given. Choose an empty square.', 'no');
      started('sudoku');
      if (notesMode && digit !== '0') {
        if (st.v[sel] !== '0') st.v = setAt(st.v, sel, '0');
        const cur = new Set((st.notes[sel] || '').split('').filter(Boolean)); cur.has(digit) ? cur.delete(digit) : cur.add(digit);
        st.notes[sel] = [...cur].sort().join(''); if (!st.notes[sel]) delete st.notes[sel];
      } else {
        st.v = setAt(st.v, sel, st.v[sel] === digit ? '0' : digit); delete st.notes[sel];
      }
      flagged.delete(sel); write(S); say(msg, '');
      draw(viaKeys || true);
    }
    grid.addEventListener('click', e => { const c = e.target.closest('[data-sud-i]'); if (!c) return; sel = +c.dataset.sudI; draw(true); });
    pad.addEventListener('click', e => { const b = e.target.closest('[data-sud-d]'); if (b) put(b.dataset.sudD); });
    grid.addEventListener('keydown', e => {
      const d = data(), n = d.n; if (sel < 0) sel = 0;
      const move = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (move) { e.preventDefault(); const t = sel + move; if (t >= 0 && t < n * n && !(Math.abs(move) === 1 && Math.floor(t / n) !== Math.floor(sel / n))) { sel = t; draw(true); } }
      else if (/^[1-9]$/.test(e.key) && +e.key <= n) { e.preventDefault(); put(e.key, true); }
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); put('0', true); }
      else if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; draw(true); }
    });
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-sud-act]'); if (!a) return;
      const d = data(), st = state(d), act = a.dataset.sudAct;
      if (act === 'notes') { notesMode = !notesMode; draw(); say(msg, notesMode ? 'Notes on: numbers you tap are pencilled in small.' : 'Notes off.', 'hint'); }
      if (act === 'erase') put('0');
      if (act === 'check') {
        flagged = new Set(); st.v.split('').forEach((c, i) => { if (c !== '0' && c !== d.sol[i]) flagged.add(i); });
        const left = st.v.split('').filter(c => c === '0').length; draw();
        say(msg, flagged.size ? `${flagged.size} to look at again, shown in red.` : left ? `All right so far. ${left} to go.` : 'Solved.', flagged.size ? 'no' : 'yes');
      }
      if (act === 'hint') {
        let i = sel >= 0 && d.p[sel] === '0' && st.v[sel] !== d.sol[sel] ? sel : st.v.split('').findIndex((c, k) => c !== d.sol[k]);
        if (i < 0) return;
        started('sudoku'); st.v = setAt(st.v, i, d.sol[i]); delete st.notes[i]; flagged.delete(i); sel = i; write(S); track('puzzle_hint', { type: 'sudoku' });
        say(msg, `Row ${Math.floor(i / d.n) + 1}, column ${i % d.n + 1} is ${d.sol[i]}.`, 'hint'); draw();
      }
      if (act === 'clear') { S.sud[lv()] = { v: d.p, notes: {} }; flagged = new Set(); sel = -1; write(S); say(msg, ''); draw(); }
    });
    mods.sudoku = { ok: () => !!(P && P.K), draw: () => { say(msg, ''); draw(); } };
  })();

  /* ------------------------------------------------------------------ 4. Numbers */
  (function () {
    const box = $('[data-pz-panel="numbers"]', root), tilesEl = $('[data-num-tiles]', box), msg = $('[data-num-msg]', box), stepsEl = $('[data-num-steps]', box), targetEl = $('[data-num-target]', box);
    let selA = -1, op = '', hints = 0, shownFor = '';
    const SIGN = { '+': '+', '-': '−', x: '×', '/': '÷' };
    const data = () => { const d = P.N[lv()]; return { n: d.n, t: d.t, way: unscramble(d.w, P.d).split(';') }; };
    const state = () => { const cur = S.num[lv()]; if (!cur || !Array.isArray(cur.st)) S.num[lv()] = { st: [] }; return S.num[lv()]; };
    const calc = (a, o, b) => o === '+' ? a + b : o === '-' ? a - b : o === 'x' ? a * b : a / b;
    // The numbers on the table after the reader's sums so far. Each sum takes two away and puts its answer back.
    function table(d, st) {
      const t = d.n.map(v => ({ v, made: false }));
      st.st.forEach(([a, o, b]) => { t.splice(t.findIndex(x => x.v === a), 1); t.splice(t.findIndex(x => x.v === b), 1); t.push({ v: calc(a, o, b), made: true }); });
      return t;
    }
    function draw() {
      const d = data(), st = state(), t = table(d, st);
      if (shownFor !== lv()) { shownFor = lv(); selA = -1; op = ''; hints = 0; }
      if (selA >= t.length) selA = -1;
      targetEl.textContent = d.t;
      const hit = t.some(x => x.v === d.t);
      tilesEl.innerHTML = t.map((x, i) => `<button type="button" data-num-i="${i}" class="${x.made ? 'made' : ''}${x.v === d.t ? ' hit' : ''}" aria-pressed="${i === selA}">${x.v}</button>`).join('');
      $$('[data-num-op]', box).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.numOp === op)));
      stepsEl.innerHTML = st.st.map(([a, o, b]) => `<li>${a} ${SIGN[o]} ${b} = <strong>${calc(a, o, b)}</strong></li>`).join('');
      if (hit) { say(msg, `${d.t}. That's it, in ${st.st.length} ${st.st.length === 1 ? 'sum' : 'sums'}.`, 'yes'); complete('numbers'); }
    }
    function pick(i) {
      const d = data(), st = state(), t = table(d, st);
      if (t.some(x => x.v === d.t)) return;
      started('numbers');
      if (selA < 0 || !op) { selA = selA === i ? -1 : i; say(msg, selA >= 0 && !op ? 'Now choose a sign.' : ''); return draw(); }
      if (i === selA) { selA = -1; say(msg, ''); return draw(); }
      const a = t[selA].v, b = t[i].v, r = calc(a, op, b);
      if (op === '-' && r < 1) return say(msg, `${a} − ${b} would go below 1. Whole numbers above zero only.`, 'no');
      if (op === '/' && r !== Math.floor(r)) return say(msg, `${a} does not divide by ${b} exactly.`, 'no');
      st.st.push([a, op, b]); write(S); op = ''; selA = table(d, st).length - 1; say(msg, `${a} ${SIGN[st.st[st.st.length - 1][1]]} ${b} = ${r}`, '');
      draw();
    }
    box.addEventListener('click', e => {
      const ti = e.target.closest('[data-num-i]'), o = e.target.closest('[data-num-op]'), a = e.target.closest('[data-num-act]');
      if (ti) return pick(+ti.dataset.numI);
      if (o) { op = op === o.dataset.numOp ? '' : o.dataset.numOp; say(msg, op ? (selA >= 0 ? 'Now choose the second number.' : 'Choose a number first.') : ''); return draw(); }
      if (!a) return;
      const d = data(), st = state(), act = a.dataset.numAct;
      if (act === 'undo') { if (st.st.length) { st.st.pop(); write(S); } selA = -1; op = ''; say(msg, ''); draw(); }
      if (act === 'clear') { st.st = []; write(S); selA = -1; op = ''; say(msg, ''); draw(); }
      if (act === 'hint') { hints = Math.min(d.way.length, hints + 1); track('puzzle_hint', { type: 'numbers' });
        say(msg, 'One way ' + (hints < d.way.length ? 'starts' : 'is') + ': ' + d.way.slice(0, hints).map(s => s.replace(' x ', ' × ').replace(' / ', ' ÷ ').replace(' - ', ' − ')).join(', then ') + '.', 'hint'); }
    });
    mods.numbers = { ok: () => !!(P && P.N), draw: () => { say(msg, ''); draw(); } };
  })();

  /* ------------------------------------------------------------------ load today, show yesterday */
  function countdown() {
    const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), m = Math.max(0, Math.round((mid - now) / 60000));
    els.next.textContent = `New puzzles in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min.`;
    if (iso(now) !== today) location.reload();   // midnight has passed: today's puzzles are over
  }
  const get = d => fetch('/puzzle/d/' + d + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); });

  get(today).then(p => {
    P = p;
    els.levelbox.hidden = false; els.tabs.hidden = false;
    const want = (location.hash || '').slice(1);
    open(TYPES.includes(want) ? want : TYPES.includes(S.open) ? S.open : 'wheel');
    countdown(); setInterval(countdown, 30000);
  }).catch(() => { els.empty.hidden = false; drawDay(); });
  get(shift(today, -1)).then(y => {
    const l = lv(), nines = unscramble(y.w, y.d).split(',').filter(Boolean), out = [];
    out.push(`<p><strong>Wheel:</strong> the nine-letter word${nines.length > 1 ? 's were' : ' was'} ${nines.join(' and ').toUpperCase()}, with ${y.n} words to find.</p>`);
    if (y.L && y.L[l]) out.push(`<p><strong>Ladder</strong> (${LNAME[l].toLowerCase()}): ${unscramble(y.L[l].s, y.d).split(',').join(' → ').toUpperCase()}. Other routes may work too.</p>`);
    if (y.N && y.N[l]) out.push(`<p><strong>Numbers</strong> (${LNAME[l].toLowerCase()}): ${y.N[l].t} from ${y.N[l].n.join(', ')}. One way: ${unscramble(y.N[l].w, y.d).split(';').join('; ').replace(/ x /g, ' × ').replace(/ \/ /g, ' ÷ ').replace(/ - /g, ' − ')}.</p>`);
    els.yestBody.innerHTML = out.join(''); els.yest.hidden = false;
  }).catch(() => {});
})();

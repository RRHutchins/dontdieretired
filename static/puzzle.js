/* The Daily Wheel (RUNBOOK §6g). One puzzle per calendar day, the same for everyone on that date,
   changing at the reader's own midnight. Everything runs in this browser; nothing is sent anywhere
   except anonymous Plausible counts. Progress and streak live in localStorage under "ddr_puzzle".

   Streak rule: a day counts when the reader reaches "Good". Consecutive counted days make the streak.
   A hint never affects it. A missed day ends it, kindly: no warnings, no nagging. */
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
  let S = read(), P = null, answers = null, word = [], order = [];
  if (S.day !== today) { S.day = today; S.found = []; S.hints = 0; S.started = false; write(S); }

  const els = { play: $('[data-pz-play]'), word: $('[data-pz-word]'), msg: $('[data-pz-msg]'), wheel: $('[data-pz-wheel]'), prog: $('[data-pz-progress]'),
    found: $('[data-pz-found]'), share: $('[data-pz-share]'), streak: $('[data-pz-streak]'), next: $('[data-pz-next]'), yest: $('[data-pz-yesterday]'), empty: $('[data-pz-empty]') };
  const level = n => !P ? 0 : n >= P.t[2] ? 3 : n >= P.t[1] ? 2 : n >= P.t[0] ? 1 : 0;
  const LEVELS = ['', 'Good', 'Very good', 'Excellent'];

  function drawStreak() {
    const k = streakNow(S, today);
    let extra = '';
    if (k.cur === 7 || k.cur === 30 || k.cur === 100) extra = k.cur === 7 ? ' A full week.' : k.cur === 30 ? ' Thirty days running.' : ' One hundred days. Remarkable.';
    els.streak.innerHTML = k.cur
      ? `<strong>${k.cur}</strong> day streak${k.doneToday ? ' · today counted' : ''}.${extra} <span class="meta">Best: ${Math.max(k.best, k.cur)}</span>`
      : (k.lapsed ? `Your last streak ran to <strong>${k.lapsed}</strong> days. Good going. A new one starts today.` : 'Reach "Good" today to start a streak.') + (k.best ? ` <span class="meta">Best: ${k.best}</span>` : '');
  }
  function drawWheel() {
    els.wheel.innerHTML = `<button type="button" class="pz-l pz-c" data-l="${P.c}" aria-label="${P.c}, the middle letter">${P.c}</button>` +
      order.map((l, i) => `<button type="button" class="pz-l" style="--i:${i}" data-l="${l}">${l}</button>`).join('');
  }
  function drawWord() { els.word.innerHTML = word.length ? word.map(l => `<span${l === P.c ? ' class="pz-mid"' : ''}>${l}</span>`).join('') : '<span class="pz-ph">Tap or type</span>'; }
  function say(t, kind) { els.msg.textContent = t; els.msg.dataset.kind = kind || ''; }
  function drawProgress() {
    const n = S.found.length, lv = level(n), next = lv < 3 ? P.t[lv] : null;
    const pct = Math.min(100, Math.round(n / P.t[2] * 100));
    els.prog.innerHTML = `<div class="pz-bar"><i style="width:${pct}%"></i>${P.t.map((t, i) => `<b style="left:${Math.min(100, t / P.t[2] * 100)}%" title="${LEVELS[i + 1]}"></b>`).join('')}</div>
      <p><strong>${n}</strong> of ${P.n} words${lv ? ' · <strong>' + LEVELS[lv] + '</strong>' : ''}${next ? ` · ${next - n} more for ${LEVELS[lv + 1]}` : ' · the rest are for the fun of it'}</p>
      <p class="meta">Good ${P.t[0]} · Very good ${P.t[1]} · Excellent ${P.t[2]}</p>`;
    els.found.innerHTML = S.found.length ? [...S.found].sort().map(w => `<span${w.length === 9 ? ' class="pz-nine"' : ''}>${w}</span>`).join(' ') : '<span class="meta">Nothing yet. The four-letter words are a good way in.</span>';
  }
  function drawShare() {
    const n = S.found.length, lv = level(n); if (!lv) { els.share.hidden = true; return; }
    const k = streakNow(S, today), nice = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const text = `The Daily Wheel, ${nice}: ${n} words, ${LEVELS[lv]}${k.cur > 1 ? ', ' + k.cur + '-day streak' : ''}.`;
    const url = location.origin + '/puzzle/?via=friend';
    els.share.hidden = false;
    els.share.innerHTML = `<p><strong>${LEVELS[lv]}.</strong> ${lv === 1 ? 'Today counts towards your streak.' : lv === 2 ? 'That is a strong day.' : 'Top marks.'} Come back tomorrow for a new wheel.</p>
      <button type="button" class="share-btn" data-pz-act="share" data-text="${text}" data-url="${url}">Share my result</button> <span class="meta" data-pz-shared></span>`;
  }
  function reached(lv) {
    // the day counts from "Good"
    const k = S.streak || { cur: 0, best: 0, last: '' };
    if (lv >= 1 && k.last !== today) {
      k.cur = k.last === shift(today, -1) ? k.cur + 1 : 1; k.last = today; k.best = Math.max(k.best || 0, k.cur); S.streak = k; write(S);
      track('puzzle_good'); track('puzzle_streak', { length: k.cur === 1 ? '1' : k.cur < 7 ? '2-6' : k.cur < 30 ? '7-29' : '30+' });
    }
    if (lv === 3) track('puzzle_excellent');
    drawStreak();
  }
  function submit() {
    const w = word.join('');
    if (!w) return;
    if (w.length < 4) return say('Too short: four letters or more.', 'no');
    if (!w.includes(P.c)) return say('It needs the middle letter, ' + P.c.toUpperCase() + '.', 'no');
    if (S.found.includes(w)) { word = []; drawWord(); return say('You already have that one.', 'no'); }
    if (!answers.has(w)) return say('Not in our word list.', 'no');
    const before = level(S.found.length);
    S.found.push(w); write(S); word = []; drawWord(); drawProgress();
    const after = level(S.found.length);
    say(w.length === 9 ? 'The nine-letter word. Well found.' : after > before ? LEVELS[after] + '.' : ['Yes.', 'Good one.', 'That counts.', 'Nice.'][S.found.length % 4], 'yes');
    if (after > before) reached(after);
    drawShare();
  }
  function hint() {
    const left = [...answers].filter(w => !S.found.includes(w)).sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (!left.length) return say('You have found every word.', 'yes');
    const w = left[Math.min(left.length - 1, (S.hints || 0) % Math.max(1, Math.min(left.length, 6)))];
    S.hints = (S.hints || 0) + 1; write(S);
    say(`Try a ${w.length}-letter word beginning with ${w[0].toUpperCase()}.`, 'hint'); track('puzzle_hint');
  }
  function press(l) {
    if (!S.started) { S.started = true; write(S); track('puzzle_start'); }
    const have = word.filter(x => x === l).length, max = (P.c + P.o).split('').filter(x => x === l).length;
    if (have >= max) return say(max ? 'No more ' + l.toUpperCase() + 's to use.' : 'That letter is not in today\'s wheel.', 'no');
    if (word.length >= 9) return;
    word.push(l); drawWord(); say(' ');
  }
  root.addEventListener('click', e => {
    const l = e.target.closest('[data-l]'), a = e.target.closest('[data-pz-act]');
    if (l) return press(l.dataset.l);
    if (!a) return;
    const act = a.dataset.pzAct;
    if (act === 'del') { word.pop(); drawWord(); say(' '); }
    if (act === 'shuffle') { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } drawWheel(); }
    if (act === 'enter') submit();
    if (act === 'hint') hint();
    if (act === 'share') {
      const text = a.dataset.text, url = a.dataset.url, note = $('[data-pz-shared]', root);
      if (navigator.share) navigator.share({ text, url }).then(() => track('share', { via: 'device', kind: 'puzzle' })).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(() => { note.textContent = 'Copied. Paste it wherever you like.'; track('share', { via: 'Copy link', kind: 'puzzle' }); }).catch(() => { note.textContent = text + ' ' + url; });
      else note.textContent = text + ' ' + url;
    }
  });
  document.addEventListener('keydown', e => {
    if (!P || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter') { if (e.target.closest('button') && !e.target.closest('[data-l]')) return; e.preventDefault(); submit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); word.pop(); drawWord(); say(' '); }
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  });

  function countdown() {
    const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), m = Math.max(0, Math.round((mid - now) / 60000));
    els.next.textContent = `New puzzle in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min.`;
    if (iso(now) !== today) location.reload();   // midnight has passed: today's puzzle is over
  }
  const get = d => fetch('/puzzle/d/' + d + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw 0; return r.json(); });

  get(today).then(p => {
    P = p; answers = new Set(unscramble(p.a, p.d).split(','));
    S.found = (S.found || []).filter(w => answers.has(w)); write(S);
    order = p.o.split('');
    els.play.hidden = false; drawWheel(); drawWord(); drawProgress(); drawShare(); drawStreak();
    countdown(); setInterval(countdown, 30000);
  }).catch(() => { els.empty.hidden = false; drawStreak(); });
  get(shift(today, -1)).then(y => {
    const nines = unscramble(y.w, y.d).split(',').filter(Boolean);
    els.yest.textContent = `Yesterday's nine-letter word${nines.length > 1 ? 's were' : ' was'} ${nines.join(' and ').toUpperCase()}, with ${y.n} words to find.`;
  }).catch(() => {});
})();

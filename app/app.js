/* Don't Die Retired — app prototype.
   Vanilla JS, hash routes, progress stored on the device (localStorage). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- storage ----------
  const KEY = 'ddr_app_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let S = Object.assign({ active: 'restart7', size: 0, plans: {}, tests: {}, unlocked: {} }, load());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  const P = id => (S.plans[id] ||= { done: {}, feel: {} });

  document.documentElement.dataset.size = S.size;

  // ---------- data ----------
  let DATA = null, STORIES = [];
  const plan = id => DATA.plans.find(p => p.id === id);
  const isOpen = (p, i) => p.free || S.unlocked[p.id] || i < p.open_days;
  const doneCount = p => Object.keys(P(p.id).done).length;
  const nextIndex = p => { const d = P(p.id).done; const i = p.days.findIndex((_, k) => !d[k]); return i < 0 ? p.days.length : i; };
  function streak() {
    const dates = new Set(Object.values(S.plans).flatMap(x => Object.values(x.done)));
    let n = 0; const d = new Date();
    if (!dates.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    while (dates.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const totalSessions = () => Object.values(S.plans).reduce((a, x) => a + Object.keys(x.done).length, 0);

  // ---------- helpers ----------
  const setPlanColour = p => document.documentElement.style.setProperty('--plan', p ? p.colour : '#B23A48');
  const target = s => s.reps ? `×${s.reps}` : s.secs ? (s.secs >= 60 ? `${Math.round(s.secs / 60)} min` : `${s.secs} sec`) : '';
  let audio;
  const beep = (f = 880, ms = 180) => { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(.18, audio.currentTime); o.start(); o.stop(audio.currentTime + ms / 1000); } catch {} };
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  function sheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="fade">${html}</div>`; s.hidden = false; s.onclick = e => { if (e.target === s || e.target.closest('[data-close]')) s.hidden = true; }; }
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

  // ---------- screens ----------
  function Today() {
    const p = plan(S.active); setPlanColour(p);
    const i = nextIndex(p), d = p.days[i], st = streak();
    const finished = i >= p.days.length, locked = !finished && !isOpen(p, i);
    const doneToday = Object.values(P(p.id).done).includes(today());
    const s0 = STORIES[0];
    return `
    <p class="kick">${greet()}</p>
    <h1>${doneToday ? 'Done for today. Well done.' : finished ? 'You finished the plan.' : 'Ten minutes today?'}</h1>
    <div class="stats">
      <div class="stat"><b>${st}</b><span>day streak</span></div>
      <div class="stat"><b>${doneCount(p)}/${p.days.length}</b><span>${esc(p.title.replace('The ', ''))}</span></div>
      <div class="stat"><b>${totalSessions()}</b><span>sessions in all</span></div>
    </div>
    ${finished ? `<div class="card hero"><p class="kick">Plan complete</p><h2>${esc(p.title)}</h2><p>Every session done. Choose what's next.</p><a class="btn" href="#/plans">See your plans</a></div>`
      : locked ? `<div class="card hero"><p class="kick">${esc(d.day)}</p><h2>Keep going with the full plan</h2><p>You've done the free preview days. Unlock the rest of ${esc(p.title)} for ${p.price}. Your progress is kept.</p><a class="btn" href="${p.shop}">Unlock for ${p.price}</a></div>`
      : `<div class="card hero"><p class="kick">${esc(p.title)} · ${esc(d.day)}</p><h2>${esc(d.title === d.day ? (d.test ? 'Retest day' : 'Today\'s session') : d.title)}</h2>
         <p>${d.steps.length} movements · about 10 minutes${d.note ? ` · <i>${esc(d.note)}</i>` : ''}</p>
         <a class="btn" href="#/session/${p.id}/${i}">${doneToday ? 'Do the next one anyway' : 'Start'} →</a></div>
         ${doneToday ? '' : `<button class="btn ghost small" data-action="two">Short on time? The 2-minute version</button><div style="height:16px"></div>`}`}
    ${!S.tests[p.id]?.start && p.id === 'restart7' ? `<div class="card"><p class="kick">Before Day 1</p><h3>Take the 1-minute test</h3><p class="muted">How many times can you stand up from a chair in 30 seconds? You'll do it again on Day 7 and see the difference.</p><a class="btn green small" href="#/test/${p.id}/start">Take the test</a></div>` : ''}
    ${s0 ? `<a class="card story" href="${s0.url}" target="_blank" rel="noopener"><p class="kick">Today's story</p>${s0.image ? `<img src="${s0.image}" alt="" loading="lazy">` : ''}<h3>${esc(s0.title)}</h3><p class="muted">${esc(s0.excerpt).slice(0, 150)}…</p></a>` : ''}
    ${installCard()}`;
  }

  function Plans() {
    setPlanColour(null);
    return `<h1>My plans</h1>
    ${DATA.plans.map(p => { const n = doneCount(p); return `
      <a class="card plancard" href="#/plan/${p.id}" style="--pc:${p.colour}">
        <div class="sw">${p.days.length}</div>
        <div style="flex:1"><span class="tag ${p.free ? 'free' : ''}">${p.free ? 'Free' : S.unlocked[p.id] ? 'Unlocked' : `${p.open_days} days free`}</span>
          <h3 style="margin:.3em 0 .1em">${esc(p.title)}</h3><p class="muted">${esc(p.subtitle)}</p>
          <div class="bar-prog"><i style="width:${Math.round(100 * n / p.days.length)}%"></i></div></div></a>`; }).join('')}
    <div class="card"><p class="kick">Coming to the app</p><h3>Strong at 60 · Eat Strong · Sharp · The Money Reset · Second Act · Reconnect · Slow Travel · Tech Confident</h3><p class="muted">Every plan in our shop, interactive, with trackers that fill themselves in. Already bought one? It's in your email as a PDF.</p><a class="btn ghost small" href="/shop/">See the shop</a></div>`;
  }

  function PlanView(id) {
    const p = plan(id); setPlanColour(p);
    const d = P(id).done, nx = nextIndex(p);
    const weeks = [...new Set(p.days.map(x => x.week))];
    return `<p class="kick"><a href="#/plans">My plans</a></p><h1>${esc(p.title)}</h1><p class="muted">${esc(p.subtitle)}</p>
    ${S.active !== id ? `<button class="btn small" data-action="activate" data-id="${id}">Make this my plan for Today</button><div style="height:14px"></div>` : ''}
    ${weeks.map(w => `<div class="card"><h3>${esc(w)}</h3><div class="days">${p.days.map((x, i) => x.week !== w ? '' :
      `<a class="dot ${d[i] ? 'done' : i === nx ? 'next' : ''} ${isOpen(p, i) ? '' : 'lock'}" href="${isOpen(p, i) ? `#/session/${id}/${i}` : '#'}" ${isOpen(p, i) ? '' : 'data-action="locked" data-id="' + id + '"'} aria-label="${esc(x.day)}${d[i] ? ', done' : ''}">${d[i] ? '✓' : isOpen(p, i) ? x.day.replace('Day ', '') : '🔒'}</a>`).join('')}</div></div>`).join('')}
    ${p.safety ? `<details class="card warn"><summary>${esc(p.safety.title)}</summary><div>${p.safety.text.split('\n').map(l => `<p>${esc(l)}</p>`).join('')}</div></details>` : ''}
    <details class="card"><summary>All the movements (${p.movements.length})</summary><ul class="list">${p.movements.map(m => `<li><div><b>${esc(m.name)}</b><br><span class="muted">${esc(m.how)}</span></div></li>`).join('')}</ul></details>
    ${!p.free && !S.unlocked[id] ? `<div class="card"><h3>Unlock all ${p.days.length} days</h3><p class="muted">The first ${p.open_days} days are free to try. The full plan is ${p.price}, and if you later upgrade to the bundle, what you paid counts in full.</p><a class="btn" href="${p.shop}">Unlock for ${p.price}</a></div>` : ''}`;
  }

  function Progress() {
    setPlanColour(plan(S.active));
    const t = S.tests.restart7 || {};
    const bars = (t.start || t.end) ? chart([['Day 0', t.start?.sts], ['Day 7', t.end?.sts]], 'stands in 30 seconds') : '';
    const feel = (t.start || t.end) ? chart([['Day 0', t.start?.feel], ['Day 7', t.end?.feel]], 'how you feel, out of 10', 10) : '';
    const feelLog = Object.entries(P(S.active).feel);
    return `<h1>Your progress</h1>
    <div class="stats"><div class="stat"><b>${streak()}</b><span>day streak</span></div><div class="stat"><b>${totalSessions()}</b><span>sessions</span></div><div class="stat"><b>${totalSessions() * 10}</b><span>minutes moved</span></div></div>
    <div class="card"><p class="kick">Sit-to-stand test</p>${bars || `<p class="muted">Take the 30-second test before Day 1 and again on Day 7. Your two results appear here side by side.</p>`}
      <div class="row"><a class="btn small ghost" href="#/test/restart7/start">${t.start ? 'Redo' : 'Take'} Day 0 test</a><a class="btn small ghost" href="#/test/restart7/end">${t.end ? 'Redo' : 'Take'} Day 7 test</a></div></div>
    ${feel ? `<div class="card"><p class="kick">How you feel</p>${feel}</div>` : ''}
    ${feelLog.length ? `<div class="card"><p class="kick">After each session</p><p style="font-size:1.6em;letter-spacing:.1em">${feelLog.map(([, v]) => ['😣', '🙁', '😐', '🙂', '😄'][v - 1]).join(' ')}</p></div>` : ''}`;
  }

  function chart(rows, unit, max) {
    const m = max || Math.max(10, ...rows.map(r => r[1] || 0)) * 1.2;
    return `<svg class="chart" viewBox="0 0 320 170" role="img" aria-label="${rows.map(r => `${r[0]}: ${r[1] ?? 'not yet'}`).join(', ')}">
      ${rows.map((r, i) => { const h = r[1] ? 120 * r[1] / m : 0, x = 50 + i * 130; return `<rect x="${x}" y="${140 - h}" width="90" height="${h}" rx="8" fill="${i ? 'var(--plan)' : '#c9c3b8'}"/><text x="${x + 45}" y="${132 - h}" text-anchor="middle" font-family="Fr" font-weight="900" font-size="26">${r[1] ?? '–'}</text><text x="${x + 45}" y="162" text-anchor="middle" font-size="14" fill="#565a66">${r[0]}</text>`; }).join('')}
    </svg><p class="muted" style="text-align:center;margin:0 0 10px">${unit}${rows[0][1] && rows[1][1] ? ` · <b style="color:var(--plan)">${rows[1][1] - rows[0][1] >= 0 ? '+' : ''}${rows[1][1] - rows[0][1]}</b>` : ''}</p>`;
  }

  function More() {
    setPlanColour(null);
    return `<h1>More</h1>
    ${installCard(true)}
    <div class="card"><h3>Daily reminder</h3><p class="muted">Add a ten-minute slot to your phone's calendar every day, at a time that suits you.</p>
      <div class="row"><input type="time" id="rtime" value="${S.remind || '09:30'}" style="font:inherit;padding:12px;border-radius:12px;border:2px solid var(--line);min-height:56px"><button class="btn small" data-action="ics">Add to calendar</button></div></div>
    <div class="card"><h3>Text size</h3><div class="row">${['Normal', 'Large', 'Largest'].map((l, i) => `<button class="btn small ${S.size == i ? '' : 'ghost'}" data-action="size" data-v="${i}">${l}</button>`).join('')}</div></div>
    <div class="card"><h3>Already bought a plan?</h3><p class="muted">In the full app, you'll unlock it here with the licence key from your receipt. For now, your PDF is in your email.</p></div>
    <div class="card"><a class="btn ghost small" href="/">Read the stories on dontdieretired.com</a><div style="height:10px"></div><a class="btn ghost small" href="/newsletter/">Get the Sunday email</a></div>
    <div class="card"><p class="muted" style="font-size:.8em">Your progress is saved on this phone only. This is general information, not medical advice: check with your GP before starting a new exercise programme, and stop if anything hurts.</p><button class="btn ghost small" data-action="reset">Reset my progress</button></div>`;
  }

  // ---------- install ----------
  let deferredInstall = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  function installCard(always) {
    if (standalone()) return '';
    if (!always && totalSessions() < 1) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<div class="card install"><p class="kick">Keep it one tap away</p><h3>Add the app to your home screen</h3>
      ${deferredInstall ? `<button class="btn small" data-action="install">Add to home screen</button>`
        : ios ? `<p class="muted">Tap the <b>Share</b> button (the square with an arrow) at the bottom of Safari, then <b>Add to Home Screen</b>.</p>`
        : `<p class="muted">Open your browser's menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>`;
  }

  // ---------- session ----------
  let run = null, tick = null;
  function startSession(pid, idx, steps, label) {
    const p = plan(pid); setPlanColour(p);
    const day = idx != null ? p.days[idx] : null;
    if (day && day.test && !S.tests[pid]?.end) { location.hash = `#/test/${pid}/end?then=${idx}`; return; }
    run = { pid, idx, steps: steps || day.steps, i: 0, side: 0, label: label || (day ? `${day.day}${day.title !== day.day ? ' · ' + day.title : ''}` : '') };
    document.body.classList.add('in-session'); drawStep();
  }
  function drawStep() {
    clearInterval(tick);
    const r = run, s = r.steps[r.i];
    if (!s) return finish();
    const sides = s.each && s.secs ? 2 : 1;
    view.innerHTML = `<div class="step fade">
      <div class="progress">${r.steps.map((_, k) => `<i class="${k <= r.i ? 'on' : ''}"></i>`).join('')}</div>
      <p class="kick">${esc(r.label)} · ${r.i + 1} of ${r.steps.length}</p>
      <h1>${esc(s.name)}</h1>
      ${s.label.toLowerCase() !== s.name.toLowerCase() ? `<p class="muted" style="margin-top:-.3em">${esc(s.label)}</p>` : ''}
      ${s.secs ? `<div class="timer"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="#eee" stroke-width="8"/><circle id="ring" cx="50" cy="50" r="45" fill="none" stroke="var(--plan)" stroke-width="8" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="0"/></svg><b id="tleft">${fmt(s.secs)}</b></div>${sides > 1 ? `<p class="side" id="side">First side</p>` : ''}`
        : `<div class="target">${target(s)}</div>${s.each ? `<p class="side" style="text-align:left">each side</p>` : ''}`}
      ${s.how ? `<p class="how">${esc(s.how)}</p>` : ''}
      <div class="spacer"></div>
      ${s.secs ? `<button class="btn" data-action="timer">Start timer</button>` : `<button class="btn" data-action="next">Done ✓</button>`}
      <div class="row" style="margin-top:10px"><button class="btn ghost small" data-action="prev" ${r.i ? '' : 'disabled style="opacity:.4"'}>← Back</button><button class="btn ghost small" data-action="next">Skip</button></div>
      <button class="btn ghost small" style="margin-top:10px;border:0" data-action="quit">Stop for today</button>
    </div>`;
    window.scrollTo(0, 0);
  }
  const fmt = s => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
  function runTimer() {
    const s = run.steps[run.i], sides = s.each ? 2 : 1; let side = 0, left = s.secs;
    const ring = $('#ring'), tl = $('#tleft'), btn = $('[data-action=timer]');
    btn.textContent = 'Pause'; btn.dataset.action = 'pause'; beep(660);
    tick = setInterval(() => {
      if (run.paused) return;
      left--; tl.textContent = fmt(Math.max(left, 0)); ring.style.strokeDashoffset = 283 * (1 - left / s.secs);
      if (left <= 3 && left > 0) beep(520, 90);
      if (left <= 0) {
        side++; beep(990, 300); buzz([120, 80, 120]);
        if (side < sides) { left = s.secs; const sd = $('#side'); if (sd) sd.textContent = 'Now the other side'; ring.style.strokeDashoffset = 0; }
        else { clearInterval(tick); btn.textContent = 'Done ✓ Next'; btn.dataset.action = 'next'; }
      }
    }, 1000);
  }
  function finish() {
    clearInterval(tick);
    const r = run;
    view.innerHTML = `<div class="celebrate fade"><div class="big">🎉</div><h1>Session done</h1><p class="muted">That's ${r.idx != null ? esc(plan(r.pid).days[r.idx].day) : 'your 2-minute version'} ticked off. How did it feel?</p>
      <div class="faces">${['😣', '🙁', '😐', '🙂', '😄'].map((f, k) => `<button data-action="feel" data-v="${k + 1}" aria-label="${['Hard', 'Tough', 'OK', 'Good', 'Great'][k]}" aria-pressed="false">${f}</button>`).join('')}</div>
      <button class="btn" data-action="savefinish">Tick it off ✓</button></div>`;
    beep(784, 150); setTimeout(() => beep(1046, 250), 170); buzz(200);
  }
  function saveFinish() {
    const r = run, pp = P(r.pid);
    const idx = r.idx != null ? r.idx : nextIndex(plan(r.pid));
    if (idx < plan(r.pid).days.length) { pp.done[idx] = today(); if (r.feel) pp.feel[idx] = r.feel; }
    save(); run = null; document.body.classList.remove('in-session'); location.hash = '#/';
    render();
  }

  // ---------- sit-to-stand test ----------
  function Test(pid, which, then) {
    setPlanColour(plan(pid)); document.body.classList.add('in-session');
    return `<div class="fade"><p class="kick">${which === 'start' ? 'Day 0' : 'Day 7'} test</p><h1>30-second sit-to-stand</h1>
      <ol class="list" style="margin:0 0 16px">${['Sit in the middle of a firm chair, feet flat.', 'Cross your arms over your chest if you can (hands on thighs is fine).', 'When the timer starts, stand up fully and sit down fully, as many times as you comfortably can.', 'Tap the big button every time you stand. Or just count, and enter the number at the end.'].map((t, i) => `<li><span class="num">${i + 1}</span><span>${t}</span></li>`).join('')}</ol>
      <button class="tap" data-action="tapstart" id="tap">Start<small>30 seconds</small></button>
      <div id="after" hidden><h3>How many stands?</h3><div class="row"><button class="btn ghost small" data-action="adj" data-v="-1">−</button><div class="target" id="count" style="text-align:center">0</div><button class="btn ghost small" data-action="adj" data-v="1">+</button></div>
        <h3>How do you feel in your body today?</h3><input type="range" min="1" max="10" value="5" id="feel" aria-label="How you feel, 1 to 10"><p class="muted" style="display:flex;justify-content:space-between;margin:0"><span>1 stiff & tired</span><b id="feelv">5</b><span>10 loose & sure-footed</span></p>
        <div style="height:14px"></div><button class="btn" data-action="savetest" data-pid="${pid}" data-which="${which}" data-then="${then ?? ''}">Save my result</button></div>
      <button class="btn ghost small" style="margin-top:12px;border:0" data-action="quit">Cancel</button></div>`;
  }
  let tapN = 0, tapLive = false;
  function tapStart() {
    const b = $('#tap'); tapN = 0; tapLive = true; let left = 30;
    b.innerHTML = `0<small>tap each time you stand · ${left}s</small>`; b.dataset.action = 'tapcount'; beep(660);
    tick = setInterval(() => { left--; b.querySelector('small').textContent = `tap each time you stand · ${left}s`; if (left <= 3 && left > 0) beep(520, 90);
      if (left <= 0) { clearInterval(tick); tapLive = false; beep(990, 400); buzz([150, 80, 150]); b.hidden = true; $('#after').hidden = false; $('#count').textContent = tapN; } }, 1000);
  }

  // ---------- router ----------
  function render() {
    if (!DATA) return;
    $('#sheet').hidden = true;
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, q] = h.split('?'); const parts = path.split('/').filter(Boolean);
    document.querySelectorAll('.tabs a').forEach(a => a.removeAttribute('aria-current'));
    const tab = { '': 'today', plans: 'plans', plan: 'plans', progress: 'progress', more: 'more' }[parts[0] || ''];
    if (tab) $(`.tabs [data-tab=${tab}]`).setAttribute('aria-current', 'page');
    if (parts[0] !== 'session' && parts[0] !== 'test') { document.body.classList.remove('in-session'); clearInterval(tick); }
    let html;
    if (parts[0] === 'session') { const p = plan(parts[1]), i = +parts[2]; if (!isOpen(p, i)) { location.hash = `#/plan/${p.id}`; return; } return startSession(p.id, i); }
    if (parts[0] === 'test') html = Test(parts[1], parts[2], new URLSearchParams(q || '').get('then'));
    else if (parts[0] === 'plans') html = Plans();
    else if (parts[0] === 'plan') html = PlanView(parts[1]);
    else if (parts[0] === 'progress') html = Progress();
    else if (parts[0] === 'more') html = More();
    else html = Today();
    view.innerHTML = `<div class="fade">${html}</div>`; window.scrollTo(0, 0);
  }
  addEventListener('hashchange', render);

  // ---------- actions ----------
  document.addEventListener('input', e => { if (e.target.id === 'feel') $('#feelv').textContent = e.target.value; });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]'); if (!a) return;
    const act = a.dataset.action;
    if (act === 'locked') { e.preventDefault(); const p = plan(a.dataset.id); sheet(`<h2>Unlock ${esc(p.title)}</h2><p>You've got the first ${p.open_days} days free. The whole plan is ${p.price}, and your progress so far is kept.</p><a class="btn" href="${p.shop}">Unlock for ${p.price}</a><div style="height:10px"></div><button class="btn ghost small" data-close>Not now</button>`); }
    if (act === 'activate') { S.active = a.dataset.id; save(); location.hash = '#/'; }
    if (act === 'two') startSession(S.active, null, DATA.two_minute, '2-minute version');
    if (act === 'next') { clearInterval(tick); run.i++; drawStep(); }
    if (act === 'prev') { clearInterval(tick); run.i = Math.max(0, run.i - 1); drawStep(); }
    if (act === 'timer') runTimer();
    if (act === 'pause') { run.paused = !run.paused; a.textContent = run.paused ? 'Resume' : 'Pause'; }
    if (act === 'quit') { clearInterval(tick); run = null; document.body.classList.remove('in-session'); location.hash = '#/'; render(); }
    if (act === 'feel') { run.feel = +a.dataset.v; document.querySelectorAll('.faces button').forEach(b => b.setAttribute('aria-pressed', b === a)); }
    if (act === 'savefinish') saveFinish();
    if (act === 'tapstart') tapStart();
    if (act === 'tapcount' && tapLive) { tapN++; a.firstChild.nodeValue = tapN; beep(440, 60); buzz(30); }
    if (act === 'adj') { tapN = Math.max(0, tapN + +a.dataset.v); $('#count').textContent = tapN; }
    if (act === 'savetest') { const { pid, which, then } = a.dataset; (S.tests[pid] ||= {})[which] = { sts: tapN, feel: +$('#feel').value, date: today() }; save();
      if (then) { startSession(pid, +then); } else { document.body.classList.remove('in-session'); location.hash = '#/progress'; } }
    if (act === 'textsize') { S.size = (S.size + 1) % 3; document.documentElement.dataset.size = S.size; save(); }
    if (act === 'size') { S.size = +a.dataset.v; document.documentElement.dataset.size = S.size; save(); render(); }
    if (act === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
    if (act === 'ics') { const t = ($('#rtime').value || '09:30').replace(':', ''); S.remind = $('#rtime').value; save();
      const d = today().replace(/-/g, ''); const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dont Die Retired//App//EN', 'BEGIN:VEVENT', `UID:ddr-daily-${Date.now()}@dontdieretired.com`, `DTSTAMP:${d}T000000Z`, `DTSTART:${d}T${t}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY', "SUMMARY:Ten minutes for me (Don't Die Retired)", 'DESCRIPTION:Open the app: https://dontdieretired.com/app/', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Ten minutes for me', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); const l = document.createElement('a'); l.href = url; l.download = 'daily-reminder.ics'; l.click(); }
    if (act === 'reset' && confirm('Reset all your progress on this phone?')) { S = { active: 'restart7', size: S.size, plans: {}, tests: {}, unlocked: {} }; save(); render(); }
  });

  // ---------- boot ----------
  Promise.all([fetch('/app/data.json').then(r => r.json()), fetch('/index.json').then(r => r.json()).catch(() => [])])
    .then(([d, st]) => { DATA = d; STORIES = st; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
})();

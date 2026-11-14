// Account page (/account/): sign in by an emailed link (RUNBOOK §6t, day 12); on sign-in the list syncs (day 13). Talks only to the accounts Worker.
// The sign-in token arrives after "#" (never sent to any server by the browser); it is removed from the address
// at once and posted to the Worker, which spends it. The session lives in a cookie this script cannot read.
(function () {
  const box = document.querySelector('[data-acct]');
  if (!box || !box.dataset.api) return;
  const API = box.dataset.api.replace(/\/$/, '');
  const $ = s => box.querySelector(s);
  const parts = ['link', 'out', 'sent', 'in', 'bad'];
  function show(...which) {
    $('[data-acct-loading]').hidden = true; $('[data-acct-fail]').hidden = true;
    for (const p of parts) $(`[data-acct-${p}]`).hidden = !which.includes(p);
  }
  function focusOn(p) { const el = $(`[data-acct-${p}]`); if (el && el.tabIndex === -1) el.focus(); }
  function fail() { $('[data-acct-loading]').hidden = true; $('[data-acct-fail]').hidden = false; }
  async function call(path, body) {
    const init = { credentials: 'include', headers: {} };
    if (body !== undefined) { init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(API + path, init);
    let d = {}; try { d = await r.json(); } catch (e) { /* empty */ }
    return { status: r.status, d };
  }
  // Day 13: this device's list and plans go to the account (and the account's come here) through DDRList, which merges
  const L = window.DDRList;
  let who = '';
  const SAY = {
    'too-big': 'Your list is too large to keep on your account, so it is saved only in this browser for now. Please contact us.',
    'old-service': 'Your account needs an update before it can take this list. It is still saved in this browser; please try again tomorrow.',
    slow: 'Your list has been brought up to date many times in the last hour. It is still saved in this browser and will be sent later.',
  };
  async function syncNow(how) {
    const line = $('[data-acct-sync]'), other = $('[data-acct-other]'), first = $('[data-acct-first]'); if (!L || !line) return;
    other.hidden = true; first.hidden = true;
    line.textContent = 'Bringing your list and plans up to date…';
    const r = await L.account(true, who, how);
    if (r && r.reason === 'first-list') {   // day 20: a list that belongs to no account yet goes to one only when asked
      const n = L.live(L.load()).length;
      $('[data-acct-first-n]').textContent = n + (n === 1 ? ' thing' : ' things');
      $('[data-acct-first-email]').textContent = $('[data-acct-email]').textContent;
      line.textContent = '';
      first.hidden = false; first.focus();
      return;
    }
    if (r && r.reason === 'other-account') {   // a shared computer: never mix two people's lists without asking
      line.textContent = '';
      other.hidden = false; other.focus();
      return;
    }
    const keep = $('[data-acct-keep]'); if (keep) keep.hidden = !!(r && r.readonly);
    if (r && r.reason === 'readonly-keep') {
      line.textContent = 'This browser\'s list was left as it is: without Planner Plus your account does not keep lists, so it may be the other person\'s only copy. Use "Sign out and remove my list from this browser" only if they have finished with it.';
      return;
    }
    if (r && r.ok && r.readonly) {   // day 15: no Planner Plus, so the account keeps nothing new (it may hold plans from before)
      line.textContent = 'Keeping your list and plans on your account, and on every device, comes with Planner Plus. Until then they stay in this browser; anything your account already held has been brought here too.';
    } else if (r && r.ok) {
      const n = L.live(L.load()).length;
      line.textContent = n ? 'Your list and plans are up to date on your account (' + n + (n === 1 ? ' thing).' : ' things).') : 'Your list is empty. Anything you add or plan on this device will be kept on your account too.';
    } else if (r && r.reason === 'signed-out') { show('out'); }
    else if (r && SAY[r.reason]) line.textContent = SAY[r.reason];
    else line.textContent = 'We could not reach your account to bring your list up to date. It is still saved in this browser and will be sent next time.';
  }
  function signedOut() { if (L) L.account(false); feedClear(); }
  function signedIn(email, focus, account, me) {
    who = typeof account === 'string' ? account : '';
    feedClear();   // never leave another account's calendar address on show (a shared computer)
    $('[data-acct-email]').textContent = email;
    show('in'); if (focus) focusOn('in');
    syncNow();
    if (me) plusShow(me); else refreshPlus();
  }

  // Planner Plus (day 14): pay on Stripe's own page, manage or cancel on Stripe's portal. The Worker says whether
  // payments are open (a Stripe key is set) and what this account has; nothing here decides membership.
  const PLAN = { month: 'monthly', year: 'yearly' };
  const day = s => new Date(s * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let lastPlus = null;
  function plusShow(me) {
    const p = me.plus || { member: false }; lastPlus = p;
    const box = $('[data-acct-plus]'), state = $('[data-acct-plus-state]');
    const giftOnly = p.member && p.plan === 'gift';                       // a gift, with no plan set to follow it
    // near its end (45 days), a gift's member is asked whether to carry on (Robin, 7 Nov 2026); not before
    const giftEnding = giftOnly && p.until && p.until * 1000 - Date.now() < 45 * 86400000;
    const sub = p.plan === 'month' || p.plan === 'year';                  // a Stripe subscription, which the portal manages
    box.hidden = !(me.payments || p.member || p.status);
    $('[data-acct-plus-buy]').hidden = !(me.payments && (!p.member || giftEnding));
    $('[data-acct-plus-giftnote]').hidden = !giftEnding;
    // the Worker gives no trial with under three days left (Stripe needs 48 hours), so the first payment is then taken at once (review 12 Nov)
    if (giftEnding) $('[data-acct-plus-giftnote]').textContent = p.until * 1000 - Date.now() >= 3 * 86400000
      ? 'To carry on after your gift, you can choose a plan now: nothing is taken until ' + day(p.until) + ', when the gift ends, and you can cancel before then.'
      : 'To carry on after your gift, you can choose a plan now. Your gift ends on ' + day(p.until) + ', so the first payment is taken straight away.';
    $('[data-acct-plus-manage]').hidden = $('[data-acct-plus-note]').hidden = !(me.payments && sub && (p.member || p.status));
    const kind = PLAN[p.plan] ? ' (' + PLAN[p.plan] + ')' : '';
    if (p.member && p.gift_until && sub) state.textContent = 'You have Planner Plus as a gift until ' + day(p.gift_until) + '. ' + (p.ending ? 'You cancelled the plan that was to follow it, so you will not be charged.' : 'Your ' + PLAN[p.plan] + ' plan follows it: the first payment is taken on ' + day(p.until) + '.');
    else if (giftOnly) state.textContent = 'You have Planner Plus as a gift until ' + (p.until ? day(p.until) : 'the end of its twelve months') + '. It does not renew, so you will not be charged.';
    else if (p.member && p.status === 'past_due') state.textContent = 'You have Planner Plus' + kind + ', but your last payment did not go through. Stripe will try your card again; you can change it below.';
    else if (p.member && p.ending) state.textContent = 'You have Planner Plus' + kind + ' until ' + (p.until ? day(p.until) : 'the end of the time you have paid for') + '. It will not renew, and you will not be charged again.';
    else if (p.member) state.textContent = 'You have Planner Plus' + kind + '.' + (p.until ? ' It renews on ' + day(p.until) + '.' : '');
    else if (p.status) state.textContent = (p.plan === 'gift' ? 'Your gift of Planner Plus has ended.' : 'Your Planner Plus membership has ended.') + (me.payments ? ' You can join again below.' : '');
    else state.textContent = me.payments ? 'Planner Plus puts your year on one calendar on every device, with a dated plan for each thing you want to do.' : '';
    giftsShow(me);
    feedShow(me);
    return p;
  }

  // Day 17: the live calendar feed. The Worker says whether this account may have one (Plus, once the paywall is on),
  // whether one exists and when a calendar app last read it; the address itself is shown only once, when it is made.
  let feedKeep = false;   // keep the section on show after a stop, so its message and focus have somewhere to be
  function feedClear() {
    const pane = $('[data-acct-feed-new]'); if (!pane) return;
    pane.hidden = true; $('[data-acct-feed-url]').value = ''; $('[data-acct-feed-webcal]').setAttribute('href', '#'); $('[data-acct-feed-copied]').textContent = '';
  }
  function feedShow(me) {
    const f = me.feed, box = $('[data-acct-feed]'); if (!box) return;
    box.hidden = !f || !(f.ok || f.on || feedKeep);
    if (!f || !f.on) feedClear();
    if (box.hidden) return;
    $('[data-acct-feed-warn]').hidden = !f.on;
    const state = $('[data-acct-feed-state]'), mk = $('[data-acct-feed-make]');
    mk.hidden = !f.ok; $('[data-acct-feed-stop]').hidden = !f.on;
    mk.textContent = f.on ? 'Make a new address' : 'Make my calendar address';
    mk.classList.toggle('btn-ghost', !!f.on);   // with an address on, making another (which stops it) is not the main action
    if (!f.on) state.textContent = '';
    else if (!f.ok) state.textContent = 'Your calendar address has stopped updating because Planner Plus has ended on this account. It starts again by itself if you join again.';
    else state.textContent = 'Your calendar address is on. ' + (f.read ? 'A calendar last looked at it on ' + new Date(f.read + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '.' : 'No calendar has used it yet.');
  }
  const feedMk = $('[data-acct-feed-make]');
  if (feedMk) {
    feedMk.addEventListener('click', async () => {
      const state = $('[data-acct-feed-state]'); feedMk.disabled = true;
      try {
        const r = await call('/feed/make', {});
        if (r.status === 200 && r.d.ok && /^https:\/\/[^/]+\/feed\/[A-Za-z0-9_-]{43}\.ics$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/feed\/[A-Za-z0-9_-]{43}\.ics$/.test(r.d.url)) {
          const pane = $('[data-acct-feed-new]');
          $('[data-acct-feed-url]').value = r.d.url;
          $('[data-acct-feed-webcal]').href = r.d.url.replace(/^https?:/, 'webcal:');
          $('[data-acct-feed-copied]').textContent = '';
          pane.hidden = false;
          await refreshPlus();
          // whatever the refresh said, an address now exists
          pane.hidden = false; feedMk.textContent = 'Make a new address'; feedMk.classList.add('btn-ghost');
          $('[data-acct-feed-stop]').hidden = false; $('[data-acct-feed-warn]').hidden = false;
          state.textContent = 'Here is your new calendar address. Add it to your calendar now: it is shown only this once.';
          pane.focus();
        } else if (r.status === 401) show('out');
        else if (r.status === 403) state.textContent = 'A calendar that keeps itself up to date comes with Planner Plus.';
        else if (r.status === 429) state.textContent = 'You have made several addresses in the last hour. Please wait a while and try again.';
        else state.textContent = 'We could not make the address just now. Please try again in a few minutes.';
      } catch (e) { state.textContent = 'We could not reach your account. Check your connection and try again.'; }
      feedMk.disabled = false;
    });
    $('[data-acct-feed-copy]').addEventListener('click', async () => {
      const inp = $('[data-acct-feed-url]'), msg = $('[data-acct-feed-copied]');
      try { await navigator.clipboard.writeText(inp.value); msg.textContent = 'Copied. Paste it into your calendar app.'; }
      catch (e) { inp.focus(); inp.select(); msg.textContent = 'Selected: copy it with your device\'s Copy command.'; }
    });
    $('[data-acct-feed-stop]').addEventListener('click', async ev => {
      const btn = ev.currentTarget, state = $('[data-acct-feed-state]'); btn.disabled = true;
      try {
        const r = await call('/feed/stop', {});
        if (r.status === 200) {
          feedClear(); feedKeep = true;
          await refreshPlus();
          state.textContent = 'Your calendar address has stopped working. You can remove the calendar from your calendar app; nothing more will be added to it.';
          (feedMk.hidden ? $('#acct-feed-h') : feedMk).focus();
        } else if (r.status === 401) show('out');
        else state.textContent = 'We could not stop it just now. Please try again in a few minutes.';
      } catch (e) { state.textContent = 'We could not reach your account. Check your connection and try again.'; }
      btn.disabled = false;
    });
  }
  async function refreshPlus() {
    try { const r = await call('/auth/me'); if (r.status === 200 && r.d.signed_in) return plusShow(r.d); } catch (e) { /* keep what is shown */ }
    return lastPlus;
  }
  // Back from Stripe: ?plus=welcome or ?plus=cancelled (nothing else is ever in the address)
  const q = new URLSearchParams(location.search), back = q.get('plus'), giftBack = q.get('gift');
  if (back || giftBack) history.replaceState(null, '', location.pathname + location.hash);
  async function welcome() {
    const state = $('[data-acct-plus-state]');
    $('[data-acct-plus]').hidden = false;
    state.textContent = 'Thank you. Your payment went through; switching Planner Plus on…';
    for (let i = 0; i < 10; i++) {   // the webhook usually lands within seconds
      const p = await refreshPlus();
      if (p && p.member) { syncNow(); state.textContent = 'Thank you. Planner Plus is on.' + (PLAN[p.plan] ? ' You are on the ' + PLAN[p.plan] + ' plan' + (p.until ? ', renewing on ' + day(p.until) : '') + '.' : ''); return; }
      await new Promise(r => setTimeout(r, 2000));
    }
    state.textContent = 'Thank you. Stripe has your payment, but your membership has not reached your account yet. Refresh this page in a minute or two.';
  }
  async function toStripe(path, body, btn, where) {
    const state = $(where || '[data-acct-plus-state]'); btn.disabled = true;
    try {
      const r = await call(path, body);
      if (r.status === 200 && r.d.url) { location.assign(r.d.url); return; }
      if (r.status === 409) { await refreshPlus(); state.textContent = 'You already have Planner Plus.'; }
      else if (r.status === 401) { show('out'); return; }
      else if (r.status === 429) state.textContent = 'Too many tries in the last hour. Please wait a little and try again.';
      else state.textContent = 'We could not open the payment page just now. Nothing has been charged. Please try again in a few minutes.';
    } catch (e) { state.textContent = 'We could not reach the payment service. Check your connection and try again. Nothing has been charged.'; }
    btn.disabled = false;
  }
  box.querySelectorAll('[data-acct-buy]').forEach(b => b.addEventListener('click', () => toStripe('/plus/checkout', { plan: b.dataset.acctBuy }, b)));
  $('[data-acct-portal]').addEventListener('click', ev => toStripe('/plus/portal', {}, ev.currentTarget));

  // Gifts (day 16): buy on Stripe's page; the code then shows here with a card to print. Use a code: twelve months of Plus.
  let giftsOpen = false, giftsLoaded = false;
  function giftsShow(me) {
    $('[data-acct-redeem]').hidden = !me.payments;
    giftsOpen = !!me.gifts; $('[data-acct-gifts]').hidden = !giftsOpen;
    if (giftsOpen && !giftsLoaded) { giftsLoaded = true; loadGifts(); }
    if ('redeemFirst' in box.dataset && me.payments && !redeemMoved) {   // /redeem/: the code box comes first
      redeemMoved = true;
      const r = $('[data-acct-redeem]'), first = $('[data-acct-keep]'); first.parentNode.insertBefore(r, first);
      if (!lastPlus || !lastPlus.member) $('#acct-code').focus();
    }
  }
  let redeemMoved = false;
  function giftLine(g) {
    const li = document.createElement('li');
    const head = document.createElement('p'); head.className = 'meta';
    const st = g.status === 'paid' ? 'not used yet' : g.status === 'redeemed' ? 'used' + (g.used ? ' on ' + day(g.used) : '') : g.status === 'disputed' ? 'cancelled: the payment was disputed' : 'refunded';
    head.textContent = 'Bought ' + day(g.bought) + ' · ' + st;
    li.appendChild(head);
    if (g.status === 'paid' && g.code) {
      const code = document.createElement('p'); code.className = 'acct-giftcode'; code.textContent = g.code; li.appendChild(code);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-small'; b.textContent = 'Print the card';
      b.addEventListener('click', () => printCard(g.code)); li.appendChild(b);
    } else if (g.status === 'paid') {
      const x = document.createElement('p'); x.textContent = 'The code cannot be shown just now. Please contact us and we will help.'; li.appendChild(x);
    }
    return li;
  }
  async function loadGifts(waitFor) {   // waitFor: keep asking until there is a gift bought since then
    const list = $('[data-acct-gift-list]'), wrap = $('[data-acct-gift-mine]');
    for (let i = 0; i < (waitFor ? 10 : 1); i++) {
      try {
        const r = await call('/gift/mine', {});
        if (r.status === 200 && Array.isArray(r.d.gifts)) {
          if (waitFor && !r.d.gifts.some(g => g.bought >= waitFor)) { await new Promise(res => setTimeout(res, 2000)); continue; }
          list.textContent = ''; r.d.gifts.forEach(g => list.appendChild(giftLine(g)));
          wrap.hidden = !r.d.gifts.length;
          return r.d.gifts;
        }
      } catch (e) { /* try again below */ }
      if (waitFor) await new Promise(res => setTimeout(res, 2000));
    }
    return null;
  }
  function printCard(code) {
    const card = $('[data-gift-card]');
    card.querySelector('[data-gc-code]').textContent = code;
    const to = $('#gift-to').value.trim(), from = $('#gift-from').value.trim();
    const t = card.querySelector('[data-gc-to]'), f = card.querySelector('[data-gc-from]');
    t.textContent = to ? 'For ' + to : ''; t.hidden = !to;
    f.textContent = from ? 'With love from ' + from : ''; f.hidden = !from;
    // printed on its own: a copy sits directly in <body> while the page prints, and goes afterwards
    document.querySelectorAll('.gift-card-print').forEach(x => x.remove());
    const copy = card.cloneNode(true); copy.classList.add('gift-card-print'); document.body.appendChild(copy);
    document.documentElement.classList.add('gc-print');
    const done = () => { document.documentElement.classList.remove('gc-print'); copy.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }
  $('[data-acct-gift-buy]').addEventListener('click', ev => toStripe('/gift/checkout', {}, ev.currentTarget, '[data-acct-gift-state]'));
  async function giftThanks() {
    const state = $('[data-acct-gift-state]');
    state.textContent = 'Thank you. Your payment went through; your gift code is on its way here…';
    const gifts = await loadGifts(Math.floor(Date.now() / 1000) - 1800);   // one bought in the last half hour
    if (gifts) { state.textContent = 'Thank you. Your gift is ready below: print the card, or copy the code to send.'; const c = $('.acct-giftcode'); if (c) c.scrollIntoView({ block: 'center' }); }
    else state.textContent = 'Thank you. Stripe has your payment, but the gift code has not reached your account yet. Refresh this page in a minute or two.';
  }
  const REDEEM_SAY = {
    400: 'That does not look like a gift code. It has 16 letters and numbers, like ABCD-EFGH-JKMN-PQRS.',
    404: 'We could not find that code. Check each character: codes never use 0, O, 1, I or L.',
    410: 'This code is no longer valid. Please ask the person who gave it to you.',
    429: 'Too many tries in the last hour. Please wait a little and try again.',
    503: 'Gift codes cannot be used just now. Please try again later. Your code has not been used.',
  };
  const codeIn = $('#acct-code'), codeErr = $('[data-acct-code-err]'), codeOk = $('[data-acct-code-ok]');
  function codeSay(msg) { codeErr.textContent = msg; codeErr.hidden = !msg; codeIn.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (msg) codeIn.focus(); }
  $('[data-acct-redeem-form]').addEventListener('submit', async ev => {
    ev.preventDefault();
    const code = codeIn.value.trim();
    if (!code) return codeSay('Type the code from the card.');
    codeSay(''); codeOk.hidden = true;
    const btn = ev.currentTarget.querySelector('button'); btn.disabled = true;
    try {
      const r = await call('/gift/redeem', { code });
      if (r.status === 200 && r.d.ok) {
        codeIn.value = '';
        const later = r.d.from && r.d.from * 1000 > Date.now() + 60000;
        codeOk.textContent = later ? 'Done. Your gift starts on ' + day(r.d.from) + ', when the Planner Plus you already have ends, and runs until ' + day(r.d.until) + '.'
          : 'Done. You have Planner Plus until ' + day(r.d.until) + '. It does not renew, so you will not be charged.';
        codeOk.hidden = false; codeOk.scrollIntoView({ block: 'nearest' });   // day 20: it could land below the fold on a phone
        await refreshPlus(); syncNow();
      } else if (r.status === 401) show('out');
      else if (r.status === 409 && r.d.error === 'renewing') codeSay('You already pay for Planner Plus and it renews, so the gift would overlap it. Use "Cancel, switch plan or change card" to stop the renewal first: your Plus runs to the end of what you have paid for, and the gift\'s twelve months then start after that. Your code has not been used.');
      else if (r.status === 409) codeSay('This code has already been used.');
      else codeSay(REDEEM_SAY[r.status] || 'We could not check the code just now. Please try again in a few minutes. It has not been used.');
    } catch (e) { codeSay('We could not reach your account. Check your connection and try again. Your code has not been used.'); }
    btn.disabled = false;
  });

  // The token is spent only when the member presses the button, so email security scanners that open
  // links in a hidden browser cannot use it up first.
  let token = window.__ddrSignIn || '';
  try { delete window.__ddrSignIn; } catch (e) { window.__ddrSignIn = undefined; }
  async function finish() {
    const tok = token; token = '';
    const btn = $('[data-acct-finish]'); btn.disabled = true;
    try {
      const r = await call('/auth/verify', { token: tok });
      if (r.status === 200 && r.d.ok) return signedIn(r.d.email, true, r.d.account);
      if (r.status === 400) { show('bad', 'out'); return focusOn('bad'); }
    } catch (e) { /* fall through */ }
    btn.disabled = false; token = tok; fail();
  }
  async function begin() {
    const m = /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (m) { token = m[1]; history.replaceState(null, '', location.pathname + location.search); }
    if (token) { $('[data-acct-finish]').disabled = false; show('link'); return focusOn('link'); }   // a second link opened in this tab
    try {
      const r = await call('/auth/me');
      if (r.status !== 200) return fail();
      if (r.d.signed_in) {
        signedIn(r.d.email, false, r.d.account, r.d);
        if (back === 'welcome') welcome();
        if (giftBack === 'thanks') giftThanks();
        else if (giftBack === 'cancelled') $('[data-acct-gift-state]').textContent = 'You left the payment page. Nothing has been charged.';
        else if (back === 'cancelled') { $('[data-acct-plus]').hidden = false; $('[data-acct-plus-state]').textContent = 'You left the payment page. Nothing has been charged.'; }
      } else { signedOut(); show('out'); }
    } catch (e) { fail(); }
  }

  const form = $('[data-acct-form]'), err = $('[data-acct-err]'), input = $('#acct-email');
  function say(msg) { err.textContent = msg; err.hidden = !msg; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (msg) input.focus(); }
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = input.value.trim();
    if (!email || !input.checkValidity() || !/@.+\./.test(email)) return say('Type your full email address, for example name@example.com.');
    say('');
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const r = await call('/auth/start', { email });
      if (r.status === 200 && r.d.ok) {
        $('[data-acct-to]').textContent = email;
        const dev = $('[data-acct-dev]');
        dev.hidden = !r.d.dev_link;
        if (r.d.dev_link) $('[data-acct-devlink]').href = r.d.dev_link;
        show('sent'); focusOn('sent');
      } else if (r.status === 400) say('That does not look like an email address. Check it and try again.');
      else if (r.status === 429) say('Too many tries from this connection. Wait an hour and try again.');
      else say('We could not send the email just now. Please try again in a few minutes.');
    } catch (e) { say('We could not reach the sign-in service. Check your connection and try again.'); }
    btn.disabled = false;
  });
  $('[data-acct-finish]').addEventListener('click', finish);
  $('[data-acct-again]').addEventListener('click', () => { show('out'); input.focus(); });
  async function signOut(clear) {
    try { await call('/auth/signout', {}); signedOut(); if (clear && L) L.forget(); show('out'); input.focus(); } catch (e) { fail(); }
  }
  $('[data-acct-signout]').addEventListener('click', () => signOut(false));
  $('[data-acct-signout-clear]').addEventListener('click', () => signOut(true));
  $('[data-acct-replace]').addEventListener('click', () => syncNow('replace'));
  $('[data-acct-merge]').addEventListener('click', () => syncNow('merge'));
  $('[data-acct-first-add]').addEventListener('click', () => syncNow('merge'));
  $('[data-acct-first-no]').addEventListener('click', () => signOut(false));
  $('[data-acct-delete]').addEventListener('click', async () => {
    try {
      const r = await call('/auth/delete', { confirm: true });
      if (r.status === 200 || r.status === 401) { signedOut(); show('out'); input.focus(); }
      else if (r.status === 502) { $('[data-acct-plus-state]').textContent = 'We could not reach Stripe to end your Planner Plus, so nothing has been deleted yet. Please try again in a few minutes.'; $('[data-acct-plus]').hidden = false; }
      else fail();
    } catch (e) { fail(); }
  });
  window.addEventListener('hashchange', begin);
  begin();
})();

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
    const line = $('[data-acct-sync]'), other = $('[data-acct-other]'); if (!L || !line) return;
    other.hidden = true;
    line.textContent = 'Bringing your list and plans up to date…';
    const r = await L.account(true, who, how);
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
  function signedOut() { if (L) L.account(false); }
  function signedIn(email, focus, account, me) {
    who = typeof account === 'string' ? account : '';
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
    box.hidden = !(me.payments || p.member || p.status);
    $('[data-acct-plus-buy]').hidden = !(me.payments && !p.member);
    $('[data-acct-plus-manage]').hidden = $('[data-acct-plus-note]').hidden = !(me.payments && (p.member || p.status));
    const kind = PLAN[p.plan] ? ' (' + PLAN[p.plan] + ')' : '';
    if (p.member && p.status === 'past_due') state.textContent = 'You have Planner Plus' + kind + ', but your last payment did not go through. Stripe will try your card again; you can change it below.';
    else if (p.member && p.ending) state.textContent = 'You have Planner Plus' + kind + ' until ' + (p.until ? day(p.until) : 'the end of the time you have paid for') + '. It will not renew, and you will not be charged again.';
    else if (p.member) state.textContent = 'You have Planner Plus' + kind + '.' + (p.until ? ' It renews on ' + day(p.until) + '.' : '');
    else if (p.status) state.textContent = 'Your Planner Plus membership has ended.' + (me.payments ? ' You can join again below.' : '');
    else state.textContent = me.payments ? 'Planner Plus puts your year on one calendar on every device, with a dated plan for each thing you want to do.' : '';
    return p;
  }
  async function refreshPlus() {
    try { const r = await call('/auth/me'); if (r.status === 200 && r.d.signed_in) return plusShow(r.d); } catch (e) { /* keep what is shown */ }
    return lastPlus;
  }
  // Back from Stripe: ?plus=welcome or ?plus=cancelled (nothing else is ever in the address)
  const back = new URLSearchParams(location.search).get('plus');
  if (back) history.replaceState(null, '', location.pathname + location.hash);
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
  async function toStripe(path, body, btn) {
    const state = $('[data-acct-plus-state]'); btn.disabled = true;
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
    if (token) { show('link'); return focusOn('link'); }
    try {
      const r = await call('/auth/me');
      if (r.status !== 200) return fail();
      if (r.d.signed_in) {
        signedIn(r.d.email, false, r.d.account, r.d);
        if (back === 'welcome') welcome();
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

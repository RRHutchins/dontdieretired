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
    if (r && r.ok) {
      const n = L.live(L.load()).length;
      line.textContent = n ? 'Your list and plans are up to date on your account (' + n + (n === 1 ? ' thing).' : ' things).') : 'Your list is empty. Anything you add or plan on this device will be kept on your account too.';
    } else if (r && r.reason === 'signed-out') { show('out'); }
    else if (r && SAY[r.reason]) line.textContent = SAY[r.reason];
    else line.textContent = 'We could not reach your account to bring your list up to date. It is still saved in this browser and will be sent next time.';
  }
  function signedOut() { if (L) L.account(false); }
  function signedIn(email, focus, account) {
    who = typeof account === 'string' ? account : '';
    $('[data-acct-email]').textContent = email;
    show('in'); if (focus) focusOn('in');
    syncNow();
  }

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
      if (r.d.signed_in) signedIn(r.d.email, false, r.d.account); else { signedOut(); show('out'); }
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
      if (r.status === 200 || r.status === 401) { signedOut(); show('out'); input.focus(); } else fail();
    } catch (e) { fail(); }
  });
  window.addEventListener('hashchange', begin);
  begin();
})();

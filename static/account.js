// Account page (/account/): sign in by an emailed link (RUNBOOK §6t, day 12). Talks only to the accounts Worker.
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
  function signedIn(email, focus) {
    $('[data-acct-email]').textContent = email;
    show('in'); if (focus) focusOn('in');
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
      if (r.status === 200 && r.d.ok) return signedIn(r.d.email, true);
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
      if (r.d.signed_in) signedIn(r.d.email); else show('out');
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
  $('[data-acct-signout]').addEventListener('click', async () => {
    try { await call('/auth/signout', {}); show('out'); input.focus(); } catch (e) { fail(); }
  });
  $('[data-acct-delete]').addEventListener('click', async () => {
    try {
      const r = await call('/auth/delete', { confirm: true });
      if (r.status === 200 || r.status === 401) { show('out'); input.focus(); } else fail();
    } catch (e) { fail(); }
  });
  window.addEventListener('hashchange', begin);
  begin();
})();

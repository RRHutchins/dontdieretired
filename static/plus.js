/* Planner Plus membership in the browser (RUNBOOK §6t, day 15). DDRPlus.access() → Promise of
   'open'   no paywall yet (site.yaml → plus.paywall false): the planner works for everyone, as before launch;
   'member' this device is signed in to an account that has Planner Plus;
   'guest'  anyone else: the free "Plan it yourself" links, the sample plan and the price; saved plans read-only.
   Membership is decided by the accounts Worker (/auth/me, from Stripe through the signed webhook); this file only asks.
   The paywall is a door, not a lock: the planner runs in the browser, so someone determined could open it. What Plus
   keeps on the server (the list and plans on the account, every device) is checked by the Worker itself.
   decide() is PURE and tested in tools/test_planner.js. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DDRPlus = m;
})(typeof self !== 'undefined' ? self : this, function () {
  // o: { paywall, api, known (this device has signed in before), me (the Worker's /auth/me answer, or null if it
  // could not be reached), last ('1' if the account had Plus the last time this device heard) }
  function decide(o) {
    o = o || {};
    if (!o.paywall) return 'open';
    if (!o.api || !o.known) return 'guest';
    if (o.me && typeof o.me === 'object') return o.me.signed_in && o.me.plus && o.me.plus.member === true ? 'member' : 'guest';
    return o.last === '1' ? 'member' : 'guest';   // offline: what this device last heard, so a member is not locked out of their plans
  }
  let pending = null;
  function access() {
    if (pending) return pending;
    pending = (async () => {
      if (typeof document === 'undefined') return 'open';
      const pm = document.querySelector('meta[name="ddr-plus"]'), am = document.querySelector('meta[name="ddr-accounts"]');
      const paywall = !!pm && pm.getAttribute('content') === 'paywall', api = am ? (am.getAttribute('content') || '').replace(/\/$/, '') : '';
      const L = typeof window !== 'undefined' ? window.DDRList : null, flag = n => (L && L.flag ? L.flag(n) : null);
      const known = flag('acct') === '1' || !!flag('acct_owner');   // never asks the Worker for a reader who has never signed in here
      let me = null;
      if (paywall && api && known) {
        try {
          const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), 8000);
          const r = await fetch(api + '/auth/me', { credentials: 'include', signal: ctl ? ctl.signal : undefined });
          if (t) clearTimeout(t);
          if (r.ok) me = await r.json();
        } catch (e) { me = null; }
        if (me && L && L.flag) L.flag('plus', me.signed_in && me.plus && me.plus.member ? '1' : '');
      }
      return decide({ paywall, api, known, me, last: flag('plus') });
    })();
    return pending;
  }
  return { decide, access };
});

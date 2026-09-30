/* "Your say": interests, votes and suggestions. Talks to /api (Cloudflare Pages Function). */
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const API = (window.DDR_SAY && DDR_SAY.api) || '/api';
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const track = (n, p) => { if (window.plausible) plausible(n, { props: p }); };
  let cid = store.get('ddr_cid');
  if (!cid) { cid = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); store.set('ddr_cid', cid); }
  const myVotes = new Set(JSON.parse(store.get('ddr_votes') || '[]'));
  const myInterests = new Set(JSON.parse(store.get('ddr_interests') || '[]'));
  let live = false;

  const post = (path, body) => fetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid, ...body }) })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));

  function paint(counts) {
    const v = (counts && counts.votes) || {};
    const max = Math.max(1, ...Object.values(v));
    $$('[data-proposal]').forEach(el => {
      const id = el.dataset.proposal, n = v[id] || 0;
      const c = $(`[data-count="${id}"]`); if (c) c.textContent = live ? (n === 1 ? '1 vote' : `${n} votes`) : '';
      const b = $(`[data-bar="${id}"]`); if (b) b.style.width = live ? `${Math.round(n / max * 100)}%` : '0';
    });
    // most-voted first, so the page reads like a live shortlist
    const box = $('.proposals');
    if (box && live) [...box.children].sort((a, b) => (v[b.dataset.proposal] || 0) - (v[a.dataset.proposal] || 0)).forEach(x => box.appendChild(x));
  }
  function setPressed() {
    $$('[data-vote]').forEach(b => b.setAttribute('aria-pressed', myVotes.has(b.dataset.vote)));
    $$('[data-interest]').forEach(b => b.setAttribute('aria-pressed', myInterests.has(b.dataset.interest)));
  }
  function offline() {
    live = false; const n = $('[data-say-offline]'); if (n) n.hidden = false;
    $$('.say-block button, .say-block textarea, .say-block input, .say-block select').forEach(x => x.disabled = true);
  }

  setPressed();
  fetch(`${API}/say`).then(r => r.ok ? r.json() : Promise.reject()).then(c => { live = true; paint(c); }).catch(offline);

  $$('[data-vote]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.vote, on = !myVotes.has(id);
    on ? myVotes.add(id) : myVotes.delete(id); store.set('ddr_votes', JSON.stringify([...myVotes])); setPressed();
    post('vote', { id, on }).then(paint).catch(() => { on ? myVotes.delete(id) : myVotes.add(id); store.set('ddr_votes', JSON.stringify([...myVotes])); setPressed(); });
    track('say_vote', { id, on: on ? 1 : 0 });
  }));

  let t; const st = $('[data-interest-status]');
  $$('[data-interest]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.interest; myInterests.has(id) ? myInterests.delete(id) : myInterests.add(id);
    store.set('ddr_interests', JSON.stringify([...myInterests])); setPressed();
    clearTimeout(t); t = setTimeout(() => post('interests', { ids: [...myInterests] }).then(() => { if (st) st.textContent = 'Saved. Thank you.'; }).catch(() => { if (st) st.textContent = "Couldn't save just now. Please try again later."; }), 800);
  }));

  const f = $('[data-suggest]');
  if (f) f.addEventListener('submit', e => {
    e.preventDefault();
    const s = $('[data-suggest-status]'), btn = $('button[type=submit]', f), d = Object.fromEntries(new FormData(f));
    btn.disabled = true;
    post('suggest', d).then(() => { f.reset(); s.textContent = "Thank you. We've got it, and we read every one."; track('say_suggest', { kind: d.kind }); })
      .catch(() => { s.textContent = "Sorry, that didn't send. Please try again in a minute."; })
      .finally(() => { btn.disabled = false; });
  });
})();

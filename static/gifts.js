/* Gift ideas (RUNBOOK §6v): shortlist, sharing a card, and the shortlist page (your own, or one someone sent).
   The shortlist is kept in this browser only (localStorage "ddr_gifts"); a shared list travels in the link itself:
   /gifts/shared/?k=ideas|hint&g=id.id.id&n=Name. Nothing is sent to us. The name is only ever shown as text. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const KEY = 'ddr_gifts', MAX = 30, ID = /^[a-z0-9-]{1,80}$/;
  const track = (name, props) => { try { if (window.plausible) window.plausible(name, { props }); } catch {} };
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => ID.test(x)).slice(0, MAX) : []; } catch { return []; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {} };
  let list = load();
  const live = $('[data-gift-live]');
  const say = t => { if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 50); } };

  function paint() {
    $$('[data-gift-save]').forEach(b => {
      const on = list.includes(b.dataset.giftSave);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Saved' : 'Save to shortlist';
    });
    const bar = $('[data-gift-bar]');
    if (bar) { bar.hidden = !list.length; $('[data-gift-count]', bar).textContent = list.length === 1 ? '1 idea' : list.length + ' ideas'; }
  }
  function toggle(id) {
    if (list.includes(id)) { list = list.filter(x => x !== id); say('Removed from your shortlist'); }
    else if (list.length >= MAX) { say('Your shortlist is full (' + MAX + ' ideas). Remove one first.'); return; }
    else { list.push(id); say('Saved to your shortlist'); track('gift_save', { id }); }
    save(list); paint();
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-gift-save]');
    if (s) { toggle(s.dataset.giftSave); if (mode === 'mine') render(); return; }
    const sh = e.target.closest('[data-gift-share]');
    if (sh) shareOne(sh);
  });
  window.addEventListener('storage', e => { if (e.key === KEY) { list = load(); paint(); } });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; } }
  }
  async function shareOne(btn) {
    const url = btn.dataset.giftShare, title = btn.dataset.title + ': a present idea';
    if (navigator.share) { try { await navigator.share({ title, text: title, url }); track('share', { via: 'device', kind: 'gift' }); } catch {} return; }
    const ok = await copy(url);
    const was = btn.textContent; btn.textContent = ok ? 'Link copied' : 'Copy failed'; say(ok ? 'Link copied' : 'Could not copy the link');
    if (ok) track('share', { via: 'Copy link', kind: 'gift' });
    setTimeout(() => { btn.textContent = was; }, 2200);
  }

  /* ---------- the shortlist page ---------- */
  const page = $('[data-gs-list]');
  const qs = new URLSearchParams(location.search);
  const got = (qs.get('g') || '').split('.').filter(x => ID.test(x)).slice(0, MAX);
  const mode = page ? (got.length ? 'received' : 'mine') : '';
  const kind = qs.get('k') === 'hint' ? 'hint' : 'ideas';
  const who = (qs.get('n') || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
  let DATA = null;

  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const k in attrs) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); } kids.forEach(k => k && n.append(k)); return n; };
  const aff = (href, kind) => (window.DDR && DDR.affUrl) ? DDR.affUrl(href, kind) : href;
  function card(x) {
    const li = el('li', { class: 'gift', id: x.id, 'data-cat': x.category });
    if (x.photo) li.append(el('img', { class: 'gift-photo', src: x.photo, alt: x.photo_alt || '', width: '800', height: '450', loading: 'lazy' }));
    const b = el('div', { class: 'gift-body' });
    b.append(el('p', { class: 'kicker', text: (DATA.groups[x.groups[0]] || '') + (x.free ? ' · Free to do' : '') + (x.book.length ? ' · Can be booked' : '') }));
    b.append(el('h3', { text: x.gift }));
    const why = el('p', { class: 'gift-why' }); why.append(el('strong', { text: "Why they'd love it. " }), x.why); b.append(why);
    const d = el('details', { class: 'gift-ways' }); d.append(el('summary', { text: 'Ways to give it' }));
    if (x.book.length) {
      const w = el('div', { class: 'gift-way' }); w.append(el('h4', { text: 'Book it for them' }));
      const ul = el('ul'); x.book.forEach(k => { const a = el('a', { href: aff(k.url, k.aff || ''), rel: 'sponsored nofollow noopener', target: '_blank', text: k.label }); const l = el('li'); l.append(a, ': ' + k.why); ul.append(l); });
      w.append(ul); d.append(w);
    }
    if (x.free) d.append(el('div', { class: 'gift-way' }, el('h4', { text: 'Give your company' }), el('p', { text: 'It costs nothing to do, so the present can be a promise to go with them, with something from the kit list.' })));
    if (x.picks) {
      const w = el('div', { class: 'gift-way gift-picks' }); w.append(el('h4', { text: x.kit_title }));
      const ul = el('ul', { class: 'gift-tiers' });
      x.picks.options.forEach(o => {
        const l = el('li', { class: 'pick-' + o.tier });
        l.append(el('p', { class: 'pick-tier', text: { top: 'Top pick', good: 'Also recommended', value: 'Lower-cost pick' }[o.tier] }), el('p', {}, el('strong', { text: o.name })),
          el('p', { class: 'pick-label', text: o.reviewer + ': “' + o.label + '”' }), el('blockquote', {}, el('p', { text: '“' + o.quote + '”' })));
        const pl = el('p', { class: 'pick-links' }); pl.append(el('a', { href: o.review.url, target: '_blank', rel: 'noopener', text: 'Read the review' }), ' ', el('a', { class: 'btn btn-small btn-ghost', href: aff(o.buy, 'amazon'), rel: 'sponsored nofollow noopener', target: '_blank', text: 'Find it on Amazon' }));
        l.append(pl); ul.append(l);
      });
      w.append(ul, el('p', { class: 'gift-note', text: 'Chosen and described by the independent reviewers named, in their words; we have not tested these. Reviews checked ' + x.picks.checked_human + '.' })); d.append(w);
    } else if (x.kit.length) {
      const w = el('div', { class: 'gift-way' }); w.append(el('h4', { text: x.kit_title }));
      const ul = el('ul'); x.kit.forEach(k => { const l = el('li'); l.append(el('a', { href: aff(k.url, 'amazon'), rel: 'sponsored nofollow noopener', target: '_blank', text: k.name }), ': ' + k.why); ul.append(l); });
      w.append(ul); d.append(w);
    }
    d.append(el('div', { class: 'gift-way' }, el('h4', { text: 'Where to start' }), el('p', {}, el('a', { href: x.where.url, target: '_blank', rel: 'noopener', text: x.where.label }))));
    b.append(d);
    const act = el('div', { class: 'gift-actions' });
    act.append(el('a', { class: 'gift-guide', href: x.url, text: 'Full guide: ' + x.title + ' →' }), el('button', { type: 'button', class: 'chip gift-save', 'data-gift-save': x.id, 'aria-pressed': 'false', text: 'Save to shortlist' }));
    b.append(act); li.append(b);
    return li;
  }
  function linkFor() {
    const k = ($('input[name="gk"]:checked') || {}).value === 'hint' ? 'hint' : 'ideas';
    const n = ($('[data-gs-name]') || {}).value || '';
    const p = new URLSearchParams({ k, g: list.join('.') }); if (n.trim()) p.set('n', n.trim().slice(0, 30));
    return { url: location.origin + '/gifts/shared/?' + p.toString(), k, n: n.trim() };
  }
  function message(l) {
    return l.k === 'hint' ? 'Dropping a hint: any of these would make a lovely present for me' + (l.n ? ' (' + l.n + ')' : '') + '. '
                          : 'Some present ideas for you to look at' + (l.n ? ', from ' + l.n : '') + '. ';
  }
  function wireSend() {
    const box = $('[data-gs-send]'); if (!box) return;
    const upd = () => { const l = linkFor(); $('[data-gs-wa]').href = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(message(l) + l.url);
      $('[data-gs-mail]').href = 'mailto:?subject=' + encodeURIComponent(l.k === 'hint' ? 'A hint for presents' : 'Some present ideas') + '&body=' + encodeURIComponent(message(l) + '\n\n' + l.url); };
    box.addEventListener('input', upd); box.addEventListener('change', upd); upd();
    $('[data-gs-wa]').addEventListener('click', () => track('gift_list_share', { via: 'WhatsApp', k: linkFor().k, n: list.length }));
    $('[data-gs-mail]').addEventListener('click', () => track('gift_list_share', { via: 'Email', k: linkFor().k, n: list.length }));
    const dev = $('[data-gs-device]');
    if (navigator.share) { dev.hidden = false; dev.addEventListener('click', async () => { const l = linkFor(); try { await navigator.share({ title: l.k === 'hint' ? 'A hint for presents' : 'Present ideas', text: message(l), url: l.url }); track('gift_list_share', { via: 'device', k: l.k, n: list.length }); } catch {} }); }
    const cp = $('[data-gs-copy]');
    cp.addEventListener('click', async () => { const ok = await copy(linkFor().url); cp.textContent = ok ? 'Link copied' : 'Copy failed'; say(ok ? 'Link copied' : 'Could not copy the link'); if (ok) track('gift_list_share', { via: 'Copy link', k: linkFor().k, n: list.length }); setTimeout(() => { cp.textContent = 'Copy link'; }, 2200); });
  }
  function render() {
    if (!DATA) return;
    const ids = (mode === 'received' ? got : list).filter(id => DATA.ideas[id]);
    const ul = page; ul.textContent = '';
    ids.forEach(id => ul.append(card(DATA.ideas[id])));
    if (mode === 'mine') {
      $('[data-gs-title]').textContent = 'Your gift shortlist';
      $('[data-gs-lead]').textContent = ids.length ? 'Send it as ideas for someone, or as a hint for yourself. Press Saved to take an idea off.' : '';
      $('[data-gs-send]').hidden = !ids.length; $('[data-gs-empty]').hidden = !!ids.length;
      $('[data-gs-send]').dispatchEvent(new Event('change'));   // keep the WhatsApp and email links in step with the list
    }
    paint();
  }
  if (page) {
    if (mode === 'received') {
      $('[data-gs-title]').textContent = kind === 'hint' ? (who ? who + ' dropped a hint' : 'Someone dropped a hint') : (who ? 'Present ideas from ' + who : 'Present ideas for you');
      $('[data-gs-lead]').textContent = kind === 'hint' ? 'Any of these would make a good present. Open “Ways to give it” for bookings, kit and where to start.' : 'Have a look through. Open “Ways to give it” for bookings, kit and where to start.';
      const keep = $('[data-gs-keep]'); keep.hidden = false;
      $('[data-gs-keep-btn]').addEventListener('click', e => { got.forEach(id => { if (!list.includes(id) && list.length < MAX) list.push(id); }); save(list); paint(); e.target.textContent = 'Saved to your shortlist'; track('gift_list_keep', { n: got.length }); });
      track('gift_list_open', { k: kind, n: got.length });
    }
    fetch('/gifts/gifts.json').then(r => r.json()).then(d => { DATA = d; render(); if (mode === 'mine') wireSend(); })
      .catch(() => { $('[data-gs-lead]').textContent = 'The list could not be loaded. Try again, or browse the gift ideas.'; });
  }
  paint();
})();

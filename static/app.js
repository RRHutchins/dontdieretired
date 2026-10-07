/* Don't Die Retired — front-end behaviour
   1. Consent banner → loads ads only after consent
   2. Audience targeting → reader picks a profile, stored locally, content reordered
   3. Affiliate tagging + event tracking (Plausible custom events)
   4. In-article ad injection after paragraph 3 (when ads enabled)
*/
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const track = (name, props) => { if (window.plausible) window.plausible(name, { props }); };

  /* ---------- 0. arrived from a friend's share? ----------
     Share buttons add ?via=friend to the link. We note it for this visit, then tidy the address bar
     so a bookmark or an onward share is clean. Nothing identifies the friend or the sender. */
  const qs = new URLSearchParams(location.search);
  const sess = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const viaFriend = qs.get('via') === 'friend';
  if (viaFriend) {
    sess.set('ddr_friend', '1');
    qs.delete('via');
    try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch {}
  }
  const friendVisit = sess.get('ddr_friend') === '1';

  /* ---------- 1. consent ---------- */
  const consent = $('#consent');
  const consentState = store.get('ddr_consent');
  if (window.DDR.ads.enabled && !consentState && consent) consent.hidden = false;
  $$('[data-consent]').forEach(b => b.addEventListener('click', () => {
    store.set('ddr_consent', b.dataset.consent);
    consent.hidden = true;
    if (b.dataset.consent === 'all') loadAds();
    track('consent', { choice: b.dataset.consent });
  }));
  function loadAds() {
    if (!window.DDR.ads.enabled || !window.adsbygoogle) return;
    // Non-personalised ads unless user accepted all
    if (store.get('ddr_consent') !== 'all') { (adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = 1; }
    $$('ins.adsbygoogle').forEach(() => (adsbygoogle = window.adsbygoogle || []).push({}));
  }
  if (consentState) loadAds();

  /* ---------- 4. in-article ad injection ---------- */
  if (window.DDR.ads.enabled && window.DDR.ads.adsense_client) {
    const prose = $('[data-ad-inject]');
    if (prose) {
      const ps = $$('p', prose);
      if (ps.length > 6) {
        const ad = document.createElement('div');
        ad.className = 'ad ad-in_article';
        ad.innerHTML = `<span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="${DDR.ads.adsense_client}" data-ad-slot="${DDR.ads.slots.in_article}"></ins>`;
        ps[3].after(ad);
      }
    }
  }

  /* ---------- 2. personal profile: fitness level, age band, interests ----------
     Stored in this browser only (shared with the app at /app/). Used to pick and order stories,
     choose which "Try this" a reader sees, and tag newsletter sign-ups so emails match. */
  const LEVELS = { starter: 'getting going', active: 'active', advanced: 'fit and after a challenge' };
  const AGE_MID = { u50: 44, u55: 52, '55-64': 60, '65-74': 70, '75plus': 80 };
  const PLANS = {
    starter: ['Walk 10 minutes after one meal a day. Same time each day.', 'Twice a day, stand up from a chair five times without using your hands.', 'Ask your GP or pharmacist one question: "What can I safely do more of?"', 'Tell one person what you\'re doing. It doubles the odds you keep going.'],
    active: ['Pick a goal with a date on it: a 5k, a 1k open-water swim, a 50-mile ride, a hill you haven\'t climbed.', 'Add two strength sessions a week. It\'s the thing most active people skip, and the thing that protects everything else.', 'Join a club or masters group. Other people are the best training plan there is.', 'Track one number (time, distance or weight lifted) and beat it slowly.'],
    advanced: ['Enter something at least 12 weeks away: a triathlon, a fell race, a masters meet, a long-distance trail.', 'Lift heavy twice a week: few reps, good form, more load over time. It protects speed and power.', 'Book one coached skill session a week: technique, open water, track, climbing wall.', 'Plan recovery like training: sleep, an easier week every fourth, protein at every meal.'],
  };
  const readProfile = () => {
    let p = {}; try { p = JSON.parse(store.get('ddr_profile') || '{}'); } catch {}
    try { p.interests = JSON.parse(store.get('ddr_interests') || '[]'); } catch { p.interests = []; }
    // carry over the old "reader type" choice
    if (!p.level) { const old = store.get('ddr_segment'); if (old === 'restarter') p.level = 'starter'; else if (old === 'mover') p.level = 'active'; }
    return p;
  };
  const saveProfile = p => { store.set('ddr_profile', JSON.stringify({ level: p.level || '', age: p.age || '' })); store.set('ddr_interests', JSON.stringify(p.interests || [])); };
  const hasProfile = p => !!(p.level || p.age || (p.interests || []).length);
  let profile = readProfile();
  let fb = {}; try { fb = JSON.parse(store.get('ddr_fb') || '{}'); } catch {}   // per-topic nudges from "Was this for you?"

  // How well does an article fit this reader? Higher is better.
  function fit(a, p, rank) {
    let s = Math.max(0, 2 - (rank || 0) * 0.1);                       // newer first, gently
    if ((p.interests || []).includes(a.category)) s += 4;
    s += (fb[a.category] || 0);
    const al = a.level || 'any', pl = p.level;
    if (pl && al !== 'any') {
      if (al === pl) s += 3;
      else if (al === 'starter') s -= 6;                               // no beginner advice for people who are already fit
      else if (pl === 'starter' && al === 'advanced') s -= 1;
      else s += 1;
    }
    const mid = AGE_MID[p.age];
    if (mid && a.age) { const d = a.age - mid; if (d >= -10 && d <= 12) s += 2; else if (d > 20) s -= 3; }
    return s;
  }
  const cardHTML = a => `<article class="card"><a class="card-img" href="${a.url}" aria-hidden="true" tabindex="-1"><img src="${a.art || a.image}" alt="" loading="lazy" width="1200" height="630"></a><div class="card-body"><p class="kicker">${a.category}</p><h3><a href="${a.url}">${a.title}</a></h3><p>${a.excerpt}</p></div></article>`;

  function applyProfile() {
    profile = readProfile();
    const on = hasProfile(profile);
    document.body.dataset.level = profile.level || '';
    $$('[data-profile-label]').forEach(el => el.textContent = profile.level ? LEVELS[profile.level] : 'you');
    $$('[data-profile-form]').forEach(f => {
      $$('[data-level]', f).forEach(b => b.setAttribute('aria-pressed', b.dataset.level === profile.level));
      $$('[data-age]', f).forEach(b => b.setAttribute('aria-pressed', b.dataset.age === profile.age));
      $$('[data-interest]', f).forEach(b => b.setAttribute('aria-pressed', (profile.interests || []).includes(b.dataset.interest)));
    });
    // "Try this": show the version that matches the reader
    const hasPlus = !!$('[data-try="plus"]');
    $$('[data-try]').forEach(el => { el.hidden = el.dataset.try === 'plus' ? profile.level === 'starter' : (hasPlus && (profile.level === 'active' || profile.level === 'advanced')); });
    $$('[data-try-label]').forEach(el => el.hidden = !!profile.level);
    if (!on) return;
    const plan = $('[data-plan]');
    if (plan && profile.level) { plan.innerHTML = '<ol>' + PLANS[profile.level].map(t => `<li>${t}</li>`).join('') + '</ol>'; const sec = $('#plan'); if (sec) sec.hidden = false; }
    const holder = $('[data-for-you]');
    if (holder) fetch('/index.json').then(r => r.json()).then(idx => {
      const picks = idx.map((a, i) => [fit(a, profile, i), a]).sort((x, y) => y[0] - x[0]).slice(0, 6).map(x => x[1]);
      holder.innerHTML = picks.map(cardHTML).join('');
      const sec = $('#for-you'); if (sec) sec.hidden = false;
      const hero = $('[data-hero-card]');   // lead with the reader's best match, not just the newest story
      if (hero && picks[0]) { const p = picks[0], sub = $('[data-hero-sub]', hero); hero.href = p.url; $('strong', hero).textContent = p.title; $('.kicker', hero).textContent = 'Picked for you'; if (sub) sub.textContent = p.excerpt; hero.dataset.cat = p.category; }
    }).catch(() => {});
    // category pages: best matches first
    $$('[data-personalise]').forEach(g => [...g.children].map((c, i) => [fit({ category: c.dataset.cat, level: c.dataset.level, age: +c.dataset.age || null }, profile, i), c]).sort((x, y) => y[0] - x[0]).forEach(x => g.appendChild(x[1])));
  }

  const modal = $('#segment-modal');
  // The profile questions are a native <dialog>: the browser keeps focus inside it, Escape closes it,
  // and focus goes back to whatever opened it. It never opens by itself.
  const openModal = () => { if (!modal || modal.open) return; if (modal.showModal) modal.showModal(); else modal.setAttribute('open', ''); };
  const closeModal = () => { if (!modal) return; if (modal.close) modal.close(); else modal.removeAttribute('open'); };
  window.DDR.openProfile = openModal;
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });   // a click on the backdrop closes it
  $$('[data-profile-form]').forEach(f => {
    f.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !f.contains(b)) return;
      const p = readProfile();
      if (b.dataset.level) p.level = p.level === b.dataset.level ? '' : b.dataset.level;
      else if (b.dataset.age) p.age = p.age === b.dataset.age ? '' : b.dataset.age;
      else if (b.dataset.interest) { const i = new Set(p.interests); i.has(b.dataset.interest) ? i.delete(b.dataset.interest) : i.add(b.dataset.interest); p.interests = [...i]; }
      else if (b.hasAttribute('data-profile-done')) {
        track('profile', { level: p.level || 'none', age: p.age || 'none', interests: (p.interests || []).length });
        closeModal();
        if (f.dataset.go) location.hash = f.dataset.go;
        return;
      } else return;
      saveProfile(p); applyProfile();
    });
  });
  $$('[data-open-segments]').forEach(b => b.addEventListener('click', openModal));
  $$('[data-close-segments]').forEach(b => b.addEventListener('click', () => { closeModal(); store.set('ddr_segment_skipped', '1'); }));
  applyProfile();
  // The questions are never sprung on anyone: the home page has a button for them, and that is enough.

  // Topics menu: close with Escape, a click elsewhere, or when the keyboard moves on
  $$('[data-topics]').forEach(d => {
    const sum = $('summary', d), shut = back => { if (d.open) { d.open = false; if (back) sum.focus(); } };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') shut(d.contains(document.activeElement)); });
    document.addEventListener('click', e => { if (!d.contains(e.target)) shut(false); });
    d.addEventListener('focusout', e => { if (e.relatedTarget && !d.contains(e.relatedTarget)) shut(false); });
  });

  // "Was this for you?" under each article: teaches this browser what to show, and tells us what lands
  $$('[data-fit-box]').forEach(box => {
    const cat = box.dataset.cat, done = () => { box.innerHTML = '<p>Thanks. We\'ll show you more of what fits.</p>'; };
    $$('button', box).forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.fit, p = readProfile(), order = ['starter', 'active', 'advanced'];
      if (v === 'yes') fb[cat] = Math.min(4, (fb[cat] || 0) + 1);
      if (v === 'topic') fb[cat] = Math.max(-4, (fb[cat] || 0) - 2);
      if (v === 'easy') p.level = order[Math.min(2, order.indexOf(p.level || 'starter') + 1)];
      if (v === 'hard') p.level = order[Math.max(0, order.indexOf(p.level || 'advanced') - 1)];
      store.set('ddr_fb', JSON.stringify(fb)); saveProfile(p); applyProfile();
      track('article_fit', { v, category: cat, level: box.dataset.level, page: location.pathname }); done();
    }));
  });

  // Newsletter sign-ups carry the profile as tags, so each reader gets the edition that fits
  const tagForms = () => $$('form[data-nl]').forEach(f => {
    $$('input[data-ptag]', f).forEach(i => i.remove());
    const p = readProfile(), add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; i.dataset.ptag = '1'; f.appendChild(i); };
    if (p.level) { add('tag', 'level-' + p.level); add('metadata__level', p.level); }
    if (p.age) { add('tag', 'age-' + p.age); add('metadata__age', p.age); }
    (p.interests || []).forEach(i => add('tag', 'int-' + i));
  });
  tagForms(); $$('form[data-nl]').forEach(f => f.addEventListener('submit', tagForms, true));

  /* ---------- 3. affiliate + revenue event tracking ---------- */
  // Geo-aware Amazon links: US visitors → amazon.com + US tag; everyone else → amazon.co.uk + UK tag.
  // Detection is by browser locale/timezone only (no IP lookup, no cookie), so it needs no consent.
  const isUS = (() => { try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const lang = (navigator.language || '').toLowerCase();
    return /^America\/(?!Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Mexico|Bogota|Lima|Sao_Paulo|Buenos_Aires|Santiago|Caracas)/.test(tz) || lang === 'en-us';
  } catch { return false; } })();
  document.body.dataset.region = isUS ? 'us' : 'row';
  $$('a[data-aff]').forEach(a => {
    try { const u = new URL(a.href);
      if (u.hostname.includes('amazon.')) {
        if (isUS && u.hostname.endsWith('amazon.co.uk')) { u.hostname = 'www.amazon.com'; u.searchParams.delete('tag'); }
        if (!u.searchParams.get('tag')) u.searchParams.set('tag', u.hostname.endsWith('amazon.com') ? DDR.affiliateTagUS : DDR.affiliateTagUK);
        a.href = u.toString(); } } catch {}
    a.addEventListener('click', () => track('affiliate_click', { url: a.href, level: (readProfile().level || 'none'), region: document.body.dataset.region }));
  });
  $$('[data-product]').forEach(a => a.addEventListener('click', () => track('product_click', { id: a.dataset.product, level: (readProfile().level || 'none') })));
  $$('form[data-nl]').forEach(f => f.addEventListener('submit', () => track('newsletter_submit', { level: (readProfile().level || 'none'), unlock: f.hasAttribute('data-unlock-plan') ? 1 : 0 })));
  // "Plan behind the story": unlock after any newsletter signup, remembered in this browser
  const unlockPlans = () => { store.set('ddr_plans', '1'); $$('[data-plan-locked]').forEach(e => e.hidden = true); $$('[data-plan-unlocked]').forEach(e => e.hidden = false); };
  if (store.get('ddr_plans')) unlockPlans();
  $$('form[data-nl]').forEach(f => f.addEventListener('submit', () => setTimeout(unlockPlans, 300)));
  $$('[data-plan-link]').forEach(a => a.addEventListener('click', () => store.set('ddr_plans', '1')));
  $$('.plan-page').forEach(() => track('plan_view', { page: location.pathname }));


  /* ---------- 5. "Try it near you" (local listings) ----------
     Region is guessed from the browser time zone only: no IP lookup, no cookie, nothing leaves the browser.
     The reader can override it; the choice is remembered in this browser. */
  const nearBoxes = $$('[data-near-you]');
  if (nearBoxes.length) {
    let regions = {};
    try { regions = JSON.parse(($('[data-region-map]') || {}).textContent || '{}'); } catch {}
    const guessRegion = () => {
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
      // exact matches first (so America/Indiana/Knox beats the America/Indiana/ prefix), then prefixes
      for (const [id, r] of Object.entries(regions)) if ((r.tz || []).includes(tz)) return id;
      for (const [id, r] of Object.entries(regions)) if ((r.tz || []).some(p => p.endsWith('/') && tz.startsWith(p))) return id;
      return 'elsewhere';
    };
    const chosen = store.get('ddr_local_region');
    const initial = chosen || guessRegion();
    const show = (box, id) => {
      const avail = $$('[data-region]', box).map(d => d.dataset.region);
      const pick = avail.includes(id) ? id : (avail.includes('elsewhere') ? 'elsewhere' : avail[0]);
      $$('[data-region]', box).forEach(d => d.hidden = d.dataset.region !== pick);
      const sel = $('[data-region-select]', box); if (sel) sel.value = pick;
      box.dataset.shown = pick;
    };
    nearBoxes.forEach(box => {
      show(box, initial);
      const sel = $('[data-region-select]', box);
      if (sel) sel.addEventListener('change', () => { store.set('ddr_local_region', sel.value); nearBoxes.forEach(b => show(b, sel.value)); track('local_region', { region: sel.value, guessed: initial }); });
      // experience affiliate ids (Viator / GetYourGuide) once they exist in site.yaml
      $$('a[data-aff-exp]', box).forEach(a => { try {
        const u = new URL(a.href), ex = (window.DDR.experiences || {});
        if (a.dataset.affExp === 'viator' && ex.viator) u.searchParams.set('pid', ex.viator);
        if (a.dataset.affExp === 'getyourguide' && ex.getyourguide) u.searchParams.set('partner_id', ex.getyourguide);
        a.href = u.toString(); } catch {} });
      $$('a[data-local-link]', box).forEach(a => a.addEventListener('click', () => track('local_click', { activity: box.dataset.activity, region: box.dataset.shown, url: a.href })));
    });
  }

  /* ---------- 6. Share button and the welcome for a friend's arrival ---------- */
  $$('[data-share]').forEach(w => {
    const btn = $('[data-share-btn]', w), menu = $('[data-share-menu]', w), url = w.dataset.url, title = w.dataset.title, kind = w.dataset.kind;
    const said = via => track('share', { via, kind, page: location.pathname });
    btn.addEventListener('click', async () => {
      if (navigator.share) {   // phones and tablets: the device's own share sheet
        try { await navigator.share({ title, url }); said('device'); } catch {}
        return;
      }
      menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    $$('a', menu).forEach(a => a.addEventListener('click', () => said(a.dataset.via)));
    const copy = $('[data-share-copy]', menu);
    if (copy) copy.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch {
        try { const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch {}
      }
      copy.textContent = ok ? 'Link copied' : 'Copy failed: press and hold the address bar instead';
      if (ok) said('Copy link');
      setTimeout(() => { copy.textContent = 'Copy link'; }, 2500);
    });
    document.addEventListener('click', e => { if (!w.contains(e.target) && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  });

  if (viaFriend) track('friend_arrival', { page: location.pathname });
  if (friendVisit) {
    // One slim line at the top, in the page flow (never an overlay), closable, and it stays closed.
    const main = $('#main');
    if (main && !store.get('ddr_friend_closed') && !qs.get('do')) {   // an invite to a challenge shows its own line instead (list.js)
      const bar = document.createElement('div');
      bar.className = 'friend-bar';
      bar.innerHTML = '<p>A friend thought you\'d like this. If they were right, <a href="/newsletter/">one story like it arrives by email each week</a>, free, with our 7-Day Restart Plan.</p><button type="button" aria-label="Close this message">×</button>';
      $('button', bar).addEventListener('click', () => { bar.remove(); store.set('ddr_friend_closed', '1'); });
      main.prepend(bar);
    }
    // After the story, one quiet optional line. No questions on arrival.
    const art = $('article.article:not(.plan-page)');
    if (art && !hasProfile(profile) && modal) {
      const p = document.createElement('p');
      p.className = 'friend-more';
      p.innerHTML = 'Want more like this? <button type="button" class="linklike">Tell us what interests you</button> and the site will put those stories first.';
      $('button', p).addEventListener('click', openModal);
      const anchor = $('.fit-box', art) || $('.prose', art);
      if (anchor) anchor.before(p);
    }
    $$('form[data-nl]').forEach(f => f.addEventListener('submit', () => track('friend_signup', { page: location.pathname })));
  }

  // Scroll depth (tells us whether article formats hold attention)
  let marks = { 50: 0, 90: 0 };
  window.addEventListener('scroll', () => {
    const pct = (scrollY + innerHeight) / document.body.scrollHeight * 100;
    for (const m in marks) if (!marks[m] && pct >= m) { marks[m] = 1; track('scroll_depth', { pct: m }); }
  }, { passive: true });
})();

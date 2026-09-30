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

  /* ---------- 2. audience targeting ---------- */
  const PLANS = {
    restarter: ['Walk 10 minutes after one meal a day. That\'s it. Same time each day.', 'Stand up from a chair 5 times without using your hands, twice a day.', 'Book a GP or pharmacist chat: "What can I safely do more of?"', 'Tell one person what you\'re doing. Accountability doubles follow-through.'],
    mover: ['Pick a next-level goal with a date: a 5k, a 1k swim, a 50-mile ride.', 'Add two strength sessions a week — the thing most active over-50s skip.', 'Find a club or masters group; competition is the best motivator we\'ve found.', 'Track one number (time, distance, weight). Beat it, slowly.'],
    learner: ['Choose one skill and one 20-minute slot a day — same time, same chair.', 'Sign up for one structured thing: a course, a class, a choir, a language group.', 'Teach what you learn to someone within the week; it locks it in.', 'Walk while you listen — movement and learning reinforce each other.'],
    carer: ['Protect 15 minutes a day that is only yours, and put it in the diary.', 'Do your movement with the person you care for where you can — a walk, chair exercises, music.', 'Find one carers\' group, online or local. You need people who get it.', 'Sleep first, exercise second, everything else third.'],
    changer: ['Write down the one problem you\'d most like to solve for other people.', 'Talk to three people who\'ve done something similar after 50 — most say yes.', 'Start tiny: one paying customer, one volunteer shift, one blog post.', 'Set a 90-day experiment with a review date, not a lifetime decision.'],
  };
  const modal = $('#segment-modal');
  const segs = window.DDR.segments;
  const labelOf = id => (segs.find(s => s.id === id) || {}).label || 'you';

  function applySegment(id) {
    if (!id) return;
    store.set('ddr_segment', id);
    $$('[data-segment-label]').forEach(el => el.textContent = labelOf(id));
    $$('[data-segment-field]').forEach(el => el.value = id);
    $$('.seg').forEach(b => b.setAttribute('aria-pressed', b.dataset.segment === id));
    document.body.dataset.segment = id;
    // Plan
    const plan = $('[data-plan]');
    if (plan) { plan.innerHTML = '<ol>' + PLANS[id].map(t => `<li>${t}</li>`).join('') + '</ol>'; const sec = $('#plan'); if (sec) sec.hidden = false; }
    // Recommended articles
    const holder = $('[data-for-you]');
    if (holder) {
      fetch('/index.json').then(r => r.json()).then(idx => {
        const seg = segs.find(s => s.id === id);
        let mine = []; try { mine = JSON.parse(store.get('ddr_interests') || '[]'); } catch {}
        const score = a => (a.segments.includes(id) ? 10 : 0) + a.tags.filter(t => seg.tags.includes(t)).length + (mine.includes(a.category) ? 3 : 0);
        const picks = idx.map(a => [score(a), a]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
        holder.innerHTML = picks.map(a => `<article class="card"><a class="card-img" href="${a.url}"><img src="${a.image}" alt="" loading="lazy"></a><div class="card-body"><p class="kicker">${a.category}</p><h3><a href="${a.url}">${a.title}</a></h3><p>${a.excerpt}</p></div></article>`).join('');
        const sec = $('#for-you'); if (sec && picks.length) sec.hidden = false;
      });
    }
  }
  $$('.seg').forEach(b => b.addEventListener('click', () => {
    applySegment(b.dataset.segment);
    track('segment', { id: b.dataset.segment });
    if (modal) modal.hidden = true;
    if (b.dataset.go) location.hash = 'plan';
  }));
  $$('[data-open-segments]').forEach(b => b.addEventListener('click', () => { if (modal) modal.hidden = false; }));
  $$('[data-close-segments]').forEach(b => b.addEventListener('click', () => { modal.hidden = true; store.set('ddr_segment_skipped', '1'); }));

  const saved = store.get('ddr_segment');
  if (saved) applySegment(saved);
  else if (document.body.dataset.page === 'home' && !store.get('ddr_segment_skipped') && modal) {
    // ask after the reader has had a look around (scroll or 12s)
    let asked = false; const ask = () => { if (!asked) { asked = true; modal.hidden = false; } };
    setTimeout(ask, 12000); window.addEventListener('scroll', () => { if (scrollY > 600) ask(); }, { passive: true });
  }

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
    a.addEventListener('click', () => track('affiliate_click', { url: a.href, segment: store.get('ddr_segment') || 'none', region: document.body.dataset.region }));
  });
  $$('[data-product]').forEach(a => a.addEventListener('click', () => track('product_click', { id: a.dataset.product, segment: store.get('ddr_segment') || 'none' })));
  $$('form[data-nl]').forEach(f => f.addEventListener('submit', () => track('newsletter_submit', { segment: store.get('ddr_segment') || 'none', unlock: f.hasAttribute('data-unlock-plan') ? 1 : 0 })));
  // "Plan behind the story": unlock after any newsletter signup, remembered in this browser
  const unlockPlans = () => { store.set('ddr_plans', '1'); $$('[data-plan-locked]').forEach(e => e.hidden = true); $$('[data-plan-unlocked]').forEach(e => e.hidden = false); };
  if (store.get('ddr_plans')) unlockPlans();
  $$('form[data-nl]').forEach(f => f.addEventListener('submit', () => setTimeout(unlockPlans, 300)));
  $$('[data-plan-link]').forEach(a => a.addEventListener('click', () => store.set('ddr_plans', '1')));
  $$('.plan-page').forEach(() => track('plan_view', { page: location.pathname }));
  $$('.share a').forEach(a => a.addEventListener('click', () => track('share', { via: a.textContent })));


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

  // Scroll depth (tells us whether article formats hold attention)
  let marks = { 50: 0, 90: 0 };
  window.addEventListener('scroll', () => {
    const pct = (scrollY + innerHeight) / document.body.scrollHeight * 100;
    for (const m in marks) if (!marks[m] && pct >= m) { marks[m] = 1; track('scroll_depth', { pct: m }); }
  }, { passive: true });
})();

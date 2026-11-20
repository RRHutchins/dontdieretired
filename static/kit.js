/* Kit picks by market (20 Nov 2026): show UK or US picks. Starts from the site's region (app.js sets body[data-region]
   to 'us' or 'row'); the reader can switch, and the choice is remembered in this browser. */
(() => {
  const KEY = 'ddr_kit_market';
  const show = m => {
    document.querySelectorAll('[data-market]').forEach(el => { el.hidden = el.dataset.market !== m; });
    document.querySelectorAll('[data-market-show]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.marketShow === m)));
  };
  let m = 'uk';
  try { m = localStorage.getItem(KEY) || (document.body.dataset.region === 'us' ? 'us' : 'uk'); } catch { m = document.body.dataset.region === 'us' ? 'us' : 'uk'; }
  const start = () => show(m);
  if (document.body.dataset.region) start(); else setTimeout(start, 50);
  document.querySelectorAll('[data-market-show]').forEach(b => b.addEventListener('click', () => { m = b.dataset.marketShow; try { localStorage.setItem(KEY, m); } catch {} show(m); }));
})();

// Deep hub race finder (RUNBOOK §6u): filters the events already in the page. No storage, no network.
(() => {
  const root = document.querySelector('[data-hub-finder]'); if (!root) return;
  const form = root.querySelector('[data-hub-filters]'), none = root.querySelector('[data-hub-none]');
  const items = [...root.querySelectorAll('.hub-event')];
  form.hidden = false;
  const has = (el, attr, v) => !v || (el.dataset[attr] || '').split(' ').includes(v);
  const apply = () => {
    const f = Object.fromEntries(new FormData(form)); const q = (f.q || '').trim().toLowerCase();
    let shown = 0;
    items.forEach(el => {
      const ok = has(el, 'continent', f.continent) && has(el, 'bands', f.band) && has(el, 'terrain', f.terrain) &&
        has(el, 'month', f.month) && has(el, 'entry', f.entry) && has(el, 'series', f.series) && has(el, 'type', f.type) && has(el, 'see', f.see) && (!q || el.dataset.search.includes(q));
      el.hidden = !ok; shown += ok;
    });
    none.hidden = shown > 0;
  };
  form.addEventListener('input', apply); form.addEventListener('change', apply);
  form.addEventListener('reset', () => setTimeout(apply, 0));
})();

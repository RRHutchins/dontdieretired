// Accessibility pass for the planner and Planner Plus pages (Planner Plus day 21, RUNBOOK §6t, §6k).
// Opens each page of a built site at 320, 390 and 1280px in Chromium and reports:
//   sideways scroll; buttons, form fields, summaries and button-style links under 44px tall; a focus ring
//   that does not show when the element is reached by keyboard; console errors; and, if axe-core is given,
//   its WCAG 2.x A/AA findings.
// Usage: node tools/a11y_check.js <built site dir> [path to axe.min.js] [screenshot dir]
// axe-core is not a dependency of the site: install it anywhere (npm i axe-core) and pass its axe.min.js.
const fs = require('fs'), path = require('path'), http = require('http');
const SITE_DIR = process.argv[2], AXE = process.argv[3] && process.argv[3] !== '-' ? fs.readFileSync(process.argv[3], 'utf8') : null, SHOTS = process.argv[4] || null;
if (!SITE_DIR) { console.error('Usage: node tools/a11y_check.js <built site dir> [axe.min.js] [screenshot dir]'); process.exit(2); }
const PAGES = (process.env.A11Y_PAGES || [
  '/', '/list/', '/list/take-up-beekeeping/', '/list/go-to-edinburgh-fringe/', '/list/run-great-north-run/',
  '/my-year/', '/account/', '/redeem/', '/planner-plus/', '/planner-plus/gift/', '/planner-plus/terms/', '/planner-plus/sample/', '/privacy/',
].join(',')).split(',');
const WIDTHS = (process.env.A11Y_WIDTHS || '320,390,1280').split(',').map(Number);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ics': 'text/calendar' };

(async () => {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE_DIR, path.normalize(p));
    if (!f.startsWith(path.resolve(SITE_DIR)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('not found'); }
    r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(r);
  });
  await new Promise(res => srv.listen(8010, '127.0.0.1', res));
  const SITE = 'http://localhost:8010';
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const found = new Map();   // "kind|page|detail" -> widths
  const note = (kind, pg, detail, w) => { const k = kind + '|' + pg + '|' + detail; if (!found.has(k)) found.set(k, []); found.get(k).push(w); };
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    const page = await ctx.newPage();
    let cur = '';
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) note('console', cur, m.text().slice(0, 160), w); });
    page.on('pageerror', e => note('page error', cur, e.message.slice(0, 160), w));
    for (const pg of PAGES) {
      cur = pg;
      const resp = await page.goto(SITE + pg, { waitUntil: 'networkidle' }).catch(() => null);
      if (!resp || resp.status() !== 200) { note('missing', pg, String(resp && resp.status()), w); continue; }
      // open the fold-outs a reader would open, so what is inside is checked too
      await page.evaluate(() => document.querySelectorAll('main details').forEach(d => { d.open = true; }));
      await page.waitForTimeout(150);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) note('sideways scroll', pg, wide + 'px', w);
      const small = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('main button, main input:not([type=hidden]), main select, main textarea, main summary, main a.btn, header button, header a.btn').forEach(el => {
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
          if (el.type === 'radio' || el.type === 'checkbox') { const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')); if (lab && lab.getBoundingClientRect().height >= 44) return; }
          // a button styled as a link inside a sentence is an inline target (WCAG 2.5.8's inline exception), like any text link
          if (el.classList.contains('linklike') && /^inline/.test(cs.display) && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 10) return;
          if (r.height < 43.5) out.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || el.value || el.name || '').trim().slice(0, 40) + '" ' + Math.round(r.height) + 'px');
        });
        return [...new Set(out)].slice(0, 12);
      });
      small.forEach(s => note('under 44px', pg, s, w));
      // keyboard: tab through the first 40 stops and check each shows an outline or box-shadow when focused
      const nofocus = await (async () => {
        const out = [];
        await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0);
          const st = document.createElement('style'); st.textContent = '*,*::before,*::after{transition:none!important}'; document.head.appendChild(st); });   // read the focused look, not a fade on its way
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          const r = await page.evaluate(() => {
            const el = document.activeElement; if (!el || el === document.body) return null;
            // a second stop on the same date field is the browser's own calendar button, drawn by the browser
            if (window.__a11yLast === el) return ''; window.__a11yLast = el;
            const cs = getComputedStyle(el);
            let ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
            if (!ring && el instanceof SVGElement) {   // a map area shows focus by its fill: compare with how it looks unfocused
              const on = cs.fill + cs.stroke + cs.strokeWidth; el.blur(); const c2 = getComputedStyle(el), off = c2.fill + c2.stroke + c2.strokeWidth; el.focus({ preventScroll: true });
              ring = on !== off;
            }
            return ring ? '' : el.tagName.toLowerCase() + ' "' + (el.textContent || el.value || '').trim().slice(0, 40) + '"';
          });
          if (r) out.push(r);
        }
        return [...new Set(out)].slice(0, 6);
      })();
      nofocus.forEach(s => note('no focus ring', pg, s, w));
      if (AXE) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addScriptTag({ content: AXE });
        const res = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
          return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ') }));
        });
        res.forEach(v => note('axe ' + v.impact, pg, v.id + ' (' + v.n + '): ' + v.t, w));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, w + pg.replace(/\//g, '_') + '.png'), fullPage: false });
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (!found.size) { console.log('a11y: nothing found on ' + PAGES.length + ' pages at ' + WIDTHS.join(', ') + 'px' + (AXE ? ' (with axe-core)' : ' (no axe-core given)')); return; }
  for (const [k, ws] of found) { const [kind, pg, d] = k.split('|'); console.log(kind.padEnd(16) + pg.padEnd(36) + ws.join('/') + 'px  ' + d); }
  process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });

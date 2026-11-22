// Planner screenshots with a list of plans in the browser (RUNBOOK §6t, interface day 22 Nov 2026).
// Serves a built site, puts a fixed list of plans into localStorage through the page's own DDRList (so the data is
// exactly what the site would save), and takes the screenshots a session looks at before changing the planner pages:
// an activity page not planned and planned, Things to do, a card, My year (calendar, a day opened, the month view),
// the Planner Plus page. Checks each for sideways scroll and console errors.
//   node tools/planner_shots.js <built site dir> <screenshot dir> [widths, default 390,1280]
// The list is seeded on the day the tool runs, with dates from tomorrow on, so the calendar always has things on it.
const fs = require('fs'), path = require('path'), http = require('http');
const SITE_DIR = process.argv[2], OUT = process.argv[3], WIDTHS = (process.argv[4] || '390,1280').split(',').map(Number);
if (!SITE_DIR || !OUT) { console.error('usage: node tools/planner_shots.js <built site dir> <screenshot dir> [widths]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const iso = d => d.toISOString().slice(0, 10);
const day = n => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const TODAY = day(0);
// next month's 14th, so a stay sits inside one month
const nm = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d; })(), NM = iso(nm).slice(0, 7);
// the Fringe on its own days next August (a stay of five days), as a reader would plan it
const AUG = (new Date().getUTCMonth() >= 7 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear()) + '-08';

(async () => {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(path.resolve(SITE_DIR), path.normalize(p));
    if (!f.startsWith(path.resolve(SITE_DIR)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('not found'); }
    r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(r);
  });
  await new Promise(res => srv.listen(8011, '127.0.0.1', res));
  const SITE = 'http://localhost:8011', problems = [];
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 2 });
    await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(w + 'px page error: ' + e.message + ' @ ' + page.url()));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problems.push(w + 'px console: ' + m.text().slice(0, 160)); });
    const shot = async (name, full) => {
      await page.waitForTimeout(250);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) problems.push(`${w}px sideways scroll ${wide}px on ${name}`);
      await page.screenshot({ path: path.join(OUT, w + '-' + name + '.png'), fullPage: !!full });
    };
    const top = async sel => { await page.evaluate(([s, off]) => { const e = document.querySelector(s); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - off); }, [sel, w < 1280 ? 150 : 120]); };
    // 1. nothing saved yet
    await page.goto(SITE + '/list/take-up-beekeeping/', { waitUntil: 'networkidle' });
    await top('.fl-cta'); await shot('activity-not-planned');
    await page.goto(SITE + '/list/', { waitUntil: 'networkidle' }); await shot('things-to-do');
    await top('[data-fl-grid]'); await shot('cards');
    // 2. the plans, saved through the page's own DDRList
    await page.evaluate(({ TODAY, NM, AUG, d1, d2, d3, d4 }) => {
      const L = window.DDRList;
      L.plan('go-to-edinburgh-fringe', { date: AUG + '-14', until: AUG + '-18' }, TODAY);
      L.plan('take-up-beekeeping', { month: NM }, TODAY);
      L.plan('big-garden-birdwatch', { date: d1 }, TODAY);
      L.plan('go-to-a-burns-supper', { date: d2 }, TODAY);
      L.plan('run-great-north-run', { date: d3, level: 'active' }, TODAY);
      L.add(null, 'Family over for lunch'); const own = L.live(L.load()).find(i => !i.cid); L.update(own.id, { date: d4 });
      L.add('learn-the-ukulele');
    }, { TODAY, NM, AUG, d1: day(9), d2: day(12), d3: day(150), d4: day(3) });
    await page.goto(SITE + '/list/', { waitUntil: 'networkidle' }); await top('[data-fl-grid]'); await shot('cards-planned');
    await page.goto(SITE + '/list/take-up-beekeeping/', { waitUntil: 'networkidle' }); await top('.fl-cta'); await shot('activity-planned');
    await page.goto(SITE + '/list/go-to-edinburgh-fringe/#plan', { waitUntil: 'networkidle' }); await page.waitForSelector('.pl-saved', { timeout: 10000 }).catch(() => problems.push(w + 'px: no saved plan on the Fringe page'));
    await top('#plan'); await shot('plan-box-saved');
    await page.goto(SITE + '/my-year/', { waitUntil: 'networkidle' }); await page.waitForSelector('[data-cal-day]', { timeout: 15000 });
    await shot('my-year-top');
    await top('[data-cal]'); await shot('my-year-calendar');
    await page.click('[data-cal-step="1"]'); await page.click('[data-cal-day="' + day(12) + '"]'); await top('[data-cal]'); await shot('my-year-next-month');
    await top('[data-cal-panel]'); await shot('my-year-day-opened');
    // keyboard: arrow right moves to the next day
    await page.focus('[data-cal-day="' + day(12) + '"]'); await page.keyboard.press('ArrowRight');
    const f = await page.evaluate(() => document.activeElement && document.activeElement.dataset.calDay);
    if (f !== day(13)) problems.push(w + 'px: arrow right went to ' + f);
    await page.goto(SITE + '/my-year/#' + AUG + '-15', { waitUntil: 'networkidle' }); await page.waitForSelector('[data-cal-day]'); await top('[data-cal]'); await shot('my-year-stay');
    await page.goto(SITE + '/my-year/#' + NM, { waitUntil: 'networkidle' }); await page.waitForSelector('[data-cal-day]'); await top('[data-my-month]'); await shot('my-year-month-view');
    await page.goto(SITE + '/planner-plus/', { waitUntil: 'networkidle' }); await shot('planner-plus'); await top('.howto'); await shot('planner-plus-howto');
    await page.goto(SITE + '/', { waitUntil: 'networkidle' });
    const nav = await page.evaluate(() => { const a = document.querySelector('[data-nav-myyear]'); return a && !a.hidden && getComputedStyle(a).display !== 'none'; });
    if (!nav && w >= 600) problems.push(w + 'px: My year not in the menu with plans saved');
    await shot('home-menu');
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (problems.length) { problems.forEach(p => console.log('PROBLEM ' + p)); process.exit(1); }
  console.log('planner shots: ' + fs.readdirSync(OUT).length + ' screenshots in ' + OUT + ', no problems');
})().catch(e => { console.error(e); process.exit(1); });

// Don't Die Retired — premium product renderer.
// JSON content → designed HTML → PDF (Chromium), cover rendered separately and merged.
// Usage: node build_pdf.js content/restart30.json [--html-only]
// Output: out/<id>.pdf, out/<id>.html, out/<id>-cover.png (for Gumroad mock-ups)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const PW = process.env.PLAYWRIGHT_PATH || '/tmp/claude-0/node_modules/playwright';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const FONTS = process.env.FONT_DIR || path.resolve(__dirname, 'fonts');

const THEMES = {
  restart30:     { c: '#0B6E4F', tint: '#E7F3EE', accent: '#C98A2B', big: '30',  label: 'Move' },
  strong60:      { c: '#1B2A41', tint: '#E9EDF3', accent: '#C98A2B', big: '60',  label: 'Move' },
  eatstrong:     { c: '#A4452C', tint: '#F8EAE4', accent: '#0B6E4F', big: '4',   label: 'Eat' },
  sharp:         { c: '#1F4E79', tint: '#E8EFF7', accent: '#C98A2B', big: '8',   label: 'Think' },
  moneyreset:    { c: '#0F5E63', tint: '#E3F1F1', accent: '#C98A2B', big: '30',  label: 'Money' },
  secondact:     { c: '#8A4B08', tint: '#F8EEE1', accent: '#1B2A41', big: '90',  label: 'Earn' },
  reconnect:     { c: '#6D2E72', tint: '#F3E8F4', accent: '#C98A2B', big: '6',   label: 'Connect' },
  slowtravel:    { c: '#27608A', tint: '#E5EFF6', accent: '#C98A2B', big: '∞',   label: 'Travel' },
  techconfident: { c: '#3A4556', tint: '#EAEDF1', accent: '#B23A48', big: '4',   label: 'Tech' },
  'restart7-free': { c: '#B23A48', tint: '#FBEBEC', accent: '#C98A2B', big: '7', label: 'Free plan' },
};
const OTHERS = [
  ['The 30-Day Restart', 'Ten minutes a day, chair to stairs'], ['Strong at 60', '12-week beginner strength plan'],
  ['Eat Strong', 'Four-week kitchen planner'], ['Sharp', '8 weeks to a learning habit'],
  ['The Money Reset', '30-day money workbook'], ['Second Act', '90-day venture workbook'],
  ['Reconnect', 'Six weeks to a fuller social life'], ['Slow Travel After 50', 'The planning workbook'],
  ['Tech Confident', 'The scam-proof guide'],
];

const src = process.argv[2]; const id = path.basename(src, '.json');
const C = JSON.parse(fs.readFileSync(src, 'utf8')); const T = THEMES[id] || THEMES.restart30;
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// ---------- logo (Option A sunrise) ----------
const rays = (cx, cy, r1, r2) => [165, 135, 105, 75, 45, 15].map(a => { const t = a * Math.PI / 180;
  return `<line x1="${(cx + r1 * Math.cos(t)).toFixed(1)}" y1="${(cy - r1 * Math.sin(t)).toFixed(1)}" x2="${(cx + r2 * Math.cos(t)).toFixed(1)}" y2="${(cy - r2 * Math.sin(t)).toFixed(1)}"/>`; }).join('');
const MARK = (bg, fg) => `<svg viewBox="0 0 100 100" class="mark"><circle cx="50" cy="50" r="48" fill="${bg}"/><clipPath id="ab${bg.slice(1)}"><rect width="100" height="58"/></clipPath><circle cx="50" cy="58" r="17" fill="${fg}" clip-path="url(#ab${bg.slice(1)})"/><g stroke="${fg}" stroke-width="4.5" stroke-linecap="round">${rays(50, 58, 23, 31)}</g><rect x="16" y="60" width="68" height="5" rx="2.5" fill="${fg}"/><rect x="28" y="70" width="44" height="4" rx="2" fill="${fg}" opacity=".75"/><rect x="38" y="79" width="24" height="3.5" rx="1.75" fill="${fg}" opacity=".5"/></svg>`;

// ---------- structure: find sections ----------
const blocks = C.blocks.slice();
if (blocks[0] && blocks[0].h1 && blocks[0].h1.trim() === C.title.trim()) blocks.shift();
const h1s = blocks.filter(b => b.h1).length;
const isSectionHead = (b, prev) => h1s >= 3 ? !!b.h1 : (!!b.h2 && (!prev || prev.pagebreak));
const sections = []; blocks.forEach((b, i) => { if (isSectionHead(b, blocks[i - 1])) sections.push(b.h1 || b.h2); });

// ---------- block renderers ----------
const ICON = {
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><rect x="11" y="10" width="2" height="8" rx="1" fill="#fff"/><circle cx="12" cy="7" r="1.4" fill="#fff"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 2 L23 21 H1 Z" fill="currentColor"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="18" r="1.3" fill="#fff"/></svg>',
  star: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M12 5.5l1.9 4 4.4.5-3.3 3 .9 4.3L12 15.1l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" fill="#fff"/></svg>',
  us: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="Src">US</text></svg>',
};
const calloutKind = t => /stop|red flag|warning|caution|before you|safety|avoid|not advice/i.test(t) ? 'warn' : /united states|\bus\b|america/i.test(t) ? 'us' : /one last|remember|secret|summary|key|rule/i.test(t) ? 'star' : 'info';

let secN = 0;
function render(b, prev) {
  if (isSectionHead(b, prev)) { secN++; const t = b.h1 || b.h2;
    return `<section class="sec-head"><div class="sec-num">${String(secN).padStart(2, '0')}</div><h2>${md(t)}</h2></section>`; }
  if (b.h1) return `<h2 class="h1">${md(b.h1)}</h2>`;
  if (b.h2) return `<h3>${md(b.h2)}</h3>`;
  if (b.lead) return `<p class="lead">${md(b.lead)}</p>`;
  if (b.p !== undefined) return b.p ? `<p>${md(b.p)}</p>` : '';
  if (b.bullets) return `<ul class="bul">${b.bullets.map(x => `<li>${md(x)}</li>`).join('')}</ul>`;
  if (b.numbers) return `<ol class="num">${b.numbers.map((x, i) => `<li><span class="n">${i + 1}</span><div>${md(x)}</div></li>`).join('')}</ol>`;
  if (b.checklist) return `<ul class="chk">${b.checklist.map(x => `<li><span class="box"></span><div>${md(x)}</div></li>`).join('')}</ul>`;
  if (b.quote) return `<blockquote><p>${md(b.quote.text)}</p>${b.quote.who ? `<cite>${md(b.quote.who)}</cite>` : ''}</blockquote>`;
  if (b.callout) { const k = calloutKind(b.callout.title);
    return `<aside class="call call-${k}"><div class="ic">${ICON[k]}</div><div><h4>${md(b.callout.title)}</h4>${b.callout.text.split('\n').map(l => `<p>${md(l)}</p>`).join('')}</div></aside>`; }
  if (b.table) { const t = b.table; const blankCols = t.headers.map((_, i) => t.rows.every(r => !String(r[i] ?? '').trim()));
    const tick = v => String(v).trim() === '☐' ? '<span class="box sm"></span>' : md(v ?? '');
    const writeIn = t.rows.some(r => r.some(c => !String(c).trim()));
    return `<table class="${writeIn ? 'write' : ''}"><thead><tr>${t.headers.map(h => `<th>${md(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${blankCols[i] ? 'blank' : ''}">${tick(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
  if (b.week) return `<section class="week"><h3 class="week-t">${md(b.week.title)}</h3>${b.week.days.map(d => `<div class="day"><div class="dpill">${md(d.day)}</div><div class="dtask">${md(d.task)}${d.note ? `<div class="dnote">${md(d.note)}</div>` : ''}</div><div class="dtick"><span class="circle"></span><span class="line"></span></div></div>`).join('')}</section>`;
  if (b.pagebreak) return '';  // layout decides breaks: section heads and weekly trackers start new pages
  return '';
}
const bodyHtml = blocks.map((b, i) => render(b, blocks[i - 1])).join('\n')
  .replace(/<div class="pb"><\/div>\s*(<section class="sec-head">)/g, '$1'); // section heads break themselves

const disclaimer = C.disclaimer || "This guide is general information, not medical advice. Check with your GP or a health professional before starting a new exercise programme, especially if you have a heart condition, high blood pressure, joint problems or have been inactive for a long time. Stop and seek advice if anything hurts.";

const FONTFACE = `
@font-face{font-family:Fr;font-weight:600;src:url(${FONTS}/fraunces-latin-600-normal.woff2)}
@font-face{font-family:Fr;font-weight:700;src:url(${FONTS}/fraunces-latin-700-normal.woff2)}
@font-face{font-family:Fr;font-weight:900;src:url(${FONTS}/fraunces-latin-900-normal.woff2)}
@font-face{font-family:Fr;font-style:italic;font-weight:400;src:url(${FONTS}/fraunces-latin-400-italic.woff2)}
@font-face{font-family:Src;font-weight:400;src:url(${FONTS}/source-sans-3-latin-400-normal.woff2)}
@font-face{font-family:Src;font-weight:600;src:url(${FONTS}/source-sans-3-latin-600-normal.woff2)}
@font-face{font-family:Src;font-weight:700;src:url(${FONTS}/source-sans-3-latin-700-normal.woff2)}`;
const VARS = `:root{--c:${T.c};--tint:${T.tint};--acc:${T.accent};--ink:#1B1B1F;--muted:#5B5F6B;--line:#DAD6CE;--paper:#FFFDF9}`;

// ---------- cover ----------
const coverHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTFACE}${VARS}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0}
.cover{width:210mm;height:297mm;background:var(--c);color:#FFFDF9;position:relative;overflow:hidden;font-family:Src;padding:22mm 20mm}
.cover .arcs{position:absolute;right:-60mm;bottom:-70mm;width:230mm;height:230mm;opacity:.13}
.cover .big{position:absolute;right:14mm;bottom:28mm;font-family:Fr;font-weight:900;font-size:${T.big.length > 1 ? 210 : 260}pt;line-height:.8;color:#FFFDF9;opacity:.14;letter-spacing:-.04em}
.brand{display:flex;align-items:center;gap:4mm}.brand .mark{width:15mm;height:15mm}
.brand span{font-family:Fr;font-weight:700;font-size:17pt}.brand i{font-weight:400}
.pill{display:inline-block;margin-top:44mm;border:1.2pt solid rgba(255,253,249,.7);border-radius:99px;padding:2mm 5mm;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:9.5pt}
h1{font-family:Fr;font-weight:900;font-size:58pt;line-height:.98;margin:8mm 0 7mm;letter-spacing:-.015em;max-width:160mm}
.sub{font-family:Fr;font-style:italic;font-size:19pt;line-height:1.3;max-width:140mm;opacity:.95}
.rule{width:28mm;height:2.2mm;background:var(--acc);margin:12mm 0 0;border-radius:2mm}
.foot{position:absolute;left:20mm;right:20mm;bottom:18mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;letter-spacing:.04em}
.foot b{display:block;font-size:11.5pt;letter-spacing:.02em}
</style></head><body><div class="cover">
<svg class="arcs" viewBox="0 0 200 200"><g fill="none" stroke="#FFFDF9" stroke-width="7">${[90, 72, 54, 36].map(r => `<circle cx="100" cy="100" r="${r}"/>`).join('')}</g></svg>
<div class="big">${esc(T.big)}</div>
<div class="brand">${MARK('#FFFDF9', T.c)}<span>Don't Die <i>Retired</i></span></div>
<div class="pill">${esc(C.kind)}</div>
<h1>${esc(C.title)}</h1>
<div class="sub">${esc(C.subtitle)}</div>
<div class="rule"></div>
<div class="foot"><div><b>Printable · Written for everyone over 50</b>Whether you've always been active or never got round to it</div><div>dontdieretired.com</div></div>
</div></body></html>`;

// ---------- body ----------
const bodyDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTFACE}${VARS}
@page{size:A4;margin:17mm 17mm 19mm}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Src;font-size:10.8pt;line-height:1.55;color:var(--ink);background:#fff}
strong{font-weight:700;color:#111}
/* inside cover */
.inside{break-after:page;display:grid;grid-template-rows:auto auto 1fr auto;min-height:258mm}
.inside .welcome{background:var(--tint);border-radius:5mm;padding:9mm 10mm}
.kick{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:8.5pt;color:var(--c)}
.inside h2{font-family:Fr;font-weight:700;font-size:25pt;line-height:1.1;margin:2mm 0 3mm}
.inside .welcome p{margin:0;font-size:11.5pt}
.toc{margin:9mm 0 0;padding:0;list-style:none;columns:2;column-gap:10mm}
.toc li{break-inside:avoid;display:flex;gap:4mm;align-items:baseline;padding:2.6mm 0;border-bottom:.6pt solid var(--line);font-weight:600}
.toc .n{font-family:Fr;font-weight:900;color:var(--c);font-size:13pt;min-width:9mm}
.how{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;margin-top:9mm;align-self:start}
.how div{border:.8pt solid var(--line);border-radius:4mm;padding:5mm}
.how b{display:block;font-family:Fr;font-size:12.5pt;margin-bottom:1mm;color:var(--c)}
.how span{font-size:9.8pt;color:#333}
.disc{font-size:8.3pt;color:var(--muted);border-top:.6pt solid var(--line);padding-top:3mm;margin-top:6mm}
/* sections */
.sec-head{break-before:page;margin:0 0 7mm;padding:0 0 5mm;border-bottom:1.4pt solid var(--c);display:flex;align-items:flex-end;gap:5mm}
.sec-num{font-family:Fr;font-weight:900;font-size:40pt;line-height:.8;color:var(--c)}
.sec-head h2{font-family:Fr;font-weight:700;font-size:23pt;line-height:1.1;margin:0}
.pb{break-after:page}
h2.h1{font-family:Fr;font-weight:700;font-size:19pt;color:var(--ink);margin:7mm 0 3mm}
h3{font-family:Fr;font-weight:700;font-size:14.5pt;color:var(--c);margin:6.5mm 0 2mm;break-after:avoid}
h3::before{content:"";display:inline-block;width:2.4mm;height:2.4mm;background:var(--acc);border-radius:.6mm;margin-right:2.5mm;transform:translateY(-.6mm)}
p{margin:0 0 2.6mm;orphans:3;widows:3}
.lead{font-size:13pt;line-height:1.5;color:#2a2a2a;font-family:Fr;font-style:italic}
ul.bul{list-style:none;padding:0;margin:1mm 0 3mm}
ul.bul li{position:relative;padding-left:6mm;margin:0 0 1.8mm}
ul.bul li::before{content:"";position:absolute;left:.6mm;top:2mm;width:2.2mm;height:2.2mm;border-radius:50%;background:var(--c)}
ol.num{list-style:none;padding:0;margin:1mm 0 3mm}
ol.num li{display:flex;gap:3.5mm;margin:0 0 2.4mm;break-inside:avoid}
ol.num .n{flex:0 0 6.5mm;height:6.5mm;border-radius:50%;background:var(--c);color:#fff;font-weight:700;font-size:9.5pt;display:flex;align-items:center;justify-content:center;margin-top:.3mm}
ul.chk{list-style:none;padding:0;margin:1mm 0 3mm}
ul.chk li{display:flex;gap:3.5mm;margin:0 0 2.6mm;break-inside:avoid}
.box{flex:0 0 5.2mm;height:5.2mm;border:1.3pt solid var(--c);border-radius:1.3mm;margin-top:.4mm;display:inline-block;background:#fff}
.box.sm{width:4.6mm;height:4.6mm;flex:none;vertical-align:middle}
blockquote{margin:5mm 0;padding:5mm 7mm 5mm 14mm;position:relative;background:var(--tint);border-radius:4mm;break-inside:avoid}
blockquote::before{content:"\\201C";position:absolute;left:3.5mm;top:-2mm;font-family:Fr;font-weight:900;font-size:44pt;color:var(--c);line-height:1}
blockquote p{font-family:Fr;font-style:italic;font-size:13.5pt;line-height:1.4;margin:0}
blockquote cite{display:block;margin-top:2mm;font-style:normal;font-size:9pt;color:var(--muted);letter-spacing:.04em}
.call{display:flex;gap:4mm;border-radius:4mm;padding:5mm 6mm;margin:4mm 0;break-inside:avoid;background:var(--tint)}
.call .ic{flex:0 0 7mm;color:var(--c)}.call .ic svg{width:7mm;height:7mm}
.call h4{margin:0 0 1.5mm;font-family:Fr;font-size:12pt}
.call p{margin:0 0 1.2mm;font-size:10.2pt}
.call-warn{background:#FCEDEA}.call-warn .ic{color:#B23A48}.call-warn h4{color:#8E2433}
.call-star{background:#FBF3E4}.call-star .ic{color:var(--acc)}
.call-us{background:#EEF2F8}.call-us .ic{color:#1F4E79}
table{width:100%;border-collapse:separate;border-spacing:0;margin:3mm 0 5mm;font-size:9.6pt;break-inside:auto;border:.8pt solid var(--line);border-radius:3mm;overflow:hidden}
thead th{background:var(--c);color:#fff;text-align:left;font-weight:700;padding:2.4mm 3mm;font-size:9.3pt}
td{padding:2.2mm 3mm;border-top:.6pt solid var(--line);vertical-align:top}
tbody tr:nth-child(even) td{background:#FAF8F4}
tr{break-inside:avoid}
table.write td{height:10mm}
td.blank{background:#fff!important}
.week{margin:0 0 4mm;break-before:page}
.week-t{font-size:16pt;margin-top:0}
.day{display:grid;grid-template-columns:19mm 1fr 30mm;gap:4mm;align-items:start;padding:3mm 0;border-bottom:.6pt solid var(--line);break-inside:avoid}
.dpill{background:var(--c);color:#fff;font-weight:700;font-size:9pt;border-radius:99px;text-align:center;padding:1.2mm 0;margin-top:.3mm}
.dtask{font-size:10pt;line-height:1.45}
.dnote{font-size:9pt;color:var(--muted);font-style:italic;margin-top:1mm}
.dtick{display:flex;align-items:center;gap:2mm}
.circle{flex:0 0 7mm;height:7mm;border:1.4pt solid var(--c);border-radius:50%}
.line{flex:1;border-bottom:.8pt solid var(--line);height:6mm}
/* back page */
.back{break-before:page;min-height:258mm;display:flex;flex-direction:column}
.back .panel{background:var(--c);color:#FFFDF9;border-radius:5mm;padding:11mm 11mm}
.back .panel h2{font-family:Fr;font-weight:900;font-size:26pt;line-height:1.05;margin:2mm 0 4mm}
.back .panel p{font-size:11.5pt;margin:0 0 2mm;opacity:.95}
.back .kick{color:#FFFDF9;opacity:.85}
.shelf{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm;margin-top:8mm}
.shelf div{border:.8pt solid var(--line);border-radius:3.5mm;padding:4mm}
.shelf b{display:block;font-family:Fr;font-size:11pt;margin-bottom:.8mm}
.shelf span{font-size:8.8pt;color:var(--muted)}
.sign{margin-top:auto;display:flex;align-items:center;gap:4mm;padding-top:8mm;border-top:.6pt solid var(--line)}
.sign .mark{width:13mm;height:13mm}
.sign b{font-family:Fr;font-size:14pt}.sign i{color:var(--c)}
.sign span{display:block;font-size:9pt;color:var(--muted)}
</style></head><body>
<section class="inside">
  <div class="welcome"><div class="kick">Welcome</div><h2>${esc(C.title)}</h2><p>${esc(C.subtitle)}. Retirement is a word for leaving a job, not a description of a person — and this ${esc(C.kind.toLowerCase())} is written for anyone over 50 who wants to do more, not less, whether you've always been active or never got round to it.</p></div>
  <div><div class="kick" style="margin-top:9mm">Inside</div><ol class="toc">${sections.map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${md(s)}</span></li>`).join('')}</ol></div>
  <div class="how"><div><b>Print it</b><span>It's made for paper. Pin the tracker pages somewhere you'll see them every day.</span></div><div><b>Start small</b><span>Every plan has a beginner's route. Doing a little, often, beats doing a lot once.</span></div><div><b>Tick the box</b><span>A row of ticks is surprisingly powerful. It's how a habit becomes part of your life.</span></div></div>
  <p class="disc">${esc(disclaimer)} © Don't Die Retired. For personal use; please don't share or resell. Thank you for supporting an independent project.</p>
</section>
${bodyHtml}
<section class="back">
  <div class="panel"><div class="kick">Keep going</div><h2>This is the start, not the finish.</h2><p>Every day at <b>dontdieretired.com</b> we publish a true story of someone who began something late — and the plan behind it. Join the free Sunday email and you'll get one story, one idea and one thing to try each week.</p></div>
  <div class="kick" style="margin-top:9mm">More from the shelf</div>
  <div class="shelf">${OTHERS.filter(o => o[0] !== C.title).slice(0, 6).map(o => `<div><b>${esc(o[0])}</b><span>${esc(o[1])}</span></div>`).join('')}</div>
  <div class="sign">${MARK(T.c, '#FFFDF9')}<div><b>Don't Die <i>Retired</i></b><span>Retire from work if you like. Never from life. · dontdieretired.com · hello@dontdieretired.com</span></div></div>
</section>
</body></html>`;

const out = n => path.join(__dirname, 'out', n);
fs.writeFileSync(out(`${id}-cover.html`), coverHtml); fs.writeFileSync(out(`${id}.html`), bodyDoc);
if (process.argv.includes('--html-only')) process.exit(0);

(async () => {
  const { chromium } = require(PW);
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage();
  await p.goto('file://' + out(`${id}-cover.html`)); await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: out(`${id}-cover.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await p.setViewportSize({ width: 794, height: 1123 });
  await p.screenshot({ path: out(`${id}-cover.png`) });
  await p.goto('file://' + out(`${id}.html`)); await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: out(`${id}-body.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#7a7d86;padding:0 17mm;display:flex;justify-content:space-between"><span>${esc(C.title)} · Don't Die Retired</span><span><span class="pageNumber"></span></span></div>`,
    margin: { top: '17mm', bottom: '19mm', left: '17mm', right: '17mm' } });
  await b.close();
  execFileSync('python3', ['-c', `import pypdf,sys
w=pypdf.PdfWriter()
for f in sys.argv[1:3]: w.append(f)
w.add_metadata({"/Title":sys.argv[4],"/Author":"Don't Die Retired"})
w.write(sys.argv[3])`, out(`${id}-cover.pdf`), out(`${id}-body.pdf`), out(`${id}.pdf`), C.title], { stdio: 'inherit' });
  console.log('wrote', out(`${id}.pdf`));
})();

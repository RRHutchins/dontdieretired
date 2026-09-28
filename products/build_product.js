// Don't Die Retired — product document builder.
// Usage: node build_product.js content/<name>.json  → out/<name>.docx
// Content JSON: { title, subtitle, price, kind, blocks: [ {h1|h2|p|lead|bullets|numbers|table|checklist|callout|week|pagebreak|quote} ] }
const fs = require('fs'); const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, LevelFormat, PageBreak, BorderStyle, Footer, PageNumber, Header } = require('docx');

const RED = "B23A48", NAVY = "1F4E79", GREEN = "0B6E4F", GOLD = "C98A2B", INK = "1B1B1F", MUTED = "5B5F6B";
const src = process.argv[2]; const C = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = path.join('out', path.basename(src, '.json') + '.docx'); fs.mkdirSync('out', { recursive: true });

const run = (t, o = {}) => new TextRun({ text: t, font: "Calibri", size: 22, ...o });
const rich = (t, base = {}) => { // **bold** support
  const parts = t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map(p => p.startsWith('**') ? run(p.slice(2, -2), { bold: true, ...base }) : run(p, base));
};
const P = (t, o = {}) => new Paragraph({ children: rich(t, o.run || {}), spacing: { after: 120, line: 300 }, ...o.para });
const H1 = t => new Paragraph({ children: [run(t, { size: 34, bold: true, color: NAVY, font: "Georgia" })], heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 160 }, pageBreakBefore: false });
const H2 = t => new Paragraph({ children: [run(t, { size: 26, bold: true, color: RED })], heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 } });
const BUL = (items, ref = "bul") => items.map(t => new Paragraph({ numbering: { reference: ref, level: 0 }, children: rich(t), spacing: { after: 60 } }));
let numSeq = 0;
const NUM = items => { numSeq++; return items.map(t => new Paragraph({ numbering: { reference: "num" + numSeq, level: 0 }, children: rich(t), spacing: { after: 60 } })); };
const numConfigs = [];
const CHECK = items => items.map(t => new Paragraph({ children: [run("☐  ", { size: 24 }), ...rich(t)], spacing: { after: 80 }, indent: { left: 300 } }));

function cell(t, w, opts = {}) {
  return new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 100, right: 100 },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
    children: [new Paragraph({ children: rich(String(t), { size: 19, bold: !!opts.bold, color: opts.color }) })] });
}
function TABLE(headers, rows, widths) {
  widths = widths || headers.map(() => Math.floor(9000 / headers.length));
  return new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { fill: NAVY, bold: true, color: "FFFFFF" })) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], { fill: ri % 2 ? "F5F3EE" : undefined })) }))] });
}
function CALLOUT(title, text, color = GOLD) {
  return new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [9000], rows: [new TableRow({ children: [new TableCell({
    width: { size: 9000, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: "FFF6E8", color: "auto" },
    borders: { left: { style: BorderStyle.SINGLE, size: 24, color }, top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    margins: { top: 120, bottom: 120, left: 200, right: 200 },
    children: [new Paragraph({ children: [run(title, { bold: true, color: NAVY })], spacing: { after: 60 } }), ...text.split("\n").map(l => new Paragraph({ children: rich(l), spacing: { after: 60 } }))] })] })] });
}
function WEEK(title, days) { // days: [{day, task, note}]
  const w = [1400, 4600, 3000];
  return [H2(title), new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: w,
    rows: [new TableRow({ tableHeader: true, children: ["Day", "Do this", "Done / how did it feel?"].map((h, i) => cell(h, w[i], { fill: GREEN, bold: true, color: "FFFFFF" })) }),
      ...days.map(d => new TableRow({ children: [cell(d.day, w[0], { bold: true }), cell(d.task, w[1]), cell("☐  " + (d.note || ""), w[2])] }))] })];
}
const QUOTE = (t, who) => new Paragraph({ children: [run("“" + t + "”", { italics: true, size: 24, font: "Georgia", color: INK }), run(who ? "  — " + who : "", { size: 19, color: MUTED })], indent: { left: 500 }, spacing: { before: 120, after: 160 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: RED, space: 8 } } });

const children = [];
// Cover
children.push(new Paragraph({ spacing: { before: 2000 }, children: [run("DON'T DIE RETIRED", { size: 22, bold: true, color: RED, characterSpacing: 60 })] }));
children.push(new Paragraph({ children: [run(C.title, { size: 60, bold: true, color: NAVY, font: "Georgia" })], spacing: { after: 200 } }));
children.push(new Paragraph({ children: [run(C.subtitle, { size: 28, color: MUTED })], spacing: { after: 400 } }));
children.push(new Paragraph({ children: [run(C.kind + (C.price ? "  ·  " + C.price : ""), { size: 20, color: MUTED })] }));
children.push(new Paragraph({ children: [run("dontdieretired.com", { size: 20, color: RED, bold: true })], spacing: { before: 3000 } }));
children.push(new Paragraph({ children: [run(C.disclaimer || "This guide is general information, not medical advice. Check with your GP or a health professional before starting a new exercise programme, especially if you have a heart condition, high blood pressure, joint problems or have been inactive for a long time. Stop and seek advice if anything hurts.", { size: 17, color: MUTED })], spacing: { before: 200 } }));
children.push(new Paragraph({ children: [new PageBreak()] }));

for (const b of C.blocks) {
  if (b.h1) children.push(H1(b.h1));
  else if (b.h2) children.push(H2(b.h2));
  else if (b.p) children.push(P(b.p));
  else if (b.lead) children.push(P(b.lead, { run: { size: 25, color: "333333" } }));
  else if (b.bullets) children.push(...BUL(b.bullets));
  else if (b.numbers) { children.push(...NUM(b.numbers)); numConfigs.push(numSeq); }
  else if (b.checklist) children.push(...CHECK(b.checklist));
  else if (b.table) children.push(TABLE(b.table.headers, b.table.rows, b.table.widths), P(""));
  else if (b.callout) children.push(CALLOUT(b.callout.title, b.callout.text, b.callout.color), P(""));
  else if (b.week) children.push(...WEEK(b.week.title, b.week.days), P(""));
  else if (b.quote) children.push(QUOTE(b.quote.text, b.quote.who));
  else if (b.pagebreak) children.push(new Paragraph({ children: [new PageBreak()] }));
}

const doc = new Document({
  styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
  numbering: { config: [
    { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    ...numConfigs.map(n => ({ reference: "num" + n, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 320 } } } }] })) ] },
  sections: [{ properties: { page: { margin: { top: 1300, bottom: 1200, left: 1300, right: 1300 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(C.title + "  ·  dontdieretired.com", { size: 16, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("© Don't Die Retired · Page ", { size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED })] })] }) },
    children }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log("wrote", out); });

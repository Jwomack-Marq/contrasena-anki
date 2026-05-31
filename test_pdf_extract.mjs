// Test harness for the PDF vocabulary extractor: runs against a saved PDF
// fixture and asserts card count, sections, accent preservation, and that
// non-vocab rows (UNIDAD title, Vocabulario subtitle, footer) are skipped.
// The logic is duplicated from grab_pdfs.mjs on purpose (same repo convention —
// each scraper/test stays a standalone unit).
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const COMBINING_MARKS = /[̀-ͯ]/g;
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ').trim();
const ALL_CAPS = /^[\p{Lu}\s'\-:¿?¡!.,&/()]+$/u;
const isAllCaps = (s) => !!s && /\p{Lu}/u.test(s) && ALL_CAPS.test(s.trim());
const SKIP_LINE = /^(UNIDAD\b|Vocabulario\b|Copyright|lingrolearning)/i;

async function extractCards(id, pdfData) {
  const pdf = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.s && it.s.trim());
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of items) {
      if (!cur || Math.abs(cur.y - it.y) > 3) { cur = { y: it.y, items: [] }; rows.push(cur); }
      cur.items.push(it);
    }
  }
  let currentSection = 'unknown';
  const lines = [];
  for (const row of rows) {
    if (row.items.length < 2) continue;
    const sp = row.items[0].s.trim();
    const en = row.items[row.items.length - 1].s.trim();
    if (!sp || !en) continue;
    if (SKIP_LINE.test(sp) || SKIP_LINE.test(en)) continue;
    if (isAllCaps(sp) && isAllCaps(en)) { currentSection = tagify(sp); continue; }
    if (sp === en) continue;
    lines.push(safeCell(sp) + '\t' + safeCell(en) + '\t' +
               `Contrasena::lessons::${id} Contrasena::sections::${currentSection}` + '\t');
  }
  return lines;
}

const pdf = new Uint8Array(readFileSync(new URL('./fixture_vocab_03_1.pdf', import.meta.url)));
const lines = await extractCards('u3_v1', pdf);

let fail = 0;
const assert = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fail++; };
const has = (sp, en) => lines.some(l => l.startsWith(sp + '\t' + en + '\t'));
const sectionsOf = new Set();
for (const l of lines) { const m = l.match(/sections::(\S+)/); if (m) sectionsOf.add(m[1]); }

console.log(`=== Card count: ${lines.length} ===`);
assert(lines.length === 23, 'expected 23 cards (7 days + 12 months + 4 seasons)');

console.log(`=== Sections: ${[...sectionsOf].sort().join(', ')} ===`);
assert(sectionsOf.size === 3, 'three sections');
assert(sectionsOf.has('los_dias_de_la_semana'), 'section: days of the week');
assert(sectionsOf.has('los_meses_del_ano'),     'section: months of the year');
assert(sectionsOf.has('las_estaciones'),        'section: seasons');

assert(has('lunes', 'Monday'),       'lunes -> Monday');
assert(has('miércoles', 'Wednesday'), 'miércoles -> Wednesday (accent in Spanish)');
assert(has('sábado', 'Saturday'),     'sábado -> Saturday (accent)');
assert(has('el otoño', 'fall'),       'el otoño -> fall (ñ preserved)');
assert(has('el invierno', 'winter'),  'el invierno -> winter');

// Non-vocab rows must be excluded.
const flat = lines.join('\n');
assert(!/^UNIDAD/m.test(flat), 'UNIDAD title not emitted');
assert(!/Vocabulario/.test(flat), 'Vocabulario subtitle not emitted');
assert(!/Copyright/.test(flat), 'Copyright footer not emitted');
assert(!/<[a-z/]/i.test(flat), 'no leaked HTML');

console.log(fail ? `\n${fail} assertion(s) failed.` : '\nAll checks passed.');
process.exit(fail ? 1 : 0);

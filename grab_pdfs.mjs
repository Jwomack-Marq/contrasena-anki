// PDF vocabulary grabber: extracts Spanish↔English pairs from Contraseña's
// vocab PDFs (e.g. Contrasena_Vocabulario_03-1.pdf) and writes one TSV per
// page-set, matching the existing TSV format used by grab_all.mjs.
//
// PDF layout (all 12 vocab PDFs follow the same template):
//   y=683  "UNIDAD N"                            (centered title — skipped)
//   y=659  "Vocabulario N-M"                     (subtitle — skipped)
//   y=...  "ALL-CAPS HEADER" | "ENGLISH HEADER"  (section divider)
//   y=...  "el otoño"        | "fall"            (entry: Spanish | English)
//   ...    Copyright/footer at bottom            (skipped)
//
// Helpers are kept inline so this stays a single-file unit (same convention as
// grab_all.mjs / grab_grammar.mjs).
//
// Usage:
//   node grab_pdfs.mjs --urls pdf_urls.txt
//   node grab_pdfs.mjs --urls pdf_urls.txt --out ./output_pdfs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const COMBINING_MARKS = /[̀-ͯ]/g;
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ').trim();

// Contrasena_Vocabulario_03-1.pdf -> u3_v1
function lessonIdFromUrl(url) {
  const file = decodeURIComponent(url).split(/[?#]/)[0].split('/').pop() || '';
  const m = /Contrasena_Vocabulario_(\d+)-(\d+)/i.exec(file);
  return m
    ? `u${parseInt(m[1], 10)}_v${parseInt(m[2], 10)}`
    : tagify(file.replace(/\.pdf$/i, ''));
}

// True if the trimmed string is entirely uppercase letters / whitespace /
// connector punctuation. Section headers are written this way in every PDF;
// entries are mixed/lowercase. Allows accented uppercase (Á É Í Ó Ú Ñ Ü).
const ALL_CAPS = /^[\p{Lu}\s'\-:¿?¡!.,&/()]+$/u;
const isAllCaps = (s) => !!s && /\p{Lu}/u.test(s) && ALL_CAPS.test(s.trim());

// Lines we never emit as entries.
const SKIP_LINE = /^(UNIDAD\b|Vocabulario\b|Copyright|lingrolearning)/i;

async function extractCards(url, pdfData) {
  const id = lessonIdFromUrl(url);
  const pdf = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
  const rows = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // Strip whitespace-only filler items between the columns.
    const items = tc.items
      .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.s && it.s.trim());
    // Top-to-bottom, then left-to-right.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    // Group into rows by y (tolerance: 3 PDF units ≈ a single line).
    let cur = null;
    for (const it of items) {
      if (!cur || Math.abs(cur.y - it.y) > 3) {
        cur = { y: it.y, items: [] };
        rows.push(cur);
      }
      cur.items.push(it);
    }
  }

  let currentSection = 'unknown';
  const lines = [];
  for (const row of rows) {
    if (row.items.length < 2) continue;   // single-item rows are titles / page nums
    const sp = row.items[0].s.trim();
    const en = row.items[row.items.length - 1].s.trim();
    if (!sp || !en) continue;
    if (SKIP_LINE.test(sp) || SKIP_LINE.test(en)) continue;
    // Section detection BEFORE the sp===en skip: some PDFs (e.g. u4-2) repeat
    // the same all-caps header in both columns, which would otherwise be
    // dropped as a duplicate and leave the section as "unknown".
    if (isAllCaps(sp) && isAllCaps(en)) {
      currentSection = tagify(sp);
      continue;
    }
    if (sp === en) continue;   // self-referential row — nothing useful to learn
    const tags = `Contrasena::lessons::${id} Contrasena::sections::${currentSection}`;
    lines.push(safeCell(sp) + '\t' + safeCell(en) + '\t' + tags + '\t');
  }
  return { id, lines };
}

async function fetchPdf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const { values } = parseArgs({
  options: {
    urls: { type: 'string' },
    out:  { type: 'string', default: './output_pdfs' },
  },
});
if (!values.urls) {
  console.error('Required: --urls <file> (one PDF URL per line, # comments ok)');
  process.exit(1);
}
mkdirSync(values.out, { recursive: true });

const urls = readFileSync(values.urls, 'utf8')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('#'));
console.log(`Loaded ${urls.length} URL${urls.length === 1 ? '' : 's'} from ${values.urls}`);

const header = '#separator:tab\n#html:false\n#tags column:3\n';
const allLines = [];
const foundUrls = [];

// Sequential — pdfjs-dist is fine but its log noise scales with parallelism.
for (const url of urls) {
  try {
    const data = await fetchPdf(url);
    const { id, lines } = await extractCards(url, data);
    if (!lines.length) { console.log(`  ${url}: skipped (no cards found)`); continue; }
    writeFileSync(join(values.out, `${id}.tsv`), header + lines.join('\n') + '\n', 'utf8');
    allLines.push(...lines);
    foundUrls.push(url);
    console.log(`  ${id}: ${lines.length} cards`);
  } catch (e) {
    console.error(`  ! ${url}: ${e.message}`);
  }
}

if (foundUrls.length > 1) {
  writeFileSync(join(values.out, 'contrasena_vocab_pdfs.tsv'), header + allLines.join('\n') + '\n', 'utf8');
  writeFileSync(join(values.out, 'found_urls.txt'), foundUrls.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${foundUrls.length} per-PDF TSVs + contrasena_vocab_pdfs.tsv (${allLines.length} cards total)`);
} else if (foundUrls.length === 1) {
  console.log(`\nWrote 1 TSV (${allLines.length} cards).`);
} else {
  console.log('\nNo cards extracted.');
}

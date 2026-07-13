// HTML vocabulary grabber: extracts Spanish↔English pairs from Contraseña's
// static ADA vocab pages (e.g. ADA/u8/Contrasena_Vocabulario_08-2.html) and
// writes one TSV per page, byte-compatible with grab_pdfs.mjs so a file written
// here can drop-in replace the PDF-derived equivalent (same lesson id, same
// section tags, same column layout).
//
// These pages are the cleanest vocab source: one <table> per section, a <thead>
// row naming the section (Spanish | English), and <tbody> rows of Spanish | English
// entries with real UTF-8 accents. They fix the PDF extractor's line-wrap /
// under-extraction defects (e.g. u4_v2, u7_v2, u8_v2, u12_v2).
//
// Helpers are kept inline so this stays a single-file dependency-free Node
// script — same convention as grab_pdfs.mjs / grab_grammar.mjs.
//
// Usage:
//   node grab_vocab_html.mjs --urls vocab_html_urls.txt
//   node grab_vocab_html.mjs --urls vocab_html_urls.txt --out ./output_pdfs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const COMBINING_MARKS = /[̀-ͯ]/g;

// Decode the HTML entities these pages use. Vocab pages are mostly plain UTF-8;
// the notable entity is &gt; inside stem-change notes like "calentar (e&gt;ie)".
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
  iquest: '¿', iexcl: '¡', rarr: '→', mdash: '—', ndash: '–', hellip: '…',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', deg: '°',
};
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}
// Strip the small subset of HTML these pages use, then decode entities. Same
// output shape as grab_pdfs.mjs so cards match the rest of the pipeline.
function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}
// tagify is for ids/tags ONLY — it strips accents. Never run card content
// through it; the Spanish/English text must keep its accents.
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ').trim();

// Contrasena_Vocabulario_08-2.html -> u8_v2  (matches grab_pdfs.mjs mapping)
function lessonIdFromUrl(url) {
  const file = decodeURIComponent(url).split(/[?#]/)[0].split('/').pop() || '';
  const m = /Contrasena_Vocabulario_(\d+)-(\d+)/i.exec(file);
  return m
    ? `u${parseInt(m[1], 10)}_v${parseInt(m[2], 10)}`
    : tagify(file.replace(/\.html?$/i, ''));
}

// Split a chunk of HTML into tables -> rows -> cell texts. Dependency-free small
// regex parser (same as grab_grammar.mjs). Vocab tables are plain 2-column grids;
// colspan/rowspan are not used here.
function parseTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tm[1]))) {
      const cells = [];
      const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) cells.push(stripHtml(cm[2]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

// One <table> per topical section: row[0] = "<Spanish section> | <English section>"
// (the <thead>), row[1..] = "<Spanish entry> | <English entry>" (the <tbody>).
function extractCards(url, html) {
  const id = lessonIdFromUrl(url);
  const lines = [];
  for (const rows of parseTables(html)) {
    if (rows.length < 2 || (rows[0] || []).length < 2) continue;   // need a header + entries
    const section = tagify(rows[0][0]);                            // Spanish section name
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length < 2) continue;
      const spanish = safeCell(cells[0]);
      const english = safeCell(cells[cells.length - 1]);
      if (!spanish || !english) continue;
      const tags = `Contrasena::lessons::${id} Contrasena::sections::${section}`;
      // Trailing empty 4th column = audio URL (none for HTML source), matching grab_pdfs.mjs.
      lines.push(spanish + '\t' + english + '\t' + tags + '\t');
    }
  }
  return { id, lines };
}

async function fetchPage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

const { values } = parseArgs({
  options: {
    urls: { type: 'string' },
    out:  { type: 'string', default: './output_pdfs' },
  },
});
if (!values.urls) {
  console.error('Required: --urls <file> (one vocab HTML URL per line, # comments ok)');
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
const foundIds = [];
const foundUrls = [];

// Sequential — polite to S3 and keeps log output ordered.
for (const url of urls) {
  try {
    const html = await fetchPage(url);
    const { id, lines } = extractCards(url, html);
    if (!lines.length) { console.log(`  ! ${url}: 0 cards (no vocab tables found)`); continue; }
    writeFileSync(join(values.out, `${id}.tsv`), header + lines.join('\n') + '\n', 'utf8');
    allLines.push(...lines);
    foundIds.push(id);
    foundUrls.push(url);
    console.log(`  ${id}: ${lines.length} cards`);
  } catch (e) {
    console.error(`  ! ${url}: ${e.message}`);
  }
}

// Regenerate the combined "all vocab" deck under the same filename grab_pdfs.mjs
// used, so it drop-in replaces the existing combined deck (keeps deck identity /
// saved localStorage selection stable). Only meaningful for multiple pages.
if (foundUrls.length > 1) {
  writeFileSync(join(values.out, 'contrasena_vocab_pdfs.tsv'), header + allLines.join('\n') + '\n', 'utf8');
  writeFileSync(join(values.out, 'found_urls.txt'), foundUrls.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${foundIds.length} per-page TSVs + contrasena_vocab_pdfs.tsv (${allLines.length} cards total) to ${values.out}`);
} else {
  console.log(`\nWrote ${foundIds.length} per-page TSV${foundIds.length === 1 ? '' : 's'} to ${values.out}`);
}

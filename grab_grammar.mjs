// Grammar grabber: pulls Spanish verb-conjugation tables from Contraseña's
// static grammar HTML pages (e.g. ADA/u2/Grammar_2-1.html) and writes one TSV
// per page. Each card is "{verb} — {subject}" (English/prompt column) paired
// with the conjugated form (Spanish/answer column), sectioned by verb.
//
// Helpers are kept inline so this stays a single-file dependency-free Node
// script — same convention as grab_all.mjs (no shared module, no npm deps).
//
// Usage:
//   node grab_grammar.mjs --urls urls.txt                 # one page URL per line, # comments ok
//   node grab_grammar.mjs --urls urls.txt --out ./output_grammar --concurrency 10
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const COMBINING_MARKS = /[̀-ͯ]/g;

// Strip the small subset of HTML / entities these pages use. Same rules as
// grab_all.mjs so output matches the rest of the pipeline.
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
// tagify is for ids/tags ONLY — it strips accents. Never run card content
// through it; the conjugated forms and subjects must keep their accents.
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');

// .../u2/Grammar_2-1.html  ->  grammar_2_1
function lessonIdFromUrl(url) {
  const file = decodeURIComponent(url).split(/[?#]/)[0].split('/').pop() || url;
  return tagify(file.replace(/\.html?$/i, ''));
}

// Split a chunk of HTML into tables -> rows -> cell texts. Dependency-free, so
// this is a deliberately small regex parser. Handles the simple grids these
// grammar pages use; colspan/rowspan would misalign columns (not handled —
// no such tables seen yet).
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

// These pages have 2+ tables (a Q&A examples table AND the conjugation table).
// Select the one whose header's first cell names the subject column.
function pickConjugationTable(tables) {
  const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
  for (const rows of tables) {
    const head = rows[0] || [];
    if (head.length >= 2 && SUBJ.test(head[0]) && rows.length >= 2) return rows;
  }
  return null;
}

function extractCards(url, html) {
  const id = lessonIdFromUrl(url);
  const rows = pickConjugationTable(parseTables(html));
  if (!rows) return { id, lines: [], warn: 'no conjugation table found' };
  const verbs = rows[0].slice(1);   // e.g. ["ser", "estar"]
  const lines = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const subject = cols[0] || '';
    if (!subject) continue;
    for (let c = 1; c < cols.length && c <= verbs.length; c++) {
      const verb = verbs[c - 1];
      const form = cols[c] || '';
      if (!verb || !form) continue;   // drop blank cells
      const spanish = safeCell(form);                          // "soy"
      const english = safeCell(verb + ' — ' + subject);        // "ser — yo (I)"
      const tags = 'Contrasena::lessons::' + id +
                   ' Contrasena::sections::' + tagify(verb);
      lines.push(spanish + '\t' + english + '\t' + tags + '\t'); // audioUrl empty
    }
  }
  return { id, lines, warn: lines.length ? '' : 'table found but 0 cards' };
}

async function fetchPage(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { url, status: resp.status, html: null };
    return { url, status: 200, html: await resp.text() };
  } catch (e) {
    return { url, status: 0, error: e.message, html: null };
  }
}

async function mapConcurrent(items, fn, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

const { values } = parseArgs({
  options: {
    urls:        { type: 'string' },
    out:         { type: 'string', default: './output_grammar' },
    concurrency: { type: 'string', default: '10' },
  },
});

if (!values.urls) {
  console.error('Required: --urls <file> (one grammar page URL per line, # comments ok)');
  process.exit(1);
}

mkdirSync(values.out, { recursive: true });

const urls = readFileSync(values.urls, 'utf8')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('#'));
console.log(`Loaded ${urls.length} URL${urls.length === 1 ? '' : 's'} from ${values.urls}`);

const results = await mapConcurrent(urls, fetchPage, parseInt(values.concurrency, 10));

const header = '#separator:tab\n#html:false\n#tags column:3\n';
const allLines = [];
const foundUrls = [];

for (const { url, status, html, error } of results) {
  if (status !== 200 || !html) {
    console.log(`  ! ${url}: status=${status} ${error || ''}`);
    continue;
  }
  const { id, lines, warn } = extractCards(url, html);
  if (!lines.length) {
    console.log(`  ${id}: skipped (${warn})`);
    continue;
  }
  foundUrls.push(url);
  allLines.push(...lines);
  writeFileSync(join(values.out, `${id}.tsv`), header + lines.join('\n') + '\n', 'utf8');
  console.log(`  ${id}: ${lines.length} cards`);
}

// Combined file only makes sense for multiple pages — for a single page it
// would just duplicate the per-page TSV as a second library item.
if (foundUrls.length > 1) {
  writeFileSync(join(values.out, 'contrasena_grammar_all.tsv'), header + allLines.join('\n') + '\n', 'utf8');
  writeFileSync(join(values.out, 'found_urls.txt'), foundUrls.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${foundUrls.length} per-page TSVs + contrasena_grammar_all.tsv (${allLines.length} cards total)`);
} else if (foundUrls.length === 1) {
  console.log(`\nWrote 1 TSV (${allLines.length} cards).`);
} else {
  console.log('\nNo cards extracted.');
}

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

// Strip a trailing English gloss from a verb header: "Estudiar (To Study)" -> "Estudiar".
const cleanVerb = (v) => String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
// Column headers that are conjugation patterns / glosses, not actual verbs.
// Skipping them avoids junk cards like "Verb Ending — yo → -o", unnamed
// "Conjugated Form — yo → como", or the possessive page's Singular/Plural/English.
const GENERIC_COL = /^(verb\s+)?ending$|^conjugated\s+form$|^forms?$|^singular\s+form$|^plural\s+form$|^english$/i;

// Strategy 1 — a clean person×verb grid: header "Sujeto | verb | verb…", then
// one row per subject pronoun. Pick the table whose header names the subject
// column (these pages also have an unrelated Q&A examples table).
function gridPairs(tables) {
  const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
  let rows = null;
  for (const t of tables) {
    const head = t[0] || [];
    if (head.length >= 2 && SUBJ.test(head[0]) && t.length >= 2) { rows = t; break; }
  }
  if (!rows) return [];
  const verbs = rows[0].slice(1).map(cleanVerb);   // e.g. ["ser", "estar"]
  const pairs = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const subject = cols[0] || '';
    if (!subject) continue;
    for (let c = 1; c < cols.length && c <= verbs.length; c++) {
      const verb = verbs[c - 1], form = cols[c] || '';
      if (!verb || GENERIC_COL.test(verb) || !form) continue;
      pairs.push({ verb, subject, form });
    }
  }
  return pairs;
}

// Strategy 2 — some pages (saber/conocer, haber) don't use a grid: a "Forms"
// row holds each verb's whole conjugation as pronoun-delimited text in one
// cell, e.g. "yo sé tú sabes él/ella; Ud. sabe …". Split by the six canonical
// subject pronouns.
const SUBJECTS = [
  { re: 'yo',                       label: 'yo (I)' },
  { re: 't[úu]',                    label: 'tú (you, informal)' },
  { re: 'él/ella[;/] *Ud\\.?',      label: 'él/ella; Ud. (he/she/it; you, formal)' },
  { re: 'nosotros/nosotras',        label: 'nosotros/nosotras (we)' },
  { re: 'vosotros/vosotras',        label: 'vosotros/vosotras (you all, informal)' },
  { re: 'ellos/ellas[;/] *Uds\\.?', label: 'ellos/ellas; Uds. (they; you, formal)' },
];
function parseFormsCell(text) {
  const found = [];
  for (const s of SUBJECTS) {
    const m = new RegExp(s.re, 'i').exec(text);
    if (m) found.push({ idx: m.index, end: m.index + m[0].length, label: s.label });
  }
  found.sort((a, b) => a.idx - b.idx);
  const out = [];
  for (let i = 0; i < found.length; i++) {
    const start = found[i].end;
    const stop = i + 1 < found.length ? found[i + 1].idx : text.length;
    const form = text.slice(start, stop).replace(/^[\s—:.\-]+/, '').trim();
    if (form) out.push({ subject: found[i].label, form });
  }
  return out;
}
function formsRowPairs(tables) {
  for (const rows of tables) {
    const header = rows[0] || [];
    const formsRow = rows.find(r => /^(forms?|conjugat)/i.test(r[0] || ''));
    if (header.length < 2 || !formsRow) continue;
    const pairs = [];
    for (let c = 1; c < header.length && c < formsRow.length; c++) {
      const verb = cleanVerb(header[c]);
      if (!verb || GENERIC_COL.test(verb)) continue;
      for (const { subject, form } of parseFormsCell(formsRow[c])) pairs.push({ verb, subject, form });
    }
    if (pairs.length) return pairs;
  }
  return [];
}

function extractCards(url, html) {
  const id = lessonIdFromUrl(url);
  const tables = parseTables(html);
  let pairs = gridPairs(tables);
  if (!pairs.length) pairs = formsRowPairs(tables);
  if (!pairs.length) return { id, lines: [], warn: 'no conjugation table found' };
  const lines = pairs.map(({ verb, subject, form }) =>
    safeCell(form) + '\t' + safeCell(verb + ' — ' + subject) +
    '\t' + 'Contrasena::lessons::' + id + ' Contrasena::sections::' + tagify(verb) + '\t'
  );
  return { id, lines, warn: '' };
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

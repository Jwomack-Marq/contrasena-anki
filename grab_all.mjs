// Bulk grabber: probes Contraseña show_hide lesson IDs and writes a TSV per
// lesson plus a combined contrasena_all.tsv. Same extraction rules as
// bookmarklet.js — kept inline so this stays a single-file dependency-free
// Node script.
//
// Usage:
//   node grab_all.mjs                       # brute-force u1..u6
//   node grab_all.mjs --ids ids.txt         # explicit list (one per line, # comments ok)
//   node grab_all.mjs --units 3 --out ./out # narrower sweep, custom dir
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const BASE = 'https://s3.us-east-2.amazonaws.com/contrasena/interactives/show_hide/data';
const SECTION_BG = '#7C3483';
const COMBINING_MARKS = /[̀-ͯ]/g;

// Strip the small subset of HTML / entities Contraseña actually uses.
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
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');

function extractCards(id, data) {
  let currentSection = 'unknown';
  const headerCells = (data.headers || []).filter(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
  const firstHeading = headerCells.find(c => c.type !== 'audio' && c.sortOrder === 1)
                    || headerCells.find(c => c.type !== 'audio');
  if (firstHeading) {
    const name = stripHtml(firstHeading.content);
    if (name) currentSection = tagify(name);
  }
  const lines = [];
  for (const row of data.body || []) {
    const cells = row.cells || [];
    const isHeader = cells.some(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
    if (isHeader) {
      const spCell = cells.find(c => c.sortOrder === 1 && c.type === 'text')
                  || cells.find(c => c.type === 'text');
      const name = stripHtml(spCell ? spCell.content : '');
      if (name) currentSection = tagify(name);
      continue;
    }
    const sp = cells.find(c => c.sortOrder === 1 && c.type === 'text');
    const en = cells.find(c => c.sortOrder === 2 && c.type === 'text');
    const spanish = safeCell(stripHtml(sp ? sp.content : ''));
    const english = safeCell(stripHtml(en ? en.content : ''));
    if (!spanish && !english) continue;
    const tags = 'Contrasena::lessons::' + tagify(id) + ' Contrasena::sections::' + currentSection;
    lines.push(spanish + '\t' + english + '\t' + tags);
  }
  return lines;
}

function generateCandidates({ units, maxChapter, maxLesson, versions }) {
  const ids = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let u = 1; u <= units; u++) {
    for (let c = 1; c <= maxChapter; c++) {
      for (let l = 1; l <= maxLesson; l++) {
        for (const v of versions) {
          ids.push(`u${u}_${pad(c)}_${pad(l)}${v}`);
        }
      }
    }
  }
  return ids;
}

async function fetchLesson(id) {
  const url = `${BASE}/${id}/data.json`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { id, status: resp.status, data: null };
    const data = await resp.json();
    return { id, status: 200, data };
  } catch (e) {
    return { id, status: 0, error: e.message, data: null };
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
    ids:           { type: 'string' },
    units:         { type: 'string', default: '6' },
    'max-chapter': { type: 'string', default: '12' },
    'max-lesson':  { type: 'string', default: '12' },
    versions:      { type: 'string', default: ',v2,v3' },
    out:           { type: 'string', default: './output' },
    concurrency:   { type: 'string', default: '20' },
  },
});

mkdirSync(values.out, { recursive: true });

let candidates;
if (values.ids) {
  candidates = readFileSync(values.ids, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
  console.log(`Loaded ${candidates.length} IDs from ${values.ids}`);
} else {
  candidates = generateCandidates({
    units: parseInt(values.units, 10),
    maxChapter: parseInt(values['max-chapter'], 10),
    maxLesson: parseInt(values['max-lesson'], 10),
    versions: values.versions.split(','),
  });
  console.log(`Generated ${candidates.length} candidate IDs (u1..u${values.units}, ` +
              `chapters 01..${String(values['max-chapter']).padStart(2,'0')}, ` +
              `lessons 01..${String(values['max-lesson']).padStart(2,'0')}, ` +
              `versions [${values.versions}])`);
}

const start = Date.now();
const results = await mapConcurrent(
  candidates,
  fetchLesson,
  parseInt(values.concurrency, 10),
);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const found = results.filter(r => r.status === 200 && r.data);
const errors = results.filter(r => r.status !== 200 && r.status !== 403 && r.status !== 404);
console.log(`Probed ${results.length} IDs in ${elapsed}s — ${found.length} found, ` +
            `${results.length - found.length - errors.length} missing, ${errors.length} errors`);
for (const e of errors.slice(0, 10)) console.log(`  ! ${e.id}: status=${e.status} ${e.error || ''}`);

const header = '#separator:tab\n#html:false\n#tags column:3\n';
const allLines = [];
const foundIds = [];

for (const { id, data } of found) {
  const lines = extractCards(id, data);
  if (!lines.length) {
    console.log(`  ${id}: 0 cards (empty body, skipped)`);
    continue;
  }
  foundIds.push(id);
  allLines.push(...lines);
  const perFile = join(values.out, `${id}.tsv`);
  writeFileSync(perFile, header + lines.join('\n') + '\n', 'utf8');
  console.log(`  ${id}: ${lines.length} cards`);
}

if (allLines.length) {
  const combined = join(values.out, 'contrasena_all.tsv');
  writeFileSync(combined, header + allLines.join('\n') + '\n', 'utf8');
  writeFileSync(join(values.out, 'found_ids.txt'), foundIds.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${foundIds.length} per-lesson TSVs + ${combined} (${allLines.length} cards total)`);
  console.log(`Found IDs saved to ${join(values.out, 'found_ids.txt')}`);
} else {
  console.log('\nNo cards extracted.');
}

// Test harness for the grammar conjugation extractor: runs against a saved HTML
// fixture and asserts card count, sections, accent preservation, and that no
// HTML leaked into the output. Mirrors test_extract.mjs in style. The parsing
// logic below is duplicated from grab_grammar.mjs on purpose (same repo
// convention — each scraper/test stays a standalone dependency-free unit).
import { readFileSync } from 'node:fs';

const COMBINING_MARKS = /[̀-ͯ]/g;
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
function pickConjugationTable(tables) {
  const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
  for (const rows of tables) {
    const head = rows[0] || [];
    if (head.length >= 2 && SUBJ.test(head[0]) && rows.length >= 2) return rows;
  }
  return null;
}
function extractCards(id, html) {
  const rows = pickConjugationTable(parseTables(html));
  if (!rows) return [];
  const verbs = rows[0].slice(1);
  const lines = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const subject = cols[0] || '';
    if (!subject) continue;
    for (let c = 1; c < cols.length && c <= verbs.length; c++) {
      const verb = verbs[c - 1];
      const form = cols[c] || '';
      if (!verb || !form) continue;
      const tags = 'Contrasena::lessons::' + id + ' Contrasena::sections::' + tagify(verb);
      lines.push(safeCell(form) + '\t' + safeCell(verb + ' — ' + subject) + '\t' + tags + '\t');
    }
  }
  return lines;
}

const html = readFileSync(new URL('./fixture_grammar_2_1.html', import.meta.url), 'utf8');
const id = 'grammar_2_1';
const lines = extractCards(id, html);

let fail = 0;
const assert = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fail++; };

console.log('=== Card count: ' + lines.length + ' ===');
assert(lines.length === 12, 'expected 12 cards');

const sections = new Set();
for (const l of lines) { const m = l.match(/sections::(\S+)/); if (m) sections.add(m[1]); }
console.log('=== Sections: ' + [...sections].join(', ') + ' ===');
assert(sections.has('ser') && sections.has('estar') && sections.size === 2, 'sections = ser + estar');

const has = (sp, en) => lines.some(l => l.startsWith(sp + '\t' + en + '\t'));
assert(has('soy',    'ser — yo (I)'), 'yo -> soy');
assert(has('eres',   'ser — tú (you, informal)'), 'tú -> eres (accent in prompt)');
assert(has('estáis', 'estar — vosotros/vosotras (you all, informal)'), 'vosotros estar -> estáis (accent preserved)');
assert(has('está',   'estar — él/ella; Ud. (he/she/it; you, formal)'), 'él/ella estar -> está (accent preserved)');

console.log('=== First 4 cards ===');
for (const l of lines.slice(0, 4)) console.log('  ' + l);

const leaked = lines.filter(l => /<[a-z/]/i.test(l));
assert(leaked.length === 0, 'no leaked HTML tags');
if (leaked.length) leaked.forEach(l => console.log('  LEAK: ' + l));

console.log(fail ? `\n${fail} assertion(s) failed.` : '\nAll checks passed.');
process.exit(fail ? 1 : 0);

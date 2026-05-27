// Test harness for the grammar conjugation extractor: runs against saved HTML
// fixtures and asserts card count, sections, accent preservation, and that no
// HTML leaked into the output. Covers both extraction strategies:
//   - grid       (fixture_grammar_2_1.html: Sujeto | ser | estar)
//   - forms-row  (fixture_grammar_5_2.html: Category | Saber | Conocer)
// The logic below is duplicated from grab_grammar.mjs on purpose (same repo
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
const cleanVerb = (v) => String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const GENERIC_COL = /^(verb\s+)?ending$|^conjugated\s+form$|^forms?$|^singular\s+form$|^plural\s+form$|^english$/i;

function gridPairs(tables) {
  const SUBJ = /\b(sujeto|subject|pronombre|pronoun)\b/i;
  let rows = null;
  for (const t of tables) {
    const head = t[0] || [];
    if (head.length >= 2 && SUBJ.test(head[0]) && t.length >= 2) { rows = t; break; }
  }
  if (!rows) return [];
  const verbs = rows[0].slice(1).map(cleanVerb);
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
function extractCards(id, html) {
  const tables = parseTables(html);
  let pairs = gridPairs(tables);
  if (!pairs.length) pairs = formsRowPairs(tables);
  return pairs.map(({ verb, subject, form }) =>
    safeCell(form) + '\t' + safeCell(verb + ' — ' + subject) +
    '\t' + 'Contrasena::lessons::' + id + ' Contrasena::sections::' + tagify(verb) + '\t');
}

let fail = 0;
const assert = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fail++; };
const sectionsOf = (lines) => new Set(lines.map(l => (l.match(/sections::(\S+)/) || [])[1]).filter(Boolean));
const has = (lines, sp, en) => lines.some(l => l.startsWith(sp + '\t' + en + '\t'));
const noLeak = (lines) => lines.filter(l => /<[a-z/]/i.test(l)).length === 0;

// --- Grid strategy: ser/estar ---
const grid = extractCards('grammar_2_1', readFileSync(new URL('./fixture_grammar_2_1.html', import.meta.url), 'utf8'));
console.log('=== grid (grammar_2_1): ' + grid.length + ' cards, sections ' + [...sectionsOf(grid)].join('+') + ' ===');
assert(grid.length === 12, 'grid: 12 cards');
assert([...sectionsOf(grid)].sort().join(',') === 'estar,ser', 'grid: sections ser+estar');
assert(has(grid, 'soy', 'ser — yo (I)'), 'grid: yo -> soy');
assert(has(grid, 'estáis', 'estar — vosotros/vosotras (you all, informal)'), 'grid: estar vosotros -> estáis (accent)');
assert(noLeak(grid), 'grid: no leaked HTML');

// --- Forms-row strategy: saber/conocer ---
const forms = extractCards('grammar_5_2', readFileSync(new URL('./fixture_grammar_5_2.html', import.meta.url), 'utf8'));
console.log('=== forms-row (grammar_5_2): ' + forms.length + ' cards, sections ' + [...sectionsOf(forms)].join('+') + ' ===');
assert(forms.length === 12, 'forms: 12 cards');
assert([...sectionsOf(forms)].sort().join(',') === 'conocer,saber', 'forms: sections saber+conocer');
assert(has(forms, 'sé', 'Saber — yo (I)'), 'forms: saber yo -> sé');
assert(has(forms, 'conozco', 'Conocer — yo (I)'), 'forms: conocer yo -> conozco');
assert(has(forms, 'conocéis', 'Conocer — vosotros/vosotras (you all, informal)'), 'forms: conocer vosotros -> conocéis (accent)');
assert(noLeak(forms), 'forms: no leaked HTML');

console.log(fail ? `\n${fail} assertion(s) failed.` : '\nAll checks passed.');
process.exit(fail ? 1 : 0);

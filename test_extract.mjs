// One-shot test harness: runs the bookmarklet's extraction logic against the
// real lesson JSON and prints the resulting TSV + summary. Not part of the
// shipped tool — delete after verifying.
import { readFileSync } from 'node:fs';

// Minimal DOM stand-ins for the Node environment.
class FakeDOMParser {
  parseFromString(html) {
    // Strip tags + decode the handful of HTML entities Contraseña actually uses.
    const text = String(html || '')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return { body: { textContent: text } };
  }
}
globalThis.DOMParser = FakeDOMParser;

const data = JSON.parse(readFileSync(new URL('./fixture_u1_01_02v2.json', import.meta.url), 'utf8'));
const id = 'u1_01_02v2';

const SECTION_BG = '#7C3483';
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const stripHtml = (html) => {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};
const tagify = (s) => s.toLowerCase()
  .normalize('NFD').replace(COMBINING_MARKS, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown';
const safeCell = (s) => s.replace(/[\t\r\n]+/g, ' ');

let currentSection = 'unknown';
const sectionsSeen = [];
const headerCells = (data.headers || []).filter(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
const firstHeading = headerCells.find(c => c.type !== 'audio' && c.sortOrder === 1)
                  || headerCells.find(c => c.type !== 'audio');
if (firstHeading) {
  const name = stripHtml(firstHeading.content);
  if (name) {
    currentSection = tagify(name);
    sectionsSeen.push({ raw: name + ' (from headers)', tag: currentSection });
  }
}

const lines = [];
for (const row of data.body || []) {
  const cells = row.cells || [];
  const isHeader = cells.some(c => (c.backgroundColor || '').toUpperCase() === SECTION_BG);
  if (isHeader) {
    const spCell = cells.find(c => c.sortOrder === 1 && c.type === 'text')
                || cells.find(c => c.type === 'text');
    const name = stripHtml(spCell ? spCell.content : '');
    if (name) {
      currentSection = tagify(name);
      sectionsSeen.push({ raw: name, tag: currentSection });
    }
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

console.log('=== Sections detected ===');
for (const s of sectionsSeen) console.log(`  "${s.raw}"  →  ${s.tag}`);
console.log('\n=== Card count: ' + lines.length + ' ===');
console.log('\n=== First 5 cards ===');
for (const l of lines.slice(0, 5)) console.log(l);
console.log('\n=== Last 3 cards ===');
for (const l of lines.slice(-3)) console.log(l);
console.log('\n=== Sanity: any leaked HTML? ===');
const leaked = lines.filter(l => /<[a-z]/i.test(l));
console.log(leaked.length === 0 ? '  none' : leaked.join('\n'));

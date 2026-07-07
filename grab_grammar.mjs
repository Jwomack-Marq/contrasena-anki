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

// Decode the HTML entities these pages use. Later units write accents as named
// entities (&iacute; -> í), so decoding is required or forms come out as
// "proteg&iacute;a". Covers named Spanish accents/punctuation plus any numeric
// (&#233; / &#xE9;) reference.
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
// output shape as grab_all.mjs so cards match the rest of the pipeline.
function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
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

// Strip a trailing English gloss from a verb header: "Estudiar (To Study)" ->
// "Estudiar", and a "/To ..." slash-gloss: "Montar/To ride" -> "Montar".
const cleanVerb = (v) => {
  const s = String(v || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s*\/\s*to\b[\s\S]*$/i, '')
    .trim();
  // Some pages shout verb names ("SABER"); lowercase all-caps so prompts read
  // like the rest ("saber — yo"). Mixed-case names ("Montar") are left as-is.
  return /^[A-ZÁÉÍÓÚÑÜ]{2,}$/.test(s) ? s.toLowerCase() : s;
};
// Column headers that are conjugation patterns / glosses, not actual verbs.
// Skipping them avoids junk cards like "Verb Ending — yo → -o", unnamed
// "Conjugated Form — yo → como", or the possessive page's Singular/Plural/English.
const GENERIC_COL = /^(verb\s+)?ending$|^verb\s+endings?\b|^conjugated\s+form$|^forms?$|^singular\s+form$|^plural\s+form$|^english$|^process$|^example$/i;

// The six canonical subject pronouns, with friendly labels shared by every
// strategy so cards read identically no matter which table shape produced them.
const SUBJECTS = [
  { re: 'yo',                       label: 'yo (I)' },
  { re: 't[úu]',                    label: 'tú (you, informal)' },
  { re: 'él/ella[;/] *Ud\\.?',      label: 'él/ella; Ud. (he/she/it; you, formal)' },
  { re: 'nosotros/nosotras',        label: 'nosotros/nosotras (we)' },
  { re: 'vosotros/vosotras',        label: 'vosotros/vosotras (you all, informal)' },
  { re: 'ellos/ellas[;/] *Uds\\.?', label: 'ellos/ellas; Uds. (they; you, formal)' },
];
const SUBJECT_LABELS = SUBJECTS.map(s => s.label);

// Map a first-column cell to its canonical subject label, or null if it isn't a
// subject pronoun. Order matters: plural (Uds./ellos) is tested before the
// singular él/ella/Ud. so "Uds." isn't misread as "Ud.". A cell counts as a
// subject only if it STARTS with the pronoun. Note: JS `\b` is ASCII-only and
// fails after accented letters ("tú", "él"), so we assert "not followed by a
// letter" with an explicit accent-aware lookahead instead.
const NOT_LETTER = '(?![a-záéíóúñü])';
function normalizeSubject(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return null;
  if (new RegExp('^yo' + NOT_LETTER).test(s))    return SUBJECT_LABELS[0];
  if (new RegExp('^t[úu]' + NOT_LETTER).test(s)) return SUBJECT_LABELS[1];
  if (/^nosotr/.test(s))                         return SUBJECT_LABELS[3];
  if (/^vosotr/.test(s))                         return SUBJECT_LABELS[4];
  if (/^ellos|^ellas|uds\b|uds\./.test(s))       return SUBJECT_LABELS[5];
  if (new RegExp('^él|^ella|^el' + NOT_LETTER + '|\\bud\\b|ud\\.').test(s)) return SUBJECT_LABELS[2];
  return null;
}
// A run-on cell (e.g. a reflexive page's "yo me levanto tú te levantas …") packs
// several persons into one cell. After the leading pronoun is stripped, a real
// conjugated form never still contains another subject pronoun — reject if it does.
const HAS_INNER_SUBJECT = /(^|\s)(t[úu]|él|ella|ellos|ellas|nosotr\w*|vosotr\w*|uds?)(\s|$|;|,|\/)/i;
// True for a bare Spanish infinitive: montar, comer, escribir, sonreír, oír, ir.
const isInfinitive = (s) => {
  const t = String(s || '').trim();
  return /^[a-záéíóúñü]{2,}$/i.test(t) && /[aeií]r$/i.test(t);
};
// Some demo grids repeat the pronoun inside the form cell ("yo montaba",
// "él/ella; Ud. montaba"). Peel leading subject-pronoun tokens and the
// punctuation between them off, so the card answer is just the form.
function stripLeadingSubject(form) {
  const P = new RegExp('^(yo|t[úu]|él|ella|ellos|ellas|el|nosotr\\w*|vosotr\\w*|uds?)' + NOT_LETTER, 'i');
  let s = String(form || '').trim();
  while (true) {
    const before = s;
    s = s.replace(/^[\s;,.\/]+/, '');   // leading separators / stray "Ud." period
    const m = P.exec(s);
    if (m) s = s.slice(m[0].length);
    if (s === before) break;
  }
  return s.trim();
}

// Strategy 1 — person×verb grid, detected by finding subject pronouns down the
// first column (not by the header text). This catches grids whose subject-column
// header is blank ("| caer | dar | …"), which the old header-text match missed.
// Every table on the page is scanned, so pages with several verb grids yield all
// of them. cleanVerb + GENERIC_COL drop non-verb columns (Verb Ending, etc.).
function subjectGrids(tables) {
  const pairs = [];
  for (const rows of tables) {
    let b = -1;
    for (let i = 0; i < rows.length; i++) {
      if (normalizeSubject(rows[i][0])) { b = i; break; }
    }
    if (b < 1) continue;                     // need a header row above the pronouns
    let e = b;                               // grid ends at the first non-subject row
    while (e < rows.length && normalizeSubject(rows[e][0])) e++;
    if (e - b < 2) continue;                 // a real conjugation grid spans >=2 persons
    let h = b - 1;
    while (h >= 0 && rows[h].length < 2) h--;
    if (h < 0) continue;
    const verbs = rows[h].slice(1).map(cleanVerb);
    if (!verbs.some(v => v && !GENERIC_COL.test(v))) continue;
    for (let r = b; r < e; r++) {
      const subject = normalizeSubject(rows[r][0]);
      const cols = rows[r];
      for (let c = 1; c < cols.length && c <= verbs.length; c++) {
        const verb = verbs[c - 1];
        const form = stripLeadingSubject(cols[c] || '');
        if (!verb || GENERIC_COL.test(verb) || !form) continue;
        if (HAS_INNER_SUBJECT.test(form)) continue;   // drop run-on / multi-person cells
        pairs.push({ verb, subject, form });
      }
    }
  }
  return pairs;
}

// Strategy 1b — preterite "forms list" tables: "Infinitive | i-stem | Preterite
// forms" where the last cell packs the whole conjugation as a comma-separated
// list in canonical subject order ("hice, hiciste, hizo, hicimos, …"). Only
// emitted when exactly six forms are present.
function formsListPairs(tables) {
  const pairs = [];
  for (const rows of tables) {
    const header = rows[0] || [];
    if (header.length < 2 || !/infinitiv/i.test(header[0])) continue;
    const last = header.length - 1;
    if (!/(preterite\s+forms|conjugat)/i.test(header[last])) continue;
    for (let r = 1; r < rows.length; r++) {
      const verb = cleanVerb(rows[r][0]);
      if (!verb || GENERIC_COL.test(verb)) continue;
      const toks = String(rows[r][last] || '')
        .split(',')
        .map(t => t.replace(/[*†‡§0-9]+/g, '').trim())
        .filter(Boolean);
      if (toks.length !== 6) continue;
      toks.forEach((form, i) => pairs.push({ verb, subject: SUBJECT_LABELS[i], form }));
    }
  }
  return pairs;
}

// Strategy 2 — some pages (saber/conocer, haber) don't use a grid: a "Forms"
// row holds each verb's whole conjugation as pronoun-delimited text in one
// cell, e.g. "yo sé tú sabes él/ella; Ud. sabe …". Split by the six canonical
// subject pronouns.
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
    const formsRow = rows.find(r => /^(forms?|conjugat)/i.test(r[0] || ''));
    if (!formsRow) continue;
    // The verb-name header isn't always rows[0] — a spanning title ("TO KNOW")
    // can sit above it. Use the first same-width row that names the verbs,
    // skipping the "Uses"/"Forms"/"Examples" content rows (the verb names sit in
    // the "Verb | SABER | CONOCER" row, whose own label cell we ignore).
    const header = rows.find(r =>
      r !== formsRow && r.length === formsRow.length && !/^(forms?|conjugat|uses?|examples?)$/i.test(r[0] || ''));
    if (!header || header.length < 2) continue;
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

// Strategy 3 — present participles (gerunds): "preparar | prepar- + ando =
// preparando" or "decir | diciendo". col0 must be a bare infinitive and some
// later cell must contain an -ando/-iendo/-yendo word (preferring text after
// "="). Gated by title so it only runs on present-progressive pages.
const GERUND = /\b([a-záéíóúñü]+(?:ando|iendo|yendo))\b/i;
function gerundPairs(tables) {
  const pairs = [];
  for (const rows of tables) {
    for (const row of rows) {
      if (row.length < 2 || !isInfinitive(row[0])) continue;
      let form = '';
      for (let c = 1; c < row.length; c++) {
        const cell = row[c] || '';
        const after = cell.includes('=') ? cell.split('=').pop() : cell;
        const m = GERUND.exec(after) || GERUND.exec(cell);
        if (m) { form = m[1]; break; }
      }
      if (form) pairs.push({ verb: cleanVerb(row[0]), subject: 'present participle (gerund)', form });
    }
  }
  return pairs;
}

// Strategy 4a — affirmative informal (tú) commands: rows of
// "infinitive | command | example…" where the command is a single word
// (di, haz, ve, pon, sal, sé, ten, ven). Gated to the "affirmative informal"
// page so reflexive-infinitive rows elsewhere aren't misread as commands.
function informalCommandPairs(tables) {
  const pairs = [];
  for (const rows of tables) {
    for (const row of rows) {
      if (row.length < 2 || !isInfinitive(row[0])) continue;
      const cmd = String(row[1] || '').trim();
      if (!cmd || /\s/.test(cmd) || !/^[a-záéíóúñü]+$/i.test(cmd)) continue;
      pairs.push({ verb: cleanVerb(row[0]), subject: 'tú command (affirmative)', form: cmd });
    }
  }
  return pairs;
}

// Strategy 4b — formal (Ud./Uds.) commands. Two shapes:
//   • "Verb | 'Yo' Form | Affirmative Formal Command | Negative Formal Command"
//   • "Infinitive | Singular Commands (Ud.) | Plural Commands (Uds.)"
// The command cells keep both Ud./Uds. forms verbatim ("Ud. tenga Uds. tengan").
function formalCommandPairs(tables) {
  const pairs = [];
  for (const rows of tables) {
    const header = rows[0] || [];
    if (header.length < 2) continue;
    const af = header.findIndex(c => /affirmative/i.test(c));
    const neg = header.findIndex(c => /negative/i.test(c));
    const sing = header.findIndex(c => /singular\s+command/i.test(c));
    const plur = header.findIndex(c => /plural\s+command/i.test(c));
    if (af < 0 && neg < 0 && sing < 0 && plur < 0) continue;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!isInfinitive(row[0])) continue;   // skips "Placement"/"Example" rows
      const verb = cleanVerb(row[0]);
      const emit = (idx, subject) => {
        const form = String(row[idx] || '').trim();
        if (verb && form) pairs.push({ verb, subject, form });
      };
      if (af >= 0)   emit(af,   'formal command (affirmative)');
      if (neg >= 0)  emit(neg,  'formal command (negative)');
      if (sing >= 0) emit(sing, 'formal command (Ud.)');
      if (plur >= 0) emit(plur, 'formal command (Uds.)');
    }
  }
  return pairs;
}

function extractCards(url, html) {
  const id = lessonIdFromUrl(url);
  const title = stripHtml((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const tables = parseTables(html);
  const pairs = [
    ...subjectGrids(tables),
    ...formsListPairs(tables),
    ...formsRowPairs(tables),
  ];
  if (/progressive|participle|gerund/i.test(title)) pairs.push(...gerundPairs(tables));
  if (/affirmative\s+informal\s+command|affirmative\s+t[úu]\s+command/i.test(title)) {
    pairs.push(...informalCommandPairs(tables));
  }
  if (/command/i.test(title)) pairs.push(...formalCommandPairs(tables));
  // Dedup identical (form, verb, subject) triples produced by overlapping strategies.
  const seen = new Set();
  const uniq = [];
  for (const p of pairs) {
    if (!p.verb || !p.form) continue;
    const k = p.form + '|' + p.verb + '|' + p.subject;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  if (!uniq.length) return { id, lines: [], warn: 'no conjugation table found' };
  const lines = uniq.map(({ verb, subject, form }) =>
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

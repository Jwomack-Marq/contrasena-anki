// Audio backfill: fills the 4th (audioUrl) column of the ADA vocab decks in
// output_pdfs/ with Contraseña's real pronunciation MP3s.
//
// Two sources, tracked per row in audio_map.txt (column 5, `source`):
//   groundtruth — copied from the show_hide API scrape (output_full/*v2.tsv),
//                 which matches the ADA decks row-for-row for units 1/2/4/5/6.
//   inferred    — units 3 and 7–12 have no API data (403), but the MP3s exist
//                 on S3 under a strictly positional naming scheme:
//                 audio/u{unit}/{unit}_{list}_{index}.mp3, index 1..N where
//                 every section header consumes an index and the leading header
//                 sometimes does (header-first) and sometimes doesn't (word-first).
//                 We probe S3 for the folder's true file count N and accept a
//                 deck ONLY if exactly one of the two alignment hypotheses
//                 predicts N. Anything ambiguous fails closed (deck keeps empty
//                 audio and the in-app TTS fallback covers it).
//
// A positional mis-alignment would attach the WRONG word's audio everywhere,
// which is worse than no audio — hence the gates, the calibration mode, and
// the mandatory human listening pass over audio_review.html before committing
// audio_map.txt / running --apply.
//
// Usage:
//   node backfill_audio.mjs --calibrate    # validate inference against units 1/2/4/5/6
//   node backfill_audio.mjs --build-map    # write audio_map.txt + audio_review.html
//   node backfill_audio.mjs --apply        # write audio_map.txt URLs into output_pdfs/*.tsv
//   (add --no-cache to re-probe S3 instead of reusing audio_probe_cache.json)
//
// Single-file, dependency-free — same convention as the grab_*.mjs scripts.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AUDIO_BASE = 'https://s3.us-east-2.amazonaws.com/contrasena/audio';
const ADA_DIR = './output_pdfs';
const GT_DIR = './output_full';
const MAP_FILE = './audio_map.txt';
const REVIEW_FILE = './audio_review.html';
const CACHE_FILE = './audio_probe_cache.json';
const PROBE_DELAY_MS = 120;
const COMBINING_MARKS = /[̀-ͯ]/g;

// ---------------------------------------------------------------------------
// TSV parsing (schema: spanish \t english \t tags \t audioUrl)

export function parseTsvRows(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const tags = cols[2] || '';
    rows.push({
      spanish: cols[0],
      english: cols[1],
      lesson: (tags.match(/Contrasena::lessons::(\S+)/) || [])[1] || 'unknown',
      section: (tags.match(/Contrasena::sections::(\S+)/) || [])[1] || 'unknown',
      audioUrl: cols[3] || '',
    });
  }
  return rows;
}

// Spell out a numeral the way the Contraseña decks do (accent-free — keys are
// accent-stripped anyway). The ADA pages write digits ("22", "10.000") where
// the API decks write words ("veintidós", "diez mil"); canonicalizing both
// sides to words lets the numbers deck (u1_v2) join.
const NUM_UNITS = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
  'once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte'];
const NUM_VEINTI = ['','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis',
  'veintisiete','veintiocho','veintinueve'];
const NUM_TENS = { 30:'treinta', 40:'cuarenta', 50:'cincuenta', 60:'sesenta', 70:'setenta', 80:'ochenta', 90:'noventa' };
const NUM_HUNDREDS = { 100:'cien', 200:'doscientos', 300:'trescientos', 400:'cuatrocientos', 500:'quinientos',
  600:'seiscientos', 700:'setecientos', 800:'ochocientos', 900:'novecientos' };
export function spanishNumeral(n) {
  if (n <= 20) return NUM_UNITS[n];
  if (n < 30) return NUM_VEINTI[n - 20];
  if (n < 100) {
    const t = Math.floor(n / 10) * 10, u = n % 10;
    return u ? `${NUM_TENS[t]} y ${NUM_UNITS[u]}` : NUM_TENS[t];
  }
  if (n < 1000 && NUM_HUNDREDS[n]) return NUM_HUNDREDS[n];
  if (n === 1000) return 'mil';
  if (n < 1000000 && n % 1000 === 0) return `${spanishNumeral(n / 1000)} mil`;
  if (n === 1000000) return 'un millon';
  if (n % 1000000 === 0) return `${spanishNumeral(n / 1000000)} millones`;
  return String(n);
}

// Normalization for join keys. Mirrors the spirit of normalizeAnswer in
// index.html and tagify in grab_vocab_html.mjs: accent-insensitive,
// punctuation-insensitive, whitespace-collapsed. Additionally canonicalizes
// the two cosmetic conventions that differ between the ADA pages and the API
// text: digit numerals and gender-slash shorthand ("positivo/a").
export function normKey(s) {
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/…/g, ' ');
  // "positivo/a" → "positivo positiva"; "trabajador/a" → "trabajador trabajadora"
  t = t.replace(/\b([a-zn]+)\s*\/\s*a\b/g, (m, stem) =>
    `${stem} ${stem.endsWith('o') ? stem.slice(0, -1) + 'a' : stem + 'a'}`);
  // Pure numerals (with optional dot thousands separators) → Spanish words
  t = t.replace(/\b\d[\d.]*\b/g, (m) => {
    const n = parseInt(m.replace(/\./g, ''), 10);
    return Number.isFinite(n) && String(n) === m.replace(/\./g, '') ? spanishNumeral(n) : m;
  });
  return t
    .replace(/[¿?¡!.,;:"'()‘’“”]/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose same-word check for the positional ground-truth copy: tolerates the
// cosmetic variants seen between the ADA pages and the API text ("activo/a"
// vs "activo / activa", the "ddelgado" typo) without letting different words
// through.
export function similar(a, b) {
  const ka = normKey(a), kb = normKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 4 && kb.length >= 4 && (ka.startsWith(kb) || kb.startsWith(ka))) return true;
  const ta = new Set(ka.split(' ')), tb = new Set(kb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter / (ta.size + tb.size - inter) >= 0.5) return true;
  // Single-token typo tolerance (e.g. "ddelgado" vs "delgado").
  if (ta.size === 1 && tb.size === 1 && ka.length >= 5 && Math.abs(ka.length - kb.length) <= 1) {
    let i = 0;
    while (i < ka.length && i < kb.length && ka[i] === kb[i]) i++;
    return ka.slice(i + 1) === kb.slice(i + 1) || ka.slice(i + 1) === kb.slice(i)
        || ka.slice(i) === kb.slice(i + 1);
  }
  return false;
}

// Consecutive rows sharing a section tag form one section run, in deck order.
export function sectionRuns(rows) {
  const runs = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last.section === row.section) last.rows.push(row);
    else runs.push({ section: row.section, rows: [row] });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Stage A — ground truth (units 1/2/4/5/6)

// Derive which ADA deck a GT v2 file corresponds to from its audio URLs:
// audio/u{unit}/{unit}_{list}_{index}.mp3  →  u{unit}_v{list}
export function adaIdForGtRows(gtRows) {
  for (const r of gtRows) {
    const m = /\/audio\/u(\d+)\/\1_(\d+)_\d+\.mp3$/.exec(r.audioUrl);
    if (m) return `u${m[1]}_v${m[2]}`;
  }
  return null;
}

// Same row count + rows pairwise similar → copy URLs by position. This is the
// zero-risk path: the v2 API decks and the ADA pages are the same list.
export function positionalCopy(adaRows, gtRows) {
  if (adaRows.length !== gtRows.length) return { ok: false, reason: 'row count mismatch' };
  let matches = 0;
  const odd = [];
  for (let i = 0; i < adaRows.length; i++) {
    if (similar(adaRows[i].spanish, gtRows[i].spanish)) matches++;
    else odd.push(`row ${i + 1}: "${adaRows[i].spanish}" vs GT "${gtRows[i].spanish}"`);
  }
  const rate = matches / adaRows.length;
  if (rate < 0.9) return { ok: false, reason: `similarity ${(rate * 100).toFixed(0)}% < 90%`, odd };
  const mapRows = [];
  for (let i = 0; i < adaRows.length; i++) {
    if (!gtRows[i].audioUrl) continue;
    mapRows.push({ ...mapKeyOf(adaRows[i]), audioUrl: gtRows[i].audioUrl, source: 'groundtruth' });
  }
  return { ok: true, rate, odd, mapRows };
}

// Fallback for decks the ADA page reordered (u1_v1): join on
// (section, normalized spanish); when that misses, accept a deck-wide unique
// word match. Duplicated ADA rows resolve to the same (correct) clip.
export function keyedJoin(adaRows, gtRows) {
  const bySectionKey = new Map();
  const byKey = new Map();
  for (const g of gtRows) {
    if (!g.audioUrl) continue;
    const k = normKey(g.spanish);
    bySectionKey.set(g.section + '|' + k, g.audioUrl);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(g.audioUrl);
  }
  const mapRows = [];
  const unmatched = [];
  for (const a of adaRows) {
    const k = normKey(a.spanish);
    let url = bySectionKey.get(a.section + '|' + k);
    if (!url) {
      const set = byKey.get(k);
      if (set && set.size === 1) url = set.values().next().value;
    }
    if (!url) {
      // Cosmetic-variant fallback: a unique fuzzy match, same section first.
      for (const pool of [gtRows.filter(g => g.section === a.section), gtRows]) {
        const hits = new Set(pool.filter(g => g.audioUrl && similar(a.spanish, g.spanish)).map(g => g.audioUrl));
        if (hits.size === 1) { url = hits.values().next().value; break; }
        if (hits.size > 1) break;   // ambiguous — leave unmatched rather than guess
      }
    }
    if (url) mapRows.push({ ...mapKeyOf(a), audioUrl: url, source: 'groundtruth' });
    else unmatched.push(a);
  }
  return { mapRows, unmatched };
}

function mapKeyOf(row) {
  return { lesson: row.lesson, section: row.section, key: normKey(row.spanish) };
}

// ---------------------------------------------------------------------------
// Stage B — positional inference (units 3, 7–12)

// Token sequences under both alignment hypotheses. Interior section headers
// ALWAYS consume an index (verified across every ground-truth deck); the
// leading header sometimes does (u1_01_02 first word = index 2) and sometimes
// doesn't (u1_01_03 first word = index 1).
export function buildHypotheses(runs) {
  const headerFirst = [];
  const wordFirst = [];
  runs.forEach((run, i) => {
    headerFirst.push({ type: 'header', section: run.section });
    if (i > 0) wordFirst.push({ type: 'header', section: run.section });
    for (const row of run.rows) {
      headerFirst.push({ type: 'word', row });
      wordFirst.push({ type: 'word', row });
    }
  });
  return { headerFirst, wordFirst };
}

// Accept a deck only when exactly one hypothesis predicts the S3 folder's true
// file count. Ambiguity or mismatch → fail closed (no audio beats wrong audio).
export function inferDeck(runs, fileCount) {
  const { headerFirst, wordFirst } = buildHypotheses(runs);
  const candidates = [];
  if (headerFirst.length === fileCount) candidates.push({ name: 'header-first', tokens: headerFirst });
  if (wordFirst.length === fileCount) candidates.push({ name: 'word-first', tokens: wordFirst });
  if (candidates.length !== 1) {
    return {
      ok: false,
      reason: `S3 folder has ${fileCount} files; hypotheses predict ` +
              `${headerFirst.length} (header-first) / ${wordFirst.length} (word-first)`,
    };
  }
  const { name, tokens } = candidates[0];
  const assignments = [];
  tokens.forEach((tok, i) => {
    if (tok.type === 'word') assignments.push({ row: tok.row, index: i + 1 });
  });
  return { ok: true, hypothesis: name, assignments };
}

export function audioUrlFor(unit, list, index) {
  return `${AUDIO_BASE}/u${unit}/${unit}_${list}_${index}.mp3`;
}

// ---------------------------------------------------------------------------
// S3 probing (HEAD, sequential + polite delay; injectable for tests)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function defaultProbe(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      return { exists: resp.ok, size: parseInt(resp.headers.get('content-length') || '0', 10) };
    } catch (e) {
      if (attempt === 2) throw new Error(`probe failed for ${url}: ${e.message}`);
      await sleep(500 * (attempt + 1));
    }
  }
}

// Walk indexes 1,2,3,... until 3 consecutive misses → the folder's file count.
// (Ground truth shows no gap wider than 1 — u4_04_01 skips a single index — so
// 3 consecutive misses reliably means "past the end".)
export async function probeFolderCount(unit, list, probe, delayMs = PROBE_DELAY_MS) {
  const sizes = new Map();
  let misses = 0;
  let lastHit = 0;
  for (let i = 1; i <= 400; i++) {
    const r = await probe(audioUrlFor(unit, list, i));
    if (r.exists) { lastHit = i; misses = 0; sizes.set(i, r.size); }
    else if (++misses >= 3) break;
    if (delayMs) await sleep(delayMs);
  }
  return { count: lastHit, sizes };
}

// Cheap sanity signal: MP3 byte size should grow with the phrase's syllable
// count. A contiguous run of bad residuals is the signature of a mid-list
// insertion (the u5_05_02 index-42 case). Report-only — humans make the call.
export function durationCheck(assignments, sizes) {
  const pts = assignments
    .map(a => ({ syll: syllables(a.row.spanish), bytes: sizes.get(a.index) || 0, a }))
    .filter(p => p.bytes > 0);
  if (pts.length < 8) return { correlation: null, flags: [] };
  const mx = pts.reduce((s, p) => s + p.syll, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.bytes, 0) / pts.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.syll - mx) * (p.bytes - my); sxx += (p.syll - mx) ** 2; syy += (p.bytes - my) ** 2; }
  const correlation = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const slope = sxx ? sxy / sxx : 0;
  const flags = [];
  for (const p of pts) {
    const expected = my + slope * (p.syll - mx);
    if (Math.abs(p.bytes - expected) > Math.max(3 * Math.abs(slope), 0.6 * my)) {
      flags.push(`"${p.a.row.spanish}" (index ${p.a.index}): ${p.bytes}B vs ~${Math.round(expected)}B expected`);
    }
  }
  return { correlation, flags };
}

function syllables(s) {
  const m = normKey(s).match(/[aeiou]+/g);
  return m ? m.length : 1;
}

// ---------------------------------------------------------------------------
// audio_map.txt read/write + apply

export function serializeMap(mapRows) {
  const lines = ['#lesson\tsection\tspanish_normalized_key\taudioUrl\tsource'];
  for (const r of mapRows) lines.push([r.lesson, r.section, r.key, r.audioUrl, r.source].join('\t'));
  return lines.join('\n') + '\n';
}

export function parseMap(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [lesson, section, key, audioUrl, source] = line.split('\t');
    if (lesson && key && audioUrl) rows.push({ lesson, section, key, audioUrl, source: source || 'unknown' });
  }
  return rows;
}

export function mapIndexOf(mapRows) {
  const idx = new Map();
  for (const r of mapRows) {
    const k = r.lesson + '|' + r.section + '|' + r.key;
    const prev = idx.get(k);
    if (prev && prev !== r.audioUrl) {
      console.warn(`  ! conflicting map entries for ${k} — keeping first`);
      continue;
    }
    idx.set(k, r.audioUrl);
  }
  return idx;
}

// Rewrite one TSV's 4th column from the map. Preserves `#` header lines and
// row order byte-for-byte; idempotent. Rows with no map entry keep an empty
// audio column (the in-app TTS fallback covers them).
export function applyMapToTsv(text, mapIndex) {
  const out = [];
  let filled = 0;
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) { out.push(line); continue; }
    const cols = line.split('\t');
    if (cols.length < 3) { out.push(line); continue; }
    const tags = cols[2] || '';
    const lesson = (tags.match(/Contrasena::lessons::(\S+)/) || [])[1] || 'unknown';
    const section = (tags.match(/Contrasena::sections::(\S+)/) || [])[1] || 'unknown';
    const url = mapIndex.get(lesson + '|' + section + '|' + normKey(cols[0]));
    if (url) filled++;
    out.push([cols[0], cols[1], cols[2], url || ''].join('\t'));
  }
  return { text: out.join('\n'), filled };
}

// ---------------------------------------------------------------------------
// Review artifact — a listening page for every *inferred* deck. Section
// boundaries are where an off-by-one shows first, so sample first/middle/last
// of each section (deterministic, so re-runs produce the same page).

export function reviewHtml(deckSamples) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = deckSamples.map(({ deck, hypothesis, samples }) => `
  <section>
    <h2>${esc(deck)} <small>(${esc(hypothesis)})</small></h2>
    <table>
      <tr><th>Section</th><th>Spanish</th><th>Clip</th></tr>
      ${samples.map(s => `<tr><td>${esc(s.section)}</td><td><strong>${esc(s.spanish)}</strong> — ${esc(s.english)}</td>
        <td><audio controls preload="none" src="${esc(s.audioUrl)}"></audio></td></tr>`).join('\n      ')}
    </table>
  </section>`).join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>Audio backfill review</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  td, th { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
  h2 small { color: #666; font-weight: normal; }
  .warn { background: #fff3cd; padding: 1rem; border-radius: 8px; }
</style>
<h1>Audio backfill review — inferred decks</h1>
<p class="warn"><strong>Listen before trusting:</strong> every clip below must say the Spanish
word next to it. These URLs were <em>inferred</em> from file positions, not read from an API.
Pay special attention to the first and last word of each section — an alignment error shows
there first. If a deck is wrong, delete its rows from <code>audio_map.txt</code> and re-run
<code>node backfill_audio.mjs --apply</code>.</p>
${blocks}
`;
}

export function sampleAssignments(assignments) {
  const bySection = new Map();
  for (const a of assignments) {
    const sec = a.row.section;
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(a);
  }
  const samples = [];
  for (const [section, list] of bySection) {
    const picks = new Set([0, Math.floor(list.length / 2), list.length - 1]);
    for (const i of picks) {
      const a = list[i];
      samples.push({ section, spanish: a.row.spanish, english: a.row.english, index: a.index });
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Orchestration

function loadDecks() {
  const adaDecks = new Map();  // adaId → rows
  for (const f of readdirSync(ADA_DIR)) {
    const m = /^(u\d+_v\d+)\.tsv$/.exec(f);
    if (m) adaDecks.set(m[1], parseTsvRows(readFileSync(join(ADA_DIR, f), 'utf8')));
  }
  const gtDecks = new Map();     // adaId → rows (from the matching *v2 API scrape)
  const gtOldDecks = new Map();  // adaId → rows from the ORIGINAL API lesson — a few
                                 // words the v2 revision dropped still have clips here
  for (const f of readdirSync(GT_DIR)) {
    if (!/^u\d+_\d+_\d+(v\d+)?\.tsv$/.test(f)) continue;
    const rows = parseTsvRows(readFileSync(join(GT_DIR, f), 'utf8'));
    const adaId = adaIdForGtRows(rows);
    if (!adaId) continue;
    if (/v\d+\.tsv$/.test(f)) gtDecks.set(adaId, rows);
    else gtOldDecks.set(adaId, rows);
  }
  return { adaDecks, gtDecks, gtOldDecks };
}

function loadCache(noCache) {
  if (!noCache && existsSync(CACHE_FILE)) {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* rebuild */ }
  }
  return {};
}

async function probeDeckCached(unit, list, cache, probe) {
  const key = `u${unit}_${list}`;
  if (cache[key]) {
    return { count: cache[key].count, sizes: new Map(cache[key].sizes.map(([i, s]) => [i, s])) };
  }
  process.stdout.write(`  probing S3 audio/u${unit}/${unit}_${list}_*.mp3 `);
  const r = await probeFolderCount(unit, list, probe);
  console.log(`→ ${r.count} files`);
  cache[key] = { count: r.count, sizes: [...r.sizes.entries()] };
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1), 'utf8');
  return r;
}

function unitListOf(adaId) {
  const m = /^u(\d+)_v(\d+)$/.exec(adaId);
  return { unit: parseInt(m[1], 10), list: parseInt(m[2], 10) };
}

async function stageA(adaDecks, gtDecks, gtOldDecks) {
  console.log('\n=== Stage A: ground truth (API v2 decks) ===');
  const mapRows = [];
  for (const [adaId, gtRows] of [...gtDecks.entries()].sort()) {
    const adaRows = adaDecks.get(adaId);
    if (!adaRows) { console.log(`  ${adaId}: no ADA deck — skipped`); continue; }
    const pos = positionalCopy(adaRows, gtRows);
    let unmatched = [];
    if (pos.ok) {
      mapRows.push(...pos.mapRows);
      console.log(`  ${adaId}: positional copy — ${pos.mapRows.length}/${adaRows.length} rows, ` +
                  `${(pos.rate * 100).toFixed(0)}% similar${pos.odd.length ? ` (${pos.odd.length} text variants)` : ''}`);
      for (const o of pos.odd) console.log(`      ~ ${o}`);
    } else {
      const join = keyedJoin(adaRows, gtRows);
      mapRows.push(...join.mapRows);
      unmatched = join.unmatched;
      console.log(`  ${adaId}: keyed join (${pos.reason}) — ${join.mapRows.length}/${adaRows.length} matched, ` +
                  `${join.unmatched.length} unmatched`);
    }
    // Words the v2 revision dropped may still have a clip in the original lesson.
    if (unmatched.length && gtOldDecks.has(adaId)) {
      const rescue = keyedJoin(unmatched, gtOldDecks.get(adaId));
      mapRows.push(...rescue.mapRows);
      for (const r of rescue.mapRows) console.log(`      + rescued from original lesson: "${r.key}"`);
      unmatched = rescue.unmatched;
    }
    for (const u of unmatched) console.log(`      ! unmatched (falls back to TTS): "${u.spanish}"`);
  }
  return mapRows;
}

async function stageB(adaDecks, gtDecks, cache, probe) {
  console.log('\n=== Stage B: positional inference (no API data) ===');
  const mapRows = [];
  const deckSamples = [];
  const failures = [];
  const inferIds = [...adaDecks.keys()].filter(id => !gtDecks.has(id)).sort();
  for (const adaId of inferIds) {
    const { unit, list } = unitListOf(adaId);
    const rows = adaDecks.get(adaId);
    const runs = sectionRuns(rows);
    const { count, sizes } = await probeDeckCached(unit, list, cache, probe);
    if (!count) { failures.push(`${adaId}: no files found on S3`); continue; }
    const inf = inferDeck(runs, count);
    if (!inf.ok) { failures.push(`${adaId}: ${inf.reason}`); continue; }
    const dur = durationCheck(inf.assignments, sizes);
    const corrTxt = dur.correlation === null ? 'n/a' : dur.correlation.toFixed(2);
    console.log(`  ${adaId}: ${inf.hypothesis}, ${inf.assignments.length} words ↔ ${count} files, ` +
                `size/syllable corr ${corrTxt}${dur.flags.length ? `, ${dur.flags.length} size outliers` : ''}`);
    for (const f of dur.flags) console.log(`      ? ${f}`);
    if (dur.correlation !== null && dur.correlation < 0.3) {
      failures.push(`${adaId}: weak size/syllable correlation (${corrTxt}) — possible misalignment, rejected`);
      continue;
    }
    for (const a of inf.assignments) {
      mapRows.push({ ...mapKeyOf(a.row), audioUrl: audioUrlFor(unit, list, a.index), source: 'inferred' });
    }
    deckSamples.push({
      deck: adaId,
      hypothesis: inf.hypothesis,
      samples: sampleAssignments(inf.assignments).map(s => ({ ...s, audioUrl: audioUrlFor(unit, list, s.index) })),
    });
  }
  if (failures.length) {
    console.log('\n  Rejected decks (fail closed — TTS will cover them):');
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  return { mapRows, deckSamples, failures };
}

async function calibrate(adaDecks, gtDecks, cache, probe) {
  console.log('=== Calibration: inference algorithm vs known units ===');
  console.log('(runs Stage B blind on units that HAVE ground truth, then compares)\n');
  let totalWords = 0, totalRight = 0, totalWrong = 0;
  for (const [adaId, gtRows] of [...gtDecks.entries()].sort()) {
    const adaRows = adaDecks.get(adaId);
    if (!adaRows) continue;
    const { unit, list } = unitListOf(adaId);
    const runs = sectionRuns(adaRows);
    const { count } = await probeDeckCached(unit, list, cache, probe);
    const inf = inferDeck(runs, count);
    if (!inf.ok) {
      console.log(`  ${adaId}: REJECTED by count gate (${inf.reason}) — falls back to keyed join ✓`);
      continue;
    }
    // Ground truth keyed by (section, word) for comparison.
    const truth = new Map();
    for (const g of gtRows) if (g.audioUrl) truth.set(g.section + '|' + normKey(g.spanish), g.audioUrl);
    let right = 0, wrong = 0, unknown = 0;
    const wrongs = [];
    for (const a of inf.assignments) {
      const t = truth.get(a.row.section + '|' + normKey(a.row.spanish));
      const url = audioUrlFor(unit, list, a.index);
      if (!t) unknown++;
      else if (t === url) right++;
      else { wrong++; wrongs.push(`"${a.row.spanish}": inferred ${url.split('/').pop()} vs truth ${t.split('/').pop()}`); }
    }
    totalWords += right + wrong; totalRight += right; totalWrong += wrong;
    console.log(`  ${adaId}: ${inf.hypothesis} — ${right} right, ${wrong} wrong, ${unknown} not in GT`);
    for (const w of wrongs.slice(0, 12)) console.log(`      ✗ ${w}`);
  }
  console.log(`\n  Overall: ${totalRight}/${totalWords} correct` +
              (totalWrong ? ` — ${totalWrong} WRONG (inspect before trusting Stage B!)` : ' — inference algorithm validated'));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const noCache = args.has('--no-cache');
  const { adaDecks, gtDecks, gtOldDecks } = loadDecks();
  const cache = loadCache(noCache);

  if (args.has('--calibrate')) {
    await calibrate(adaDecks, gtDecks, cache, defaultProbe);
    return;
  }

  if (args.has('--build-map')) {
    const a = await stageA(adaDecks, gtDecks, gtOldDecks);
    const b = await stageB(adaDecks, gtDecks, cache, defaultProbe);
    const all = [...a, ...b.mapRows];
    writeFileSync(MAP_FILE, serializeMap(all), 'utf8');
    writeFileSync(REVIEW_FILE, reviewHtml(b.deckSamples), 'utf8');
    console.log(`\nWrote ${MAP_FILE} (${a.length} groundtruth + ${b.mapRows.length} inferred rows)`);
    console.log(`Wrote ${REVIEW_FILE} — LISTEN to it before running --apply.`);
    return;
  }

  if (args.has('--apply')) {
    if (!existsSync(MAP_FILE)) { console.error(`${MAP_FILE} not found — run --build-map first.`); process.exit(1); }
    const idx = mapIndexOf(parseMap(readFileSync(MAP_FILE, 'utf8')));
    let changed = 0;
    for (const f of readdirSync(ADA_DIR)) {
      if (!f.endsWith('.tsv')) continue;
      const path = join(ADA_DIR, f);
      const before = readFileSync(path, 'utf8');
      const { text, filled } = applyMapToTsv(before, idx);
      if (text !== before) { writeFileSync(path, text, 'utf8'); changed++; }
      console.log(`  ${f}: ${filled} rows with audio${text !== before ? '' : ' (unchanged)'}`);
    }
    console.log(`\nUpdated ${changed} file(s). Re-run "npm run build" to bundle.`);
    return;
  }

  console.log('Usage: node backfill_audio.mjs --calibrate | --build-map | --apply [--no-cache]');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}

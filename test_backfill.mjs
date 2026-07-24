// Offline tests for backfill_audio.mjs — pure-function coverage with inline
// TSV fixtures and a stubbed prober (no network). Run: node test_backfill.mjs
import {
  parseTsvRows, normKey, spanishNumeral, similar, sectionRuns,
  positionalCopy, keyedJoin, buildHypotheses, inferDeck,
  serializeMap, parseMap, mapIndexOf, applyMapToTsv,
} from './backfill_audio.mjs';

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const HEADER = '#separator:tab\n#html:false\n#tags column:3\n';
const tag = (lesson, section) => `Contrasena::lessons::${lesson} Contrasena::sections::${section}`;
const AUDIO = 'https://s3.us-east-2.amazonaws.com/contrasena/audio';

console.log('normKey / spanishNumeral / similar');
check('accents stripped', normKey('la cronología') === 'la cronologia');
check('gender slash o/a', normKey('positivo/a') === 'positivo positiva');
check('gender slash consonant/a', normKey('trabajador/a') === 'trabajador trabajadora');
check('digits → words', normKey('22') === 'veintidos');
check('dotted thousands', normKey('10.000') === 'diez mil');
check('millions', spanishNumeral(2000000) === 'dos millones');
check('treinta y uno', spanishNumeral(31) === 'treinta y uno');
check('similar: slash variants', similar('activo/a', 'activo / activa'));
check('similar: single-token typo', similar('delgado', 'ddelgado'));
check('similar: long variant phrase', similar('las papas (Lat. Am.) / las patatas (Spain)', 'las papas/las patatas'));
check('not similar: different words', !similar('el perro', 'la casa'));

console.log('positionalCopy — same list, cosmetic variants');
{
  const ada = parseTsvRows(['uno\tone\t' + tag('u9_v1', 'a') + '\t',
                            'dos\ttwo\t' + tag('u9_v1', 'a') + '\t',
                            'positivo/a\tpositive\t' + tag('u9_v1', 'b') + '\t'].join('\n'));
  const gt = parseTsvRows(['uno\tone\t' + tag('u9_09_01v2', 'a') + `\t${AUDIO}/u9/9_1_2.mp3`,
                           'dos\ttwo\t' + tag('u9_09_01v2', 'a') + `\t${AUDIO}/u9/9_1_3.mp3`,
                           'positivo / positiva\tpositive\t' + tag('u9_09_01v2', 'b') + `\t${AUDIO}/u9/9_1_5.mp3`].join('\n'));
  const r = positionalCopy(ada, gt);
  check('accepts equal-count similar decks', r.ok === true);
  check('copies URLs by position', r.ok && r.mapRows[2].audioUrl.endsWith('9_1_5.mp3'));
  check('map keyed by ADA spelling', r.ok && r.mapRows[2].key === 'positivo positiva');
  const short = positionalCopy(ada.slice(0, 2), gt);
  check('rejects row-count mismatch', short.ok === false);
}

console.log('keyedJoin — reordered deck (u1_v1 shape)');
{
  const ada = parseTsvRows([
    'el estado\tstatus\t' + tag('u1_v1', 'perfiles') + '\t',
    'el estado\tstate\t' + tag('u1_v1', 'biografia') + '\t',
    'la ciudad\tcity\t' + tag('u1_v1', 'biografia') + '\t',
    'la ciudad\tcity dup\t' + tag('u1_v1', 'extra_section') + '\t',   // dup word, unique deck-wide URL
  ].join('\n'));
  const gt = parseTsvRows([
    'el estado\tstatus\t' + tag('x', 'perfiles') + `\t${AUDIO}/u1/1_1_4.mp3`,
    'la ciudad\tcity\t' + tag('x', 'biografia') + `\t${AUDIO}/u1/1_1_21.mp3`,
    'el estado\tstate\t' + tag('x', 'biografia') + `\t${AUDIO}/u1/1_1_24.mp3`,
  ].join('\n'));
  const r = keyedJoin(ada, gt);
  check('section disambiguates duplicate word', r.mapRows[0].audioUrl.endsWith('1_1_4.mp3')
        && r.mapRows[1].audioUrl.endsWith('1_1_24.mp3'), JSON.stringify(r.mapRows.map(m => m.audioUrl)));
  check('unique deck-wide fallback for section mismatch', r.mapRows[3].audioUrl.endsWith('1_1_21.mp3'));
  check('no unmatched rows', r.unmatched.length === 0);
}

console.log('inferDeck — count-gate hypothesis selection');
{
  const rows = parseTsvRows([
    'a\t1\t' + tag('u3_v2', 's1') + '\t',
    'b\t2\t' + tag('u3_v2', 's1') + '\t',
    'c\t3\t' + tag('u3_v2', 's2') + '\t',
  ].join('\n'));
  const runs = sectionRuns(rows);
  check('sectionRuns groups consecutive tags', runs.length === 2 && runs[0].rows.length === 2);
  const hyp = buildHypotheses(runs);
  check('header-first counts headers per section', hyp.headerFirst.length === 5);
  check('word-first skips leading header', hyp.wordFirst.length === 4);
  const hf = inferDeck(runs, 5);
  check('picks header-first when N matches', hf.ok && hf.hypothesis === 'header-first');
  check('word indexes skip header slots', hf.ok && hf.assignments.map(a => a.index).join(',') === '2,3,5');
  const wf = inferDeck(runs, 4);
  check('picks word-first when N matches', wf.ok && wf.assignments.map(a => a.index).join(',') === '1,2,4');
  const bad = inferDeck(runs, 7);
  check('fails closed when no hypothesis matches', bad.ok === false);
}

console.log('audio_map round-trip + apply');
{
  const mapRows = [
    { lesson: 'u9_v1', section: 'a', key: 'uno', audioUrl: `${AUDIO}/u9/9_1_2.mp3`, source: 'groundtruth' },
    { lesson: 'u9_v1', section: 'b', key: 'veintidos', audioUrl: `${AUDIO}/u9/9_1_9.mp3`, source: 'inferred' },
  ];
  const parsed = parseMap(serializeMap(mapRows));
  check('map serializes and parses', parsed.length === 2 && parsed[1].source === 'inferred');
  const idx = mapIndexOf(parsed);
  const tsv = HEADER +
    'uno\tone\t' + tag('u9_v1', 'a') + '\t\n' +
    '22\ttwenty-two\t' + tag('u9_v1', 'b') + '\t\n' +
    'sin audio\tno audio\t' + tag('u9_v1', 'b') + '\t\n';
  const first = applyMapToTsv(tsv, idx);
  check('fills matching rows (incl. numeral key)', first.filled === 2);
  check('header lines preserved', first.text.startsWith(HEADER));
  check('unmatched row keeps empty column', first.text.includes('sin audio\tno audio\t' + tag('u9_v1', 'b') + '\t\n'));
  const second = applyMapToTsv(first.text, idx);
  check('idempotent apply', second.text === first.text);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll backfill tests passed.');
process.exit(failures ? 1 : 0);

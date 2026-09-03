// Every verb that can appear on a conjugation drill card must have an English
// meaning in VERB_GLOSS, otherwise "Conjugation: show verb meaning" silently
// shows nothing for it. Adding a verb to a deck without a gloss fails here.
//
//   node test_verb_gloss.mjs

import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('./index.html', 'utf8');
const src = html.match(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/)[1];

// Pull the paradigm builder straight out of the app so this tracks its logic.
function grab(re) {
  const i = src.search(re);
  if (i < 0) throw new Error('not found in index.html: ' + re);
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) { k++; break; } }
  }
  return src.slice(i, k);
}
const app = new Function([
  grab(/function parseTSV\(/),
  grab(/function parseConjLabel\(/),
  "const CONJ_PERSONS=['yo','t\u00fa','\u00e9l/ella; Ud.','nosotros/as','vosotros/as','ellos/ellas; Uds.'];",
  grab(/function conjPersonIndex\(/),
  grab(/function buildParadigmQueue\(/),
].join('\n') + ';return {parseTSV, buildParadigmQueue};')();

const glossSrc = html.match(/const VERB_GLOSS = \{[\s\S]*?\n\};/)[0];
const VERB_GLOSS = new Function('return ' + glossSrc.replace('const VERB_GLOSS = ', '').replace(/;$/, ''))();

// Not a verb: grammar_10_2 carries a "common_ending" summary section.
const NOT_A_VERB = new Set(['common ending']);

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const lemmas = new Set();
for (const f of readdirSync('output_grammar').filter(n => n.endsWith('.tsv')))
  for (const p of app.buildParadigmQueue(app.parseTSV(readFileSync('output_grammar/' + f, 'utf8'))))
    lemmas.add(String(p.lemma).trim().toLowerCase());

console.log('=== verb meanings ===');
console.log('  ' + lemmas.size + ' distinct lemmas across the grammar decks, ' +
            Object.keys(VERB_GLOSS).length + ' glosses defined');

const missing = [...lemmas].filter(l => !NOT_A_VERB.has(l) && !VERB_GLOSS[l]).sort();
ok(missing.length === 0, missing.length ? 'missing a meaning: ' + missing.join(', ')
                                        : 'every drillable verb has a meaning');

const unused = Object.keys(VERB_GLOSS).filter(k => !lemmas.has(k)).sort();
ok(unused.length === 0, unused.length ? 'glossed but in no deck: ' + unused.join(', ')
                                      : 'no stale glosses');

const bad = Object.entries(VERB_GLOSS).filter(([, v]) => !/^to\b/.test(v)).map(([k]) => k);
ok(bad.length === 0, bad.length ? 'meanings not phrased as infinitives: ' + bad.join(', ')
                                : 'every meaning reads as an English infinitive');

console.log(fail ? '\n' + fail + ' check(s) FAILED.' : '\nAll verb-meaning checks passed.');
process.exit(fail ? 1 : 0);

// Regenerates the two hand-authored conjugation review decks:
//   output_grammar/grammar_13_preterite_review.tsv  (40 verbs)
//   output_grammar/grammar_12_imperfect_review.tsv  (6 verbs)
// Regular forms are derived; irregulars are transcribed from the textbook
// tables. Run: node gen_conjugation_decks.mjs && node build_flashcards.mjs

import {writeFileSync} from 'node:fs';

const PERSONS = [
  'yo (I)',
  'tú (you, informal)',
  'él/ella; Ud. (he/she/it; you, formal)',
  'nosotros/nosotras (we)',
  'vosotros/vosotras (you all, informal)',
  'ellos/ellas; Uds. (they; you, formal)',
];

// ---------- preterite builders ----------
// Regular -ar. yoOverride covers the -car/-gar/-zar spelling changes.
const ar = (inf, yoOverride) => {
  const s = inf.slice(0, -2);
  return [yoOverride ?? s + 'é', s + 'aste', s + 'ó', s + 'amos', s + 'asteis', s + 'aron'];
};
// Regular -er/-ir (identical endings in the preterite).
const er = (inf) => {
  const s = inf.slice(0, -2);
  return [s + 'í', s + 'iste', s + 'ió', s + 'imos', s + 'isteis', s + 'ieron'];
};
// Stem-changing -ir: third person only (e->i, o->u).
const stem = (inf, thirdStem) => {
  const f = er(inf);
  f[2] = thirdStem + 'ió';
  f[5] = thirdStem + 'ieron';
  return f;
};

const PRETERITE = [
  // --- regular -ar ---
  ['hablar',    ar('hablar')],
  ['llegar',    ar('llegar', 'llegué')],
  ['encontrar', ar('encontrar')],
  ['terminar',  ar('terminar')],
  ['preguntar', ar('preguntar')],
  ['regresar',  ar('regresar')],
  ['estudiar',  ar('estudiar')],
  ['quedar',    ar('quedar')],
  ['buscar',    ar('buscar', 'busqué')],
  ['pagar',     ar('pagar', 'pagué')],
  ['empezar',   ar('empezar', 'empecé')],
  // --- regular -er/-ir ---
  ['comer',     er('comer')],
  ['conocer',   er('conocer')],
  ['vivir',     er('vivir')],
  ['asistir',   er('asistir')],
  // vowel stem: i -> y in the third person, accented í elsewhere
  ['creer',  ['creí', 'creíste', 'creyó', 'creímos', 'creísteis', 'creyeron']],
  ['leer',   ['leí',  'leíste',  'leyó',  'leímos',  'leísteis',  'leyeron']],
  // --- stem-changing -ir ---
  ['pedir',      stem('pedir', 'pid')],
  ['dormir',     stem('dormir', 'durm')],
  ['sentir',     stem('sentir', 'sint')],
  ['mentir',     stem('mentir', 'mint')],
  ['preferir',   stem('preferir', 'prefir')],
  ['divertirse', stem('divertir', 'divirt')],
  ['reír',   ['reí', 'reíste', 'rio/rió', 'reímos', 'reísteis', 'rieron']],
  // --- irregular (textbook table) ---
  ['dar',      ['di',      'diste',      'dio',      'dimos',      'disteis',      'dieron']],
  ['decir',    ['dije',    'dijiste',    'dijo',     'dijimos',    'dijisteis',    'dijeron']],
  ['estar',    ['estuve',  'estuviste',  'estuvo',   'estuvimos',  'estuvisteis',  'estuvieron']],
  ['haber',    ['hube',    'hubiste',    'hubo',     'hubimos',    'hubisteis',    'hubieron']],
  ['hacer',    ['hice',    'hiciste',    'hizo',     'hicimos',    'hicisteis',    'hicieron']],
  ['ir',       ['fui',     'fuiste',     'fue',      'fuimos',     'fuisteis',     'fueron']],
  ['ser',      ['fui',     'fuiste',     'fue',      'fuimos',     'fuisteis',     'fueron']],
  ['poder',    ['pude',    'pudiste',    'pudo',     'pudimos',    'pudisteis',    'pudieron']],
  ['poner',    ['puse',    'pusiste',    'puso',     'pusimos',    'pusisteis',    'pusieron']],
  ['querer',   ['quise',   'quisiste',   'quiso',    'quisimos',   'quisisteis',   'quisieron']],
  ['saber',    ['supe',    'supiste',    'supo',     'supimos',    'supisteis',    'supieron']],
  ['tener',    ['tuve',    'tuviste',    'tuvo',     'tuvimos',    'tuvisteis',    'tuvieron']],
  ['traer',    ['traje',   'trajiste',   'trajo',    'trajimos',   'trajisteis',   'trajeron']],
  ['venir',    ['vine',    'viniste',    'vino',     'vinimos',    'vinisteis',    'vinieron']],
  ['conducir', ['conduje', 'condujiste', 'condujo',  'condujimos', 'condujisteis', 'condujeron']],
  ['ver',      ['vi',      'viste',      'vio',      'vimos',      'visteis',      'vieron']],
];

// ---------- imperfect ----------
const impAr = (inf) => { const s = inf.slice(0,-2);
  return [s+'aba', s+'abas', s+'aba', s+'ábamos', s+'abais', s+'aban']; };
const impEr = (inf) => { const s = inf.slice(0,-2);
  return [s+'ía', s+'ías', s+'ía', s+'íamos', s+'íais', s+'ían']; };

const IMPERFECT = [
  ['hablar', impAr('hablar')],
  ['comer',  impEr('comer')],
  ['vivir',  impEr('vivir')],
  ['ir',  ['iba',  'ibas',  'iba',  'íbamos',  'ibais',  'iban']],
  ['ser', ['era',  'eras',  'era',  'éramos',  'erais',  'eran']],
  ['ver', ['veía', 'veías', 'veía', 'veíamos', 'veíais', 'veían']],
];

function build(rows, lesson) {
  const out = ['#separator:tab', '#html:false', '#tags column:3'];
  for (const [lemma, forms] of rows) {
    if (forms.length !== 6) throw new Error('bad form count for ' + lemma);
    forms.forEach((f, i) => {
      if (!f) throw new Error('empty form: ' + lemma + ' ' + i);
      out.push(`${f}\t${lemma} — ${PERSONS[i]}\tContrasena::lessons::${lesson} Contrasena::sections::${lemma}\t`);
    });
  }
  return out.join('\n') + '\n';
}

writeFileSync('output_grammar/grammar_13_preterite_review.tsv',
  build(PRETERITE, 'grammar_13_preterite_review'), 'utf8');
writeFileSync('output_grammar/grammar_12_imperfect_review.tsv',
  build(IMPERFECT, 'grammar_12_imperfect_review'), 'utf8');

console.log(`preterite: ${PRETERITE.length} verbs, ${PRETERITE.length*6} cards`);
console.log(`imperfect: ${IMPERFECT.length} verbs, ${IMPERFECT.length*6} cards`);

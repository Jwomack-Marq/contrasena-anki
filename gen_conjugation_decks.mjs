// Regenerates the hand-authored grammar decks in output_grammar/:
//   grammar_13_preterite_review.tsv         (40 verbs, drill)
//   grammar_12_imperfect_review.tsv         (6 verbs, drill)
//   grammar_7_present_irregulars_review.tsv (34 verbs, drill)
//   grammar_15_present_perfect.tsv          (15 verbs, drill)
//   grammar_15_past_perfect.tsv             (15 verbs, drill)
//   grammar_15_participles.tsv              (infinitive -> participle cards)
//   grammar_15_participle_agreement.tsv     (participle-as-adjective fill-ins)
//   grammar_15_perfect_in_context.tsv       (perfect tenses in sentences)
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

// haber is the helper verb of every perfect tense (Unit 15).
const HABER_PRESENT   = ['he', 'has', 'ha', 'hemos', 'habéis', 'han'];
const HABER_IMPERFECT = ['había', 'habías', 'había', 'habíamos', 'habíais', 'habían'];

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

// sectionSuffix names the tense when one verb appears in several decks
// (hablar_present_perfect); the app shows it as a tag under the infinitive.
function build(rows, lesson, sectionSuffix = '') {
  const out = ['#separator:tab', '#html:false', '#tags column:3'];
  for (const [lemma, forms] of rows) {
    if (forms.length !== 6) throw new Error('bad form count for ' + lemma);
    forms.forEach((f, i) => {
      if (!f) throw new Error('empty form: ' + lemma + ' ' + i);
      out.push(`${f}\t${lemma} — ${PERSONS[i]}\tContrasena::lessons::${lesson} Contrasena::sections::${lemma}${sectionSuffix}\t`);
    });
  }
  return out.join('\n') + '\n';
}

// One card per row for decks that aren't paradigms: [spanish, label, section].
// Labels must read "lemma — rest" with exactly one dash, because the app and
// test_verb_gloss.mjs take the verb from the text before it.
function buildList(rows, lesson) {
  const out = ['#separator:tab', '#html:false', '#tags column:3'];
  for (const [spanish, label, section] of rows) {
    if (!spanish || !label || !section) throw new Error('incomplete row: ' + spanish + ' / ' + label);
    if (label.split(' — ').length !== 2) throw new Error('label needs exactly one " — ": ' + label);
    out.push(`${spanish}\t${label}\tContrasena::lessons::${lesson} Contrasena::sections::${section}\t`);
  }
  return out.join('\n') + '\n';
}

writeFileSync('output_grammar/grammar_13_preterite_review.tsv',
  build(PRETERITE, 'grammar_13_preterite_review'), 'utf8');
writeFileSync('output_grammar/grammar_12_imperfect_review.tsv',
  build(IMPERFECT, 'grammar_12_imperfect_review'), 'utf8');

console.log(`preterite: ${PRETERITE.length} verbs, ${PRETERITE.length*6} cards`);
console.log(`imperfect: ${IMPERFECT.length} verbs, ${IMPERFECT.length*6} cards`);

// ---------- present tense ----------
const PRES_END = {
  ar: ['o', 'as', 'a', 'amos', 'áis', 'an'],
  er: ['o', 'es', 'e', 'emos', 'éis', 'en'],
  ir: ['o', 'es', 'e', 'imos', 'ís', 'en'],
};
// Regular everywhere except the yo form (-go, -zco, and friends).
const yoIrr = (inf, yo) => {
  const s = inf.slice(0, -2), E = PRES_END[inf.slice(-2)];
  return [yo, s + E[1], s + E[2], s + E[3], s + E[4], s + E[5]];
};
// Boot/shoe pattern: the stem changes everywhere except nosotros and vosotros.
const boot = (inf, alt) => {
  const s = inf.slice(0, -2), E = PRES_END[inf.slice(-2)];
  return [alt + E[0], alt + E[1], alt + E[2], s + E[3], s + E[4], alt + E[5]];
};

const PRESENT = [
  // --- fully irregular ---
  ['ser',       ['soy',   'eres',  'es',    'somos',      'sois',    'son']],
  ['estar',     ['estoy', 'estás', 'está',  'estamos',    'estáis',  'están']],
  ['ir',        ['voy',   'vas',   'va',    'vamos',      'vais',    'van']],
  ['haber',     HABER_PRESENT],
  ['tener',     ['tengo', 'tienes','tiene', 'tenemos',    'tenéis',  'tienen']],
  ['venir',     ['vengo', 'vienes','viene', 'venimos',    'venís',   'vienen']],
  ['decir',     ['digo',  'dices', 'dice',  'decimos',    'decís',   'dicen']],
  ['oír',       ['oigo',  'oyes',  'oye',   'oímos',      'oís',     'oyen']],
  // seguir drops the u before o — "sigo", not "siguo"
  ['seguir',    ['sigo',  'sigues','sigue', 'seguimos',   'seguís',  'siguen']],
  ['construir', ['construyo','construyes','construye','construimos','construís','construyen']],
  // dar and ver take unaccented vosotros forms, so they're spelled out
  ['dar',       ['doy',   'das',   'da',    'damos',      'dais',    'dan']],
  ['ver',       ['veo',   'ves',   've',    'vemos',      'veis',    'ven']],
  // --- irregular yo form only ---
  ['hacer',    yoIrr('hacer',    'hago')],
  ['poner',    yoIrr('poner',    'pongo')],
  ['salir',    yoIrr('salir',    'salgo')],
  ['traer',    yoIrr('traer',    'traigo')],
  ['caer',     yoIrr('caer',     'caigo')],
  ['saber',    yoIrr('saber',    'sé')],
  ['conocer',  yoIrr('conocer',  'conozco')],
  ['conducir', yoIrr('conducir', 'conduzco')],
  // --- stem-changing e -> ie ---
  ['pensar',   boot('pensar',   'piens')],
  ['querer',   boot('querer',   'quier')],
  ['entender', boot('entender', 'entiend')],
  ['empezar',  boot('empezar',  'empiez')],
  ['preferir', boot('preferir', 'prefier')],
  // --- stem-changing o -> ue ---
  ['poder',    boot('poder',    'pued')],
  ['volver',   boot('volver',   'vuelv')],
  ['dormir',   boot('dormir',   'duerm')],
  ['contar',   boot('contar',   'cuent')],
  ['almorzar', boot('almorzar', 'almuerz')],
  // --- stem-changing u -> ue ---
  ['jugar',    boot('jugar',    'jueg')],
  // --- stem-changing e -> i ---
  ['pedir',    boot('pedir',    'pid')],
  ['servir',   boot('servir',   'sirv')],
  ['repetir',  boot('repetir',  'repit')],
];

writeFileSync('output_grammar/grammar_7_present_irregulars_review.tsv',
  build(PRESENT, 'grammar_7_present_irregulars_review'), 'utf8');
console.log(`present:   ${PRESENT.length} verbs, ${PRESENT.length*6} cards`);

// ---------- Unit 15: past participles and the perfect tenses ----------
// Textbook list (Resumen gramatical 15-1 and 15-2), then compounds built on
// those verbs. Everything else is regular.
const PARTICIPLE_IRREGULAR = {
  abrir: 'abierto', cubrir: 'cubierto', descubrir: 'descubierto',
  decir: 'dicho', escribir: 'escrito', hacer: 'hecho', morir: 'muerto',
  poner: 'puesto', romper: 'roto', volver: 'vuelto', ver: 'visto',
  describir: 'descrito', exponer: 'expuesto', disponer: 'dispuesto',
  prever: 'previsto', devolver: 'devuelto',
};
// -ar -> -ado, -er/-ir -> -ido. A stem ending in a/e/o takes an accent:
// leído, creído, traído, caído, oído (but construido has none).
function participle(inf) {
  if (PARTICIPLE_IRREGULAR[inf]) return PARTICIPLE_IRREGULAR[inf];
  const stem = inf.slice(0, -2), end = inf.slice(-2);
  if (end === 'ar') return stem + 'ado';
  if (end !== 'er' && end !== 'ir' && end !== 'ír') throw new Error('not an infinitive: ' + inf);
  return stem + (/[aeo]$/.test(stem) ? 'ído' : 'ido');
}
const perfect = (haber, inf) => haber.map(h => h + ' ' + participle(inf));

const PERFECT_VERBS = [
  'hablar', 'comer', 'vivir', 'leer', 'salvar',
  'abrir', 'descubrir', 'decir', 'escribir', 'hacer',
  'morir', 'poner', 'romper', 'volver', 'ver',
];
writeFileSync('output_grammar/grammar_15_present_perfect.tsv',
  build(PERFECT_VERBS.map(v => [v, perfect(HABER_PRESENT, v)]), 'grammar_15_present_perfect', '_present_perfect'), 'utf8');
writeFileSync('output_grammar/grammar_15_past_perfect.tsv',
  build(PERFECT_VERBS.map(v => [v, perfect(HABER_IMPERFECT, v)]), 'grammar_15_past_perfect', '_past_perfect'), 'utf8');
console.log(`perfect:   ${PERFECT_VERBS.length} verbs x 2 tenses, ${PERFECT_VERBS.length*12} cards`);

// [infinitive, meaning, section]
const PARTICIPLE_VERBS = [
  ['tomar', 'to take; to drink', 'regular'],
  ['comer', 'to eat', 'regular'],
  ['vivir', 'to live', 'regular'],
  ['hablar', 'to speak', 'regular'],
  ['viajar', 'to travel', 'regular'],
  ['empezar', 'to start', 'regular'],
  ['rodear', 'to surround', 'regular'],
  ['aislar', 'to isolate', 'regular'],
  ['apresar', 'to capture', 'regular'],
  ['perder', 'to lose', 'regular'],
  ['salvar', 'to save', 'regular'],
  ['engañar', 'to trick', 'regular'],
  ['sacrificar', 'to sacrifice', 'regular'],
  ['confiar', 'to trust', 'regular'],
  ['narrar', 'to narrate', 'regular'],
  ['florecer', 'to flourish', 'regular'],
  ['abrir', 'to open', 'irregular'],
  ['cubrir', 'to cover', 'irregular'],
  ['descubrir', 'to discover', 'irregular'],
  ['decir', 'to say', 'irregular'],
  ['escribir', 'to write', 'irregular'],
  ['hacer', 'to do; to make', 'irregular'],
  ['morir', 'to die', 'irregular'],
  ['poner', 'to put', 'irregular'],
  ['romper', 'to break', 'irregular'],
  ['volver', 'to return', 'irregular'],
  ['ver', 'to see', 'irregular'],
  ['describir', 'to describe', 'irregular_compounds'],
  ['exponer', 'to explain', 'irregular_compounds'],
  ['disponer', 'to decide', 'irregular_compounds'],
  ['prever', 'to foresee', 'irregular_compounds'],
  ['devolver', 'to give back', 'irregular_compounds'],
  ['leer', 'to read', 'accented_ido'],
  ['creer', 'to believe', 'accented_ido'],
  ['oír', 'to hear', 'accented_ido'],
  ['traer', 'to bring', 'accented_ido'],
  ['caer', 'to fall', 'accented_ido'],
];
writeFileSync('output_grammar/grammar_15_participles.tsv',
  buildList(PARTICIPLE_VERBS.map(([inf, en, sec]) =>
    [participle(inf), `${inf} — past participle (${en})`, sec]), 'grammar_15_participles'), 'utf8');
console.log(`participles: ${PARTICIPLE_VERBS.length} cards`);

// Participles used as adjectives agree with the noun: -o / -a / -os / -as.
// [answer, infinitive, phrase with ___, English, section]
const AGREEMENT = [
  ['perdido',     'perder',    'el fray ___ en la selva',        'the friar lost in the jungle', 'regular'],
  ['rodeada',     'rodear',    'una aldea ___ de montañas',      'a village surrounded by mountains', 'regular'],
  ['aislados',    'aislar',    'unos pueblos ___',               'some isolated towns', 'regular'],
  ['apresados',   'apresar',   'los opresores ___',              'the captured oppressors', 'regular'],
  ['engañadas',   'engañar',   'las personas ___',               'the deceived people', 'regular'],
  ['preparada',   'preparar',  'la comida ___',                  'the prepared food', 'regular'],
  ['cerradas',    'cerrar',    'las ventanas ___',               'the closed windows', 'regular'],
  ['salvados',    'salvar',    'los animales ___',               'the rescued animals', 'regular'],
  ['conocida',    'conocer',   'una autora muy ___',             'a very well-known author', 'regular'],
  ['leída',       'leer',      'una novela muy ___',             'a widely read novel', 'regular'],
  ['dormidos',    'dormir',    'los niños ___',                  'the sleeping children', 'regular'],
  ['abierta',     'abrir',     'la puerta ___',                  'the open door', 'irregular'],
  ['abiertos',    'abrir',     'los libros ___',                 'the open books', 'irregular'],
  ['hecho',       'hacer',     '___ en México',                  'made in Mexico', 'irregular'],
  ['hecha',       'hacer',     'una hamburguesa muy ___',        'a burger well done', 'irregular'],
  ['escritas',    'escribir',  'las cartas ___ a mano',          'the handwritten letters', 'irregular'],
  ['roto',        'romper',    'un vaso ___',                    'a broken glass', 'irregular'],
  ['rotas',       'romper',    'las sillas ___',                 'the broken chairs', 'irregular'],
  ['muertas',     'morir',     'las plantas ___',                'the dead plants', 'irregular'],
  ['puesta',      'poner',     'la mesa ___',                    'the set table', 'irregular'],
  ['cubiertas',   'cubrir',    'las montañas ___ de nieve',      'the snow-covered mountains', 'irregular'],
  ['dichas',      'decir',     'las palabras ___',               'the spoken words', 'irregular'],
  ['descritas',   'describir', 'las escenas ___ en el cuento',   'the scenes described in the story', 'irregular'],
  ['vistas',      'ver',       'las películas más ___',          'the most-watched movies', 'irregular'],
  ['descubierto', 'descubrir', 'el códice ___',                  'the discovered codex', 'irregular'],
];
// Every answer must be the participle with the noun's ending swapped in.
for (const [ans, inf] of AGREEMENT) {
  const base = participle(inf).slice(0, -1);
  if (!['o', 'a', 'os', 'as'].some(e => ans === base + e)) throw new Error(`agreement: ${ans} is not a form of ${participle(inf)}`);
}
writeFileSync('output_grammar/grammar_15_participle_agreement.tsv',
  buildList(AGREEMENT.map(([ans, inf, phrase, en, sec]) =>
    [ans, `${inf} — ${phrase} (${en})`, sec]), 'grammar_15_participle_agreement'), 'utf8');
console.log(`agreement: ${AGREEMENT.length} cards`);

// [answer, infinitive, sentence with ___, English, section]. Each sentence
// carries a cue that fixes the tense (ya, alguna vez, cuando + preterite...).
const IN_CONTEXT = [
  ['has viajado',      'viajar',    '¿Alguna vez (tú) ___ a Guatemala?',                     'Have you ever traveled to Guatemala?', 'present_perfect'],
  ['has leído',        'leer',      '¿(Tú) ___ El eclipse?',                                 'Have you read El eclipse?', 'present_perfect'],
  ['ha empezado',      'empezar',   'La clase ya ___.',                                      'The class has already started.', 'present_perfect'],
  ['no hemos hablado', 'hablar',    '(Nosotros) todavía ___ de la última escena.',           'We still haven’t talked about the last scene.', 'present_perfect'],
  ['he escrito',       'escribir',  'Este semestre (yo) ___ tres ensayos.',                  'This semester I have written three essays.', 'present_perfect'],
  ['han visto',        'ver',       'Mis amigos nunca ___ un eclipse solar.',                'My friends have never seen a solar eclipse.', 'present_perfect'],
  ['han muerto',       'morir',     '¿Por qué ___ tantos personajes en esta novela?',        'Why have so many characters died in this novel?', 'present_perfect'],
  ['no han dicho',     'decir',     'Los personajes ___ la verdad.',                         'The characters haven’t told the truth.', 'present_perfect'],
  ['ha hecho',         'hacer',     'La profesora ya ___ el examen.',                        'The professor has already made the exam.', 'present_perfect'],
  ['hemos puesto',     'poner',     '(Nosotros) ya ___ la mesa.',                            'We have already set the table.', 'present_perfect'],
  ['habéis vuelto',    'volver',    '¿(Vosotros) ya ___ de Guatemala?',                      'Have you all already come back from Guatemala?', 'present_perfect'],
  ['he descubierto',   'descubrir', '(Yo) ___ un nuevo autor este año.',                     'I have discovered a new author this year.', 'present_perfect'],
  ['había apresado',   'apresar',   'Cuando el fray se sintió perdido, la selva ya lo ___.', 'When the friar felt lost, the jungle had already captured him.', 'past_perfect'],
  ['habían previsto',  'prever',    'Los astrónomos mayas ya ___ los eclipses.',             'The Mayan astronomers had already foreseen the eclipses.', 'past_perfect'],
  ['habías estudiado', 'estudiar',  'Cuando empezaste a estudiar español, ¿(tú) ___ otro idioma antes?', 'When you started studying Spanish, had you studied another language before?', 'past_perfect'],
  ['había salido',     'salir',     'Cuando llegué a la estación, el tren ya ___.',          'When I got to the station, the train had already left.', 'past_perfect'],
  ['habíamos leído',   'leer',      'Antes de la clase, (nosotros) ya ___ el cuento.',       'Before class, we had already read the story.', 'past_perfect'],
  ['había visto',      'ver',       '(Yo) nunca ___ una selva tan grande antes de ese viaje.', 'I had never seen such a big jungle before that trip.', 'past_perfect'],
  ['habían escrito',   'escribir',  'Cuando la profesora pidió los ensayos, los estudiantes ya los ___.', 'When the professor asked for the essays, the students had already written them.', 'past_perfect'],
  ['no había hecho',   'hacer',     'Cuando llegué, mi hermano ___ la tarea.',               'When I arrived, my brother hadn’t done the homework.', 'past_perfect'],
  ['habían muerto',    'morir',     'Cuando descubrieron el códice, sus autores ya ___.',    'When they discovered the codex, its authors had already died.', 'past_perfect'],
  ['habías dicho',     'decir',     '(Tú) ya me ___ el final del libro, así que no lo leí.', 'You had already told me the ending of the book, so I didn’t read it.', 'past_perfect'],
  ['habíais vuelto',   'volver',    'Cuando llamé, ¿(vosotros) ya ___ a casa?',              'When I called, had you all already gone back home?', 'past_perfect'],
  ['había abierto',    'abrir',     'Cuando llegamos, la biblioteca todavía no ___.',        'When we arrived, the library still hadn’t opened.', 'past_perfect'],
];
// Every answer must be [no] + haber + the verb's participle, in the section's tense.
for (const [ans, inf, , , sec] of IN_CONTEXT) {
  const forms = perfect(sec === 'present_perfect' ? HABER_PRESENT : HABER_IMPERFECT, inf);
  if (!forms.includes(ans.replace(/^no /, ''))) throw new Error(`in context: ${ans} is not a ${sec} form of ${inf}`);
}
writeFileSync('output_grammar/grammar_15_perfect_in_context.tsv',
  buildList(IN_CONTEXT.map(([ans, inf, sentence, en, sec]) =>
    [ans, `${inf} — ${sentence} (${en})`, sec]), 'grammar_15_perfect_in_context'), 'utf8');
console.log(`in context: ${IN_CONTEXT.length} cards`);

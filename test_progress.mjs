// Hidden cards, missed-card tracking, and progress export/import. The helpers
// are pulled straight out of index.html (like test_verb_gloss.mjs does), so
// this tests the code that ships, against the real decks.
//
//   node test_progress.mjs

import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('./index.html', 'utf8');
const src = html.match(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/)[1];

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
const NAMES = ['parseTSV', 'parseConjLabel', 'conjPersonIndex', 'buildParadigmQueue',
  'cardKey', 'paradigmKey', 'itemKey', 'isStruggling', 'applyResult', 'selectCards',
  'sectionOrder', 'dropKeyFromQueue', 'positionAfterDrop', 'sanitizeHidden', 'sanitizeStats',
  'sanitizeSetup', 'buildProgressExport', 'parseProgressImport', 'shareUrlFor', 'lessonTag',
  'paradigmTags', 'deckHiddenKeys'];
const app = new Function([
  src.match(/const CONJ_PERSONS = \[[^\]]*\];/)[0],
  src.match(/const KEY_SEP = [^;]+;/)[0],
  ...NAMES.map(n => grab(new RegExp('function ' + n + '\\('))),
].join('\n') + ';return {' + NAMES.join(',') + ', KEY_SEP};')();

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const deck = (p) => app.parseTSV(readFileSync(p, 'utf8'));
const S = app.KEY_SEP;

console.log('=== boot order ===');
{
  // These run during boot (restoreSetup -> renderPreviewControls). Declared
  // after the Boot block, a const would be in its temporal dead zone and kill
  // the whole script — the shim test can't see that path, so check statically.
  const boot = src.indexOf('// ---------- Boot ----------');
  for (const decl of ['const KEY_SEP', 'let hiddenKeys', 'let cardStats', 'const HIDDEN_KEY', 'const verbLabel'])
    ok(src.indexOf(decl) > 0 && src.indexOf(decl) < boot, decl + ' is declared before the boot code');
}

console.log('\n=== shared keys between unit and combined decks ===');
{
  // Hiding a card in "All Units Vocab" hides it in its unit deck because both
  // carry the same rows; that only works if every combined row exists there.
  const unitKeys = new Set();
  for (const f of readdirSync('output_full').filter(n => /^Unit \d+ /.test(n) && n.endsWith('.tsv')))
    for (const c of deck('output_full/' + f)) unitKeys.add(app.cardKey(c));
  const combined = deck('output_full/All Units Vocab.tsv');
  const orphans = combined.filter(c => !unitKeys.has(app.cardKey(c)));
  ok(orphans.length === 0, `every All Units Vocab card is also in a unit deck (${combined.length} cards` +
     (orphans.length ? `; ${orphans.length} not, e.g. ${orphans[0].spanish}` : '') + ')');

  const grammarKeys = new Set();
  for (const f of readdirSync('output_grammar').filter(n => /^grammar_\d+_\d+\.tsv$/.test(n)))
    for (const c of deck('output_grammar/' + f)) grammarKeys.add(app.cardKey(c));
  const gAll = deck('output_grammar/contrasena_grammar_all.tsv');
  const gOrphans = gAll.filter(c => !grammarKeys.has(app.cardKey(c)));
  ok(gOrphans.length === 0, `every combined grammar card is also in its lesson deck (${gAll.length} cards` +
     (gOrphans.length ? `; ${gOrphans.length} not, e.g. ${gOrphans[0].spanish}` : '') + ')');
}

console.log('\n=== drill verbs are distinguishable ===');
{
  let dupes = [];
  for (const f of readdirSync('output_grammar').filter(n => n.endsWith('.tsv'))) {
    const ps = app.buildParadigmQueue(deck('output_grammar/' + f));
    const tags = app.paradigmTags(ps);
    const seen = new Map();
    for (const p of ps) {
      const label = p.lemma + ' / ' + tags.get(app.paradigmKey(p));
      if (seen.has(label)) dupes.push(f + ': ' + label);
      seen.set(label, true);
    }
  }
  ok(dupes.length === 0, 'no deck lists the same verb + tag twice' + (dupes.length ? ' -> ' + dupes.slice(0, 3).join('; ') : ''));

  const tagsOf = (file) => {
    const ps = app.buildParadigmQueue(deck('output_grammar/' + file));
    const t = app.paradigmTags(ps);
    return ps.map(p => [p.lemma, t.get(app.paradigmKey(p))]);
  };
  const haber = tagsOf('grammar_15_2.tsv');
  ok(haber.length === 2 && haber[0][1] === 'present' && haber[1][1] === 'imperfect',
     'grammar_15_2 haber is two verbs: present and imperfect  (got ' + JSON.stringify(haber) + ')');
  ok(tagsOf('grammar_15_present_perfect.tsv').every(([, t]) => t === 'present perfect'), 'present perfect drill is tagged');
  ok(tagsOf('grammar_15_past_perfect.tsv').every(([, t]) => t === 'past perfect'), 'past perfect drill is tagged');
  ok(tagsOf('grammar_13_preterite_review.tsv').every(([, t]) => t === ''), 'a deck with nothing to disambiguate shows no tags');
  const ser = tagsOf('contrasena_grammar_all.tsv').filter(([l]) => l === 'ser');
  ok(ser.length > 1 && new Set(ser.map(([, t]) => t)).size === ser.length,
     `the combined deck's ${ser.length} "ser" paradigms all get different tags`);
  ok(app.lessonTag('grammar_16_1') === 'Unit 16 · Grammar 1', 'lessonTag("grammar_16_1")');
}

console.log('\n=== missed-card stats ===');
{
  const st = Object.create(null);
  ok(app.applyResult(st, 'a', true, 1) === false && !('a' in st), 'a right answer on a new card stores nothing');
  app.applyResult(st, 'a', false, 2);
  ok(app.isStruggling(st.a) && st.a.miss === 1, 'a wrong answer marks it missed');
  app.applyResult(st, 'a', true, 3);
  ok(app.isStruggling(st.a), 'one right answer later: still missed');
  app.applyResult(st, 'a', true, 4);
  ok(!app.isStruggling(st.a), 'two right answers in a row clear it');
  app.applyResult(st, 'a', false, 5);
  ok(app.isStruggling(st.a) && st.a.miss === 2 && st.a.streak === 0, 'missing it again counts again and resets the streak');
}

console.log('\n=== picking cards for a session ===');
{
  const mk = (sp, sec, lesson = 'u1_01') => ({ spanish: sp, english: sp + '-en', lesson, section: sec });
  const cards = [mk('uno', 'a'), mk('dos', 'a'), mk('tres', 'b'), mk('cuatro', 'b')];
  const hidden = new Set([app.cardKey(cards[1])]);
  const st = Object.create(null);
  app.applyResult(st, app.cardKey(cards[2]), false, 1);
  app.applyResult(st, app.cardKey(cards[1]), false, 1);
  const names = (xs) => xs.map(c => c.spanish).join(',');
  ok(names(app.selectCards(cards, '__ALL__', false, hidden, st)) === 'uno,tres,cuatro', 'All leaves hidden cards out');
  ok(names(app.selectCards(cards, '__ALL__', false, null, st)) === 'uno,dos,tres,cuatro', 'hidden = null keeps them (preview)');
  ok(names(app.selectCards(cards, 'a', false, hidden, st)) === 'uno', 'a section, minus hidden');
  ok(names(app.selectCards(cards, '__MISSED__', false, hidden, st)) === 'tres', 'missed list skips a hidden miss');

  // Drill: the dropdown value is a paradigm key, so one "ser" picks one lesson's ser.
  const conj = [
    { spanish: 'soy', english: 'ser — yo (I)', lesson: 'grammar_1_1', section: 'ser' },
    { spanish: 'fui', english: 'ser — yo (I)', lesson: 'grammar_10_2', section: 'ser' },
  ];
  const pick = app.selectCards(conj, 'grammar_10_2' + S + 'ser', true, new Set(), st);
  ok(pick.length === 1 && pick[0].spanish === 'fui', 'a drill pick selects exactly one paradigm across lessons');
  ok(app.sectionOrder(conj, true).join('|') === ['grammar_1_1' + S + 'ser', 'grammar_10_2' + S + 'ser'].join('|'),
     'drill order sorts same-name verbs by lesson number');
  ok(app.deckHiddenKeys(conj, new Set(['grammar_1_1' + S + 'ser', 'unrelated'])).size === 1,
     'deckHiddenKeys finds a deck\'s hidden verbs and ignores other decks');
}

console.log('\n=== hiding the card on screen ===');
{
  // Both direction: each card appears twice. Chunk of 3:
  //   set 0: A> B> A<     set 1: B< C> C<
  const it = (sp, dir) => ({ spanish: sp, english: sp + '-en', lesson: 'L', section: 's', front: dir });
  const q = [it('A', '>'), it('B', '>'), it('A', '<'), it('B', '<'), it('C', '>'), it('C', '<')];
  // Hide B< while on it (absolute 3 = set 1, card 0). B> sits in set 0.
  let r = app.dropKeyFromQueue(q, app.cardKey(q[3]), 3);
  ok(r.queue.length === 4 && r.queue.every(x => x.spanish !== 'B'), 'both directions of the card leave the queue');
  ok(r.index === 2, 'position shifts back by the twin removed in an earlier set  (got ' + r.index + ')');
  // Now A> A< C> | C<. The next card (C>) slid back into set 0, so set 1
  // restarts at its first card rather than jumping sets under the user.
  let p = app.positionAfterDrop(1, r.index, 3, r.queue.length);
  ok(p.setIndex === 1 && p.cardIndex === 0, 'stays in its set when the next card moved out of it  (got ' + JSON.stringify(p) + ')');
  // Hide A> on card 0 of set 0: the next card slides into place.
  r = app.dropKeyFromQueue(q, app.cardKey(q[0]), 0);
  p = app.positionAfterDrop(0, r.index, 3, r.queue.length);
  ok(r.queue[0].spanish === 'B' && p.setIndex === 0 && p.cardIndex === 0, 'hiding the first card shows the next one');
  // Sets re-chunk after a removal: hiding B in [A B][C D] pulls C up into set 0.
  const single = ['A', 'B', 'C', 'D'].map(s => it(s, '>'));
  r = app.dropKeyFromQueue(single, app.cardKey(single[1]), 1);
  p = app.positionAfterDrop(0, r.index, 2, r.queue.length);
  ok(p.setIndex === 0 && p.cardIndex === 1 && r.queue[1].spanish === 'C',
     'the following card slides up into the set  (got ' + JSON.stringify(p) + ')');
  // Hiding the very last card wraps to the top of its set, like next() does.
  r = app.dropKeyFromQueue(single, app.cardKey(single[3]), 3);
  p = app.positionAfterDrop(1, r.index, 2, r.queue.length);
  ok(p.setIndex === 1 && p.cardIndex === 0, 'hiding the last card restarts its set  (got ' + JSON.stringify(p) + ')');
  // Emptying the last set falls back to the one before it.
  const three = single.slice(0, 3);
  r = app.dropKeyFromQueue(three, app.cardKey(three[2]), 2);
  p = app.positionAfterDrop(1, r.index, 2, r.queue.length);
  ok(p.setIndex === 0 && p.cardIndex === 0, 'emptying the last set moves back a set  (got ' + JSON.stringify(p) + ')');
  // "All" cards per set (chunk 0).
  p = app.positionAfterDrop(0, 2, 0, 3);
  ok(p.setIndex === 0 && p.cardIndex === 2, 'chunk 0 (All) treats the queue as one set');
  // Paradigm items key by lesson + section.
  ok(app.itemKey({ lesson: 'L', section: 'hablar', rows: [] }) === 'L' + S + 'hablar', 'a drill verb keys by its paradigm');
}

console.log('\n=== export / import ===');
{
  const st = Object.create(null);
  app.applyResult(st, 'k1', false, 7);
  const exp = app.buildProgressExport({ tab: 'conj' }, new Set(['k1', 'k2']), st, '2026-10-01T00:00:00Z');
  const back = app.parseProgressImport(JSON.stringify(exp));
  ok(back.ok && back.hidden.length === 2 && back.stats.k1.miss === 1 && back.setup.tab === 'conj', 'an export reads back intact');
  ok(!app.parseProgressImport('not json').ok, 'a non-JSON file is refused');
  ok(!app.parseProgressImport(JSON.stringify({ app: 'other', version: 1 })).ok, 'another app\'s JSON is refused');

  // A hostile or garbled file. Setup values become querySelector strings in
  // restoreSetup, so a quote there used to be able to throw at boot.
  const evil = JSON.stringify({ app: 'contrasena-flashcards', version: 1,
    setup: { tab: 'x"]', direction: 'sp_en"], body', chunkSize: 5, mode: 'typing', shuffle: 'yes' },
    hidden: ['ok', 5, null, { a: 1 }],
    stats: JSON.parse('{"__proto__": {"miss": 1, "streak": 0}, "good": {"miss": 2, "streak": 1, "t": 3}, "bad": {"miss": -1, "streak": 0}, "str": {"miss": "2", "streak": 0}}') });
  const r = app.parseProgressImport(evil);
  ok(r.ok, 'a garbled export still parses');
  ok(r.setup.tab === null && r.setup.direction === null, 'unknown tab/direction values are dropped');
  ok(r.setup.chunkSize === '5' && r.setup.mode === 'typing' && r.setup.shuffle === undefined,
     'valid values survive, non-boolean flags are dropped');
  ok(r.hidden.length === 1 && r.hidden[0] === 'ok', 'only string keys survive in hidden');
  ok(Object.keys(r.stats).join(',') === 'good' && Object.getPrototypeOf(r.stats) === null,
     'stats keep only well-formed entries and never touch __proto__');
}

console.log('\n=== share link ===');
{
  const fb = 'https://example.test/app/';
  ok(app.shareUrlFor({ protocol: 'https:', hostname: 'jwomack-marq.github.io', origin: 'https://jwomack-marq.github.io', pathname: '/contrasena-anki/index.html' }, fb)
     === 'https://jwomack-marq.github.io/contrasena-anki/', 'the live site shares its own address, without index.html');
  ok(app.shareUrlFor({ protocol: 'file:', hostname: '', origin: 'null', pathname: '/C:/x/index.html' }, fb) === fb, 'a file:// copy shares the public link');
  ok(app.shareUrlFor({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8000', pathname: '/' }, fb) === fb, 'localhost shares the public link');
}

console.log(fail ? '\n' + fail + ' check(s) FAILED.' : '\nAll progress checks passed.');
process.exit(fail ? 1 : 0);

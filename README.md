# Contraseña → Anki / Flashcards

## For classmates

Open **<https://jwomack-marq.github.io/contrasena-anki/>** on your phone or laptop. That's it; no account, nothing to download.

- **How to use:** the app shows a short guide the first time; reopen it any time with **How to use** at the top.
- **Add it to your home screen** (Chrome: menu ⋮ → *Add to Home screen*; iPhone Safari: Share → *Add to Home Screen*) and it works offline.
- **✓ Know it** hides cards you've mastered. Wrong answers in Typing and Conjugation modes are remembered, and **★ Cards I've missed** in the section list reviews only those.
- Your hidden cards and misses are saved **on your device only**. To move them to another device, use **Options → Export progress / Import progress**.

---

Tooling around the Contraseña Spanish vocabulary lessons:

- **[grab_all.mjs](grab_all.mjs)** — bulk-downloads lesson data from the Contraseña S3 bucket and writes Anki-compatible TSVs (raw `output_full/u*_*.tsv` + a combined file; see *Deck naming* below).
- **[backfill_audio.mjs](backfill_audio.mjs)** — fills the audio column of the ADA vocab decks (`output_pdfs/`) with Contraseña's real pronunciation MP3s (see *Audio pipeline* below). **Currently dormant** — the decks it fed were retired in the deck cleanup.
- **[bookmarklet.js](bookmarklet.js) / [bulk_bookmarklet.js](bulk_bookmarklet.js) / [install.html](install.html)** — browser bookmarklets for one-off / bulk exports on a Contraseña show_hide page.
- **[index.html](index.html)** — installable flashcard PWA (Spanish drill app) with all current TSVs bundled inline.
- **[build_flashcards.mjs](build_flashcards.mjs)** — re-bundles every `*.tsv` in the repo into `index.html` and stamps a fresh cache version into `service-worker.js`.

## Use the flashcard app

Live site: **<https://jwomack-marq.github.io/contrasena-anki/>**

### Install on Android

1. Open the URL in Chrome.
2. Tap the menu (⋮) → **Install app** (or **Add to Home Screen** on older Chromes).
3. Launch from the home-screen icon. It opens full-screen, works offline once cached.

### Install on desktop (Chrome / Edge)

1. Open the URL.
2. Click the install icon in the URL bar (or menu → Apps → Install).
3. The app opens in its own window. Pin to taskbar / dock if you want.

### Settings and progress persist

Everything lives in `localStorage` on each device; nothing leaves it.

| Key | Holds |
|---|---|
| `contrasena-flashcards:setup-v1` | last-used deck, section, direction, chunk, mode, options |
| `contrasena-flashcards:hidden-v1` | cards/verbs hidden with **✓ Know it** |
| `contrasena-flashcards:stats-v1` | `{miss, streak}` per card that was ever missed; a card counts as *missed* until it is right twice in a row |
| `contrasena-flashcards:help-seen-v1` | the how-to guide was closed |

**How cards are identified.** A card is keyed by lesson + section + Spanish + English (direction-independent); a drill verb by lesson + section. The key never mentions the deck file, so the combined decks (`All Units Vocab.tsv`, `contrasena_grammar_all.tsv`) share keys with the per-unit decks: hiding a card in one hides it in the other. If a card's text is corrected, its old hidden/missed state no longer applies to it.

Only the first answer to a card in a session is recorded. Without that, looping a set would let a miss clear itself seconds after the answer was shown.

**Options → Export progress** downloads all of this as JSON, and **Import progress** replaces a device's progress with such a file. Imported setup values are whitelisted (`sanitizeSetup`), because they end up inside `querySelector` strings.

## Deck naming

Vocabulary covers **units 1-18**. `output_full/` holds exactly **one** TSV per deck, named
the way it appears in the app: `Unit 3 Vocab 1.tsv`, `Unit 11 Vocab 2.tsv`, plus named
extras (`Unit 2 Classroom Phrases.tsv`, `Unit 4 Pronunciation.tsv`, `Unit 8
Connectors.tsv`, `Unit 13 Time Expressions.tsv`, `Unit 16 Abbreviations.tsv`) and the
combined `All Units Vocab.tsv`.

Each lesson used to exist three times over — a v1 scrape, a v2 scrape, and a PDF scrape
in `output_pdfs/`. The **v2 scrape won**: the v1 files carried section headings as fake
vocab rows and put digits on the Spanish side of the numbers deck. Unit 3 existed only in
`output_pdfs/`, so it was moved into `output_full/` and kept (its Vocab 1 has no audio).

The unit filter in the app reads the `Contrasena::lessons::` tag inside each file, **not**
the filename, so renaming a deck is safe; the tags still carry the original lesson ids.

Every vocab deck carries real audio except **Unit 3 Vocab 1** and **Unit 16
Abbreviations**, which fall back to browser text-to-speech.

The show_hide API text is occasionally mistyped where the ADA pages are correct (e.g.
`dorado/dorado`, `sencillo/secilla`, `comprometido/compremetida`). Units 14-18 were
diffed word-for-word against the ADA pages on import and eight such typos were repaired.
Re-scraping those units will reintroduce them — re-check before shipping a refresh.

## Refresh the data

Whenever you want to pull new lessons or fix the bundle:

```bash
node grab_all.mjs --ids output_full/found_ids.txt --out ./output_full   # re-fetch API decks
node gen_conjugation_decks.mjs   # regenerate the hand-authored grammar decks
node build_flashcards.mjs        # bundle TSVs into index.html + stamp service-worker.js
npm test                         # the deploy runs this too, and refuses to publish on failure
git add -A && git commit -m "refresh content" && git push
```

> **Heads-up:** `grab_all.mjs` writes raw `u<unit>_<nn>_<nn>.tsv` names and its own combined
> file. After a re-fetch you must re-apply the friendly names (keeping the `v2` variant of
> each pair, deleting the rest) and rebuild `All Units Vocab.tsv` by concatenating the
> `Unit *.tsv` files — otherwise the app's library shows duplicates again.

## Audio pipeline (dormant)

> **State:** this pipeline no longer runs. It existed to add audio to the ADA decks in
> `output_pdfs/`, and those were deleted as duplicates in the deck cleanup. Both of its
> deck-discovery patterns (`output_pdfs/u<n>_v<n>.tsv` and the `output_full/*v2.tsv`
> groundtruth) now match zero files, so `--build-map` / `--apply` are silent no-ops.
> Nothing is lost: the audio it produced is already written into the surviving decks and
> **[audio_map.txt](audio_map.txt)** still holds every word → MP3 mapping. To revive it you
> would re-run `grab_vocab_html.mjs` (which recreates `output_pdfs/`) and widen the
> groundtruth filename filter in `loadDecks()` to accept the friendly deck names — the
> row tags it joins on are unchanged, only the filenames moved.

How it worked: the ADA vocab pages carry no audio, but Contraseña's pronunciation MP3s live
on S3. `backfill_audio.mjs` maintains **[audio_map.txt](audio_map.txt)** (word → MP3 URL,
with a `source` provenance column) and writes it into the 4th column of `output_pdfs/*.tsv`:

- `groundtruth` rows are copied from the show_hide API decks (`output_full/*v2.tsv`),
  which match the ADA decks row-for-row — every unit except u3 is covered this way.
- `inferred` rows (u3_v2, now **Unit 3 Vocab 2**) come from positional inference over the
  S3 file naming scheme, gated by a strict file-count check plus a size/syllable sanity
  check. **Listen to [audio_review.html](audio_review.html) before trusting newly inferred
  rows** — if a deck sounds wrong, delete its rows from `audio_map.txt` and re-run `--apply`.
- u3_v1 (now **Unit 3 Vocab 1**) has no recoverable recordings (the API lesson is gone and
  the file count is ambiguous); the app speaks those cards with browser text-to-speech
  instead. It is the only deck in the app with no real audio.

```bash
npm run backfill        # rebuild audio_map.txt + audio_review.html (probes S3, uses audio_probe_cache.json)
npm run backfill:apply  # write the map into output_pdfs/*.tsv (idempotent)
```

Cards that still lack a URL fall back to synthesized Spanish speech in the app
(marked with a dotted play button).

### If audio stops working mid-set

Press **⟲ Reset audio** at the bottom of the study screen (or the `A` key). It rebuilds the
audio player and leaves your deck, set, and position untouched — unlike reloading the page,
which reshuffles everything.

The app keeps exactly **one** `<audio>` element and releases it (`removeAttribute('src')` +
`load()`) between cards. That matters: a `new Audio()` per card leaked a media resource
every play, and Android caps how many a tab may hold, so playback died partway through a
set with `MediaError` code 3. If a play does fail, recovery escalates cheapest-first —
rebuild the player and retry, and only if that fails evict the cached MP3 and retry from
the network.

## Verb meanings in the conjugation drill

Each drillable infinitive has an English meaning in the `VERB_GLOSS` table in
[index.html](index.html). In the drill, tap the **meaning?** line under the verb (or press
`M`) to reveal it; it hides again on the next verb. Tick *Conjugation: show verb meaning*
in Options to have every verb start revealed instead.

[test_verb_gloss.mjs](test_verb_gloss.mjs) fails if any verb in `output_grammar/*.tsv`
lacks a gloss, or if a gloss exists for a verb in no deck — so adding or removing a verb
from a deck requires the matching `VERB_GLOSS` edit.

## Hand-authored grammar decks

[gen_conjugation_decks.mjs](gen_conjugation_decks.mjs) writes every grammar deck that isn't scraped, including Unit 15's:

| Deck | Tab | What it drills |
|---|---|---|
| `grammar_15_participles.tsv` | Grammar | infinitive → past participle: regular, the textbook's irregular list, compounds (*descrito, expuesto*), accented *-ído* |
| `grammar_15_participle_agreement.tsv` | Grammar | participles as adjectives (*las ventanas ___* → *cerradas*) |
| `grammar_15_present_perfect.tsv` / `grammar_15_past_perfect.tsv` | Conjugation | full paradigms (*he hablado*, *había hablado*), built as haber + participle |
| `grammar_15_perfect_in_context.tsv` | Grammar | fill-in sentences mixing both tenses |

The generator checks its own output: agreement answers must be the participle with the right ending, and every sentence answer must be a real form of its tense. Labels must read `verb — rest` with one dash, because the app takes the verb from before it.

When one verb appears in several paradigms, the section name carries the tense (`hablar_past_perfect`). The drill shows it as a tag under the infinitive and in the verb list; paradigms still identical after that get the lesson added ("Unit 16 · Grammar 1").

Grammar-tab decks open in **En → Sp**, so you see the clue and type the Spanish.

> **Hand fix to re-apply after a grammar re-scrape:** `grammar_15_2` (and its rows in `contrasena_grammar_all.tsv`) puts haber's present and imperfect in one `haber` section, which the drill interleaved as yo/yo/tú/tú…. They were split by hand into `haber_present` and `haber_imperfect`. Re-running `grab_grammar.mjs` undoes this.

## Deploying

Every push to `main` runs [.github/workflows/static.yml](.github/workflows/static.yml): `npm ci`, `npm test`, then publish to GitHub Pages. A failing test blocks the deploy, so classmates never get a broken build. `npm test` includes `node build_flashcards.mjs --check`, which fails if a TSV changed without `index.html` being rebuilt (the workflow publishes the committed `index.html`; it does not build).

GitHub Pages publishes within a minute. Pages are fetched network-first, so the next open while online gets the new build. The new service worker then reloads the page once.

## Enabling GitHub Pages (one-time)

Repo Settings → Pages → Source: **GitHub Actions**. The workflow above does the rest; the first publish takes about a minute.

## Local testing

```bash
python -m http.server 8000
# open http://localhost:8000
```

Service workers only register on http(s) origins, so double-clicking `index.html` from the filesystem skips PWA features (file is still fully functional otherwise).

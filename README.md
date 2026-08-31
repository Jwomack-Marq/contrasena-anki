# Contraseña → Anki / Flashcards

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

### Settings persist

The last-used TSV / lesson / section / direction / chunk / mode is saved to `localStorage` on each device. Re-open and pick up where you left off.

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
node build_flashcards.mjs        # bundle TSVs into index.html + stamp service-worker.js
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

GitHub Pages publishes within a minute. The service worker (stale-while-revalidate) will deliver the new build on the **second** open after a deploy.

## Enabling GitHub Pages (one-time)

Repo Settings → Pages → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save. First publish takes ~1 minute.

## Local testing

```bash
python -m http.server 8000
# open http://localhost:8000
```

Service workers only register on http(s) origins, so double-clicking `index.html` from the filesystem skips PWA features (file is still fully functional otherwise).

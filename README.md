# Contraseña → Anki / Flashcards

Tooling around the Contraseña Spanish vocabulary lessons:

- **[grab_all.mjs](grab_all.mjs)** — bulk-downloads lesson data from the Contraseña S3 bucket and writes Anki-compatible TSVs (`output_full/*.tsv` + combined `contrasena_all.tsv`).
- **[backfill_audio.mjs](backfill_audio.mjs)** — fills the audio column of the ADA vocab decks (`output_pdfs/`) with Contraseña's real pronunciation MP3s (see *Audio pipeline* below).
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

## Refresh the data

Whenever you want to pull new lessons or fix the bundle:

```bash
node grab_all.mjs --ids output_full/found_ids.txt --out ./output_full   # re-fetch API decks
node grab_vocab_html.mjs --urls vocab_html_urls.txt                     # re-fetch ADA vocab decks
node backfill_audio.mjs --apply                                         # re-fill the audio column
node build_flashcards.mjs        # bundle TSVs into index.html + stamp service-worker.js
git add -A && git commit -m "refresh content" && git push
```

## Audio pipeline

The ADA vocab pages carry no audio, but Contraseña's pronunciation MP3s live on S3.
`backfill_audio.mjs` maintains **[audio_map.txt](audio_map.txt)** (word → MP3 URL, with a
`source` provenance column) and writes it into the 4th column of `output_pdfs/*.tsv`:

- `groundtruth` rows are copied from the show_hide API decks (`output_full/*v2.tsv`),
  which match the ADA decks row-for-row — every unit except u3 is covered this way.
- `inferred` rows (u3_v2 only) come from positional inference over the S3 file naming
  scheme, gated by a strict file-count check plus a size/syllable sanity check.
  **Listen to [audio_review.html](audio_review.html) before trusting newly inferred rows** —
  if a deck sounds wrong, delete its rows from `audio_map.txt` and re-run `--apply`.
- u3_v1 has no recoverable recordings (the API lesson is gone and the file count is
  ambiguous); the app speaks those cards with browser text-to-speech instead.

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

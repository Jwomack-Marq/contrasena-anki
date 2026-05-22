# Contraseña → Anki / Flashcards

Tooling around the Contraseña Spanish vocabulary lessons:

- **[grab_all.mjs](grab_all.mjs)** — bulk-downloads lesson data from the Contraseña S3 bucket and writes Anki-compatible TSVs (`output_full/*.tsv` + combined `contrasena_all.tsv`).
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
node grab_all.mjs                # re-fetch TSVs into output_full/
node build_flashcards.mjs        # bundle TSVs into index.html + stamp service-worker.js
git add -A && git commit -m "refresh content" && git push
```

GitHub Pages publishes within a minute. The service worker (stale-while-revalidate) will deliver the new build on the **second** open after a deploy.

## Enabling GitHub Pages (one-time)

Repo Settings → Pages → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save. First publish takes ~1 minute.

## Local testing

```bash
python -m http.server 8000
# open http://localhost:8000
```

Service workers only register on http(s) origins, so double-clicking `index.html` from the filesystem skips PWA features (file is still fully functional otherwise).

// Bundles every *.tsv file in the repo into the <script id="bundled-tsvs">
// block inside flashcards.html, so the app's library auto-populates without
// any folder/file picker. Re-run this whenever you regenerate TSVs.
//
//   node build_flashcards.mjs
//   node build_flashcards.mjs --root ./output_full   # narrower scope

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root:   { type: 'string', default: '.' },
    html:   { type: 'string', default: './index.html' },
    sw:     { type: 'string', default: './service-worker.js' },
    skip:   { type: 'string', default: '.git,node_modules,output_test' },
  },
});

const skipDirs = new Set(values.skip.split(',').map(s => s.trim()).filter(Boolean));

function walk(dir, root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, root));
    else if (name.toLowerCase().endsWith('.tsv')) {
      out.push({
        path: relative(root, p).split(/[\\/]/).join('/'),
        content: readFileSync(p, 'utf8'),
      });
    }
  }
  return out;
}

const tsvs = walk(values.root, values.root)
  // Skip the file we'd produce if someone happens to TSV-name flashcards output.
  .filter(t => !/(^|\/)flashcards\b/i.test(t.path));

// Stable, friendly order: combined files first, then by path.
tsvs.sort((a, b) => {
  const ac = /contrasena_all/i.test(a.path) ? 0 : 1;
  const bc = /contrasena_all/i.test(b.path) ? 0 : 1;
  if (ac !== bc) return ac - bc;
  return a.path.localeCompare(b.path);
});

const html = readFileSync(values.html, 'utf8');

// JSON inside a <script type="application/json"> block is text content, so the
// only character we have to escape is '</' to prevent premature tag closure.
const json = JSON.stringify(tsvs).replace(/<\//g, '<\\/');

const re = /<script id="bundled-tsvs" type="application\/json">[\s\S]*?<\/script>/;
if (!re.test(html)) {
  console.error('FAIL: could not find <script id="bundled-tsvs"> placeholder in ' + values.html);
  process.exit(1);
}

// Single timestamp shared between the SW cache version and the visible build
// stamp in the HTML, so a user can read the version on screen and know it
// matches the cache they got served.
const ts = new Date().toISOString().replace(/[:.]/g, '-');

// Stamp `__BUILD_TIMESTAMP__` (or a previously-stamped value) inside the HTML
// build-version spans, so the version is visible in the UI.
let updated = html.replace(re, `<script id="bundled-tsvs" type="application/json">${json}</script>`);
const buildStampRe = /(<span id="buildStamp(?:Bottom)?">)[^<]*(<\/span>)/g;
const beforeStamp = updated;
updated = updated.replace(buildStampRe, `$1${ts}$2`);
const stampedHtml = beforeStamp !== updated;
writeFileSync(values.html, updated, 'utf8');

const sizes = tsvs.reduce((s, t) => s + t.content.length, 0);
console.log(`Bundled ${tsvs.length} TSV file${tsvs.length===1?'':'s'} (${sizes.toLocaleString()} chars of TSV → ${json.length.toLocaleString()} chars of JSON) into ${values.html}`);
if (stampedHtml) console.log(`Stamped ${values.html} build version = '${ts}'`);
else console.warn(`Note: ${values.html} has no <span id="buildStamp"> to stamp.`);
for (const t of tsvs) console.log(`  ${t.path}  (${t.content.length.toLocaleString()} chars)`);

// Stamp the service worker so the PWA cache invalidates on every rebuild.
// Same timestamp as the HTML for easy cross-checking.
try {
  const swPath = values.sw;
  const swText = readFileSync(swPath, 'utf8');
  const versionRe = /(const CACHE_VERSION = ')([^']+)(';)/;
  if (versionRe.test(swText)) {
    const newSw = swText.replace(versionRe, `$1${ts}$3`);
    writeFileSync(swPath, newSw, 'utf8');
    console.log(`Stamped ${swPath} with CACHE_VERSION = '${ts}'`);
  } else {
    console.warn(`Note: ${swPath} has no CACHE_VERSION literal to stamp.`);
  }
} catch (e) {
  if (e.code === 'ENOENT') console.warn(`Note: ${values.sw} not found; skipping SW stamp.`);
  else throw e;
}

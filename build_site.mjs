// Copies only the files the live site needs into _site/, which the Pages
// workflow uploads. Uploading the whole checkout used to ship node_modules
// (~73 MB, installed by `npm ci` for the tests) on every deploy.
//
//   node build_site.mjs
//
// Fails if a page, the service worker or the manifest points at a local file
// that isn't in SITE_FILES, so adding an asset without listing it here breaks
// CI instead of the installed app.

import { readFileSync, copyFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const OUT = '_site';
const SITE_FILES = [
  'index.html',
  'service-worker.js',
  'manifest.webmanifest',
  'icon.svg',
  'install.html',   // bookmarklet installer; its live URL predates this whitelist
];

let fail = 0;
const missing = [];
for (const f of SITE_FILES) if (!existsSync(f)) missing.push(f);
if (missing.length) {
  console.error('FAIL listed but missing: ' + missing.join(', '));
  process.exit(1);
}

// Every local file reference, normalised to a repo-relative path.
const refs = new Map();   // path -> where it was referenced
const addRef = (raw, from) => {
  if (!raw || /^([a-z]+:|\/\/|#|data:)/i.test(raw)) return;
  const p = posix.normalize(raw.split(/[?#]/)[0]).replace(/^\.\//, '');
  if (p === '' || p === '.' || p === './') return;
  if (!refs.has(p)) refs.set(p, from);
};

// Pages write local paths as './x', in attributes and in script alike
// (serviceWorker.register('./service-worker.js')).
for (const page of SITE_FILES.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/["'](\.\/[\w.-]+)["']/g)) addRef(m[1], page);
}

const sw = readFileSync('service-worker.js', 'utf8');
const assets = sw.match(/const ASSETS = \[([\s\S]*?)\]/);
if (!assets) { console.error('FAIL could not find ASSETS in service-worker.js'); process.exit(1); }
for (const m of assets[1].matchAll(/'([^']*)'/g)) addRef(m[1], 'service-worker.js ASSETS');

const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
for (const icon of manifest.icons || []) addRef(icon.src, 'manifest.webmanifest icons');

for (const [p, from] of refs) {
  if (!SITE_FILES.includes(p)) {
    console.error(`FAIL ${from} references ${p}, which is not in SITE_FILES`);
    fail++;
  }
}
if (fail) process.exit(1);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const f of SITE_FILES) {
  copyFileSync(f, join(OUT, f));
  bytes += statSync(f).size;
}
console.log(`ok   ${OUT}/ has ${SITE_FILES.length} files (${(bytes / 1024).toFixed(0)} KB); ${refs.size} local references checked`);

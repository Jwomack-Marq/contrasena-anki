// Verifies that:
// 1. The script source embedded in install.html matches bookmarklet.js exactly.
// 2. The generated javascript: URL is well-formed and decodes back to valid JS.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bk = readFileSync(new URL('./bookmarklet.js', import.meta.url), 'utf8').trim();
const html = readFileSync(new URL('./install.html', import.meta.url), 'utf8');
const m = html.match(/<script id="src" type="text\/plain">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: could not find embedded source block'); process.exit(1); }
const embedded = m[1].trim();

if (embedded !== bk) {
  console.error('FAIL: embedded source diverges from bookmarklet.js');
  // Show first divergence point.
  for (let i = 0; i < Math.max(embedded.length, bk.length); i++) {
    if (embedded[i] !== bk[i]) {
      console.error(`  first diff at index ${i}: embedded=${JSON.stringify(embedded.slice(i, i+40))} bookmarklet=${JSON.stringify(bk.slice(i, i+40))}`);
      break;
    }
  }
  process.exit(1);
}
console.log('OK: embedded source matches bookmarklet.js exactly (' + bk.length + ' chars)');

// Replicate install.html's JS-side encoding.
const url = 'javascript:' + encodeURIComponent(embedded);
console.log('OK: bookmarklet URL length = ' + url.length + ' (browsers handle multi-KB javascript: URLs)');

// Decode back and confirm it parses as JS.
const decoded = decodeURIComponent(url.replace(/^javascript:/, ''));
try {
  new vm.Script(decoded);
  console.log('OK: decoded bookmarklet body parses as JavaScript');
} catch (e) {
  console.error('FAIL: decoded body does not parse: ' + e.message);
  process.exit(1);
}

// Sanity: does the URL contain anything that would break a browser parser?
if (/[\x00-\x1f]/.test(url)) {
  console.error('FAIL: bookmarklet URL contains control chars');
  process.exit(1);
}
console.log('OK: no control chars in URL');

console.log('\nAll checks passed.');

// Verifies that:
// 1. The script source embedded in install.html matches bookmarklet.js exactly.
// 2. The generated javascript: URL is well-formed and decodes back to valid JS.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./install.html', import.meta.url), 'utf8');

function checkPair(label, srcFile, blockId) {
  const bk = readFileSync(new URL(srcFile, import.meta.url), 'utf8').trim();
  const re = new RegExp('<script id="' + blockId + '" type="text\\/plain">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  if (!m) { console.error(`FAIL [${label}]: could not find <script id="${blockId}"> block`); process.exit(1); }
  const embedded = m[1].trim();

  if (embedded !== bk) {
    console.error(`FAIL [${label}]: embedded source diverges from ${srcFile}`);
    for (let i = 0; i < Math.max(embedded.length, bk.length); i++) {
      if (embedded[i] !== bk[i]) {
        console.error(`  first diff at index ${i}: embedded=${JSON.stringify(embedded.slice(i, i+40))} source=${JSON.stringify(bk.slice(i, i+40))}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log(`OK [${label}]: embedded source matches ${srcFile} exactly (${bk.length} chars)`);

  const url = 'javascript:' + encodeURIComponent(embedded);
  console.log(`OK [${label}]: bookmarklet URL length = ${url.length}`);

  const decoded = decodeURIComponent(url.replace(/^javascript:/, ''));
  try { new vm.Script(decoded); }
  catch (e) { console.error(`FAIL [${label}]: decoded body does not parse: ${e.message}`); process.exit(1); }
  console.log(`OK [${label}]: decoded body parses as JavaScript`);

  if (/[\x00-\x1f]/.test(url)) { console.error(`FAIL [${label}]: URL contains control chars`); process.exit(1); }
  console.log(`OK [${label}]: no control chars in URL`);
}

checkPair('single',  './bookmarklet.js', 'src');
checkPair('bulk',    './bulk_bookmarklet.js', 'src-bulk');
checkPair('grammar', './grammar_bookmarklet.js', 'src-grammar');

console.log('\nAll checks passed.');

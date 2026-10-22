// Renders icon.svg to the PNG icons phones need, and writes qr.svg (the
// app's URL as a QR code) for share.html. The outputs are committed, so this
// only needs re-running when the icon or the URL changes.
//
//   node make_icons.mjs
//
// iOS ignores an SVG apple-touch-icon and puts a screenshot of the page on the
// home screen instead; Android's install flow wants 192 and 512 PNGs.
// icon.svg draws its "C" with system fonts, so run this on Windows (Segoe UI
// Bold): elsewhere the letter comes out in whatever font the machine has.

import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';

const PUBLIC_URL = 'https://jwomack-marq.github.io/contrasena-anki/';
const SIZES = { 'icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

const svg = readFileSync('icon.svg', 'utf8');
for (const [file, size] of Object.entries(SIZES)) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  }).render().asPng();
  writeFileSync(file, png);
  console.log(`wrote ${file} (${size}x${size}, ${png.length.toLocaleString()} bytes)`);
}

// Dark on white in both themes: phone scanners struggle with inverted codes.
const qr = await QRCode.toString(PUBLIC_URL, {
  type: 'svg', errorCorrectionLevel: 'M', margin: 2,
  color: { dark: '#1c1c22', light: '#ffffff' },
});
writeFileSync('qr.svg', qr);
console.log(`wrote qr.svg for ${PUBLIC_URL}`);

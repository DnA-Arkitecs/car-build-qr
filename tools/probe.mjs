// Prints how big the QR gets for builds of different sizes, and how much the
// digits encoding saves against base64. Run: node tools/probe.mjs [base-url]
import { encodeBuild, shareUrl, digitsToBytes } from '../js/codec.js';
import { gradeLink } from '../js/qr.js';
import { qrcode, realisticBuild } from '../test/fixtures.mjs';

const base = process.argv[2] || 'https://dna-arkitecs.github.io/car-build-qr/';
const full = realisticBuild();

function base64Modules(payload) {
  const bytes = digitsToBytes(payload.slice(1));
  const b64 = Buffer.from(bytes).toString('base64url');
  const qr = qrcode(0, 'M');
  qr.addData(`${base}#1${b64}`, 'Byte');
  qr.make();
  return qr.getModuleCount();
}

console.log('mods  link chars  QR version (squares)  base64 would be  grade    square size per print');
for (const n of [1, 5, 10, 15, 20, 25]) {
  const payload = await encodeBuild({ ...full, mods: full.mods.slice(0, n) });
  const url = shareUrl(base, payload);
  const g = gradeLink(url, qrcode);
  const b64 = base64Modules(payload);
  const sizes = g.formats.map((f) => `${f.id} ${f.mm.toFixed(2)}mm`).join('  ');
  console.log(`${String(n).padStart(4)}  ${String(url.length).padStart(10)}  v${String(g.version).padEnd(3)} (${g.modules})            v${(b64 - 17) / 4} (${b64})        ${g.level.padEnd(7)}  ${sizes}`);
}

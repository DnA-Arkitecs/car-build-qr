import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeLink, moduleMatrix, qrPath, makeQr, moduleMm, FORMATS, MIN_MODULE_MM } from '../js/qr.js';
import { stickerSvg, dashCardSvg, xmlEscape, fitAttrs } from '../js/sticker.js';
import { encodeBuild, decodeBuild, shareUrl } from '../js/codec.js';
import { normalizeBuild } from '../js/model.js';
import { qrcode, realisticBuild, realisticBuildWithLinks, scanMatrix, BASE } from './fixtures.mjs';

test('a 25-mod build makes a QR that scans back to the exact link', async () => {
  const url = shareUrl(BASE, await encodeBuild(realisticBuild()));
  const grade = gradeLink(url, qrcode);
  assert.equal(grade.ok, true);
  const scanned = scanMatrix(moduleMatrix(grade.qr));
  assert.equal(scanned, url);
  // ...and the scanned link opens the same build.
  const back = await decodeBuild(new URL(scanned).hash);
  assert.deepEqual(back, normalizeBuild(realisticBuild()));
});

test('a 25-mod build fits a 4-inch sticker and is easy on the dash card', async () => {
  const url = shareUrl(BASE, await encodeBuild(realisticBuild()));
  const grade = gradeLink(url, qrcode);
  const s4 = grade.formats.find((f) => f.id === 's4');
  assert.ok(s4.fits, `4-inch sticker squares are ${s4.mm.toFixed(2)} mm`);
  assert.ok(grade.card.easy, `dash card squares are ${grade.card.mm.toFixed(2)} mm`);
  assert.notEqual(grade.sticker, null);
});

test('25 mods that each carry a shop link fall back to the dash card, which still scans', async () => {
  const url = shareUrl(BASE, await encodeBuild(realisticBuildWithLinks()));
  const grade = gradeLink(url, qrcode);
  assert.equal(grade.ok, true);
  assert.equal(grade.level, 'card');
  assert.ok(grade.card.easy, `dash card squares are ${grade.card.mm.toFixed(2)} mm`);
  assert.equal(scanMatrix(moduleMatrix(grade.qr)), url);
});

test('long or all-caps names are squeezed to fit the print', () => {
  assert.equal(fitAttrs('Blue Thunder', 48, 860), '');
  assert.match(fitAttrs('SUBARU WRX STI LIMITED TIME', 48, 860), /textLength="860"/);
  assert.match(fitAttrs('SUBARU WRX STI LIMITED', 58, 670), /textLength="670"/);
});

test('the build after "#" goes in the dense numeric mode', async () => {
  const url = shareUrl(BASE, await encodeBuild(realisticBuild()));
  const mixed = makeQr(url, qrcode).getModuleCount();
  const bytesOnly = qrcode(0, 'M');
  bytesOnly.addData(url, 'Byte');
  bytesOnly.make();
  assert.ok(mixed < bytesOnly.getModuleCount(), `${mixed} vs ${bytesOnly.getModuleCount()} modules`);
});

test('a short build is easy to scan on a small sticker', async () => {
  const url = shareUrl(BASE, await encodeBuild({ make: 'Honda', model: 'Civic', mods: [{ brand: 'Tein', part: 'Coilovers' }] }));
  const grade = gradeLink(url, qrcode);
  assert.equal(grade.level, 'easy');
  assert.ok(grade.sticker.inches <= 3);
  assert.equal(scanMatrix(moduleMatrix(grade.qr)), url);
});

test('a link too long for any print is graded too-big, not crashed', () => {
  const grade = gradeLink(BASE + '#1' + '7'.repeat(7000), qrcode);
  assert.equal(grade.ok, false);
  assert.equal(grade.level, 'too-big');
});

test('module sizes follow the print size', () => {
  const s4 = FORMATS.find((f) => f.id === 's4');
  const card = FORMATS.find((f) => f.id === 'card');
  // Version 25 is 117 squares plus a 4-square border on each side.
  assert.ok(Math.abs(moduleMm(s4, 117) - (4 * 0.76 * 25.4) / 125) < 1e-9);
  assert.ok(moduleMm(card, 117) > moduleMm(s4, 117));
  assert.ok(moduleMm(s4, 177) < MIN_MODULE_MM); // version 40 never goes on a sticker
});

test('qrPath draws one run per row segment', () => {
  assert.equal(qrPath([[true, true, false, true]]), 'M0 0h2v1h-2zM3 0h1v1h-1z');
});

test('printed SVGs escape the owner\'s text', () => {
  const matrix = moduleMatrix(makeQr('https://example.com', qrcode));
  const evil = '<script>alert("x")</script>';
  const sticker = stickerSvg(matrix, { title: evil, inches: 3 });
  const card = dashCardSvg(matrix, { title: evil, subtitle: evil, count: 3 });
  for (const svg of [sticker, card]) {
    assert.equal(svg.includes('<script'), false);
    assert.ok(svg.includes('&lt;script&gt;'));
  }
  assert.ok(sticker.includes('width="3in"'));
  assert.ok(card.includes('width="7.5in"'));
  assert.equal(xmlEscape(`a&b<c>"d'`), 'a&amp;b&lt;c&gt;&quot;d&#39;');
});

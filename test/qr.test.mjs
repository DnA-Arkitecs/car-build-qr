import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeLink, moduleMatrix, qrPath, makeQr, moduleMm, FORMATS, SHAPES, MIN_MODULE_MM, QUIET_ZONE } from '../js/qr.js';
import { stickerSvg, dashCardSvg, shapeSvg, fontsUsed, xmlEscape, fitAttrs } from '../js/sticker.js';
import { SCENES } from '../js/config.js';
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

test('printed SVGs escape the owner\'s text, in every shape and style', () => {
  const matrix = moduleMatrix(makeQr('https://example.com', qrcode));
  const evil = '<script>alert("x")</script>';
  const sticker = stickerSvg(matrix, { title: evil, inches: 3 });
  const card = dashCardSvg(matrix, { title: evil, subtitle: evil, count: 3 });
  for (const scene of SCENES) {
    for (const shape of SHAPES) {
      const svg = shapeSvg(shape.id, matrix, {
        title: evil, subtitle: evil, count: 3, serial: '0427', scene,
        specs: [{ label: evil, value: evil }], inches: shape.id === 'card' ? true : 4,
      });
      assert.equal(/<script|<img|onerror=|onload=|<style/i.test(svg), false, `${scene.id} ${shape.id}`);
      assert.match(svg, /&lt;script&gt;/i, `${scene.id} ${shape.id}`);
    }
  }
  assert.ok(sticker.includes('width="3in"'));
  assert.ok(card.includes('width="7.5in"'));
  assert.equal(xmlEscape(`a&b<c>"d'`), 'a&amp;b&lt;c&gt;&quot;d&#39;');
});

// Reads the QR squares back out of a drawn SVG (the black path), the way a
// printer would put them on paper, and decodes them.
function scanSvg(svg) {
  const d = svg.match(/<path d="([^"]+)" fill="#000"/)[1];
  const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => m.slice(1).map(Number));
  const size = Math.max(...runs.map(([x, , w]) => x + w), ...runs.map(([, y]) => y + 1)) + QUIET_ZONE;
  const grid = Array.from({ length: size - QUIET_ZONE * 2 }, () => new Array(size - QUIET_ZONE * 2).fill(false));
  for (const [x, y, w] of runs) for (let i = 0; i < w; i++) grid[y - QUIET_ZONE][x - QUIET_ZONE + i] = true;
  return scanMatrix(grid);
}

test('every shape in every style carries a QR that scans to the exact link', async () => {
  const url = shareUrl(BASE, await encodeBuild({ ...realisticBuild(), scene: 'trail' }));
  const matrix = moduleMatrix(makeQr(url, qrcode));
  for (const scene of SCENES) {
    for (const shape of SHAPES) {
      const svg = shapeSvg(shape.id, matrix, { title: 'Blue Thunder', count: 25, scene, inches: 4 });
      assert.equal(scanSvg(svg), url, `${scene.id} ${shape.id}`);
      assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/, 'the QR sits on its own white panel');
    }
  }
});

test('each shape is graded on its own: a long list switches the round slap off, not the 4-inch square', async () => {
  const url = shareUrl(BASE, await encodeBuild(realisticBuild()));
  const grade = gradeLink(url, qrcode);
  const s4 = grade.formats.find((f) => f.id === 's4');
  assert.ok(s4.mm >= 0.6, `4-inch square squares are ${s4.mm.toFixed(3)} mm`);
  assert.equal(grade.shapes.square.id, 's4');
  assert.equal(grade.shapes.slap, null);
  assert.equal(grade.shapes.tag.id, 't6');
  assert.equal(grade.shapes.card.id, 'card');
  for (const f of grade.formats) assert.equal(f.fits, f.mm >= MIN_MODULE_MM, f.id);
});

test('a short build fits every shape, at the smallest easy size', async () => {
  const url = shareUrl(BASE, await encodeBuild({ make: 'Honda', model: 'Civic', mods: [{ brand: 'Tein', part: 'Coilovers' }] }));
  const grade = gradeLink(url, qrcode);
  for (const s of SHAPES) assert.ok(grade.shapes[s.id] && grade.shapes[s.id].easy, s.id);
  assert.equal(grade.shapes.tag.id, 't35');
  assert.equal(grade.shapes.slap.id, 'r3');
});

test('shape QR shares match the drawings', () => {
  const tag = FORMATS.find((f) => f.id === 't6');
  const slap = FORMATS.find((f) => f.id === 'r4');
  assert.ok(Math.abs(tag.qrInches - 6 * (800 / 1500)) < 1e-9);
  assert.ok(Math.abs(slap.qrInches - 4 * 0.8 / Math.SQRT2) < 1e-9);
  // Every sheet fits letter paper with half-inch margins (7.5 x 10 in) and quarter-inch gaps.
  for (const f of FORMATS.filter((x) => x.kind === 'sticker')) {
    const rows = Math.ceil(f.perSheet / f.cols);
    assert.ok(f.cols * f.w + (f.cols - 1) * 0.25 <= 7.5 + 1e-9, `${f.id} width`);
    assert.ok(rows * f.h + (rows - 1) * 0.25 <= 10 + 1e-9, `${f.id} height`);
  }
});

test('no drawing points at another by a shared id, so a printed sheet never borrows the hidden preview\'s', () => {
  const matrix = moduleMatrix(makeQr('https://example.com', qrcode));
  for (const scene of SCENES) {
    for (const shape of SHAPES) {
      const svg = shapeSvg(shape.id, matrix, { title: 'Blue Thunder', count: 3, scene, inches: 4 });
      assert.equal(/<pattern|url\(#/.test(svg), false, `${scene.id} ${shape.id}`);
    }
  }
  const ids = (svg) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids(shapeSvg('slap', matrix, { title: 'A', inches: 4 }));
  const b = ids(shapeSvg('slap', matrix, { title: 'A', inches: 4 }));
  assert.equal(a.length, 2);
  assert.equal(a.some((id) => b.includes(id)), false);
});

test('the hazard stripe stays inside its band', () => {
  const matrix = moduleMatrix(makeQr('https://example.com', qrcode));
  const svg = shapeSvg('tag', matrix, { title: 'X', scene: 'tech', inches: 6 });
  const xs = [...svg.matchAll(/<polygon points="([^"]+)"/g)].flatMap((m) => m[1].split(' ').map((p) => Number(p.split(',')[0])));
  assert.ok(xs.length > 8);
  assert.ok(Math.min(...xs) >= 60 && Math.max(...xs) <= 60 + (1500 - 60 - 800 - 60 - 50) + 1e-6);
});

test('a style\'s downloads carry only the fonts it draws with', () => {
  assert.deepEqual(fontsUsed('tech'), ['Barlow Condensed|800|normal', 'IBM Plex Mono|600|normal']);
  assert.deepEqual(fontsUsed('night'), ['Chakra Petch|700|italic', 'IBM Plex Mono|600|normal']);
  assert.deepEqual(fontsUsed('sheet'), ['Courier Prime|700|normal', 'IBM Plex Mono|600|normal']);
});

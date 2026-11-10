import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, cleanLink, cleanCategory, normalizeBuild, groupMods, buildTitle, vehicleLine, todayISO, validDate } from '../js/model.js';
import { LIMITS, OTHER_CATEGORY } from '../js/config.js';

test('cleanText strips control and direction-override characters', () => {
  assert.equal(cleanText('  Turbo\u0000‮ kit​  ', 50), 'Turbo kit');
  assert.equal(cleanText('two\nlines', 50), 'two lines');
  assert.equal(cleanText('keep\n\n\n\npara', 50, { multiline: true }), 'keep\n\npara');
});

test('cleanText caps by characters without splitting an emoji', () => {
  const s = cleanText('🚗🚗🚗🚗', 3);
  assert.equal(s, '🚗🚗🚗');
  assert.equal(cleanText(null, 5), '');
});

test('cleanLink keeps only http and https web addresses', () => {
  assert.equal(cleanLink('https://example.com/part?id=1'), 'https://example.com/part?id=1');
  assert.equal(cleanLink('example.com/x'), 'https://example.com/x');
  assert.equal(cleanLink('javascript:alert(1)'), '');
  assert.equal(cleanLink('JaVaScRiPt:alert(1)'), '');
  assert.equal(cleanLink('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(cleanLink('ftp://example.com/file'), '');
  assert.equal(cleanLink('not a link'), '');
  assert.equal(cleanLink('localhost'), '');
  assert.equal(cleanLink('https://example.com/' + 'a'.repeat(400)), '');
});

test('cleanLink refuses links that hide the real site behind a login', () => {
  assert.equal(cleanLink('https://shop.example.com@evil.example.net/'), '');
  assert.equal(cleanLink('https://user:pass@example.com/'), '');
});

test('cleanText keeps emoji joiners and drops broken characters', () => {
  assert.equal(cleanText('👨‍🔧 tuned', 20), '👨‍🔧 tuned'); // man + ZWJ + wrench
  assert.equal(cleanText('a\uD800b\uDC00c￾', 20), 'abc');
});

test('dates must be real calendar dates', () => {
  assert.equal(validDate('2026-11-09'), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('9999-99-99'), false);
  assert.equal(normalizeBuild({ updated: '2026-13-01' }).updated, '');
});

test('cleanCategory falls back to Other for unknown values', () => {
  assert.equal(cleanCategory(2), 2);
  assert.equal(cleanCategory('Exhaust'), 2);
  assert.equal(cleanCategory(999), OTHER_CATEGORY);
  assert.equal(cleanCategory(-1), OTHER_CATEGORY);
  assert.equal(cleanCategory('1; drop'), OTHER_CATEGORY);
  assert.equal(cleanCategory(1.5), OTHER_CATEGORY);
});

test('normalizeBuild cleans a messy build', () => {
  const b = normalizeBuild({
    type: 'spaceship',
    year: '20x19!',
    make: 'Subaru'.repeat(20),
    mods: [
      { brand: '', part: '', partNumber: '' },
      { brand: 'Cobb', part: 'Accessport', link: 'javascript:alert(1)', category: 4, extra: 'dropped' },
      'not an object',
    ],
    unknown: 'dropped',
  });
  assert.equal(b.type, 'car');
  assert.equal(b.year, '2019');
  assert.equal(b.make.length, LIMITS.make);
  assert.equal(b.mods.length, 1);
  assert.deepEqual(b.mods[0], { category: 4, brand: 'Cobb', part: 'Accessport', partNumber: '', link: '', notes: '' });
  assert.equal('unknown' in b, false);
  assert.equal('extra' in b.mods[0], false);
});

test('normalizeBuild caps the number of mods', () => {
  const mods = Array.from({ length: 200 }, (_, i) => ({ part: `Part ${i}` }));
  assert.equal(normalizeBuild({ mods }).mods.length, LIMITS.mods);
});

test('normalizeBuild survives junk input', () => {
  for (const junk of [null, undefined, 42, 'text', [], { mods: 'nope' }]) {
    const b = normalizeBuild(junk);
    assert.equal(b.type, 'car');
    assert.deepEqual(b.mods, []);
  }
});

test('groupMods orders groups by category and keeps owner order inside', () => {
  const groups = groupMods([
    { category: 8, part: 'b' }, { category: 2, part: 'a' }, { category: 8, part: 'c' },
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['Exhaust', 'Suspension']);
  assert.deepEqual(groups[1].items.map((m) => m.part), ['b', 'c']);
});

test('titles and dates', () => {
  assert.equal(buildTitle({ nickname: '', year: '2019', make: 'Subaru', model: 'WRX', trim: '' }), '2019 Subaru WRX');
  assert.equal(buildTitle({ nickname: 'Blue', year: '', make: '', model: '', trim: '' }), 'Blue');
  assert.equal(buildTitle({ type: 'moto', nickname: '', year: '', make: '', model: '', trim: '' }), 'My bike');
  assert.equal(vehicleLine({ year: '2001', make: 'Honda', model: 'CBR', trim: '' }), '2001 Honda CBR');
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
});

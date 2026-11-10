import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModList } from '../js/paste.js';
import { CATEGORIES, SPEC_KINDS, LIMITS } from '../js/config.js';
import { buildNumber, cleanTags, normalizeBuild } from '../js/model.js';
import { storyNumbers } from '../js/storycard.js';
import { realisticBuild } from './fixtures.mjs';

const cat = (name) => CATEGORIES.indexOf(name);
const spec = (name) => SPEC_KINDS.findIndex((k) => k.name === name);

const CAPTION = `Finally dialed in 🔥🔥
450whp / 400wtq on E85
MODS:
- Cobb Accessport V3 - Stage 2 tune
- Invidia Q300 cat-back (HS15SSTGTC)
• Grimmspeed up-pipe
1. BC Racing BR coilovers (lowered 1.5 in)
2) Enkei RPF1 18x9.5 +38
Michelin Pilot Sport 4S 265/35R18
Brembo front pads P/N P85-073
WHEELS
Gram Lights 57DR
Interior:
Bride Zeta III
Exhaust: Tomei Expreme Ti
Weight: 3,150 lb
Seibon carbon hood https://example.com/hood.
#subaru #wrx #sti #boosted`;

test('an Instagram caption becomes mods with brands, part numbers, notes and categories', () => {
  const { mods, specs } = parseModList(CAPTION);
  const rows = mods.map((m) => [CATEGORIES[m.category], m.brand, m.part, m.partNumber, m.notes, m.link]);
  assert.deepEqual(rows, [
    ['Tune / ECU', 'Cobb', 'Accessport V3', '', 'Stage 2 tune', ''],
    ['Exhaust', 'Invidia', 'Q300 cat-back', 'HS15SSTGTC', '', ''],
    ['Exhaust', 'Grimmspeed', 'up-pipe', '', '', ''],
    ['Suspension', 'BC Racing', 'BR coilovers', '', 'lowered 1.5 in', ''],
    ['Wheels & tires', 'Enkei', 'RPF1 18x9.5 +38', '', '', ''],
    ['Wheels & tires', 'Michelin', 'Pilot Sport 4S 265/35R18', '', '', ''],
    ['Brakes', 'Brembo', 'front pads', 'P85-073', '', ''],
    ['Wheels & tires', 'Gram Lights', '57DR', '', '', ''],
    ['Interior', 'Bride', 'Zeta III', '', '', ''],
    ['Exhaust', 'Tomei', 'Expreme Ti', '', '', ''],
    ['Aero & body', 'Seibon', 'carbon hood', '', '', 'https://example.com/hood'],
  ]);
  assert.deepEqual(specs, [
    { kind: spec('Power'), value: '450 whp' },
    { kind: spec('Torque'), value: '400 wtq' },
    { kind: spec('Weight'), value: '3,150 lb' },
  ]);
});

test('a one-line list splits on commas and skips the "Mods:" label', () => {
  const { mods } = parseModList('Mods: Cobb AP, Invidia Q300, KW V3 coilovers, Volk TE37 18x9.5');
  assert.deepEqual(mods.map((m) => [CATEGORIES[m.category], m.brand, m.part]), [
    ['Tune / ECU', 'Cobb', 'AP'],
    ['Exhaust', 'Invidia', 'Q300'],
    ['Suspension', 'KW', 'V3 coilovers'],
    ['Wheels & tires', 'Volk', 'TE37 18x9.5'],
  ]);
});

test('a heading sets the category for lines that do not say', () => {
  const { mods } = parseModList('== SUSPENSION ==\nCustom rear setup\n[Interior]\nHand-stitched door cards\nSomething odd');
  assert.equal(mods[0].category, cat('Suspension'));
  assert.equal(mods[1].category, cat('Interior'));
  assert.equal(mods[2].category, cat('Interior'));
});

test('unknown brands keep the whole line as the part', () => {
  const { mods } = parseModList('Zorblax 3000 widget');
  assert.equal(mods[0].brand, '');
  assert.equal(mods[0].part, 'Zorblax 3000 widget');
  assert.equal(mods[0].category, cat('Other'));
});

test('hostile or junk text is cleaned like the form: no script links, limits kept', () => {
  const { mods } = parseModList('<img src=x onerror=alert(1)> wing\njavascript:alert(1) exhaust\nKW V3 https://user:pw@evil.example.net/');
  assert.equal(mods[0].part, '<img src=x onerror=alert > wing'); // plain text (the page shows it as words); "(1)" went to notes
  assert.equal(mods[0].notes, '1');
  assert.equal(mods[1].link, '');
  assert.equal(mods[2].link, ''); // a login-style link is dropped by the same cleaning
  const many = Array.from({ length: 200 }, (_, i) => `Part number ${i}`).join('\n');
  assert.equal(parseModList(many).mods.length, LIMITS.mods);
  const long = parseModList('x'.repeat(50_000));
  assert.ok(long.mods[0].part.length <= LIMITS.part);
  assert.deepEqual(parseModList(''), { mods: [], specs: [], skipped: 0 });
  assert.deepEqual(parseModList(null), { mods: [], specs: [], skipped: 0 });
  assert.equal(parseModList('#wrx #subaru 🔥').mods.length, 0);
  // A run of digits is not a power figure, so no 20-character number with its unit cut off.
  assert.deepEqual(parseModList(`${'9'.repeat(6000)}whp`).specs, []);
  assert.deepEqual(parseModList('1,050 whp and 912.5 wtq').specs.map((s) => s.value), ['1,050 whp', '912.5 wtq']);
});

test('the build number stays the same as mods change, and changes with the car', () => {
  const b = normalizeBuild(realisticBuild());
  const n = buildNumber(b);
  assert.match(n, /^\d{4}$/);
  assert.equal(buildNumber({ ...b, mods: [] }), n);
  assert.notEqual(buildNumber({ ...b, nickname: 'Red Thunder' }), n);
});

test('tags: commas or a list, no repeats, no "#", six at most', () => {
  assert.deepEqual(cleanTags('Daily, #Stage 2, daily, , Track'), ['Daily', 'Stage 2', 'Track']);
  assert.equal(cleanTags('a,b,c,d,e,f,g,h').length, 6);
  assert.deepEqual(cleanTags(42), []);
});

test('the story card shows the owner\'s specs first, then counts', () => {
  const b = normalizeBuild({ ...realisticBuild(), specs: [{ kind: 0, value: '350 whp' }] });
  assert.deepEqual(storyNumbers(b), [
    { label: 'Power', value: '350 whp' },
    { label: 'Mods', value: '25' },
    { label: 'Year', value: '2019' },
    { label: 'Systems', value: '16' },
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBuild, decodeBuild, shareUrl, PayloadError, bytesToDigits, digitsToBytes } from '../js/codec.js';
import { normalizeBuild } from '../js/model.js';
import { realisticBuild, BASE } from './fixtures.mjs';

async function rawPayload(obj) {
  // Builds a payload from any JSON, bypassing the app's own cleaning, the way
  // an attacker would.
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  return '1' + bytesToDigits(packed);
}

test('bytes and digits convert both ways at every length', () => {
  for (let len = 0; len <= 60; len++) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 97 + len * 31) & 0xff;
    if (len % 7 === 3) bytes.fill(0xff); // the largest value in every chunk
    const digits = bytesToDigits(bytes);
    assert.match(digits, /^\d*$/);
    assert.deepEqual(digitsToBytes(digits), bytes, `length ${len}`);
  }
});

test('digit strings that no byte string makes are refused', () => {
  assert.throws(() => digitsToBytes('999'), (e) => e.code === 'damaged'); // 999 > 255
  assert.throws(() => digitsToBytes('1234'), (e) => e.code === 'damaged'); // no chunk is 4 digits
  assert.throws(() => digitsToBytes('12a'), (e) => e.code === 'chars');
});

test('a realistic build survives the round trip exactly', async () => {
  const build = realisticBuild();
  const payload = await encodeBuild(build);
  assert.match(payload, /^1\d+$/);
  assert.deepEqual(await decodeBuild(payload), normalizeBuild(build));
});

test('text in any language and emoji survives', async () => {
  const build = { type: 'moto', make: 'Ducati', model: 'Panigale V4', nickname: 'Rosso 🔥', about: 'Café racer — señor\nline two', mods: [{ brand: 'Akrapovič', part: 'Racing line', notes: '日本製' }] };
  const back = await decodeBuild(await encodeBuild(build));
  assert.equal(back.type, 'moto');
  assert.equal(back.nickname, 'Rosso 🔥');
  assert.equal(back.about, 'Café racer — señor\nline two');
  assert.equal(back.mods[0].brand, 'Akrapovič');
  assert.equal(back.mods[0].notes, '日本製');
});

test('an empty build encodes and decodes', async () => {
  const back = await decodeBuild(await encodeBuild({}));
  assert.equal(back.mods.length, 0);
});

test('a leading # and a trailing full stop or bracket from a chat app are accepted', async () => {
  const payload = await encodeBuild(realisticBuild());
  assert.equal((await decodeBuild('#' + payload)).make, 'Subaru');
  assert.equal((await decodeBuild(payload + '.')).make, 'Subaru');
  assert.equal((await decodeBuild(payload + ').')).make, 'Subaru');
});

test('damaged links fail with a clear message, never a crash', async () => {
  const payload = await encodeBuild(realisticBuild());
  const cases = [
    ['', 'empty'],
    ['2abc', 'version'],
    ['1abc$%^', 'chars'],
    [payload.slice(0, 1 + 17 * 20), 'damaged'], // cut short on a chunk boundary
    [payload.slice(0, payload.length - 1), 'damaged'], // one digit lost
    ['1' + '0'.repeat(34), 'damaged'], // valid digits, not a compressed build
    ['1' + '1'.repeat(17000), 'size'],
  ];
  for (const [input, code] of cases) {
    await assert.rejects(decodeBuild(input), (e) => e instanceof PayloadError && e.code === code && e.message.length > 10, `case ${code}`);
  }
});

test('a link that inflates to a huge size is refused', async () => {
  const payload = await rawPayload({ n: 'a'.repeat(2_000_000) });
  assert.ok(payload.length < 8000, 'the bomb is small on the wire');
  await assert.rejects(decodeBuild(payload), (e) => e.code === 'size');
});

test('a hand-made link is cleaned: script links dropped, junk ignored', async () => {
  const payload = await rawPayload({
    n: '<img src=x onerror=alert(1)>',
    t: 'x',
    m: [
      [2, 'Evil', 'Part', '', 'javascript:alert(document.cookie)'],
      ['drop table', '', 'Second'],
      null,
      { c: 1, p: 'objects are not mods' },
      [1],
    ],
    zzz: 'ignored',
  });
  const b = await decodeBuild(payload);
  assert.equal(b.nickname, '<img src=x onerror=alert(1)>'); // kept as text; the viewer shows it as words
  assert.equal(b.type, 'car');
  assert.equal(b.mods.length, 2);
  assert.equal(b.mods[0].link, '');
  assert.equal(b.mods[1].category, 16);
});

test('non-object payloads are refused', async () => {
  for (const value of [[1, 2], 'text', 42, null]) {
    await assert.rejects(decodeBuild(await rawPayload(value)), (e) => e.code === 'shape');
  }
});

test('shareUrl drops any old hash or query', () => {
  assert.equal(shareUrl(BASE + '?x=1#old', 'P'), BASE + '#P');
});

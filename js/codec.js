// Turns a build into the text after the "#" in the sticker's link, and back.
//
// Why the build lives in the link: the page's host never stores or even
// receives it (browsers do not send the part after "#"), so the app needs no
// database, no accounts and no server code. The trade-off: a sticker shows the
// build as it was when the QR was made; adding a mod means printing a new QR.
//
// Format: FORMAT_VERSION + digits( deflate-raw( UTF-8 JSON with short keys ) )
//
// Why digits: QR codes store digits in "numeric mode" at 3.33 bits each, so
// compressed bytes written as digits cost about 2% extra in the QR, against 33%
// for base64. The QR comes out roughly a quarter smaller, which is the
// difference between a sticker that scans and one that does not.
import { FORMAT_VERSION } from './config.js';
import { normalizeBuild } from './model.js';

const BUILD_KEYS = [
  ['year', 'y'], ['make', 'mk'], ['model', 'md'], ['trim', 'tr'],
  ['nickname', 'n'], ['owner', 'o'], ['about', 'd'], ['updated', 'u'],
];
// Each mod is stored as an array in this order, trailing blanks dropped.
const MOD_FIELDS = ['brand', 'part', 'partNumber', 'link', 'notes'];

// Hard ceilings, so a crafted link cannot make a phone allocate huge memory.
const MAX_JSON_BYTES = 64 * 1024;
const MAX_PAYLOAD_CHARS = 16 * 1024;

export class PayloadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toCompact(build) {
  const b = normalizeBuild(build);
  const out = {};
  if (b.type === 'moto') out.t = 'm';
  for (const [long, short] of BUILD_KEYS) if (b[long]) out[short] = b[long];
  out.m = b.mods.map((m) => {
    const row = [m.category, ...MOD_FIELDS.map((k) => m[k])];
    while (row.length > 1 && row[row.length - 1] === '') row.pop();
    return row;
  });
  return out;
}

function fromCompact(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new PayloadError('shape', 'This link does not hold a build.');
  }
  const raw = { type: obj.t === 'm' ? 'moto' : 'car' };
  for (const [long, short] of BUILD_KEYS) raw[long] = obj[short];
  raw.mods = Array.isArray(obj.m)
    ? obj.m.filter(Array.isArray).map((row) => {
        const m = { category: row[0] };
        MOD_FIELDS.forEach((k, i) => { m[k] = row[i + 1]; });
        return m;
      })
    : [];
  return normalizeBuild(raw);
}

// ---------- bytes <-> digits ----------
// 7 bytes (56 bits) fit in 17 digits. A final shorter chunk of k bytes uses the
// fewest digits that can hold 8k bits, so every length decodes one way.
const CHUNK = 7;
const DIGITS_FOR = [0, 3, 5, 8, 10, 13, 15, 17];
const BYTES_FOR = new Map(DIGITS_FOR.map((d, k) => [d, k]));

export function bytesToDigits(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    let n = 0n;
    for (const b of chunk) n = (n << 8n) | BigInt(b);
    out += n.toString().padStart(DIGITS_FOR[chunk.length], '0');
  }
  return out;
}

export function digitsToBytes(s) {
  if (!/^\d*$/.test(s)) throw new PayloadError('chars', 'This link has characters that do not belong in it.');
  const full = Math.floor(s.length / 17);
  const tail = s.length - full * 17;
  if (!BYTES_FOR.has(tail)) throw new PayloadError('damaged', 'This link is damaged or was cut short. Try scanning again.');
  const total = full * CHUNK + BYTES_FOR.get(tail);
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < s.length; ) {
    const digits = s.length - i >= 17 ? 17 : tail;
    const k = BYTES_FOR.get(digits);
    let n = BigInt(s.slice(i, i + digits));
    if (n >> BigInt(8 * k) !== 0n) throw new PayloadError('damaged', 'This link is damaged or was cut short. Try scanning again.');
    for (let j = k - 1; j >= 0; j--) {
      out[at + j] = Number(n & 0xffn);
      n >>= 8n;
    }
    at += k;
    i += digits;
  }
  return out;
}

async function pipeThrough(bytes, stream, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (limit && total > limit) {
      await reader.cancel();
      throw new PayloadError('size', 'This link is too large to open.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function compressionSupported() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

export async function encodeBuild(build) {
  if (!compressionSupported()) throw new PayloadError('browser', 'This browser is too old to make a QR code.');
  const json = JSON.stringify(toCompact(build));
  const packed = await pipeThrough(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return FORMAT_VERSION + bytesToDigits(packed);
}

export async function decodeBuild(payload) {
  // A messaging app may glue a "." or ")" onto a pasted link; the build is digits only.
  const s = String(payload || '').trim().replace(/^#/, '').replace(/^(\d+)[.,;:!?)\]'"]+$/, '$1');
  if (!s) throw new PayloadError('empty', 'This link has no build in it.');
  if (s.length > MAX_PAYLOAD_CHARS) throw new PayloadError('size', 'This link is too large to open.');
  if (s[0] !== FORMAT_VERSION) {
    throw new PayloadError('version', 'This link is not one this app made, or it was made by a newer version. Reload the page and scan again.');
  }
  if (!compressionSupported()) {
    throw new PayloadError('browser', 'This phone\'s browser is too old to open the build. Updating the phone fixes it.');
  }
  let json;
  try {
    const bytes = await pipeThrough(digitsToBytes(s.slice(1)), new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    if (e instanceof PayloadError) throw e;
    throw new PayloadError('damaged', 'This link is damaged or was cut short. Try scanning again.');
  }
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new PayloadError('damaged', 'This link is damaged or was cut short. Try scanning again.');
  }
  return fromCompact(obj);
}

// The full link printed in the QR code.
export function shareUrl(base, payload) {
  const u = new URL(base);
  u.hash = '';
  u.search = '';
  return `${u.href}#${payload}`;
}

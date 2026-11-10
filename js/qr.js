// QR codes: picks the smallest code for a link, says which print sizes will
// scan, and draws it as an SVG path or onto a canvas.
//
// Uses the vendored qrcode-generator (MIT, Kazuhiko Arase), loaded as a classic
// script that defines the global `qrcode`. Tests pass the factory in directly.

// Error correction M: about 15% of the code can be scratched or dirty and it
// still scans. A good balance for a sticker against size.
export const ECC = 'M';
export const QUIET_ZONE = 4; // modules of white border the QR standard asks for

// Printed size of one QR square. At 0.8 mm a phone reads it from arm's length;
// at 0.6 mm it needs to come to about a hand's length. Below that we do not
// offer the size.
export const EASY_MODULE_MM = 0.8;
export const MIN_MODULE_MM = 0.6;

// Share of a sticker's width the QR (with its white border) takes; the rest is
// the caption. sticker.js draws with the same number.
export const QR_SHARE = 0.76;
export const CARD_QR_INCHES = 6.5;

export const FORMATS = [
  { id: 's2', kind: 'sticker', inches: 2, perSheet: 12, cols: 3, label: '2-inch sticker' },
  { id: 's3', kind: 'sticker', inches: 3, perSheet: 6, cols: 2, label: '3-inch sticker' },
  { id: 's4', kind: 'sticker', inches: 4, perSheet: 2, cols: 1, label: '4-inch sticker' },
  { id: 'card', kind: 'card', inches: null, perSheet: 1, cols: 1, label: 'dash card (letter paper)' },
].map((f) => ({ ...f, qrInches: f.kind === 'card' ? CARD_QR_INCHES : f.inches * QR_SHARE }));

function factory(qrcodeFactory) {
  const f = qrcodeFactory || globalThis.qrcode;
  if (typeof f !== 'function') throw new Error('QR encoder not loaded');
  return f;
}

// A link whose build is all digits after "#" is stored as two segments: the
// address in byte mode and the digits in the denser numeric mode.
export function makeQr(text, qrcodeFactory) {
  const qr = factory(qrcodeFactory)(0, ECC); // 0 = pick the smallest version that fits
  const cut = text.indexOf('#') + 1;
  const digits = cut > 0 ? text.slice(cut) : '';
  if (digits.length >= 6 && /^\d+$/.test(digits)) {
    qr.addData(text.slice(0, cut), 'Byte');
    qr.addData(digits, 'Numeric');
  } else {
    qr.addData(text, 'Byte');
  }
  qr.make();
  return qr;
}

export function moduleMatrix(qr) {
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) row[c] = qr.isDark(r, c);
    rows.push(row);
  }
  return rows;
}

export function moduleMm(format, moduleCount) {
  return (format.qrInches * 25.4) / (moduleCount + QUIET_ZONE * 2);
}

// Which print sizes will scan, and the one to recommend.
//   level: 'easy' | 'good' (a sticker works) | 'card' (only the dash card) | 'too-big'
export function gradeLink(text, qrcodeFactory) {
  let qr;
  try {
    qr = makeQr(text, qrcodeFactory);
  } catch {
    return { ok: false, level: 'too-big', chars: text.length, version: null, modules: null, formats: [], sticker: null, card: null };
  }
  const modules = qr.getModuleCount();
  const formats = FORMATS.map((f) => {
    const mm = moduleMm(f, modules);
    return { ...f, mm, fits: mm >= MIN_MODULE_MM, easy: mm >= EASY_MODULE_MM };
  });
  const stickers = formats.filter((f) => f.kind === 'sticker');
  const sticker = stickers.find((f) => f.easy) || stickers.find((f) => f.fits) || null;
  const card = formats.find((f) => f.kind === 'card');
  let level;
  if (sticker) level = sticker.easy ? 'easy' : 'good';
  else if (card.fits) level = 'card';
  else level = 'too-big';
  return { ok: level !== 'too-big', level, chars: text.length, version: (modules - 17) / 4, modules, qr, formats, sticker, card };
}

// SVG path of the dark modules, one rectangle per run in a row.
export function qrPath(matrix, offset = 0) {
  let d = '';
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      const start = c;
      while (c < row.length && row[c]) c++;
      d += `M${start + offset} ${r + offset}h${c - start}v1h-${c - start}z`;
    }
  });
  return d;
}

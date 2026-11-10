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
// the caption. sticker.js draws with the same numbers.
export const QR_SHARE = 0.76; // square sticker
export const TAG_QR_SHARE = 800 / 1500; // 3:2 tech tag, QR on the right
export const SLAP_QR_SHARE = 0.8 / Math.SQRT2; // round slap: the QR square sits inside the white centre
export const CARD_QR_INCHES = 6.5;

// Sticker shapes, in the order the owner sees them.
export const SHAPES = [
  { id: 'square', name: 'Square', hint: 'The classic: QR in the middle, name under it.' },
  { id: 'tag', name: 'Tech tag', hint: 'A 3:2 tag: name and specs on the left, QR on the right.' },
  { id: 'slap', name: 'Round slap', hint: 'A round sticker with your name around the ring. Best for shorter lists.' },
  { id: 'card', name: 'Dash card', hint: 'Letter paper for the dashboard. Scans from farthest away.' },
];

// Every printable size. A letter sheet with half-inch margins is 7.5 x 10 in.
export const FORMATS = [
  { id: 's2', shape: 'square', kind: 'sticker', inches: 2, w: 2, h: 2, perSheet: 12, cols: 3, label: '2-inch square' },
  { id: 's3', shape: 'square', kind: 'sticker', inches: 3, w: 3, h: 3, perSheet: 6, cols: 2, label: '3-inch square' },
  { id: 's4', shape: 'square', kind: 'sticker', inches: 4, w: 4, h: 4, perSheet: 2, cols: 1, label: '4-inch square' },
  { id: 't35', shape: 'tag', kind: 'sticker', inches: 3.5, w: 3.5, h: 3.5 / 1.5, perSheet: 6, cols: 2, label: '3.5 x 2.3-inch tag' },
  { id: 't6', shape: 'tag', kind: 'sticker', inches: 6, w: 6, h: 4, perSheet: 2, cols: 1, label: '6 x 4-inch tag' },
  { id: 'r3', shape: 'slap', kind: 'sticker', inches: 3, w: 3, h: 3, perSheet: 6, cols: 2, label: '3-inch round' },
  { id: 'r4', shape: 'slap', kind: 'sticker', inches: 4, w: 4, h: 4, perSheet: 2, cols: 1, label: '4-inch round' },
  { id: 'card', shape: 'card', kind: 'card', inches: null, w: 7.5, h: 10, perSheet: 1, cols: 1, label: 'dash card (letter paper)' },
].map((f) => ({ ...f, qrInches: qrInchesFor(f) }));

function qrInchesFor(f) {
  if (f.shape === 'card') return CARD_QR_INCHES;
  if (f.shape === 'tag') return f.w * TAG_QR_SHARE;
  if (f.shape === 'slap') return f.w * SLAP_QR_SHARE;
  return f.w * QR_SHARE;
}

function factory(qrcodeFactory) {
  const f = qrcodeFactory || globalThis.qrcode;
  if (typeof f !== 'function') throw new Error('QR encoder not loaded');
  return f;
}

// The QR encoder is only needed by the owner's editor, so the scan page never
// downloads it. Loaded as a classic script from this site (the page's policy
// allows scripts from here only).
let loading = null;
export function loadQrLib() {
  if (typeof globalThis.qrcode === 'function') return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/qrcode.js', import.meta.url).href;
      s.addEventListener('load', () => resolve());
      s.addEventListener('error', () => {
        loading = null;
        s.remove();
        reject(new Error('The QR maker did not load. Check the connection and reload the page.'));
      });
      document.head.appendChild(s);
    });
  }
  return loading;
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

// The size to recommend in a list of one shape's sizes (smallest first): the
// smallest that is easy to scan, else the smallest that scans at all.
function pick(list) {
  return list.find((f) => f.easy) || list.find((f) => f.fits) || null;
}

// Which print sizes will scan, and the one to recommend.
//   level: 'easy' | 'good' (a square sticker works) | 'card' (only the dash card) | 'too-big'
//   shapes: the recommended size of each shape, or null when none of its sizes scans.
export function gradeLink(text, qrcodeFactory) {
  let qr;
  try {
    qr = makeQr(text, qrcodeFactory);
  } catch {
    return { ok: false, level: 'too-big', chars: text.length, version: null, modules: null, formats: [], sticker: null, card: null, shapes: {} };
  }
  const modules = qr.getModuleCount();
  const formats = FORMATS.map((f) => {
    const mm = moduleMm(f, modules);
    return { ...f, mm, fits: mm >= MIN_MODULE_MM, easy: mm >= EASY_MODULE_MM };
  });
  const shapes = {};
  for (const s of SHAPES) shapes[s.id] = pick(formats.filter((f) => f.shape === s.id));
  const sticker = shapes.square;
  const card = formats.find((f) => f.kind === 'card');
  let level;
  if (sticker) level = sticker.easy ? 'easy' : 'good';
  else if (card.fits) level = 'card';
  else level = 'too-big';
  return { ok: level !== 'too-big', level, chars: text.length, version: (modules - 17) / 4, modules, qr, formats, sticker, card, shapes };
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

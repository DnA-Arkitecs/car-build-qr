// What gets printed: a square sticker, a 3:2 tech tag, a round slap, or a
// letter-size dash card for builds whose QR is too dense for a sticker. Each is
// drawn in the build's style (tech card, night meet, build sheet, trail). One
// SVG serves the screen preview, the download for a sticker printer, and home
// printing at exact size.
//
// The QR itself is always black on a white panel with the standard 4-square
// border, whatever the style: that is what keeps it scanning.
import { APP_NAME, MONO, FONT_FILES, sceneById } from './config.js';
import { QUIET_ZONE, QR_SHARE, TAG_QR_SHARE, SLAP_QR_SHARE, CARD_QR_INCHES, qrPath } from './qr.js';

const STACKS = {
  'Barlow Condensed': "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', Arial, sans-serif",
  'Chakra Petch': "'Chakra Petch', Arial, sans-serif",
  'Courier Prime': "'Courier Prime', 'Courier New', monospace",
  'IBM Plex Mono': "'IBM Plex Mono', Consolas, 'Courier New', monospace",
};

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fitLine(text, maxChars) {
  const chars = Array.from(text);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('').trim()}…` : text;
}

// Rough Arial widths (in ems) so long or all-caps names never run off the
// sticker. Wider than the real glyphs on purpose: squeezing a little early is
// better than spilling past the border. `scale` adjusts for narrower faces;
// `mono` counts every character the same.
function estimateWidth(text, fontSize, bold, scale = 1, mono = false) {
  let em = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) > 0x2e80) em += 1.0;
    else if (mono) em += 0.62;
    else if (/[A-Z]/.test(ch)) em += 0.74;
    else if (/[a-z]/.test(ch)) em += 0.6;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else if (ch === ' ') em += 0.28;
    else em += 0.62;
  }
  return em * fontSize * (mono ? 1 : (bold ? 1 : 0.92) * scale);
}

// Extra attributes that squeeze a line into maxWidth when it would not fit.
export function fitAttrs(text, fontSize, maxWidth, bold = true, scale = 1, mono = false) {
  return estimateWidth(text, fontSize, bold, scale, mono) > maxWidth
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
}

// Splits a title into at most maxLines lines that fit maxWidth, word by word.
function wrapLines(text, fontSize, maxWidth, f, maxLines = 2) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (!line || lines.length === maxLines - 1 || estimateWidth(next, fontSize, true, f.width, f.mono) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function face(f) {
  return `font-family="${STACKS[f.family] || STACKS['Barlow Condensed']}" font-weight="${f.weight}"${f.style === 'italic' ? ' font-style="italic"' : ''}`;
}
const MONO_ATTRS = face(MONO);

function headText(scene, s) {
  return scene.head.upper ? s.toUpperCase() : s;
}

// The font files a style's prints use, for downloads that carry their fonts.
export function fontsUsed(sceneOrId) {
  const scene = typeof sceneOrId === 'object' && sceneOrId ? sceneOrId : sceneById(sceneOrId);
  const h = scene.head;
  return [...new Set([`${h.family}|${h.weight}|${h.style}`, `${MONO.family}|${MONO.weight}|${MONO.style}`])]
    .filter((k) => FONT_FILES[k]);
}

function qrGroup(matrix, x, y, size) {
  const n = matrix.length + QUIET_ZONE * 2;
  return `<g transform="translate(${x} ${y}) scale(${size / n})"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(matrix, QUIET_ZONE)}" fill="#000" shape-rendering="crispEdges"/></g>`;
}

// The style's stripe band: hazard stripes, three neon bands, a typed double
// rule, or trail-marker notches.
// Cuts a polygon to the band xmin..xmax (Sutherland-Hodgman, two edges).
function clipX(points, xmin, xmax) {
  const edge = (pts, inside, cross) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) out.push(cross(a, b));
    }
    return out;
  };
  const at = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const left = edge(points, (p) => p[0] >= xmin, (a, b) => at(a, b, xmin));
  return edge(left, (p) => p[0] <= xmax, (a, b) => at(a, b, xmax));
}

const r1 = (n) => Math.round(n * 10) / 10;

function stripe(scene, x, y, w, h) {
  if (scene.stripe === 'hazard') {
    // Drawn as slanted bands, not an SVG pattern: a pattern is found by id, and
    // a printed sheet would pick up the hidden on-screen copy's and print blank.
    const band = Math.round(h * 0.64);
    let marks = '';
    for (let bx = x - h; bx < x + w; bx += band * 2) {
      const poly = clipX([[bx, y + h], [bx + band, y + h], [bx + band + h, y], [bx + h, y]], x, x + w);
      if (poly.length >= 3) marks += `<polygon points="${poly.map(([px, py]) => `${r1(px)},${r1(py)}`).join(' ')}" fill="${scene.accent}"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${scene.bg}"/>${marks}`;
  }
  if (scene.stripe === 'bands') {
    const t = h / 3;
    return scene.bands.map((c, i) => `<rect x="${x}" y="${y + i * t}" width="${w}" height="${t}" fill="${c}"/>`).join('');
  }
  if (scene.stripe === 'rule') {
    return `<rect x="${x}" y="${y + h * 0.15}" width="${w}" height="${h * 0.2}" fill="${scene.ink}"/><rect x="${x}" y="${y + h * 0.6}" width="${w}" height="${h * 0.1}" fill="${scene.ink}"/>`;
  }
  const notch = h * 0.7;
  let marks = '';
  for (let mx = x + notch; mx + notch < x + w; mx += notch * 2.4) {
    marks += `<rect x="${mx}" y="${y + h * 0.3}" width="${notch}" height="${h * 0.4}" fill="${scene.bg}"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${scene.accent}"/>${marks}`;
}

function sceneOf(opts) {
  return typeof opts.scene === 'object' && opts.scene ? opts.scene : sceneById(opts.scene);
}

function sizeAttrs(w, h) {
  return w ? ` width="${w}in" height="${h}in"` : '';
}

function modsLine(count) {
  return `${count} ${count === 1 ? 'MOD' : 'MODS'}`;
}

// matrix: rows of booleans from qr.moduleMatrix(). inches: printed size, or
// null for a preview that fills its box.
export function stickerSvg(matrix, opts = {}) {
  const { title = '', inches = null } = opts;
  const scene = sceneOf(opts);
  const hf = scene.head;
  const V = 1000;
  const qrSize = V * QR_SHARE;
  const y = 118;
  const line = fitLine(headText(scene, title), 30);
  const label = xmlEscape(line);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}"${sizeAttrs(inches, inches)} role="img" aria-label="QR code sticker${label ? `: ${label}` : ''}">
<rect x="6" y="6" width="${V - 12}" height="${V - 12}" rx="70" fill="${scene.bg}" stroke="${scene.accent}" stroke-width="12"/>
<text x="${V / 2}" y="92" text-anchor="middle" ${face(hf)} font-size="58" letter-spacing="2" fill="${scene.accent}"${fitAttrs('SCAN FOR THE FULL BUILD', 58, 860, true, hf.width, hf.mono)}>SCAN FOR THE FULL BUILD</text>
${qrGroup(matrix, (V - qrSize) / 2, y, qrSize)}
<text x="${V / 2}" y="${y + qrSize + 62}" text-anchor="middle" ${face(hf)} font-size="54" fill="${scene.ink}"${fitAttrs(line, 54, 860, true, hf.width, hf.mono)}>${label}</text>
<text x="${V / 2}" y="976" text-anchor="middle" ${MONO_ATTRS} font-size="22" letter-spacing="3" fill="${scene.muted}">${xmlEscape(APP_NAME.toUpperCase())}</text>
</svg>`;
}

// A 3:2 tag: stripe, build number, name and up to two specs on the left, QR on
// the right. Units: 1500 x 1000. inches: the printed width.
export function tagSvg(matrix, opts = {}) {
  const { title = '', subtitle = '', count = 0, specs = [], serial = '', inches = null } = opts;
  const scene = sceneOf(opts);
  const hf = scene.head;
  const W = 1500;
  const H = 1000;
  const qrSize = W * TAG_QR_SHARE;
  const qx = W - 60 - qrSize;
  const qy = (H - qrSize) / 2;
  const colW = qx - 60 - 50;
  const name = headText(scene, title);
  const wrapped = wrapLines(name, 96, colW, hf, 2);
  const lines = wrapped.length > 1 ? wrapped : [name];
  const size = lines.length > 1 ? 96 : 112;
  const titleY = lines.length > 1 ? [350, 450] : [410];
  const titleSvg = lines.map((l, i) => {
    const t = fitLine(l, 28);
    return `<text x="60" y="${titleY[i]}" ${face(hf)} font-size="${size}" fill="${scene.ink}"${fitAttrs(t, size, colW, true, hf.width, hf.mono)}>${xmlEscape(t)}</text>`;
  }).join('');
  const sub = fitLine(subtitle.toUpperCase(), 40);
  const specSvg = specs.slice(0, 2).map((s, i) => {
    const x = 60 + i * (colW / 2 + 10);
    const v = headText(scene, fitLine(s.value, 14));
    const lab = s.label.toUpperCase();
    const w = colW / 2 - 36; // a clear gap between the two values, italic overhang included
    return `<text x="${x}" y="622" ${MONO_ATTRS} font-size="28" letter-spacing="2" fill="${scene.muted}"${fitAttrs(lab, 28, w, true, 1, true)}>${xmlEscape(lab)}</text>`
      + `<text x="${x}" y="690" ${face(hf)} font-size="62" fill="${scene.accent}"${fitAttrs(v, 62, w, true, hf.width, hf.mono)}>${xmlEscape(v)}</text>`;
  }).join('');
  const label = xmlEscape(fitLine(name, 30));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${sizeAttrs(inches, inches && inches / 1.5)} role="img" aria-label="QR code tag${label ? `: ${label}` : ''}">
<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="56" fill="${scene.bg}" stroke="${scene.line}" stroke-width="10"/>
${stripe(scene, 60, qy, colW, 64)}
${serial ? `<text x="60" y="246" ${MONO_ATTRS} font-size="36" letter-spacing="3" fill="${scene.stamp}">BUILD NO. ${xmlEscape(serial)}</text>` : ''}
${titleSvg}
${sub ? `<text x="60" y="532" ${MONO_ATTRS} font-size="34" fill="${scene.muted}"${fitAttrs(sub, 34, colW, true, 1, true)}>${xmlEscape(sub)}</text>` : ''}
${specSvg}
<text x="60" y="812" ${face(hf)} font-size="46" letter-spacing="2" fill="${scene.accent}"${fitAttrs('SCAN FOR THE FULL BUILD', 46, colW, true, hf.width, hf.mono)}>SCAN FOR THE FULL BUILD</text>
<text x="60" y="${qy + qrSize - 10}" ${MONO_ATTRS} font-size="28" letter-spacing="3" fill="${scene.muted}">${xmlEscape(`${modsLine(count)} · ${APP_NAME.toUpperCase()}`)}</text>
${qrGroup(matrix, qx, qy, qrSize)}
</svg>`;
}

let ringSeq = 0;

// A round slap: the name runs around the ring, the QR sits in the white
// centre. Units: 1000 x 1000. inches: the printed diameter.
export function slapSvg(matrix, opts = {}) {
  const { title = '', count = 0, inches = null } = opts;
  const scene = sceneOf(opts);
  const hf = scene.head;
  const C = 500;
  const ringR = 440;
  const qrSize = 1000 * SLAP_QR_SHARE;
  const name = fitLine(headText(scene, title || 'My build'), 22);
  const bottom = `SCAN THE BUILD · ${modsLine(count)}`;
  const fontSize = 56;
  // Two arcs, both read upright: the name over the top (left to right,
  // clockwise) and the call to scan under the bottom (left to right, the other
  // way round). Glyphs on the top arc rise outward from their baseline and on
  // the bottom arc inward, so the bottom baseline sits nearer the rim.
  const topR = ringR - 18;
  const botR = ringR + 22;
  const arcMax = (r) => Math.PI * r * 0.72; // leave the 3 and 9 o'clock gaps for the dots
  const arcText = (text, id, r) => {
    const max = arcMax(r);
    const fit = estimateWidth(text, fontSize, true, hf.width, hf.mono) + Array.from(text).length * 4 > max
      ? ` textLength="${Math.round(max)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text ${face(hf)} font-size="${fontSize}" letter-spacing="4" fill="${scene.accent}" text-anchor="middle"><textPath href="#${id}" startOffset="50%"${fit}>${xmlEscape(text)}</textPath></text>`;
  };
  const label = xmlEscape(name);
  // The arcs are found by id, so each drawing gets its own: a printed sheet
  // must never point at the hidden on-screen copy.
  const uid = `bt-ring-${++ringSeq}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"${sizeAttrs(inches, inches)} role="img" aria-label="Round QR sticker${label ? `: ${label}` : ''}">
<defs><path id="${uid}-top" d="M ${C - topR} ${C} a ${topR} ${topR} 0 0 1 ${topR * 2} 0" fill="none"/><path id="${uid}-bot" d="M ${C - botR} ${C} a ${botR} ${botR} 0 0 0 ${botR * 2} 0" fill="none"/></defs>
<circle cx="${C}" cy="${C}" r="494" fill="${scene.bg}" stroke="${scene.accent}" stroke-width="10"/>
${arcText(name, `${uid}-top`, topR)}
${arcText(bottom, `${uid}-bot`, botR)}
<circle cx="${C - ringR}" cy="${C}" r="9" fill="${scene.stamp}"/><circle cx="${C + ringR}" cy="${C}" r="9" fill="${scene.stamp}"/>
<circle cx="${C}" cy="${C}" r="400" fill="#fff"/>
${qrGroup(matrix, C - qrSize / 2, C - qrSize / 2, qrSize)}
</svg>`;
}

// A card that stands on the dashboard: 7.5 x 10 inches, fits letter paper with
// half-inch margins. Units are hundredths of an inch.
export function dashCardSvg(matrix, opts = {}) {
  const { title = '', subtitle = '', count = 0, serial = '', inches = true } = opts;
  const scene = sceneOf(opts);
  const hf = scene.head;
  const W = 750;
  const H = 1000;
  const qrSize = CARD_QR_INCHES * 100;
  const tLine = fitLine(headText(scene, title), 26);
  const subLine = fitLine(subtitle, 40);
  const t = xmlEscape(tLine);
  const mods = `${modsLine(count)} · POINT YOUR PHONE CAMERA AT THE CODE`;
  const foot = `${APP_NAME.toUpperCase()}${serial ? ` · BUILD NO. ${serial}` : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${inches ? ' width="7.5in" height="10in"' : ''} role="img" aria-label="Dash card with QR code${t ? `: ${t}` : ''}">
<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="24" fill="${scene.bg}" stroke="${scene.line}" stroke-width="6"/>
${stripe(scene, 28, 22, W - 56, 22)}
<text x="${W / 2}" y="92" text-anchor="middle" ${face(hf)} font-size="42" letter-spacing="3" fill="${scene.accent}"${fitAttrs('SCAN FOR THE FULL BUILD', 42, 670, true, hf.width, hf.mono)}>SCAN FOR THE FULL BUILD</text>
<text x="${W / 2}" y="162" text-anchor="middle" ${face(hf)} font-size="60" fill="${scene.ink}"${fitAttrs(tLine, 60, 670, true, hf.width, hf.mono)}>${t}</text>
<text x="${W / 2}" y="210" text-anchor="middle" ${MONO_ATTRS} font-size="26" fill="${scene.muted}"${fitAttrs(subLine, 26, 670, true, 1, true)}>${xmlEscape(subLine)}</text>
${qrGroup(matrix, (W - qrSize) / 2, 240, qrSize)}
<text x="${W / 2}" y="${240 + qrSize + 48}" text-anchor="middle" ${MONO_ATTRS} font-size="20" letter-spacing="1" fill="${scene.ink}"${fitAttrs(mods, 20, 670, true, 1, true)}>${xmlEscape(mods)}</text>
<text x="${W / 2}" y="${H - 22}" text-anchor="middle" ${MONO_ATTRS} font-size="16" letter-spacing="2" fill="${scene.muted}">${xmlEscape(foot)}</text>
</svg>`;
}

// One call for any shape. inches: the format's width, or null for a preview.
export function shapeSvg(shape, matrix, opts = {}) {
  if (shape === 'tag') return tagSvg(matrix, opts);
  if (shape === 'slap') return slapSvg(matrix, opts);
  if (shape === 'card') return dashCardSvg(matrix, { ...opts, inches: Boolean(opts.inches) });
  return stickerSvg(matrix, opts);
}

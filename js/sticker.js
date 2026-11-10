// What gets printed: a square sticker for the car, or a letter-size dash card
// for big builds whose QR is too dense for a sticker. One SVG serves the screen
// preview, the download for a sticker printer, and home printing at exact size.
import { APP_NAME } from './config.js';
import { QUIET_ZONE, QR_SHARE, CARD_QR_INCHES, qrPath } from './qr.js';

const FONT = 'font-family="Arial, Helvetica, sans-serif"';

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
// better than spilling past the border.
function estimateWidth(text, fontSize, bold) {
  let em = 0;
  for (const ch of text) {
    if (/[A-Z]/.test(ch)) em += 0.74;
    else if (/[a-z]/.test(ch)) em += 0.6;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else if (ch === ' ') em += 0.28;
    else if (ch.codePointAt(0) > 0x2e80) em += 1.0;
    else em += 0.62;
  }
  return em * fontSize * (bold ? 1 : 0.92);
}

// Extra attributes that squeeze a line into maxWidth when it would not fit.
export function fitAttrs(text, fontSize, maxWidth, bold = true) {
  return estimateWidth(text, fontSize, bold) > maxWidth
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
}

function qrGroup(matrix, x, y, size) {
  const n = matrix.length + QUIET_ZONE * 2;
  return `<g transform="translate(${x} ${y}) scale(${size / n})"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(matrix, QUIET_ZONE)}" fill="#000" shape-rendering="crispEdges"/></g>`;
}

// matrix: rows of booleans from qr.moduleMatrix(). inches: printed size, or
// null for a preview that fills its box.
export function stickerSvg(matrix, { title = '', inches = null } = {}) {
  const V = 1000;
  const qrSize = V * QR_SHARE;
  const y = 118;
  const size = inches ? ` width="${inches}in" height="${inches}in"` : '';
  const line = fitLine(title, 30);
  const label = xmlEscape(line);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}"${size} role="img" aria-label="QR code sticker${label ? `: ${label}` : ''}">
<rect x="6" y="6" width="${V - 12}" height="${V - 12}" rx="70" fill="#fff" stroke="#111" stroke-width="12"/>
<text x="${V / 2}" y="92" text-anchor="middle" ${FONT} font-size="54" font-weight="700" letter-spacing="2" fill="#111">SCAN FOR THE FULL BUILD</text>
${qrGroup(matrix, (V - qrSize) / 2, y, qrSize)}
<text x="${V / 2}" y="${y + qrSize + 60}" text-anchor="middle" ${FONT} font-size="48" font-weight="700" fill="#111"${fitAttrs(line, 48, 860)}>${label}</text>
<text x="${V / 2}" y="978" text-anchor="middle" ${FONT} font-size="24" fill="#555">${xmlEscape(APP_NAME)}</text>
</svg>`;
}

// A card that stands on the dashboard: 7.5 x 10 inches, fits letter paper with
// half-inch margins. Units are hundredths of an inch.
export function dashCardSvg(matrix, { title = '', subtitle = '', count = 0, inches = true } = {}) {
  const W = 750;
  const H = 1000;
  const qrSize = CARD_QR_INCHES * 100;
  const size = inches ? ' width="7.5in" height="10in"' : '';
  const tLine = fitLine(title, 26);
  const subLine = fitLine(subtitle, 40);
  const t = xmlEscape(tLine);
  const sub = xmlEscape(subLine);
  const mods = `${count} ${count === 1 ? 'mod' : 'mods'} · point your phone camera at the code`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${size} role="img" aria-label="Dash card with QR code${t ? `: ${t}` : ''}">
<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="24" fill="#fff" stroke="#111" stroke-width="6"/>
<text x="${W / 2}" y="78" text-anchor="middle" ${FONT} font-size="40" font-weight="700" letter-spacing="3" fill="#111">SCAN FOR THE FULL BUILD</text>
<text x="${W / 2}" y="158" text-anchor="middle" ${FONT} font-size="58" font-weight="700" fill="#111"${fitAttrs(tLine, 58, 670)}>${t}</text>
<text x="${W / 2}" y="208" text-anchor="middle" ${FONT} font-size="30" fill="#333"${fitAttrs(subLine, 30, 670, false)}>${sub}</text>
${qrGroup(matrix, (W - qrSize) / 2, 240, qrSize)}
<text x="${W / 2}" y="${240 + qrSize + 48}" text-anchor="middle" ${FONT} font-size="24" fill="#333">${xmlEscape(mods)}</text>
<text x="${W / 2}" y="${H - 22}" text-anchor="middle" ${FONT} font-size="18" fill="#666">${xmlEscape(APP_NAME)}</text>
</svg>`;
}

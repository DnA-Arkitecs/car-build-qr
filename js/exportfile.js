// Files the owner downloads: an SVG for a sticker printer and a PNG. Both
// carry the style's fonts inside them (as data, from this site's own font
// files), so a print shop's computer draws the same letters the owner saw.
//
// The fonts go in a style element INSIDE the downloaded file only. Nothing here
// is ever added to the page itself: the page's security policy refuses inline
// styles, and the on-screen previews use the page's own font files instead.
import { FONT_FILES } from './config.js';

const cache = new Map();

async function fontData(key) {
  if (!cache.has(key)) {
    const path = FONT_FILES[key];
    cache.set(key, (async () => {
      const res = await fetch(new URL(`../${path}`, import.meta.url));
      if (!res.ok) throw new Error(`font ${path}: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    })().catch((e) => {
      cache.delete(key);
      throw e;
    }));
  }
  return cache.get(key);
}

// Returns the SVG with its fonts embedded. If a font cannot be read (offline,
// say), the file still downloads and falls back to the fonts the computer has.
export async function withFonts(svgMarkup, fontKeys) {
  const rules = [];
  for (const key of fontKeys) {
    try {
      const [family, weight, style] = key.split('|');
      rules.push(`@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${await fontData(key)}) format('woff2')}`);
    } catch {
      // keep going without this one
    }
  }
  if (!rules.length) return svgMarkup;
  const open = svgMarkup.indexOf('>') + 1;
  return `${svgMarkup.slice(0, open)}<defs><style>${rules.join('')}</style></defs>${svgMarkup.slice(open)}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Draws an SVG (with its fonts embedded) onto a canvas and returns a PNG.
// width/height in pixels.
export async function svgToPngBlob(svgMarkup, width, height = width) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    if (img.decode) await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Safari can draw an SVG before its embedded fonts are ready, so draw,
    // give the fonts a moment, and draw again.
    for (const pause of [0, 120]) {
      if (pause) await wait(pause);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
    }
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

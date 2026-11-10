// The story share card: a 1080 x 1920 picture of the build in its style, with
// the specs, the top mods and the QR, drawn on the phone (nothing is sent
// anywhere). Owners post it to an Instagram or TikTok story; the QR and the
// link in the caption open the full build.
import { APP_NAME, MONO, SPEC_KINDS, sceneById } from './config.js';
import { buildTitle, vehicleLine, buildNumber, groupMods } from './model.js';
import { QUIET_ZONE } from './qr.js';

export const STORY_W = 1080;
export const STORY_H = 1920;
// Instagram and TikTok cover about the top and bottom 250 pixels of a story
// with their own buttons, so everything that matters sits between these.
const SAFE_TOP = 270;
const SAFE_BOTTOM = STORY_H - 250;
const X = 80;
const INNER = STORY_W - X * 2;

const FALLBACK = {
  'Barlow Condensed': '"Arial Narrow", Arial, sans-serif',
  'Chakra Petch': 'Arial, sans-serif',
  'Courier Prime': '"Courier New", monospace',
  'IBM Plex Mono': 'Consolas, "Courier New", monospace',
};
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function font(f, size) {
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${size}px "${f.family}", ${FALLBACK[f.family] || 'sans-serif'}`;
}

function bodyFont(scene, size) {
  return scene.head.mono ? `400 ${size}px "Courier Prime", "Courier New", monospace` : `600 ${size}px ${BODY}`;
}

// Shrinks the font until the text fits, then cuts it with "…" if it still does not.
function fitText(ctx, text, maxWidth, fontAt, size, minSize) {
  let s = size;
  ctx.font = fontAt(s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = fontAt(s);
  }
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
  return `${chars.join('').trim()}…`;
}

function wrapTwo(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (first && ctx.measureText(next).width > maxWidth) break;
    first = next;
  }
  const rest = words.slice(i).join(' ');
  return rest ? [first, rest] : [first];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStripe(ctx, scene, x, y, w, h) {
  ctx.save();
  if (scene.stripe === 'hazard') {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = scene.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = scene.accent;
    const step = h * 1.1;
    for (let sx = x - h; sx < x + w + h; sx += step * 2) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
      ctx.lineTo(sx + h + step, y);
      ctx.lineTo(sx + step, y + h);
      ctx.closePath();
      ctx.fill();
    }
  } else if (scene.stripe === 'bands') {
    scene.bands.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y + (i * h) / 3, w, h / 3);
    });
  } else if (scene.stripe === 'rule') {
    ctx.fillStyle = scene.ink;
    ctx.fillRect(x, y + h * 0.15, w, h * 0.2);
    ctx.fillRect(x, y + h * 0.6, w, h * 0.1);
  } else {
    ctx.fillStyle = scene.accent;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = scene.bg;
    for (let mx = x + h * 0.7; mx + h * 0.7 < x + w; mx += h * 1.7) ctx.fillRect(mx, y + h * 0.3, h * 0.7, h * 0.4);
  }
  ctx.restore();
}

function drawTexture(ctx, scene) {
  ctx.save();
  if (scene.id === 'sheet') {
    ctx.strokeStyle = scene.line;
    ctx.lineWidth = 2;
    for (let y = 96; y < STORY_H; y += 56) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(STORY_W, y);
      ctx.stroke();
    }
  } else if (scene.id === 'trail') {
    ctx.strokeStyle = scene.line;
    ctx.lineWidth = 3;
    for (const [cx, cy] of [[930, 330], [140, 1560]]) {
      for (let r = 40; r < 520; r += 46) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.3, r, 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (scene.id === 'night') {
    for (const [cx, cy, c] of [[940, 220, scene.bands[0]], [120, 1700, scene.bands[2]]]) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 700);
      g.addColorStop(0, `${c}40`);
      g.addColorStop(1, `${c}00`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STORY_W, STORY_H);
    }
  }
  ctx.restore();
}

// What goes in the four number boxes: the owner's specs first, then counts.
export function storyNumbers(build) {
  const out = build.specs.map((s) => ({ label: SPEC_KINDS[s.kind].name, value: s.value }));
  out.push({ label: 'Mods', value: String(build.mods.length) });
  if (build.year) out.push({ label: 'Year', value: build.year });
  out.push({ label: 'Systems', value: String(groupMods(build.mods).length) });
  return out.slice(0, 4);
}

export async function loadStoryFonts(scene) {
  if (!document.fonts || !document.fonts.load) return;
  const faces = [font(scene.head, 80), font(MONO, 40)];
  if (scene.head.mono) faces.push(bodyFont(scene, 40));
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f, 'BUILD 0123 Aa')));
  } catch {
    // draw with the fallback fonts
  }
}

// The QR on white, crisp: whole pixels per square, the 4-square border inside.
function drawQr(ctx, matrix, qx, qy, px, side) {
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, qx - 8, qy - 8, side + 16, side + 16, 18);
  ctx.fill();
  ctx.fillStyle = '#000000';
  matrix.forEach((row, r) => row.forEach((dark, col) => {
    if (dark) ctx.fillRect(qx + (col + QUIET_ZONE) * px, qy + (r + QUIET_ZONE) * px, px, px);
  }));
}

// Draws the card and returns the canvas. matrix: rows of booleans from qr.moduleMatrix().
export async function drawStoryCard(build, matrix, { canvas } = {}) {
  const scene = sceneById(build.scene);
  await loadStoryFonts(scene);
  const c = canvas || document.createElement('canvas');
  c.width = STORY_W;
  c.height = STORY_H;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = scene.bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  drawTexture(ctx, scene);
  drawStripe(ctx, scene, 0, 0, STORY_W, 44);
  drawStripe(ctx, scene, 0, STORY_H - 44, STORY_W, 44);

  const upper = (s) => (scene.head.upper ? s.toUpperCase() : s);
  let y = SAFE_TOP + 30;

  // kicker and stamp
  ctx.font = font(MONO, 32);
  ctx.fillStyle = scene.muted;
  ctx.textAlign = 'left';
  ctx.fillText(build.type === 'moto' ? 'BIKE BUILD' : 'CAR BUILD', X, y);
  const stamp = `BUILD NO. ${buildNumber(build)}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = scene.stamp;
  ctx.fillText(stamp, STORY_W - X, y);
  ctx.textAlign = 'left';

  // title, up to two lines
  const title = upper(buildTitle(build));
  ctx.font = font(scene.head, 120);
  let lines = wrapTwo(ctx, title, INNER);
  if (lines.length > 1) ctx.font = font(scene.head, 104);
  lines = wrapTwo(ctx, title, INNER);
  const size = lines.length > 1 ? 104 : 120;
  ctx.fillStyle = scene.ink;
  for (const line of lines) {
    y += size;
    const t = fitText(ctx, line, INNER, (s) => font(scene.head, s), size, 64);
    ctx.fillText(t, X, y);
    ctx.font = font(scene.head, size);
  }

  // vehicle line
  const vehicle = build.nickname ? vehicleLine(build) : '';
  if (vehicle) {
    y += 64;
    ctx.fillStyle = scene.muted;
    ctx.fillText(fitText(ctx, vehicle.toUpperCase(), INNER, (s) => font(MONO, s), 38, 26), X, y);
  }

  // tags as pills
  if (build.tags.length) {
    y += 40;
    let px = X;
    ctx.font = font(MONO, 28);
    for (const tag of build.tags.slice(0, 4)) {
      const t = fitText(ctx, tag.toUpperCase(), 300, (s) => font(MONO, s), 28, 22);
      const w = ctx.measureText(t).width + 40;
      if (px + w > STORY_W - X) break;
      ctx.strokeStyle = scene.accent;
      ctx.lineWidth = 3;
      roundRect(ctx, px, y, w, 52, 26);
      ctx.stroke();
      ctx.fillStyle = scene.accent;
      ctx.fillText(t, px + 20, y + 36);
      px += w + 14;
    }
    y += 52;
  }

  // The QR has to survive a story app's compression and a scan off another
  // screen, so every square is drawn at least 4 whole pixels wide. Most builds
  // fit beside the text at up to 520 px; a dense one gets a wide QR under the
  // header and gives up the mod list, then (if still needed) the number boxes.
  const n = matrix.length + QUIET_ZONE * 2;
  const MIN_PX = 4;
  const SIDE_MAX = 520;
  const CAPTION_H = 130;
  const BOX_ROW = 136 + 20;
  let boxRows = 2;
  let wide = Math.floor(SIDE_MAX / n) < MIN_PX;
  if (wide) {
    const pxWith = (rows) => Math.min(Math.floor(INNER / n), Math.floor((SAFE_BOTTOM - (y + 40 + rows * BOX_ROW + 30 + CAPTION_H)) / n));
    boxRows = pxWith(2) >= MIN_PX ? 2 : pxWith(1) >= MIN_PX ? 1 : 0;
  }

  // the number boxes
  y += 40;
  const nums = storyNumbers(build).slice(0, boxRows * 2);
  const boxW = (INNER - 24) / 2;
  const boxH = 136;
  nums.forEach((n, i) => {
    const bx = X + (i % 2) * (boxW + 24);
    const by = y + Math.floor(i / 2) * (boxH + 20);
    ctx.fillStyle = scene.surface;
    roundRect(ctx, bx, by, boxW, boxH, 18);
    ctx.fill();
    ctx.strokeStyle = scene.line;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = scene.muted;
    ctx.fillText(fitText(ctx, n.label.toUpperCase(), boxW - 48, (s) => font(MONO, s), 26, 20), bx + 24, by + 44);
    ctx.fillStyle = scene.accent;
    ctx.fillText(fitText(ctx, upper(n.value), boxW - 48, (s) => font(scene.head, s), 64, 36), bx + 24, by + 112);
  });
  y += Math.ceil(nums.length / 2) * (boxH + 20) + 30;
  const count = build.mods.length;
  const modsText = `${count} ${count === 1 ? 'MOD' : 'MODS'}`;

  if (wide) {
    const px = Math.max(1, Math.min(Math.floor(INNER / n), Math.floor((SAFE_BOTTOM - y - CAPTION_H) / n)));
    const side = px * n;
    const qx = Math.round((STORY_W - side) / 2);
    const qy = SAFE_BOTTOM - side;
    ctx.fillStyle = scene.accent;
    ctx.fillText(fitText(ctx, upper('Scan the full build'), INNER, (s) => font(scene.head, s), 60, 30), X, qy - 76);
    ctx.fillStyle = scene.muted;
    const sub = [`THE BUILD · ${modsText}`, build.owner].filter(Boolean).join(' · ');
    ctx.fillText(fitText(ctx, sub, INNER, (s) => font(MONO, s), 30, 18), X, qy - 30);
    drawQr(ctx, matrix, qx, qy, px, side);
    ctx.font = font(MONO, 24);
    ctx.fillStyle = scene.muted;
    ctx.fillText('No app. No account. No plate, VIN or location shown.', X, SAFE_BOTTOM + 90);
    return c;
  }

  const px = Math.floor(SIDE_MAX / n);
  const side = px * n;
  const qx = X;
  const qy = SAFE_BOTTOM - side;

  // the top mods, numbered, as many as fit above the QR
  const qrTop = qy;
  const rowH = 54;
  ctx.fillStyle = scene.muted;
  ctx.font = font(MONO, 28);
  y += 20;
  ctx.fillText(`THE BUILD · ${modsText}`, X, y);
  const room = Math.max(0, Math.floor((qrTop - 40 - y) / rowH));
  const shown = build.mods.slice(0, count > room ? Math.max(0, room - 1) : count);
  shown.forEach((m, i) => {
    y += rowH;
    ctx.fillStyle = scene.accent;
    ctx.font = font(MONO, 34);
    ctx.fillText(String(i + 1).padStart(2, '0'), X, y);
    ctx.fillStyle = scene.ink;
    const name = [m.brand, m.part].filter(Boolean).join(' ') || m.partNumber;
    ctx.fillText(fitText(ctx, name, INNER - 90, (s) => bodyFont(scene, s), 38, 28), X + 90, y);
  });
  if (count > shown.length && room > 0) {
    y += rowH;
    ctx.fillStyle = scene.muted;
    ctx.font = font(MONO, 30);
    ctx.fillText(`+ ${count - shown.length} more on the scan page`, X + 90, y);
  }

  drawQr(ctx, matrix, qx, qy, px, side);

  // beside the QR
  const tx = qx + side + 48;
  const tw = STORY_W - X - tx;
  ctx.fillStyle = scene.accent;
  ctx.fillText(fitText(ctx, upper('Scan the full build'), tw, (s) => font(scene.head, s), 60, 30), tx, qy + 70);
  if (build.owner) {
    ctx.fillStyle = scene.ink;
    ctx.fillText(fitText(ctx, build.owner, tw, (s) => font(MONO, s), 36, 22), tx, qy + 136);
  }
  ctx.fillStyle = scene.muted;
  ctx.fillText(fitText(ctx, 'No app. No account.', tw, (s) => font(MONO, s), 28, 18), tx, qy + 190);
  ctx.fillText(fitText(ctx, APP_NAME.toUpperCase(), tw, (s) => font(MONO, s), 26, 18), tx, qy + side - 6);
  ctx.font = font(MONO, 24);
  ctx.fillText('No plate, VIN or location shown.', X, SAFE_BOTTOM + 90);
  return c;
}

export async function storyCardBlob(build, matrix) {
  const c = await drawStoryCard(build, matrix);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

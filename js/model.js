// The build: what an owner enters, cleaned the same way whether it comes from
// the form, a backup file, or a link a stranger scanned.
import { LIMITS, CATEGORIES, OTHER_CATEGORY } from './config.js';

// Control characters, direction overrides and non-characters. The zero-width
// joiners (U+200C, U+200D) stay: emoji sequences and many scripts need them.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁦-⁩￾￿]/g;

// Drops half of a surrogate pair left on its own (it breaks XML and SVG).
function dropLoneSurrogates(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
    } else if (c < 0xdc00 || c > 0xdfff) {
      out += s[i];
    }
  }
  return out;
}

export function cleanText(value, max, { multiline = false } = {}) {
  if (value === null || value === undefined) return '';
  let s = dropLoneSurrogates(String(value)).replace(CONTROL, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/[\r\n\t]+/g, ' ');
  s = s.trim();
  // Cut by code points so an emoji is never split in half.
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

// Only plain web links become clickable. Anything else (javascript:, data:, a
// bare word) is dropped.
export function cleanLink(value) {
  // A link cut short is a wrong link, so an over-long one is dropped, not trimmed.
  const s = cleanText(value, LIMITS.link + 1);
  if (!s || s.length > LIMITS.link) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (!url.hostname.includes('.')) return '';
  if (url.username || url.password) return ''; // user:pass@host hides the real site
  const out = url.href;
  return out.length > LIMITS.link ? '' : out;
}

export function cleanCategory(value) {
  const n = typeof value === 'number' ? value : CATEGORIES.indexOf(value);
  return Number.isInteger(n) && n >= 0 && n < CATEGORIES.length ? n : OTHER_CATEGORY;
}

export function emptyBuild() {
  return {
    type: 'car',
    year: '',
    make: '',
    model: '',
    trim: '',
    nickname: '',
    owner: '',
    about: '',
    updated: '',
    mods: [],
  };
}

export function emptyMod() {
  return { category: OTHER_CATEGORY, brand: '', part: '', partNumber: '', link: '', notes: '' };
}

export function normalizeMod(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    category: cleanCategory(m.category),
    brand: cleanText(m.brand, LIMITS.brand),
    part: cleanText(m.part, LIMITS.part),
    partNumber: cleanText(m.partNumber, LIMITS.partNumber),
    link: cleanLink(m.link),
    notes: cleanText(m.notes, LIMITS.notes),
  };
}

export function modIsEmpty(m) {
  return !m.brand && !m.part && !m.partNumber;
}

export function normalizeBuild(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const mods = Array.isArray(b.mods) ? b.mods : [];
  const updated = validDate(b.updated) ? b.updated : '';
  return {
    type: b.type === 'moto' ? 'moto' : 'car',
    year: cleanText(b.year, 20).replace(/\D/g, '').slice(0, LIMITS.year),
    make: cleanText(b.make, LIMITS.make),
    model: cleanText(b.model, LIMITS.model),
    trim: cleanText(b.trim, LIMITS.trim),
    nickname: cleanText(b.nickname, LIMITS.nickname),
    owner: cleanText(b.owner, LIMITS.owner),
    about: cleanText(b.about, LIMITS.about, { multiline: true }),
    updated,
    mods: mods.slice(0, LIMITS.mods * 2).map(normalizeMod).filter((m) => !modIsEmpty(m)).slice(0, LIMITS.mods),
  };
}

export function vehicleLine(b) {
  return [b.year, b.make, b.model, b.trim].filter(Boolean).join(' ');
}

export function buildTitle(b) {
  return b.nickname || vehicleLine(b) || (b.type === 'moto' ? 'My bike' : 'My car');
}

// Groups mods by category in the category list's order, keeping the owner's
// order inside each group.
export function groupMods(mods) {
  const groups = new Map();
  for (const m of mods) {
    if (!groups.has(m.category)) groups.set(m.category, []);
    groups.get(m.category).push(m);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([category, items]) => ({ category, name: CATEGORIES[category], items }));
}

export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

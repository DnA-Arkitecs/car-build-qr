// One place for the app's name and limits, so renaming the app is a one-line change.
export const APP_NAME = 'Build Tag';
export const TAGLINE = 'Your car\'s mod list, one scan away.';

// Where the scan page lives on the web. Inside the Android app the page runs
// from the app itself, an address no other phone can open, so the app's QR
// codes point here instead.
export const PUBLIC_URL = 'https://dna-arkitecs.github.io/car-build-qr/';

// Payload format version. Bump it (and keep a decoder for the old one) if the
// field list or a list below ever changes order. Version 2 of the app added
// optional keys only (style, specs, tags), so links stay on format '1' and
// every sticker printed before still opens.
export const FORMAT_VERSION = '1';

export const LIMITS = {
  mods: 60,
  year: 4,
  make: 30,
  model: 40,
  trim: 30,
  nickname: 40,
  owner: 40,
  about: 280,
  brand: 40,
  part: 80,
  partNumber: 40,
  link: 300,
  notes: 140,
  specs: 4,
  specValue: 20,
  specNote: 80,
  tags: 6,
  tag: 20,
  paste: 6000,
};

// Append only. The index of each category is what the link stores.
export const CATEGORIES = [
  'Engine',
  'Intake',
  'Exhaust',
  'Forced induction',
  'Tune / ECU',
  'Fuel',
  'Cooling',
  'Drivetrain',
  'Suspension',
  'Brakes',
  'Wheels & tires',
  'Aero & body',
  'Lighting',
  'Interior',
  'Audio & electronics',
  'Paint & wrap',
  'Other',
];
export const OTHER_CATEGORY = CATEGORIES.length - 1;

// Short codes printed on the category chips, in the same order as CATEGORIES.
export const CATEGORY_CODES = [
  'ENG', 'INT', 'EXH', 'F/I', 'ECU', 'FUL', 'CLG', 'DRV', 'SUS', 'BRK', 'WHL', 'AER', 'LGT', 'CAB', 'A/V', 'PNT', 'OTH',
];

// Append only: the link stores the index. Each has an example value for the form.
export const SPEC_KINDS = [
  { name: 'Power', example: '350 whp' },
  { name: 'Torque', example: '330 wtq' },
  { name: 'Weight', example: '3,100 lb' },
  { name: '0-60', example: '4.2 s' },
  { name: 'Quarter mile', example: '12.1 s @ 114' },
  { name: 'Lap time', example: '1:32.4' },
  { name: 'Wheels', example: '18x9.5 +38' },
  { name: 'Tires', example: '265/35R18' },
  { name: 'Lift', example: '3 in' },
  { name: 'Engine', example: 'EJ257' },
  { name: 'Drivetrain', example: 'AWD 6MT' },
  { name: 'Paint code', example: 'WR Blue 02C' },
  { name: 'Spec', example: '' },
];

// Scene styles. Append only: the link stores the index (0, the default, is not
// stored at all, so a v0.1 link opens in the first style). sticker.js and
// storycard.js draw with these colours; css/style.css carries the same values.
const HEAD_CONDENSED = { family: 'Barlow Condensed', weight: 800, style: 'normal', width: 0.78, upper: true };
export const SCENES = [
  {
    id: 'tech', name: 'Tech card', blurb: 'Graphite, hazard yellow, stamp red',
    bg: '#141619', surface: '#1c1f23', ink: '#f2f2ee', muted: '#9aa1a9', line: '#2d3137',
    accent: '#ffd21f', accentInk: '#141619', stamp: '#e5392f', stripe: 'hazard',
    head: HEAD_CONDENSED,
  },
  {
    id: 'night', name: 'Night meet', blurb: 'Navy, neon three-band stripe',
    bg: '#0c0e1a', surface: '#141832', ink: '#eef0ff', muted: '#9aa0c8', line: '#262b52',
    accent: '#ff3d7f', accentInk: '#0c0e1a', stamp: '#36d1ff', stripe: 'bands',
    bands: ['#ff3d7f', '#9b5cff', '#36d1ff'],
    head: { family: 'Chakra Petch', weight: 700, style: 'italic', width: 1.0, upper: true },
  },
  {
    id: 'sheet', name: 'Build sheet', blurb: 'Typed paper, red stamp, for classics',
    bg: '#e9e7e1', surface: '#f4f3ef', ink: '#1c1b19', muted: '#5e5a52', line: '#c9c4b8',
    accent: '#1f4e8c', accentInk: '#ffffff', stamp: '#b3261e', stripe: 'rule',
    head: { family: 'Courier Prime', weight: 700, style: 'normal', width: 1.0, upper: false, mono: true },
  },
  {
    id: 'trail', name: 'Trail', blurb: 'Olive, safety orange, contour lines',
    bg: '#24261f', surface: '#2f3229', ink: '#efeadb', muted: '#a9a58f', line: '#444839',
    accent: '#ff7a1a', accentInk: '#24261f', stamp: '#c8d94a', stripe: 'contour',
    head: HEAD_CONDENSED,
  },
];
export const SCENE_IDS = SCENES.map((s) => s.id);

export function sceneById(id) {
  return SCENES.find((s) => s.id === id) || SCENES[0];
}

// Numbers and part numbers on stickers and the share card.
export const MONO = { family: 'IBM Plex Mono', weight: 600, style: 'normal' };

// The font files each face loads from (the page's stylesheet names the same
// files). Downloaded stickers carry the ones they use, so they look the same
// on a computer that does not have the fonts.
export const FONT_FILES = {
  'Barlow Condensed|800|normal': 'fonts/barlow-condensed-latin-800-normal.woff2',
  'IBM Plex Mono|600|normal': 'fonts/ibm-plex-mono-latin-600-normal.woff2',
  'Chakra Petch|700|italic': 'fonts/chakra-petch-latin-700-italic.woff2',
  'Courier Prime|400|normal': 'fonts/courier-prime-latin-400-normal.woff2',
  'Courier Prime|700|normal': 'fonts/courier-prime-latin-700-normal.woff2',
};

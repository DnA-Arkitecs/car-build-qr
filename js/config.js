// One place for the app's name and limits, so renaming the app is a one-line change.
export const APP_NAME = 'Build Tag';
export const TAGLINE = 'Your car\'s mod list, one scan away.';

// Where the scan page lives on the web. Inside the Android app the page runs
// from the app itself, an address no other phone can open, so the app's QR
// codes point here instead.
export const PUBLIC_URL = 'https://dna-arkitecs.github.io/car-build-qr/';

// Payload format version. Bump it (and keep a decoder for the old one) if the
// field list or the category list ever changes order.
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

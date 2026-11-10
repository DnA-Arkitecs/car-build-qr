import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const qrcode = require('../vendor/qrcode.js');
export const jsQR = require('jsqr');

export const BASE = 'https://example.github.io/car-build-qr/';

// A realistic, fairly long build: 25 mods with part numbers and short notes.
export function realisticBuild() {
  const parts = [
    [0, 'IAG', 'Closed deck short block', 'IAG-ENG-1003', '2.5L, built for 500 hp'],
    [1, 'Cobb', 'SF intake + airbox', '745100', ''],
    [2, 'Invidia', 'Q300 cat-back', 'HS15SSTGTC', 'Titanium tips'],
    [2, 'Grimmspeed', 'Catted J-pipe', '007045', ''],
    [3, 'Blouch', 'Dominator 1.5XTR turbo', 'BLO-DX-15XTR', ''],
    [4, 'Cobb', 'Accessport V3', 'AP3-SUB-004', 'E85 flex tune by a local tuner'],
    [5, 'DeatschWerks', 'DW300C fuel pump', '9-305-1035', ''],
    [5, 'Injector Dynamics', 'ID1050x injectors', '1050.60.14.14.4', ''],
    [6, 'Mishimoto', 'Aluminum radiator', 'MMRAD-STI-08', ''],
    [6, 'Killer B', 'Oil pan + pickup', 'KB-OP-EJ', ''],
    [7, 'Exedy', 'Stage 1 organic clutch', '15803HD', ''],
    [7, 'Kartboy', 'Short shifter', 'KB-010-STI', ''],
    [8, 'KW', 'V3 coilovers', '35267005', 'Set 1 inch below stock'],
    [8, 'Whiteline', 'Rear sway bar 24mm', 'BSR53Z', ''],
    [8, 'Perrin', 'Front strut brace', 'PSP-SUS-055', ''],
    [9, 'Brembo', 'GT 6-piston front kit', '1N2.9010A', ''],
    [9, 'Hawk', 'HPS 5.0 pads', 'HB453B.585', ''],
    [10, 'Enkei', 'RPF1 18x9.5 +38', '3798956538SP', 'Silver'],
    [10, 'Michelin', 'Pilot Sport 4S 265/35', '', ''],
    [11, 'APR', 'GTC-300 wing', 'AS-106772', ''],
    [11, 'Seibon', 'Carbon hood', 'HD1517SBIMPSTI-OE', ''],
    [12, 'Morimoto', 'XB LED headlights', 'LF471', ''],
    [13, 'Recaro', 'Sportster CS seats', '410.00.2575', 'Pair'],
    [14, 'AEM', 'X-Series wideband', '30-0300', ''],
    [15, '3M', '2080 satin black wrap', '', 'Roof only'],
  ];
  return realisticFrom(parts);
}

// The same 25 mods, each with an owner's shop link: the worst realistic case.
export function realisticBuildWithLinks() {
  const b = realisticBuild();
  b.mods = b.mods.map((m, i) => ({ ...m, link: `https://www.example-parts.com/p/${m.partNumber || `item-${i}`}` }));
  return b;
}

function realisticFrom(parts) {
  return {
    type: 'car',
    year: '2019',
    make: 'Subaru',
    model: 'WRX STI',
    trim: 'Limited',
    nickname: 'Blue Thunder',
    owner: '@example_owner',
    about: 'Daily driven, weekend track car.',
    updated: '2026-11-09',
    mods: parts.map(([category, brand, part, partNumber, notes]) => ({ category, brand, part, partNumber, link: '', notes })),
  };
}

// Draws a module matrix to an RGBA buffer the way a phone camera would see a
// clean print, then runs a real QR decoder over it.
export function scanMatrix(matrix, scale = 4, quiet = 4) {
  const n = matrix.length + quiet * 2;
  const size = n * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (!matrix[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        }
      }
    }
  }
  const result = jsQR(data, size, size);
  return result ? result.data : null;
}

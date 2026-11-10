// Runs a real QR decoder over raw RGBA pixels the end-to-end test captured from
// the browser. Usage: node test/scan-rgba.mjs <file.rgba> <width> <height>
import { readFileSync } from 'node:fs';
import { jsQR } from './fixtures.mjs';

const [file, w, h] = process.argv.slice(2);
const data = new Uint8ClampedArray(readFileSync(file));
const result = jsQR(data, Number(w), Number(h));
process.stdout.write(result ? result.data : '');
process.exit(result ? 0 : 1);

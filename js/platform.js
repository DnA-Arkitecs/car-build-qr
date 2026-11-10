// The page runs in a browser or inside the Android app (android/). The app adds
// window.BuildTagApp, because a phone's WebView cannot download a blob, print,
// or always reach the clipboard on its own. In a browser this module falls
// back to the normal web calls, so the page works the same either way.
import { PUBLIC_URL } from './config.js';

function bridge() {
  return typeof window !== 'undefined' && window.BuildTagApp ? window.BuildTagApp : null;
}

export function inApp() {
  return Boolean(bridge());
}

// The address the QR and "Copy link" use: this page's own address on the web,
// the public site inside the app.
export function shareBase(localBase) {
  return inApp() ? PUBLIC_URL : localBase;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Returns true when the app saved the file; false means the caller downloads it.
export async function saveFile(filename, blob) {
  const app = bridge();
  if (!app) return false;
  const result = app.saveFile(filename, blob.type, await toBase64(blob));
  if (result !== 'ok') alert(`Could not save the file: ${result}`);
  return true;
}

export function printPage() {
  const app = bridge();
  if (app) app.print(document.title);
  else window.print();
}

export async function copyText(text) {
  const app = bridge();
  if (app) {
    if (!app.copyText(text)) throw new Error('copy failed');
    return;
  }
  await navigator.clipboard.writeText(text);
}

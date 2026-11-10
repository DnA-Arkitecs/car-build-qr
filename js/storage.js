// The owner's build, kept in this browser only. Small on purpose: the scan
// page needs it for "edit a copy" without loading the whole editor.
import { normalizeBuild } from './model.js';

export const STORAGE_KEY = 'buildtag.build.v1';
const SHAPE_KEY = 'buildtag.shape';

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeBuild(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocal(build) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
    return true;
  } catch {
    return false;
  }
}

// Which sticker shape the owner last picked: a convenience, not part of the build.
export function loadShape() {
  try {
    return localStorage.getItem(SHAPE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveShape(id) {
  try {
    localStorage.setItem(SHAPE_KEY, id);
  } catch {
    // private browsing: the default shape is fine
  }
}

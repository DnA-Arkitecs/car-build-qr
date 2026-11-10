// One page, two modes: a link with a build after "#" shows the build (what a
// scan opens); no build in the link shows the owner's editor.
import { decodeBuild, PayloadError } from './codec.js';
import { renderViewer, renderViewerError } from './viewer.js';
import { renderBuilder, loadSaved, saveLocal } from './builder.js';
import { buildTitle } from './model.js';
import { h, clear } from './elements.js';

const root = document.getElementById('app');
let routeId = 0;

function baseUrl() {
  const u = new URL(window.location.href);
  u.hash = '';
  u.search = '';
  return u.href;
}

async function route() {
  const id = ++routeId;
  const payload = window.location.hash.slice(1);
  document.body.classList.toggle('mode-view', Boolean(payload));
  if (!payload) {
    renderBuilder(root, { baseUrl: baseUrl() });
    return;
  }
  let build;
  try {
    build = await decodeBuild(payload);
  } catch (e) {
    if (id !== routeId) return;
    renderViewerError(root, e instanceof PayloadError ? e.message : 'Something went wrong opening this build.', baseUrl());
    return;
  }
  if (id !== routeId) return; // a newer link opened while this one decoded
  renderViewer(root, build, {
    homeHref: baseUrl(),
    onEditCopy: () => {
      const saved = loadSaved();
      if (saved && saved.mods.length && !confirm(`Replace "${buildTitle(saved)}" saved in this browser with this build?`)) return;
      if (!saveLocal(build)) {
        alert('This browser is not saving data (private browsing?), so the copy cannot be opened for editing here.');
        return;
      }
      window.location.href = baseUrl();
    },
  });
  window.scrollTo(0, 0);
}

// Another site cannot frame this page to trick a tap (the host cannot send a
// frame-blocking header, so the page checks for itself).
if (window.top !== window.self) {
  clear(root).appendChild(h('p', null, h('a', { href: window.location.href, target: '_top' }, 'Open this build')));
} else {
  window.addEventListener('hashchange', route);
  route();
}

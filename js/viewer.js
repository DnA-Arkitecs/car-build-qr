// What someone sees after scanning a sticker: the car and every mod, grouped,
// with the part numbers easy to copy and a link to find each part.
import { APP_NAME } from './config.js';
import { buildTitle, vehicleLine, groupMods } from './model.js';
import { h, clear } from './elements.js';

export function partSearchUrl(mod) {
  const q = [mod.brand, mod.part, mod.partNumber].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// The site a link really goes to, shown beside it so a sticker cannot dress a
// strange site up as a parts link.
export function linkHost(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function copyText(text, button) {
  const done = (label) => {
    const old = button.textContent;
    button.textContent = label;
    setTimeout(() => { button.textContent = old; }, 1400);
  };
  try {
    await navigator.clipboard.writeText(text);
    done('Copied');
  } catch {
    done('Hold to copy');
  }
}

function modCard(mod) {
  const name = [mod.brand, mod.part].filter(Boolean).join(' ');
  return h('li', { class: 'mod' },
    h('div', { class: 'mod-name' }, name || mod.partNumber),
    mod.partNumber && h('div', { class: 'mod-pn' },
      h('span', { class: 'pn-label' }, 'Part #'),
      h('code', { class: 'pn' }, mod.partNumber),
      h('button', { type: 'button', class: 'chip', onClick: (e) => copyText(mod.partNumber, e.currentTarget) }, 'Copy'),
    ),
    mod.notes && h('p', { class: 'mod-notes' }, mod.notes),
    h('div', { class: 'mod-links' },
      h('a', { href: partSearchUrl(mod), target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Find this part'),
      mod.link && h('a', { href: mod.link, target: '_blank', rel: 'noopener noreferrer nofollow' },
        'Owner\'s link ', h('span', { class: 'host' }, `(${linkHost(mod.link)})`)),
    ),
  );
}

// root: element to fill. opts.homeHref: link to make your own. opts.onEditCopy: optional.
export function renderViewer(root, build, opts = {}) {
  clear(root);
  const title = buildTitle(build);
  const line = vehicleLine(build);
  const groups = groupMods(build.mods);
  const count = build.mods.length;
  document.title = `${title} · ${APP_NAME}`;

  root.appendChild(h('article', { class: 'viewer' },
    h('header', { class: 'hero' },
      h('p', { class: 'kicker' }, build.type === 'moto' ? 'Bike build' : 'Car build'),
      h('h1', { id: 'build-title' }, title),
      build.nickname && line && h('p', { class: 'vehicle' }, line),
      build.owner && h('p', { class: 'owner' }, `Owner: ${build.owner}`),
      h('p', { class: 'meta' },
        `${count} ${count === 1 ? 'mod' : 'mods'}`,
        build.updated && ` · Updated ${formatDate(build.updated)}`,
      ),
    ),
    build.about && h('p', { class: 'about' }, build.about),
    count === 0 && h('p', { class: 'empty' }, 'No mods listed yet.'),
    groups.map((g) => h('section', { class: 'group' },
      h('h2', null, g.name, h('span', { class: 'count' }, String(g.items.length))),
      h('ul', { class: 'mods' }, g.items.map(modCard)),
    )),
    h('footer', { class: 'viewer-foot' },
      h('p', null, 'Parts and notes are listed by the owner.'),
      h('a', { class: 'button primary', href: opts.homeHref || './' }, 'Make a build sheet for your car'),
      opts.onEditCopy && h('button', { type: 'button', class: 'button ghost', onClick: opts.onEditCopy }, 'This is my car: edit a copy'),
    ),
  ));
}

export function renderViewerError(root, message, homeHref) {
  clear(root);
  document.title = APP_NAME;
  root.appendChild(h('article', { class: 'viewer' },
    h('header', { class: 'hero' },
      h('p', { class: 'kicker' }, APP_NAME),
      h('h1', null, 'This build could not be opened'),
    ),
    h('p', { class: 'error', role: 'alert' }, message),
    h('footer', { class: 'viewer-foot' },
      h('a', { class: 'button primary', href: homeHref || './' }, 'Make a build sheet for your car'),
    ),
  ));
}

// The owner's side: enter the vehicle, list the mods, get the QR to print.
// Everything stays on the owner's device (browser storage plus a backup file);
// nothing is sent anywhere.
import { APP_NAME, TAGLINE, LIMITS, CATEGORIES } from './config.js';
import { emptyBuild, normalizeBuild, normalizeMod, modIsEmpty, buildTitle, vehicleLine, todayISO } from './model.js';
import { encodeBuild, shareUrl, compressionSupported } from './codec.js';
import { gradeLink, moduleMatrix } from './qr.js';
import { stickerSvg, dashCardSvg } from './sticker.js';
import { h, clear, svgNode } from './elements.js';

export const STORAGE_KEY = 'buildtag.build.v1';

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

const GRADE_TEXT = {
  easy: (g) => `Easy to scan on a ${g.sticker.inches}-inch sticker or bigger.`,
  good: (g) => `Fits a ${g.sticker.inches}-inch sticker; people scan it from close up. The dash card scans from farther away.`,
  card: () => 'Too dense for a sticker. Print the dash card (letter paper) for your dashboard, or shorten notes and links to fit a sticker.',
  'too-big': () => 'Too much for one code. Shorten notes, remove some links, or split the list.',
};

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

function textInput(name, value, { max, placeholder = '', inputmode, autocomplete = 'off' } = {}) {
  return h('input', { name, value, maxLength: max, placeholder, inputmode, autocomplete, spellcheck: 'false' });
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return (s || 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'build';
}

async function svgToPngBlob(svgMarkup, px) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(img, 0, 0, px, px);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// root: element to fill. baseUrl: the page's own address (the QR points here).
export function renderBuilder(root, { baseUrl, initial } = {}) {
  let build = normalizeBuild(initial || loadSaved() || emptyBuild());
  let editing = -1; // index of the mod being edited, -1 when adding
  let current = { url: '', grade: null };
  let timer = null;
  let runId = 0;

  clear(root);
  document.title = `${APP_NAME} · Make your build sheet`;

  // ---------- vehicle ----------
  const typeCar = h('input', { type: 'radio', name: 'type', value: 'car', checked: build.type !== 'moto' });
  const typeMoto = h('input', { type: 'radio', name: 'type', value: 'moto', checked: build.type === 'moto' });
  const v = {
    year: textInput('year', build.year, { max: LIMITS.year, placeholder: '2019', inputmode: 'numeric' }),
    make: textInput('make', build.make, { max: LIMITS.make, placeholder: 'Subaru' }),
    model: textInput('model', build.model, { max: LIMITS.model, placeholder: 'WRX STI' }),
    trim: textInput('trim', build.trim, { max: LIMITS.trim, placeholder: 'Limited' }),
    nickname: textInput('nickname', build.nickname, { max: LIMITS.nickname, placeholder: 'Optional' }),
    owner: textInput('owner', build.owner, { max: LIMITS.owner, placeholder: 'Optional, e.g. your Instagram' }),
    about: h('textarea', { name: 'about', maxLength: LIMITS.about, rows: 3, placeholder: 'Optional: a line about the build' }, build.about),
  };

  // ---------- mod form ----------
  const f = {
    category: h('select', { name: 'category' }, CATEGORIES.map((c, i) => h('option', { value: String(i) }, c))),
    brand: textInput('brand', '', { max: LIMITS.brand, placeholder: 'Invidia' }),
    part: textInput('part', '', { max: LIMITS.part, placeholder: 'Q300 cat-back exhaust' }),
    partNumber: textInput('partNumber', '', { max: LIMITS.partNumber, placeholder: 'Optional' }),
    // No maxLength here: a pasted link cut short would still look valid.
    link: textInput('link', '', { placeholder: 'Optional: where to buy it', inputmode: 'url' }),
    notes: textInput('notes', '', { max: LIMITS.notes, placeholder: 'Optional: size, color, who installed it' }),
  };
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const addButton = h('button', { type: 'submit', class: 'button primary' }, 'Add mod');
  const cancelButton = h('button', { type: 'button', class: 'button ghost', hidden: true, onClick: () => resetForm() }, 'Cancel');
  const modForm = h('form', { class: 'mod-form', onSubmit: onSaveMod, novalidate: true },
    h('div', { class: 'grid' },
      field('Category', f.category),
      field('Brand', f.brand),
      field('Part', f.part),
      field('Part number', f.partNumber),
    ),
    field('Link', f.link),
    field('Notes', f.notes),
    formError,
    h('div', { class: 'row' }, addButton, cancelButton),
  );
  f.category.value = String(CATEGORIES.length - 1);
  modForm.addEventListener('input', () => { formError.textContent = ''; });

  const modList = h('ol', { class: 'mod-list' });
  const modCount = h('span', { class: 'count' });

  // ---------- sticker ----------
  const meter = h('p', { class: 'meter', 'aria-live': 'polite' });
  const preview = h('div', { class: 'sticker-preview' });
  const printArea = h('div', { class: 'print-area', 'aria-hidden': 'true' });
  const saveNote = h('p', { class: 'hint' });
  const actions = {
    open: h('a', { class: 'button primary', target: '_blank', rel: 'noopener', href: '#' }, 'See what people see'),
    copy: h('button', { type: 'button', class: 'button', onClick: onCopyLink }, 'Copy link'),
    svg: h('button', { type: 'button', class: 'button', onClick: onDownloadSvg }, 'Download SVG (for a sticker printer)'),
    png: h('button', { type: 'button', class: 'button', onClick: onDownloadPng }, 'Download PNG'),
  };
  const printButtons = h('div', { class: 'actions print-buttons' });

  // ---------- backup ----------
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onChange: onImport });

  root.appendChild(h('div', { class: 'builder' },
    h('header', { class: 'top' },
      h('h1', null, APP_NAME),
      h('p', { class: 'tagline' }, TAGLINE),
      h('p', { class: 'hint' }, 'List your mods, print the QR, stick it on. At a show, anyone who scans it sees your full build in their phone\'s browser. No app, no account.'),
    ),
    !compressionSupported() && h('p', { class: 'error', role: 'alert' }, 'This browser is too old to make a QR code. Try an up-to-date Chrome, Safari, Edge or Firefox.'),

    h('section', { class: 'card', 'aria-labelledby': 'h-vehicle' },
      h('h2', { id: 'h-vehicle' }, '1. Your vehicle'),
      h('div', { class: 'row type' },
        h('label', { class: 'radio' }, typeCar, ' Car'),
        h('label', { class: 'radio' }, typeMoto, ' Motorcycle'),
      ),
      h('div', { class: 'grid' },
        field('Year', v.year), field('Make', v.make), field('Model', v.model), field('Trim', v.trim),
      ),
      field('Nickname', v.nickname),
      field('Your name or handle', v.owner, 'Shown to people who scan. Leave it blank to stay anonymous.'),
      field('About', v.about),
    ),

    h('section', { class: 'card', 'aria-labelledby': 'h-mods' },
      h('h2', { id: 'h-mods' }, '2. Your mods ', modCount),
      modList,
      modForm,
    ),

    h('section', { class: 'card', 'aria-labelledby': 'h-qr' },
      h('h2', { id: 'h-qr' }, '3. Your QR sticker'),
      meter,
      preview,
      h('div', { class: 'actions' }, Object.values(actions)),
      h('h3', null, 'Print at home'),
      printButtons,
      h('p', { class: 'hint' }, 'Weatherproof vinyl label sheets work for the car; plain paper works for the dash card. Print at 100% size, not "fit to page".'),
      h('p', { class: 'hint' }, 'Added a mod later? Come back, update the list and print a new QR. A printed sticker keeps the list it was made with.'),
    ),

    h('section', { class: 'card small', 'aria-labelledby': 'h-backup' },
      h('h2', { id: 'h-backup' }, 'Keep it safe'),
      h('p', { class: 'hint' }, 'Your build is saved in this browser only. Save a backup file to move it to another phone or computer.'),
      saveNote,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'button', onClick: onExport }, 'Save backup file'),
        h('button', { type: 'button', class: 'button', onClick: () => fileInput.click() }, 'Open backup file'),
        h('button', { type: 'button', class: 'button ghost danger', onClick: onReset }, 'Start over'),
      ),
      fileInput,
    ),
    printArea,
  ));

  // ---------- behaviour ----------
  for (const input of [...Object.values(v), typeCar, typeMoto]) {
    input.addEventListener('input', onVehicleChange);
    input.addEventListener('change', onVehicleChange);
  }

  function onVehicleChange() {
    build = normalizeBuild({
      ...build,
      type: typeMoto.checked ? 'moto' : 'car',
      year: v.year.value, make: v.make.value, model: v.model.value, trim: v.trim.value,
      nickname: v.nickname.value, owner: v.owner.value, about: v.about.value,
    });
    changed();
  }

  function readForm() {
    return normalizeMod({
      category: Number(f.category.value),
      brand: f.brand.value, part: f.part.value, partNumber: f.partNumber.value,
      link: f.link.value, notes: f.notes.value,
    });
  }

  function onSaveMod(e) {
    e.preventDefault();
    formError.textContent = '';
    const mod = readForm();
    if (modIsEmpty(mod)) {
      formError.textContent = 'Add at least a brand, a part or a part number.';
      f.part.focus();
      return;
    }
    if (f.link.value.trim() && !mod.link) {
      formError.textContent = f.link.value.trim().length > LIMITS.link
        ? `That link is too long (${LIMITS.link} characters at most). Use a shorter link to the same part, or clear it.`
        : 'That link does not look like a web address (it should start with https://). Fix it or clear it.';
      f.link.focus();
      return;
    }
    const mods = build.mods.slice();
    if (editing >= 0) mods[editing] = mod;
    else {
      if (mods.length >= LIMITS.mods) {
        formError.textContent = `A build holds up to ${LIMITS.mods} mods.`;
        return;
      }
      mods.push(mod);
    }
    build = { ...build, mods };
    resetForm();
    renderMods();
    changed();
    f.brand.focus();
  }

  function resetForm() {
    editing = -1;
    for (const key of ['brand', 'part', 'partNumber', 'link', 'notes']) f[key].value = '';
    addButton.textContent = 'Add mod';
    cancelButton.hidden = true;
    formError.textContent = '';
  }

  function startEdit(i) {
    const m = build.mods[i];
    editing = i;
    f.category.value = String(m.category);
    for (const key of ['brand', 'part', 'partNumber', 'link', 'notes']) f[key].value = m[key];
    addButton.textContent = 'Save mod';
    cancelButton.hidden = false;
    modForm.scrollIntoView({ block: 'center', behavior: 'smooth' });
    f.brand.focus();
  }

  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= build.mods.length) return;
    const mods = build.mods.slice();
    [mods[i], mods[j]] = [mods[j], mods[i]];
    build = { ...build, mods };
    if (editing === i) editing = j;
    else if (editing === j) editing = i;
    renderMods();
    changed();
  }

  function remove(i) {
    const m = build.mods[i];
    const name = [m.brand, m.part].filter(Boolean).join(' ') || m.partNumber;
    if (!confirm(`Remove "${name}"?`)) return;
    build = { ...build, mods: build.mods.filter((_, k) => k !== i) };
    if (editing === i) resetForm();
    else if (editing > i) editing -= 1;
    renderMods();
    changed();
  }

  function renderMods() {
    clear(modList);
    modCount.textContent = build.mods.length ? String(build.mods.length) : '';
    if (!build.mods.length) {
      modList.appendChild(h('li', { class: 'empty' }, 'No mods yet. Add your first one below.'));
      return;
    }
    build.mods.forEach((m, i) => {
      const name = [m.brand, m.part].filter(Boolean).join(' ') || m.partNumber;
      modList.appendChild(h('li', { class: 'mod-row' },
        h('div', { class: 'mod-text' },
          h('span', { class: 'cat' }, CATEGORIES[m.category]),
          h('span', { class: 'name' }, name),
          m.partNumber && (m.brand || m.part) && h('span', { class: 'pn' }, m.partNumber),
        ),
        h('div', { class: 'mod-tools' },
          h('button', { type: 'button', class: 'icon', 'aria-label': `Move ${name} up`, disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
          h('button', { type: 'button', class: 'icon', 'aria-label': `Move ${name} down`, disabled: i === build.mods.length - 1, onClick: () => move(i, 1) }, '↓'),
          h('button', { type: 'button', class: 'chip', onClick: () => startEdit(i) }, 'Edit'),
          h('button', { type: 'button', class: 'chip danger', onClick: () => remove(i) }, 'Remove'),
        ),
      ));
    });
  }

  function changed() {
    const ok = saveLocal(build);
    saveNote.textContent = ok ? '' : 'This browser is not saving (private mode?). Save a backup file before you close the page.';
    clearTimeout(timer);
    timer = setTimeout(refreshQr, 250);
  }

  async function refreshQr() {
    const id = ++runId;
    const stamped = { ...build, updated: todayISO() };
    let url;
    try {
      url = shareUrl(baseUrl, await encodeBuild(stamped));
    } catch (e) {
      if (id !== runId) return;
      meter.textContent = e.message;
      meter.className = 'meter bad';
      setActions(false);
      return;
    }
    if (id !== runId) return; // a newer edit already started
    if (url === current.url) return; // nothing changed: keep the buttons the owner may be tapping
    const grade = gradeLink(url);
    current = { url, grade, title: buildTitle(build), matrix: grade.ok ? moduleMatrix(grade.qr) : null };
    clear(preview);
    clear(printButtons);
    if (!grade.ok) {
      meter.textContent = GRADE_TEXT['too-big'](grade);
      meter.className = 'meter bad';
      setActions(false);
      return;
    }
    meter.textContent = GRADE_TEXT[grade.level](grade);
    meter.className = `meter ${grade.level}`;
    preview.classList.toggle('card-preview', !grade.sticker);
    preview.appendChild(svgNode(grade.sticker ? currentSvg(null) : currentCard(false)));
    actions.open.href = url;
    setActions(true);
    actions.svg.textContent = grade.sticker ? 'Download SVG (for a sticker printer)' : 'Download dash card SVG';
    actions.png.disabled = !grade.sticker;
    for (const f of grade.formats) {
      const text = f.kind === 'card' ? 'Print dash card' : `Print ${f.inches}-inch sheet (${f.perSheet})`;
      printButtons.appendChild(h('button', {
        type: 'button',
        class: 'button',
        disabled: !f.fits,
        title: f.fits ? null : 'Too dense to scan at this size',
        dataset: { format: f.id },
        onClick: () => onPrint(f),
      }, text));
    }
  }

  function setActions(enabled) {
    for (const el of Object.values(actions)) {
      if (el.tagName === 'A') {
        el.classList.toggle('disabled', !enabled);
        el.setAttribute('aria-disabled', String(!enabled));
        if (!enabled) el.removeAttribute('href');
      } else {
        el.disabled = !enabled;
      }
    }
  }

  function currentSvg(inches) {
    return stickerSvg(current.matrix, { title: current.title, inches });
  }

  function currentCard(inches = true) {
    return dashCardSvg(current.matrix, {
      title: current.title,
      subtitle: build.nickname ? vehicleLine(build) : '',
      count: build.mods.length,
      inches,
    });
  }

  async function onCopyLink(e) {
    const button = e.currentTarget;
    try {
      await navigator.clipboard.writeText(current.url);
      button.textContent = 'Link copied';
    } catch {
      prompt('Copy this link:', current.url);
    }
    setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
  }

  function onDownloadSvg() {
    const { sticker } = current.grade;
    if (sticker) {
      const inches = Math.max(sticker.inches, 3);
      download(`${slug(current.title)}-qr-sticker.svg`, new Blob([currentSvg(inches)], { type: 'image/svg+xml' }));
    } else {
      download(`${slug(current.title)}-dash-card.svg`, new Blob([currentCard()], { type: 'image/svg+xml' }));
    }
  }

  async function onDownloadPng() {
    const blob = await svgToPngBlob(currentSvg(4), 1200); // 4 inches at 300 dpi
    if (blob) download(`${slug(current.title)}-qr-sticker.png`, blob);
  }

  // The sheet stays in the (hidden) print area after printing. Print styles show
  // only the sheet whenever it holds one, so nothing depends on a timer: on an
  // iPhone, window.print() returns before the print sheet is drawn.
  function onPrint(format) {
    if (!format.fits) return;
    clear(printArea);
    printArea.classList.toggle('is-card', format.kind === 'card');
    // Letter paper with half-inch margins: 3 across at 2 inches, 2 at 3, 1 at 4.
    printArea.style.setProperty('--sticker', format.kind === 'card' ? '7.5in' : `${format.inches}in`);
    printArea.style.setProperty('--cols', String(format.cols));
    for (let i = 0; i < format.perSheet; i++) {
      printArea.appendChild(svgNode(format.kind === 'card' ? currentCard() : currentSvg(format.inches)));
    }
    window.print();
  }

  function onExport() {
    const data = { app: APP_NAME, format: 1, saved: new Date().toISOString(), build };
    download(`${slug(buildTitle(build))}-backup.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  async function onImport() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 256 * 1024) {
      alert('That file is too big to be a backup from this app.');
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const next = normalizeBuild(data && data.build ? data.build : data);
      if (!confirm(`Replace this build with "${buildTitle(next)}" (${next.mods.length} mods)?`)) return;
      build = next;
      fill();
    } catch {
      alert('That file is not a backup from this app.');
    }
  }

  function onReset() {
    if (!confirm('Clear this build from this browser? Save a backup file first if you want to keep it.')) return;
    build = emptyBuild();
    fill();
  }

  function fill() {
    typeCar.checked = build.type !== 'moto';
    typeMoto.checked = build.type === 'moto';
    for (const key of Object.keys(v)) v[key].value = build[key];
    resetForm();
    renderMods();
    changed();
  }

  renderMods();
  changed();
  return { getBuild: () => build, getUrl: () => current.url };
}

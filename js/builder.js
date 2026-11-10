// The owner's side: enter the vehicle, pick a style, list the mods (or paste a
// list), get the sticker to print and a story card to post. Everything stays
// on the owner's device (browser storage plus a backup file); nothing is sent
// anywhere.
import { APP_NAME, TAGLINE, LIMITS, CATEGORIES, SPEC_KINDS, SCENES, sceneById } from './config.js';
import { emptyBuild, normalizeBuild, normalizeMod, modIsEmpty, buildTitle, vehicleLine, todayISO, cleanTags, buildNumber } from './model.js';
import { encodeBuild, shareUrl, compressionSupported } from './codec.js';
import { gradeLink, moduleMatrix, loadQrLib, SHAPES } from './qr.js';
import { shapeSvg, fontsUsed } from './sticker.js';
import { withFonts, svgToPngBlob } from './exportfile.js';
import { storyCardBlob } from './storycard.js';
import { parseModList } from './paste.js';
import { loadSaved, saveLocal, loadShape, saveShape } from './storage.js';
import { h, clear, svgNode } from './elements.js';
import { shareBase, saveFile, printPage, copyText, inApp } from './platform.js';

export { STORAGE_KEY, loadSaved, saveLocal } from './storage.js';

const GRADE_TEXT = {
  easy: (g) => `Easy to scan on a ${g.sticker.inches}-inch sticker or bigger.`,
  good: (g) => `Fits a ${g.sticker.inches}-inch sticker; people scan it from close up. The dash card scans from farther away.`,
  card: () => 'Too dense for a sticker. Print the dash card (letter paper) for your dashboard, or shorten notes and links to fit a sticker.',
  'too-big': () => 'Too much for one code. Shorten notes, remove some links, or split the list.',
};

function shapeText(shape, f) {
  if (shape === 'card') return 'The dash card: letter paper for the dashboard, easy to scan from a few steps away.';
  if (shape === 'square') return null; // GRADE_TEXT covers it
  return f.easy ? `Easy to scan on the ${f.label} or bigger.` : `Fits the ${f.label}; people scan it from close up.`;
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

function textInput(name, value, { max, placeholder = '', inputmode, autocomplete = 'off' } = {}) {
  return h('input', { name, value, maxLength: max, placeholder, inputmode, autocomplete, spellcheck: 'false' });
}

async function download(filename, blob) {
  if (await saveFile(filename, blob)) return; // the Android app saved it to Downloads
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

function modName(m) {
  return [m.brand, m.part].filter(Boolean).join(' ') || m.partNumber;
}

// root: element to fill. baseUrl: the page's own address (the QR points here).
export function renderBuilder(root, { baseUrl, initial } = {}) {
  let build = normalizeBuild(initial || loadSaved() || emptyBuild());
  let editing = -1; // index of the mod being edited, -1 when adding
  let current = { url: '', grade: null };
  let chosenShape = SHAPES.some((s) => s.id === loadShape()) ? loadShape() : 'square';
  let timer = null;
  let storyTimer = null;
  let runId = 0;
  let storyId = 0;
  let story = { blob: null, url: '' };
  let pasted = null;

  clear(root);
  document.title = `${APP_NAME} · Make your build tag`;

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

  // ---------- style and specs ----------
  const sceneInputs = SCENES.map((s) => h('input', { type: 'radio', name: 'scene', value: s.id, checked: build.scene === s.id }));
  const sceneChips = h('div', { class: 'scene-chips', role: 'radiogroup', 'aria-label': 'Style' },
    SCENES.map((s, i) => h('label', { class: 'scene-chip' },
      sceneInputs[i],
      h('span', { class: 'swatch', dataset: { scene: s.id }, 'aria-hidden': 'true' }),
      h('span', { class: 'scene-name' }, s.name),
      h('span', { class: 'hint' }, s.blurb),
    )),
  );
  const specRows = [0, 1, 2, 3].map((i) => {
    const kind = h('select', { name: `specKind${i}`, 'aria-label': `Spec ${i + 1}` }, SPEC_KINDS.map((k, j) => h('option', { value: String(j) }, k.name)));
    const value = textInput(`specValue${i}`, '', { max: LIMITS.specValue });
    kind.addEventListener('change', () => { value.placeholder = SPEC_KINDS[Number(kind.value)].example || 'Value'; });
    return { kind, value };
  });
  const specNote = textInput('specNote', build.specNote, { max: LIMITS.specNote, placeholder: 'Optional, e.g. Dynojet, 93 octane' });
  const tagsInput = textInput('tags', build.tags.join(', '), { max: LIMITS.tags * (LIMITS.tag + 2), placeholder: 'Daily, Stage 2, Track' });

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

  // ---------- paste a list ----------
  const pasteBox = h('textarea', { name: 'paste', rows: 7, maxLength: LIMITS.paste, placeholder: 'Mods:\n- Cobb Accessport V3 - Stage 2 tune\n- Invidia Q300 cat-back (HS15SSTGTC)\n- BC Racing BR coilovers\n450whp / 400wtq' });
  const pasteResult = h('div', { class: 'paste-result', 'aria-live': 'polite' });
  const pastePanel = h('div', { class: 'paste-panel', hidden: true },
    field('Paste your mod list', pasteBox, 'From an Instagram caption, your notes or a forum post. One mod per line, or separated by commas. You will see every mod before it is added.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'button', onClick: onReadPaste }, 'Read my list'),
      h('button', { type: 'button', class: 'button ghost', onClick: closePaste }, 'Close'),
    ),
    pasteResult,
  );
  const pasteToggle = h('button', { type: 'button', class: 'button paste-toggle', onClick: openPaste }, 'Paste a list');

  // ---------- sticker ----------
  const shapeInputs = SHAPES.map((s) => h('input', { type: 'radio', name: 'shape', value: s.id, checked: s.id === chosenShape }));
  const shapeHint = h('p', { class: 'hint shape-hint' });
  const shapeChips = h('div', { class: 'shape-chips', role: 'radiogroup', 'aria-label': 'Sticker shape' },
    SHAPES.map((s, i) => h('label', { class: 'shape-chip', dataset: { shape: s.id } }, shapeInputs[i], h('span', null, s.name))),
  );
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

  // ---------- story card ----------
  const storyImg = h('img', { class: 'story-preview', alt: 'Story card preview', width: 270, height: 480, hidden: true });
  const storyNote = h('p', { class: 'hint story-note' }, 'The card appears once your QR is ready.');
  const canShareFiles = !inApp() && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
    && (() => {
      try {
        return navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] });
      } catch {
        return false;
      }
    })();
  const storyActions = {
    share: h('button', { type: 'button', class: 'button primary', hidden: !canShareFiles, onClick: onShareStory }, 'Share to a story'),
    save: h('button', { type: 'button', class: 'button', onClick: onDownloadStory }, 'Download story card'),
  };

  // ---------- backup ----------
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onChange: onImport });

  root.appendChild(h('div', { class: 'builder' },
    h('div', { class: 'stripe', 'aria-hidden': 'true' }),
    h('header', { class: 'top' },
      h('h1', null, APP_NAME),
      h('p', { class: 'tagline' }, TAGLINE),
      h('p', { class: 'hint' }, 'List your mods, pick a style, print the QR, stick it on. At a show, anyone who scans it sees your full build in their phone\'s browser. No app, no account.'),
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

    h('section', { class: 'card', 'aria-labelledby': 'h-style' },
      h('h2', { id: 'h-style' }, '2. Style and specs'),
      h('p', { class: 'hint' }, 'The style sets the look of your scan page, sticker and story card.'),
      sceneChips,
      h('h3', null, 'Spec strip'),
      h('p', { class: 'hint' }, 'Up to four numbers shown big at the top of your page. Leave a box empty to skip it.'),
      h('div', { class: 'spec-rows' }, specRows.map((r) => h('div', { class: 'spec-row' }, r.kind, r.value))),
      field('Where the numbers come from', specNote),
      field('Tags', tagsInput, 'Up to six, separated by commas.'),
    ),

    h('section', { class: 'card', 'aria-labelledby': 'h-mods' },
      h('h2', { id: 'h-mods' }, '3. Your mods ', modCount),
      modList,
      h('div', { class: 'row paste-row' }, pasteToggle),
      pastePanel,
      modForm,
    ),

    h('section', { class: 'card', 'aria-labelledby': 'h-qr' },
      h('h2', { id: 'h-qr' }, '4. Your sticker'),
      shapeChips,
      shapeHint,
      meter,
      preview,
      h('div', { class: 'actions' }, Object.values(actions)),
      h('h3', null, 'Print at home'),
      printButtons,
      h('p', { class: 'hint' }, 'Weatherproof vinyl label sheets work for the car; plain paper works for the dash card. Print at 100% size, not "fit to page".'),
      h('p', { class: 'hint' }, 'Added a mod later? Come back, update the list and print a new QR. A printed sticker keeps the list it was made with.'),
    ),

    h('section', { class: 'card', 'aria-labelledby': 'h-story' },
      h('h2', { id: 'h-story' }, '5. Story card'),
      h('p', { class: 'hint' }, 'A picture of your build for an Instagram or TikTok story, with the QR on it. Put the link in your caption too.'),
      storyNote,
      storyImg,
      h('div', { class: 'actions' }, Object.values(storyActions)),
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
  const watched = [...Object.values(v), typeCar, typeMoto, ...sceneInputs, specNote, tagsInput,
    ...specRows.flatMap((r) => [r.kind, r.value])];
  for (const input of watched) {
    input.addEventListener('input', onVehicleChange);
    input.addEventListener('change', onVehicleChange);
  }
  shapeInputs.forEach((input) => input.addEventListener('change', () => {
    chosenShape = input.value;
    saveShape(chosenShape);
    showSticker();
  }));

  function readSpecs() {
    return specRows.map((r) => ({ kind: Number(r.kind.value), value: r.value.value }));
  }

  function onVehicleChange() {
    build = normalizeBuild({
      ...build,
      type: typeMoto.checked ? 'moto' : 'car',
      year: v.year.value, make: v.make.value, model: v.model.value, trim: v.trim.value,
      nickname: v.nickname.value, owner: v.owner.value, about: v.about.value,
      scene: (sceneInputs.find((i) => i.checked) || sceneInputs[0]).value,
      specs: readSpecs(),
      specNote: specNote.value,
      tags: cleanTags(tagsInput.value),
    });
    changed();
  }

  function fillSpecs() {
    specRows.forEach((r, i) => {
      const s = build.specs[i];
      r.kind.value = String(s ? s.kind : i);
      r.value.value = s ? s.value : '';
      r.value.placeholder = SPEC_KINDS[Number(r.kind.value)].example || 'Value';
    });
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
    const name = modName(build.mods[i]);
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
      modList.appendChild(h('li', { class: 'empty' }, 'No mods yet. Add your first one below, or paste a list you already have.'));
      return;
    }
    build.mods.forEach((m, i) => {
      const name = modName(m);
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

  // ---------- paste ----------
  function openPaste() {
    pastePanel.hidden = false;
    pasteToggle.hidden = true;
    pasteBox.focus();
  }

  function closePaste() {
    pastePanel.hidden = true;
    pasteToggle.hidden = false;
    pasteBox.value = '';
    pasted = null;
    clear(pasteResult);
  }

  function onReadPaste() {
    pasted = parseModList(pasteBox.value);
    clear(pasteResult);
    const room = LIMITS.mods - build.mods.length;
    const take = pasted.mods.slice(0, Math.max(0, room));
    if (!pasted.mods.length && !pasted.specs.length) {
      pasteResult.appendChild(h('p', { class: 'form-error' }, 'No mods found in that text. Put one mod per line, like "Invidia Q300 cat-back".'));
      return;
    }
    const specsText = pasted.specs.map((s) => `${SPEC_KINDS[s.kind].name} ${s.value}`).join(', ');
    pasteResult.appendChild(h('div', null,
      h('p', { class: 'label' }, `Found ${pasted.mods.length} ${pasted.mods.length === 1 ? 'mod' : 'mods'}${specsText ? ` and specs: ${specsText}` : ''}`),
      take.length > 0 && h('ol', { class: 'paste-preview' }, take.map((m) => h('li', null,
        h('span', { class: 'cat' }, CATEGORIES[m.category]),
        h('span', { class: 'name' }, modName(m)),
        m.partNumber && (m.brand || m.part) && h('span', { class: 'pn' }, m.partNumber),
      ))),
      pasted.mods.length > take.length && h('p', { class: 'form-error' }, `Only ${take.length} fit: a build holds up to ${LIMITS.mods} mods.`),
      h('p', { class: 'hint' }, 'Categories are a best guess. Tap Edit on any mod afterwards to fix it.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'button primary', onClick: () => addPasted(take) },
          take.length ? `Add ${take.length} ${take.length === 1 ? 'mod' : 'mods'}` : 'Add the specs'),
      ),
    ));
  }

  function addPasted(take) {
    const specs = build.specs.slice();
    for (const s of pasted ? pasted.specs : []) {
      if (specs.length < LIMITS.specs && !specs.some((x) => x.kind === s.kind)) specs.push(s);
    }
    build = normalizeBuild({ ...build, mods: [...build.mods, ...take], specs });
    closePaste();
    fill();
  }

  // ---------- QR and sticker ----------
  function changed() {
    const ok = saveLocal(build);
    saveNote.textContent = ok ? '' : 'This browser is not saving (private mode?). Save a backup file before you close the page.';
    clearTimeout(timer);
    timer = setTimeout(refreshQr, 250);
  }

  // The QR and every word printed beside it come from the same snapshot of the
  // build, so a sticker never carries new text over an old code.
  async function refreshQr() {
    const id = ++runId;
    timer = null;
    const snap = build; // edits replace the build, never change it in place
    const stamped = { ...snap, updated: todayISO() };
    let url;
    let localUrl;
    try {
      await loadQrLib();
      const payload = await encodeBuild(stamped);
      url = shareUrl(shareBase(baseUrl), payload); // what the QR and "Copy link" carry
      localUrl = shareUrl(baseUrl, payload); // the preview opens here, also inside the app
    } catch (e) {
      if (id !== runId) return;
      meter.textContent = e.message;
      meter.className = 'meter bad';
      setActions(false);
      return;
    }
    if (id !== runId) return; // a newer edit already started
    if (url === current.url && snap.scene === current.scene) return; // nothing changed: keep the buttons the owner may be tapping
    const grade = gradeLink(url);
    current = {
      url, localUrl, grade, build: snap, scene: snap.scene, title: buildTitle(snap), matrix: grade.ok ? moduleMatrix(grade.qr) : null,
    };
    showSticker();
    clearTimeout(storyTimer);
    storyTimer = setTimeout(refreshStory, 300);
  }

  // The shape shown: the owner's pick when it scans, else the first that does.
  function effectiveShape() {
    const shapes = current.grade.shapes || {};
    if (shapes[chosenShape]) return chosenShape;
    const fallback = SHAPES.find((s) => shapes[s.id]);
    return fallback ? fallback.id : null;
  }

  function stickerOpts(inches) {
    const b = current.build;
    return {
      title: current.title,
      subtitle: b.nickname ? vehicleLine(b) : '',
      count: b.mods.length,
      specs: b.specs.map((s) => ({ label: SPEC_KINDS[s.kind].name, value: s.value })),
      serial: buildNumber(b),
      scene: sceneById(b.scene),
      inches,
    };
  }

  // Before a download, copy or share: finish any edit still waiting to be
  // turned into a QR, then say whether there is one to use.
  async function ready() {
    if (timer) {
      clearTimeout(timer);
      await refreshQr();
    }
    return Boolean(current.grade && current.grade.ok && current.matrix);
  }

  function showSticker() {
    const { grade } = current;
    clear(preview);
    clear(printButtons);
    if (!grade) return;
    const shapes = grade.shapes || {};
    shapeInputs.forEach((input) => {
      const fits = Boolean(shapes[input.value]);
      input.disabled = !fits;
      input.parentElement.classList.toggle('off', !fits);
      input.checked = input.value === chosenShape;
    });
    if (!grade.ok) {
      meter.textContent = GRADE_TEXT['too-big'](grade);
      meter.className = 'meter bad';
      shapeHint.textContent = '';
      setActions(false);
      return;
    }
    const shape = effectiveShape();
    const fmt = shapes[shape];
    const info = SHAPES.find((s) => s.id === shape);
    const chosen = SHAPES.find((s) => s.id === chosenShape);
    shapeHint.textContent = shape === chosenShape
      ? info.hint
      : `Too many mods for the ${chosen.name.toLowerCase()} to scan. Showing the ${info.name.toLowerCase()} instead.`;
    if (shape === 'square') {
      meter.textContent = GRADE_TEXT[grade.level](grade);
      meter.className = `meter ${grade.level}`;
    } else {
      meter.textContent = shape === 'card' && !grade.sticker ? GRADE_TEXT.card(grade) : shapeText(shape, fmt);
      meter.className = `meter ${fmt.easy ? 'easy' : 'good'}`;
    }
    preview.className = `sticker-preview shape-${shape}`;
    preview.appendChild(svgNode(shapeSvg(shape, current.matrix, stickerOpts(null))));
    actions.open.href = current.localUrl;
    setActions(true);
    actions.svg.textContent = shape === 'card' ? 'Download dash card SVG' : 'Download SVG (for a sticker printer)';
    const list = grade.formats.filter((x) => x.shape === shape || x.kind === 'card');
    for (const x of list) {
      const text = x.kind === 'card' ? 'Print dash card' : `Print ${x.label} sheet (${x.perSheet})`;
      printButtons.appendChild(h('button', {
        type: 'button',
        class: 'button',
        disabled: !x.fits,
        title: x.fits ? null : 'Too dense to scan at this size',
        dataset: { format: x.id },
        onClick: () => onPrint(x),
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
    for (const el of Object.values(storyActions)) el.disabled = !enabled;
  }

  function svgFor(fmt) {
    return shapeSvg(fmt.shape, current.matrix, stickerOpts(fmt.kind === 'card' ? true : fmt.w));
  }

  // The size a download is made at: the largest of the shape's sizes that scans.
  function downloadFormat() {
    const shape = effectiveShape();
    const fits = current.grade.formats.filter((x) => x.shape === shape && x.fits);
    return fits[fits.length - 1];
  }

  async function onCopyLink(e) {
    const button = e.currentTarget;
    if (!(await ready())) return;
    try {
      await copyText(current.url);
      button.textContent = 'Link copied';
    } catch {
      prompt('Copy this link:', current.url);
    }
    setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
  }

  // The SVG with its fonts inside; if the font files cannot be read, the plain
  // SVG (it falls back to the phone's own fonts).
  async function svgWithFonts(fmt) {
    const plain = svgFor(fmt);
    try {
      return { svg: await withFonts(plain, fontsUsed(current.scene)), plain };
    } catch {
      return { svg: plain, plain };
    }
  }

  function fileName(fmt, ext) {
    const name = fmt.kind === 'card' ? 'dash-card' : `qr-${fmt.shape === 'square' ? 'sticker' : fmt.shape}`;
    return `${slug(current.title)}-${name}.${ext}`;
  }

  async function onDownloadSvg() {
    if (!(await ready())) return;
    const fmt = downloadFormat();
    if (!fmt) return;
    const { svg } = await svgWithFonts(fmt);
    download(fileName(fmt, 'svg'), new Blob([svg], { type: 'image/svg+xml' }));
  }

  async function onDownloadPng() {
    if (!(await ready())) return;
    const fmt = downloadFormat();
    if (!fmt) return;
    const dpi = fmt.kind === 'card' ? 150 : 300; // a letter-size card at 300 dpi is a very large picture for a phone
    const w = Math.round(fmt.w * dpi);
    const h = Math.round(fmt.h * dpi);
    const { svg, plain } = await svgWithFonts(fmt);
    let blob = null;
    try {
      blob = await svgToPngBlob(svg, w, h);
    } catch {
      blob = null;
    }
    if (!blob && svg !== plain) {
      try {
        blob = await svgToPngBlob(plain, w, h); // a browser that refuses the embedded fonts
      } catch {
        blob = null;
      }
    }
    if (blob) download(fileName(fmt, 'png'), blob);
    else alert('This browser could not make the picture. Download the SVG instead.');
  }

  // The sheet stays in the (hidden) print area after printing. Print styles show
  // only the sheet whenever it holds one, so nothing depends on a timer: on an
  // iPhone, window.print() returns before the print sheet is drawn.
  function onPrint(format) {
    if (!format.fits || !current.matrix) return;
    clear(printArea);
    printArea.classList.toggle('is-card', format.kind === 'card');
    printArea.dataset.shape = format.shape;
    // Letter paper with half-inch margins: the format says how many fit across.
    printArea.style.setProperty('--sticker-w', `${format.w}in`);
    printArea.style.setProperty('--sticker-h', `${format.h}in`);
    printArea.style.setProperty('--cols', String(format.cols));
    for (let i = 0; i < format.perSheet; i++) printArea.appendChild(svgNode(svgFor(format)));
    printPage();
  }

  // ---------- story card ----------
  async function refreshStory() {
    const id = ++storyId;
    if (!current.matrix) return;
    const { build: snap, matrix, url: forUrl } = current;
    let blob;
    try {
      blob = await storyCardBlob(snap, matrix);
    } catch {
      blob = null;
    }
    if (id !== storyId) return;
    if (!blob) {
      storyNote.textContent = 'This browser could not draw the story card.';
      return;
    }
    if (story.url) URL.revokeObjectURL(story.url);
    story = { blob, url: URL.createObjectURL(blob), forUrl };
    storyImg.src = story.url;
    storyImg.hidden = false;
    storyNote.textContent = '';
  }

  function storyFile() {
    return new File([story.blob], `${slug(current.title)}-story.png`, { type: 'image/png' });
  }

  // The card for the build as it is now: drawn on the spot if the last one is
  // missing or older than the QR.
  async function storyReady() {
    if (!(await ready())) return false;
    if (!story.blob || story.forUrl !== current.url) {
      clearTimeout(storyTimer);
      await refreshStory();
    }
    return Boolean(story.blob && story.forUrl === current.url);
  }

  async function onShareStory() {
    if (!(await storyReady())) return;
    try {
      await navigator.share({ files: [storyFile()], title: current.title });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // the owner closed the share sheet
      download(storyFile().name, story.blob);
    }
  }

  async function onDownloadStory() {
    if (await storyReady()) download(storyFile().name, story.blob);
  }

  // ---------- backup ----------
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
    sceneInputs.forEach((i) => { i.checked = i.value === build.scene; });
    fillSpecs();
    specNote.value = build.specNote;
    tagsInput.value = build.tags.join(', ');
    resetForm();
    renderMods();
    changed();
  }

  fillSpecs();
  renderMods();
  setActions(false); // nothing to copy, download or share until the first QR is made
  changed();
  return {
    getBuild: () => build,
    getUrl: () => current.url,
    // The page moved on (a link opened): stop the timers and drop the card.
    destroy() {
      runId++;
      storyId++;
      clearTimeout(timer);
      clearTimeout(storyTimer);
      timer = null;
      if (story.url) URL.revokeObjectURL(story.url);
      story = { blob: null, url: '' };
    },
  };
}

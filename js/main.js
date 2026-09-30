'use strict';
/* App shell: render loop, header, library dialogs, PDF / print, keyboard. */

const MM_PX = 96 / 25.4; // CSS pixels per mm at 100% zoom

const VIEWS = { sheet: () => SheetView, label: () => LabelView, data: () => DataView };
const view = () => (VIEWS[App.ui.mode] || VIEWS.sheet)();

let renderQueued = false;
let structuralQueued = false;
let lastPanelKey = null;

function requestRender(structural = false) {
  structuralQueued = structuralQueued || structural;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const st = structuralQueued;
    structuralQueued = false;
    renderNow(st);
  });
}

function renderNow(structural) {
  fixSelection();
  const v = view();
  v.renderCanvas();
  const key = App.ui.mode + '|' + v.panelKey();
  if (structural || key !== lastPanelKey) {
    lastPanelKey = key;
    Bind.reset();
    v.renderPanels();
  } else {
    Bind.sync();
  }
  v.renderAux();
  renderHeader();
}

function renderHeader() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === App.ui.mode));
  $('#btnUndo').disabled = !History.undo.length;
  $('#btnRedo').disabled = !History.redo.length;

  // Download button says what it will produce.
  const plan = dataActive() ? mergePlan() : null;
  $('#btnPdfText').textContent = plan ? `Download ${plural(plan.labels, 'label')}` : 'Download PDF';
  $('#btnPdf').title = plan ? `${plan.pages.length} A4 pages filled from your data` : 'Download an exact-size A4 PDF';

  // Phone bottom bar and sheet titles: named after what they currently hold.
  const mode = App.ui.mode;
  const sel = mode === 'sheet' ? selectedLabel() : mode === 'label' ? LabelView.selEl() : null;
  const names = {
    sheet: ['Layout', sel ? `Label ${labelIndex(sel.id) + 1}` : 'Sheet', 'Sheet layout', sel ? `Label ${labelIndex(sel.id) + 1}` : 'This sheet'],
    label: ['Add', sel ? EL_TITLE[sel.type] : 'Label', 'Add, layers & templates', sel ? EL_TITLE[sel.type] : 'Label'],
    data: ['Data', 'Summary', 'Your data', 'Ready to print'],
  }[mode];
  $('#navLeft').textContent = names[0];
  $('#navRight').textContent = names[1];
  $('#leftTitle').textContent = names[2];
  $('#rightTitle').textContent = names[3];
  document.querySelectorAll('#bottomNav [data-sheet]').forEach((b) => b.classList.toggle('on', b.dataset.sheet === App.ui.sheet));
}

/* On phones the settings and properties panels are slide-up sheets. */
function showSheet(which) {
  App.ui.sheet = which || null;
  document.body.dataset.sheet = App.ui.sheet || '';
  renderHeader();
}

function stageBar(info) {
  const pct = Math.round((view().ppm() / MM_PX) * 100);
  $('#stageBar').replaceChildren(
    h('div', { class: 'stage-info' }, ...info),
    h('div', { class: 'zoom' },
      btn(icon('minus', 16), () => zoomBy(1 / 1.25), 'icon ghost', 'Zoom out (Ctrl + wheel)'),
      btn(`${pct}%`, zoomFit, 'ghost small zoom-pct', 'Fit to window'),
      btn(icon('plus', 16), () => zoomBy(1.25), 'icon ghost', 'Zoom in (Ctrl + wheel)'),
      btn('1:1', () => { App.ui.zoom[App.ui.mode] = MM_PX; requestRender(); }, 'ghost small', 'Roughly real size on screen')),
  );
}

function zoomBy(f) {
  App.ui.zoom[App.ui.mode] = clamp(view().ppm() * f, 0.4, 40);
  requestRender();
}

function zoomFit() {
  App.ui.zoom[App.ui.mode] = null;
  requestRender();
}

function renderWarnings(list, title, okText, onPick) {
  const order = { error: 0, warn: 1, info: 2 };
  const sorted = [...list].sort((a, b) => order[a.level] - order[b.level]);
  $('#warnings').replaceChildren(section(title,
    sorted.length
      ? h('ul', { class: 'warn-list' }, ...sorted.map((w) => h('li', { class: 'w-' + w.level, title: 'Click to select', onclick: () => onPick && onPick(w) }, w.msg)))
      : h('div', { class: 'check-ok' }, '✓ ' + okText)));
  const issues = list.filter((w) => w.level !== 'info').length;
  const badge = $('#navBadge');
  badge.hidden = !issues;
  badge.textContent = issues;
}

function setMode(mode) {
  if (mode === 'label') {
    App.ui.editLabelId = App.ui.selLabel || (labelById(App.ui.editLabelId) ? App.ui.editLabelId : App.sheet.labels[0].id);
  } else {
    App.ui.selLabel = App.ui.editLabelId;
  }
  App.ui.mode = mode;
  App.ui.selEl = null;
  SheetView.guides = [];
  LabelView.guides = [];
  $('#canvas').style.cursor = 'default';
  if (isMobile()) showSheet(null);
  requestRender(true);
}

function openLabelDesigner(id) {
  App.ui.selLabel = id;
  App.ui.editLabelId = id;
  App.ui.zoom.label = null;
  setMode('label');
}

/* ---------------------------------------------------------------- layouts */

async function saveLayout(asNew) {
  const s = App.sheet;
  let lay = !asNew && s.layoutId ? App.library.layouts.find((x) => x.id === s.layoutId) : null;
  if (!lay) {
    const name = await askText('Save sheet layout', 'Layout name', s.layoutId ? s.name + ' copy' : s.name || 'My layout');
    if (!name) return;
    lay = App.library.layouts.find((x) => x.name.toLowerCase() === name.toLowerCase()) || null;
    if (lay && !(await confirmBox('Replace layout?', `A layout called “${lay.name}” already exists. Replace it?`, 'Replace'))) return;
    if (!lay) {
      lay = { id: uid(), name };
      App.library.layouts.push(lay);
    }
  }
  s.layoutId = lay.id;
  s.name = lay.name;
  lay.savedAt = Date.now();
  lay.sheet = clone(s);
  saveSoon();
  requestRender(true);
  toast(`Saved layout “${lay.name}” with its label designs.`, 'ok');
}

function loadLayout(id) {
  const lay = App.library.layouts.find((x) => x.id === id);
  if (!lay) return;
  mutate('load-layout', () => {
    App.sheet = migrateSheet(clone(lay.sheet));
    App.sheet.layoutId = lay.id;
    App.sheet.name = lay.name;
  });
  App.ui.selLabel = null;
  App.ui.selEl = null;
  requestRender(true);
  toast(`Opened “${lay.name}” (Ctrl+Z to go back).`);
}

function openLayoutsDialog() {
  openModal('Saved sheet layouts', (body, foot, close) => {
    const list = h('div', { class: 'lib-list' });
    const draw = () => {
      list.replaceChildren();
      if (!App.library.layouts.length) list.append(hint('No saved layouts yet. Use “Save” in the Sheet Designer.'));
      App.library.layouts.forEach((lay) => {
        list.append(h('div', { class: 'lib-row' },
          h('div', { class: 'lib-thumb', html: sheetThumbSVG(lay.sheet, 42) }),
          h('div', { class: 'lib-meta' },
            h('strong', {}, lay.name),
            h('span', {}, `${plural(lay.sheet.labels.length, 'label')} · ${lay.sheet.mode === 'custom' ? 'custom' : 'grid'} · saved ${new Date(lay.savedAt || Date.now()).toLocaleDateString()}`)),
          h('div', { class: 'lib-actions' },
            btn('Open', () => { close(); loadLayout(lay.id); }, 'small primary'),
            btn('Rename', async () => {
              const n = await askText('Rename layout', 'Layout name', lay.name);
              if (!n) return;
              lay.name = n;
              lay.sheet.name = n;
              if (App.sheet.layoutId === lay.id) App.sheet.name = n;
              saveSoon();
              draw();
              requestRender(true);
            }, 'small ghost'),
            btn('Delete', async () => {
              if (!(await confirmBox('Delete layout?', `Delete the saved layout “${lay.name}”? This cannot be undone.`, 'Delete', true))) return;
              App.library.layouts = App.library.layouts.filter((x) => x.id !== lay.id);
              if (App.sheet.layoutId === lay.id) App.sheet.layoutId = null;
              saveSoon();
              draw();
              requestRender(true);
            }, 'small danger ghost'))));
      });
    };
    draw();
    body.append(list);
    foot.append(btn('Close', () => close(), 'primary'));
  }, { wide: true });
}

function openTemplatesDialog() {
  openModal('Saved label designs', (body, foot, close) => {
    const list = h('div', { class: 'lib-list' });
    const draw = () => {
      list.replaceChildren();
      if (!App.library.templates.length) list.append(hint('No saved designs yet. In the Label Designer choose “Save as new template”.'));
      App.library.templates.forEach((t) => {
        list.append(h('div', { class: 'lib-row' },
          h('div', { class: 'lib-thumb', html: designThumbSVG(t.w, t.h, t.design) }),
          h('div', { class: 'lib-meta' }, h('strong', {}, t.name), h('span', {}, `${fmt(t.w)} × ${fmt(t.h)} mm · ${plural(t.design.elements.length, 'item')}`)),
          h('div', { class: 'lib-actions' },
            btn('Rename', async () => {
              const n = await askText('Rename template', 'Template name', t.name);
              if (!n) return;
              t.name = n;
              saveSoon();
              draw();
              requestRender(true);
            }, 'small ghost'),
            btn('Delete', async () => {
              if (!(await confirmBox('Delete template?', `Delete “${t.name}”? Labels already using it keep their own copy.`, 'Delete', true))) return;
              App.library.templates = App.library.templates.filter((x) => x.id !== t.id);
              if (App.ui.tplChoice === t.id) App.ui.tplChoice = '';
              saveSoon();
              draw();
              requestRender(true);
            }, 'small danger ghost'))));
      });
    };
    draw();
    body.append(list);
    foot.append(btn('Close', () => close(), 'primary'));
  }, { wide: true });
}

function openCompanyDialog() {
  const c = { ...(App.library.company || {}) };
  return openModal('Company profile', (body, foot, close) => {
    const f = (key, label, multi) => {
      const inp = multi ? h('textarea', { rows: 3, class: 'text-input' }) : h('input', { type: 'text', class: 'text-input' });
      inp.value = c[key] || '';
      inp.addEventListener('input', () => { c[key] = inp.value; });
      return h('label', { class: 'stack' }, h('span', { class: 'lbl' }, label), inp);
    };
    const logoBox = h('div', { class: 'logo-box' });
    const drawLogo = () => {
      logoBox.replaceChildren(
        c.logoKey && App.images[c.logoKey] ? h('img', { src: imageURL(c.logoKey), alt: 'Company logo' }) : h('span', { class: 'hint' }, 'No logo'),
        btn(c.logoKey ? 'Replace logo' : 'Upload logo', async () => {
          const k = await pickImage();
          if (k) { c.logoKey = k; drawLogo(); }
        }, 'small'),
        c.logoKey ? btn('Remove', () => { c.logoKey = null; drawLogo(); }, 'small ghost') : null,
      );
    };
    drawLogo();
    body.append(
      hint('Used by “Company info” and new QR codes in the Label Designer.'),
      f('name', 'Company name'), f('address', 'Address', true), f('phone', 'Phone'), f('email', 'Email'), f('website', 'Website'),
      h('div', { class: 'stack' }, h('span', { class: 'lbl' }, 'Logo'), logoBox),
    );
    foot.append(btn('Cancel', () => close(false), 'ghost'), btn('Save profile', () => {
      App.library.company = c;
      saveSoon();
      close(true);
      toast('Company profile saved.', 'ok');
    }, 'primary'));
  }).then(Boolean);
}

/* ---------------------------------------------------------------- backup */

/* Blank default sheet and no data. Saved templates and layouts are kept. */
async function startOver() {
  const ok = await confirmBox('Start over?', 'This clears the current sheet design and the loaded data, and goes back to the blank 4-label sheet. Your saved templates and layouts are kept.', 'Start over', true);
  if (!ok) return;
  mutate('fresh', () => { App.sheet = newSheet(); });
  App.data = newData();
  saveData();
  App.ui.selLabel = null;
  App.ui.selEl = null;
  App.ui.dataPage = 0;
  setMode('sheet');
  toast('Blank sheet ready.', 'ok');
}

function exportBackup() {
  const data = { app: 'label-studio', version: 1, exportedAt: new Date().toISOString(), sheet: App.sheet, library: App.library, images: App.images };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `label-studio-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup downloaded — it contains your sheet, templates, layouts and images.', 'ok');
}

function importBackup() {
  const inp = $('#fileBackup');
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'label-studio' || !data.sheet || !data.library) throw new Error('This is not a Label Studio backup file.');
      if (!(await confirmBox('Import backup?', 'This replaces the current sheet, saved templates, layouts and company profile with the backup contents.', 'Import'))) return;
      App.images = data.images || {};
      App.imagesDirty = true;
      imageURLCache.clear();
      App.library = { templates: [], layouts: [], company: {}, ...data.library };
      App.library.layouts.forEach((x) => migrateSheet(x.sheet));
      mutate('import', () => { App.sheet = migrateSheet(data.sheet); });
      saveNow();
      requestRender(true);
      toast('Backup imported.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  inp.click();
}

/* ---------------------------------------------------------------- PDF */

async function preflight() {
  if (dataActive()) {
    const unlinked = designFields().filter((f) => !App.data.mapping[f]);
    if (unlinked.length && !(await confirmBox('Some fields are not linked', `${unlinked.map((f) => `{{${f}}}`).join(', ')} ${unlinked.length === 1 ? 'is' : 'are'} not linked to a data column and will print empty. Continue?`, 'Continue anyway'))) return false;
  }
  const errs = sheetWarnings(App.sheet).filter((w) => w.level === 'error');
  const lbl = App.sheet.labels.flatMap((l) => labelWarnings(l).filter((w) => w.level === 'error'));
  const all = [...errs, ...lbl];
  if (!all.length) return true;
  return confirmBox('Problems found', `${all.map((w) => w.msg).join(' ')} Create the PDF anyway?`, 'Continue anyway');
}

const pdfName = () => {
  const base = (App.sheet.name || 'labels').replace(/[^\w\- ]+/g, '').trim() || 'labels';
  return dataActive() ? `${base} - ${plural(mergePlan().labels, 'label')}.pdf` : `${base}.pdf`;
};

async function generatePDF() {
  if (!(await preflight())) return;
  try {
    buildPDF(App.sheet).save(pdfName());
    toast('PDF saved. When printing choose “Actual size” / 100% — not “Fit to page”.', 'ok');
  } catch (err) {
    console.error(err);
    toast('PDF failed: ' + err.message, 'error');
  }
}

async function printPDF() {
  if (!(await preflight())) return;
  try {
    const doc = buildPDF(App.sheet);
    if (isMobile()) {
      // Phone browsers ignore auto-print; hand the PDF to the share sheet (Print / Save / AirPrint) instead.
      const file = new File([doc.output('blob')], pdfName(), { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: App.sheet.name || 'Labels' });
        } catch (err) {
          if (err.name !== 'AbortError') throw err;
        }
        return;
      }
      window.open(URL.createObjectURL(file), '_blank');
      toast('Use your PDF viewer’s Share → Print, at 100% / actual size.');
      return;
    }
    doc.autoPrint();
    const w = window.open(doc.output('bloburl'), '_blank');
    if (!w) toast('The browser blocked the print window — use Generate PDF and print that file.', 'warn');
    else toast('Print at 100% / “Actual size” so labels line up with the sticker sheet.');
  } catch (err) {
    console.error(err);
    toast('Print failed: ' + err.message, 'error');
  }
}

/* ---------------------------------------------------------------- canvas pointers */

/* Mouse and pen go straight to the active view. Touch adds: double-tap (= double-click),
   one finger on empty canvas pans, two fingers pinch-zoom around the fingers. */
function bindCanvasPointers(cv, wrap) {
  const touches = new Map();
  let pan = null;
  let pinch = null;
  let lastTap = null;

  const midpoint = () => {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  cv.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch';
    if (touch) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        view().pointerUp(); // a second finger ends any drag and starts a pinch
        pan = null;
        const m = midpoint();
        pinch = { d0: m.d, z0: view().ppm(), doc: svgPoint(cv, { clientX: m.x, clientY: m.y }) };
        return;
      }
      if (touches.size > 2) return;
    }
    if (e.button !== 0) return;
    const p = svgPoint(cv, e);
    if (touch) {
      const now = Date.now();
      if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        view().dblClick(e, p);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    const hit = view().pointerDown(e, p);
    if (!hit && touch) {
      pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
  });

  cv.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (touches.size < 2) return;
      const m = midpoint();
      App.ui.zoom[App.ui.mode] = clamp(pinch.z0 * (m.d / pinch.d0), 0.4, 40);
      renderNow(false);
      // keep the point that was under the fingers under the fingers
      const ctm = cv.getScreenCTM();
      wrap.scrollLeft += ctm.a * pinch.doc.x + ctm.e - m.x;
      wrap.scrollTop += ctm.d * pinch.doc.y + ctm.f - m.y;
      return;
    }
    if (pan) {
      wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
      wrap.scrollTop = pan.st - (e.clientY - pan.y);
      return;
    }
    view().pointerMove(e, svgPoint(cv, e));
  });

  const end = (e) => {
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      return;
    }
    pan = null;
    view().pointerUp();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', (e) => view().dblClick(e, svgPoint(cv, e)));
}

/* ---------------------------------------------------------------- init */

function init() {
  App.onChange = (structural) => { requestRender(!!structural); saveSoon(); };
  App.onSaved = (ok) => {
    const s = $('#saveStatus');
    s.textContent = ok ? 'All changes saved' : 'Not saved — browser storage is full. Export a backup.';
    s.classList.toggle('bad', !ok);
    if (!ok) toast('Browser storage is full (large images?). Use Library → Export backup, then remove unused images.', 'error');
  };
  loadState();

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnPdf').addEventListener('click', generatePDF);
  $('#btnPrint').addEventListener('click', printPDF);

  const menu = $('#libraryMenu');
  $('#btnLibrary').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    menu.hidden = true;
    ({ fresh: startOver, templates: openTemplatesDialog, layouts: openLayoutsDialog, company: openCompanyDialog, export: exportBackup, import: importBackup })[b.dataset.act]();
  });

  $('#navPdf').addEventListener('click', generatePDF);
  $('#navPrint').addEventListener('click', printPDF);
  document.querySelectorAll('#bottomNav [data-sheet]').forEach((b) => b.addEventListener('click', () => {
    showSheet(App.ui.sheet === b.dataset.sheet ? null : b.dataset.sheet);
  }));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => showSheet(null)));

  const cv = $('#canvas');
  const wrap = $('#canvasWrap');
  bindCanvasPointers(cv, wrap);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) view().deselect(); });
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  window.addEventListener('resize', () => requestRender());
  window.addEventListener('beforeunload', saveNow);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.closest && t.closest('input, textarea, select, dialog');
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'p') { e.preventDefault(); printPDF(); return; }
    if (mod && k === 's') { e.preventDefault(); saveLayout(false); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    view().onKey(e);
  });

  requestRender(true);
  if (!window.jspdf) toast('PDF library failed to load — check the vendor folder.', 'error');
  if (typeof qrcode !== 'function') toast('QR library failed to load — check the vendor folder.', 'error');
}

init();

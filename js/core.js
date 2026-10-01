'use strict';
/*
 * Label Studio — core model, grid geometry, history and storage.
 *
 * Every measurement in the app is in millimetres. The on-screen SVG canvas and the
 * PDF use the very same mm coordinates (origin = top-left of the A4 page), so the
 * preview only scales visually and the PDF keeps exact sizes and positions.
 */

const A4 = { w: 210, h: 297 };
const PT = 25.4 / 72;            // one typographic point in mm
const MIN_LABEL = 5;             // smallest allowed label edge, mm
const STORE = {
  sheet: 'labelstudio.sheet.v1',
  library: 'labelstudio.library.v1',
  images: 'labelstudio.images.v1',
  data: 'labelstudio.data.v1',
};

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const clone = (o) => JSON.parse(JSON.stringify(o));
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (Number.isFinite(v) ? String(r2(v)) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* Default sheet: A4 portrait, four equal labels in a 2 × 2 grid, small central gaps,
   equal outer margins, slightly rounded corners and a subtle grey outline. */
const DEFAULT_CFG = Object.freeze({
  preset: '4',
  cols: 2,
  rows: 2,
  labelW: 95,
  labelH: 138.5,
  gapX: 4,
  gapY: 4,
  marginTop: 8,
  marginBottom: 8,
  marginLeft: 8,
  marginRight: 8,
  radius: 3,
  border: 0.3,
  borderColor: '#b8bcc4',
  printerMargin: 3,
  autoFit: true,
});

const PRESETS = [
  { key: '4', name: 'Default — 4 equal labels (2 × 2)', cols: 2, rows: 2 },
  { key: '2h', name: '2 horizontal labels (1 × 2)', cols: 1, rows: 2 },
  { key: '2v', name: '2 vertical labels (2 × 1)', cols: 2, rows: 1 },
  { key: '6', name: '6 labels (2 × 3)', cols: 2, rows: 3 },
  { key: '8', name: '8 labels (2 × 4)', cols: 2, rows: 4 },
  { key: '10', name: '10 labels (2 × 5)', cols: 2, rows: 5 },
  { key: 'custom', name: 'Custom layout (free-form)' },
];

/* Common commercial sticker-sheet sizes. Always check against your own sheet. */
const STANDARD_SIZES = [
  { name: '4 / sheet — 99.1 × 139 mm (L7169-style)', cols: 2, rows: 2, labelW: 99.1, labelH: 139, gapX: 2.5, gapY: 0 },
  { name: '2 / sheet — 199.6 × 143.5 mm (L7168-style)', cols: 1, rows: 2, labelW: 199.6, labelH: 143.5, gapX: 0, gapY: 0 },
  { name: '6 / sheet — 99.1 × 93.1 mm (L7166-style)', cols: 2, rows: 3, labelW: 99.1, labelH: 93.1, gapX: 2.5, gapY: 0 },
  { name: '8 / sheet — 99.1 × 67.7 mm (L7165-style)', cols: 2, rows: 4, labelW: 99.1, labelH: 67.7, gapX: 2.5, gapY: 0 },
  { name: '10 / sheet — 99.1 × 57 mm (L7173-style)', cols: 2, rows: 5, labelW: 99.1, labelH: 57, gapX: 2.5, gapY: 0 },
  { name: 'A6 quarters — 105 × 148.5 mm, no margins', cols: 2, rows: 2, labelW: 105, labelH: 148.5, gapX: 0, gapY: 0 },
  { name: 'A5 halves — 210 × 148.5 mm, no margins', cols: 1, rows: 2, labelW: 210, labelH: 148.5, gapX: 0, gapY: 0 },
];

const App = {
  sheet: null,
  library: { templates: [], layouts: [], company: {} },
  images: {},
  imagesDirty: false,
  data: null,
  ui: {
    mode: 'sheet',
    selLabel: null,
    selEl: null,
    editLabelId: null,
    zoom: { sheet: null, label: null, data: null },
    tplChoice: '',
    scaleTpl: true,
    dataPage: 0,
    sheet: null,
    open: {},
    previewData: true,
  },
  onChange: null,
  onSaved: null,
};

/* ---------------------------------------------------------------- model */

function newDesign() {
  return { bg: '#ffffff', elements: [], templateId: null, templateName: null };
}

function newLabel(props = {}) {
  return {
    id: uid(), x: 0, y: 0, w: 60, h: 40,
    radius: DEFAULT_CFG.radius, border: DEFAULT_CFG.border, borderColor: DEFAULT_CFG.borderColor,
    allowOverlap: false, design: newDesign(), ...props,
  };
}

function newSheet() {
  const s = {
    name: 'Standard 4 Labels', layoutId: null, mode: 'grid', cfg: clone(DEFAULT_CFG),
    labels: [], printBorders: false, allowOverlap: false, copies: 1,
  };
  syncGrid(s);
  return s;
}

function migrateSheet(s) {
  s.cfg = { ...DEFAULT_CFG, ...(s.cfg || {}) };
  s.mode = s.mode === 'custom' ? 'custom' : 'grid';
  s.copies = s.copies || 1;
  s.labels = Array.isArray(s.labels) ? s.labels : [];
  s.labels.forEach((l) => {
    l.id = l.id || uid();
    l.design = l.design || newDesign();
    l.design.elements = l.design.elements || [];
  });
  if (!s.labels.length) { s.mode = 'grid'; syncGrid(s); }
  return s;
}

const labelById = (id) => (id && App.sheet.labels.find((l) => l.id === id)) || null;
const labelIndex = (id) => App.sheet.labels.findIndex((l) => l.id === id);
const selectedLabel = () => labelById(App.ui.selLabel);
const cornerR = (b) => clamp(b.radius || 0, 0, Math.min(b.w, b.h) / 2);

function overlap(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ix > 0.01 && iy > 0.01 ? { w: ix, h: iy } : null;
}

function presetKeyFor(cols, rows) {
  const p = PRESETS.find((x) => x.cols === cols && x.rows === rows);
  return p ? p.key : 'grid';
}

/* ---------------------------------------------------------------- grid */

/* With autoFit on, the four margins and the gaps decide the label size.
   With autoFit off, label size + left/top margins decide the position and the
   right/bottom margins are whatever space is left. */
function gridGeometry(c) {
  let W = c.labelW;
  let H = c.labelH;
  if (c.autoFit) {
    W = (A4.w - c.marginLeft - c.marginRight - c.gapX * (c.cols - 1)) / c.cols;
    H = (A4.h - c.marginTop - c.marginBottom - c.gapY * (c.rows - 1)) / c.rows;
  }
  const totalW = c.cols * W + c.gapX * (c.cols - 1);
  const totalH = c.rows * H + c.gapY * (c.rows - 1);
  const R = c.autoFit ? c.marginRight : A4.w - c.marginLeft - totalW;
  const B = c.autoFit ? c.marginBottom : A4.h - c.marginTop - totalH;
  const positions = [];
  for (let r = 0; r < c.rows; r++) {
    for (let k = 0; k < c.cols; k++) {
      positions.push({ x: c.marginLeft + k * (W + c.gapX), y: c.marginTop + r * (H + c.gapY) });
    }
  }
  return { W, H, R, B, totalW, totalH, positions };
}

function gridProblem(g, c) {
  const eps = 0.001;
  if (!(c.cols >= 1 && c.rows >= 1)) return 'A grid needs at least one row and one column.';
  if (c.gapX < 0 || c.gapY < 0) return 'Gaps cannot be negative.';
  if (g.W < MIN_LABEL || g.H < MIN_LABEL) return `Labels would be smaller than ${MIN_LABEL} mm — reduce the margins, gaps or number of labels.`;
  if (c.marginLeft < -eps || c.marginTop < -eps || g.R < -eps || g.B < -eps) return 'That would push labels off the A4 page (210 × 297 mm).';
  return null;
}

/* Rebuild grid label geometry; label designs are kept by position. */
function syncGrid(s) {
  if (s.mode !== 'grid') return;
  const c = s.cfg;
  const g = gridGeometry(c);
  c.labelW = g.W;
  c.labelH = g.H;
  if (!c.autoFit) { c.marginRight = g.R; c.marginBottom = g.B; }
  c.preset = presetKeyFor(c.cols, c.rows);
  s.labels = g.positions.map((p, i) => Object.assign(s.labels[i] || newLabel(), {
    x: p.x, y: p.y, w: g.W, h: g.H, radius: c.radius, border: c.border, borderColor: c.borderColor,
  }));
}

function updateCfg(patch, { key = 'cfg', silent = false, history = true } = {}) {
  const s = App.sheet;
  const next = { ...s.cfg, ...patch };
  if (s.mode === 'grid') {
    if (('cols' in patch || 'rows' in patch) && !('labelW' in patch || 'labelH' in patch)) next.autoFit = true;
    if ('labelW' in patch || 'labelH' in patch) next.autoFit = false;
    if ('autoFit' in patch) next.autoFit = patch.autoFit;
    if (!next.autoFit) {
      // Fixed label size: moving the right/bottom margin slides the whole grid.
      const tw = next.cols * next.labelW + next.gapX * (next.cols - 1);
      const th = next.rows * next.labelH + next.gapY * (next.rows - 1);
      if ('marginRight' in patch) next.marginLeft = A4.w - patch.marginRight - tw;
      if ('marginBottom' in patch) next.marginTop = A4.h - patch.marginBottom - th;
    }
    const problem = gridProblem(gridGeometry(next), next);
    if (problem) {
      if (!silent) toast(problem, 'warn');
      return false;
    }
  }
  const apply = () => {
    s.cfg = next;
    if (s.mode === 'custom') {
      for (const k of ['radius', 'border', 'borderColor']) {
        if (k in patch) s.labels.forEach((l) => { l[k] = patch[k]; });
      }
    }
    syncGrid(s);
  };
  if (history) mutate(key, apply);
  else { apply(); App.onChange && App.onChange(); }
  return true;
}

/* ---------------------------------------------------------------- designs */

/* Uniform scale + centre: never stretches content. */
function scaleDesign(d, fw, fh, tw, th) {
  const s = Math.min(tw / fw, th / fh);
  const ox = (tw - fw * s) / 2;
  const oy = (th - fh * s) / 2;
  d.elements.forEach((e) => {
    e.x = ox + e.x * s;
    e.y = oy + e.y * s;
    e.w *= s;
    e.h *= s;
    if (typeof e.size === 'number') e.size *= s;
    for (const k of ['strokeWidth', 'radius', 'thickness']) if (typeof e[k] === 'number') e[k] *= s;
  });
}

/* Each label gets its own deep copy, so editing one never changes another. */
function applyDesignToLabel(label, design, srcW, srcH, scale) {
  const d = clone(design);
  d.elements.forEach((e) => { e.id = uid(); });
  if (scale && srcW && srcH && (Math.abs(srcW - label.w) > 0.01 || Math.abs(srcH - label.h) > 0.01)) {
    scaleDesign(d, srcW, srcH, label.w, label.h);
  }
  label.design = d;
}

function applyTemplateToLabel(label, tpl, scale) {
  applyDesignToLabel(label, { ...tpl.design, templateId: tpl.id, templateName: tpl.name }, tpl.w, tpl.h, scale);
}

/* ---------------------------------------------------------------- checks */

function sheetWarnings(s) {
  const out = [];
  const eps = 0.01;
  const c = s.cfg;
  const pa = { x0: c.marginLeft, y0: c.marginTop, x1: A4.w - c.marginRight, y1: A4.h - c.marginBottom };
  const pm = c.printerMargin || 0;
  s.labels.forEach((l, i) => {
    const n = i + 1;
    if (l.x < -eps || l.y < -eps || l.x + l.w > A4.w + eps || l.y + l.h > A4.h + eps) {
      out.push({ level: 'error', ids: [l.id], msg: `Label ${n} extends beyond the A4 page.` });
    } else if (s.mode === 'custom' && (l.x < pa.x0 - eps || l.y < pa.y0 - eps || l.x + l.w > pa.x1 + eps || l.y + l.h > pa.y1 + eps)) {
      out.push({ level: 'warn', ids: [l.id], msg: `Label ${n} goes outside the printable margins.` });
    }
    if (pm > 0 && l.design.elements.length && (l.x < pm - eps || l.y < pm - eps || l.x + l.w > A4.w - pm + eps || l.y + l.h > A4.h - pm + eps)) {
      out.push({ level: 'info', ids: [l.id], msg: `Label ${n} reaches within ${fmt(pm)} mm of the paper edge — most printers leave that strip blank.` });
    }
  });
  for (let i = 0; i < s.labels.length; i++) {
    for (let j = i + 1; j < s.labels.length; j++) {
      const a = s.labels[i];
      const b = s.labels[j];
      const ov = overlap(a, b);
      if (!ov || s.allowOverlap || a.allowOverlap || b.allowOverlap) continue;
      out.push({ level: 'error', ids: [a.id, b.id], msg: `Labels ${i + 1} and ${j + 1} overlap (${fmt(ov.w)} × ${fmt(ov.h)} mm).` });
    }
  }
  return out;
}

function fixSelection() {
  const u = App.ui;
  if (u.selLabel && !labelById(u.selLabel)) u.selLabel = null;
  if (!labelById(u.editLabelId)) u.editLabelId = App.sheet.labels[0] ? App.sheet.labels[0].id : null;
  const l = labelById(u.editLabelId);
  if (u.selEl && !(l && l.design.elements.some((e) => e.id === u.selEl))) u.selEl = null;
}

/* ---------------------------------------------------------------- history */

const History = { undo: [], redo: [], lastKey: null, lastT: 0, LIMIT: 60 };

function pushUndo(snapshot) {
  History.undo.push(snapshot);
  if (History.undo.length > History.LIMIT) History.undo.shift();
  History.redo = [];
}

/* Consecutive edits with the same key (e.g. typing in one field) merge into one undo step. */
function mutate(key, fn) {
  const now = Date.now();
  if (!(key && key === History.lastKey && now - History.lastT < 1200)) pushUndo(JSON.stringify(App.sheet));
  History.lastKey = key;
  History.lastT = now;
  fn();
  App.onChange && App.onChange();
}

const beginGesture = () => JSON.stringify(App.sheet);

function endGesture(before) {
  if (before !== JSON.stringify(App.sheet)) pushUndo(before);
  History.lastKey = null;
  App.onChange && App.onChange();
}

function undo() {
  if (!History.undo.length) return;
  History.redo.push(JSON.stringify(App.sheet));
  App.sheet = JSON.parse(History.undo.pop());
  History.lastKey = null;
  fixSelection();
  App.onChange && App.onChange(true);
}

function redo() {
  if (!History.redo.length) return;
  History.undo.push(JSON.stringify(App.sheet));
  App.sheet = JSON.parse(History.redo.pop());
  History.lastKey = null;
  fixSelection();
  App.onChange && App.onChange(true);
}

/* ---------------------------------------------------------------- storage */

let saveTimer = null;

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORE.sheet, JSON.stringify(App.sheet));
    localStorage.setItem(STORE.library, JSON.stringify(App.library));
    localStorage.setItem(STORE.data, JSON.stringify(App.data));
    if (App.imagesDirty) {
      localStorage.setItem(STORE.images, JSON.stringify(App.images));
      App.imagesDirty = false;
    }
    App.onSaved && App.onSaved(true);
  } catch (err) {
    console.error(err);
    App.onSaved && App.onSaved(false, err);
  }
}

function loadState() {
  const read = (k) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const sheet = read(STORE.sheet);
  const lib = read(STORE.library);
  const imgs = read(STORE.images);
  App.images = imgs && typeof imgs === 'object' ? imgs : {};
  App.data = { ...newData(), ...(read(STORE.data) || {}) };
  App.library = lib && Array.isArray(lib.templates) ? lib : seedLibrary();
  App.library.layouts = App.library.layouts || [];
  App.library.company = App.library.company || {};
  App.library.layouts.forEach((x) => migrateSheet(x.sheet));
  App.sheet = sheet && Array.isArray(sheet.labels) ? migrateSheet(sheet) : newSheet();
  gcImages();
  if (!lib) { App.imagesDirty = true; saveNow(); }
}

/* Drop stored images no longer referenced by the sheet or the library. */
function gcImages() {
  const refs = new Set((JSON.stringify([App.sheet, App.library]).match(/img_[a-z0-9]+/g)) || []);
  for (const k of Object.keys(App.images)) {
    if (!refs.has(k)) { delete App.images[k]; App.imagesDirty = true; }
  }
}

/* ---------------------------------------------------------------- images */

const imageURLCache = new Map();

/* Blob URLs keep the SVG markup small, so re-rendering while dragging stays fast. */
function imageURL(key) {
  if (imageURLCache.has(key)) return imageURLCache.get(key);
  const im = App.images[key];
  if (!im) return '';
  const [head, b64] = im.data.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  imageURLCache.set(key, url);
  return url;
}

/* Normalise any browser-readable image to PNG (if it has transparency) or JPEG. */
async function loadImageFile(file) {
  const dataURL = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Could not read the file.'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('That file is not a supported image.'));
    im.src = dataURL;
  });
  const MAX = 1600;
  let w = img.naturalWidth || 800;
  let h = img.naturalHeight || 800;
  const sc = Math.min(1, MAX / Math.max(w, h));
  w = Math.max(1, Math.round(w * sc));
  h = Math.max(1, Math.round(h * sc));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  let alpha = false;
  try {
    const px = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
  } catch {
    alpha = true;
  }
  const key = 'img_' + uid();
  App.images[key] = {
    data: alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.92),
    fmt: alpha ? 'PNG' : 'JPEG',
    w,
    h,
  };
  App.imagesDirty = true;
  return key;
}

/* ---------------------------------------------------------------- data merge */

/* Rows from a CSV, Excel sheet or AI extraction; each included row fills one label. */
function newData() {
  return { fileName: '', source: '', columns: [], rows: [], skip: [], mapping: {}, startAt: 1, copies: 1, enabled: true, notes: '' };
}

const FIELD_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/* Field names used as {{Field}} in any label's text or QR code, in first-seen order. */
function designFields(sheet = App.sheet) {
  const seen = new Set();
  for (const l of sheet.labels) {
    for (const e of l.design.elements) {
      const src = e.type === 'text' ? e.text : e.type === 'qr' ? e.data : '';
      for (const m of String(src || '').matchAll(FIELD_RE)) seen.add(m[1]);
    }
  }
  return [...seen];
}

const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const FIELD_SYNONYMS = [
  ['name', 'fullname', 'customer', 'customername', 'recipient', 'contactname', 'consignee'],
  ['address', 'addr', 'shippingaddress', 'deliveryaddress', 'address1', 'street'],
  ['phone', 'mobile', 'phoneno', 'phonenumber', 'contact', 'mobileno', 'tel'],
  ['pin', 'pincode', 'zip', 'zipcode', 'postcode', 'postalcode'],
  ['order', 'orderid', 'orderno', 'ordernumber', 'awb', 'trackingno', 'tracking'],
  ['sku', 'itemcode', 'productcode', 'code'],
  ['product', 'productname', 'item', 'itemname', 'title'],
  ['price', 'mrp', 'amount', 'rate'],
];

/* Guess which data column fills each {{field}}. */
function autoMap(fields, columns, current = {}) {
  const out = {};
  const cols = columns.map((c) => ({ c, k: normKey(c) }));
  for (const f of fields) {
    if (current[f] && columns.includes(current[f])) { out[f] = current[f]; continue; }
    const k = normKey(f);
    let hit = cols.find((x) => x.k === k);
    if (!hit) {
      const group = FIELD_SYNONYMS.find((g) => g.includes(k));
      if (group) hit = cols.find((x) => group.includes(x.k));
    }
    if (!hit && k.length > 2) hit = cols.find((x) => x.k.includes(k) || (x.k.length > 2 && k.includes(x.k)));
    out[f] = hit ? hit.c : '';
  }
  return out;
}

const dataRows = (d = App.data) => d.rows.filter((_, i) => !d.skip.includes(i));
const dataActive = (d = App.data) => !!(d && d.enabled && d.rows.length);

/* The {{field}} → value lookup for one data row. */
function recordFor(row, d = App.data) {
  const rec = {};
  for (const [field, col] of Object.entries(d.mapping)) {
    const i = d.columns.indexOf(col);
    rec[field] = i >= 0 ? (row[i] == null ? '' : String(row[i])) : '';
  }
  return rec;
}

function fillFields(s, rec) {
  return String(s || '').replace(FIELD_RE, (_, f) => (f in rec ? rec[f] : ''));
}

/* A copy of a design with every {{field}} replaced by the record's values. */
function mergeDesign(design, rec) {
  if (!rec) return design;
  return {
    ...design,
    elements: design.elements.map((e) => {
      if (e.type === 'text') {
        const m = { ...e, text: fillFields(e.text, rec) };
        m.h = textMetrics(m).height;
        return m;
      }
      if (e.type === 'qr') return { ...e, data: fillFields(e.data, rec) };
      return e;
    }),
  };
}

/* Which data row lands on each label position of each page. null = leave that position empty. */
function mergePlan(sheet = App.sheet, d = App.data) {
  const per = sheet.labels.length;
  const rows = dataRows(d);
  const copies = Math.max(1, d.copies | 0);
  const skip = clamp((d.startAt | 0) - 1, 0, per - 1);
  const total = skip + rows.length * copies;
  const pages = Math.max(1, Math.ceil(total / per));
  const plan = [];
  for (let p = 0; p < pages; p++) {
    const page = [];
    for (let pos = 0; pos < per; pos++) {
      const slot = p * per + pos - skip;
      page.push(slot >= 0 && slot < rows.length * copies ? rows[Math.floor(slot / copies)] : null);
    }
    plan.push(page);
  }
  return { pages: plan, labels: rows.length * copies, records: rows.length };
}

function saveData() {
  try {
    localStorage.setItem(STORE.data, JSON.stringify(App.data));
  } catch (err) {
    console.error(err);
    App.onSaved && App.onSaved(false, err);
  }
}

/* The design a position prints with when filling from data. A position with no design of its own
   borrows the first designed label's design, scaled evenly to fit, so designing one label is enough. */
function designForMerge(sheet, label) {
  if (label.design.elements.length) return label.design;
  const src = sheet.labels.find((l) => l.design.elements.length);
  if (!src) return label.design;
  const d = clone(src.design);
  if (Math.abs(src.w - label.w) > 0.01 || Math.abs(src.h - label.h) > 0.01) scaleDesign(d, src.w, src.h, label.w, label.h);
  return d;
}

/* What a label position shows on screen while data is loaded: the design that position prints with,
   filled with the data row that lands on it on page 1. Null when there is nothing to preview. */
function previewDesignFor(sheet, label, pos) {
  if (!App.ui.previewData || !dataActive() || !designFields(sheet).length) return null;
  const row = mergePlan(sheet).pages[0][pos];
  return row ? mergeDesign(designForMerge(sheet, label), recordFor(row)) : null;
}

'use strict';
/* Small DOM kit: element builder, bound form fields, toasts and dialogs. */

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    n.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return n;
}

/* Fields register a refresh function so values follow the model (drags, undo)
   without rebuilding the panel — rebuilding would steal focus while typing. */
const Bind = {
  list: [],
  reset() { this.list = []; },
  add(fn) { this.list.push(fn); fn(); },
  sync() { for (const f of this.list) f(); },
};

const btn = (label, onClick, cls = '', title) => h('button', { type: 'button', class: 'btn ' + cls, title, onclick: onClick }, label);
const section = (title, ...kids) => h('section', { class: 'sec' }, title ? h('h3', {}, title) : null, ...kids);
const hint = (text) => h('p', { class: 'hint' }, text);
const row = (...kids) => h('div', { class: 'row-btns' }, ...kids);

function dynText(fn, cls = '') {
  const s = h('span', { class: cls });
  Bind.add(() => { s.textContent = fn(); });
  return s;
}

function kv(label, fn) {
  return h('div', { class: 'kv' }, h('span', {}, label), dynText(fn));
}

function fieldShell(o, ...ctl) {
  return h('div', { class: 'field' + (o.wide ? ' wide' : ''), title: o.title }, h('span', { class: 'lbl' }, o.label), h('span', { class: 'ctl' }, ...ctl));
}

function numField(o) {
  const step = o.step == null ? 0.5 : o.step;
  const input = h('input', { type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': o.label });
  const apply = (v, live) => {
    if (!Number.isFinite(v)) return;
    v = clamp(v, o.min == null ? -1e6 : o.min, o.max == null ? 1e6 : o.max);
    if (o.int) v = Math.round(v);
    o.set(v, live);
  };
  input.addEventListener('input', () => apply(parseFloat(input.value), true));
  input.addEventListener('change', () => { apply(parseFloat(input.value), false); input.value = fmt(o.get()); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const bump = (dir) => (e) => {
    const mult = e.shiftKey ? 10 : e.altKey ? 0.2 : 1;
    apply(r2((o.get() || 0) + dir * step * mult), false);
    input.value = fmt(o.get());
  };
  const tip = `${step}${o.unit === '' ? '' : ' ' + (o.unit || 'mm')} (Shift ×10, Alt ×0.2)`;
  const minus = h('button', { type: 'button', class: 'step', title: '− ' + tip, onclick: bump(-1) }, '−');
  const plus = h('button', { type: 'button', class: 'step', title: '+ ' + tip, onclick: bump(1) }, '+');
  const wrap = fieldShell(o, minus, input, plus, o.unit === '' ? null : h('span', { class: 'unit' }, o.unit || 'mm'));
  Bind.add(() => {
    if (document.activeElement !== input) input.value = fmt(o.get());
    const d = !!(o.disabled && o.disabled());
    input.disabled = minus.disabled = plus.disabled = d;
    wrap.classList.toggle('disabled', d);
  });
  return wrap;
}

function colorField(o) {
  const input = h('input', { type: 'color', 'aria-label': o.label });
  input.addEventListener('input', () => o.set(input.value, true));
  input.addEventListener('change', () => o.set(input.value, false));
  const code = h('span', { class: 'unit wide-unit' });
  const wrap = fieldShell(o, input, code, o.extra || null);
  Bind.add(() => {
    const v = o.get() || '#000000';
    if (document.activeElement !== input) input.value = v;
    code.textContent = v.toUpperCase();
    const d = !!(o.disabled && o.disabled());
    input.disabled = d;
    wrap.classList.toggle('disabled', d);
  });
  return wrap;
}

function selectField(o) {
  const sel = h('select', { 'aria-label': o.label });
  const opts = typeof o.options === 'function' ? o.options() : o.options;
  for (const [v, label] of opts) sel.append(h('option', { value: v }, label));
  sel.addEventListener('change', () => o.set(sel.value));
  Bind.add(() => { if (document.activeElement !== sel) sel.value = o.get(); });
  return fieldShell(o, sel);
}

function checkField(o) {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => o.set(input.checked));
  const wrap = h('label', { class: 'check', title: o.title }, input, h('span', {}, o.label));
  Bind.add(() => {
    input.checked = !!o.get();
    input.disabled = !!(o.disabled && o.disabled());
  });
  return wrap;
}

function textAreaField(o) {
  const ta = h('textarea', { rows: o.rows || 3, id: o.id, spellcheck: 'true', 'aria-label': o.label });
  ta.addEventListener('input', () => o.set(ta.value));
  Bind.add(() => { if (document.activeElement !== ta) ta.value = o.get() || ''; });
  return h('div', { class: 'field wide' }, h('span', { class: 'lbl' }, o.label), ta);
}

function segField(o) {
  const btns = o.options.map(([v, label, title]) => h('button', { type: 'button', title, onclick: () => o.set(v) }, label));
  Bind.add(() => {
    const cur = o.get();
    btns.forEach((b, i) => b.classList.toggle('on', o.options[i][0] === cur));
  });
  return fieldShell(o, h('div', { class: 'seg' }, ...btns));
}

function toggleField(label, items) {
  const btns = items.map((it) => h('button', { type: 'button', title: it.title, style: it.style, onclick: () => it.set(!it.get()) }, it.label));
  Bind.add(() => btns.forEach((b, i) => b.classList.toggle('on', !!items[i].get())));
  return fieldShell({ label }, h('div', { class: 'seg' }, ...btns));
}

/* ---------------------------------------------------------------- toasts */

function toast(msg, kind = 'info') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3800);
}

/* ---------------------------------------------------------------- dialogs */

function openModal(title, build, { wide, full } = {}) {
  let resolveFn;
  const done = new Promise((r) => { resolveFn = r; });
  const dlg = h('dialog', { class: 'modal' + (wide ? ' wide' : '') + (full ? ' full' : '') });
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const close = (v = null) => {
    if (!dlg.isConnected) return;
    dlg.close();
    dlg.remove();
    resolveFn(v);
  };
  dlg.append(h('div', { class: 'modal-head' }, h('h2', {}, title), btn('✕', () => close(null), 'icon ghost', 'Close')), body, foot);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  document.body.append(dlg);
  build(body, foot, close);
  dlg.showModal();
  return done;
}

function askText(title, label, value = '') {
  return openModal(title, (body, foot, close) => {
    const input = h('input', { type: 'text', class: 'text-input' });
    input.value = value;
    const ok = () => {
      const v = input.value.trim();
      if (v) close(v); else input.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    body.append(h('label', { class: 'stack' }, h('span', { class: 'lbl' }, label), input));
    foot.append(btn('Cancel', () => close(null), 'ghost'), btn('Save', ok, 'primary'));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

function confirmBox(title, message, okLabel = 'OK', danger = false) {
  return openModal(title, (body, foot, close) => {
    body.append(h('p', { class: 'modal-text' }, message));
    foot.append(btn('Cancel', () => close(false), 'ghost'), btn(okLabel, () => close(true), danger ? 'danger-solid' : 'primary'));
  }).then(Boolean);
}

/* ---------------------------------------------------------------- layout helpers */

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

/* Space available for the canvas inside the stage, excluding its padding. */
function stageBox() {
  const w = $('#canvasWrap');
  const cs = getComputedStyle(w);
  return {
    w: w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2,
    h: w.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2,
  };
}

/* ---------------------------------------------------------------- icons & building blocks */

const ICON_PATHS = {
  layout: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  field: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17 21h4v-4"/>',
  rect: '<rect x="3.5" y="6" width="17" height="12" rx="2"/>',
  ellipse: '<circle cx="12" cy="12" r="8.5"/>',
  line: '<path d="M4 12h16"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  paste: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  shapes: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="17" cy="17" r="4"/><path d="M14 3l4 7h-8z" transform="translate(3 0)"/>',
};

function icon(name, size = 18) {
  return h('span', {
    class: 'i',
    'aria-hidden': 'true',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`,
  });
}

/* Button with a leading icon. */
const ibtn = (name, label, onClick, cls = '', title) => btn([icon(name, 16), label ? h('span', {}, label) : null], onClick, 'with-icon ' + cls, title || (label ? undefined : name));

/* Collapsible panel section; remembers whether the person opened or closed it. */
function group(id, title, opts, ...kids) {
  const open = App.ui.open[id] != null ? App.ui.open[id] : opts.open !== false;
  const d = h('details', { class: 'sec group', open: open || null },
    h('summary', {}, h('span', { class: 'sum-title' }, title), opts.meta ? h('span', { class: 'sum-meta' }, opts.meta) : null, icon('right', 14)),
    h('div', { class: 'group-body' }, ...kids));
  d.addEventListener('toggle', () => { App.ui.open[id] = d.open; });
  return d;
}

/* Grid of picture cards (layout presets, arrangements, templates). */
function cardGrid(items, cls = '') {
  const els = items.map((it) => h('button', { type: 'button', class: 'card', title: it.title || it.label, onclick: it.onClick },
    h('span', { class: 'card-pic', html: it.svg }), h('span', { class: 'card-label' }, it.label)));
  Bind.add(() => els.forEach((b, i) => b.classList.toggle('on', !!(items[i].active && items[i].active()))));
  return h('div', { class: 'cards ' + cls }, ...els);
}

/* Mini sheet drawing for a layout card: boxes in mm on an A4 page. */
function sheetPic(boxes, w = 42) {
  const r = boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>`).join('');
  return `<svg viewBox="0 0 210 297" width="${w}" height="${(w * 297) / 210}"><rect width="210" height="297" rx="8" class="pg"/><g class="lb">${r}</g></svg>`;
}

function gridBoxes(cols, rows, m = 12, g = 8) {
  const w = (210 - 2 * m - g * (cols - 1)) / cols;
  const hh = (297 - 2 * m - g * (rows - 1)) / rows;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: m + c * (w + g), y: m + r * (hh + g), w, h: hh });
  return out;
}

/* Drop area for files; also opens the file picker on click. */
function dropZone({ accept, title, sub, onFiles }) {
  const input = h('input', { type: 'file', accept, hidden: true });
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  const z = h('button', { type: 'button', class: 'drop', onclick: () => input.click() },
    icon('upload', 22), h('strong', {}, title), h('span', {}, sub), input);
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => {
    e.preventDefault();
    z.classList.remove('over');
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
  return z;
}

/* Small "empty state" note with an icon. */
const note = (name, text, cls = '') => h('div', { class: 'note ' + cls }, icon(name, 16), h('span', {}, text));

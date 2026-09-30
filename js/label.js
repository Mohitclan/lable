'use strict';
/* Mode B — Individual Label Designer: design the content of one label (mm, label-local). */

const EL_ICON = { text: 'T', image: '▣', qr: '▦', rect: '▭', ellipse: '◯', line: '—' };
const EL_TITLE = { text: 'Text', image: 'Image / logo', qr: 'QR code', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Divider line' };
const SAFE = 2; // mm safe zone shown inside the label edge

/* Characters the built-in PDF fonts (WinAnsi) can print. */
const PRINTABLE = /^[\x09\x0A\x0D\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]*$/;

function elName(e) {
  if (e.type === 'text') {
    const first = String(e.text || '').split('\n')[0].trim();
    return first ? `“${first.length > 24 ? first.slice(0, 24) + '…' : first}”` : 'Empty text';
  }
  return EL_TITLE[e.type] || e.type;
}

/* Where the element actually paints, for edge warnings (text uses real glyph widths). */
function visualBounds(e) {
  if (e.type !== 'text') return e;
  const m = textMetrics(e);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const ln of m.lines) {
    if (!ln.length) continue;
    const w = textWidthMM(e, ln);
    const ax = textAnchorX(e);
    const s = e.align === 'center' ? ax - w / 2 : e.align === 'right' ? ax - w : ax;
    x0 = Math.min(x0, s);
    x1 = Math.max(x1, s + w);
  }
  if (x0 === Infinity) return { x: e.x, y: e.y, w: 0, h: 0 };
  return { x: x0, y: e.y, w: x1 - x0, h: m.height };
}

function labelWarnings(l) {
  const out = [];
  const tol = 0.05;
  l.design.elements.forEach((e) => {
    const name = elName(e);
    const b = visualBounds(e);
    if (b.w > 0 && (b.x < -tol || b.y < -tol || b.x + b.w > l.w + tol || b.y + b.h > l.h + tol)) {
      out.push({ level: 'warn', ids: [e.id], msg: `${name} runs past the label edge and will be cut off.` });
    } else if (b.w > 0 && l.w > 2 * SAFE && (b.x < SAFE - tol || b.y < SAFE - tol || b.x + b.w > l.w - SAFE + tol || b.y + b.h > l.h - SAFE + tol) && e.type !== 'rect') {
      out.push({ level: 'info', ids: [e.id], msg: `${name} is inside the ${SAFE} mm edge zone — it may be trimmed if the sheet shifts in the printer.` });
    }
    if (e.type === 'text' && !PRINTABLE.test(e.text || '')) {
      out.push({ level: 'warn', ids: [e.id], msg: `${name} has characters (e.g. ₹ or emoji) the built-in PDF fonts cannot print.` });
    }
    if (e.type === 'text' && e.w > 0) {
      const tb = visualBounds(e);
      if (tb.w > e.w + 0.5) out.push({ level: 'info', ids: [e.id], msg: `${name} is wider than its text box.` });
    }
    if (e.type === 'image') {
      const im = App.images[e.imgKey];
      if (!im) out.push({ level: 'error', ids: [e.id], msg: 'An image is missing from storage — replace it.' });
      else {
        const f = fitContain(e, im.w, im.h);
        const dpi = im.w / (f.w / 25.4);
        if (dpi < 150) out.push({ level: 'info', ids: [e.id], msg: `Image prints at about ${Math.round(dpi)} dpi — it may look soft. Use a larger image or make it smaller.` });
      }
    }
    if (e.type === 'qr') {
      const m = qrMatrix(e.data, e.ecc);
      if (!m) out.push({ level: 'error', ids: [e.id], msg: 'QR code has too much data — shorten it or lower the error correction.' });
      else if (Math.min(e.w, e.h) / m.length < 0.33) out.push({ level: 'warn', ids: [e.id], msg: `QR modules are only ${fmt(Math.min(e.w, e.h) / m.length)} mm — make the code bigger so phones can scan it.` });
    }
  });
  return out;
}

/* ---------------------------------------------------------------- element actions */

function curLabel() { return LabelView.label(); }
function findEl(id) { return curLabel().design.elements.find((e) => e.id === id) || null; }

function newTextEl(l, props = {}) {
  const e = {
    id: uid(), type: 'text', text: 'Your text', font: 'helvetica', size: clamp(Math.round(Math.min(l.w, l.h) * 0.12), 8, 28),
    bold: false, italic: false, align: 'center', color: '#111827', lineHeight: 1.2, x: Math.min(5, l.w * 0.06), y: 0, w: 0, h: 0, ...props,
  };
  e.size = Math.round(e.size * 2) / 2;
  if (!props.w) e.w = Math.max(5, l.w - 2 * e.x);
  e.h = textMetrics(e).height;
  if (props.y == null) e.y = (l.h - e.h) / 2;
  return e;
}

function addElements(els) {
  if (!els.length) return;
  if (isMobile()) showSheet(null);
  const l = curLabel();
  mutate('add-el', () => l.design.elements.push(...els));
  App.ui.selEl = els[els.length - 1].id;
}

function insertText() {
  addElements([newTextEl(curLabel())]);
  setTimeout(() => {
    if (isMobile()) showSheet('right');
    const ta = $('#propText');
    if (ta) { ta.focus({ preventScroll: true }); ta.select(); }
  }, 60);
}

function insertShape(type) {
  const l = curLabel();
  const m = Math.min(l.w, l.h);
  if (type === 'line') {
    const w = Math.max(5, l.w - 20);
    addElements([{ id: uid(), type: 'line', dir: 'h', thickness: 0.4, color: '#111827', x: (l.w - w) / 2, y: l.h / 2 - 1.5, w, h: 3 }]);
    return;
  }
  const w = type === 'ellipse' ? m * 0.35 : m * 0.5;
  const hgt = type === 'ellipse' ? w : m * 0.3;
  addElements([{
    id: uid(), type, x: (l.w - w) / 2, y: (l.h - hgt) / 2, w, h: hgt,
    fill: '#e5e7eb', noFill: false, stroke: '#111827', strokeWidth: 0, radius: type === 'rect' ? 2 : 0,
  }]);
}

function insertQR() {
  const l = curLabel();
  const size = Math.max(10, Math.min(30, Math.min(l.w, l.h) * 0.45));
  const c = App.library.company || {};
  addElements([{
    id: uid(), type: 'qr', data: c.website ? (c.website.startsWith('http') ? c.website : 'https://' + c.website) : 'https://example.com',
    ecc: 'M', color: '#000000', bg: '#ffffff', bgNone: false, x: (l.w - size) / 2, y: (l.h - size) / 2, w: size, h: size,
  }]);
}

function pickImage() {
  return new Promise((res) => {
    const inp = $('#fileImage');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) { res(null); return; }
      try {
        res(await loadImageFile(f));
      } catch (err) {
        toast('Could not use that image: ' + err.message, 'error');
        res(null);
      }
    };
    inp.click();
  });
}

async function insertImage() {
  const key = await pickImage();
  if (!key) return;
  const l = curLabel();
  const im = App.images[key];
  const s = Math.min((l.w * 0.6) / im.w, (l.h * 0.4) / im.h);
  const w = im.w * s;
  const hgt = im.h * s;
  addElements([{ id: uid(), type: 'image', imgKey: key, x: (l.w - w) / 2, y: (l.h - hgt) / 2, w, h: hgt }]);
}

async function replaceImage(id) {
  const key = await pickImage();
  const e = findEl(id);
  if (!key || !e) return;
  const im = App.images[key];
  mutate('img.' + id, () => {
    e.imgKey = key;
    const cx = e.x + e.w / 2;
    e.h = e.w * (im.h / im.w);
    e.x = cx - e.w / 2;
  });
}

async function insertCompanyInfo() {
  let c = App.library.company || {};
  if (!c.name && !c.address && !c.phone && !c.email && !c.website && !c.logoKey) {
    toast('Fill in your company profile first.');
    if (!(await openCompanyDialog())) return;
    c = App.library.company;
  }
  const l = curLabel();
  const m = Math.min(5, l.w * 0.06);
  let y = m;
  const els = [];
  if (c.logoKey && App.images[c.logoKey]) {
    const im = App.images[c.logoKey];
    const s = Math.min((l.w * 0.4) / im.w, (l.h * 0.22) / im.h);
    const w = im.w * s;
    const hgt = im.h * s;
    els.push({ id: uid(), type: 'image', imgKey: c.logoKey, x: (l.w - w) / 2, y, w, h: hgt });
    y += hgt + 3;
  }
  const base = clamp(Math.min(l.w, l.h) * 0.11, 7, 16);
  if (c.name) {
    const e = newTextEl(l, { text: c.name, size: base * 1.25, bold: true, y });
    els.push(e);
    y += e.h + 2.5;
  }
  const details = [c.address, c.phone && 'Phone: ' + c.phone, c.email && 'Email: ' + c.email, c.website].filter(Boolean).join('\n');
  if (details) els.push(newTextEl(l, { text: details, size: base * 0.78, color: '#374151', y }));
  addElements(els);
}

function setElProp(id, prop, v) {
  const e = findEl(id);
  if (!e) return;
  mutate(`el.${id}.${prop}`, () => {
    if (prop === 'thickness') {
      e.thickness = v;
      if (isVertical(e)) { const cx = e.x + e.w / 2; e.w = Math.max(3, v + 1); e.x = cx - e.w / 2; }
      else { const cy = e.y + e.h / 2; e.h = Math.max(3, v + 1); e.y = cy - e.h / 2; }
    } else if (prop === 'dir') {
      if (e.dir === v) return;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      [e.w, e.h] = [e.h, e.w];
      e.x = cx - e.w / 2;
      e.y = cy - e.h / 2;
      e.dir = v;
    } else if (prop === 'qrSize') {
      e.w = v;
      e.h = v;
    } else {
      e[prop] = v;
    }
    if (e.type === 'text') e.h = textMetrics(e).height;
  });
}

function duplicateEl(id) {
  const e = findEl(id);
  if (!e) return;
  const copy = { ...clone(e), id: uid(), x: e.x + 3, y: e.y + 3 };
  addElements([copy]);
}

function deleteEl(id) {
  const l = curLabel();
  mutate('del-el', () => { l.design.elements = l.design.elements.filter((e) => e.id !== id); });
  App.ui.selEl = null;
}

function reorderEl(id, where) {
  const els = curLabel().design.elements;
  const i = els.findIndex((e) => e.id === id);
  if (i < 0) return;
  const j = { up: i + 1, down: i - 1, top: els.length - 1, bottom: 0 }[where];
  if (j < 0 || j >= els.length || j === i) return;
  mutate('order', () => { const [e] = els.splice(i, 1); els.splice(j, 0, e); });
}

function alignEl(id, how) {
  const e = findEl(id);
  const l = curLabel();
  if (!e) return;
  const inset = Math.min(SAFE, l.w / 4, l.h / 4);
  mutate('align.' + id, () => {
    if (how === 'left') e.x = inset;
    if (how === 'hcenter') e.x = (l.w - e.w) / 2;
    if (how === 'right') e.x = l.w - inset - e.w;
    if (how === 'top') e.y = inset;
    if (how === 'vmiddle') e.y = (l.h - e.h) / 2;
    if (how === 'bottom') e.y = l.h - inset - e.h;
  });
}

async function applyTemplateHere() {
  const tpl = App.library.templates.find((t) => t.id === App.ui.tplChoice);
  if (!tpl) { toast('Choose a saved label design first.', 'warn'); return; }
  const l = curLabel();
  if (l.design.elements.length && !(await confirmBox('Replace this label’s content?', `Load “${tpl.name}” into Label ${labelIndex(l.id) + 1}? The current content is replaced (Ctrl+Z to undo).`, 'Replace'))) return;
  mutate('tpl-here', () => applyTemplateToLabel(l, tpl, App.ui.scaleTpl));
  App.ui.selEl = null;
  toast(`Loaded “${tpl.name}”.`, 'ok');
}

async function saveTemplate(asNew) {
  const l = curLabel();
  const d = l.design;
  let tpl = !asNew && d.templateId ? App.library.templates.find((t) => t.id === d.templateId) : null;
  if (!tpl) {
    const name = await askText('Save label design as template', 'Template name', d.templateName || `Label ${labelIndex(l.id) + 1} design`);
    if (!name) return;
    tpl = App.library.templates.find((t) => t.name.toLowerCase() === name.toLowerCase()) || null;
    if (tpl && !(await confirmBox('Replace template?', `A template called “${tpl.name}” already exists. Replace it with this design?`, 'Replace'))) return;
    if (!tpl) {
      tpl = { id: uid(), name };
      App.library.templates.push(tpl);
    }
  }
  normalizeDesign(d);
  const copy = clone(d);
  delete copy.templateId;
  delete copy.templateName;
  Object.assign(tpl, { design: copy, w: l.w, h: l.h, savedAt: Date.now() });
  d.templateId = tpl.id;
  d.templateName = tpl.name;
  App.ui.tplChoice = tpl.id;
  saveSoon();
  requestRender(true);
  toast(`Saved template “${tpl.name}”.`, 'ok');
}

function switchLabel(id) {
  if (!labelById(id)) return;
  App.ui.editLabelId = id;
  App.ui.selLabel = id;
  App.ui.selEl = null;
  App.ui.zoom.label = null;
  requestRender(true);
}

function stepLabel(dir) {
  const ls = App.sheet.labels;
  const i = labelIndex(curLabel().id);
  switchLabel(ls[(i + dir + ls.length) % ls.length].id);
}

/* ---------------------------------------------------------------- view */

const LabelView = {
  drag: null,
  guides: [],
  px: 0.1,

  label() { return labelById(App.ui.editLabelId) || App.sheet.labels[0]; },
  selEl() { return this.label().design.elements.find((e) => e.id === App.ui.selEl) || null; },
  vb() {
    const l = this.label();
    const p = Math.max(6, Math.max(l.w, l.h) * 0.08);
    return [-p, -p, l.w + 2 * p, l.h + 2 * p];
  },
  fitPPM() {
    const s = stageBox();
    const [, , w, h] = this.vb();
    return Math.max(0.5, Math.min(s.w / w, s.h / h));
  },
  ppm() { return App.ui.zoom.label || this.fitPPM(); },
  elHandles(e) {
    if (e.type === 'text') return ['w', 'e'];
    if (e.type === 'line') return isVertical(e) ? ['n', 's'] : ['w', 'e'];
    return ALL_HANDLES;
  },
  snapTargets(id) {
    const l = this.label();
    const xs = [0, l.w / 2, l.w, SAFE, l.w - SAFE];
    const ys = [0, l.h / 2, l.h, SAFE, l.h - SAFE];
    for (const o of l.design.elements) {
      if (o.id === id) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    return { xs, ys };
  },

  renderCanvas() {
    const l = this.label();
    const d = l.design;
    const svg = $('#canvas');
    normalizeDesign(d);
    const vb = this.vb();
    const ppm = this.ppm();
    const px = 1 / ppm;
    this.px = px;
    svg.setAttribute('viewBox', vb.join(' '));
    svg.style.width = vb[2] * ppm + 'px';
    svg.style.height = vb[3] * ppm + 'px';
    const r = cornerR(l);
    let o = `<defs><filter id="lblShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${2 * px}" stdDeviation="${6 * px}" flood-color="#0f172a" flood-opacity="0.18"/></filter></defs>`;
    o += `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="#fff" filter="url(#lblShadow)"/>`;
    o += designSVG(l, this.shownDesign(), 'ld', { ghost: true });
    if (l.w > 4 * SAFE && l.h > 4 * SAFE) {
      o += `<rect x="${SAFE}" y="${SAFE}" width="${l.w - 2 * SAFE}" height="${l.h - 2 * SAFE}" rx="${Math.max(0, r - SAFE)}" fill="none" stroke="#a5b4fc" stroke-width="${px}" stroke-dasharray="${4 * px} ${4 * px}"/>`;
    }
    o += `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="none" stroke="${l.border > 0 ? esc(l.borderColor) : '#cbd2db'}" stroke-width="${Math.max(l.border || 0, px)}"/>`;
    if (!d.elements.length) {
      const fs = clamp(Math.min(l.w, l.h) * 0.05, 2, 5);
      o += `<text x="${l.w / 2}" y="${l.h / 2}" text-anchor="middle" font-family="${FONT_CSS.helvetica}" font-size="${fs}" fill="#9aa3af">Empty label — use “Insert” on the left</text>`;
      o += `<text x="${l.w / 2}" y="${l.h / 2 + fs * 1.5}" text-anchor="middle" font-family="${FONT_CSS.helvetica}" font-size="${fs * 0.75}" fill="#b8bec8">or load a saved template</text>`;
    }
    const e = this.selEl();
    if (e) {
      o += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="none" stroke="#2563eb" stroke-width="${1.5 * px}" stroke-dasharray="${5 * px} ${3 * px}"/>`;
      o += handlesSVG(e, this.elHandles(e), px);
    }
    o += guidesSVG(this.guides, vb, px);
    svg.innerHTML = o;
  },

  pointerDown(e, p) {
    const l = this.label();
    const px = this.px;
    let hit = null;
    const sel = this.selEl();
    if (sel) {
      const hd = hitHandle(sel, this.elHandles(sel), p, HIT_PX * px);
      if (hd) hit = { kind: 'resize', hd, id: sel.id };
    }
    if (!hit) {
      const t = [...l.design.elements].reverse().find((x) => inBox(p, x, EL_PAD_PX * px));
      if (t) hit = { kind: 'move', id: t.id };
    }
    if (!hit) {
      if (App.ui.selEl) { App.ui.selEl = null; requestRender(); }
      return;
    }
    if (App.ui.selEl !== hit.id) { App.ui.selEl = hit.id; requestRender(); }
    const t = findEl(hit.id);
    this.drag = { ...hit, p0: p, b0: { x: t.x, y: t.y, w: t.w, h: t.h }, before: beginGesture(), moved: false, aspect: t.type === 'image' || t.type === 'qr' };
    try { $('#canvas').setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    e.preventDefault();
    return true;
  },

  pointerMove(e, p) {
    const d = this.drag;
    const px = this.px;
    if (!d) { this.hover(p); return; }
    const dx = p.x - d.p0.x;
    const dy = p.y - d.p0.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_START_PX * px) return;
    d.moved = true;
    const t = findEl(d.id);
    if (!t) return;
    const keep = d.kind === 'resize' && d.aspect && !e.shiftKey;
    const nb = d.kind === 'move' ? { ...d.b0, x: d.b0.x + dx, y: d.b0.y + dy } : resizeBox(d.b0, d.hd, dx, dy, 1, keep);
    this.guides = [];
    if (!e.altKey && !keep) {
      const tg = this.snapTargets(t.id);
      this.guides = snapBox(nb, d.kind, d.hd, tg.xs, tg.ys, 6 * px);
    }
    if (nb.w < 1 || nb.h < 1) return;
    Object.assign(t, { x: nb.x, y: nb.y, w: nb.w, h: t.type === 'text' ? t.h : nb.h });
    requestRender();
  },

  pointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.guides = [];
    if (d.moved) endGesture(d.before);
    requestRender();
  },

  hover(p) {
    const svg = $('#canvas');
    const sel = this.selEl();
    const hd = sel && hitHandle(sel, this.elHandles(sel), p, HIT_PX * this.px);
    if (hd) { svg.style.cursor = HANDLE_CURSOR[hd]; return; }
    svg.style.cursor = this.label().design.elements.some((x) => inBox(p, x, EL_PAD_PX * this.px)) ? 'move' : 'default';
  },

  dblClick() {
    const e = this.selEl();
    if (e && e.type === 'text') {
      if (isMobile()) showSheet('right');
      const ta = $('#propText');
      if (ta) { ta.focus({ preventScroll: true }); ta.select(); }
    } else if (e && e.type === 'image') replaceImage(e.id);
  },

  deselect() {
    if (App.ui.selEl) { App.ui.selEl = null; requestRender(); }
  },

  onKey(e) {
    const el = this.selEl();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { this.deselect(); return; }
    if (e.key === 'PageDown') { e.preventDefault(); stepLabel(1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); stepLabel(-1); return; }
    if (!el) return;
    const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) {
      e.preventDefault();
      mutate('nudge.' + el.id, () => { el.x += mv[0]; el.y += mv[1]; });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteEl(el.id);
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateEl(el.id);
    } else if (e.key === 'Enter' && el.type === 'text') {
      e.preventDefault();
      this.dblClick();
    }
  },

  /* ---------------- panels */

  /* The design as shown on screen: filled with the first data row when preview is on. */
  shownDesign() {
    const d = this.label().design;
    if (!App.ui.previewData || !dataActive() || !designFields().length) return d;
    const first = dataRows()[0];
    return first ? mergeDesign(d, recordFor(first)) : d;
  },

  panelKey() {
    const l = this.label();
    const e = this.selEl();
    return ['label', l.id, App.ui.selEl, e && e.type, e && e.dir, l.design.elements.length, App.library.templates.length,
      App.sheet.labels.length, l.design.templateId, App.sheet.mode, App.data.columns.join('\u0001')].join('|');
  },

  renderPanels() {
    const L = $('#leftPanel');
    const R = $('#rightPanel');
    L.replaceChildren();
    R.replaceChildren();
    const l = this.label();
    const lid = l.id;

    const add = (name, label, fn, title) => h('button', { type: 'button', class: 'tool', title: title || label, onclick: fn }, icon(name, 20), h('span', {}, label));
    L.append(section('Add to label',
      h('div', { class: 'tools' },
        add('text', 'Text', insertText),
        add('field', 'Data field', insertFieldDialog, 'A {{field}} that is filled from your data in step 3'),
        add('image', 'Image', insertImage),
        add('qr', 'QR code', insertQR),
        add('rect', 'Box', () => insertShape('rect')),
        add('ellipse', 'Circle', () => insertShape('ellipse')),
        add('line', 'Line', () => insertShape('line')),
        add('building', 'Company', insertCompanyInfo, 'Name, address and contact details from your company profile'),
      ),
    ));

    L.append(group('layers', 'Layers', { meta: dynText(() => String(this.label().design.elements.length)) }, h('div', { class: 'layers', id: 'layers' })));

    const tplName = () => {
      const t = l.design.templateId && App.library.templates.find((x) => x.id === l.design.templateId);
      return t ? t.name : null;
    };
    const tpls = App.library.templates;
    L.append(group('templates', 'Templates', { meta: String(tpls.length) },
      tpls.length
        ? cardGrid(tpls.map((t) => ({
          label: t.name,
          title: `Load “${t.name}” into this label`,
          svg: designThumbSVG(t.w, t.h, t.design, 46),
          active: () => labelById(lid) && labelById(lid).design.templateId === t.id,
          onClick: () => { App.ui.tplChoice = t.id; applyTemplateHere(); },
        })), 'cards-3')
        : hint('No templates yet. Design a label, then save it here to reuse it.'),
      checkField({ label: 'Scale templates to fit this label', get: () => App.ui.scaleTpl, set: (v) => { App.ui.scaleTpl = v; } }),
      row(ibtn('plus', 'Save as template', () => saveTemplate(true), 'small'),
        tplName() ? btn(`Update “${tplName()}”`, () => saveTemplate(false), 'small ghost', 'Overwrite the saved template with this design') : null),
    ));

    if (App.sheet.labels.length > 1) {
      L.append(group('share', 'Use on other labels', { open: false },
        row(ibtn('copy', 'Copy to all labels', () => copyDesignToAll(lid), 'small')),
        selectField({
          label: 'Copy to one label', wide: true,
          options: [['', 'Choose a label…'], ...App.sheet.labels.map((x, i) => [x.id, `Label ${i + 1}`]).filter(([id]) => id !== lid)],
          get: () => '',
          set: (v) => v && copyDesignTo(lid, v),
        }),
        hint('Copies are independent — changing this label later never changes the others.'),
      ));
    }

    const e = this.selEl();
    if (e) this.elementPanel(R, e);
    else this.labelPropsPanel(R, l);
  },

  labelPropsPanel(R, l) {
    const id = l.id;
    const L = () => labelById(id);
    R.append(section(`Label ${labelIndex(id) + 1}`,
      kv('Size', () => (L() ? `${fmt(L().w)} × ${fmt(L().h)} mm` : '')),
      kv('Template', () => (L() && L().design.templateName) || '—'),
      colorField({ label: 'Background', get: () => L() && L().design.bg, set: (v) => { const x = L(); if (x) mutate('bg.' + id, () => { x.design.bg = v; }); } }),
      note('pen', 'Click an item on the label to edit it. Size and corners are set in step 1.'),
    ));
    if (designFields().length) {
      R.append(section('Data fields',
        h('div', { class: 'chips' }, ...designFields().map((f) => h('span', { class: 'chip' }, `{{${f}}}`))),
        dataActive()
          ? checkField({ label: 'Preview with the first data row', get: () => App.ui.previewData, set: (v) => { App.ui.previewData = v; requestRender(); } })
          : hint('Load your data in step 3 to fill these in.'),
      ));
    }
    R.append(group('tips', 'Shortcuts', { open: false },
      hint('Drag to move, drag handles to resize. Snapping to edges, centre and other items is on — hold Alt to turn it off.'),
      hint('Arrow keys nudge 0.5 mm (Shift 5 mm). Ctrl+D duplicates, Delete removes, PageUp / PageDown switch label.'),
      hint('Keep important text inside the dashed 2 mm safe line.'),
      row(ibtn('building', 'Company profile…', openCompanyDialog, 'small ghost')),
    ));
  },

  elementPanel(R, e) {
    const id = e.id;
    const E = () => findEl(id);
    const get = (k, dflt) => () => { const x = E(); return x && x[k] != null ? x[k] : dflt; };
    const set = (k) => (v) => setElProp(id, k, v);
    const kids = [];

    if (e.type === 'text') {
      const fields = fieldChoices();
      kids.push(
        textAreaField({ label: 'Text', id: 'propText', rows: 4, get: get('text', ''), set: set('text') }),
        fields.length ? selectField({
          label: 'Insert data field', wide: true,
          options: [['', 'Choose a field…'], ...fields.map((f) => [f, `{{${f}}}`])],
          get: () => '',
          set: (v) => v && appendField(id, v),
        }) : null,
        selectField({ label: 'Font', options: Object.entries(FONT_NAMES), get: get('font', 'helvetica'), set: set('font') }),
        numField({ label: 'Size', unit: 'pt', step: 0.5, min: 3, max: 300, get: get('size'), set: set('size') }),
        toggleField('Style', [
          { label: 'B', title: 'Bold', style: 'font-weight:800', get: get('bold'), set: set('bold') },
          { label: 'I', title: 'Italic', style: 'font-style:italic;font-family:Georgia,serif', get: get('italic'), set: set('italic') },
        ]),
        segField({ label: 'Align', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], get: get('align', 'left'), set: set('align') }),
        colorField({ label: 'Colour', get: get('color'), set: set('color') }),
        numField({ label: 'Line spacing', unit: '×', step: 0.05, min: 0.8, max: 3, get: get('lineHeight', 1.2), set: set('lineHeight') }),
      );
    } else if (e.type === 'image') {
      kids.push(
        kv('Source', () => { const x = E(); const im = x && App.images[x.imgKey]; return im ? `${im.w} × ${im.h} px` : 'missing'; }),
        kv('Print quality', () => {
          const x = E();
          const im = x && App.images[x.imgKey];
          return im ? `≈ ${Math.round(im.w / (fitContain(x, im.w, im.h).w / 25.4))} dpi` : '—';
        }),
        row(btn('Replace image…', () => replaceImage(id), 'small'),
          btn('Fit box to image', () => { const x = E(); const im = x && App.images[x.imgKey]; if (im) setElProp(id, 'h', x.w * (im.h / im.w)); }, 'small ghost')),
      );
    } else if (e.type === 'qr') {
      kids.push(
        textAreaField({ label: 'QR content — a link, text, or {{field}}', id: 'propQR', rows: 3, get: get('data', ''), set: set('data') }),
        fieldChoices().length ? selectField({
          label: 'Different QR on every label — take it from', wide: true,
          options: [['', 'Choose a data field…'], ...fieldChoices().map((f) => [f, f])],
          get: () => '',
          set: (v) => {
            if (!v) return;
            setElProp(id, 'data', `{{${v}}}`);
            App.data.mapping = autoMap(designFields(), App.data.columns, App.data.mapping);
            saveData();
            const ta = $('#propQR');
            if (ta) ta.value = `{{${v}}}`;
          },
        }) : null,
        h('p', { class: 'hint' }, dynText(() => {
          const x = E();
          if (!x) return '';
          const used = [...String(x.data || '').matchAll(FIELD_RE)].map((m) => m[1]);
          return used.length
            ? `Each label gets its own QR code from ${used.join(', ')}. Add text around the field for a link, e.g. https://mysite.com/track/{{${used[0]}}}`
            : 'Every label gets this same QR code. Put a {{field}} in the content to make it different on each label.';
        })),
        colorField({ label: 'Colour', get: get('color'), set: set('color') }),
        colorField({ label: 'Background', get: get('bg', '#ffffff'), set: set('bg'), disabled: () => !!(E() && E().bgNone) }),
        checkField({ label: 'Transparent background', get: get('bgNone'), set: set('bgNone') }),
        selectField({ label: 'Error correction', options: [['L', 'Low'], ['M', 'Medium'], ['Q', 'Quartile'], ['H', 'High']], get: get('ecc', 'M'), set: set('ecc') }),
      );
    } else if (e.type === 'rect' || e.type === 'ellipse') {
      kids.push(
        colorField({ label: 'Fill', get: get('fill'), set: set('fill'), disabled: () => !!(E() && E().noFill) }),
        checkField({ label: 'No fill (outline only)', get: get('noFill'), set: set('noFill') }),
        colorField({ label: 'Outline', get: get('stroke'), set: set('stroke') }),
        numField({ label: 'Outline width', step: 0.1, min: 0, max: 20, get: get('strokeWidth', 0), set: set('strokeWidth') }),
        e.type === 'rect' ? numField({ label: 'Corner radius', step: 0.5, min: 0, max: 100, get: get('radius', 0), set: set('radius') }) : null,
      );
    } else if (e.type === 'line') {
      kids.push(
        segField({ label: 'Direction', options: [['h', 'Across'], ['v', 'Down']], get: () => (E() && isVertical(E()) ? 'v' : 'h'), set: set('dir') }),
        numField({ label: 'Thickness', step: 0.1, min: 0.05, max: 20, get: get('thickness', 0.3), set: set('thickness') }),
        colorField({ label: 'Colour', get: get('color'), set: set('color') }),
      );
    }
    R.append(section(EL_TITLE[e.type] || 'Item', ...kids,
      row(ibtn('copy', 'Duplicate', () => duplicateEl(id), 'small'), ibtn('trash', 'Delete', () => deleteEl(id), 'small danger'))));

    const geo = [
      numField({ label: 'X', get: get('x'), set: set('x'), step: 0.5 }),
      numField({ label: 'Y', get: get('y'), set: set('y'), step: 0.5 }),
    ];
    if (e.type === 'qr') geo.push(numField({ label: 'Size', get: () => E() && Math.min(E().w, E().h), set: set('qrSize'), min: 5, max: 300 }));
    else {
      if (!(e.type === 'line' && isVertical(e))) geo.push(numField({ label: 'Width', get: get('w'), set: set('w'), min: 1, max: 1000 }));
      if (e.type !== 'text' && !(e.type === 'line' && !isVertical(e))) geo.push(numField({ label: 'Height', get: get('h'), set: set('h'), min: 1, max: 1000 }));
    }
    const al = (label, how, title) => btn(label, () => alignEl(id, how), 'small ghost', title);
    R.append(group('elgeo', 'Position & size', { open: false }, ...geo,
      h('div', { class: 'mini-title' }, 'Align on the label'),
      h('div', { class: 'align-grid' },
        al('Left', 'left'), al('Center', 'hcenter'), al('Right', 'right'),
        al('Top', 'top'), al('Middle', 'vmiddle'), al('Bottom', 'bottom')),
    ));
    R.append(group('order', 'Layer order', { open: false },
      row(btn('Forward', () => reorderEl(id, 'up'), 'small ghost'), btn('Backward', () => reorderEl(id, 'down'), 'small ghost'),
        btn('To front', () => reorderEl(id, 'top'), 'small ghost'), btn('To back', () => reorderEl(id, 'bottom'), 'small ghost')),
    ));
  },

  renderAux() {
    const l = this.label();
    const i = labelIndex(l.id);
    const many = App.sheet.labels.length > 1;
    stageBar([
      many ? btn(icon('left', 16), () => stepLabel(-1), 'icon ghost', 'Previous label (PageUp)') : null,
      h('strong', {}, `Label ${i + 1} of ${App.sheet.labels.length}`),
      many ? btn(icon('right', 16), () => stepLabel(1), 'icon ghost', 'Next label (PageDown)') : null,
      h('span', { class: 'muted-sm' }, `${fmt(l.w)} × ${fmt(l.h)} mm`),
      App.ui.previewData && dataActive() && designFields().length ? h('span', { class: 'badge' }, 'Showing data row 1') : null,
    ]);
    const box = $('#layers');
    if (box) {
      const els = [...l.design.elements].reverse();
      box.replaceChildren(...(els.length ? els.map((e) => h('div', {
        class: 'layer' + (e.id === App.ui.selEl ? ' active' : ''),
        onclick: () => { App.ui.selEl = e.id; requestRender(); },
      }, icon(e.type === 'rect' ? 'rect' : e.type, 15), h('span', { class: 'layer-name' }, elName(e)))) : [hint('Nothing on this label yet.')]));
    }
    renderWarnings(labelWarnings({ ...l, design: this.shownDesign() }), 'Checks', 'Everything fits inside the label.', (w) => {
      App.ui.selEl = w.ids[0];
      requestRender();
    });
  },
};

/* ---------------------------------------------------------------- data fields */

/* Field names to offer: columns from loaded data plus fields already used in designs. */
function fieldChoices() {
  return [...new Set([...App.data.columns, ...designFields()])];
}

function appendField(id, field) {
  const e = findEl(id);
  if (!e) return;
  setElProp(id, 'text', (e.text && !/\s$/.test(e.text) ? e.text + ' ' : e.text || '') + `{{${field}}}`);
}

function insertFieldDialog() {
  const choices = fieldChoices();
  openModal('Add a data field', (body, foot, close) => {
    const add = (name) => {
      const f = String(name || '').trim().replace(/[{}]/g, '');
      if (!f) return;
      close();
      const sel = LabelView.selEl();
      if (sel && sel.type === 'text') appendField(sel.id, f);
      else addElements([newTextEl(curLabel(), { text: `{{${f}}}` })]);
      App.data.mapping = autoMap(designFields(), App.data.columns, App.data.mapping);
      saveData();
    };
    body.append(hint('A data field is a placeholder like {{Name}}. In step 3 each row of your data fills it in, one label per row.'));
    if (choices.length) {
      body.append(h('div', { class: 'mini-title' }, App.data.columns.length ? 'Columns in your data' : 'Fields already used'),
        h('div', { class: 'chips' }, ...choices.map((c) => h('button', { type: 'button', class: 'chip btnish', onclick: () => add(c) }, c))));
    }
    const input = h('input', { type: 'text', class: 'text-input', placeholder: 'e.g. Name, Address, Order ID' });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(input.value); } });
    body.append(h('label', { class: 'stack', style: 'margin-top:14px' }, h('span', { class: 'lbl' }, 'Or type a field name'), input));
    foot.append(btn('Cancel', () => close(), 'ghost'), btn('Add field', () => add(input.value), 'primary'));
    setTimeout(() => input.focus({ preventScroll: true }), 30);
  });
}

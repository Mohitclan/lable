'use strict';
/* Mode A — Sheet Designer: arrange label areas on the A4 page. */

/* Starting points for mixed-size custom sheets; boxes fill the printable area. */
const ARRANGEMENTS = [
  {
    name: '1 large top · 2 middle · 1 wide bottom',
    build: (a, gx, gy) => {
      const hh = a.h - 2 * gy;
      const h1 = hh * 0.42;
      const h2 = hh * 0.28;
      const h3 = hh - h1 - h2;
      const w2 = (a.w - gx) / 2;
      return [
        { x: a.x, y: a.y, w: a.w, h: h1 },
        { x: a.x, y: a.y + h1 + gy, w: w2, h: h2 },
        { x: a.x + w2 + gx, y: a.y + h1 + gy, w: w2, h: h2 },
        { x: a.x, y: a.y + h1 + h2 + 2 * gy, w: a.w, h: h3 },
      ];
    },
  },
  {
    name: '2 large left · 4 small right',
    build: (a, gx, gy) => {
      const w = (a.w - gx) / 2;
      const hl = (a.h - gy) / 2;
      const hr = (a.h - 3 * gy) / 4;
      const out = [0, 1].map((i) => ({ x: a.x, y: a.y + i * (hl + gy), w, h: hl }));
      for (let i = 0; i < 4; i++) out.push({ x: a.x + w + gx, y: a.y + i * (hr + gy), w, h: hr });
      return out;
    },
  },
  {
    name: '1 tall left · 3 stacked right',
    build: (a, gx, gy) => {
      const wl = (a.w - gx) * 0.55;
      const wr = a.w - gx - wl;
      const hr = (a.h - 2 * gy) / 3;
      return [{ x: a.x, y: a.y, w: wl, h: a.h }, ...[0, 1, 2].map((i) => ({ x: a.x + wl + gx, y: a.y + i * (hr + gy), w: wr, h: hr }))];
    },
  },
  {
    name: '1 banner top · 4 below (2 × 2)',
    build: (a, gx, gy) => {
      const hb = (a.h - 2 * gy) * 0.3;
      const hs = (a.h - 2 * gy - hb) / 2;
      const w = (a.w - gx) / 2;
      const out = [{ x: a.x, y: a.y, w: a.w, h: hb }];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push({ x: a.x + c * (w + gx), y: a.y + hb + gy + r * (hs + gy), w, h: hs });
      return out;
    },
  },
];

const contentArea = (c) => ({ x: c.marginLeft, y: c.marginTop, w: A4.w - c.marginLeft - c.marginRight, h: A4.h - c.marginTop - c.marginBottom });

function currentPresetKey() {
  const s = App.sheet;
  return s.mode === 'custom' ? 'custom' : presetKeyFor(s.cfg.cols, s.cfg.rows);
}

function presetOptions() {
  const opts = PRESETS.map((p) => [p.key, p.name]);
  if (currentPresetKey() === 'grid') opts.splice(6, 0, ['grid', `Grid ${App.sheet.cfg.cols} × ${App.sheet.cfg.rows}`]);
  return opts;
}

function templateOptions() {
  const t = App.library.templates;
  return [['', t.length ? 'Choose a saved label design…' : 'No saved designs yet'], ...t.map((x) => [x.id, `${x.name}  (${fmt(x.w)} × ${fmt(x.h)} mm)`])];
}

/* ---------------------------------------------------------------- actions */

function applyPreset(key) {
  const s = App.sheet;
  if (key === 'grid') return;
  if (key === 'custom') {
    if (s.mode === 'custom') return;
    mutate('preset', () => { s.mode = 'custom'; s.cfg.preset = 'custom'; });
    toast('Custom layout: drag labels to move, drag handles to resize, or add new label areas.');
    return;
  }
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return;
  mutate('preset', () => {
    const keep = { radius: s.cfg.radius, border: s.cfg.border, borderColor: s.cfg.borderColor, printerMargin: s.cfg.printerMargin };
    s.mode = 'grid';
    s.cfg = { ...clone(DEFAULT_CFG), ...keep, cols: p.cols, rows: p.rows };
    syncGrid(s);
  });
}

async function resetSheetDefaults() {
  const ok = await confirmBox('Reset to the default layout?',
    'Restores the default A4 sheet: 4 equal labels (2 × 2) with default margins, gaps, corners and border. Label designs stay in their positions.', 'Reset');
  if (!ok) return;
  mutate('reset', () => {
    const s = App.sheet;
    s.mode = 'grid';
    s.cfg = clone(DEFAULT_CFG);
    s.allowOverlap = false;
    syncGrid(s);
  });
  toast('Default 4-label layout restored.', 'ok');
}

function applyStandardSize(i) {
  const z = STANDARD_SIZES[i];
  if (!z) return;
  const tw = z.cols * z.labelW + z.gapX * (z.cols - 1);
  const th = z.rows * z.labelH + z.gapY * (z.rows - 1);
  if (updateCfg({
    cols: z.cols, rows: z.rows, labelW: z.labelW, labelH: z.labelH, gapX: z.gapX, gapY: z.gapY,
    marginLeft: (A4.w - tw) / 2, marginTop: (A4.h - th) / 2, autoFit: false,
  }, { key: 'std' })) toast(`Applied ${z.name}. Check the measurements against your sticker sheet.`);
}

function centerGrid() {
  const c = App.sheet.cfg;
  if (c.autoFit) {
    const mx = (c.marginLeft + c.marginRight) / 2;
    const my = (c.marginTop + c.marginBottom) / 2;
    updateCfg({ marginLeft: mx, marginRight: mx, marginTop: my, marginBottom: my }, { key: 'center' });
  } else {
    const g = gridGeometry(c);
    updateCfg({ marginLeft: (A4.w - g.totalW) / 2, marginTop: (A4.h - g.totalH) / 2 }, { key: 'center' });
  }
}

function findFreeSpot(w, h, ignoreId) {
  const s = App.sheet;
  const c = s.cfg;
  const others = s.labels.filter((l) => l.id !== ignoreId)
    .map((l) => ({ x: l.x - c.gapX, y: l.y - c.gapY, w: l.w + 2 * c.gapX, h: l.h + 2 * c.gapY }));
  const x0 = Math.max(0, c.marginLeft);
  const y0 = Math.max(0, c.marginTop);
  const x1 = Math.min(A4.w, A4.w - c.marginRight);
  const y1 = Math.min(A4.h, A4.h - c.marginBottom);
  for (let y = y0; y + h <= y1 + 0.001; y += 1) {
    for (let x = x0; x + w <= x1 + 0.001; x += 1) {
      const b = { x, y, w, h };
      if (!others.some((o) => overlap(o, b))) return { x, y };
    }
  }
  return null;
}

function addCustomLabel() {
  if (App.sheet.mode !== 'custom') applyPreset('custom');
  const c = App.sheet.cfg;
  let box = null;
  for (const [w, h] of [[70, 45], [50, 30], [30, 20], [15, 10]]) {
    const p = findFreeSpot(w, h);
    if (p) { box = { ...p, w, h }; break; }
  }
  if (!box) {
    box = { x: Math.max(0, c.marginLeft), y: Math.max(0, c.marginTop), w: 60, h: 40 };
    toast('No free space left — the new label overlaps others. Drag or resize it into place.', 'warn');
  }
  const l = newLabel({ ...box, radius: c.radius, border: c.border, borderColor: c.borderColor });
  mutate('add-label', () => App.sheet.labels.push(l));
  App.ui.selLabel = l.id;
}

function duplicateLabel(id) {
  const src = labelById(id);
  if (!src) return;
  if (App.sheet.mode !== 'custom') applyPreset('custom');
  const spot = findFreeSpot(src.w, src.h) || clampMove({ ...src, x: src.x + 5, y: src.y + 5 }, A4.w, A4.h);
  const copy = { ...clone(src), id: uid(), x: spot.x, y: spot.y };
  copy.design.elements.forEach((e) => { e.id = uid(); });
  mutate('dup-label', () => App.sheet.labels.push(copy));
  App.ui.selLabel = copy.id;
}

function deleteLabel(id) {
  const s = App.sheet;
  if (s.labels.length <= 1) { toast('A sheet needs at least one label.', 'warn'); return; }
  if (s.mode !== 'custom') { toast('Switch to Custom layout to delete individual labels.', 'warn'); return; }
  mutate('del-label', () => { s.labels = s.labels.filter((l) => l.id !== id); });
  App.ui.selLabel = null;
}

async function applyArrangement(a) {
  const s = App.sheet;
  if (s.labels.some((l) => l.design.elements.length)) {
    const ok = await confirmBox('Replace the label areas?', `Rearrange the sheet as “${a.name}”. Existing designs are kept in order; extra designs beyond the new count are removed (undo with Ctrl+Z).`, 'Rearrange');
    if (!ok) return;
  }
  const c = s.cfg;
  const boxes = a.build(contentArea(c), c.gapX, c.gapY);
  mutate('arrangement', () => {
    s.mode = 'custom';
    s.labels = boxes.map((b, i) => Object.assign(s.labels[i] || newLabel(), b, { radius: c.radius, border: c.border, borderColor: c.borderColor }));
  });
  App.ui.selLabel = null;
}

function setLabelGeom(id, patch, silent) {
  const l = labelById(id);
  if (!l) return false;
  const nb = { x: l.x, y: l.y, w: l.w, h: l.h, ...patch };
  if (nb.w < MIN_LABEL || nb.h < MIN_LABEL) {
    if (!silent) toast(`Labels must be at least ${MIN_LABEL} mm on each side.`, 'warn');
    return false;
  }
  if (nb.x < -0.001 || nb.y < -0.001 || nb.x + nb.w > A4.w + 0.001 || nb.y + nb.h > A4.h + 0.001) {
    if (!silent) toast('Labels must stay inside the A4 page (210 × 297 mm).', 'warn');
    return false;
  }
  mutate('geom.' + id + Object.keys(patch).join(), () => Object.assign(l, patch));
  return true;
}

function setLabelProp(id, prop, v) {
  const l = labelById(id);
  if (l) mutate(`lbl.${id}.${prop}`, () => { l[prop] = v; });
}

function assignTemplate(ids, tplId) {
  const tpl = App.library.templates.find((t) => t.id === tplId);
  if (!tpl) { toast('Choose a saved label design first.', 'warn'); return; }
  mutate('assign', () => ids.forEach((id) => {
    const l = labelById(id);
    if (l) applyTemplateToLabel(l, tpl, App.ui.scaleTpl);
  }));
  toast(`Applied “${tpl.name}” to ${plural(ids.length, 'label')}.`, 'ok');
}

async function copyDesignToAll(fromId) {
  const src = labelById(fromId);
  if (!src) return;
  const others = App.sheet.labels.filter((l) => l.id !== fromId);
  if (!others.length) return;
  if (others.some((l) => l.design.elements.length)) {
    const ok = await confirmBox('Copy to all labels?', `Replace the design of the other ${plural(others.length, 'label')} with a copy of Label ${labelIndex(fromId) + 1}? Each copy stays independent afterwards.`, 'Copy');
    if (!ok) return;
  }
  mutate('copy-all', () => others.forEach((l) => applyDesignToLabel(l, src.design, src.w, src.h, App.ui.scaleTpl)));
  toast(`Copied to ${plural(others.length, 'label')}.`, 'ok');
}

function copyDesignTo(fromId, toId) {
  const src = labelById(fromId);
  const dst = labelById(toId);
  if (!src || !dst || src === dst) return;
  mutate('copy-one', () => applyDesignToLabel(dst, src.design, src.w, src.h, App.ui.scaleTpl));
  toast(`Copied to Label ${labelIndex(toId) + 1}.`, 'ok');
}

async function clearDesign(id) {
  const l = labelById(id);
  if (!l || !l.design.elements.length) return;
  if (!(await confirmBox('Clear this label?', 'Remove all content from this label?', 'Clear', true))) return;
  mutate('clear', () => { l.design = newDesign(); });
  App.ui.selEl = null;
}

/* ---------------------------------------------------------------- view */

const SheetView = {
  PAD: 8,
  drag: null,
  guides: [],
  px: 0.3,
  gridMoveTip: false,

  vb() { const p = this.PAD; return [-p, -p, A4.w + 2 * p, A4.h + 2 * p]; },
  fitPPM() {
    const s = stageBox();
    const [, , w, h] = this.vb();
    return Math.max(0.4, Math.min(s.w / w, s.h / h));
  },
  ppm() { return App.ui.zoom.sheet || this.fitPPM(); },
  handles() { return App.sheet.mode === 'grid' ? ['e', 's', 'se'] : ALL_HANDLES; },

  snapTargets(id) {
    const s = App.sheet;
    const c = s.cfg;
    const xs = [0, A4.w, A4.w / 2, c.marginLeft, A4.w - c.marginRight];
    const ys = [0, A4.h, A4.h / 2, c.marginTop, A4.h - c.marginBottom];
    for (const o of s.labels) {
      if (o.id === id) continue;
      xs.push(o.x, o.x + o.w, o.x + o.w / 2, o.x - c.gapX, o.x + o.w + c.gapX);
      ys.push(o.y, o.y + o.h, o.y + o.h / 2, o.y - c.gapY, o.y + o.h + c.gapY);
    }
    return { xs, ys };
  },

  renderCanvas() {
    const s = App.sheet;
    const c = s.cfg;
    const svg = $('#canvas');
    const vb = this.vb();
    const ppm = this.ppm();
    const px = 1 / ppm;
    this.px = px;
    svg.setAttribute('viewBox', vb.join(' '));
    svg.style.width = vb[2] * ppm + 'px';
    svg.style.height = vb[3] * ppm + 'px';

    const flag = {};
    for (const w of sheetWarnings(s)) {
      if (w.level === 'info') continue;
      for (const id of w.ids) if (w.level === 'error' || !flag[id]) flag[id] = w.level;
    }

    let o = `<defs><filter id="pgShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0.8" stdDeviation="1.6" flood-color="#0f172a" flood-opacity="0.18"/></filter></defs>`;
    o += `<rect width="${A4.w}" height="${A4.h}" fill="#fff" filter="url(#pgShadow)"/>`;
    const pa = contentArea(c);
    if (pa.w > 0 && pa.h > 0) {
      o += `<rect x="${pa.x}" y="${pa.y}" width="${pa.w}" height="${pa.h}" fill="none" stroke="#93b4f5" stroke-width="${px}" stroke-dasharray="${4 * px} ${3 * px}"/>`;
    }

    s.labels.forEach((l, i) => {
      const r = cornerR(l);
      o += `<g transform="translate(${l.x} ${l.y})">`;
      const shown = previewDesignFor(s, l, i) || l.design;
      o += designSVG(l, shown, 'sc' + i);
      if (!shown.elements.length) o += this.placeholder(l, i);
      o += l.border > 0
        ? `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="none" stroke="${esc(l.borderColor)}" stroke-width="${Math.max(l.border, px)}"/>`
        : `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="none" stroke="#cfd4dc" stroke-width="${px}" stroke-dasharray="${3 * px} ${2 * px}"/>`;
      if (flag[l.id]) {
        const col = flag[l.id] === 'error' ? '#dc2626' : '#d97706';
        o += `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="${flag[l.id] === 'error' ? 'rgba(220,38,38,0.07)' : 'none'}" stroke="${col}" stroke-width="${2 * px}" stroke-dasharray="${6 * px} ${3 * px}"/>`;
      }
      o += '</g>';
    });

    const sel = selectedLabel();
    if (sel) {
      o += `<rect x="${sel.x}" y="${sel.y}" width="${sel.w}" height="${sel.h}" rx="${cornerR(sel)}" fill="none" stroke="#2563eb" stroke-width="${2 * px}"/>`;
      o += handlesSVG(sel, this.handles(), px);
      const fs = 11 * px;
      const above = sel.y > 18 * px;
      o += `<text x="${sel.x + sel.w / 2}" y="${above ? sel.y - 6 * px : sel.y + sel.h + 15 * px}" text-anchor="middle" font-size="${fs}" font-weight="600"`
        + ` font-family="${FONT_CSS.helvetica}" fill="#1d4ed8" stroke="#fff" stroke-width="${3 * px}" paint-order="stroke">${fmt(sel.w)} × ${fmt(sel.h)} mm · x ${fmt(sel.x)}, y ${fmt(sel.y)}</text>`;
    }
    o += guidesSVG(this.guides, vb, px);
    svg.innerHTML = o;
  },

  placeholder(l, i) {
    const fs = clamp(Math.min(l.w, l.h) * 0.075, 2.2, 6);
    return `<text x="${l.w / 2}" y="${l.h / 2 - fs * 0.15}" text-anchor="middle" font-family="${FONT_CSS.helvetica}" font-size="${fs}" font-weight="700" fill="#aab1bc">Label ${i + 1}</text>`
      + `<text x="${l.w / 2}" y="${l.h / 2 + fs * 1.05}" text-anchor="middle" font-family="${FONT_CSS.helvetica}" font-size="${fs * 0.55}" fill="#b8bec8">${fmt(l.w)} × ${fmt(l.h)} mm · double-click to design</text>`;
  },

  /* ---------------- pointer */

  pointerDown(e, p) {
    const s = App.sheet;
    const px = this.px;
    let hit = null;
    const sel = selectedLabel();
    if (sel) {
      const hd = hitHandle(sel, this.handles(), p, HIT_PX * px);
      if (hd) hit = { kind: 'resize', hd, id: sel.id };
    }
    if (!hit) {
      const l = [...s.labels].reverse().find((x) => inBox(p, x));
      if (l) hit = { kind: 'move', id: l.id };
    }
    if (!hit) {
      if (App.ui.selLabel) { App.ui.selLabel = null; requestRender(); }
      return;
    }
    if (App.ui.selLabel !== hit.id) { App.ui.selLabel = hit.id; requestRender(); }
    const l = labelById(hit.id);
    this.drag = { ...hit, p0: p, b0: { x: l.x, y: l.y, w: l.w, h: l.h }, before: beginGesture(), moved: false };
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
    const s = App.sheet;
    const l = labelById(d.id);
    if (!l) return;
    this.guides = [];
    if (s.mode === 'grid') {
      if (d.kind === 'resize') {
        const nb = resizeBox(d.b0, d.hd, dx, dy, MIN_LABEL);
        updateCfg({ labelW: nb.w, labelH: nb.h }, { history: false, silent: true });
      } else if (!this.gridMoveTip) {
        this.gridMoveTip = true;
        toast('Grid labels move together — choose “Custom layout” to move labels individually.');
      }
      return;
    }
    let nb = d.kind === 'move' ? { ...d.b0, x: d.b0.x + dx, y: d.b0.y + dy } : resizeBox(d.b0, d.hd, dx, dy, MIN_LABEL);
    if (!e.altKey) {
      const t = this.snapTargets(l.id);
      this.guides = snapBox(nb, d.kind, d.hd, t.xs, t.ys, 7 * px);
    }
    nb = d.kind === 'move' ? clampMove(nb, A4.w, A4.h) : clampResize(nb, A4.w, A4.h);
    if (nb.w < MIN_LABEL || nb.h < MIN_LABEL) return;
    Object.assign(l, { x: nb.x, y: nb.y, w: nb.w, h: nb.h });
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
    const sel = selectedLabel();
    const hd = sel && hitHandle(sel, this.handles(), p, HIT_PX * this.px);
    if (hd) { svg.style.cursor = HANDLE_CURSOR[hd]; return; }
    const over = App.sheet.labels.some((l) => inBox(p, l));
    svg.style.cursor = over ? (App.sheet.mode === 'custom' ? 'move' : 'pointer') : 'default';
  },

  dblClick(e, p) {
    const l = [...App.sheet.labels].reverse().find((x) => inBox(p, x));
    if (l) openLabelDesigner(l.id);
  },

  deselect() {
    if (App.ui.selLabel) { App.ui.selLabel = null; requestRender(); }
  },

  onKey(e) {
    const l = selectedLabel();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { this.deselect(); return; }
    if (!l) return;
    if (e.key === 'Enter') { openLabelDesigner(l.id); return; }
    if (App.sheet.mode !== 'custom') return;
    const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) {
      e.preventDefault();
      mutate('nudge.' + l.id, () => {
        const nb = clampMove({ ...l, x: l.x + mv[0], y: l.y + mv[1] }, A4.w, A4.h);
        l.x = nb.x;
        l.y = nb.y;
      });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteLabel(l.id);
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateLabel(l.id);
    }
  },

  /* ---------------- panels */

  panelKey() {
    const s = App.sheet;
    return ['sheet', s.mode, App.ui.selLabel, s.labels.length, s.cfg.cols, s.cfg.rows, s.cfg.autoFit,
      App.library.templates.length, App.library.layouts.length, s.layoutId, App.data.rows.length].join('|');
  },

  renderPanels() {
    const L = $('#leftPanel');
    const R = $('#rightPanel');
    L.replaceChildren();
    R.replaceChildren();
    const c = () => App.sheet.cfg;
    const isGrid = App.sheet.mode === 'grid';
    const setCfg = (k) => (v, live) => updateCfg({ [k]: v }, { key: 'cfg.' + k, silent: live });

    const presetLabel = { 4: '4 labels', '2h': '2 wide', '2v': '2 tall', 6: '6 labels', 8: '8 labels', 10: '10 labels', custom: 'Custom' };
    L.append(section('Sheet layout',
      cardGrid(PRESETS.map((p) => ({
        label: presetLabel[p.key],
        title: p.name,
        svg: sheetPic(p.key === 'custom' ? ARRANGEMENTS[0].build({ x: 12, y: 12, w: 186, h: 273 }, 8, 8) : gridBoxes(p.cols, p.rows)),
        active: () => currentPresetKey() === p.key,
        onClick: () => applyPreset(p.key),
      })), 'cards-4'),
      hint('A4 portrait · 210 × 297 mm. Every size is in millimetres.'),
    ));

    if (isGrid) {
      L.append(group('size', 'Label size', { meta: dynText(() => `${fmt(c().labelW)} × ${fmt(c().labelH)} mm`) },
        numField({ label: 'Width', get: () => c().labelW, set: setCfg('labelW'), min: MIN_LABEL, max: A4.w }),
        numField({ label: 'Height', get: () => c().labelH, set: setCfg('labelH'), min: MIN_LABEL, max: A4.h }),
        checkField({ label: 'Fit labels to the margins automatically', get: () => c().autoFit, set: (v) => updateCfg({ autoFit: v }, { key: 'autofit' }), title: 'On: margins and gaps decide the label size. Off: you set the label size.' }),
        numField({ label: 'Columns', unit: '', step: 1, int: true, min: 1, max: 12, get: () => c().cols, set: setCfg('cols') }),
        numField({ label: 'Rows', unit: '', step: 1, int: true, min: 1, max: 20, get: () => c().rows, set: setCfg('rows') }),
        selectField({ label: 'Match a sticker sheet', wide: true, options: [['', 'Choose a standard size…'], ...STANDARD_SIZES.map((z, i) => [String(i), z.name])], get: () => '', set: (v) => v !== '' && applyStandardSize(+v) }),
      ));
    } else {
      L.append(group('areas', 'Label areas', { meta: dynText(() => plural(App.sheet.labels.length, 'label')) },
        row(ibtn('plus', 'Add label', addCustomLabel, 'primary small')),
        hint('Drag to move and drag the handles to resize. Hold Alt to stop snapping.'),
        h('div', { class: 'mini-title' }, 'Start from an arrangement'),
        cardGrid(ARRANGEMENTS.map((a) => ({
          label: a.name.split(' · ')[0],
          title: a.name,
          svg: sheetPic(a.build({ x: 12, y: 12, w: 186, h: 273 }, 8, 8)),
          onClick: () => applyArrangement(a),
        })), 'cards-4'),
        checkField({ label: 'Allow labels to overlap', get: () => App.sheet.allowOverlap, set: (v) => mutate('ovl', () => { App.sheet.allowOverlap = v; }) }),
      ));
    }

    L.append(group('spacing', 'Spacing & margins', { open: false },
      numField({ label: 'Gap across', get: () => c().gapX, set: setCfg('gapX'), min: 0, max: 100 }),
      numField({ label: 'Gap down', get: () => c().gapY, set: setCfg('gapY'), min: 0, max: 100 }),
      numField({ label: 'Top', get: () => c().marginTop, set: setCfg('marginTop'), min: 0, max: 150 }),
      numField({ label: 'Bottom', get: () => c().marginBottom, set: setCfg('marginBottom'), min: 0, max: 150 }),
      numField({ label: 'Left', get: () => c().marginLeft, set: setCfg('marginLeft'), min: 0, max: 105 }),
      numField({ label: 'Right', get: () => c().marginRight, set: setCfg('marginRight'), min: 0, max: 105 }),
      isGrid ? row(btn('Center on page', centerGrid, 'small ghost')) : hint('The dashed blue box is the printable area; labels outside it are flagged.'),
      numField({ label: 'Printer edge', get: () => c().printerMargin, set: setCfg('printerMargin'), min: 0, max: 20, title: 'Strip around the paper most printers cannot print on. Used for warnings only.' }),
    ));

    L.append(group('style', 'Corners & border', { open: false },
      numField({ label: 'Corner radius', get: () => c().radius, set: setCfg('radius'), min: 0, max: 50 }),
      numField({ label: 'Border', get: () => c().border, set: setCfg('border'), min: 0, max: 5, step: 0.1 }),
      colorField({ label: 'Border colour', get: () => c().borderColor, set: (v) => updateCfg({ borderColor: v }, { key: 'cfg.borderColor' }) }),
      borderPrintField(),
    ));

    L.append(h('div', { class: 'panel-foot' }, ibtn('undo', 'Reset to the default layout', resetSheetDefaults, 'ghost small')));

    const l = selectedLabel();
    if (l) this.labelPanel(R, l);
    else this.sheetPanel(R);
  },

  sheetPanel(R) {
    const s = () => App.sheet;
    R.append(section('This sheet',
      kv('Layout', () => (s().layoutId ? s().name : 'Not saved yet')),
      kv('Labels', () => (s().mode === 'grid'
        ? `${s().labels.length} × ${fmt(s().cfg.labelW)} × ${fmt(s().cfg.labelH)} mm`
        : `${s().labels.length}, mixed sizes`)),
      note('pen', 'Click a label to change just that position. Double-click it to design it.'),
    ));
    if (App.data.rows.length) {
      R.append(section('Your data',
        kv('File', () => App.data.fileName || 'Data'),
        kv('People', () => String(dataRows().length)),
        ibtn('layout', 'Apply to all labels', applyDataToAll, 'primary block', 'Give each row of your file its own label'),
      ));
    }
    R.append(group('saved', 'Saved layouts', { meta: String(App.library.layouts.length) },
      selectField({
        label: 'Open', wide: true,
        options: () => [['', App.library.layouts.length ? 'Choose a saved layout…' : 'No saved layouts yet'], ...App.library.layouts.map((x) => [x.id, x.name])],
        get: () => '',
        set: (v) => v && loadLayout(v),
      }),
      row(btn('Save', () => saveLayout(false), 'small', 'Save this sheet and its label designs'), btn('Save as…', () => saveLayout(true), 'small ghost'), btn('Manage…', openLayoutsDialog, 'small ghost')),
    ));
    R.append(section('Printing', borderPrintField()));
    R.append(group('pages', 'Pages', { open: false },
      numField({ label: 'Copies', unit: '', step: 1, int: true, min: 1, max: 100, get: () => App.sheet.copies, set: (v) => mutate('copies', () => { App.sheet.copies = v; }), title: 'Identical A4 pages in the PDF' }),
      hint('When data is loaded in step 3, the data decides the number of pages instead.'),
    ));
  },

  labelPanel(R, l) {
    const id = l.id;
    const L = () => labelById(id);
    const isCustom = App.sheet.mode === 'custom';

    R.append(section(`Label ${labelIndex(id) + 1}`,
      kv('Design', () => (L() && L().design.templateName) || (L() && L().design.elements.length ? 'Own design' : 'Empty')),
      kv('Size', () => (L() ? `${fmt(L().w)} × ${fmt(L().h)} mm` : '')),
      ibtn('pen', 'Design this label', () => openLabelDesigner(id), 'primary block'),
    ));

    R.append(group('assign', 'Use a saved design', {},
      selectField({ label: 'Design', wide: true, options: templateOptions, get: () => App.ui.tplChoice, set: (v) => { App.ui.tplChoice = v; } }),
      checkField({ label: 'Scale to fit this label', get: () => App.ui.scaleTpl, set: (v) => { App.ui.scaleTpl = v; } }),
      row(btn('Apply here', () => assignTemplate([id], App.ui.tplChoice), 'small primary'),
        btn('Apply to all labels', () => assignTemplate(App.sheet.labels.map((x) => x.id), App.ui.tplChoice), 'small ghost')),
      row(btn('Copy this label to all', () => copyDesignToAll(id), 'small ghost'), btn('Clear', () => clearDesign(id), 'small danger ghost')),
    ));

    if (isCustom) {
      R.append(group('geom', 'Position & size', {},
        numField({ label: 'X (left)', get: () => L() && L().x, set: (v, live) => setLabelGeom(id, { x: v }, live), min: 0, max: A4.w }),
        numField({ label: 'Y (top)', get: () => L() && L().y, set: (v, live) => setLabelGeom(id, { y: v }, live), min: 0, max: A4.h }),
        numField({ label: 'Width', get: () => L() && L().w, set: (v, live) => setLabelGeom(id, { w: v }, live), min: MIN_LABEL, max: A4.w }),
        numField({ label: 'Height', get: () => L() && L().h, set: (v, live) => setLabelGeom(id, { h: v }, live), min: MIN_LABEL, max: A4.h }),
        row(btn('Center across', () => setLabelGeom(id, { x: (A4.w - L().w) / 2 }), 'small ghost'),
          btn('Center down', () => setLabelGeom(id, { y: (A4.h - L().h) / 2 }), 'small ghost')),
        row(ibtn('copy', 'Duplicate', () => duplicateLabel(id), 'small'), ibtn('trash', 'Delete', () => deleteLabel(id), 'small danger')),
      ));
      R.append(group('look', 'Corners & border', { open: false },
        numField({ label: 'Corner radius', get: () => L() && L().radius, set: (v) => setLabelProp(id, 'radius', v), min: 0, max: 100 }),
        numField({ label: 'Border', get: () => L() && L().border, set: (v) => setLabelProp(id, 'border', v), min: 0, max: 5, step: 0.1 }),
        colorField({ label: 'Border colour', get: () => L() && L().borderColor, set: (v) => setLabelProp(id, 'borderColor', v) }),
        checkField({ label: 'Allow this label to overlap others', get: () => L() && L().allowOverlap, set: (v) => setLabelProp(id, 'allowOverlap', v) }),
      ));
    } else {
      R.append(section('',
        note('layout', 'In a grid every label shares one size. Choose “Custom” to move or resize labels one by one.'),
        row(btn('Switch to custom layout', () => applyPreset('custom'), 'small ghost')),
      ));
    }
  },

  renderAux() {
    const s = App.sheet;
    stageBar([
      h('strong', {}, `A4 · ${plural(s.labels.length, 'label')}`),
      h('span', { class: 'muted-sm' }, s.mode === 'grid' ? `${fmt(s.cfg.labelW)} × ${fmt(s.cfg.labelH)} mm each` : 'custom layout'),
    ]);
    const labelIssues = [];
    s.labels.forEach((l, i) => {
      const n = labelWarnings(l).filter((w) => w.level !== 'info').length;
      if (n) labelIssues.push({ level: 'info', ids: [l.id], msg: `Label ${i + 1}: ${plural(n, 'design warning')} — open it to review.` });
    });
    renderWarnings([...sheetWarnings(s), ...labelIssues], 'Checks', 'Labels fit the page with no overlaps.', (w) => {
      App.ui.selLabel = w.ids[0];
      requestRender();
    });
  },
};

/* Label borders in the PDF: one switch, shown next to Download as well as in Corners & border. */
function setPrintBorders(on) {
  mutate('print-borders', () => {
    const s = App.sheet;
    s.printBorders = on;
    if (on) {
      // A border of 0 mm would print nothing, so turning borders on gives them a visible line.
      if (!(s.cfg.border > 0)) s.cfg.border = 0.3;
      s.labels.forEach((l) => { if (!(l.border > 0)) l.border = s.cfg.border; });
    }
  });
}

function borderPrintField() {
  return checkField({
    label: 'Print label borders in the PDF',
    title: 'Draws each label’s outline in the PDF. Thickness and colour are in Layout → Corners & border.',
    get: () => App.sheet.printBorders,
    set: setPrintBorders,
  });
}

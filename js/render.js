'use strict';
/*
 * SVG rendering of label designs (in mm) plus shared pointer/geometry helpers.
 * Text, QR and shape maths here is mirrored exactly by pdf.js.
 */

const FONT_CSS = {
  helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  times: "'Times New Roman', Times, 'Liberation Serif', serif",
  courier: "'Courier New', Courier, 'Liberation Mono', monospace",
};
const FONT_NAMES = { helvetica: 'Helvetica (sans-serif)', times: 'Times (serif)', courier: 'Courier (monospace)' };
const ASCENT = 0.78; // first baseline sits this many font-sizes below the text box top

function textMetrics(e) {
  const fs = (e.size || 10) * PT;
  const lines = String(e.text == null ? '' : e.text).split('\n');
  const lh = fs * (e.lineHeight || 1.2);
  return { fs, lines, lh, height: fs + lh * (lines.length - 1) };
}

const textAnchorX = (e) => (e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w : e.x);
const fontStyle = (e) => (e.bold && e.italic ? 'bolditalic' : e.bold ? 'bold' : e.italic ? 'italic' : 'normal');
const isVertical = (e) => e.dir === 'v';

function normalizeDesign(d) {
  for (const e of d.elements) if (e.type === 'text') e.h = textMetrics(e).height;
}

function fitContain(box, iw, ih) {
  const s = Math.min(box.w / iw, box.h / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/* ---------------------------------------------------------------- QR */

const qrCache = new Map();

function qrMatrix(data, ecc = 'M') {
  const key = ecc + '|' + data;
  if (qrCache.has(key)) return qrCache.get(key);
  let m = null;
  try {
    if (typeof qrcode !== 'function') throw new Error('QR library missing');
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, ecc);
    q.addData(data || ' ');
    q.make();
    const n = q.getModuleCount();
    m = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
      m.push(row);
    }
  } catch {
    m = null;
  }
  if (qrCache.size > 300) qrCache.clear();
  qrCache.set(key, m);
  return m;
}

function qrLayout(e, n) {
  const size = Math.min(e.w, e.h);
  return { x: e.x + (e.w - size) / 2, y: e.y + (e.h - size) / 2, size, cell: size / n };
}

/* Horizontal runs of dark modules: [row, col, length]. */
function qrRuns(m) {
  const runs = [];
  m.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c]) {
        const s = c;
        while (c < row.length && row[c]) c++;
        runs.push([r, s, c - s]);
      } else c++;
    }
  });
  return runs;
}

/* ---------------------------------------------------------------- SVG */

function placeholderBox(e, text) {
  const fs = clamp(Math.min(e.w, e.h) * 0.14, 1.5, 4);
  return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="#f3f4f6" stroke="#cbd2db" stroke-width="0.3" stroke-dasharray="1 1"/>`
    + `<text x="${e.x + e.w / 2}" y="${e.y + e.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#9aa3af" font-family="${FONT_CSS.helvetica}">${esc(text)}</text>`;
}

function elementSVG(e) {
  switch (e.type) {
    case 'text': {
      const m = textMetrics(e);
      const ax = textAnchorX(e);
      const anchor = { left: 'start', center: 'middle', right: 'end' }[e.align] || 'start';
      const spans = m.lines.map((ln, i) => `<tspan x="${ax}" y="${e.y + m.fs * ASCENT + i * m.lh}">${esc(ln)}</tspan>`).join('');
      return `<text xml:space="preserve" font-family="${FONT_CSS[e.font] || FONT_CSS.helvetica}" font-size="${m.fs}"`
        + ` font-weight="${e.bold ? 700 : 400}" font-style="${e.italic ? 'italic' : 'normal'}" fill="${esc(e.color || '#000000')}"`
        + ` text-anchor="${anchor}">${spans}</text>`;
    }
    case 'image': {
      const im = App.images[e.imgKey];
      if (!im) return placeholderBox(e, 'image missing');
      const f = fitContain(e, im.w, im.h);
      return `<image href="${imageURL(e.imgKey)}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="none"/>`;
    }
    case 'qr': {
      const m = qrMatrix(e.data, e.ecc);
      if (!m) return placeholderBox(e, 'QR: too much data');
      const q = qrLayout(e, m.length);
      let d = '';
      for (const [r, c, len] of qrRuns(m)) d += `M${q.x + c * q.cell} ${q.y + r * q.cell}h${len * q.cell}v${q.cell}h${-len * q.cell}z`;
      const bg = e.bgNone ? '' : `<rect x="${q.x}" y="${q.y}" width="${q.size}" height="${q.size}" fill="${esc(e.bg || '#ffffff')}"/>`;
      return `${bg}<path d="${d}" fill="${esc(e.color || '#000000')}" shape-rendering="crispEdges"/>`;
    }
    case 'rect': {
      const sw = e.strokeWidth || 0;
      const rx = clamp(e.radius || 0, 0, Math.min(e.w, e.h) / 2);
      return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${rx}" fill="${e.noFill ? 'none' : esc(e.fill)}"`
        + ` stroke="${sw > 0 ? esc(e.stroke) : 'none'}" stroke-width="${sw}"/>`;
    }
    case 'ellipse': {
      const sw = e.strokeWidth || 0;
      return `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${e.noFill ? 'none' : esc(e.fill)}"`
        + ` stroke="${sw > 0 ? esc(e.stroke) : 'none'}" stroke-width="${sw}"/>`;
    }
    case 'line': {
      const [x1, y1, x2, y2] = lineEnds(e);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${esc(e.color || '#000000')}" stroke-width="${e.thickness || 0.3}"/>`;
    }
    default:
      return '';
  }
}

function lineEnds(e) {
  return isVertical(e)
    ? [e.x + e.w / 2, e.y, e.x + e.w / 2, e.y + e.h]
    : [e.x, e.y + e.h / 2, e.x + e.w, e.y + e.h / 2];
}

/* A label's design in label-local mm, clipped to the (rounded) label shape.
   ghost: also draw a faint copy of anything that spills past the label edge. */
function designSVG(box, design, clipId, opts = {}) {
  const r = cornerR(box);
  const els = design.elements.map(elementSVG).join('');
  let s = `<clipPath id="${clipId}"><rect width="${box.w}" height="${box.h}" rx="${r}"/></clipPath>`;
  if (opts.ghost) s += `<g opacity="0.22">${els}</g>`;
  s += `<g clip-path="url(#${clipId})"><rect width="${box.w}" height="${box.h}" fill="${esc(design.bg || '#ffffff')}"/>${els}</g>`;
  return s;
}

function sheetThumbSVG(sheet, width = 56) {
  const labels = sheet.labels.map((l, i) => {
    const id = 'th' + uid() + i;
    return `<g transform="translate(${l.x} ${l.y})">${designSVG(l, l.design, id)}`
      + `<rect width="${l.w}" height="${l.h}" rx="${cornerR(l)}" fill="none" stroke="#9aa3af" stroke-width="0.8"/></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A4.w} ${A4.h}" width="${width}" height="${width * A4.h / A4.w}">`
    + `<rect width="${A4.w}" height="${A4.h}" fill="#fff"/>${labels}</svg>`;
}

function designThumbSVG(w, h, design, max = 56) {
  const s = max / Math.max(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ${w + 1} ${h + 1}" width="${w * s}" height="${h * s}">`
    + designSVG({ w, h, radius: 2 }, design, 'td' + uid())
    + `<rect width="${w}" height="${h}" rx="2" fill="none" stroke="#9aa3af" stroke-width="${0.6 / s}"/></svg>`;
}

/* ---------------------------------------------------------------- interaction helpers */

function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/* Bigger handles and hit areas for fingers than for a mouse. */
const TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const HANDLE_PX = TOUCH ? 16 : 9;
const HIT_PX = TOUCH ? 18 : 6;
const EL_PAD_PX = TOUCH ? 8 : 3;
const DRAG_START_PX = TOUCH ? 6 : 3;

const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

function handlePoint(b, hd) {
  return {
    x: hd.includes('w') ? b.x : hd.includes('e') ? b.x + b.w : b.x + b.w / 2,
    y: hd.includes('n') ? b.y : hd.includes('s') ? b.y + b.h : b.y + b.h / 2,
  };
}

function hitHandle(b, list, p, tol) {
  return list.find((hd) => {
    const q = handlePoint(b, hd);
    return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;
  }) || null;
}

function handlesSVG(b, list, px) {
  const s = HANDLE_PX * px;
  return list.map((hd) => {
    const q = handlePoint(b, hd);
    return `<rect x="${q.x - s / 2}" y="${q.y - s / 2}" width="${s}" height="${s}" rx="${1.5 * px}" fill="#fff" stroke="#2563eb" stroke-width="${1.5 * px}"/>`;
  }).join('');
}

const inBox = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

function resizeBox(b, hd, dx, dy, min, keepAspect) {
  let { x, y, w, h } = b;
  if (hd.includes('e')) w = b.w + dx;
  if (hd.includes('w')) { w = b.w - dx; x = b.x + dx; }
  if (hd.includes('s')) h = b.h + dy;
  if (hd.includes('n')) { h = b.h - dy; y = b.y + dy; }
  if (keepAspect && hd.length === 2) {
    const ar = b.w / b.h;
    if (w / h > ar) h = w / ar; else w = h * ar;
    if (hd.includes('w')) x = b.x + b.w - w;
    if (hd.includes('n')) y = b.y + b.h - h;
  }
  if (w < min) { w = min; if (hd.includes('w')) x = b.x + b.w - min; }
  if (h < min) { h = min; if (hd.includes('n')) y = b.y + b.h - min; }
  return { x, y, w, h };
}

/* Snap a moving/resizing box to target lines. Mutates nb, returns guide lines. */
function snapBox(nb, kind, hd, xs, ys, thr) {
  const guides = [];
  const pick = (cands, targets) => {
    let best = null;
    for (const [k, v] of cands) {
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { k, d, t };
      }
    }
    return best;
  };
  const cx = kind === 'move'
    ? [['a', nb.x], ['c', nb.x + nb.w / 2], ['b', nb.x + nb.w]]
    : [hd.includes('w') ? ['a', nb.x] : null, hd.includes('e') ? ['b', nb.x + nb.w] : null].filter(Boolean);
  const cy = kind === 'move'
    ? [['a', nb.y], ['c', nb.y + nb.h / 2], ['b', nb.y + nb.h]]
    : [hd.includes('n') ? ['a', nb.y] : null, hd.includes('s') ? ['b', nb.y + nb.h] : null].filter(Boolean);
  const bx = pick(cx, xs);
  if (bx) {
    if (kind === 'move') nb.x += bx.d;
    else if (bx.k === 'a') { nb.x += bx.d; nb.w -= bx.d; } else nb.w += bx.d;
    guides.push({ axis: 'x', v: bx.t });
  }
  const by = pick(cy, ys);
  if (by) {
    if (kind === 'move') nb.y += by.d;
    else if (by.k === 'a') { nb.y += by.d; nb.h -= by.d; } else nb.h += by.d;
    guides.push({ axis: 'y', v: by.t });
  }
  return guides;
}

function clampMove(b, W, H) {
  return { ...b, x: clamp(b.x, 0, Math.max(0, W - b.w)), y: clamp(b.y, 0, Math.max(0, H - b.h)) };
}

function clampResize(b, W, H) {
  const n = { ...b };
  if (n.x < 0) { n.w += n.x; n.x = 0; }
  if (n.y < 0) { n.h += n.y; n.y = 0; }
  if (n.x + n.w > W) n.w = W - n.x;
  if (n.y + n.h > H) n.h = H - n.y;
  return n;
}

function guidesSVG(guides, vb, px) {
  return guides.map((g) => (g.axis === 'x'
    ? `<line x1="${g.v}" x2="${g.v}" y1="${vb[1]}" y2="${vb[1] + vb[3]}" stroke="#e11d8f" stroke-width="${px}"/>`
    : `<line y1="${g.v}" y2="${g.v}" x1="${vb[0]}" x2="${vb[0] + vb[2]}" stroke="#e11d8f" stroke-width="${px}"/>`)).join('');
}

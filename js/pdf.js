'use strict';
/*
 * Vector PDF export. jsPDF runs in millimetres on an exact 210 × 297 mm A4 page,
 * so every label keeps its exact size and position — nothing is re-fitted.
 */

/* With data loaded, each data row fills one label position; otherwise the sheet prints as designed. */
function buildPDF(sheet, data = dataActive() ? App.data : null) {
  if (!window.jspdf) throw new Error('The PDF library did not load (vendor/jspdf.umd.min.js).');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  if (data) {
    mergePlan(sheet, data).pages.forEach((page, p) => {
      if (p) doc.addPage('a4', 'portrait');
      page.forEach((row, pos) => {
        if (row) drawLabelPDF(doc, sheet.labels[pos], sheet, mergeDesign(designForMerge(sheet, sheet.labels[pos]), recordFor(row, data)));
      });
    });
  } else {
    const copies = clamp(Math.round(sheet.copies || 1), 1, 100);
    for (let p = 0; p < copies; p++) {
      if (p) doc.addPage('a4', 'portrait');
      sheet.labels.forEach((l) => drawLabelPDF(doc, l, sheet));
    }
  }
  doc.setProperties({ title: sheet.name || 'Labels', creator: 'Peelpress' });
  return doc;
}

function pdfBox(doc, x, y, w, h, r, style) {
  if (r > 0) doc.roundedRect(x, y, w, h, r, r, style);
  else doc.rect(x, y, w, h, style);
}

function drawLabelPDF(doc, l, sheet, design = l.design) {
  const r = cornerR(l);
  doc.saveGraphicsState();
  try {
    pdfBox(doc, l.x, l.y, l.w, l.h, r, null); // path only
    doc.clip();
    doc.discardPath();
  } catch (err) {
    console.warn('Clipping unavailable; content is not clipped to the label shape.', err);
  }
  const bg = (design.bg || '#ffffff').toLowerCase();
  if (bg !== '#ffffff') {
    doc.setFillColor(bg);
    pdfBox(doc, l.x, l.y, l.w, l.h, r, 'F');
  }
  design.elements.forEach((e) => drawElementPDF(doc, e, l.x, l.y));
  doc.restoreGraphicsState();

  if (sheet.printBorders && l.border > 0) {
    doc.setDrawColor(l.borderColor || '#000000');
    doc.setLineWidth(l.border);
    pdfBox(doc, l.x, l.y, l.w, l.h, r, 'S');
  }
}

function shapeStyle(doc, e) {
  const fill = !e.noFill;
  const stroke = (e.strokeWidth || 0) > 0;
  if (fill) doc.setFillColor(e.fill || '#000000');
  if (stroke) {
    doc.setDrawColor(e.stroke || '#000000');
    doc.setLineWidth(e.strokeWidth);
  }
  return fill && stroke ? 'FD' : fill ? 'F' : stroke ? 'S' : null;
}

function drawElementPDF(doc, e, ox, oy) {
  switch (e.type) {
    case 'text': {
      const m = textMetrics(e);
      doc.setFont(e.font || 'helvetica', fontStyle(e));
      doc.setFontSize(e.size);
      doc.setTextColor(e.color || '#000000');
      const ax = ox + textAnchorX(e);
      m.lines.forEach((ln, i) => {
        if (!ln.length) return;
        doc.text(ln, ax, oy + e.y + m.fs * ASCENT + i * m.lh, { align: e.align || 'left', baseline: 'alphabetic' });
      });
      return;
    }
    case 'image': {
      const im = App.images[e.imgKey];
      if (!im) return;
      const f = fitContain(e, im.w, im.h);
      doc.addImage(im.data, im.fmt, ox + f.x, oy + f.y, f.w, f.h, e.imgKey, 'FAST');
      return;
    }
    case 'qr': {
      const m = qrMatrix(e.data, e.ecc);
      if (!m) return;
      const q = qrLayout(e, m.length);
      if (!e.bgNone) {
        doc.setFillColor(e.bg || '#ffffff');
        doc.rect(ox + q.x, oy + q.y, q.size, q.size, 'F');
      }
      doc.setFillColor(e.color || '#000000');
      const seam = q.cell * 0.02; // tiny overlap hides hairline seams in some PDF viewers
      for (const [r, c, len] of qrRuns(m)) {
        doc.rect(ox + q.x + c * q.cell, oy + q.y + r * q.cell, len * q.cell + seam, q.cell + seam, 'F');
      }
      return;
    }
    case 'rect': {
      const st = shapeStyle(doc, e);
      if (st) pdfBox(doc, ox + e.x, oy + e.y, e.w, e.h, clamp(e.radius || 0, 0, Math.min(e.w, e.h) / 2), st);
      return;
    }
    case 'ellipse': {
      const st = shapeStyle(doc, e);
      if (st) doc.ellipse(ox + e.x + e.w / 2, oy + e.y + e.h / 2, e.w / 2, e.h / 2, st);
      return;
    }
    case 'line': {
      const [x1, y1, x2, y2] = lineEnds(e);
      doc.setDrawColor(e.color || '#000000');
      doc.setLineWidth(e.thickness || 0.3);
      doc.line(ox + x1, oy + y1, ox + x2, oy + y2);
      return;
    }
    default:
  }
}

/* Width of a single text line in mm, using the PDF font metrics when available. */
let measureDoc = null;
let measureCtx = null;

function textWidthMM(e, s) {
  try {
    if (window.jspdf) {
      if (!measureDoc) measureDoc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      measureDoc.setFont(e.font || 'helvetica', fontStyle(e));
      measureDoc.setFontSize(e.size);
      return measureDoc.getTextWidth(s);
    }
  } catch { /* fall back to canvas */ }
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${e.italic ? 'italic ' : ''}${e.bold ? 'bold ' : ''}100px ${FONT_CSS[e.font] || FONT_CSS.helvetica}`;
  return (measureCtx.measureText(s).width / 100) * e.size * PT;
}

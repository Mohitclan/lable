'use strict';
/* First-launch library: three starter label designs and three sheet layouts. */

function seedText(p) {
  const e = {
    id: uid(), type: 'text', text: '', font: 'helvetica', size: 11, bold: false, italic: false,
    align: 'left', color: '#111827', lineHeight: 1.2, x: 0, y: 0, w: 50, h: 0, ...p,
  };
  e.h = textMetrics(e).height;
  return e;
}
const seedLine = (p) => ({ id: uid(), type: 'line', dir: 'h', thickness: 0.4, color: '#111827', x: 0, y: 0, w: 50, h: 3, ...p });
const seedRect = (p) => ({ id: uid(), type: 'rect', fill: '#e5e7eb', noFill: false, stroke: '#111827', strokeWidth: 0, radius: 0, x: 0, y: 0, w: 20, h: 10, ...p });
const seedQR = (p) => ({ id: uid(), type: 'qr', data: 'https://example.com', ecc: 'M', color: '#000000', bg: '#ffffff', bgNone: false, x: 0, y: 0, w: 25, h: 25, ...p });

function seedLibrary() {
  const base = newSheet();
  const W = base.labels[0].w; // 95 mm
  const H = base.labels[0].h; // 138.5 mm
  const now = Date.now();

  const company = {
    id: uid(), name: 'Company Address', w: W, h: H, savedAt: now,
    design: {
      bg: '#ffffff',
      elements: [
        seedText({ text: 'YOUR COMPANY NAME', size: 16, bold: true, align: 'center', x: 6, y: 16, w: W - 12 }),
        seedText({ text: 'Tagline or department', size: 9, italic: true, align: 'center', color: '#4b5563', x: 6, y: 25, w: W - 12 }),
        seedLine({ x: 20, y: 30.5, w: W - 40, thickness: 0.4 }),
        seedText({ text: '123 Business Street\nIndustrial Area, Sector 5\nCity, State 000000\nCountry', size: 11, align: 'center', x: 6, y: 40, w: W - 12 }),
        seedText({ text: 'Phone: +00 00000 00000\nEmail: hello@company.com\nwww.company.com', size: 9.5, align: 'center', color: '#374151', x: 6, y: 68, w: W - 12 }),
        seedQR({ data: 'https://www.company.com', x: (W - 30) / 2, y: 94, w: 30, h: 30 }),
      ],
    },
  };

  const product = {
    id: uid(), name: 'Product Information', w: W, h: H, savedAt: now,
    design: {
      bg: '#ffffff',
      elements: [
        seedRect({ x: 0, y: 0, w: W, h: 24, fill: '#1f2937' }),
        seedText({ text: 'PRODUCT NAME', size: 17, bold: true, color: '#ffffff', align: 'center', x: 5, y: 6, w: W - 10 }),
        seedText({ text: 'Short product description', size: 9, color: '#d1d5db', align: 'center', x: 5, y: 15, w: W - 10 }),
        seedText({ text: 'SKU:\nBatch No:\nMfg. Date:\nExpiry:\nNet Qty:', size: 11, bold: true, x: 8, y: 33, w: 30 }),
        seedText({ text: '000-000\nB-0000\nDD/MM/YYYY\nDD/MM/YYYY\n000 g', size: 11, x: 38, y: 33, w: 50 }),
        seedLine({ x: 8, y: 61.5, w: W - 16, thickness: 0.3, color: '#9ca3af' }),
        seedText({ text: 'Ingredients / materials:\nList the contents of the product here.', size: 9, color: '#374151', x: 8, y: 70, w: W - 16 }),
        seedText({ text: 'Scan for\nproduct details', size: 8, color: '#6b7280', x: 8, y: 112, w: 45 }),
        seedQR({ data: 'SKU-000-000', x: W - 8 - 27, y: 101, w: 27, h: 27 }),
      ],
    },
  };

  const shipping = {
    id: uid(), name: 'Shipping Label', w: W, h: H, savedAt: now,
    design: {
      bg: '#ffffff',
      elements: [
        seedRect({ x: 5, y: 5, w: W - 10, h: 42, noFill: true, stroke: '#111827', strokeWidth: 0.5, radius: 2 }),
        seedText({ text: 'SHIP TO', size: 9, bold: true, color: '#6b7280', x: 9, y: 8, w: 50 }),
        seedText({ text: 'Recipient Name', size: 16, bold: true, x: 9, y: 13, w: W - 18 }),
        seedText({ text: 'House / Flat No., Street\nLocality, Landmark\nCity, State – PIN 000000\nPhone: 00000 00000', size: 11, x: 9, y: 21, w: W - 18 }),
        seedText({ text: 'FROM', size: 9, bold: true, color: '#6b7280', x: 9, y: 54, w: 50 }),
        seedText({ text: 'Your Company Name\nAddress line, City – PIN 000000\nPhone: 00000 00000', size: 10, x: 9, y: 59, w: W - 18 }),
        seedLine({ x: 5, y: 75.5, w: W - 10, thickness: 0.3, color: '#9ca3af' }),
        seedText({ text: 'Order #: __________\nWeight: ______ kg\nDate: ___/___/_____', size: 10, lineHeight: 1.7, x: 9, y: 86, w: 48 }),
        seedQR({ data: 'ORDER-0000', x: W - 9 - 28, y: 84, w: 28, h: 28 }),
      ],
    },
  };

  const address = {
    id: uid(), name: 'Address Label (from data)', w: W, h: H, savedAt: now,
    design: {
      bg: '#ffffff',
      elements: [
        seedText({ text: 'DELIVER TO', size: 9, bold: true, color: '#6b7280', x: 8, y: 10, w: W - 16 }),
        seedText({ text: '{{Name}}', size: 16, bold: true, x: 8, y: 16, w: W - 16 }),
        seedText({ text: '{{Address}}', size: 11.5, x: 8, y: 25, w: W - 16 }),
        seedText({ text: 'Phone: {{Phone}}', size: 11, x: 8, y: 58, w: W - 16 }),
        seedLine({ x: 8, y: 66.5, w: W - 16, thickness: 0.3, color: '#9ca3af' }),
        seedText({ text: 'Order {{Order ID}}', size: 10, color: '#374151', x: 8, y: 74, w: 50 }),
        seedQR({ data: '{{Order ID}}', x: W - 8 - 26, y: 74, w: 26, h: 26 }),
      ],
    },
  };

  const lib = {
    templates: [address, company, product, shipping],
    layouts: [],
    company: {
      name: 'Your Company Name',
      address: '123 Business Street\nCity, State 000000',
      phone: '+00 00000 00000',
      email: 'hello@company.com',
      website: 'www.company.com',
      logoKey: null,
    },
  };

  // Saved sheet layout 1 — the default 4-label sheet, blank and ready to design.
  const standard = newSheet();
  standard.name = 'Standard 4 Labels';

  // Saved sheet layout 2 — mixed sizes on one sheet, each position with its own design.
  const mixed = newSheet();
  mixed.name = 'Mixed Office Labels';
  mixed.mode = 'custom';
  const c = mixed.cfg;
  mixed.labels = ARRANGEMENTS[0].build(contentArea(c), c.gapX, c.gapY)
    .map((b) => newLabel({ ...b, radius: c.radius, border: c.border, borderColor: c.borderColor }));
  applyTemplateToLabel(mixed.labels[0], company, true);
  applyTemplateToLabel(mixed.labels[1], product, true);
  applyTemplateToLabel(mixed.labels[2], product, true);
  applyTemplateToLabel(mixed.labels[3], shipping, true);

  // Saved sheet layout 3 — two large horizontal company stickers.
  const large = newSheet();
  large.name = 'Large Company Stickers';
  large.cfg.cols = 1;
  large.cfg.rows = 2;
  syncGrid(large);
  large.labels.forEach((l) => applyTemplateToLabel(l, company, true));

  lib.layouts = [standard, mixed, large].map((s) => {
    const id = uid();
    s.layoutId = id;
    return { id, name: s.name, savedAt: now, sheet: s };
  });
  return lib;
}

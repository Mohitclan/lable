'use strict';
/* Step 3 — Data: fill the label design from a CSV, Excel sheet, PDF, photo or pasted text. */

const MAX_UPLOAD = 3.2 * 1024 * 1024; // Vercel request limit is 4.5 MB after base64 encoding
const PASSCODE_KEY = 'labelstudio.passcode';

/* ---------------------------------------------------------------- parsing */

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* First row = column names; pads ragged rows and drops blank ones. */
function tableFromMatrix(matrix) {
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const head = matrix[0] || [];
  const used = new Map();
  const columns = Array.from({ length: width }, (_, i) => {
    let name = String(head[i] == null ? '' : head[i]).trim() || `Column ${i + 1}`;
    const n = (used.get(name) || 0) + 1;
    used.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
  const rows = matrix.slice(1)
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] == null ? '' : String(r[i]).trim())))
    .filter((r) => r.some((v) => v !== ''));
  return { columns, rows };
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

const readAsDataURL = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(new Error('Could not read the file.'));
  fr.readAsDataURL(blob);
});

/* Phone photos are large; shrink to ≤ 2000 px JPEG before sending to the AI. */
async function imageForAI(file) {
  const url = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Unsupported image.')); im.src = url; });
  const sc = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * sc);
  cv.height = Math.round(img.naturalHeight * sc);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.88).split(',')[1];
}

/* ---------------------------------------------------------------- loading */

function setTable({ columns, rows }, meta) {
  if (!columns.length || !rows.length) {
    toast('No rows found in that data.', 'warn');
    return;
  }
  const d = App.data;
  Object.assign(d, { columns, rows, skip: [], fileName: meta.fileName || '', source: meta.source, notes: meta.notes || '', enabled: true });
  d.mapping = autoMap(designFields(), columns, d.mapping);
  App.ui.dataPage = 0;
  saveData();
  requestRender(true);
  const unlinked = designFields().filter((f) => !d.mapping[f]);
  if (unlinked.length) {
    toast(`Loaded ${plural(rows.length, 'row')}. Your current design has fields this file doesn’t have (${unlinked.map((f) => `{{${f}}}`).join(', ')}) — match them, or make a new design from this file’s columns.`, 'warn');
  } else {
    toast(`Loaded ${plural(rows.length, 'row')} from ${meta.fileName || 'your text'}. Your label design is unchanged.`, 'ok');
  }
}

async function loadDataFiles(files) {
  const f = files[0];
  if (!f) return;
  const name = f.name.toLowerCase();
  try {
    if (/\.(csv|tsv)$/.test(name) || f.type === 'text/csv') {
      setTable(tableFromMatrix(parseCSV(await f.text())), { fileName: f.name, source: 'file' });
    } else if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
      if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheetName = wb.SheetNames.find((n) => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) || []).length > 1) || wb.SheetNames[0];
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
      setTable(tableFromMatrix(matrix), { fileName: `${f.name} · ${sheetName}`, source: 'file' });
    } else if (name.endsWith('.pdf') || f.type === 'application/pdf') {
      if (f.size > MAX_UPLOAD) throw new Error('That PDF is over 3 MB. Split it into smaller files, or export the data as CSV.');
      const data = (await readAsDataURL(f)).split(',')[1];
      await aiExtract({ kind: 'pdf', data }, f.name);
    } else if (f.type.startsWith('image/')) {
      await aiExtract({ kind: 'image', mediaType: 'image/jpeg', data: await imageForAI(f) }, f.name);
    } else if (/\.(txt|md|json)$/.test(name) || f.type.startsWith('text/')) {
      await aiExtract({ kind: 'text', text: await f.text() }, f.name);
    } else {
      toast('Use a CSV, Excel, PDF, photo or text file.', 'warn');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not read that file.', 'error');
  }
}

/* ---------------------------------------------------------------- AI */

async function aiStatus() {
  if (App.ui.aiStatus) return App.ui.aiStatus;
  try {
    const res = await fetch('api/extract', { method: 'GET' });
    App.ui.aiStatus = res.ok ? await res.json() : { offline: true };
  } catch {
    App.ui.aiStatus = { offline: true };
  }
  requestRender(true);
  return App.ui.aiStatus;
}

async function aiExtract(source, label) {
  const st = await aiStatus();
  if (st.offline) throw new Error('Reading PDFs, photos and text with AI works on the hosted app (Vercel). CSV and Excel files work everywhere.');
  if (!st.ai) throw new Error('AI reading is not set up yet — add GEMINI_API_KEY (or ANTHROPIC_API_KEY) in your Vercel project settings.');

  const ctrl = new AbortController();
  App.ui.aiBusy = { label, ctrl };
  requestRender(true);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let pass = '';
      try { pass = localStorage.getItem(PASSCODE_KEY) || ''; } catch { /* storage blocked */ }
      const res = await fetch('api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-passcode': pass },
        body: JSON.stringify({ fields: designFields(), source, hint: App.data.hint || '' }),
        signal: ctrl.signal,
      });
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON error page */ }
      if (res.status === 401 && attempt === 0) {
        const code = await askText('Passcode needed', 'Enter the passcode for AI reading', '');
        if (!code) return;
        try { localStorage.setItem(PASSCODE_KEY, code); } catch { /* storage blocked */ }
        continue;
      }
      if (!res.ok || !body) throw new Error((body && (body.message || body.error)) || `The AI request failed (${res.status}). Large files can time out — try a smaller one.`);
      setTable(tableFromMatrix([body.columns, ...body.rows]), { fileName: label, source: 'ai', notes: body.notes });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('Stopped.');
    else throw err;
  } finally {
    App.ui.aiBusy = null;
    requestRender(true);
  }
}

function openPasteDialog() {
  openModal('Paste text for the AI to read', (body, foot, close) => {
    const ta = h('textarea', { class: 'text-input', rows: 10, placeholder: 'Paste addresses, an order list, an email… anything with the details for your labels.' });
    body.append(hint('The AI finds each record (one per label) and fills your data fields. Check the result before printing.'), ta);
    foot.append(btn('Cancel', () => close(), 'ghost'), ibtn('sparkles', 'Read with AI', async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      close();
      try { await aiExtract({ kind: 'text', text }, 'pasted text'); } catch (err) { toast(err.message, 'error'); }
    }, 'primary'));
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  }, { wide: true });
}

/* ---------------------------------------------------------------- actions */

async function clearData() {
  if (!(await confirmBox('Remove the data?', 'Your label design stays; the loaded rows are removed.', 'Remove', true))) return;
  App.data = { ...newData(), mapping: App.data.mapping, hint: App.data.hint };
  saveData();
  requestRender(true);
}

/* ---------------------------------------------------------------- QR codes from data */

/* QR content that carries every column of a row, one "Column: value" line each. */
function detailsQRText(cols = App.data.columns) {
  return cols.map((c) => `${c}: {{${c}}}`).join('\n');
}

/* What the QR codes on the sheet do with data: none, the same code everywhere, or each label its own. */
function qrStatus() {
  const qrs = App.sheet.labels.flatMap((l) => l.design.elements.filter((e) => e.type === 'qr'));
  if (!qrs.length) return { kind: 'none' };
  const fields = [...new Set(qrs.flatMap((q) => [...String(q.data || '').matchAll(FIELD_RE)].map((m) => m[1])))];
  return fields.length ? { kind: 'own', fields } : { kind: 'same', data: String(qrs[0].data || '') };
}

/* Every designed label's QR code carries that row's full details; a label without a QR gets one
   in its bottom-right corner. */
function qrShowDetails() {
  if (!App.data.columns.length) { toast('Add a CSV or Excel file first.', 'warn'); return; }
  if (!App.sheet.labels.some((l) => l.design.elements.length)) { toast('Design a label first (step 2), or use “Create a design from my columns”.', 'warn'); return; }
  const text = detailsQRText();
  let added = 0;
  mutate('qr-details', () => {
    for (const l of App.sheet.labels) {
      if (!l.design.elements.length) continue;
      const qrs = l.design.elements.filter((e) => e.type === 'qr');
      if (qrs.length) {
        qrs.forEach((q) => { q.data = text; });
      } else {
        const size = clamp(Math.min(l.w, l.h) * 0.3, 15, 30);
        const m = Math.min(5, l.w * 0.06);
        l.design.elements.push({ id: uid(), type: 'qr', data: text, ecc: 'M', color: '#000000', bg: '#ffffff', bgNone: false, x: l.w - m - size, y: l.h - m - size, w: size, h: size });
        added++;
      }
    }
  });
  App.data.mapping = autoMap(designFields(), App.data.columns, App.data.mapping);
  saveData();
  requestRender(true);
  toast(`Every label’s QR code now shows that customer’s ${App.data.columns.join(', ')}.${added ? ' A QR code was added to the bottom-right corner — move it in step 2 if it covers something.' : ''}`, 'ok');
}

/* Adds the data columns to an existing design as one {{field}} text block, in free space below
   what is already there (or at the bottom), without touching anything else. */
function addColumnsToDesign(l) {
  const cols = App.data.columns.slice(0, 8);
  if (!cols.length) return;
  const m = Math.min(6, l.w * 0.07);
  const base = Math.round(clamp(Math.min(l.w, l.h) * 0.09, 7, 13) * 2) / 2;
  const e = newTextEl(l, { text: cols.map((c) => `{{${c}}}`).join('\n'), size: base, align: 'left', x: m, y: 0, w: l.w - 2 * m });
  const below = l.design.elements.length ? Math.max(...l.design.elements.map((x) => x.y + x.h)) + 3 : m;
  e.y = below + e.h <= l.h - m ? below : Math.max(m, l.h - m - e.h);
  l.design.elements.push(e);
}

/* One click: every label position gets the design, and every data row gets its own label. */
async function applyDataToAll() {
  const d = App.data;
  if (!d.rows.length) { toast('Add a CSV or Excel file first.', 'warn'); return; }
  const labels = App.sheet.labels;
  const edit = labelById(App.ui.editLabelId);
  const src = edit && edit.design.elements.length ? edit : labels.find((l) => l.design.elements.length);
  let added = false;
  if (!src) {
    await designFromColumns();
    if (!designFields().length) return;
  } else {
    // Ask first, and only when other labels really have a design of their own that would be replaced.
    const shape = (x) => JSON.stringify(x.design.elements.map(({ id, ...rest }) => rest));
    const differing = labels.filter((l) => l !== src && l.design.elements.length && shape(l) !== shape(src));
    if (differing.length && !(await confirmBox('Use one design on every label?',
      `Label ${labelIndex(src.id) + 1}’s design will be copied to all ${labels.length} labels, replacing the different design on ${plural(differing.length, 'label')}. Undo with Ctrl+Z.`, 'Apply to all'))) return;
    mutate('apply-all', () => {
      // Keep the person's own design: when it has no data fields yet, add the columns into it.
      if (!designFields().length) {
        addColumnsToDesign(src);
        added = true;
      }
      labels.forEach((l) => { if (l !== src) applyDesignToLabel(l, src.design, src.w, src.h, true); });
    });
  }
  d.enabled = true;
  d.startAt = 1;
  d.mapping = autoMap(designFields(), d.columns, d.mapping);
  saveData();
  App.ui.previewData = true;
  App.ui.dataPage = 0;
  setMode('data');
  const plan = mergePlan();
  toast(`Done — ${plan.records === 1 ? '1 person' : `${plan.records} people`}, one label each, on ${plural(plan.pages.length, 'page')}.`
    + (added ? ' Your design was kept; your columns were added to it as a text block you can move in step 2.' : ''), 'ok');
}

/* Quick start: build a simple design from the data columns and put it on every label. */
async function designFromColumns() {
  const cols = App.data.columns.slice(0, 8);
  if (!cols.length) return;
  if (App.sheet.labels.some((l) => l.design.elements.length)
    && !(await confirmBox('Replace the label designs?', `Put a simple design with ${cols.map((c) => `{{${c}}}`).join(', ')} on every label? You can restyle it afterwards in step 2.`, 'Create design'))) return;
  mutate('design-from-data', () => {
    for (const l of App.sheet.labels) {
      const m = Math.min(6, l.w * 0.07);
      const base = clamp(Math.min(l.w, l.h) * 0.1, 7, 14);
      const title = newTextEl(l, { text: `{{${cols[0]}}}`, bold: true, size: base * 1.3, align: 'left', x: m, y: m });
      const els = [title];
      if (cols.length > 1) {
        els.push(newTextEl(l, { text: cols.slice(1).map((c) => `{{${c}}}`).join('\n'), size: base, align: 'left', color: '#374151', x: m, y: m + title.h + 2 }));
      }
      l.design = { ...newDesign(), elements: els };
    }
  });
  App.data.mapping = autoMap(designFields(), App.data.columns, App.data.mapping);
  saveData();
  toast('Design created. Open step 2 to style it.', 'ok');
}

function setDataProp(k, v) {
  App.data[k] = v;
  saveData();
  requestRender();
}

function openDataTable() {
  const d = App.data;
  openModal(`Your data · ${plural(d.rows.length, 'row')}`, (body, foot, close) => {
    const search = h('input', { type: 'search', class: 'text-input', placeholder: 'Search rows…' });
    const count = h('span', { class: 'muted-sm' });
    const wrap = h('div', { class: 'table-wrap' });
    const LIMIT = 500;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const idx = d.rows.map((r, i) => i).filter((i) => !q || d.rows[i].some((v) => v.toLowerCase().includes(q)));
      count.textContent = `${idx.length} shown · ${d.rows.length - d.skip.length} will print`;
      const thead = h('thead', {}, h('tr', {}, h('th', { class: 'c-inc', title: 'Print this row' }, '✓'), h('th', { class: 'c-num' }, '#'), ...d.columns.map((c) => h('th', {}, c)), h('th', {})));
      const tbody = h('tbody', {}, ...idx.slice(0, LIMIT).map((i) => {
        const inc = h('input', { type: 'checkbox' });
        inc.checked = !d.skip.includes(i);
        inc.addEventListener('change', () => {
          d.skip = inc.checked ? d.skip.filter((x) => x !== i) : [...d.skip, i];
          saveData();
          draw();
          requestRender();
        });
        return h('tr', { class: d.skip.includes(i) ? 'off' : '' },
          h('td', { class: 'c-inc' }, inc),
          h('td', { class: 'c-num' }, String(i + 1)),
          ...d.columns.map((c, ci) => {
            const cell = h('textarea', { rows: 1, 'aria-label': `${c}, row ${i + 1}` });
            cell.value = d.rows[i][ci];
            cell.addEventListener('input', () => { d.rows[i][ci] = cell.value; saveData(); requestRender(); });
            return h('td', {}, cell);
          }),
          h('td', {}, btn(icon('trash', 14), () => {
            d.rows.splice(i, 1);
            d.skip = d.skip.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
            saveData();
            draw();
            requestRender();
          }, 'icon ghost danger', 'Delete row')));
      }));
      wrap.replaceChildren(h('table', { class: 'data-table' }, thead, tbody));
      if (idx.length > LIMIT) wrap.append(hint(`Showing the first ${LIMIT} matches — search to find others.`));
    };
    search.addEventListener('input', draw);
    body.append(h('div', { class: 'table-tools' }, search, count), wrap);
    foot.append(
      ibtn('plus', 'Add row', () => { d.rows.push(d.columns.map(() => '')); saveData(); search.value = ''; draw(); wrap.scrollTop = wrap.scrollHeight; }, 'ghost'),
      h('span', { class: 'spacer' }),
      btn('Done', () => close(), 'primary'),
    );
    draw();
  }, { wide: true, full: true }).then(() => requestRender(true));
}

/* ---------------------------------------------------------------- checks */

function dataWarnings() {
  const d = App.data;
  const out = [];
  const fields = designFields();
  if (!d.rows.length) return out;
  if (!fields.length) {
    out.push({ level: 'warn', ids: [], msg: 'Your design has no data fields yet, so every label prints the same. Use “Create a design from my columns” or add {{fields}} in step 2.' });
    return out;
  }
  for (const f of fields) {
    if (!d.mapping[f]) out.push({ level: 'warn', ids: [], msg: `{{${f}}} is not linked to a column, so it will print empty.` });
  }
  const rows = dataRows();
  for (const f of fields) {
    const col = d.columns.indexOf(d.mapping[f]);
    if (col < 0) continue;
    const empty = rows.filter((r) => !String(r[col]).trim()).length;
    if (empty) out.push({ level: 'info', ids: [], msg: `${plural(empty, 'row')} ${empty === 1 ? 'has' : 'have'} no ${f}.` });
  }
  // Check how merged text fits, for the first few hundred labels.
  const over = [];
  let checked = 0;
  const plan = mergePlan();
  plan.pages.forEach((page) => page.forEach((row, pos) => {
    if (!row || checked > 300 || over.length > 8) return;
    checked++;
    const l = App.sheet.labels[pos];
    const merged = mergeDesign(designForMerge(App.sheet, l), recordFor(row));
    if (labelWarnings({ ...l, design: merged }).some((w) => /cut off|cannot print/.test(w.msg))) over.push(d.rows.indexOf(row) + 1);
  }));
  if (over.length) out.push({ level: 'warn', ids: [], msg: `Text runs past the label edge or has unprintable characters on row${over.length > 1 ? 's' : ''} ${over.join(', ')}${over.length > 8 ? '…' : ''}. Make the text smaller or the box wider in step 2.` });
  const src = App.sheet.labels.findIndex((l) => l.design.elements.length);
  const blank = App.sheet.labels.map((l, i) => (l.design.elements.length ? 0 : i + 1)).filter(Boolean);
  if (src >= 0 && blank.length) {
    const many = blank.length > 1;
    out.push({ level: 'info', ids: [], msg: `Label${many ? 's' : ''} ${blank.join(', ')} ${many ? 'have' : 'has'} no design of ${many ? 'their' : 'its'} own, so ${many ? 'they use' : 'it uses'} Label ${src + 1}’s design.` });
  }
  const qs = qrStatus();
  if (qs.kind === 'same') out.push({ level: 'warn', ids: [], msg: 'Every label has the same QR code. Use “Make each QR show its customer’s details” so scanning shows that label’s customer.' });
  if (d.notes) out.push({ level: 'info', ids: [], msg: `AI note: ${d.notes}` });
  return out;
}

/* ---------------------------------------------------------------- view */

const DataView = {
  PAD: 8,
  px: 0.3,

  vb() { const p = this.PAD; return [-p, -p, A4.w + 2 * p, A4.h + 2 * p]; },
  fitPPM() {
    const s = stageBox();
    const [, , w, h] = this.vb();
    return Math.max(0.4, Math.min(s.w / w, s.h / h));
  },
  ppm() { return App.ui.zoom.data || this.fitPPM(); },

  plan() { return dataActive() ? mergePlan() : null; },

  renderCanvas() {
    const svg = $('#canvas');
    const vb = this.vb();
    const ppm = this.ppm();
    const px = 1 / ppm;
    this.px = px;
    svg.setAttribute('viewBox', vb.join(' '));
    svg.style.width = vb[2] * ppm + 'px';
    svg.style.height = vb[3] * ppm + 'px';
    const plan = this.plan();
    const pages = plan ? plan.pages.length : 1;
    App.ui.dataPage = clamp(App.ui.dataPage || 0, 0, pages - 1);
    const page = plan ? plan.pages[App.ui.dataPage] : null;

    let o = `<defs><filter id="pgShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0.8" stdDeviation="1.6" flood-color="#0f172a" flood-opacity="0.18"/></filter></defs>`;
    o += `<rect width="${A4.w}" height="${A4.h}" fill="#fff" filter="url(#pgShadow)"/>`;
    App.sheet.labels.forEach((l, i) => {
      const r = cornerR(l);
      const row = page ? page[i] : undefined;
      o += `<g transform="translate(${l.x} ${l.y})">`;
      if (row === null) {
        o += `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="#f8fafc" stroke="#cbd2db" stroke-width="${px}" stroke-dasharray="${3 * px} ${2 * px}"/>`;
        const fs = clamp(Math.min(l.w, l.h) * 0.06, 2, 5);
        o += `<text x="${l.w / 2}" y="${l.h / 2 + fs * 0.35}" text-anchor="middle" font-family="${FONT_CSS.helvetica}" font-size="${fs}" fill="#9aa3af">left empty</text>`;
      } else {
        const design = row ? mergeDesign(designForMerge(App.sheet, l), recordFor(row)) : l.design;
        o += designSVG(l, design, 'dv' + i);
        o += `<rect width="${l.w}" height="${l.h}" rx="${r}" fill="none" stroke="${l.border > 0 ? esc(l.borderColor) : '#cfd4dc'}" stroke-width="${Math.max(l.border || 0, px)}"/>`;
      }
      o += '</g>';
    });
    svg.innerHTML = o;
  },

  pointerDown() { return false; },
  pointerMove(e) { $('#canvas').style.cursor = e.pointerType === 'touch' ? 'default' : 'grab'; },
  pointerUp() {},
  dblClick() { if (App.data.rows.length) openDataTable(); },
  deselect() {},
  onKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.goPage(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.goPage(-1); }
  },
  goPage(dir) {
    const plan = this.plan();
    if (!plan) return;
    App.ui.dataPage = clamp((App.ui.dataPage || 0) + dir, 0, plan.pages.length - 1);
    requestRender();
  },

  panelKey() {
    const d = App.data;
    return ['data', d.columns.join('\u0001'), d.rows.length, designFields().join('\u0001'), d.source, d.fileName,
      !!App.ui.aiBusy, JSON.stringify(App.ui.aiStatus || {}), App.sheet.labels.length, JSON.stringify(qrStatus()),
      App.sheet.labels.some((l) => l.design.elements.length)].join('|');
  },

  renderPanels() {
    const L = $('#leftPanel');
    const R = $('#rightPanel');
    L.replaceChildren();
    R.replaceChildren();
    const d = App.data;
    const fields = designFields();
    if (!App.ui.aiStatus) aiStatus();

    // 1 · Source
    const st = App.ui.aiStatus || {};
    const aiLine = st.offline
      ? note('sparkles', 'AI reading (PDFs, photos, pasted text) turns on when the app is hosted on Vercel.', 'muted')
      : st.ai ? note('sparkles', 'AI reading is on: PDFs, photos and pasted text are read automatically.', 'ok')
        : App.ui.aiStatus ? note('sparkles', 'AI reading is off — add GEMINI_API_KEY (or ANTHROPIC_API_KEY) in Vercel to read PDFs and photos.', 'muted') : null;

    if (App.ui.aiBusy) {
      L.append(section('1 · Your data',
        h('div', { class: 'busy' }, h('span', { class: 'spinner' }), h('div', {}, h('strong', {}, 'Reading with AI…'), h('span', {}, App.ui.aiBusy.label))),
        hint('This can take up to a minute for long documents.'),
        btn('Stop', () => App.ui.aiBusy && App.ui.aiBusy.ctrl.abort(), 'small ghost'),
      ));
    } else if (d.rows.length) {
      L.append(section('1 · Your data',
        h('div', { class: 'file-card' }, icon(d.source === 'ai' ? 'sparkles' : 'table', 20),
          h('div', {}, h('strong', {}, d.fileName || 'Data'), h('span', {}, `${plural(d.rows.length, 'row')} · ${plural(d.columns.length, 'column')}${d.source === 'ai' ? ' · read by AI' : ''}`))),
        ibtn('layout', 'Apply to all labels', applyDataToAll, 'primary block', 'Put the design on every label and give each row of your file its own label'),
        row(ibtn('table', 'View & edit', openDataTable, 'small'), ibtn('upload', 'Replace', () => $('#dataPick').click(), 'small ghost'), ibtn('trash', '', clearData, 'small ghost danger', 'Remove data')),
        d.source === 'ai' ? note('alert', 'AI can misread things — check the rows before printing.', 'warn') : null,
        h('input', { type: 'file', id: 'dataPick', hidden: true, accept: '.csv,.tsv,.xlsx,.xls,.xlsm,.ods,.pdf,.txt,image/*', onchange: (e) => { if (e.target.files.length) loadDataFiles([...e.target.files]); e.target.value = ''; } }),
      ));
    } else {
      L.append(section('1 · Your data',
        dropZone({ accept: '.csv,.tsv,.xlsx,.xls,.xlsm,.ods,.pdf,.txt,image/*', title: 'Drop a file or click to choose', sub: 'CSV, Excel, PDF or a photo', onFiles: loadDataFiles }),
        row(ibtn('paste', 'Paste text instead', openPasteDialog, 'small ghost')),
        aiLine,
      ));
    }
    if (!App.ui.aiBusy && !st.offline) {
      L.append(group('aihint', 'Instructions for the AI', { open: false },
        textAreaField({ label: 'Optional', rows: 3, get: () => App.data.hint || '', set: (v) => { App.data.hint = v; saveData(); } }),
        hint('For example: “Only the delivery address, not the billing address” or “Skip cancelled orders”.'),
      ));
    }

    // 2 · Match
    if (d.rows.length) {
      if (fields.length) {
        L.append(section('2 · Match your fields',
          hint('Choose which column fills each field on your label.'),
          ...fields.map((f) => selectField({
            label: `{{${f}}}`,
            options: [['', '— leave empty —'], ...d.columns.map((c) => [c, c])],
            get: () => App.data.mapping[f] || '',
            set: (v) => { App.data.mapping = { ...App.data.mapping, [f]: v }; saveData(); requestRender(); },
          })),
          row(btn('Add another field…', () => { setMode('label'); setTimeout(insertFieldDialog, 60); }, 'small ghost')),
          h('div', { class: 'mini-title' }, 'Want a different design for this file?'),
          row(ibtn('sparkles', 'New design from my columns', designFromColumns, 'small', 'Replace the label design with a simple one built from this file’s columns'),
            btn('Pick a template', () => { App.ui.open.templates = true; setMode('label'); if (isMobile()) showSheet('left'); }, 'small ghost')),
        ));
      } else {
        L.append(section('2 · Match your fields',
          note('field', 'Your label has no data fields yet. A data field is a placeholder like {{Name}} that each row fills in.'),
          App.sheet.labels.some((l) => l.design.elements.length)
            ? ibtn('layout', 'Add my columns to my design', applyDataToAll, 'primary block', 'Keeps your design and adds the columns to it')
            : ibtn('sparkles', 'Create a design from my columns', designFromColumns, 'primary block'),
          row(btn('Add fields myself in step 2', () => setMode('label'), 'small ghost'),
            App.sheet.labels.some((l) => l.design.elements.length) ? btn('Replace with a new design', designFromColumns, 'small ghost') : null),
        ));
      }

      // QR code: same everywhere, or each customer's own details
      if (App.sheet.labels.some((l) => l.design.elements.length)) {
        const qs = qrStatus();
        L.append(section('QR code on each label',
          qs.kind === 'none' ? note('qr', 'Your labels have no QR code.')
            : qs.kind === 'same' ? note('alert', `Every label has the same QR code (“${qs.data.length > 40 ? qs.data.slice(0, 40) + '…' : qs.data}”), so it won’t show the customer.`, 'warn')
              : note('check', `Each label has its own QR code, made from ${qs.fields.join(', ')}. Scanning it shows that label’s customer.`, 'ok'),
          ibtn('qr', qs.kind === 'none' ? 'Add a QR with each customer’s details' : qs.kind === 'same' ? 'Make each QR show its customer’s details' : 'Show all customer details in the QR',
            qrShowDetails, (qs.kind === 'own' ? 'small' : 'primary') + ' block', 'Each label’s QR code will hold every column of its row'),
        ));
      }

      // 3 · Options
      L.append(section('3 · Print options',
        h('div', { class: 'field wide' }, h('span', { class: 'lbl' }, 'Start at label (skip used stickers)'), this.startPicker()),
        numField({ label: 'Copies of each', unit: '', step: 1, int: true, min: 1, max: 50, get: () => App.data.copies, set: (v) => setDataProp('copies', v) }),
        checkField({ label: 'Fill labels with this data when downloading', get: () => App.data.enabled, set: (v) => setDataProp('enabled', v) }),
      ));
    }

    // Right panel: summary
    const plan = this.plan();
    if (plan) {
      R.append(section('Ready to print',
        h('div', { class: 'stats' },
          h('div', {}, h('b', {}, dynText(() => String(this.plan() ? this.plan().records : 0))), h('span', {}, 'rows')),
          h('div', {}, h('b', {}, dynText(() => String(this.plan() ? this.plan().labels : 0))), h('span', {}, 'labels')),
          h('div', {}, h('b', {}, dynText(() => String(this.plan() ? this.plan().pages.length : 0))), h('span', {}, 'pages'))),
        ibtn('download', 'Download PDF', generatePDF, 'primary block'),
        ibtn('printer', 'Print', printPDF, 'block'),
      ));
    } else {
      R.append(section('How it works',
        h('ol', { class: 'steps' },
          h('li', {}, h('div', { class: 'step-title' }, 'Add your data'), hint('A spreadsheet, a PDF of orders, a photo of a list — one row per label.')),
          h('li', {}, h('div', { class: 'step-title' }, 'Match the fields'), hint('Link columns to the {{fields}} on your label, or let the app create a design.')),
          h('li', {}, h('div', { class: 'step-title' }, 'Download'), hint('Every row becomes a label; pages are added automatically.'))),
      ));
      if (d.rows.length && !d.enabled) R.append(section('', note('alert', 'Filling is switched off — downloads print the plain design.', 'warn')));
    }
  },

  startPicker() {
    const ls = App.sheet.labels;
    const box = h('div', { class: 'pos-pick', style: `aspect-ratio:${A4.w}/${A4.h}` });
    const btns = ls.map((l, i) => h('button', {
      type: 'button',
      title: `Start at label ${i + 1}`,
      style: `left:${(l.x / A4.w) * 100}%;top:${(l.y / A4.h) * 100}%;width:${(l.w / A4.w) * 100}%;height:${(l.h / A4.h) * 100}%`,
      onclick: () => setDataProp('startAt', i + 1),
    }, String(i + 1)));
    box.append(...btns);
    Bind.add(() => btns.forEach((b, i) => {
      b.classList.toggle('on', i + 1 === App.data.startAt);
      b.classList.toggle('used', i + 1 < App.data.startAt);
    }));
    return box;
  },

  renderAux() {
    const plan = this.plan();
    const pages = plan ? plan.pages.length : 1;
    stageBar(plan ? [
      btn(icon('left', 16), () => this.goPage(-1), 'icon ghost', 'Previous page'),
      h('strong', {}, `Page ${App.ui.dataPage + 1} of ${pages}`),
      btn(icon('right', 16), () => this.goPage(1), 'icon ghost', 'Next page'),
      h('span', { class: 'muted-sm' }, `${plural(plan.labels, 'label')} from ${plural(plan.records, 'row')}`),
    ] : [h('strong', {}, 'Preview'), h('span', { class: 'muted-sm' }, 'Add data to see every label filled in')]);
    renderWarnings(dataWarnings(), 'Checks', App.data.rows.length ? 'Every field is linked and the text fits.' : 'Add data to run the checks.', () => {});
  },
};

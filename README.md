# Peelpress — A4 Label Designer

Design A4 sticker sheets, fill them from a spreadsheet, PDF or photo, and print them at exact physical
size.

The app works in three steps, shown at the top:

| Step | What you do |
| --- | --- |
| **1 Layout** | Pick how the A4 sheet is divided: 4 labels (the default), 2 wide, 2 tall, 6, 8, 10, or a custom layout with mixed sizes. |
| **2 Design** | Put text, a logo, a QR code, shapes and **data fields** such as `{{Name}}` on each label. |
| **3 Data** *(optional)* | Add a CSV, Excel file, PDF or photo. Each row fills one label, and pages are added automatically. |

**Download PDF** (top right) always produces an exact-size A4 PDF. When data is loaded, the button reads
"Download 120 labels" and fills every label from your data.

## Everyday use

1. **Layout:** keep the default 4-label sheet.
2. **Design:** open **Templates** and click **Address Label (from data)**, or design your own label.
3. **Data:** drop in your spreadsheet (or PDF or photo). The fields are matched to your columns
   automatically; check them.
4. Click **Download** and print at **100% / "Actual size"**.

To print identical labels with no data, skip step 3.

## Data fields

- A data field is a placeholder such as `{{Name}}`, `{{Address}}` or `{{Order ID}}`, written inside any
  text box or QR code.
- In step 2, click **Data field** to insert one.
- In step 3, each field is linked to a column. Headers such as *Customer Name → Name*,
  *Mobile → Phone* and *Pincode → PIN* are matched automatically, and you can change any link.
- If your design has no fields yet, **Create a design from my columns** builds a simple one for you.
- **Print options:**
  - **Start at label:** skip stickers already used on a partly used sheet.
  - **Copies of each:** print every row more than once.
  - **Fill labels with this data:** turn the data filling on or off.
- **View & edit** opens your rows in a table. You can fix values, untick rows so they don't print,
  delete rows or add rows.

## Reading PDFs, photos and text with AI

CSV and Excel files are read in the browser, so they work everywhere, even offline. **PDFs, photos and
pasted text** are sent to an AI model (Google Gemini or Anthropic Claude), which turns them into rows. For example: an order
export, a scanned list of addresses, or an email. This needs the app to be hosted on Vercel with an API
key.

1. Get an API key. Either one works; if both are set, Gemini is used:
   - **Gemini** (has a free tier): <https://aistudio.google.com/apikey>
   - **Claude**: <https://console.anthropic.com> (billed per use)
2. In Vercel open **Project → Settings → Environment Variables** and add:
   - `GEMINI_API_KEY` **or** `ANTHROPIC_API_KEY` = your key (**one is required**)
   - `APP_PASSCODE` = any word (**recommended**). Without it, anyone who finds your site's address can
     use your key. With it, the app asks for the passcode once per browser.
   - `GEMINI_MODEL` or `ANTHROPIC_MODEL` (optional) is the model to use. The defaults are
     `gemini-flash-latest` and `claude-opus-5-5`.
3. Redeploy.

Things to know:

- **Check the result.** AI can misread text, so the app marks AI data and asks you to check it; review
  the rows before printing.
- **Free Gemini limits.** The free tier allows only a limited number of requests per minute and per
  day; the app tells you when the limit is reached. Google may also use free-tier data to improve its
  products, so avoid sending sensitive customer data on a free key.
- **Size limits.** PDFs can be up to about 3 MB. Very long documents can hit the time limit, so split
  them if needed.
- **Your key stays private.** It is used only in the server function (`api/extract.js`) and is never sent
  to the browser.

## Host on Vercel

This is a static site plus one serverless function (`api/extract.js`), with no build step.

- **CLI:** run these inside this folder:

  ```bash
  npx vercel
  ```

  ```bash
  npx vercel --prod
  ```

- **Git:** push the folder to a repo and import it in Vercel. Set Framework to **Other** and leave the
  build command empty.

`vercel.json` gives the AI function up to 300 seconds to run. Each visitor's work is saved in their own
browser; use **Library → Export / Import backup** to move it between devices.

Opening `index.html` directly (without hosting) works for everything except AI reading.

## Layout details (step 1)

- **Presets** are shown as pictures. **Label size** is set in millimetres with −/+ buttons, and there are
  common sticker-sheet sizes to choose from.
- **Spacing & margins** and **Corners & border** are folded away until you need them.
- **Custom layout:**
  - add, move, resize, duplicate and delete labels
  - snapping and alignment guides
  - overlap and margin warnings
  - ready-made mixed arrangements to start from
- Click a label to give that position its own saved design. Double-click it to design it.
- **Saved layouts** keep the whole sheet together with every label's design.

## Design details (step 2)

- **Add:** text, data field, image, QR code, box, circle, line, and company info (from the company
  profile).
- **Templates** are shown as pictures: click one to load it; **Save as template** adds yours.
- Every label keeps its own copy of its design. To reuse a design, use **Copy to all labels**.
- **Checks** warn about:
  - text running past the edge
  - characters the PDF fonts can't print (for example ₹ and emoji)
  - blurry images
  - QR codes too small to scan

## Phones

Below 820 px wide:

- The canvas fills the screen, and the bottom bar opens the panels as slide-up sheets, plus Print and
  Download.
- **Double-tap** a label to design it.
- **Pinch** to zoom, and drag one finger on empty space to pan.
- **Print** opens the phone's share sheet.

## Accuracy

The canvas and the PDF share one millimetre coordinate system on a 210 × 297 mm page. The PDF is vector,
labels are never stretched, and templates placed on a different-size label are scaled evenly.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `css/styles.css` | Page and styles |
| `js/core.js` | Model, grid maths, data merge, undo/redo, storage |
| `js/render.js` | SVG rendering, drag and snap helpers |
| `js/pdf.js` | Exact-size PDF export (with data filling) |
| `js/sheet.js`, `js/label.js`, `js/data.js` | Steps 1, 2 and 3 |
| `js/ui.js`, `js/main.js`, `js/seeds.js` | UI kit, app wiring, starter templates |
| `api/extract.js`, `package.json`, `vercel.json` | AI reading function for Vercel |
| `vendor/` | jsPDF, qrcode-generator and SheetJS, bundled for offline use |

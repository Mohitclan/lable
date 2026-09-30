/*
 * POST /api/extract — reads a PDF, photo or pasted text with AI and returns a table of
 * label records: { columns: string[], rows: string[][], notes: string }.
 * GET  /api/extract — tells the app whether AI reading is configured.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables).
 * Set ONE of the two keys; if both are set, Gemini is used.
 *   GEMINI_API_KEY     Google Gemini key (has a free tier) — https://aistudio.google.com/apikey
 *   ANTHROPIC_API_KEY  Anthropic Claude key
 *   APP_PASSCODE       optional; if set, the app must send it (stops strangers using your key)
 *   GEMINI_MODEL       optional; defaults to gemini-flash-latest
 *   ANTHROPIC_MODEL    optional; defaults to claude-opus-5-5
 */
import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MAX_TEXT_CHARS = 400_000;

const provider = () => (process.env.GEMINI_API_KEY ? 'gemini' : process.env.ANTHROPIC_API_KEY ? 'claude' : null);

// Generic table shape so any set of fields works with one fixed schema.
const SCHEMA = {
  type: 'object',
  properties: {
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    notes: { type: 'string' },
  },
  required: ['columns', 'rows', 'notes'],
  additionalProperties: false,
};

// Gemini's schema dialect: upper-case types, no additionalProperties.
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    columns: { type: 'ARRAY', items: { type: 'STRING' } },
    rows: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } },
    notes: { type: 'STRING' },
  },
  required: ['columns', 'rows', 'notes'],
};

const SYSTEM = `You turn documents into rows of data for printing sticker labels. Each row becomes one printed label, so a row is one record: one shipment, one customer address, one product, one guest, and so on.

Copy values exactly as they appear in the document — names, numbers, codes and addresses. Do not correct, translate, invent or guess values. When a value for a column is missing from a record, use an empty string.

A value that spans several lines on a label, such as a postal address, keeps its line breaks as "\\n".

Skip content that is not a record: page headers and footers, totals, column titles, and instructions.

Every row has exactly one value per column, in the same order as "columns".

Use "notes" for one or two short sentences the user should know, such as records that looked incomplete or values you were unsure about. Leave it empty when there is nothing to flag.`;

/* Carries an HTTP status and a message that is safe to show the user. */
class ExtractError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function passcodeOk(req) {
  const need = process.env.APP_PASSCODE;
  return !need || req.headers['x-app-passcode'] === need;
}

function instruction(body) {
  const { source, fields, hint } = body;
  let ask = fields.length
    ? `Extract every record into these columns, in exactly this order and spelling: ${fields.map((f) => JSON.stringify(f)).join(', ')}. Use exactly these as "columns".`
    : 'Extract every record. Choose clear, short column names (for example "Name", "Address", "Phone", "Order ID") that suit the data.';
  if (hint) ask += `\n\nExtra instructions from the user: ${hint}`;
  if (source.kind === 'text') ask += `\n\n<document>\n${source.text}\n</document>`;
  return ask;
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Missing request body.';
  const { source, fields } = body;
  if (!Array.isArray(fields) || fields.some((f) => typeof f !== 'string') || fields.length > 60) return 'Invalid field list.';
  if (!source || !['pdf', 'image', 'text'].includes(source.kind)) return 'Unsupported source type.';
  if (source.kind === 'text') {
    if (typeof source.text !== 'string' || !source.text.trim()) return 'The pasted text is empty.';
    if (source.text.length > MAX_TEXT_CHARS) return 'That text is too long — split it into smaller parts.';
  } else if (typeof source.data !== 'string' || !source.data) {
    return 'The file is empty.';
  }
  if (source.kind === 'image' && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(source.mediaType)) {
    return 'Use a PNG, JPEG, WebP or GIF image.';
  }
  return null;
}

/* ---------------------------------------------------------------- Gemini */

async function extractWithGemini(body) {
  const { source } = body;
  const parts = [];
  if (source.kind === 'pdf') parts.push({ inline_data: { mime_type: 'application/pdf', data: source.data } });
  if (source.kind === 'image') parts.push({ inline_data: { mime_type: source.mediaType, data: source.data } });
  parts.push({ text: instruction(body) });

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, maxOutputTokens: 65536, temperature: 0 },
      }),
    });
  } catch {
    throw new ExtractError(502, 'Could not reach the Gemini service. Try again shortly.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data && data.error && data.error.message) || '';
    if (res.status === 429) throw new ExtractError(429, 'The free Gemini limit was reached. Wait a minute (or until tomorrow for the daily limit) and try again.');
    if (res.status === 400 && /API key/i.test(detail)) throw new ExtractError(500, 'The Gemini API key is invalid — check GEMINI_API_KEY in Vercel.');
    if (res.status === 401 || res.status === 403) throw new ExtractError(500, 'The Gemini API key was rejected — check GEMINI_API_KEY in Vercel.');
    if (res.status === 404) throw new ExtractError(500, `Gemini model “${GEMINI_MODEL}” was not found — set GEMINI_MODEL in Vercel to a current model.`);
    if (res.status === 400) throw new ExtractError(400, `Gemini could not read this file: ${detail}`);
    throw new ExtractError(502, `Gemini service error (${res.status}). Try again shortly.`);
  }

  if (data.promptFeedback && data.promptFeedback.blockReason) throw new ExtractError(422, 'The AI declined to read this document.');
  const cand = data.candidates && data.candidates[0];
  if (!cand) throw new ExtractError(502, 'The AI returned no data.');
  if (cand.finishReason === 'MAX_TOKENS') throw new ExtractError(413, 'Too many records to read in one go — split the file into smaller parts.');
  if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(cand.finishReason)) throw new ExtractError(422, 'The AI declined to read this document.');
  const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  if (!text) throw new ExtractError(502, 'The AI returned no data.');
  return { table: JSON.parse(text), model: data.modelVersion || GEMINI_MODEL };
}

/* ---------------------------------------------------------------- Claude */

async function extractWithClaude(body) {
  const { source } = body;
  const content = [];
  if (source.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.data } });
  if (source.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.data } });
  content.push({ type: 'text', text: instruction(body) });

  const client = new Anthropic();
  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    msg = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractError(500, 'The Anthropic API key is invalid — check ANTHROPIC_API_KEY in Vercel.');
    if (err instanceof Anthropic.RateLimitError) throw new ExtractError(429, 'The AI is busy (rate limit). Wait a minute and try again.');
    if (err instanceof Anthropic.BadRequestError) throw new ExtractError(400, `The AI could not read this file: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new ExtractError(502, `AI service error (${err.status}). Try again shortly.`);
    throw err;
  }
  if (msg.stop_reason === 'refusal') throw new ExtractError(422, 'The AI declined to read this document.');
  if (msg.stop_reason === 'max_tokens') throw new ExtractError(413, 'Too many records to read in one go — split the file into smaller parts.');
  const text = msg.content.find((b) => b.type === 'text');
  if (!text) throw new ExtractError(502, 'The AI returned no data.');
  return { table: JSON.parse(text.text), model: msg.model };
}

/* ---------------------------------------------------------------- handler */

export default async function handler(req, res) {
  const which = provider();
  if (req.method === 'GET') {
    res.status(200).json({ ai: !!which, provider: which, passcode: !!process.env.APP_PASSCODE });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!which) {
    res.status(503).json({ error: 'AI reading is not set up. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) in Vercel and redeploy.' });
    return;
  }
  if (!passcodeOk(req)) {
    res.status(401).json({ error: 'passcode', message: 'Wrong or missing passcode.' });
    return;
  }
  const problem = validate(req.body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  try {
    const { table, model } = await (which === 'gemini' ? extractWithGemini(req.body) : extractWithClaude(req.body));
    const columns = Array.isArray(table.columns) ? table.columns.map(String) : [];
    const rows = (Array.isArray(table.rows) ? table.rows : [])
      .map((r) => Array.from({ length: columns.length }, (_, i) => (Array.isArray(r) && r[i] != null ? String(r[i]) : '')));
    res.status(200).json({ columns, rows, notes: table.notes || '', model, provider: which });
  } catch (err) {
    if (err instanceof ExtractError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Could not read the AI response. Try again.' });
    }
  }
}

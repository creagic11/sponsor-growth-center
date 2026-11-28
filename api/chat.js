// Built-in AI analyst: a thin proxy to Google Gemini that keeps the site owner's API key on the server.
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in the Vercel project's Environment Variables.
// The browser sends the conversation and tool declarations; the tools themselves run in the browser,
// so this function never sees or stores the dashboard data beyond the request it forwards.
// GET  /api/chat -> { available, model }      POST /api/chat -> Gemini generateContent response

// Accept "gemini-3.8-flash" or "models/gemini-3.8-flash"; anything else (blank, spaces, a pasted key) falls back to the default.
function cleanModel(v) { const m = String(v || '').trim().replace(/^models\//, ''); return /^[a-z0-9][a-z0-9.\-]{2,80}$/i.test(m) ? m : ''; }
const DEFAULT_MODEL = 'gemini-3.8-flash';
let MODEL = cleanModel(process.env.GEMINI_MODEL) || DEFAULT_MODEL;

// Simple per-instance rate limit so one visitor cannot drain the shared free quota.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const MAX_BODY_CHARS = 1_000_000;
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  return arr.length > MAX_PER_WINDOW;
}

// Google retires model ids and individual models get overloaded at peak times. So the function keeps a short
// list of Flash models this key can use (from the API's model list), tries the configured one first with a quick
// retry, then falls back to the next model. Quotas are per model, so a fallback also helps when one hits its limit.
let modelList = null; let listedAt = 0;
async function availableModels(key) {
  if (modelList && Date.now() - listedAt < 60 * 60 * 1000) return modelList;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) return modelList || [];
    const j = await r.json();
    const ids = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, ''));
    const ver = (id) => { const m = id.match(/^gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const rank = (id) => (/-flash$/.test(id) ? 0 : /-flash-lite$/.test(id) ? 1 : /-flash-latest$/.test(id) ? 2 : /-flash/.test(id) && !/preview|exp|image|tts|audio|live/.test(id) ? 3 : 9);
    modelList = ids.filter((id) => /^gemini-/.test(id) && rank(id) < 9).sort((a, b) => ver(b) - ver(a) || rank(a) - rank(b)).slice(0, 6);
    listedAt = Date.now();
    return modelList;
  } catch (e) { return modelList || []; }
}
const modelGone = (status, text) => (status === 404 || status === 400) && /no longer available|not found|is not supported|unexpected model name/i.test(text);
const busy = (status, text) => status === 503 || status === 500 || status === 502 || status === 504 || (status === 429) || /high demand|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(status >= 400 ? text : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backup = require('./_backup.js');

// Gemini first; if it is busy, slow or failing, the free backups (Cerebras, Groq) answer instead.
// After a busy Gemini reply, questions go to the backups first for two minutes.
let geminiBusyUntil = 0;
async function answer(key, payload, budgetMs = 52000, opts = {}) {
  const t0 = Date.now(); const left = () => budgetMs - (Date.now() - t0);
  const hasBackup = backup.configured().length > 0;
  const attempts = []; let g = null;
  const tryGemini = async (ms) => { g = await generate(key, payload, ms); attempts.push(...(g.attempts || [])); if (!g.ok && g.error && g.error.code === 'busy') geminiBusyUntil = Date.now() + 120000; return g; };
  if (key && !opts.backupOnly && !(hasBackup && Date.now() < geminiBusyUntil)) {
    await tryGemini(hasBackup ? 18000 : budgetMs);
    if (g.ok || !hasBackup) return Object.assign({}, g, { attempts });
  }
  if (hasBackup) {
    const b = await backup.generateBackup(payload, left());
    attempts.push(...b.attempts);
    if (b.ok) return Object.assign({}, b, { attempts });
    if (key && !g && !opts.backupOnly && left() > 8000) { await tryGemini(left()); if (g.ok) return Object.assign({}, g, { attempts }); }
    return { ok: false, status: 503, attempts, error: { code: 'busy', message: 'The AI service is very busy right now. Please try again in a minute.', detail: [g && g.error && g.error.detail, b.last && `${b.last.status} ${b.last.message}`].filter(Boolean).join(' | ') } };
  }
  return g ? Object.assign({}, g, { attempts }) : { ok: false, status: 503, attempts, error: { code: 'not_configured', message: 'The built-in analyst is not configured on this deployment.' } };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (req.method === 'GET') {
    // /api/chat?check=1 makes one tiny real call so the owner can see whether Gemini answers from this deployment.
    const backups = backup.configured().map((b) => b.name);
    const check = (String(req.url || '').match(/[?&]check=(\w+)/) || [])[1];
    if (!check) return res.status(200).json({ available: !!key || backups.length > 0, model: key ? MODEL : '', backup: backups });
    if (!key && !backups.length) return res.status(200).json({ available: false, ok: false, error: 'Neither GEMINI_API_KEY nor a backup key is set on this deployment.' });
    const ip0 = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (limited(ip0)) return res.status(429).json({ ok: false, error: 'Too many checks; wait a few minutes.' });
    const t0 = Date.now();
    // ?check=1 tests the normal path; ?check=backup tests only the backup providers.
    const o = await answer(key, { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }] }, 45000, { backupOnly: check === 'backup' });
    return res.status(200).json({ available: true, ok: o.ok, answered_by: o.ok ? o.model : undefined, backup: backups, attempts: o.attempts, ms: Date.now() - t0, error: o.ok ? undefined : o.error });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: { message: 'Method not allowed' } }); }
  if (!key && !backup.configured().length) return res.status(503).json({ error: { message: 'The built-in analyst is not configured on this deployment.' } });

  // Only this site's own pages may use the owner's quota.
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: { message: 'Forbidden origin' } }); } catch (e) { return res.status(403).json({ error: { message: 'Forbidden origin' } }); } }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: { message: 'Too many questions in a short time. Wait a few minutes and try again, or add your own key.' } });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: { message: 'Invalid JSON' } }); } }
  if (!body || !Array.isArray(body.contents)) return res.status(400).json({ error: { message: 'Missing contents' } });
  const payload = { contents: body.contents };
  if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
  if (Array.isArray(body.tools)) payload.tools = body.tools;
  const json = JSON.stringify(payload);
  if (json.length > MAX_BODY_CHARS) return res.status(413).json({ error: { message: 'The conversation is too long. Start a new chat.' } });

  const out = await answer(key, payload);
  if (out.model && out.model !== MODEL) res.setHeader('x-model-used', out.model);
  if (out.ok) { res.status(200).setHeader('content-type', 'application/json'); return res.send(out.text); }
  return res.status(out.status).json({ error: out.error });
};

// Low thinking keeps each step fast (a question can take several tool rounds). If a model rejects the
// setting, it is dropped for the life of this instance.
let thinkingOk = true;
const withThinking = (model, payload) => (thinkingOk && /^gemini-3/.test(model) ? Object.assign({}, payload, { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }) : payload);

// Calls Gemini with a hard time budget so the function always answers with JSON before the platform limit
// (vercel.json allows 60 s). Order: configured model, one quick retry, then other Flash models.
// Each attempt is capped so a slow, overloaded model leaves time to try a lighter one.
const PER_CALL_MS = 15000;
async function generate(key, payload, budgetMs = 50000) {
  const started = Date.now(); const left = () => budgetMs - (Date.now() - started);
  const json = JSON.stringify(payload);
  // Thought signatures belong to the model that produced them; a fallback model gets Google's documented placeholder.
  // Function calls written by a backup provider carry no signature, so they get the placeholder too.
  const bodyFor = (model) => {
    const p = JSON.parse(model === MODEL ? json : json.replace(/"thoughtSignature":"[^"]*"/g, '"thoughtSignature":"skip_thought_signature_validator"'));
    for (const c of p.contents || []) if (c.role === 'model') for (const x of c.parts || []) if (x.functionCall && !x.thoughtSignature) x.thoughtSignature = 'skip_thought_signature_validator';
    return JSON.stringify(thinkingOk && /^gemini-3/.test(model) ? withThinking(model, p) : p);
  };
  const attempts = [];
  const call = async (model) => { const t = Date.now(); const o = await call1(model); attempts.push({ model, status: o.status, ms: Date.now() - t }); return o; };
  const call1 = async (model) => {
    const ms = Math.min(PER_CALL_MS, left());
    if (ms < 3000) return { status: 504, text: '{"error":{"message":"time budget used up"}}' };
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: bodyFor(model), signal: AbortSignal.timeout(ms),
      });
      let text = await r.text();
      if (r.status === 400 && thinkingOk && /thinking/i.test(text)) { thinkingOk = false; return call1(model); }
      return { status: r.status, text };
    } catch (e) {
      return { status: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 504 : 502, text: JSON.stringify({ error: { message: e && e.name === 'TimeoutError' ? 'The model took too long to answer.' : 'Could not reach the AI provider.' } }) };
    }
  };
  let model = MODEL; let r = await call(model);
  if (busy(r.status, r.text) && r.status !== 504 && left() > 20000) { await sleep(800); r = await call(model); }
  if (modelGone(r.status, r.text) || busy(r.status, r.text)) {
    const gone = modelGone(r.status, r.text);
    for (const m of (await availableModels(key)).filter((x) => x !== MODEL)) {
      if (left() < 5000) break;
      const r2 = await call(m);
      if (r2.status >= 200 && r2.status < 300) { if (gone) MODEL = m; model = m; r = r2; break; }
      if (!busy(r2.status, r2.text) && !modelGone(r2.status, r2.text)) { model = m; r = r2; break; }
    }
  }
  if (r.status >= 200 && r.status < 300) {
    try { JSON.parse(r.text); return { ok: true, text: r.text, model, attempts }; } catch (e) { return { ok: false, status: 502, error: { code: 'bad_reply', message: 'The AI service sent an unreadable reply. Please try again.' }, model, attempts }; }
  }
  let detail = ''; try { detail = (JSON.parse(r.text).error || {}).message || ''; } catch (e) { detail = String(r.text || '').slice(0, 200); }
  if (busy(r.status, r.text)) return { ok: false, status: 503, error: { code: 'busy', message: 'The AI service is very busy right now. Please try again in a minute.', detail: `${r.status} ${detail}`.trim() }, model, attempts };
  return { ok: false, status: r.status >= 400 && r.status < 600 ? r.status : 502, error: { code: 'upstream_error', message: detail || `The AI service answered with status ${r.status}.`, detail: `${r.status}` }, model, attempts };
}
module.exports.generate = generate;

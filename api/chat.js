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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (req.method === 'GET') return res.status(200).json({ available: !!key, model: MODEL });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: { message: 'Method not allowed' } }); }
  if (!key) return res.status(503).json({ error: { message: 'The built-in analyst is not configured on this deployment.' } });

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

  // Thought signatures are tied to the model that produced them; a fallback model gets Google's documented
  // placeholder value instead so a tool-calling turn can continue on another model.
  const jsonFor = (model) => (model === MODEL ? json : json.replace(/"thoughtSignature":"[^"]*"/g, '"thoughtSignature":"skip_thought_signature_validator"'));
  const call = (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: jsonFor(model),
  });
  const started = Date.now(); const BUDGET_MS = 45000;
  try {
    let r = await call(MODEL); let text = await r.text();
    if (busy(r.status, text)) { await sleep(800); r = await call(MODEL); text = await r.text(); }
    if (modelGone(r.status, text) || busy(r.status, text)) {
      const gone = modelGone(r.status, text);
      for (const m of (await availableModels(key)).filter((x) => x !== MODEL)) {
        if (Date.now() - started > BUDGET_MS) break;
        const r2 = await call(m); const t2 = await r2.text();
        if (r2.status >= 200 && r2.status < 300) { if (gone) MODEL = m; res.setHeader('x-model-used', m); r = r2; text = t2; break; }
        if (!busy(r2.status, t2) && !modelGone(r2.status, t2)) { r = r2; text = t2; break; }
      }
    }
    if (busy(r.status, text)) return res.status(503).json({ error: { code: 'busy', message: 'The AI service is very busy right now. Please try again in a minute.' } });
    res.status(r.status).setHeader('content-type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Could not reach the AI provider. Try again in a moment.' } });
  }
};

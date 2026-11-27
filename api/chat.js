// Built-in AI analyst: a thin proxy to Google Gemini that keeps the site owner's API key on the server.
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in the Vercel project's Environment Variables.
// The browser sends the conversation and tool declarations; the tools themselves run in the browser,
// so this function never sees or stores the dashboard data beyond the request it forwards.
// GET  /api/chat -> { available, model }      POST /api/chat -> Gemini generateContent response

// Accept "gemini-3.8-flash" or "models/gemini-3.8-flash"; anything else (blank, spaces, a pasted key) falls back to the default.
function cleanModel(v) { const m = String(v || '').trim().replace(/^models\//, ''); return /^[a-z0-9][a-z0-9.\-]{2,80}$/i.test(m) ? m : ''; }
const DEFAULT_MODEL = 'gemini-3.8-flash';
let MODEL = cleanModel(process.env.GEMINI_MODEL) || DEFAULT_MODEL;
let discovered = false;

// Google retires model ids over time. If the configured one is gone, ask the API which models this key can use
// and switch to the newest stable "flash" model that supports generateContent (once per server instance).
async function discoverModel(key) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) return null;
    const j = await r.json();
    const ids = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, ''));
    const ver = (id) => { const m = id.match(/^gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const pick = (re) => ids.filter((id) => re.test(id)).sort((a, b) => ver(b) - ver(a))[0];
    return pick(/^gemini-[\d.]+-flash$/) || pick(/^gemini-[\d.]+-flash(-latest)?$/) || pick(/^gemini-[\d.]+-flash/) || pick(/^gemini-/) || null;
  } catch (e) { return null; }
}
const modelGone = (status, text) => (status === 404 || status === 400) && /no longer available|not found|is not supported|unexpected model name/i.test(text);
const WINDOW_MS = 10 * 60 * 1000; // per-visitor limit, best effort (memory is per server instance)
const MAX_PER_WINDOW = 60;        // one question usually takes 2-5 calls (tool rounds)
const MAX_BODY_CHARS = 1_000_000;
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  return arr.length > MAX_PER_WINDOW;
}

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

  const call = (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: json,
  });
  try {
    let r = await call(MODEL); let text = await r.text();
    if (modelGone(r.status, text) && !discovered) {
      discovered = true;
      const next = await discoverModel(key);
      if (next && next !== MODEL) { MODEL = next; r = await call(MODEL); text = await r.text(); }
    }
    res.status(r.status).setHeader('content-type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Could not reach the AI provider. Try again in a moment.' } });
  }
};

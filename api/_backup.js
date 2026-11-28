// Free backup providers for the built-in analyst, used when Gemini is overloaded or slow.
// Both speak the OpenAI Chat Completions format and offer free API keys without a card:
//   CEREBRAS_API_KEY  (cloud.cerebras.ai)        GROQ_API_KEY  (console.groq.com)
// Optional CEREBRAS_MODEL / GROQ_MODEL pin a model; otherwise the best available one is picked from the provider's list.
// The browser keeps speaking Gemini's format; this module translates requests and replies both ways.
// (Files starting with "_" in api/ are helpers, not endpoints.)

const PROVIDERS = [
  { id: 'cerebras', name: 'Cerebras', env: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', base: 'https://api.cerebras.ai/v1',
    prefer: [/^gpt-oss-120b$/, /qwen-3-235b.*instruct/, /^llama-3\.3-70b$/, /qwen.*32b/, /llama-4/, /gpt-oss/, /llama/] },
  { id: 'groq', name: 'Groq', env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', base: 'https://api.groq.com/openai/v1',
    prefer: [/^openai\/gpt-oss-120b$/, /^llama-3\.3-70b-versatile$/, /kimi-k2/, /qwen3-32b/, /llama-4-(maverick|scout)/, /gpt-oss/, /llama/] },
];

const configured = () => PROVIDERS.map((p) => Object.assign({ key: String(process.env[p.env] || '').trim(), pinned: String(process.env[p.modelEnv] || '').trim() }, p)).filter((p) => p.key);

const chosen = {}; // provider id -> { model, at }
async function pickModel(p) {
  if (p.pinned) return p.pinned;
  const c = chosen[p.id]; if (c && Date.now() - c.at < 60 * 60 * 1000) return c.model;
  let ids = [];
  try {
    const r = await fetch(`${p.base}/models`, { headers: { authorization: 'Bearer ' + p.key }, signal: AbortSignal.timeout(5000) });
    if (r.ok) ids = ((await r.json()).data || []).map((m) => String(m.id || ''));
  } catch (e) { /* fall through to the first preference */ }
  let model = '';
  for (const re of p.prefer) { model = ids.find((id) => re.test(id)) || ''; if (model) break; }
  if (!model) model = p.id === 'groq' ? 'llama-3.3-70b-versatile' : 'llama-3.3-70b';
  chosen[p.id] = { model, at: Date.now() };
  return model;
}

// Gemini request -> OpenAI chat request
function toOpenAI(payload) {
  const messages = [];
  const sys = ((payload.systemInstruction || {}).parts || []).map((x) => x.text || '').join('\n');
  if (sys) messages.push({ role: 'system', content: sys });
  let pending = []; let n = 0;
  for (const c of payload.contents || []) {
    const parts = c.parts || [];
    if (c.role === 'model') {
      const text = parts.filter((x) => typeof x.text === 'string').map((x) => x.text).join('');
      const calls = parts.filter((x) => x.functionCall).map((x) => ({ id: 'call_' + (++n), type: 'function', function: { name: x.functionCall.name, arguments: JSON.stringify(x.functionCall.args || {}) } }));
      pending = calls.slice();
      const m = { role: 'assistant', content: text || null }; if (calls.length) m.tool_calls = calls;
      messages.push(m);
    } else {
      for (const x of parts.filter((p) => p.functionResponse)) {
        const i = pending.findIndex((t) => t.function.name === x.functionResponse.name);
        const call = i >= 0 ? pending.splice(i, 1)[0] : null;
        const r = x.functionResponse.response || {};
        messages.push({ role: 'tool', tool_call_id: call ? call.id : 'call_' + (++n), content: JSON.stringify(r.result !== undefined ? r.result : r) });
      }
      const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
      if (text) messages.push({ role: 'user', content: text });
    }
  }
  const decl = ((payload.tools || [])[0] || {}).functionDeclarations || [];
  const out = { messages };
  if (decl.length) out.tools = decl.map((d) => ({ type: 'function', function: { name: d.name, description: d.description || '', parameters: d.parameters || { type: 'object', properties: {} } } }));
  return out;
}

// OpenAI chat reply -> Gemini reply
function toGemini(j) {
  const m = (((j || {}).choices || [])[0] || {}).message || {};
  const parts = [];
  if (m.content) parts.push({ text: String(m.content) });
  for (const t of m.tool_calls || []) {
    let args = {}; try { args = JSON.parse(t.function.arguments || '{}'); } catch (e) { args = {}; }
    parts.push({ functionCall: { name: t.function.name, args } });
  }
  if (!parts.length) parts.push({ text: '' });
  return { candidates: [{ content: { role: 'model', parts } }] };
}

// Tries each configured backup within the time left. Returns the same shape as generate() in chat.js.
async function generateBackup(payload, budgetMs) {
  const started = Date.now(); const left = () => budgetMs - (Date.now() - started);
  const attempts = []; let last = null;
  for (const p of configured()) {
    if (left() < 4000) break;
    const model = await pickModel(p);
    const t = Date.now();
    try {
      const r = await fetch(`${p.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key },
        body: JSON.stringify(Object.assign({ model, temperature: 0.2, max_tokens: 2048 }, toOpenAI(payload))), signal: AbortSignal.timeout(Math.min(25000, left())) });
      const text = await r.text();
      attempts.push({ model: `${p.id}/${model}`, status: r.status, ms: Date.now() - t });
      if (r.status >= 200 && r.status < 300) {
        let j; try { j = JSON.parse(text); } catch (e) { last = { status: 502, message: 'unreadable reply' }; continue; }
        return { ok: true, text: JSON.stringify(toGemini(j)), model: `${p.name} ${model}`, attempts };
      }
      if (r.status === 404 || (r.status === 400 && /model/i.test(text))) delete chosen[p.id]; // re-pick next time
      let msg = ''; try { const e = JSON.parse(text).error; msg = (e && (e.message || e)) || ''; } catch (e) { msg = text.slice(0, 200); }
      last = { status: r.status, message: String(msg) };
    } catch (e) {
      attempts.push({ model: `${p.id}/${model}`, status: 504, ms: Date.now() - t });
      last = { status: 504, message: 'took too long' };
    }
  }
  return { ok: false, attempts, last };
}

module.exports = { configured, generateBackup, toOpenAI, toGemini, PROVIDERS };

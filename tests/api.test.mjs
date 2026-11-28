// Unit test for api/chat.js (the built-in analyst proxy) with a fake request/response and a fake Gemini.
// Usage: node tests/api.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0; const ok = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(d)); };
const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k.toLowerCase()] = v; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };
const req = (o) => Object.assign({ method: 'POST', headers: { host: 'site.test', origin: 'https://site.test', 'x-forwarded-for': '1.1.1.1' }, body: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } }, o);
let sent = null;
globalThis.fetch = async (url, init) => { sent = { url, init }; return { status: 200, text: async () => JSON.stringify({ candidates: [] }) }; };

delete process.env.GEMINI_API_KEY;
let h = require('../api/chat.js');
let r = res(); await h(req({ method: 'GET' }), r); ok('GET without key → available false', r.code === 200 && r.body.available === false, r.body);
r = res(); await h(req({}), r); ok('POST without key → 503', r.code === 503, r.code);

process.env.GEMINI_API_KEY = 'server-secret'; process.env.GEMINI_MODEL = 'gemini-2.5-flash';
delete require.cache[require.resolve('../api/chat.js')]; h = require('../api/chat.js');
r = res(); await h(req({ method: 'GET' }), r); ok('GET with key → available, key not exposed', r.body.available === true && !JSON.stringify(r.body).includes('server-secret'), r.body);
r = res(); await h(req({ body: { contents: [], tools: [], systemInstruction: { parts: [{ text: 's' }] }, model: 'evil-model', extra: 1 } }), r);
ok('POST forwards to Gemini with the server key and fixed model', r.code === 200 && sent.url.includes('/models/gemini-2.5-flash:generateContent') && sent.init.headers['x-goog-api-key'] === 'server-secret', sent && sent.url);
ok('only contents, tools and systemInstruction are forwarded', JSON.stringify(Object.keys(JSON.parse(sent.init.body)).sort()) === JSON.stringify(['contents', 'systemInstruction', 'tools']), sent.init.body);
r = res(); await h(req({ headers: { host: 'site.test', origin: 'https://evil.test' } }), r); ok('other origins are refused', r.code === 403, r.code);
r = res(); await h(req({ body: { nope: 1 } }), r); ok('bad body → 400', r.code === 400, r.code);
r = res(); await h(req({ method: 'DELETE' }), r); ok('other methods → 405', r.code === 405, r.code);
let last; for (let i = 0; i < 70; i++) { last = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '9.9.9.9' } }), last); }
ok('per-visitor rate limit kicks in', last.code === 429, last.code);
// retired model -> discover the newest flash model and retry once
process.env.GEMINI_MODEL = 'gemini-old-flash';
delete require.cache[require.resolve('../api/chat.js')]; h = require('../api/chat.js');
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push(url);
  if (url.includes('/models?')) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.1-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };
  if (url.includes('gemini-old-flash')) return { status: 404, text: async () => JSON.stringify({ error: { message: 'This model models/gemini-old-flash is no longer available to new users.' } }) };
  return { status: 200, text: async () => JSON.stringify({ candidates: [] }) };
};
r = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '7.7.7.7' } }), r);
ok('retired model: switches to the newest flash model and succeeds', r.code === 200 && calls[2] && calls[2].includes('/models/gemini-3.8-flash:generateContent'), calls);
r = res(); await h(req({ method: 'GET' }), r); ok('GET then reports the new model', r.body.model === 'gemini-3.8-flash', r.body);
// overloaded model -> quick retry, then fall back to another model
delete process.env.GEMINI_MODEL;
delete require.cache[require.resolve('../api/chat.js')]; h = require('../api/chat.js');
const c2 = [];
globalThis.fetch = async (url, init) => {
  c2.push({ url, body: init && init.body });
  if (url.includes('/models?')) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) };
  if (url.includes('gemini-3.8-flash:')) return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
};
r = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '6.6.6.6' }, body: { contents: [{ role: 'model', parts: [{ functionCall: { name: 'x' }, thoughtSignature: 'abc' }] }] } }), r);
const fb = c2.find((x) => x.url.includes('flash-lite:'));
ok('busy model: retries, then falls back to another model', r.code === 200 && c2.filter((x) => x.url.includes('gemini-3.8-flash:')).length === 2 && !!fb, c2.map((x) => x.url));
ok('fallback model gets the placeholder thought signature', fb && fb.body.includes('skip_thought_signature_validator') && !fb.body.includes('"abc"'), fb && fb.body);
globalThis.fetch = async (url) => url.includes('/models?') ? { ok: true, status: 200, json: async () => ({ models: [] }) } : { ok: false, status: 503, text: async () => '{"error":{"message":"high demand"}}' };
r = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '5.5.5.5' } }), r);
ok('all models busy → friendly 503', r.code === 503 && /very busy/.test(r.body.error.message), r.body);
// time budget: a hanging model becomes a JSON "busy" answer instead of a platform timeout
const { generate } = h;
globalThis.fetch = async (url, init) => url.includes('/models?') ? { ok: true, status: 200, json: async () => ({ models: [] }) }
  : new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => { const e = new Error('t'); e.name = 'TimeoutError'; reject(e); }); });
const keep = setInterval(() => {}, 1000); // AbortSignal.timeout timers do not keep Node alive on their own
let t0 = Date.now(); let g = await generate('k', { contents: [] }, 4000); clearInterval(keep);
ok('hanging model → busy JSON within the budget', !g.ok && g.status === 503 && g.error.code === 'busy' && Date.now() - t0 < 6000, { g, ms: Date.now() - t0 });
globalThis.fetch = async () => ({ status: 200, text: async () => '<html>oops' });
g = await generate('k', { contents: [] }); ok('unreadable reply → JSON error', !g.ok && g.error.code === 'bad_reply', g);
let lastBody = null; globalThis.fetch = async (url, init) => { lastBody = init && init.body; return { status: 200, text: async () => '{"candidates":[]}' }; };
g = await generate('k', { contents: [] }); ok('gemini-3 calls ask for low thinking', g.ok && /"thinkingLevel":"low"/.test(lastBody), lastBody);
globalThis.fetch = async (url, init) => { lastBody = init.body; return /thinkingLevel/.test(init.body) ? { status: 400, text: async () => '{"error":{"message":"Unknown name thinkingLevel"}}' } : { status: 200, text: async () => '{"candidates":[]}' }; };
g = await generate('k', { contents: [] }); ok('model that rejects the thinking setting still answers', g.ok && !/thinkingLevel/.test(lastBody), lastBody);
r = res(); await h(req({ method: 'GET', url: '/api/chat?check=1', headers: { host: 'site.test', 'x-forwarded-for': '4.4.4.4' } }), r);
ok('GET ?check=1 reports a live check', r.code === 200 && r.body.ok === true && typeof r.body.ms === 'number', r.body);
// free backup providers: Gemini busy -> Cerebras answers, translated both ways
process.env.GEMINI_MODEL = ''; process.env.CEREBRAS_API_KEY = 'cb-key';
delete require.cache[require.resolve('../api/chat.js')]; delete require.cache[require.resolve('../api/_backup.js')]; h = require('../api/chat.js');
const c3 = [];
globalThis.fetch = async (url, init) => {
  c3.push({ url, body: init && init.body, auth: init && init.headers && init.headers.authorization });
  if (url.includes('generativelanguage') && url.includes('/models?')) return { ok: true, status: 200, json: async () => ({ models: [] }) };
  if (url.includes('generativelanguage')) return { status: 503, text: async () => '{"error":{"message":"This model is currently experiencing high demand."}}' };
  if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'llama3.1-8b' }, { id: 'gpt-oss-120b' }] }) };
  return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'get_overview', arguments: '{"as_of":"2027-01-10"}' } }] } }] }) };
};
r = res(); await h(req({ method: 'GET', headers: { host: 'site.test' } }), r); ok('GET lists the backup', JSON.stringify(r.body.backup) === '["Cerebras"]', r.body);
const convo = { systemInstruction: { parts: [{ text: 'rules' }] }, tools: [{ functionDeclarations: [{ name: 'get_overview', description: 'kpis' }] }],
  contents: [{ role: 'user', parts: [{ text: 'how are we doing?' }] }, { role: 'model', parts: [{ functionCall: { name: 'get_plan_status', args: { section: 'bets' } }, thoughtSignature: 'sig' }] }, { role: 'user', parts: [{ functionResponse: { name: 'get_plan_status', response: { result: { bets: [1] } } } }] }] };
r = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '3.3.3.3' }, body: convo }), r);
const cb = c3.find((x) => x.url.includes('cerebras.ai/v1/chat'));
const ob = cb && JSON.parse(cb.body);
ok('busy Gemini → Cerebras answers in Gemini format', r.code === 200 && JSON.parse(r.body).candidates[0].content.parts[0].functionCall.args.as_of === '2027-01-10', r.body);
ok('request translated: system, tool call ids paired, tools, preferred model', ob && ob.model === 'gpt-oss-120b' && ob.messages[0].role === 'system' && ob.messages[2].tool_calls[0].id === ob.messages[3].tool_call_id && ob.messages[3].content === '{"bets":[1]}' && ob.tools[0].function.parameters.type === 'object' && cb.auth === 'Bearer cb-key', ob);
c3.length = 0; r = res(); await h(req({ headers: { host: 'site.test', 'x-forwarded-for': '3.3.3.4' }, body: convo }), r);
ok('after a busy Gemini reply, the next question goes straight to the backup', r.code === 200 && !c3.some((x) => x.url.includes('generativelanguage')), c3.map((x) => x.url));
r = res(); await h(req({ method: 'GET', url: '/api/chat?check=backup', headers: { host: 'site.test', 'x-forwarded-for': '3.3.3.5' } }), r);
ok('?check=backup reports the backup answer', r.body.ok === true && /Cerebras/.test(r.body.answered_by), r.body);
let gb = null; globalThis.fetch = async (url, init) => { gb = init.body; return { status: 200, text: async () => '{"candidates":[]}' }; };
await h.generate('k', { contents: [{ role: 'model', parts: [{ functionCall: { name: 'a', args: {} } }] }] });
ok('Gemini gets the signature placeholder on calls a backup wrote', /"thoughtSignature":"skip_thought_signature_validator"/.test(gb), gb);
delete process.env.CEREBRAS_API_KEY;
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

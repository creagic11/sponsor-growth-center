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
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

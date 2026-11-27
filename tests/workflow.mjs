// End-to-end workflow test in a real browser (Playwright + Chromium). No server and no real AI key needed:
// the site is served from disk by request interception, and both the built-in analyst (api/chat, Gemini format)
// and the OpenAI API are replaced by scripted stand-ins that call the app's real tools in each provider's format.
// It proves the plumbing, not a model's judgement: the analyst is hidden until a key is added, tools run against
// live app data, edits persist in the browser and recompute analytics, drafts are saved only after Confirm,
// follow-ups see the confirmation, undo and reset work, and the key is sent nowhere but the chosen provider.
// Usage: node tests/workflow.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'shots');
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };

// ---- scripted stand-in for the OpenAI Chat Completions API ----
let callN = 0; const keySeenBy = new Set(); const hostedCalls = { n: 0 }; const openaiCalls = { n: 0 };
// Provider-neutral script: given the question and the tool results so far, either call a tool or answer.
function decide(q, toolResults, all) {
  const call = (name, args) => ({ call: { name, args } });
  const say = (text) => ({ say: text });
  if (q.includes('cash have we')) return toolResults.length ? say('The data cannot answer this: ' + toolResults[0].what_the_data_cannot_answer[0]) : call('get_data_coverage', {});
  if (q.includes('create a task')) return toolResults.length ? say('Drafted a task. Please confirm the card.') : call('propose_task', { title: 'Close out idle cold-route deals', owner: 'Kabir Shah', due_date: '2025-04-23', priority: 'high', linked_type: 'campaign', linked_id: 'SC01', linked_label: 'Brand Discovery Email', notes: '0 of 11 email deals confirmed' });
  if (q.includes('did it save')) return toolResults.length ? say(`Tasks now: ${toolResults[0].counts.total}. ${all.includes('[Confirmed:') ? 'Confirmation seen.' : 'No confirmation in history.'}`) : call('list_tasks', {});
  if (q.includes('confirmed')) {
    if (toolResults.length === 0) return call('get_overview', {});
    if (toolResults.length === 1) { const o = toolResults[0]; return call('calculate', { expression: `${o.confirmed.count}/${o.targets.confirmed_partnerships_goal}*100` }); }
    const o = toolResults[0]; return say(`**${o.confirmed.count}** confirmed of ${o.targets.confirmed_partnerships_goal} (${toolResults[1].result}%).`);
  }
  return say('ok');
}
// OpenAI Chat Completions format (bring-your-own-key path)
function openaiReply(body) {
  const msgs = body.messages;
  let ui = msgs.length - 1; while (ui >= 0 && !(msgs[ui].role === 'user' && !String(msgs[ui].content).startsWith('['))) ui--;
  const d = decide(String(msgs[ui].content).toLowerCase(), msgs.slice(ui + 1).filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content)), msgs.map((m) => String(m.content || '')).join('\n'));
  const message = d.call ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + (++callN), type: 'function', function: { name: d.call.name, arguments: JSON.stringify(d.call.args) } }] } : { role: 'assistant', content: d.say };
  return { choices: [{ index: 0, message, finish_reason: d.call ? 'tool_calls' : 'stop' }] };
}
// Gemini generateContent format (built-in analyst via api/chat)
function geminiReply(body) {
  const cs = body.contents; const isText = (c) => c.role === 'user' && c.parts.some((x) => typeof x.text === 'string' && !x.text.startsWith('['));
  let ui = cs.length - 1; while (ui >= 0 && !isText(cs[ui])) ui--;
  const q = cs[ui].parts.map((x) => x.text || '').join(' ').toLowerCase();
  const results = cs.slice(ui + 1).flatMap((c) => c.parts.filter((x) => x.functionResponse).map((x) => x.functionResponse.response.result));
  const all = cs.map((c) => c.parts.map((x) => x.text || '').join(' ')).join('\n');
  const d = decide(q, results, all);
  return { candidates: [{ content: { role: 'model', parts: [d.call ? { functionCall: { name: d.call.name, args: d.call.args } } : { text: d.say }] } }] };
}

const b = await chromium.launch();
async function newCtx(hostedAvailable) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('http://gc.test/**', (route) => { const u = new URL(route.request().url()); route.fulfill({ path: path.join(ROOT, decodeURIComponent(u.pathname)) }); });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  // stand-in for the deployed api/chat.js (a static host without it returns 404, which the app treats as "no built-in analyst")
  await ctx.route('http://gc.test/api/chat', (route) => {
    const req = route.request();
    if (!hostedAvailable) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, model: 'gemini-2.5-flash' }) });
    hostedCalls.n++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(geminiReply(JSON.parse(req.postData()))) });
  });
  await ctx.route('https://api.openai.com/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
    openaiCalls.n++;
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(openaiReply(JSON.parse(req.postData()))) });
  });
  ctx.on('request', (r) => { if (JSON.stringify(r.headers()).includes('test-key-123')) keySeenBy.add(new URL(r.url()).host); });
  return ctx;
}

// A) a host without the built-in analyst: everything works, the analyst stays hidden until a key is added
{
  const ctx = await newCtx(false); const q = await ctx.newPage(); const qe = [];
  q.on('pageerror', (e) => qe.push(e.message));
  await q.goto('http://gc.test/index.html#overview'); await q.waitForSelector('.kpis'); await q.waitForTimeout(800);
  check('without a built-in key: analyst hidden, "Add AI analyst" offered', !(await q.locator('#chat').isVisible()) && (await q.locator('[data-action="ai-setup"]').first().isVisible()));
  const html = await q.content();
  check('no Claude or claude.ai branding in the page', !/claude\.ai|window\.claude|artifact/i.test(html), (html.match(/claude\.ai|artifact/i) || [])[0]);
  await q.screenshot({ path: `${out}/web-no-ai.png` });
  check('no page errors without the built-in analyst', qe.length === 0, qe);
  await ctx.close();
}

// B) the Vercel deployment with the built-in analyst
const ctx = await newCtx(true);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://gc.test/index.html#overview');
await p.waitForSelector('.kpis', { timeout: 15000 }).catch(async () => { console.log('ERRS', errs); process.exit(1); });
const kpiText = async () => p.locator('.kpis .kpi').first().innerText();
const before = await kpiText();
check('baseline confirmed 24/28 from the original dataset', before.includes('24') && before.includes('28'), before);
await p.waitForSelector('#chat-text', { timeout: 8000 }).catch(() => {});
check('built-in analyst ready with no key', await p.locator('#chat').isVisible() && /Built-in/.test(await p.locator('#ai-status').innerText()));

// 1) analyst grounded answer with calculation
await p.fill('#chat-text', 'How many partnerships are confirmed?');
await p.press('#chat-text', 'Enter');
await p.waitForSelector('.msg.ai .body b');
const a1 = await p.locator('.msg.ai').last().innerText();
check('analyst answers from data with calc', a1.includes('24') && a1.includes('85.714'), a1);

// 2) edit data in the management tool, analytics recompute, analyst sees the change
await p.evaluate(() => { location.hash = 'deals'; });
await p.waitForSelector('select[data-change="deal-stage"]');
const firstOpen = await p.locator('select[data-change="deal-stage"]').first().getAttribute('data-id');
await p.locator(`select[data-change="deal-stage"][data-id="${firstOpen}"]`).selectOption('partner_confirmed');
await p.waitForTimeout(400);
await p.evaluate(() => { location.hash = 'overview'; });
await p.waitForTimeout(300);
const after = await kpiText();
check('deal edit recomputes KPI to 25', after.includes('25'), after);
await p.fill('#chat-text', 'How many confirmed now?');
await p.press('#chat-text', 'Enter');
await p.waitForFunction(() => document.querySelectorAll('.msg.ai .body b').length >= 2);
const a2 = await p.locator('.msg.ai').last().innerText();
check('analyst sees changed data (25)', a2.includes('25'), a2);

// 3) data cannot answer
await p.fill('#chat-text', 'How much cash have we actually received?');
await p.press('#chat-text', 'Enter');
await p.waitForFunction(() => [...document.querySelectorAll('.msg.ai')].some((m) => m.innerText.includes('cannot answer')));
check('says data cannot answer cash received', true);

// 4) insight to action with confirmation
await p.fill('#chat-text', 'Create a task to close out the idle cold-route deals.');
await p.press('#chat-text', 'Enter');
await p.waitForSelector('.action-card [data-ai="confirm"]');
const tasksBefore = await p.evaluate(() => window.GCApp.ws.tasks.length);
check('draft not saved before confirm', tasksBefore === 0, tasksBefore);
await p.screenshot({ path: `${out}/wf-draft.png` });
await p.click('.action-card [data-ai="confirm"]');
await p.waitForSelector('.action-card.done');
const tasksAfter = await p.evaluate(() => window.GCApp.ws.tasks.map((t) => [t.task_id, t.owner, t.source]));
check('task saved after confirm with source ai', tasksAfter.length === 1 && tasksAfter[0][2] === 'ai', tasksAfter);
await p.fill('#chat-text', 'Did it save?');
await p.press('#chat-text', 'Enter');
await p.waitForFunction(() => [...document.querySelectorAll('.msg.ai')].some((m) => m.innerText.includes('Tasks now')));
const a4 = await p.locator('.msg.ai').last().innerText();
check('follow-up sees confirmation and the new task', a4.includes('Tasks now: 1') && a4.includes('Confirmation seen'), a4);
await p.screenshot({ path: `${out}/wf-chat.png` });
check('questions went through the built-in analyst', hostedCalls.n >= 8 && openaiCalls.n === 0, hostedCalls);

// 4a) bring your own key (OpenAI, stubbed) overrides the built-in analyst
await p.click('#chat [data-action="ai-setup"]');
await p.selectOption('form[data-submit="ai-cfg"] select[name="provider"]', 'openai');
await p.fill('form[data-submit="ai-cfg"] input[name="key"]', 'test-key-123');
await p.click('form[data-submit="ai-cfg"] button.primary');
await p.waitForTimeout(300);
await p.fill('#chat-text', 'How many confirmed with my key?');
await p.press('#chat-text', 'Enter');
await p.waitForFunction(() => document.querySelectorAll('.msg.ai .body b').length >= 3);
check('own key (OpenAI) answers instead of the built-in one', openaiCalls.n >= 3 && /your key/.test(await p.locator('#ai-status').innerText()), openaiCalls);

// 4b) UX: briefing leads the overview, undo reverses the last edit, guide can be dismissed
await p.evaluate(() => { location.hash = 'overview'; }); await p.waitForTimeout(300);
const brief = await p.locator('.brief .brief-h').innerText();
check('briefing headline answers "are we on track"', /partnerships/.test(brief), brief);
check('do-next lists at most 3 actions', (await p.locator('.brief-next li').count()) <= 3);
const editsBeforeUndo = await p.evaluate(() => window.GCApp.ws.edit_count);
await p.evaluate(() => { location.hash = 'tasks'; }); await p.waitForSelector('select[data-change="task-status"]');
await p.locator('select[data-change="task-status"]').first().selectOption('done');
await p.waitForSelector('.toast-undo');
const mid = await p.evaluate(() => window.GCApp.ws.edit_count);
await p.click('.toast-undo'); await p.waitForTimeout(400);
const afterUndo = await p.evaluate(() => window.GCApp.ws.edit_count);
check('undo removes the last edit', mid === editsBeforeUndo + 1 && afterUndo === editsBeforeUndo, [editsBeforeUndo, mid, afterUndo]);
await p.evaluate(() => { location.hash = 'overview'; }); await p.waitForTimeout(200);
await p.click('[data-action="guide-close"]'); await p.waitForTimeout(200);
check('guide dismisses', (await p.locator('.guide').count()) === 0);

// 5) persistence across reload
await p.reload();
await p.waitForSelector('.kpis', { timeout: 15000 }).catch(async () => { console.log('ERRS', errs, (await p.locator('main').innerText()).slice(0, 400)); process.exit(1); });
await p.waitForFunction(() => window.GCApp && window.GCApp.ws && window.GCApp.ws.tasks.length === 1, null, { timeout: 12000 }).catch(() => {});
const persisted = await p.evaluate(() => ({ tasks: window.GCApp.ws.tasks.length, edits: window.GCApp.ws.edit_count }));
check('edits persist after reload', persisted.tasks === 1 && persisted.edits === 2, persisted);
await p.waitForTimeout(500);
check('own key remembered after reload', /your key/.test(await p.locator('#ai-status').innerText()));

// 6) as-of time travel: before 1 March the edit made on 20 Apr does not apply
await p.fill('#asof', '2025-03-01');
await p.dispatchEvent('#asof', 'change');
await p.waitForTimeout(300);
const march = await kpiText();
check('as-of 1 Mar shows 10 confirmed vs goal 20', march.includes('10') && march.includes('20'), march);

// 7) Delhi plan: change a gate signal and see the gate flip
await p.selectOption('#ws-select', 'dl27');
await p.evaluate(() => { location.hash = 'plan'; });
await p.waitForSelector('.bets');
const b4before = await p.evaluate(() => window.GCEngine.planStatus(window.GCApp.snap).bets.find((b) => b.bet_id === 'B4').gate.state);
await p.locator('details').nth(4).evaluate((d) => { d.open = true; });
await p.locator('input[data-bet="B4"][data-k="societies_committed"]').fill('3');
await p.locator('input[data-bet="B4"][data-k="societies_committed"]').dispatchEvent('change');
await p.waitForTimeout(400);
const b4after = await p.evaluate(() => window.GCEngine.planStatus(window.GCApp.snap).bets.find((b) => b.bet_id === 'B4').gate.state);
check('B4 gate change → on_track after 3 societies', b4before === 'change' && b4after === 'on_track', [b4before, b4after]);

// 8) reset
await p.evaluate(() => { location.hash = 'data'; });
await p.click('[data-action="reset-ask"]'); await p.click('[data-action="reset-do"]');
await p.waitForTimeout(400);
const reset = await p.evaluate(() => window.GCApp.ws.edit_count);
check('reset clears workspace edits', reset === 0, reset);

// 9) phone layout has no horizontal scroll
await p.setViewportSize({ width: 390, height: 844 });
for (const v of ['overview', 'campaigns', 'plan', 'tasks']) {
  await p.evaluate((v) => { location.hash = v; }, v); await p.waitForTimeout(250);
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal page scroll on phone: ' + v, ov <= 1, ov);
}
await p.evaluate(() => { location.hash = 'overview'; }); await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/wf-phone.png`, fullPage: false });
check('key sent only to the chosen provider', [...keySeenBy].every((h) => h === 'api.openai.com') && keySeenBy.size === 1, [...keySeenBy]);
check('no console errors', errs.length === 0, errs);
await b.close();
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.ok ? '' : JSON.stringify(r.detail));
console.log(results.filter((r) => r.ok).length + '/' + results.length + ' passed');
process.exit(results.every((r) => r.ok) ? 0 : 1);

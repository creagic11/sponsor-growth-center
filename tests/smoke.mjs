// Browser smoke test: loads every view in both workspaces, saves screenshots, reports console errors.
// Usage: node tests/smoke.mjs <screenshot-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'shots'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
// Serve the app folder from disk through request interception (no local server needed)
await p.route('http://gc.test/**', (route) => { const u = new URL(route.request().url()); route.fulfill({ path: path.join(ROOT, decodeURIComponent(u.pathname)) }); });
await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await p.goto('http://gc.test/index.html#overview');
await p.waitForSelector('.kpis');
for (const ws of ['cf25', 'dl27']) {
  await p.selectOption('#ws-select', ws);
  for (const v of ['overview', 'campaigns', 'deals', 'plan', 'tasks', 'data']) {
    await p.evaluate((v) => { location.hash = v; }, v);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${ws}-${v}.png`, fullPage: true });
  }
}
console.log('errors:', JSON.stringify(errs, null, 1));
await b.close();

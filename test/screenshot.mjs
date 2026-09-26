// Loads the app in headless Chromium, captures console errors and screenshots.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(new URL('..', import.meta.url).pathname);
const file = process.argv[2] || 'index.html';
const shots = +(process.argv[3] || 3);
const waitMs = +(process.argv[4] || 4000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;
fs.mkdirSync(path.join(root, 'test/out'), { recursive: true });
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1600), height: +(process.env.VH || 950) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${port}/${file}`);
await page.waitForTimeout(waitMs);
for (let k = 0; k < shots; k++) {
  if (process.env.ACTIONS) await page.evaluate(process.env.ACTIONS.split('|')[k] || '0');
  await page.waitForTimeout(+(process.env.GAP || 2500));
  await page.screenshot({ path: path.join(root, `test/out/shot-${k}.png`) });
  const info = await page.evaluate(() => window.__sim ? { year: __sim.year, tick: __sim.tick, speed: window.__ui && __ui.ctl ? __ui.ctl.speed : null, pace: window.__ui ? __ui.pace : null, pop: __sim.people.count, fps: window.__fps, towns: __sim.towns.length } : null);
  console.log('shot', k, JSON.stringify(info));
}
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
server.close();

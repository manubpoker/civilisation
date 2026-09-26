// Drives real mouse input (wheel, drag, minimap click) and reports camera changes.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = path.resolve(new URL('..', import.meta.url).pathname);
const file = process.argv[2] || 'dist/pixel-continent.html';
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); res.end(data); });
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1600), height: +(process.env.VH || 950) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/${file}`);
await page.waitForTimeout(5000);
const cam = () => page.evaluate(() => ({ ...__renderer.cam }));
const top = (x, y) => page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + '#' + el.id + '.' + el.className : null; }, [x, y]);
console.log('element at map centre:', await top(700, 500));
console.log('start', JSON.stringify(await cam()));
await page.mouse.move(700, 500);
await page.mouse.wheel(0, -300); await page.waitForTimeout(300);
console.log('after wheel in', JSON.stringify(await cam()));
await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(600, 420, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
console.log('after drag', JSON.stringify(await cam()));
const mm = await page.evaluate(() => { const r = document.getElementById('minimap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
console.log('minimap rect', JSON.stringify(mm), 'element there:', await top(mm.x + mm.w * 0.8, mm.y + mm.h * 0.5));
await page.mouse.click(mm.x + mm.w * 0.8, mm.y + mm.h * 0.5); await page.waitForTimeout(300);
console.log('after minimap click', JSON.stringify(await cam()));
await page.mouse.move(mm.x + mm.w * 0.2, mm.y + mm.h * 0.3); await page.mouse.down(); await page.mouse.move(mm.x + mm.w * 0.4, mm.y + mm.h * 0.6, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
console.log('after minimap drag', JSON.stringify(await cam()));
await page.mouse.move(700, 500); await page.mouse.wheel(0, 400); await page.waitForTimeout(300);
console.log('after wheel out', JSON.stringify(await cam()));
const flags = () => page.evaluate(() => ({ night: __renderer.night, labels: __renderer.showLabels, color: __renderer.colorMode, overlay: __renderer.overlay }));
console.log('flags before', JSON.stringify(await flags()));
await page.click('#btnNight'); await page.click('#btnLabels');
await page.selectOption('#colorMode', 'happiness'); await page.selectOption('#overlay', 'territory');
await page.keyboard.press('n');
console.log('flags after (night clicked then N pressed, labels clicked, happiness, territory)', JSON.stringify(await flags()));
await page.keyboard.press('Space'); // pause so the target stays put
const target = await page.evaluate(() => {
  const t = __sim.towns[__sim.civs[0].capital], b = __sim.buildings[t.center];
  __renderer.cam.x = b.cx; __renderer.cam.y = b.cy;
  const [sx, sy] = __renderer.worldToScreen(b.cx, b.cy); const rect = document.getElementById('view').getBoundingClientRect();
  return { x: sx + rect.left, y: sy + rect.top, name: b.def.name };
});
await page.waitForTimeout(200);
await page.mouse.click(target.x, target.y); await page.waitForTimeout(300);
console.log('click on', target.name, '-> inspector visible =', await page.evaluate(() => !document.getElementById('inspector').hidden), await page.evaluate(() => document.querySelector('#inspector h2, #inspector h3')?.textContent));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close(); server.close();

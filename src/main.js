// Entry point: generates the world, then runs a time-budgeted simulation
// loop alongside the renderer and spectator UI.
import { Sim } from './sim/sim.js';
import { Renderer } from './render/renderer.js';
import { UI, SPEEDS } from './ui/ui.js';
import { RESOURCES } from './data/resources.js';

const app = document.getElementById('app');
app.innerHTML = `<div id="boot" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0f151b;color:#e8e0cb;font-family:'Alegreya Sans',system-ui,sans-serif">
  <div style="font:400 34px/1 'IM Fell English SC',Georgia,serif;color:#f0c874">Pixel Continent</div>
  <div id="bootmsg" style="color:#8c9a96">Raising mountains, carving rivers…</div></div>`;

function readSeed() {
  const h = (location.hash || '').replace('#', '');
  if (/^\d{1,9}$/.test(h)) return +h;
  return 7;
}

function start() {
  const seed = readSeed();
  const sim = new Sim(seed);
  sim.resColor = (r) => RESOURCES[r].color;
  const controller = {
    speed: 2,
    prevSpeed: 2,
    setSpeed(k) { if (k !== 0) this.prevSpeed = k; this.speed = Math.max(0, Math.min(SPEEDS.length - 1, k)); },
    togglePause() { this.setSpeed(this.speed === 0 ? this.prevSpeed || 2 : 0); },
  };
  const ui = new UI(app, sim, null, controller);
  const renderer = new Renderer(ui.canvas, sim);
  ui.r = renderer;
  renderer.resize();
  renderer.fitZoom();
  // open close enough to watch the first tribe's people at work
  const cap = sim.towns[sim.civs[0].capital];
  if (cap) { renderer.cam.x = cap.cx; renderer.cam.y = cap.cy; renderer.cam.zi = 6; }
  ui.layout();
  window.addEventListener('resize', () => ui.layout());
  window.__sim = sim; window.__renderer = renderer; window.__ui = ui;

  let last = performance.now();
  let debt = 0;
  let fpsT = 0, frames = 0;
  function frame(now) {
    const dtReal = Math.min(0.25, (now - last) / 1000);
    last = now;
    ui.keyPan(dtReal);
    const sp = SPEEDS[controller.speed];
    if (sp.tps > 0) {
      debt += sp.tps * dtReal;
      if (sp.tps >= 1e9) debt = 1e9;
      // big steps at high speed keep the cost per simulated tick low
      const dt = sp.tps >= 900 ? 4 : sp.tps >= 300 ? 2 : 1;
      const budget = 13 + (sp.tps >= 900 ? 5 : 0);
      const t0 = performance.now();
      while (debt >= dt && performance.now() - t0 < budget) { sim.step(dt); debt -= dt; }
      if (debt > sp.tps * 0.5) debt = Math.min(debt, sp.tps * 0.5);
      if (sp.tps >= 1e9) debt = 0;
    } else debt = 0;
    renderer.render();
    ui.update(now);
    if ((frames & 63) === 0) ui.layout();
    frames++;
    if (now - fpsT > 1000) { window.__fps = frames; frames = 0; fpsT = now; }
    requestAnimationFrame(frame);
  }
  const boot = document.getElementById('boot'); if (boot) boot.remove();
  requestAnimationFrame(frame);
}

// let the loading screen paint before the heavy world generation
requestAnimationFrame(() => setTimeout(() => {
  try { start(); } catch (err) {
    console.error(err);
    const m = document.getElementById('bootmsg');
    if (m) m.textContent = 'The world failed to form: ' + err.message;
  }
}, 30));

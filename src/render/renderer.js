// Pixel-perfect renderer: one world pixel = one person-sized cell. The base
// layer (terrain, roads, buildings) is cached and patched incrementally; the
// dynamic layer (people, animals, vehicles, effects) is composited per frame.
import { CFG } from '../config.js';
import { terrainColor, rgba } from './palette.js';
import { buildingSprite } from './sprites.js';
import { PROFESSIONS } from '../data/professions.js';
import { NB, SCALES } from '../data/beliefs.js';
import { ANIMALS } from '../sim/animals.js';
import { SHIP_TYPES } from '../sim/transport.js';
import { S } from '../sim/people.js';
import { hash2 } from '../util/rng.js';

export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];

const CAT_SHADE = {
  general: 0.85, government: 1.25, food: 0.95, material: 0.8, craft: 1.0, military: 1.35, commerce: 1.15,
  transport: 0.9, religion: 1.3, knowledge: 1.2, culture: 1.2, health: 1.25, industry: 0.75,
};

export class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = sim;
    const W = (this.W = sim.world.W), H = (this.H = sim.world.H);
    this.wc = document.createElement('canvas');
    this.wc.width = W; this.wc.height = H;
    this.wctx = this.wc.getContext('2d');
    this.img = this.wctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.base = new Uint32Array(W * H);
    this.bldPx = new Uint32Array(W * H); // building sprite pixel or 0
    this.lc = document.createElement('canvas');
    this.lc.width = W; this.lc.height = H;
    this.lctx = this.lc.getContext('2d');
    this.lightImg = this.lctx.createImageData(W, H);
    this.lightBuf = new Uint32Array(this.lightImg.data.buffer);
    this.lightsDirty = true;
    this.cam = { x: W / 2, y: H / 2, zi: 2 };
    this.season = -1;
    this.repaintRow = -1;
    this.overlay = 'none';     // none | territory | traffic | fertility | pollution | resources
    this.colorMode = 'civ';    // civ | profession | belief | happiness | health | age
    this.beliefScale = 0;
    this.showLabels = true;
    this.night = true;
    this.selected = -1;        // person id
    this.selectedBuilding = -1;
    this.hover = null;
    this.personPalette = [];
    this.frame = 0;
    this.dpr = 1;
    this.buildPalette();
    this.fullRepaint();
  }

  get zoom() { return ZOOMS[this.cam.zi]; }

  buildPalette() {
    this.personPalette = this.sim.civs.map((civ) => this.civPalette(civ.color));
  }
  civPalette(col) {
    return PROFESSIONS.map((p) => {
      const k = CAT_SHADE[p.cat] || 1;
      const mix = 0.28;
      const r = (col[0] * (1 - mix) + p.color[0] * mix) * k;
      const g = (col[1] * (1 - mix) + p.color[1] * mix) * k;
      const b = (col[2] * (1 - mix) + p.color[2] * mix) * k;
      return rgba(r, g, b);
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // --------------------------------------------------------------- base layer
  fullRepaint() {
    const w = this.sim.world;
    this.season = this.sim.season;
    for (let i = 0; i < w.N; i++) this.base[i] = terrainColor(w, i, this.season);
    this.bldPx.fill(0);
    this.lightBuf.fill(0);
    for (const b of this.sim.buildings) if (b) this.paintBuilding(b);
    w.dirtyAll = false;
    w.dirty.length = 0;
    this.sim.renderDirtyBuildings.length = 0;
    this.sim.removedBuildings.length = 0;
    this.lightsDirty = true;
  }

  paintBuilding(b) {
    const W = this.W, w = this.sim.world;
    const civ = this.sim.civs[b.civ];
    const { px, lights } = buildingSprite(b, civ ? civ.color : [200, 200, 200], this.sim.season, this.sim.tick);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const i = (b.y + y) * W + b.x + x;
      const c = px[y * b.w + x];
      this.bldPx[i] = c;
      this.base[i] = c || terrainColor(w, i, this.season);
      this.lightBuf[i] = 0;
    }
    b.paintedHp = b.hp < b.maxHp * 0.5 ? 1 : 0;
    b.paintedBuilt = b.built;
    b.paintedProg = Math.floor((b.progress || 0) * 8);
    b.paintedBanned = b.banned;
    b.paintedCiv = b.civ;
    for (const [x, y] of lights) {
      const i = (b.y + y) * W + b.x + x;
      this.lightBuf[i] = rgba(255, 210, 120);
    }
    this.lightsDirty = true;
  }

  processDirty() {
    const sim = this.sim, w = sim.world;
    if (w.dirtyAll) { this.fullRepaint(); return; }
    // progressive seasonal repaint (a wave sweeping down the map)
    if (sim.season !== this.season && this.repaintRow < 0) { this.repaintRow = 0; this.season = sim.season; }
    if (this.repaintRow >= 0) {
      const rows = 60;
      const end = Math.min(this.H, this.repaintRow + rows);
      for (let y = this.repaintRow; y < end; y++) for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        if (!this.bldPx[i]) this.base[i] = terrainColor(w, i, this.season);
      }
      this.repaintRow = end >= this.H ? -1 : end;
      if (this.repaintRow < 0) for (const b of sim.buildings) if (b && (b.def.field || b.def.style.kind === 'pasture')) this.paintBuilding(b);
    }
    for (const r of sim.removedBuildings) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * this.W + x;
        this.bldPx[i] = 0; this.lightBuf[i] = 0;
        this.base[i] = terrainColor(w, i, this.season);
      }
      this.lightsDirty = true;
    }
    sim.removedBuildings.length = 0;
    const d = w.dirty;
    for (let k = 0; k < d.length; k++) {
      const i = d[k];
      if (this.bldPx[i]) continue;
      this.base[i] = terrainColor(w, i, this.season);
    }
    d.length = 0;
    const seen = new Set();
    for (const id of sim.renderDirtyBuildings) {
      if (seen.has(id)) continue;
      seen.add(id);
      const b = sim.buildings[id];
      if (b) this.paintBuilding(b);
    }
    sim.renderDirtyBuildings.length = 0;
    // repaint buildings whose visible state changed (progress, damage, bans)
    if ((this.frame & 15) === 0) {
      for (const b of sim.buildings) {
        if (!b) continue;
        const prog = Math.floor((b.progress || 0) * 8);
        const dmg = b.hp < b.maxHp * 0.5 ? 1 : 0;
        if (b.built !== b.paintedBuilt || prog !== b.paintedProg || dmg !== b.paintedHp || b.banned !== b.paintedBanned || b.civ !== b.paintedCiv ||
          (b.def.style.kind === 'windmill' && (this.frame & 63) === 0)) this.paintBuilding(b);
      }
    }
  }

  // --------------------------------------------------------------- camera
  screenToWorld(sx, sy) {
    const z = this.zoom;
    const ox = Math.round(this.canvas.width / 2 - this.cam.x * z), oy = Math.round(this.canvas.height / 2 - this.cam.y * z);
    return [(sx * this.dpr - ox) / z, (sy * this.dpr - oy) / z];
  }
  worldToScreen(x, y) {
    const z = this.zoom;
    const ox = Math.round(this.canvas.width / 2 - this.cam.x * z), oy = Math.round(this.canvas.height / 2 - this.cam.y * z);
    return [(ox + x * z) / this.dpr, (oy + y * z) / this.dpr];
  }
  zoomAt(sx, sy, dir) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.cam.zi = Math.max(0, Math.min(ZOOMS.length - 1, this.cam.zi + dir));
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.cam.x += wx - wx2; this.cam.y += wy - wy2;
    this.clampCam();
  }
  pan(dxScreen, dyScreen) {
    this.cam.x -= dxScreen * this.dpr / this.zoom;
    this.cam.y -= dyScreen * this.dpr / this.zoom;
    this.clampCam();
  }
  clampCam() {
    this.cam.x = Math.max(0, Math.min(this.W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.H, this.cam.y));
  }
  fitZoom() {
    const cw = this.canvas.width, ch = this.canvas.height;
    let zi = 0;
    for (let k = 0; k < ZOOMS.length; k++) if (this.W * ZOOMS[k] <= cw * 1.05 && this.H * ZOOMS[k] <= ch * 1.05) zi = k;
    this.cam.zi = zi; this.cam.x = this.W / 2; this.cam.y = this.H / 2;
  }

  // --------------------------------------------------------------- colours
  personColor(i) {
    const P = this.sim.people;
    const c = P.civ[i];
    switch (this.colorMode) {
      case 'profession': { const p = PROFESSIONS[P.prof[i]].color; return rgba(p[0], p[1], p[2]); }
      case 'belief': {
        const v = P.b(i, this.beliefScale) / 100;
        return v >= 0 ? rgba(200 + 55 * v, 200 - 170 * v, 200 - 170 * v) : rgba(200 + 170 * v, 200 + 30 * v, 200 - 55 * v);
      }
      case 'happiness': { const h = P.happy[i] / 100; return rgba(255 * (1 - h), 60 + 195 * h, 60); }
      case 'health': { if (P.sick[i] > 0) return rgba(150, 255, 60); const h = P.health[i] / 100; return rgba(255 * (1 - h), 255 * h, 90); }
      case 'age': { const a = Math.min(1, P.age[i] / 80); return rgba(255 - a * 200, 220 - a * 120, 120 + a * 135); }
    }
    let col = this.personPalette[c][P.prof[i]];
    if (P.age[i] < CFG.ADULT_AGE) {
      const r = col & 255, g = (col >> 8) & 255, b = (col >> 16) & 255;
      col = rgba(r + (255 - r) * 0.45, g + (255 - g) * 0.45, b + (255 - b) * 0.45);
    } else if (P.sick[i] > 0) col = rgba(140, 200, 60);
    else if (P.flags[i] & 16) col = rgba(255, 240, 120);
    return col;
  }

  // --------------------------------------------------------------- frame
  render() {
    const sim = this.sim;
    this.frame++;
    this.resize();
    this.processDirty();
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    const z = this.zoom;
    const ox = Math.round(cw / 2 - this.cam.x * z), oy = Math.round(ch / 2 - this.cam.y * z);
    // visible world rect
    const vx0 = Math.max(0, Math.floor(-ox / z) - 1), vy0 = Math.max(0, Math.floor(-oy / z) - 1);
    const vx1 = Math.min(this.W, Math.ceil((cw - ox) / z) + 1), vy1 = Math.min(this.H, Math.ceil((ch - oy) / z) + 1);
    const vw = vx1 - vx0, vh = vy1 - vy0;
    ctx.fillStyle = '#0b1622';
    ctx.fillRect(0, 0, cw, ch);
    if (vw <= 0 || vh <= 0) return;
    const W = this.W, buf = this.buf, base = this.base;
    for (let y = vy0; y < vy1; y++) buf.set(base.subarray(y * W + vx0, y * W + vx1), y * W + vx0);
    this.drawOverlay(vx0, vy0, vx1, vy1);
    this.drawDynamic(vx0, vy0, vx1, vy1);
    this.wctx.putImageData(this.img, 0, 0, vx0, vy0, vw, vh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.wc, vx0, vy0, vw, vh, ox + vx0 * z, oy + vy0 * z, vw * z, vh * z);
    // day / night
    const nf = this.night ? this.nightFactor() : 0;
    if (nf > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${Math.round(255 - 200 * nf)},${Math.round(255 - 180 * nf)},${Math.round(255 - 110 * nf)},1)`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      if (this.lightsDirty) { this.lctx.putImageData(this.lightImg, 0, 0); this.lightsDirty = false; }
      ctx.globalAlpha = Math.min(1, nf * 1.3);
      ctx.drawImage(this.lc, vx0, vy0, vw, vh, ox + vx0 * z, oy + vy0 * z, vw * z, vh * z);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (z >= 6) this.drawGrid(ctx, ox, oy, z, vx0, vy0, vx1, vy1);
    this.drawSelection(ctx, ox, oy, z);
    if (this.showLabels) this.drawLabels(ctx, ox, oy, z);
  }

  nightFactor() {
    const t = this.sim.tod;
    // dark 0.92..0.2, twilight ramps
    if (t < 0.18 || t > 0.94) return 0.72;
    if (t < 0.28) return 0.72 * (1 - (t - 0.18) / 0.1);
    if (t > 0.82) return 0.72 * ((t - 0.82) / 0.12);
    return 0;
  }

  drawOverlay(x0, y0, x1, y1) {
    const sim = this.sim, w = sim.world, buf = this.buf, W = this.W;
    const mode = this.overlay;
    // borders are always drawn; territory tint only in territory mode
    const owner = w.owner, TW = CFG.TW, S_ = CFG.TER;
    const civCols = sim.civs.map((c) => c.color);
    for (let y = y0; y < y1; y++) {
      const ty = (y / S_) | 0;
      for (let x = x0; x < x1; x++) {
        const k = ty * TW + ((x / S_) | 0);
        const o = owner[k];
        const i = y * W + x;
        if (mode === 'territory' && o >= 0) {
          const c = civCols[o], p = buf[i];
          buf[i] = rgba((p & 255) * 0.62 + c[0] * 0.38, ((p >> 8) & 255) * 0.62 + c[1] * 0.38, ((p >> 16) & 255) * 0.62 + c[2] * 0.38);
        }
        // border pixels: owner differs from right/bottom neighbour cell at cell edges
        if (o >= 0 && ((x % S_) === 0 || (y % S_) === 0)) {
          const left = (x % S_) === 0 && x > 0 ? owner[k - 1] : o;
          const up = (y % S_) === 0 && y > 0 ? owner[k - TW] : o;
          if (left !== o || up !== o) {
            const c = civCols[o];
            if (((x + y) & 1) === 0 || mode === 'territory') buf[i] = rgba(c[0], c[1], c[2]);
          }
        }
      }
    }
    if (mode === 'traffic' || mode === 'fertility' || mode === 'pollution' || mode === 'resources') {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        let v = 0, col = null;
        if (mode === 'traffic') { v = Math.min(1, w.traffic[i] / 40); col = [255, 220, 60]; }
        else if (mode === 'fertility') { v = w.fert[i] / 255; col = [60, 255, 80]; }
        else if (mode === 'pollution') { v = Math.min(1, w.pollution[w.terrIdx(x, y)] / 120); col = [160, 60, 200]; }
        else if (mode === 'resources') { const d = w.dep[i]; if (d >= 3 && d !== 17 && d !== 20) { v = 0.9; col = [255, 80, 200]; } }
        if (v > 0.02) {
          const p = buf[i];
          buf[i] = rgba((p & 255) * (1 - v) + col[0] * v, ((p >> 8) & 255) * (1 - v) + col[1] * v, ((p >> 16) & 255) * (1 - v) + col[2] * v);
        }
      }
    }
  }

  drawDynamic(x0, y0, x1, y1) {
    const sim = this.sim, P = sim.people, W = this.W, buf = this.buf;
    const tick = sim.tick;
    // fires
    for (const id of sim.events.fires) {
      const b = sim.buildings[id];
      if (!b) continue;
      for (let k = 0; k < b.w * b.h * 0.5; k++) {
        const x = b.x + ((hash2(k, tick >> 2, id) * b.w) | 0), y = b.y + ((hash2(k, tick >> 2, id + 7) * b.h) | 0);
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        const r = hash2(x, y, tick >> 1);
        buf[y * W + x] = r > 0.66 ? rgba(255, 230, 90) : r > 0.33 ? rgba(255, 130, 30) : rgba(200, 40, 20);
      }
      // smoke
      for (let k = 0; k < 6; k++) {
        const x = b.x + (b.w >> 1) + (((tick >> 3) + k) % 5) - 2, y = b.y - 1 - ((tick >> 2) + k * 3) % 8;
        if (x >= x0 && y >= y0 && x < x1 && y < y1) buf[y * W + x] = rgba(70, 70, 74);
      }
    }
    // industrial smoke
    if ((this.frame & 1) === 0) this.smoke = null;
    // animals
    const an = sim.animals;
    for (let i = 0; i < an.hwm; i++) {
      if (!an.alive[i]) continue;
      const x = an.x[i] | 0, y = an.y[i] | 0;
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      const c = ANIMALS[an.type[i]].color;
      buf[y * W + x] = rgba(c[0], c[1], c[2]);
    }
    // railway trains
    for (const tr of sim.transport.trains) {
      const path = tr.pathRef;
      if (!path) continue;
      const civ = sim.civs[tr.civ];
      for (let k = 0; k < tr.len; k++) {
        const idx = Math.round(tr.pos - tr.dir * k);
        if (idx < 0 || idx >= path.length) continue;
        const p = path[idx], x = p % W, y = (p / W) | 0;
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        buf[p] = k === 0 ? rgba(30, 30, 34) : rgba(civ.color[0] * 0.8, civ.color[1] * 0.8, civ.color[2] * 0.8);
      }
    }
    // ships
    for (const sh of sim.transport.ships) {
      const t = SHIP_TYPES[sh.level];
      const civ = sim.civs[sh.civ];
      const ca = Math.cos(sh.ang || 0), sa = Math.sin(sh.ang || 0);
      for (let k = 0; k < t.len; k++) {
        const x = (sh.x - ca * k) | 0, y = (sh.y - sa * k) | 0;
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        buf[y * W + x] = k === 0 ? rgba(240, 236, 220) : rgba(civ.color[0] * 0.7 + 60, civ.color[1] * 0.7 + 40, civ.color[2] * 0.7 + 20);
      }
      if (sh.level <= 3 && t.len > 1) {
        const x = (sh.x - ca) | 0, y = ((sh.y - sa) | 0) - 1;
        if (x >= x0 && y >= y0 && x < x1 && y < y1) buf[y * W + x] = rgba(250, 250, 245);
      }
    }
    // people: each pixel is a person
    const hwm = P.hwm;
    for (let i = 0; i < hwm; i++) {
      if (P.civ[i] < 0 || P.state[i] === S.INSIDE) continue;
      const x = P.x[i] | 0, y = P.y[i] | 0;
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      let c = P.color[i];
      if (!c || this.colorMode !== 'civ' || (this.frame & 31) === (i & 31)) { c = this.personColor(i); if (this.colorMode === 'civ') P.color[i] = c; }
      buf[y * W + x] = c;
    }
    // aircraft (above everything)
    for (const pl of sim.transport.planes) {
      const civ = sim.civs[pl.civ];
      const x = pl.x | 0, y = pl.y | 0;
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < x0 || yy < y0 || xx >= x1 || yy >= y1) continue;
        buf[yy * W + xx] = dx === 0 && dy === 0 ? rgba(250, 250, 255) : rgba(civ.color[0], civ.color[1], civ.color[2]);
      }
    }
    // projectiles
    for (const pr of sim.projectiles) {
      const t = pr.t / pr.dur;
      const x = (pr.x0 + (pr.x1 - pr.x0) * t) | 0, y = (pr.y0 + (pr.y1 - pr.y0) * t - Math.sin(t * Math.PI) * (pr.kind === 1 ? 4 : 1)) | 0;
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      buf[y * W + x] = pr.kind === 2 ? rgba(255, 255, 160) : pr.kind === 1 ? rgba(60, 40, 20) : rgba(220, 220, 220);
    }
    // recent deaths flash dark red
    for (const d of sim.deaths) {
      if (tick - d.t > 60) continue;
      const x = d.x | 0, y = d.y | 0;
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      buf[y * W + x] = rgba(120, 10, 10);
    }
  }

  drawGrid(ctx, ox, oy, z) {
    // at high zoom each person is a square: draw a subtle dark outline for clarity
    if (z < 8) return;
    const sim = this.sim, P = sim.people;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, z / 12);
    ctx.beginPath();
    const cw = this.canvas.width, ch = this.canvas.height;
    for (let i = 0; i < P.hwm; i++) {
      if (P.civ[i] < 0 || P.state[i] === S.INSIDE) continue;
      const sx = ox + (P.x[i] | 0) * z, sy = oy + (P.y[i] | 0) * z;
      if (sx < -z || sy < -z || sx > cw || sy > ch) continue;
      ctx.rect(sx + 0.5, sy + 0.5, z - 1, z - 1);
      // carried goods marker
      if (P.carryAmt[i] > 0 && z >= 12) {
        ctx.fillStyle = sim.resColor(P.carryRes[i]);
        ctx.fillRect(sx + z * 0.6, sy + z * 0.05, z * 0.35, z * 0.35);
      }
    }
    ctx.stroke();
  }

  drawSelection(ctx, ox, oy, z) {
    const sim = this.sim, P = sim.people;
    const i = this.selected;
    if (i >= 0 && P.civ[i] >= 0) {
      const sx = ox + (P.x[i] | 0) * z, sy = oy + (P.y[i] | 0) * z;
      const s = Math.max(z, 6);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(sx - (s - z) / 2 - 3, sy - (s - z) / 2 - 3, s + 6, s + 6);
      // path
      const path = P.path[i];
      if (path && path.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx + z / 2, sy + z / 2);
        for (let k = P.pathIdx[i]; k < path.length; k++) {
          const c = path[k];
          ctx.lineTo(ox + ((c % CFG.NW) * CFG.NAV + 4) * z, oy + (((c / CFG.NW) | 0) * CFG.NAV + 4) * z);
        }
        ctx.lineTo(ox + P.gx[i] * z, oy + P.gy[i] * z);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const b = this.selectedBuilding >= 0 ? sim.buildings[this.selectedBuilding] : null;
    if (b) {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2;
      ctx.strokeRect(ox + b.x * z - 2, oy + b.y * z - 2, b.w * z + 4, b.h * z + 4);
    }
  }

  drawLabels(ctx, ox, oy, z) {
    const sim = this.sim;
    const dpr = this.dpr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of sim.towns) {
      if (!t || !t.alive) continue;
      const civ = sim.civs[t.civ];
      const c = sim.buildings[t.center];
      const x = ox + (c ? c.cx : t.cx) * z, y = oy + (c ? c.y - 4 : t.cy - 10) * z;
      if (x < -200 || y < -50 || x > this.canvas.width + 200 || y > this.canvas.height + 50) continue;
      const size = Math.round((t.isCapital ? 15 : 12) * dpr * (z >= 4 ? 1.1 : 1));
      ctx.font = `${t.isCapital ? '700' : '600'} ${size}px ui-sans-serif, system-ui, sans-serif`;
      const label = (t.isCapital ? '★ ' : '') + t.name;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = `rgb(${Math.min(255, civ.color[0] + 60)},${Math.min(255, civ.color[1] + 60)},${Math.min(255, civ.color[2] + 60)})`;
      ctx.fillText(label, x, y);
      if (z >= 2) {
        ctx.font = `${Math.round(10 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.lineWidth = 3 * dpr;
        const sub = `${t.pop} people`;
        ctx.strokeText(sub, x, y + size * 0.95);
        ctx.fillStyle = '#e8e4d8';
        ctx.fillText(sub, x, y + size * 0.95);
      }
    }
    // armies
    for (const a of sim.military.armies) {
      if (!a.members.length) continue;
      let sx = 0, sy = 0;
      for (const i of a.members) { sx += sim.people.x[i]; sy += sim.people.y[i]; }
      sx /= a.members.length; sy /= a.members.length;
      const x = ox + sx * z, y = oy + sy * z - 14 * dpr;
      const civ = sim.civs[a.civ];
      ctx.font = `700 ${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
      const label = `⚔ ${a.members.length} · ${a.state}`;
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = civ.css;
      ctx.fillText(label, x, y);
    }
    // building names at high zoom
    if (z >= 6) {
      ctx.font = `${Math.round(Math.min(12, z * 0.9) * dpr)}px ui-sans-serif, system-ui, sans-serif`;
      for (const b of sim.buildings) {
        if (!b) continue;
        const x = ox + b.cx * z, y = oy + (b.y + b.h) * z + 7 * dpr;
        if (x < -100 || y < -20 || x > this.canvas.width + 100 || y > this.canvas.height + 20) continue;
        if (b.w * z < 40 * dpr) continue;
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        const label = b.built ? b.def.name : `${b.def.name} ${(b.progress * 100) | 0}%`;
        ctx.strokeText(label, x, y);
        ctx.fillStyle = b.built ? '#f2eee2' : '#ffd27a';
        ctx.fillText(label, x, y);
      }
    }
  }

  // Minimap: downsampled base + territory, returns a canvas.
  drawMinimap(mc) {
    const mctx = mc.getContext('2d');
    const mw = mc.width, mh = mc.height;
    if (!this.miniImg || this.miniImg.width !== mw) this.miniImg = mctx.createImageData(mw, mh);
    const b32 = new Uint32Array(this.miniImg.data.buffer);
    const sx = this.W / mw, sy = this.H / mh;
    const w = this.sim.world;
    const cols = this.sim.civs.map((c) => c.color);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const wx = (x * sx) | 0, wy = (y * sy) | 0;
      const p = this.base[wy * this.W + wx];
      const o = w.owner[w.terrIdx(wx, wy)];
      if (o >= 0) {
        const c = cols[o];
        b32[y * mw + x] = rgba((p & 255) * 0.55 + c[0] * 0.45, ((p >> 8) & 255) * 0.55 + c[1] * 0.45, ((p >> 16) & 255) * 0.55 + c[2] * 0.45);
      } else b32[y * mw + x] = p;
    }
    mctx.putImageData(this.miniImg, 0, 0);
    // viewport rectangle
    const [a, b] = this.screenToWorld(0, 0);
    const [c, d] = this.screenToWorld(this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
    mctx.strokeRect(a / sx, b / sy, (c - a) / sx, (d - b) / sy);
  }
}

export { NB, SCALES };

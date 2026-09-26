// The world map: terrain, deposits, roads, occupancy, traffic and territory.
import { CFG } from '../config.js';
import { Noise2D, mulberry32, hash2 } from '../util/rng.js';
import { MinHeap } from '../util/heap.js';
import { T, TERRAIN, D, DEPOSITS } from './terrain.js';

export const ROAD_SPEED = [1, 1.35, 1.75, 2.2, 3.0];
export const ROAD_NAMES = ['None', 'Footpath', 'Road', 'Paved road', 'Highway'];
export const RAIL = 8, BRIDGE = 16, CANAL = 32;

export class World {
  constructor(seed) {
    this.seed = seed;
    const W = (this.W = CFG.W), H = (this.H = CFG.H);
    const N = W * H;
    this.N = N;
    this.ter = new Uint8Array(N);
    this.elev = new Float32Array(N);
    this.moist = new Float32Array(N);
    this.temp = new Float32Array(N);
    this.dep = new Uint8Array(N);
    this.amt = new Uint8Array(N);
    this.road = new Uint8Array(N);
    this.bld = new Int32Array(N);       // building id + 1
    this.traffic = new Uint16Array(N);
    this.speedQ = new Uint8Array(N);    // speed * 64
    this.fert = new Uint8Array(N);
    this.pollution = new Uint8Array(CFG.TW * CFG.TH);
    this.owner = new Int8Array(CFG.TW * CFG.TH).fill(-1);
    this.infl = new Float32Array(CFG.TW * CFG.TH);
    this.dirty = [];                    // changed pixel indices (renderer consumes)
    this.dirtyAll = true;
    this.territoryVersion = 0;
    this.roadVersion = 0;
    this.coastCells = [];
  }

  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  isWater(i) { return TERRAIN[this.ter[i]].water === 1 && !(this.road[i] & BRIDGE); }
  isDeepWater(i) { const t = this.ter[i]; return t === T.DEEP || t === T.SHALLOW || t === T.LAKE; }
  isLand(i) { return TERRAIN[this.ter[i]].water === 0; }
  speedAt(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 0;
    return this.speedQ[(y | 0) * this.W + (x | 0)] * 0.015625;
  }
  markDirty(i) { this.dirty.push(i); }

  recomputeSpeed(i) {
    const t = this.ter[i];
    let s = TERRAIN[t].speed;
    const r = this.road[i];
    const lvl = r & 7;
    if (r & BRIDGE) s = 1.0;
    if (this.bld[i] && s > 0) s = Math.max(s, 0.9);
    if (lvl > 0 && s > 0) s = Math.max(s, 0.8) * ROAD_SPEED[lvl];
    if (this.dep[i] === D.TREE && lvl === 0 && !this.bld[i]) s *= 0.8;
    this.speedQ[i] = Math.min(255, Math.round(s * 64));
  }

  setRoad(i, level) {
    const r = this.road[i];
    if ((r & 7) >= level) return false;
    this.road[i] = (r & ~7) | level;
    if (this.dep[i] === D.TREE || this.dep[i] === D.BERRY || this.dep[i] === D.SAPLING) {
      this.dep[i] = 0; this.amt[i] = 0;
    }
    this.recomputeSpeed(i);
    this.markDirty(i);
    this.roadVersion++;
    return true;
  }

  // ---------------------------------------------------------------- generation
  generate() {
    const W = this.W, H = this.H;
    const seed = this.seed;
    const nE = new Noise2D(seed * 7 + 1);
    const nW = new Noise2D(seed * 7 + 2);
    const nM = new Noise2D(seed * 7 + 3);
    const nR = new Noise2D(seed * 7 + 4);
    const nT = new Noise2D(seed * 7 + 5);
    const nP = new Noise2D(seed * 7 + 6);
    const rnd = mulberry32(seed * 13 + 11);
    const aspect = W / H;

    // The mountain spine meanders roughly north-south through the middle and is
    // broken by a few passes, so both civilisations share one continent.
    const spineX = (ny) => 0.5 + 0.07 * nP.fbm(ny * 2.2 + 3.1, 1.7, 3) + 0.03 * Math.sin(ny * 7 + seed);

    for (let y = 0; y < H; y++) {
      const ny = y / H;
      for (let x = 0; x < W; x++) {
        const nx = x / W;
        const i = y * W + x;
        const wx = nx + 0.13 * nW.fbm(nx * 2.3 + 5.2, ny * 2.3 + 1.3, 4);
        const wy = ny + 0.13 * nW.fbm(nx * 2.3 + 9.7, ny * 2.3 + 7.1, 4);
        const dx = (wx - 0.5) / 0.5, dy = (wy - 0.5) / 0.47;
        const d = Math.sqrt(dx * dx + dy * dy);
        const mask = 1 - smoothstep(0.66, 1.06, d);
        let e = nE.fbm(nx * 4.2 * aspect * 0.62, ny * 4.2, 6) * 0.5;
        e = e + mask * 0.36 - 0.17;
        // spine
        const sx = spineX(ny);
        const bd = (wx - sx) / 0.045;
        const band = Math.exp(-bd * bd);
        const pass = 0.25 + 0.75 * smoothstep(-0.2, 0.05, nP.fbm(ny * 5.3 + 11, 0.4, 3) + 0.06);
        const ridge = nR.ridged(nx * 7 * aspect * 0.62, ny * 7, 5);
        e += band * mask * pass * (0.16 + 0.56 * ridge * ridge);
        // scattered ranges and highlands
        const hr = nR.ridged(nx * 3.1 + 40, ny * 3.1 + 40, 4);
        if (hr > 0.66) e += (hr - 0.66) * 0.8 * mask;
        this.elev[i] = e;
        // moisture: west is wetter (prevailing winds), plus noise
        let m = 0.5 + 0.55 * nM.fbm(nx * 3.3, ny * 3.3, 5) - 0.26 * nx + 0.08;
        // rain shadow east of the spine
        if (wx > sx && wx < sx + 0.18) m -= 0.12 * (1 - (wx - sx) / 0.18) * mask;
        this.moist[i] = m;
        // temperature: cold north, hot south, colder at altitude
        const t = 0.08 + 0.92 * ny + 0.1 * nT.fbm(nx * 2.5, ny * 2.5, 3) - Math.max(0, e - 0.2) * 0.9;
        this.temp[i] = t;
      }
    }

    // Classify base terrain
    for (let i = 0; i < W * H; i++) {
      const e = this.elev[i], m = this.moist[i], t = this.temp[i];
      let ty;
      if (e < -0.1) ty = T.DEEP;
      else if (e < 0) ty = T.SHALLOW;
      else if (e < 0.018 && t > 0.2) ty = T.BEACH;
      else if (e > 0.68) ty = T.PEAK;
      else if (e > 0.47) ty = t < 0.05 ? T.PEAK : T.MOUNTAIN;
      else if (e > 0.34) ty = t < 0.1 ? T.SNOW : T.HILLS;
      else if (t < 0.14) ty = T.SNOW;
      else if (t < 0.26) ty = m > 0.5 ? T.TAIGA : T.TUNDRA;
      else if (t < 0.36) ty = m > 0.42 ? T.TAIGA : (m > 0.3 ? T.GRASS : T.PLAINS);
      else if (t < 0.72) {
        if (m < 0.26) ty = T.PLAINS;
        else if (m < 0.47) ty = T.GRASS;
        else if (m < 0.72) ty = T.FOREST;
        else ty = e < 0.08 ? T.MARSH : T.FOREST;
      } else {
        if (m < 0.24) ty = T.DESERT;
        else if (m < 0.4) ty = T.SAVANNA;
        else if (m < 0.56) ty = T.GRASS;
        else if (m < 0.78) ty = T.JUNGLE;
        else ty = e < 0.08 ? T.MARSH : T.JUNGLE;
      }
      this.ter[i] = ty;
    }

    this.generateRivers(rnd);
    this.cleanupSpecks();
    this.generateDeposits(rnd, nM);
    this.computeFertility();
    for (let i = 0; i < W * H; i++) this.recomputeSpeed(i);
    this.dirtyAll = true;
  }

  generateRivers(rnd) {
    const S = 4, W = this.W, H = this.H;
    const cw = Math.ceil(W / S), ch = Math.ceil(H / S), n = cw * ch;
    const ce = new Float32Array(n);
    const rain = new Float32Array(n);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      const x = Math.min(W - 1, cx * S + 2), y = Math.min(H - 1, cy * S + 2);
      const i = y * W + x;
      ce[cy * cw + cx] = this.elev[i];
      rain[cy * cw + cx] = Math.max(0.05, this.moist[i]) * (this.temp[i] < 0.14 ? 0.4 : 1);
    }
    // Priority flood from ocean cells / borders
    const filled = new Float32Array(n).fill(Infinity);
    const down = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const order = new Int32Array(n);
    let on = 0;
    const heap = new MinHeap(n);
    for (let c = 0; c < n; c++) {
      const cx = c % cw, cy = (c / cw) | 0;
      if (ce[c] < 0 || cx === 0 || cy === 0 || cx === cw - 1 || cy === ch - 1) {
        filled[c] = ce[c]; heap.push(c, ce[c]);
      }
    }
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    while (heap.size > 0) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1; order[on++] = c;
      const cx = c % cw, cy = (c / cw) | 0;
      for (const [ox, oy] of nb) {
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        const d2 = y * cw + x;
        if (done[d2]) continue;
        const f = Math.max(ce[d2], filled[c] + 0.0004);
        if (f < filled[d2]) { filled[d2] = f; down[d2] = c; heap.push(d2, f); }
      }
    }
    // Flow accumulation from high to low
    const acc = new Float32Array(n);
    for (let k = on - 1; k >= 0; k--) {
      const c = order[k];
      if (ce[c] < 0) continue;
      acc[c] += rain[c];
      if (down[c] >= 0) acc[down[c]] += acc[c];
    }
    // Lakes: depressions, but only modest-sized basins become lakes
    const isDep = (c) => ce[c] >= 0 && filled[c] - ce[c] > 0.012 && ce[c] < 0.4;
    const comp = new Int32Array(n).fill(-1);
    const compSize = [];
    const stack = [];
    for (let c = 0; c < n; c++) {
      if (comp[c] >= 0 || !isDep(c)) continue;
      const id = compSize.length; let size = 0;
      stack.push(c); comp[c] = id;
      while (stack.length) {
        const k = stack.pop(); size++;
        const kx = k % cw, ky = (k / cw) | 0;
        for (const [ox, oy] of nb) {
          const x = kx + ox, y = ky + oy;
          if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
          const d2 = y * cw + x;
          if (comp[d2] < 0 && isDep(d2)) { comp[d2] = id; stack.push(d2); }
        }
      }
      compSize.push(size);
    }
    for (let c = 0; c < n; c++) {
      if (comp[c] >= 0 && compSize[comp[c]] <= 900 && compSize[comp[c]] >= 3 && filled[c] - ce[c] > 0.02) {
        const cx = c % cw, cy = (c / cw) | 0;
        for (let y = cy * S; y < Math.min(H, cy * S + S); y++)
          for (let x = cx * S; x < Math.min(W, cx * S + S); x++) {
            const i = y * W + x;
            if (this.elev[i] < filled[c] - 0.004) this.ter[i] = T.LAKE;
          }
      }
    }
    // Smooth lake shorelines with a majority filter
    {
      const orig = this.ter;
      let mask = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) mask[i] = orig[i] === T.LAKE ? 1 : 0;
      for (let pass = 0; pass < 3; pass++) {
        const next = mask.slice();
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
          let c = 0;
          for (let oy = -2; oy <= 2; oy++) { const r = (y + oy) * W + x; c += mask[r - 2] + mask[r - 1] + mask[r] + mask[r + 1] + mask[r + 2]; }
          const i = y * W + x;
          if (c >= 14) next[i] = 1; else if (c <= 11) next[i] = 0;
        }
        mask = next;
      }
      for (let i = 0; i < W * H; i++) {
        if (mask[i] && TERRAIN[orig[i]].water === 0) orig[i] = T.LAKE;
        else if (!mask[i] && orig[i] === T.LAKE) orig[i] = this.elev[i] < 0.06 ? T.MARSH : T.GRASS;
      }
    }
    // Rivers
    const jit = (c) => {
      const cx = c % cw, cy = (c / cw) | 0;
      return [cx * S + 2 + (hash2(cx, cy, 7) - 0.5) * 3.2, cy * S + 2 + (hash2(cx, cy, 9) - 0.5) * 3.2];
    };
    const TH = 42;
    for (let c = 0; c < n; c++) {
      if (acc[c] < TH || ce[c] < 0 || down[c] < 0) continue;
      const [x0, y0] = jit(c);
      const [x1, y1] = jit(down[c]);
      const width = acc[c] > TH * 9 ? 2 : (acc[c] > TH * 3.5 ? 1 : 0);
      this.drawRiverLine(x0, y0, x1, y1, width);
    }
  }

  drawRiverLine(x0, y0, x1, y1, width) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) {
        if (width > 0 && ox * ox + oy * oy > width * width + 1) continue;
        const px = x + ox, py = y + oy;
        if (!this.inb(px, py)) continue;
        const i = py * this.W + px;
        const tt = this.ter[i];
        if (tt === T.DEEP || tt === T.SHALLOW || tt === T.LAKE || tt === T.PEAK) continue;
        this.ter[i] = T.RIVER;
      }
    }
  }

  cleanupSpecks() {
    // Remove single-pixel water/land specks for cleaner coasts.
    const W = this.W, H = this.H;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = this.ter[i];
      if (t !== T.SHALLOW && t !== T.BEACH) continue;
      let land = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (TERRAIN[this.ter[i + oy * W + ox]].water === 0) land++;
      }
      if (t === T.SHALLOW && land >= 7) this.ter[i] = T.BEACH;
      else if (t === T.BEACH && land <= 1) this.ter[i] = T.SHALLOW;
    }
  }

  generateDeposits(rnd, nM) {
    const W = this.W, H = this.H;
    const dep = this.dep, amt = this.amt, ter = this.ter;
    // Vegetation
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = ter[i];
      const h = hash2(x, y, this.seed);
      const h2 = hash2(x, y, this.seed + 99);
      let treeP = 0;
      if (t === T.FOREST) treeP = 0.62;
      else if (t === T.JUNGLE) treeP = 0.78;
      else if (t === T.TAIGA) treeP = 0.5;
      else if (t === T.GRASS) treeP = 0.035;
      else if (t === T.SAVANNA) treeP = 0.02;
      else if (t === T.MARSH) treeP = 0.14;
      else if (t === T.HILLS) treeP = 0.08;
      else if (t === T.PLAINS) treeP = 0.008;
      // clumping
      const clump = nM.noise(x * 0.09 + 3, y * 0.09 + 7) * 0.35;
      if (h < treeP + clump * (treeP > 0 ? 1 : 0)) { dep[i] = D.TREE; amt[i] = 40 + ((h2 * 60) | 0); continue; }
      if ((t === T.GRASS || t === T.FOREST || t === T.PLAINS || t === T.SAVANNA) && h2 < 0.022) { dep[i] = D.BERRY; amt[i] = 40; continue; }
      if (t === T.JUNGLE && h2 < 0.02) { dep[i] = D.SPICE; amt[i] = 30; continue; }
      if ((t === T.FOREST || t === T.MARSH || t === T.TAIGA) && h2 > 0.985) { dep[i] = D.HERBS; amt[i] = 25; continue; }
      if ((t === T.SAVANNA || (t === T.PLAINS && this.temp[i] > 0.6)) && h2 > 0.988) { dep[i] = D.COTTON; amt[i] = 30; continue; }
      if (t === T.HILLS && h2 < 0.1) { dep[i] = D.STONE; amt[i] = 80 + ((h * 120) | 0); continue; }
      if (t === T.MOUNTAIN && h2 < 0.2) { dep[i] = D.STONE; amt[i] = 120 + ((h * 120) | 0); continue; }
      if ((t === T.GRASS || t === T.PLAINS || t === T.TUNDRA) && h2 > 0.9975) { dep[i] = D.STONE; amt[i] = 60; continue; }
      if ((t === T.SHALLOW || t === T.LAKE || t === T.RIVER) && h < 0.2) { dep[i] = D.FISH; amt[i] = 40 + ((h2 * 60) | 0); continue; }
    }
    // Clay along rivers & lakes
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!TERRAIN[ter[i]].build || dep[i]) continue;
      const nearRiver = ter[i - 1] === T.RIVER || ter[i + 1] === T.RIVER || ter[i - W] === T.RIVER || ter[i + W] === T.RIVER ||
        ter[i - 1] === T.LAKE || ter[i + 1] === T.LAKE || ter[i - W] === T.LAKE || ter[i + W] === T.LAKE;
      if (nearRiver && hash2(x, y, 5) < 0.28) { dep[i] = D.CLAY; amt[i] = 60; }
    }
    // Ore clusters
    const ore = (type, count, rMin, rMax, valid, amtBase) => {
      let placed = 0, tries = 0;
      while (placed < count && tries < count * 400) {
        tries++;
        const cx = 20 + ((rnd() * (W - 40)) | 0), cy = 20 + ((rnd() * (H - 40)) | 0);
        if (!valid(ter[cy * W + cx], cy * W + cx)) continue;
        const r = rMin + rnd() * (rMax - rMin);
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (!this.inb(x, y)) continue;
          const d = Math.hypot(x - cx, y - cy) / r;
          if (d > 1) continue;
          const i = y * W + x;
          if (TERRAIN[ter[i]].water || ter[i] === T.PEAK) continue;
          if (hash2(x, y, type * 31) > 0.9 - d * 0.55) continue;
          dep[i] = type; amt[i] = Math.min(255, amtBase + ((hash2(x, y, type) * 80) | 0));
        }
        placed++;
      }
    };
    const rocky = (t) => t === T.HILLS || t === T.MOUNTAIN;
    const anyLand = (t) => t !== T.DEEP && t !== T.SHALLOW && t !== T.LAKE && t !== T.RIVER && t !== T.PEAK;
    ore(D.COPPER, 18, 3, 7, rocky, 150);
    ore(D.TIN, 12, 2.5, 5, rocky, 140);
    ore(D.IRON, 18, 3, 7, rocky, 160);
    ore(D.COAL, 26, 4, 8, (t) => rocky(t) || t === T.FOREST || t === T.TAIGA, 220);
    ore(D.GOLD, 8, 2, 4, rocky, 120);
    ore(D.SILVER, 8, 2, 4, rocky, 120);
    ore(D.GEMS, 7, 1.5, 3.5, (t) => t === T.MOUNTAIN, 100);
    ore(D.SALT, 8, 3, 6, (t) => t === T.DESERT || t === T.BEACH || t === T.PLAINS, 140);
    ore(D.MARBLE, 7, 3, 5, rocky, 160);
    ore(D.SULFUR, 7, 2, 4, (t) => t === T.MOUNTAIN || t === T.DESERT, 130);
    ore(D.OIL, 12, 3, 7, (t) => t === T.DESERT || t === T.MARSH || t === T.PLAINS || t === T.TUNDRA, 200);
    ore(D.URANIUM, 5, 2, 4, (t) => t === T.MOUNTAIN || t === T.DESERT, 150);
    ore(D.STONE, 25, 3, 6, anyLand, 120);
  }

  computeFertility() {
    const W = this.W, H = this.H;
    // Distance to fresh water on a coarse grid
    const S = 4, cw = Math.ceil(W / S), ch = Math.ceil(H / S);
    const near = new Float32Array(cw * ch);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const t = this.ter[y * W + x];
      if (t === T.RIVER || t === T.LAKE) near[((y / S) | 0) * cw + ((x / S) | 0)] = 1;
    }
    // blur a few passes
    for (let pass = 0; pass < 5; pass++) {
      const nn = near.slice();
      for (let cy = 1; cy < ch - 1; cy++) for (let cx = 1; cx < cw - 1; cx++) {
        const c = cy * cw + cx;
        const m = Math.max(near[c - 1], near[c + 1], near[c - cw], near[c + cw]) * 0.8;
        if (m > nn[c]) nn[c] = m;
      }
      near.set(nn);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const base = TERRAIN[this.ter[i]].fert;
      if (base <= 0) { this.fert[i] = 0; continue; }
      const w = near[((y / S) | 0) * cw + ((x / S) | 0)];
      this.fert[i] = Math.min(255, Math.round((base * 0.75 + w * 0.45) * 220));
    }
  }

  // --------------------------------------------------------------- queries
  // Find a good start location within an x-range (fraction of width).
  findStart(xmin, xmax, rnd) {
    let best = null, bestScore = -1;
    const W = this.W, H = this.H;
    for (let k = 0; k < 900; k++) {
      const x = Math.floor((xmin + rnd() * (xmax - xmin)) * W);
      const y = Math.floor((0.25 + rnd() * 0.5) * H);
      const i = y * W + x;
      const t = this.ter[i];
      if (t !== T.GRASS && t !== T.PLAINS && t !== T.SAVANNA) continue;
      let land = 0, water = 0, trees = 0, fert = 0, fresh = 0, stone = 0, coast = 0;
      for (let oy = -30; oy <= 30; oy += 3) for (let ox = -30; ox <= 30; ox += 3) {
        const px = x + ox, py = y + oy;
        if (!this.inb(px, py)) continue;
        const j = py * W + px;
        const tj = this.ter[j];
        if (TERRAIN[tj].water) { water++; if (tj === T.RIVER || tj === T.LAKE) fresh++; else coast++; }
        else land++;
        if (this.dep[j] === D.TREE) trees++;
        if (this.dep[j] === D.STONE) stone++;
        fert += this.fert[j];
      }
      if (land < 300) continue;
      let flat = 0;
      for (let oy = -10; oy <= 10; oy += 2) for (let ox = -10; ox <= 10; ox += 2) {
        const px = x + ox, py = y + oy;
        if (!this.inb(px, py)) continue;
        if (TERRAIN[this.ter[py * W + px]].build === 1) flat++;
      }
      const score = fert / 400 + Math.min(fresh, 25) * 3 + Math.min(trees, 80) + Math.min(stone, 10) * 2 + flat * 2 + Math.min(coast, 20);
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  }

  terrIdx(x, y) { return ((y / CFG.TER) | 0) * CFG.TW + ((x / CFG.TER) | 0); }
  ownerAt(x, y) { return this.owner[this.terrIdx(x, y)]; }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Coarse navigation grid (8x8 px cells) with cached A* for land and water.
import { CFG } from '../config.js';
import { MinHeap } from '../util/heap.js';
import { TERRAIN, T } from '../world/terrain.js';
import { ROAD_SPEED, BRIDGE } from '../world/world.js';

const INF = 1e9;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];

export class Nav {
  constructor(world) {
    this.world = world;
    this.NW = CFG.NW; this.NH = CFG.NH; this.N = this.NW * this.NH;
    this.cost = new Float32Array(this.N);     // land traversal cost per cell
    this.wcost = new Float32Array(this.N);    // water traversal cost (ships)
    this.comp = new Int32Array(this.N);       // land connected component
    this.wcomp = new Int32Array(this.N);      // water connected component
    this.coastal = new Uint8Array(this.N);    // land cell touching navigable water
    this.dirty = new Set();
    this.cache = new Map();
    this.wcache = new Map();
    this.heap = new MinHeap(4096);
    this.g = new Float32Array(this.N);
    this.from = new Int32Array(this.N);
    this.stamp = new Uint32Array(this.N);
    this.closedStamp = new Uint32Array(this.N);
    this.curStamp = 1;
    this.budget = 0;
    this.version = 0;
    this.stats = { searches: 0, hits: 0 };
    for (let c = 0; c < this.N; c++) this.computeCell(c);
    this.computeComponents();
  }

  cellOf(x, y) {
    const cx = Math.max(0, Math.min(this.NW - 1, (x / CFG.NAV) | 0));
    const cy = Math.max(0, Math.min(this.NH - 1, (y / CFG.NAV) | 0));
    return cy * this.NW + cx;
  }
  cellCenter(c) { return [(c % this.NW) * CFG.NAV + CFG.NAV / 2, ((c / this.NW) | 0) * CFG.NAV + CFG.NAV / 2]; }

  computeCell(c) {
    const w = this.world;
    const S = CFG.NAV;
    const x0 = (c % this.NW) * S, y0 = ((c / this.NW) | 0) * S;
    let pass = 0, inv = 0, water = 0, roads = 0, bestRoad = 0, tot = 0;
    for (let y = y0; y < Math.min(w.H, y0 + S); y++) for (let x = x0; x < Math.min(w.W, x0 + S); x++) {
      const i = y * w.W + x;
      tot++;
      const sp = w.speedQ[i] / 64;
      const t = w.ter[i];
      if (t === T.DEEP || t === T.SHALLOW || t === T.LAKE) water++;
      if (sp > 0) { pass++; inv += 1 / sp; }
      const lvl = w.road[i] & 7;
      if (lvl || (w.road[i] & BRIDGE)) { roads++; if (lvl > bestRoad) bestRoad = lvl; }
    }
    if (pass < tot * 0.3 && roads < 3) this.cost[c] = INF;
    else {
      let cst = inv / pass;
      if (roads >= 3) cst = Math.min(cst, 1 / ROAD_SPEED[Math.max(1, bestRoad)]);
      this.cost[c] = cst;
    }
    this.wcost[c] = water >= tot * 0.55 ? 1 : INF;
  }

  markDirty(x, y) { this.dirty.add(this.cellOf(x, y)); }

  // Called periodically: refresh dirty cells and drop stale cached paths.
  refresh(force = false) {
    if (!this.dirty.size && !force) return;
    // keep cached paths unless some cell's cost changed meaningfully
    let significant = force;
    for (const c of this.dirty) {
      const old = this.cost[c];
      this.computeCell(c);
      const nw = this.cost[c];
      if ((old >= INF) !== (nw >= INF) || Math.abs(nw - old) > old * 0.2) significant = true;
    }
    this.dirty.clear();
    if (significant) { this.cache.clear(); this.version++; }
    if (force) this.computeComponents();
  }

  computeComponents() {
    const N = this.N, NW = this.NW, NH = this.NH;
    const flood = (costArr, compArr) => {
      compArr.fill(-1);
      let id = 0;
      const stack = [];
      for (let c = 0; c < N; c++) {
        if (compArr[c] >= 0 || costArr[c] >= INF) continue;
        compArr[c] = id; stack.push(c);
        while (stack.length) {
          const k = stack.pop();
          const kx = k % NW, ky = (k / NW) | 0;
          for (let d = 0; d < 4; d++) {
            const nx = kx + DIRS[d][0], ny = ky + DIRS[d][1];
            if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
            const n = ny * NW + nx;
            if (compArr[n] < 0 && costArr[n] < INF) { compArr[n] = id; stack.push(n); }
          }
        }
        id++;
      }
    };
    flood(this.cost, this.comp);
    flood(this.wcost, this.wcomp);
    this.coastal.fill(0);
    for (let c = 0; c < N; c++) {
      if (this.cost[c] >= INF) continue;
      const cx = c % NW, cy = (c / NW) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
        if (this.wcost[ny * NW + nx] < INF) { this.coastal[c] = 1; break; }
      }
    }
  }

  // Nearest passable land cell to (x,y) (spiral search).
  nearestLand(c) {
    if (this.cost[c] < INF) return c;
    const cx = c % this.NW, cy = (c / this.NW) | 0;
    for (let r = 1; r < 12; r++) {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= this.NW || ny >= this.NH) continue;
        const n = ny * this.NW + nx;
        if (this.cost[n] < INF) return n;
      }
    }
    return -1;
  }
  nearestWater(c) {
    if (this.wcost[c] < INF) return c;
    const cx = c % this.NW, cy = (c / this.NW) | 0;
    for (let r = 1; r < 6; r++) {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= this.NW || ny >= this.NH) continue;
        const n = ny * this.NW + nx;
        if (this.wcost[n] < INF) return n;
      }
    }
    return -1;
  }

  sameLandmass(x0, y0, x1, y1) {
    const a = this.nearestLand(this.cellOf(x0, y0)), b = this.nearestLand(this.cellOf(x1, y1));
    return a >= 0 && b >= 0 && this.comp[a] === this.comp[b];
  }

  // Returns Int32Array of cell ids from start to goal (inclusive), null if
  // unreachable, or undefined if the per-tick search budget is exhausted.
  findPath(x0, y0, x1, y1, water = false) {
    const costArr = water ? this.wcost : this.cost;
    const compArr = water ? this.wcomp : this.comp;
    let s = this.cellOf(x0, y0), g = this.cellOf(x1, y1);
    s = water ? this.nearestWater(s) : this.nearestLand(s);
    g = water ? this.nearestWater(g) : this.nearestLand(g);
    if (s < 0 || g < 0) return null;
    if (compArr[s] !== compArr[g]) return null;
    if (s === g) return Int32Array.of(g);
    const cache = water ? this.wcache : this.cache;
    const key = s * this.N + g;
    const hit = cache.get(key);
    if (hit !== undefined) { this.stats.hits++; return hit; }
    if (this.budget <= 0) return undefined;
    this.stats.searches++;
    const NW = this.NW, NH = this.NH;
    const gx = g % NW, gy = (g / NW) | 0;
    const hw = water ? 1 : 0.85;
    const stamp = ++this.curStamp;
    const G = this.g, F = this.from, ST = this.stamp;
    const heap = this.heap; heap.clear();
    G[s] = 0; F[s] = -1; ST[s] = stamp;
    heap.push(s, 0);
    let found = false, expanded = 0;
    const CL = this.closedStamp;
    while (heap.size > 0) {
      const c = heap.pop();
      if (c === g) { found = true; break; }
      if (CL[c] === stamp) continue;
      CL[c] = stamp;
      expanded++;
      if (expanded > 30000) break;
      const cx = c % NW, cy = (c / NW) | 0;
      const gc = G[c];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
        const n = ny * NW + nx;
        const cn = costArr[n];
        if (cn >= INF) continue;
        if (d >= 4) {
          // no corner cutting
          if (costArr[cy * NW + nx] >= INF || costArr[ny * NW + cx] >= INF) continue;
        }
        const ng = gc + (costArr[c] + cn) * 0.5 * DIRS[d][2];
        if (CL[n] === stamp) continue;
        if (ST[n] !== stamp || ng < G[n] - 1e-6) {
          ST[n] = stamp; G[n] = ng; F[n] = c;
          const dx = Math.abs(nx - gx), dy = Math.abs(ny - gy);
          const h = (dx > dy ? dx + 0.414 * dy : dy + 0.414 * dx) * hw;
          heap.push(n, ng + h);
        }
      }
    }
    this.budget -= expanded + 50;
    if (!found) { cache.set(key, null); return null; }
    let len = 0;
    for (let c = g; c !== -1; c = F[c]) len++;
    const path = new Int32Array(len);
    let k = len - 1;
    for (let c = g; c !== -1; c = F[c]) path[k--] = c;
    if (cache.size > 40000) cache.clear();
    cache.set(key, path);
    return path;
  }
}

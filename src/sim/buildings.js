// Building instances: placement, occupancy, jobs, removal.
import { STRUCTURES, SD } from '../data/structures.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { TERRAIN, D, T } from '../world/terrain.js';
import { RES_INDEX } from '../data/resources.js';
import { CFG } from '../config.js';

let nextSerial = 1;

export class Building {
  constructor(id, def, civ, town, x, y) {
    this.id = id;
    this.type = def.idx;
    this.def = def;
    this.civ = civ;
    this.town = town;
    this.x = x; this.y = y;
    this.w = def.size[0]; this.h = def.size[1];
    this.maxHp = def.hp;
    this.hp = def.hp * 0.2;
    this.built = false;
    this.progress = 0;
    this.workNeeded = def.work;
    this.workers = [];
    this.residents = [];
    this.slots = {};         // profession idx -> count
    this.slotList = [];
    this.slotTotal = 0;
    this.active = true;
    this.banned = false;
    this.fire = 0;
    this.harvestCache = null;
    this.cacheTick = -1e9;
    this.growth = 0;         // field growth
    this.stored = 0;
    this.ships = 0;
    this.lastDefense = 0;
    this.serial = nextSerial++;
    this.created = 0;
    this.builders = 0;
    this.visitors = 0;
    this.powered = 1;
    this.recipeIdx = 0;
    this.producedToday = 0;
    this.damageTick = -1e9;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  contains(px, py) { return px >= this.x && py >= this.y && px < this.x + this.w && py < this.y + this.h; }
  freeHousing() { return this.built ? Math.max(0, this.capacity - this.residents.length) : 0; }
}

// Resolve '@branch' job slots to the best profession unlocked by this civ.
export function resolveJobs(sim, b) {
  const civ = sim.civs[b.civ];
  const slots = {};
  for (const [key, n] of Object.entries(b.def.jobs)) {
    let pid;
    if (key[0] === '@') pid = civ.bestUnit(key.slice(1));
    else pid = PROF_INDEX[key];
    if (pid === undefined || pid < 0) continue;
    const p = PROFESSIONS[pid];
    if (p.tech && !civ.has(p.tech)) continue;
    if (civ.isBanned(p.id)) continue;
    slots[pid] = (slots[pid] || 0) + n;
  }
  b.slots = slots;
  b.slotList = Object.entries(slots).map(([k, v]) => [+k, v]);
  b.slotTotal = b.slotList.reduce((a, x) => a + x[1], 0);
}

export function placeBuilding(sim, typeIdx, civId, townId, x, y, built = false, rotate = false) {
  const def = STRUCTURES[typeIdx];
  const w = sim.world;
  let id;
  if (sim.freeB.length) id = sim.freeB.pop();
  else id = sim.buildings.length;
  const b = new Building(id, def, civId, townId, x, y);
  if (rotate) { b.w = def.size[1]; b.h = def.size[0]; b.rotated = true; }
  b.created = sim.tick;
  b.capacity = def.housing ? Math.round(def.housing * (1 + sim.civs[civId].mod.housing - 1)) : 0;
  sim.buildings[id] = b;
  for (let py = y; py < y + b.h; py++) for (let px = x; px < x + b.w; px++) {
    const i = py * w.W + px;
    w.bld[i] = id + 1;
    const keepDep = def.harvest && def.harvest.mine;
    if (!keepDep && w.dep[i] !== D.FISH) { w.dep[i] = 0; w.amt[i] = 0; }
    w.recomputeSpeed(i);
    w.markDirty(i);
  }
  sim.nav.markDirty(x, y); sim.nav.markDirty(x + b.w - 1, y + b.h - 1);
  if (townId >= 0) {
    const town = sim.towns[townId];
    town.buildings.push(id);
    if (!built) town.construction.push(id);
  }
  if (built) completeBuilding(sim, b, true);
  sim.renderDirtyBuildings.push(id);
  return b;
}

export function completeBuilding(sim, b, instant = false) {
  b.built = true;
  b.progress = 1;
  b.hp = b.maxHp;
  const town = sim.towns[b.town];
  if (town) {
    const k = town.construction.indexOf(b.id);
    if (k >= 0) town.construction.splice(k, 1);
    town.recount = true;
  }
  resolveJobs(sim, b);
  const def = b.def;
  if (def.center && town) {
    // upgrade: demolish the old center, take its place
    const old = sim.buildings[town.center];
    if (old && old !== b && old.def.center < def.center) {
      town.center = b.id;
      town.level = def.center;
      if (def.upgrades) demolish(sim, old, 'upgraded');
    } else if (!old || !old.built || old === b) { town.center = b.id; town.level = def.center; }
  }
  if (def.unique === 'civ') sim.civs[b.civ].uniques[def.id] = b.id;
  if (sim.everBuilt) sim.everBuilt.add(def.id);
  sim.renderDirtyBuildings.push(b.id);
  if (!instant && sim.onBuildingComplete) sim.onBuildingComplete(b);
}

export function demolish(sim, b, reason = 'demolished') {
  if (!b || sim.buildings[b.id] !== b) return;
  const w = sim.world;
  const P = sim.people;
  for (const pid of b.workers) if (P.alive(pid) && P.work[pid] === b.id) { P.work[pid] = -1; P.prof[pid] = 0; P.color[pid] = 0; }
  for (const pid of b.residents) if (P.alive(pid) && P.home[pid] === b.id) P.home[pid] = -1;
  for (let py = b.y; py < b.y + b.h; py++) for (let px = b.x; px < b.x + b.w; px++) {
    const i = py * w.W + px;
    if (w.bld[i] === b.id + 1) { w.bld[i] = 0; w.recomputeSpeed(i); w.markDirty(i); }
  }
  sim.nav.markDirty(b.x, b.y); sim.nav.markDirty(b.x + b.w - 1, b.y + b.h - 1);
  const town = sim.towns[b.town];
  if (town) {
    let k = town.buildings.indexOf(b.id);
    if (k >= 0) town.buildings.splice(k, 1);
    k = town.construction.indexOf(b.id);
    if (k >= 0) town.construction.splice(k, 1);
    town.recount = true;
    if (town.center === b.id) town.center = -1;
  }
  const civ = sim.civs[b.civ];
  if (civ && civ.uniques[b.def.id] === b.id) delete civ.uniques[b.def.id];
  sim.buildings[b.id] = null;
  sim.freeB.push(b.id);
  sim.removedBuildings.push({ x: b.x, y: b.y, w: b.w, h: b.h, reason });
}

// ---------------------------------------------------------------- placement
export function canPlace(sim, def, x, y, civId) {
  const w = sim.world;
  const bw = def.size[0], bh = def.size[1];
  if (x < 2 || y < 2 || x + bw >= w.W - 2 || y + bh >= w.H - 2) return false;
  const mineLike = !!(def.harvest && def.harvest.mine);
  for (let py = y - 1; py <= y + bh; py++) for (let px = x - 1; px <= x + bw; px++) {
    const i = py * w.W + px;
    if (w.bld[i]) return false;
    const inside = px >= x && py >= y && px < x + bw && py < y + bh;
    if (!inside) continue;
    const td = TERRAIN[w.ter[i]];
    if (td.water && !(def.place === 'shore' && py >= y + bh - 1)) return false;
    if (td.build === 0 && !td.water) return false;
    if (td.build === 2 && !mineLike && def.place !== 'hills') return false;
    if (w.road[i] & 8) return false; // rails
    const own = w.owner[w.terrIdx(px, py)];
    if (own >= 0 && own !== civId) return false;
  }
  return true;
}

// Count deposit pixels of given types in a square around (cx,cy).
export function countDeposits(w, cx, cy, r, types) {
  let n = 0;
  const x0 = Math.max(0, cx - r), x1 = Math.min(w.W - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(w.H - 1, cy + r);
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const d = w.dep[y * w.W + x];
    if (d && types.includes(d)) n++;
  }
  return n * 4;
}

export function footprintFertility(w, x, y, bw, bh) {
  let f = 0, n = 0;
  for (let py = y; py < y + bh; py += 2) for (let px = x; px < x + bw; px += 2) { f += w.fert[py * w.W + px]; n++; }
  return f / n / 255;
}

export function shoreScore(w, x, y, bw, bh) {
  // counts navigable water pixels along the footprint's edge ring
  let n = 0;
  for (let py = y - 2; py <= y + bh + 1; py++) for (let px = x - 2; px <= x + bw + 1; px++) {
    if (px >= x && py >= y && px < x + bw && py < y + bh) continue;
    if (!w.inb(px, py)) continue;
    const t = w.ter[py * w.W + px];
    if (t === T.SHALLOW || t === T.LAKE || t === T.DEEP) n++;
  }
  return n;
}

export function depositTypesForHarvest(def, civ) {
  // Filter mine deposit types by the deposit's reveal tech & the ore's tech.
  if (!def.harvest || !def.harvest.dep) return [];
  return def.harvest.dep.filter((d) => civ.canSeeDeposit(d) && civ.canMineDeposit(d));
}

export { SD, RES_INDEX, CFG };

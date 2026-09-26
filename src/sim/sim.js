// The simulation orchestrator: owns the world, people, buildings, towns and
// civilisations, advances time, and provides shared queries to subsystems.
import { CFG } from '../config.js';
import { seedRandom, mulberry32, rand, randInt, chance, gauss, pick } from '../util/rng.js';
import { World } from '../world/world.js';
import { T, TERRAIN, D, DEPOSITS } from '../world/terrain.js';
import { Nav } from './nav.js';
import { People, S, A } from './people.js';
import { Spatial } from './spatial.js';
import { Animals } from './animals.js';
import { Civ, makeName } from './civ.js';
import { Town } from './towns.js';
import { placeBuilding, demolish, resolveJobs } from './buildings.js';
import { updatePerson, think } from './behavior.js';
import { explore, goTo } from './movement.js';
import { Jobs } from './jobs.js';
import { Lifecycle, inheritBeliefs } from './lifecycle.js';
import { Economy } from './economy.js';
import { Planner } from './planner.js';
import { Research } from './research.js';
import { BeliefSystem } from './beliefsys.js';
import { Diplomacy } from './diplomacy.js';
import { Trade } from './trade.js';
import { Military } from './military.js';
import { Transport } from './transport.js';
import { Events } from './events.js';
import { Settle } from './settle.js';
import { STRUCTURES, SD } from '../data/structures.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { TECHS, TECH_INDEX } from '../data/technologies.js';
import { RESOURCES, R, NRES } from '../data/resources.js';
import { SCALES, NB, B } from '../data/beliefs.js';

const NDEP = DEPOSITS.length;
const P_LABORER = PROF_INDEX.laborer;
const CIV_NAMES = [['Crimson Dominion', 'Crimson'], ['Azure Concord', 'Azure']];
const REBEL_PREFIX = ['Free', 'Verdant', 'Violet', 'Golden', 'Teal', 'Rose', 'Iron'];
const REBEL_SUFFIX = ['Republic', 'Commonwealth', 'League', 'Covenant', 'Union', 'Free Cities', 'Kingdom'];

export class Sim {
  constructor(seed = 7, opts = {}) {
    this.seed = seed;
    this.opts = opts;
    seedRandom(seed * 101 + 3);
    this.nameRng = mulberry32(seed * 977 + 1);
    this.tick = 0; this.day = 0; this.tod = 0.3; this.season = 0; this.year = 1;
    this.world = new World(seed);
    this.world.generate();
    this.nav = new Nav(this.world);
    this.people = new People(opts.maxPeople || CFG.MAX_PEOPLE);
    this.spatial = new Spatial(this.people.cap);
    this.animals = new Animals();
    this.buildings = []; this.freeB = [];
    this.towns = [];
    this.civs = [];
    this.professions = PROFESSIONS;
    this.profSpeed = new Float32Array(PROFESSIONS.length).map((_, k) => {
      const p = PROFESSIONS[k];
      return (p.mil ? p.mil.speed : 1) * (p.speed || 1);
    });
    this.speedCache = new Float32Array(this.people.cap);
    this.bestDist = new Float32Array(this.people.cap).fill(1e9);
    this.wallMap = new Uint8Array(this.world.N);
    this.wallBuildings = new Set();
    this.renderDirtyBuildings = [];
    this.removedBuildings = [];
    this.projectiles = [];
    this.deaths = [];
    this.saplings = [];
    this.chronicleLog = [];
    this.shipByPerson = new Map();
    this.weatherFarm = 1;
    this.researchCostMul = opts.researchCostMul || 1;
    this.RES_COINS = R('coins');
    this.depRes = DEPOSITS.map((d) => (d.res ? R(d.res) : -1));
    this.territoryDirty = true;
    this.borders = new Float32Array(64);
    this.history = [];
    this.everBuilt = new Set();
    this.everProf = new Set([P_LABORER]);
    // subsystems
    this.jobs = new Jobs(this);
    this.lifecycle = new Lifecycle(this);
    this.economy = new Economy(this);
    this.logistics = this.economy;
    this.planner = new Planner(this);
    this.research = new Research(this);
    this.beliefs = new BeliefSystem(this);
    this.diplomacy = new Diplomacy(this);
    this.trade = new Trade(this);
    this.military = new Military(this);
    this.transport = new Transport(this);
    this.events = new Events(this);
    this.settle = new Settle(this);
    this.buildDepositIndex();
    this.auraH = new Float32Array(CFG.CIV_COLORS.length * this.nav.N);
    this.auraDis = new Float32Array(CFG.CIV_COLORS.length * this.nav.N);
    this.regrowCursor = 0;
    this.regrowQueue = [];
    this.setup();
  }

  // ------------------------------------------------------------ setup
  setup() {
    const rng = mulberry32(this.seed * 31 + 7);
    const w = this.world;
    const starts = [w.findStart(0.1, 0.4, rng), w.findStart(0.6, 0.9, rng)];
    for (let c = 0; c < 2; c++) {
      const civ = new Civ(c, CIV_NAMES[c][0], CFG.CIV_COLORS[c], starts[c].x);
      civ.adjective = CIV_NAMES[c][1];
      this.civs.push(civ);
      for (const t of TECHS) if (t.start) civ.learn(t.idx, 0);
      // each culture starts with its own leanings
      civ.seedBeliefs = new Float32Array(NB);
      for (let s = 0; s < NB; s++) civ.seedBeliefs[s] = gauss() * 22;
      // exaggerate a few defining traits
      for (let k = 0; k < 6; k++) civ.seedBeliefs[randInt(NB)] += (chance(0.5) ? 1 : -1) * 30;
      const st = starts[c];
      this.foundInitialTown(civ, st.x, st.y);
    }
    this.animals.populate(this.world, 1400);
    this.census();
    this.beliefs.daily();
    for (const civ of this.civs) { civ.recomputeMods(); this.research.choose(civ); civ.computeGovernment(); }
    this.computeTerritory();
    this.computeAuras();
    this.chronicle('The world is young. Two peoples awaken on opposite shores of a great continent.', -1, 'era');
  }

  foundInitialTown(civ, x, y) {
    const town = this.createTown(civ, x, y);
    const place = (id, dx, dy, built = true) => {
      const def = SD(id);
      for (let t = 0; t < 200; t++) {
        const r = t * 0.25;
        const xx = Math.round(x + dx + (rand() - 0.5) * r - def.size[0] / 2), yy = Math.round(y + dy + (rand() - 0.5) * r - def.size[1] / 2);
        if (this.canPlaceQuiet(def, xx, yy, civ.id)) return placeBuilding(this, def.idx, civ.id, town.id, xx, yy, built);
      }
      return null;
    };
    const center = place('campfire', 0, 0);
    if (center) { town.center = center.id; town.level = 1; }
    for (let k = 0; k < 7; k++) place('hut', Math.cos(k * 0.9) * 10, Math.sin(k * 0.9) * 10);
    place('gatherer_camp', 16, -8);
    place('lumber_camp', -16, 10);
    town.add(R('berries'), 500); town.add(R('grain'), 400); town.add(R('wood'), 120); town.add(R('meat'), 80);
    // explored surroundings
    const c0 = this.nav.cellOf(x, y);
    const cx = c0 % CFG.NW, cy = (c0 / CFG.NW) | 0;
    for (let oy = -14; oy <= 14; oy++) for (let ox = -14; ox <= 14; ox++) {
      if (ox * ox + oy * oy > 196) continue;
      const xx = cx + ox, yy = cy + oy;
      if (xx < 0 || yy < 0 || xx >= CFG.NW || yy >= CFG.NH) continue;
      const c = yy * CFG.NW + xx;
      if (!civ.explored[c]) { civ.explored[c] = 1; civ.exploredCount++; }
    }
    // people
    const n = this.opts.startPop || CFG.START_POP;
    const made = [];
    for (let k = 0; k < n; k++) {
      const i = this.people.alloc();
      if (i < 0) break;
      const P = this.people;
      P.civ[i] = civ.id; P.town[i] = town.id;
      P.x[i] = x + (rand() - 0.5) * 24; P.y[i] = y + (rand() - 0.5) * 24;
      if (this.world.speedAt(P.x[i], P.y[i]) === 0) { P.x[i] = x; P.y[i] = y; }
      const r = rand();
      P.age[i] = r < 0.3 ? rand() * 14 : r < 0.9 ? 14 + rand() * 26 : 40 + rand() * 25;
      P.sex[i] = rand() < 0.5 ? 1 : 0;
      P.health[i] = 90 + rand() * 10; P.food[i] = 90; P.happy[i] = 60; P.loyalty[i] = 70;
      P.name[i] = (this.nameRng() * 2 ** 31) | 0;
      for (let s = 0; s < NB; s++) P.setB(i, s, Math.round(civ.seedBeliefs[s] + gauss() * 20));
      P.prof[i] = P_LABORER;
      civ.profCount[P_LABORER]++;
      this.speedCache[i] = this.computeSpeed(i);
      made.push(i);
    }
    // pair up couples
    const adults = made.filter((i) => this.people.age[i] >= 16);
    const men = adults.filter((i) => this.people.sex[i] === 0), women = adults.filter((i) => this.people.sex[i] === 1);
    for (let k = 0; k < Math.min(men.length, women.length) * 0.7; k++) { this.people.partner[men[k]] = women[k]; this.people.partner[women[k]] = men[k]; }
    return town;
  }

  canPlaceQuiet(def, x, y, civId) {
    const w = this.world;
    for (let py = y - 1; py <= y + def.size[1]; py++) for (let px = x - 1; px <= x + def.size[0]; px++) {
      if (!w.inb(px, py)) return false;
      const i = py * w.W + px;
      if (w.bld[i]) return false;
      if (px >= x && py >= y && px < x + def.size[0] && py < y + def.size[1] && TERRAIN[w.ter[i]].build !== 1) return false;
    }
    return true;
  }

  createTown(civ, x, y) {
    const id = this.towns.length;
    const name = makeName(this.nameRng, civ.nameSet, 2) + (this.nameRng() < 0.3 ? makeName(this.nameRng, civ.nameSet, 1).toLowerCase() : '');
    const t = new Town(id, civ.id, name, x, y);
    t.founded = this.tick;
    t.residentsList = [];
    t.feedRatio = 1;
    t.passivePower = 0;
    t.coastal = !!this.nav.coastal[this.nav.cellOf(x, y)] || this.nearWater(x, y, 40);
    t.origCiv = civ.id;
    this.towns.push(t);
    civ.towns.push(id);
    if (civ.capital < 0) { civ.capital = id; t.isCapital = true; }
    this.territoryDirty = true;
    return t;
  }

  nearWater(x, y, r) {
    for (let k = 0; k < 60; k++) {
      const c = this.nav.cellOf(x + (rand() - 0.5) * 2 * r, y + (rand() - 0.5) * 2 * r);
      if (this.nav.wcost[c] < 1e9) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ deposits
  buildDepositIndex() {
    const w = this.world;
    this.cellDep = new Uint16Array(this.nav.N * NDEP);
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const d = w.dep[y * w.W + x];
      if (!d) continue;
      const c = ((y / CFG.NAV) | 0) * CFG.NW + ((x / CFG.NAV) | 0);
      this.cellDep[c * NDEP + d]++;
    }
  }
  cellDepCount(c, d) { return this.cellDep[c * NDEP + d]; }

  depleteDeposit(p) {
    const w = this.world;
    const d = w.dep[p];
    if (d === D.BERRY || d === D.FISH || d === D.HERBS || d === D.SPICE || d === D.COTTON || d === D.CLAY) {
      // renewables come back; floods lay fresh clay along the rivers each year
      w.amt[p] = 0; w.markDirty(p);
      this.regrowQueue.push(p, this.day + (d === D.FISH ? 3 : d === D.BERRY ? 4 : d === D.CLAY ? 12 : 6));
      return;
    }
    const c = ((((p / w.W) | 0) / CFG.NAV) | 0) * CFG.NW + (((p % w.W) / CFG.NAV) | 0);
    if (d && this.cellDep[c * NDEP + d] > 0) this.cellDep[c * NDEP + d]--;
    w.dep[p] = 0; w.amt[p] = 0;
    w.recomputeSpeed(p);
    w.markDirty(p);
  }

  addDeposit(p, d, amt) {
    const w = this.world;
    const c = ((((p / w.W) | 0) / CFG.NAV) | 0) * CFG.NW + (((p % w.W) / CFG.NAV) | 0);
    if (w.dep[p] && w.dep[p] !== d && this.cellDep[c * NDEP + w.dep[p]] > 0) this.cellDep[c * NDEP + w.dep[p]]--;
    if (w.dep[p] !== d) this.cellDep[c * NDEP + d]++;
    w.dep[p] = d; w.amt[p] = amt;
    w.recomputeSpeed(p);
    w.markDirty(p);
  }

  // Cells within r of (cx,cy) containing any of `types` (explored by civ).
  findDepositCells(cx, cy, r, types, civ, max = 8) {
    const out = [];
    const r0 = Math.ceil(r / CFG.NAV);
    const ccx = (cx / CFG.NAV) | 0, ccy = (cy / CFG.NAV) | 0;
    const cands = [];
    for (let oy = -r0; oy <= r0; oy++) for (let ox = -r0; ox <= r0; ox++) {
      const x = ccx + ox, y = ccy + oy;
      if (x < 0 || y < 0 || x >= CFG.NW || y >= CFG.NH) continue;
      const d2 = ox * ox + oy * oy;
      if (d2 > r0 * r0) continue;
      const c = y * CFG.NW + x;
      if (civ && !civ.explored[c]) continue;
      let n = 0;
      for (const t of types) n += this.cellDep[c * NDEP + t];
      if (n >= 3) cands.push({ c, s: n - Math.sqrt(d2) * 1.5 + rand() * 6 });
    }
    cands.sort((a, b) => b.s - a.s);
    for (let k = 0; k < Math.min(max, cands.length); k++) out.push(cands[k].c);
    return out;
  }

  findDepositNear(x, y, r, types, nonzero) {
    const w = this.world;
    const cells = this.findDepositCells(x, y, r, types, null, 14);
    if (!cells.length) return -1;
    // try cells from nearest outwards (with a little randomness) until one has ripe deposits
    const start = randInt(Math.min(3, cells.length));
    for (let k = 0; k < cells.length; k++) {
      const c = cells[(start + k) % cells.length];
      const x0 = (c % CFG.NW) * CFG.NAV, y0 = ((c / CFG.NW) | 0) * CFG.NAV;
      for (let t = 0; t < 24; t++) {
        const px = x0 + randInt(CFG.NAV), py = y0 + randInt(CFG.NAV);
        if (!w.inb(px, py)) continue;
        const p = py * w.W + px;
        if (types.includes(w.dep[p]) && (!nonzero || w.amt[p] > 0) && !w.bld[p]) return p;
      }
    }
    return -1;
  }

  pickHarvestPixel(b, x, y) {
    const w = this.world;
    const civ = this.civs[b.civ];
    if (!b.harvestCache || this.tick - b.cacheTick > CFG.TICKS_PER_DAY * 2 || b.harvestCache.length < 3) {
      const types = b.def.harvest.dep.filter((d) => civ.canSeeDeposit(d) && civ.canMineDeposit(d));
      const r = b.def.harvest.radius;
      const cx = b.cx | 0, cy = b.cy | 0;
      const list = [];
      const step = r > 30 ? 2 : 1;
      for (let py = Math.max(0, cy - r); py <= Math.min(w.H - 1, cy + r); py += step) for (let px = Math.max(0, cx - r); px <= Math.min(w.W - 1, cx + r); px += step) {
        const dd = (px - cx) ** 2 + (py - cy) ** 2;
        if (dd > r * r) continue;
        const p = py * w.W + px;
        if (types.includes(w.dep[p]) && w.amt[p] > 0) {
          const own = w.owner[w.terrIdx(px, py)];
          if (own >= 0 && own !== b.civ) continue;
          list.push(p, dd);
        }
      }
      // sort by distance
      const idx = [];
      for (let k = 0; k < list.length; k += 2) idx.push(k);
      idx.sort((a, c) => list[a + 1] - list[c + 1]);
      b.harvestCache = idx.slice(0, 400).map((k) => list[k]);
      b.cacheTick = this.tick;
      if (!b.harvestCache.length) return -1;
    }
    const cache = b.harvestCache;
    for (let t = 0; t < 12 && cache.length; t++) {
      const k = randInt(Math.min(cache.length, 18));
      const p = cache[k];
      if (w.dep[p] && w.amt[p] > 0) return p;
      cache.splice(k, 1);
    }
    return -1;
  }

  shorePixel(tx, ty, px, py) {
    const w = this.world;
    let best = -1, bd = 1e9;
    for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
      const x = tx + ox, y = ty + oy;
      if (!w.inb(x, y)) continue;
      const p = y * w.W + x;
      if (w.speedQ[p] === 0) continue;
      const d = ox * ox + oy * oy + ((x - px) ** 2 + (y - py) ** 2) * 0.001;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  buildingFertility(b) {
    const w = this.world;
    let f = 0, n = 0;
    for (let y = b.y; y < b.y + b.h; y += 2) for (let x = b.x; x < b.x + b.w; x += 2) { f += w.fert[y * w.W + x]; n++; }
    return Math.min(1.2, f / n / 200);
  }

  civKnowsDeposit(civ, resId) {
    const d = DEPOSITS.findIndex((x) => x.res === resId);
    if (d < 0) return false;
    if (!civ.canSeeDeposit(d)) return false;
    if (!civ.knownDep || this.day !== civ.knownDepDay) {
      civ.knownDep = new Uint8Array(NDEP);
      civ.knownDepDay = this.day;
      const N = this.nav.N;
      for (let c = 0; c < N; c++) {
        if (!civ.explored[c]) continue;
        const o = c * NDEP;
        for (let k = 1; k < NDEP; k++) if (this.cellDep[o + k]) civ.knownDep[k] = 1;
      }
    }
    return civ.knownDep[d] === 1;
  }

  // ------------------------------------------------------------ people helpers
  computeSpeed(i) {
    const P = this.people;
    const civ = this.civs[P.civ[i]];
    let s = CFG.BASE_SPEED * (civ ? civ.mod.move : 1);
    const age = P.age[i];
    if (age < 8) s *= 0.7; else if (age > 65) s *= 0.75;
    if (P.health[i] < 40) s *= 0.6;
    s *= this.profSpeed[P.prof[i]];
    if (civ && civ.flags.horses && (PROFESSIONS[P.prof[i]].kind === 'porter' || PROFESSIONS[P.prof[i]].kind === 'trader' || PROFESSIONS[P.prof[i]].kind === 'diplomat')) s *= 1.3;
    return s;
  }

  workSpeed(i) {
    const P = this.people;
    const h = P.happy[i];
    let s = 0.55 + h * 0.008;
    if (P.health[i] < 50) s *= 0.7;
    if (P.food[i] < 20) s *= 0.7;
    return s * (1 + P.b(i, B.DILIGENCE) * 0.002);
  }

  personName(i) {
    const P = this.people;
    const r = mulberry32(P.name[i] >>> 0);
    const civ = this.civs[P.civ[i]] || this.civs[0];
    const set = civ ? civ.nameSet : 0;
    return makeName(r, set, 1 + (r() < 0.6 ? 1 : 0)) + ' ' + makeName(r, set, 2);
  }

  birth(m) {
    const P = this.people;
    const i = P.alloc();
    if (i < 0) return -1;
    const civ = this.civs[P.civ[m]];
    P.civ[i] = P.civ[m]; P.town[i] = P.town[m];
    P.x[i] = P.x[m]; P.y[i] = P.y[m];
    P.age[i] = 0; P.sex[i] = rand() < 0.5 ? 1 : 0;
    P.mother[i] = m; P.father[i] = P.partner[m];
    P.health[i] = 90; P.food[i] = 80; P.happy[i] = 60; P.loyalty[i] = 70;
    P.name[i] = (this.nameRng() * 2 ** 31) | 0;
    P.prof[i] = P_LABORER;
    P.born[i] = this.tick;
    civ.profCount[P_LABORER]++;
    inheritBeliefs(this, i, m, P.partner[m]);
    const kids = P.flags[m] >> 5;
    if (kids < 7) P.flags[m] = (P.flags[m] & 31) | ((kids + 1) << 5);
    if (P.home[m] >= 0) this.jobs.moveIn(i, this.buildings[P.home[m]]);
    this.speedCache[i] = this.computeSpeed(i);
    civ.stats.born++;
    const town = this.towns[P.town[i]];
    if (town) town.residentsList.push(i);
    return i;
  }

  kill(i, cause) {
    const P = this.people;
    if (P.civ[i] < 0) return;
    const civ = this.civs[P.civ[i]];
    if (P.work[i] >= 0) { const b = this.buildings[P.work[i]]; if (b) { const k = b.workers.indexOf(i); if (k >= 0) b.workers.splice(k, 1); } }
    if (P.home[i] >= 0) { const b = this.buildings[P.home[i]]; if (b) { const k = b.residents.indexOf(i); if (k >= 0) b.residents.splice(k, 1); } }
    const pt = P.partner[i];
    if (pt >= 0 && P.partner[pt] === i) P.partner[pt] = -1;
    if ((P.flags[i] & 16) && P.skill[i] >= 99) this.chronicle(`${this.personName(i)}, a celebrated figure of ${civ.name}, dies (${cause}) aged ${Math.floor(P.age[i])}.`, civ.id, 'death', -1);
    civ.stats.died++;
    civ.profCount[P.prof[i]]--;
    this.shipByPerson.delete(i);
    this.deaths.push({ x: P.x[i], y: P.y[i], t: this.tick, civ: civ.id });
    if (this.deaths.length > 300) this.deaths.splice(0, this.deaths.length - 300);
    if (this.selected === i) this.selectedDeath = { cause, name: this.personName(i), age: P.age[i] };
    P.release(i);
  }

  accident(i, cause) { this.kill(i, cause); }

  heal(i, j) {
    const P = this.people;
    const civ = this.civs[P.civ[i]];
    const prof = PROFESSIONS[P.prof[i]];
    const town = this.towns[P.town[i]];
    let power = (prof.fx.health || 1) * civ.mod.health * (0.7 + P.skill[i] / 100);
    if (town && town.stock[R('medicine')] > 0.5) { town.take(R('medicine'), 0.2); power *= 1.8; }
    P.health[j] = Math.min(100, P.health[j] + 8 * power);
    if (P.sick[j] > 0 && chance(0.12 * power)) { P.sick[j] = 0; P.immune[j] = 4; }
    P.skill[i] = Math.min(100, P.skill[i] + 0.5);
    P.pushB(i, B.EMPATHY, 0.5);
    P.pushB(j, B.EMPATHY, 0.5);
  }

  transferTown(i, town) {
    const P = this.people;
    if (P.work[i] >= 0) { const b = this.buildings[P.work[i]]; if (!b || b.town !== town.id) this.jobs.setProf(i, P_LABORER, -1); }
    if (P.home[i] >= 0) { const b = this.buildings[P.home[i]]; if (!b || b.town !== town.id) this.jobs.leaveHome(i); }
    P.town[i] = town.id;
  }

  changeCiv(i, civId) {
    const P = this.people;
    const old = this.civs[P.civ[i]];
    if (P.work[i] >= 0) { const b = this.buildings[P.work[i]]; if (!b || b.civ !== civId) this.jobs.setProf(i, P_LABORER, -1); }
    if (old) old.profCount[P.prof[i]]--;
    P.civ[i] = civId;
    this.civs[civId].profCount[P.prof[i]]++;
    P.color[i] = 0;
    P.army[i] = -1;
    this.speedCache[i] = this.computeSpeed(i);
  }

  migrateArrive(i) {
    const P = this.people;
    const town = this.towns[P.target[i]];
    P.state[i] = S.IDLE;
    if (!town || !town.alive) return;
    const from = this.civs[P.civ[i]], to = this.civs[town.civ];
    if (from === to) { this.transferTown(i, town); return; }
    if (to.beliefAvg[B.HOSPITALITY] < -40 || this.military.atWarBetween(from.id, to.id)) {
      // turned away at the border: go home
      const home = this.nearestTownOfCiv(from.id, P.x[i], P.y[i]);
      if (home) { this.transferTown(i, home); goTo(this, i, home.cx, home.cy, A.WANDER); }
      return;
    }
    this.jobs.leaveHome(i);
    this.changeCiv(i, to.id);
    this.transferTown(i, town);
    P.loyalty[i] = 50;
    from.stats.emigrated++; to.stats.immigrated++;
    this.emigrations = (this.emigrations || 0) + 1;
    if (this.emigrations % 25 === 1) this.chronicle(`Emigrants leave ${from.name} for a better life in ${to.name}.`, to.id, 'migration');
  }

  nearestTownOfCiv(civId, x, y, exclude = -1) {
    const civ = this.civs[civId];
    if (!civ) return null;
    let best = null, bd = 1e18;
    for (const tid of civ.towns) {
      if (tid === exclude) continue;
      const t = this.towns[tid];
      if (!t || !t.alive) continue;
      const d = (t.cx - x) ** 2 + (t.cy - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  nearestForeignTown(civId, x, y, r) {
    let best = null, bd = r * r;
    for (const t of this.towns) {
      if (!t || !t.alive || t.civ === civId) continue;
      const d = (t.cx - x) ** 2 + (t.cy - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  findBuildingOfType(town, id) {
    for (const bid of town.buildings) { const b = this.buildings[bid]; if (b && b.built && b.def.id === id) return b; }
    return null;
  }

  anyUnderConstruction(civ, typeIdx) {
    for (const tid of civ.towns) { const t = this.towns[tid]; if (!t) continue; for (const id of t.construction) { const b = this.buildings[id]; if (b && b.type === typeIdx) return true; } }
    return false;
  }

  checkContact(i) {
    const P = this.people;
    const c = P.civ[i];
    const own = this.world.ownerAt(P.x[i] | 0, P.y[i] | 0);
    if (own >= 0 && own !== c) this.diplomacy.makeContact(c, own);
    this.spatial.query(P.x[i], P.y[i], 30, (j) => {
      if (P.civ[j] >= 0 && P.civ[j] !== c) { this.diplomacy.makeContact(c, P.civ[j]); return true; }
      return false;
    });
  }

  projectile(x0, y0, x1, y1, kind) {
    if (this.projectiles.length > 600) return;
    this.projectiles.push({ x0, y0, x1, y1, t: 0, kind, dur: kind === 0 ? 6 : 10 });
  }

  civFoodDays(civ) {
    let f = 0, n = 0;
    for (const tid of civ.towns) { const t = this.towns[tid]; if (t) { f += t.foodDays * t.pop; n += t.pop; } }
    return n ? f / n : 99;
  }
  civSickRatio(civ) {
    let s = 0;
    for (const tid of civ.towns) { const t = this.towns[tid]; if (t) s += t.sick; }
    return civ.pop ? s / civ.pop : 0;
  }

  auraHappy(x, y, civId) { return this.auraH[civId * this.nav.N + this.nav.cellOf(x, y)]; }
  auraDisease(x, y, civId) { return this.auraDis[civId * this.nav.N + this.nav.cellOf(x, y)]; }

  setWall(b, on) {
    const w = this.world;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) this.wallMap[y * w.W + x] = on ? b.civ + 1 : 0;
    if (on) this.wallBuildings.add(b.id); else this.wallBuildings.delete(b.id);
  }

  destroyBuilding(b, reason) {
    if (!b) return;
    if (this.wallBuildings.has(b.id)) this.setWall(b, false);
    if (b.def.cat === 'wonder' || b.def.unique) this.chronicle(`The ${b.def.name} of ${this.civs[b.civ].name} is destroyed (${reason}).`, b.civ, 'disaster');
    demolish(this, b, reason);
  }

  // ------------------------------------------------------------ chronicle
  chronicle(text, civ = -1, kind = 'info', person = -1) {
    const e = { tick: this.tick, year: this.year, season: this.season, text, civ, kind, person };
    if (person >= 0 && this.people.civ[person] >= 0) { e.x = this.people.x[person]; e.y = this.people.y[person]; }
    else {
      // locate the event at the first town it mentions
      for (const t of this.towns) if (t && text.includes(t.name)) { const c = this.buildings[t.center]; e.x = c ? c.cx : t.cx; e.y = c ? c.cy : t.cy; break; }
    }
    this.chronicleLog.push(e);
    if (this.chronicleLog.length > 600) this.chronicleLog.splice(0, this.chronicleLog.length - 600);
    if (this.onChronicle) this.onChronicle(e);
  }

  onTechLearned(civ, t, how) {
    this.chronicle(`${civ.name} ${how === 'espionage' ? 'acquires' : 'discovers'} ${t.name}.`, civ.id, 'tech');
    // refresh job slots (new unit types, recipes)
    for (const tid of civ.towns) { const town = this.towns[tid]; if (!town) continue; for (const id of town.buildings) { const b = this.buildings[id]; if (b && b.built) resolveJobs(this, b); } }
    for (let i = 0; i < this.people.hwm; i++) if (this.people.civ[i] === civ.id) this.speedCache[i] = this.computeSpeed(i);
    if (t.fx.research) this.beliefs.shock(civ.id, B.CURIOSITY, 1, 0.15);
    if (t.id === 'printing') this.beliefs.shock(civ.id, B.SCHOLARSHIP, 3, 0.3);
    if (t.id === 'industrialization') this.beliefs.shock(civ.id, B.NATURE, -3, 0.3);
    if (t.id === 'ecology') this.beliefs.shock(civ.id, B.NATURE, 4, 0.3);
    if (t.id === 'democracy') this.beliefs.shock(civ.id, B.AUTHORITY, -4, 0.3);
    if (t.id === 'scientific_method') this.beliefs.shock(civ.id, B.REASON, 3, 0.3);
    if (t.id === 'transcendence') this.chronicle(`✦ ${civ.name} achieves Transcendence — the apex of civilisation!`, civ.id, 'era');
  }

  onBan(civ, id, added) {
    const why = civ.banReasons[id] || '';
    const isTech = id.startsWith('tech:');
    const name = isTech ? TECHS[TECH_INDEX[id.slice(5)]].name : (STRUCTURES.find((s) => s.id === id) || PROFESSIONS.find((p) => p.id === id) || { name: id }).name;
    if (added) this.chronicle(`${civ.name} outlaws ${isTech ? 'research into ' : ''}${name}${why ? ' (' + why + ')' : ''}.`, civ.id, 'law');
    else this.chronicle(`${civ.name} lifts its ban on ${name}.`, civ.id, 'law');
    for (const tid of civ.towns) {
      const town = this.towns[tid];
      if (!town) continue;
      for (const bid of town.buildings) {
        const b = this.buildings[bid];
        if (!b) continue;
        if (b.def.id === id) b.banned = added;
        if (b.built) resolveJobs(this, b);
      }
    }
    if (!isTech && PROF_INDEX[id] !== undefined && added) {
      const pid = PROF_INDEX[id];
      for (let i = 0; i < this.people.hwm; i++) if (this.people.civ[i] === civ.id && this.people.prof[i] === pid) this.jobs.setProf(i, P_LABORER, -1);
    }
    if (isTech && added && civ.researching === TECH_INDEX[id.slice(5)]) civ.researching = -1;
  }

  onBuildingComplete(b) {
    const civ = this.civs[b.civ];
    const town = this.towns[b.town];
    if (b.def.wall) this.setWall(b, true);
    if (b.def.cat === 'wonder') this.chronicle(`🏛 ${civ.name} completes the ${b.def.name}${town ? ' in ' + town.name : ''}!`, civ.id, 'wonder');
    else if (civ.structCount[b.type] === 0 && !['hut', 'farm', 'palisade', 'stone_wall'].includes(b.def.id)) this.chronicle(`${civ.name} builds its first ${b.def.name}${town ? ' in ' + town.name : ''}.`, civ.id, 'build');
    civ.structCount[b.type]++;
    civ.stats.built++;
    this.everBuilt.add(b.def.id);
    if (b.def.center && b.def.center >= 2 && town) this.chronicle(`${town.name} raises a ${b.def.name}.`, civ.id, 'build');
  }

  // ------------------------------------------------------------ civ lifecycle
  relocateCapital(civ) {
    let best = null;
    for (const tid of civ.towns) { const t = this.towns[tid]; if (t && t.alive && (!best || t.pop > best.pop)) best = t; }
    if (!best) { civ.capital = -1; return; }
    for (const tid of civ.towns) { const t = this.towns[tid]; if (t) t.isCapital = false; }
    civ.capital = best.id; best.isCapital = true;
    this.chronicle(`${civ.name} moves its capital to ${best.name}.`, civ.id, 'government');
  }

  eliminateCiv(civ, by) {
    civ.alive = false;
    this.chronicle(`${civ.name} has fallen${by ? ' to ' + by.name : ''}. Its people scatter or submit.`, civ.id, 'conquest');
    const P = this.people;
    for (let i = 0; i < P.hwm; i++) {
      if (P.civ[i] !== civ.id) continue;
      if (by) {
        const t = this.nearestTownOfCiv(by.id, P.x[i], P.y[i]);
        this.changeCiv(i, by.id);
        if (t) this.transferTown(i, t);
        P.loyalty[i] = 15;
      } else this.kill(i, 'the collapse of civilisation');
    }
    for (const p of this.diplomacy.pairs.values()) if (p.a === civ.id || p.b === civ.id) p.war = false;
    this.military.refreshWarCache();
  }

  secede(town) {
    const parent = this.civs[town.civ];
    const orig = this.civs[town.origCiv];
    if (orig && !orig.alive && town.origCiv !== town.civ) { this.restoreCiv(orig, town); return; }
    const id = this.civs.length;
    if (id >= CFG.CIV_COLORS.length) return;
    const name = `${REBEL_PREFIX[id % REBEL_PREFIX.length]} ${REBEL_SUFFIX[randInt(REBEL_SUFFIX.length)]} of ${town.name}`;
    const civ = new Civ(id, name, CFG.CIV_COLORS[id], town.cx);
    civ.adjective = town.name;
    civ.nameSet = 2 + (id % 2);
    civ.parent = parent.id;
    civ.founded = this.tick;
    for (let t = 0; t < TECHS.length; t++) if (parent.techs[t]) civ.learn(t, this.year);
    civ.explored.set(parent.explored); civ.exploredCount = parent.exploredCount;
    civ.contact[parent.id] = 1; parent.contact[id] = 1;
    for (const o of this.civs) if (o.alive && parent.contact[o.id]) { civ.contact[o.id] = 1; o.contact[id] = 1; }
    this.civs.push(civ);
    // transfer the town
    parent.towns = parent.towns.filter((t) => t !== town.id);
    civ.towns.push(town.id);
    civ.capital = town.id;
    town.civ = id; town.isCapital = true;
    town.shipments = [];
    for (const bid of town.buildings) { const b = this.buildings[bid]; if (b) { b.civ = id; this.renderDirtyBuildings.push(bid); if (this.wallBuildings.has(bid)) this.setWall(b, true); } }
    const P = this.people;
    for (let i = 0; i < P.hwm; i++) if (P.civ[i] === parent.id && P.town[i] === town.id) { this.changeCiv(i, id); P.loyalty[i] = 70; }
    this.beliefs.daily();
    civ.recomputeMods();
    this.research.choose(civ);
    civ.relations[parent.id] = parent.relations[id] = -55;
    this.diplomacy.pair(parent.id, id).grudge = 30;
    this.territoryDirty = true;
    this.chronicle(`⚑ ${town.name} rebels against ${parent.name} and declares independence as the ${name}!`, id, 'rebellion');
    if (parent.beliefAvg[B.AUTHORITY] > 0 || parent.beliefAvg[B.AGGRESSION] > 0) this.diplomacy.declareWar(parent, civ, this.diplomacy.pair(parent.id, id));
    this.military.refreshWarCache();
  }

  // A conquered people rises again in one of its old towns.
  restoreCiv(civ, town) {
    const parent = this.civs[town.civ];
    civ.alive = true;
    civ.towns = [town.id];
    civ.capital = town.id;
    for (let t = 0; t < TECHS.length; t++) if (parent.techs[t] && !civ.techs[t]) civ.learn(t, this.year);
    parent.towns = parent.towns.filter((t) => t !== town.id);
    town.civ = civ.id; town.isCapital = true; town.shipments = [];
    for (const bid of town.buildings) { const b = this.buildings[bid]; if (b) { b.civ = civ.id; this.renderDirtyBuildings.push(bid); if (this.wallBuildings.has(bid)) this.setWall(b, true); } }
    const P = this.people;
    for (let i = 0; i < P.hwm; i++) if (P.civ[i] === parent.id && P.town[i] === town.id) { this.changeCiv(i, civ.id); P.loyalty[i] = 80; }
    civ.contact[parent.id] = 1; parent.contact[civ.id] = 1;
    civ.relations[parent.id] = parent.relations[civ.id] = -70;
    const pr = this.diplomacy.pair(parent.id, civ.id);
    pr.war = false; pr.grudge = 40;
    this.beliefs.daily();
    civ.recomputeMods();
    this.research.choose(civ);
    this.territoryDirty = true;
    this.chronicle(`⚑ ${town.name} throws off the rule of ${parent.name} — the ${civ.name} is reborn!`, civ.id, 'rebellion');
    this.diplomacy.declareWar(parent, civ, pr);
    this.military.refreshWarCache();
  }

  // ------------------------------------------------------------ periodic
  census() {
    const P = this.people;
    for (const t of this.towns) {
      if (!t) continue;
      t.residentsList = []; t.pop = 0; t.adults = 0; t.children = 0; t.sick = 0; t.idle = 0; t.happySum = 0; t.loyaltySum = 0;
    }
    for (const c of this.civs) { c.pop = 0; c.adults = 0; c.children = 0; c.soldiers = 0; c.elders = 0; c.profCount.fill(0); c.happySum = 0; c.healthSum = 0; }
    for (let i = 0; i < P.hwm; i++) {
      const c = P.civ[i];
      if (c < 0) continue;
      const civ = this.civs[c];
      const t = this.towns[P.town[i]];
      civ.pop++;
      civ.profCount[P.prof[i]]++;
      civ.happySum += P.happy[i]; civ.healthSum += P.health[i];
      const adult = P.age[i] >= CFG.ADULT_AGE;
      if (adult) civ.adults++; else civ.children++;
      if (P.age[i] >= CFG.ELDER_AGE) civ.elders++;
      const p = PROFESSIONS[P.prof[i]];
      if (p.kind === 'military') civ.soldiers++;
      if (t) {
        t.residentsList.push(i); t.pop++;
        if (adult) t.adults++; else t.children++;
        if (P.sick[i] > 0) t.sick++;
        if (adult && P.work[i] < 0 && P.age[i] < CFG.ELDER_AGE) t.idle++;
        t.happySum += P.happy[i]; t.loyaltySum += P.loyalty[i];
      }
    }
    for (const c of this.civs) {
      c.happiness = c.pop ? c.happySum / c.pop : 0;
      c.health = c.pop ? c.healthSum / c.pop : 0;
      c.structCount.fill(0);
      c.stockTotal.fill(0);
    }
    for (const t of this.towns) {
      if (!t || !t.alive) continue;
      t.happiness = t.pop ? t.happySum / t.pop : 60;
      t.loyalty = t.pop ? t.loyaltySum / t.pop : 60;
      let hcap = 0, cap = 0, pdem = 0, ppas = 0, poll = 0, solar = false, open = 0;
      const civ = this.civs[t.civ];
      for (const id of t.buildings) {
        const b = this.buildings[id];
        if (!b) continue;
        if (b.built) {
          civ.structCount[b.type]++;
          hcap += b.capacity || 0;
          cap += b.def.storage || 0;
          pdem += b.def.powerUse || 0;
          if (b.def.power && b.workers.length) { ppas += b.def.power; if (b.def.solar) solar = true; }
          poll += b.def.fx.pollution || 0;
          // count unfilled civilian jobs only (soldier / envoy slots wait on policy, not labour)
          if (b.slotTotal > b.workers.length) {
            for (const [pid, n] of b.slotList) {
              const k = PROFESSIONS[pid].kind;
              if (k === 'military' || k === 'watchman' || k === 'trader' || k === 'diplomat' || k === 'spy' || k === 'missionary') continue;
              let have = 0;
              for (const w of b.workers) if (this.people.prof[w] === pid) have++;
              open += Math.max(0, n - have);
            }
          }
        }
      }
      t.housingCap = hcap;
      t.openJobs = open;
      t.capacity = 200 + cap * civ.mod.storage;
      t.powerDemand = pdem;
      t.passivePower = ppas;
      t.solarFactor = solar ? (this.tod > 0.25 && this.tod < 0.8 ? 1 : 0.2) : 1;
      t.pollution = Math.max(0, poll * civ.mod.pollution / 4);
      t.radius = 30 + Math.sqrt(t.pop) * 3.2 + t.level * 6;
      for (let r = 0; r < NRES; r++) civ.stockTotal[r] += t.stock[r];
      if (t.pop === 0 && this.tick - t.founded > CFG.TICKS_PER_DAY * 2) this.abandonTown(t);
    }
  }

  abandonTown(t) {
    t.alive = false;
    const civ = this.civs[t.civ];
    civ.towns = civ.towns.filter((x) => x !== t.id);
    this.chronicle(`${t.name} is abandoned.`, t.civ, 'expansion');
    for (const id of [...t.buildings]) { const b = this.buildings[id]; if (b) { b.town = -1; } }
    if (civ.capital === t.id) this.relocateCapital(civ);
    if (!civ.towns.length && civ.alive) this.eliminateCiv(civ, null);
    this.territoryDirty = true;
  }

  computeTerritory() {
    const w = this.world;
    const TW = CFG.TW, TH = CFG.TH, S_ = CFG.TER;
    w.infl.fill(0);
    w.owner.fill(-1);
    for (const t of this.towns) {
      if (!t || !t.alive) continue;
      const civ = this.civs[t.civ];
      const R0 = t.radius + 14 + Math.sqrt(civ.culture + 1) * 0.35 + (t.isCapital ? 12 : 0);
      const strength = 1 + Math.sqrt(t.pop) * 0.15;
      const cx = t.cx / S_, cy = t.cy / S_, rr = R0 / S_;
      for (let y = Math.max(0, (cy - rr) | 0); y <= Math.min(TH - 1, (cy + rr) | 0); y++) for (let x = Math.max(0, (cx - rr) | 0); x <= Math.min(TW - 1, (cx + rr) | 0); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rr) continue;
        const v = (1 - d / rr) * strength;
        const k = y * TW + x;
        if (v > w.infl[k]) { w.infl[k] = v; w.owner[k] = t.civ; }
      }
    }
    // forts and castles project control
    for (const b of this.buildings) {
      if (!b || !b.built || !(b.def.id === 'castle' || b.def.id === 'watchtower')) continue;
      const rr = (b.def.id === 'castle' ? 50 : 18) / S_;
      const cx = b.cx / S_, cy = b.cy / S_;
      for (let y = Math.max(0, (cy - rr) | 0); y <= Math.min(TH - 1, (cy + rr) | 0); y++) for (let x = Math.max(0, (cx - rr) | 0); x <= Math.min(TW - 1, (cx + rr) | 0); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rr) continue;
        const k = y * TW + x;
        const v = (1 - d / rr) * 0.8;
        if (w.owner[k] === -1 || (v > w.infl[k] && w.owner[k] !== b.civ)) { w.infl[k] = Math.max(v, w.infl[k]); w.owner[k] = b.civ; }
      }
    }
    // water is nobody's
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const k = y * TW + x;
      const p = Math.min(w.H - 1, y * S_ + 2) * w.W + Math.min(w.W - 1, x * S_ + 2);
      if (TERRAIN[w.ter[p]].water && w.ter[p] !== T.RIVER) w.owner[k] = -1;
    }
    // border tension matrix
    this.borders.fill(0);
    for (let y = 1; y < TH; y++) for (let x = 1; x < TW; x++) {
      const k = y * TW + x;
      const o = w.owner[k];
      if (o < 0) continue;
      const a = w.owner[k - 1], b = w.owner[k - TW];
      if (a >= 0 && a !== o) this.borders[o * 8 + a]++;
      if (b >= 0 && b !== o) this.borders[o * 8 + b]++;
    }
    w.territoryVersion++;
    this.territoryDirty = false;
  }

  borderTension(a, b) { return Math.min(3, (this.borders[a * 8 + b] + this.borders[b * 8 + a]) / 40); }

  computeAuras() {
    const N = this.nav.N;
    this.auraH.fill(0); this.auraDis.fill(0);
    for (const b of this.buildings) {
      if (!b || !b.built || !b.def.aura) continue;
      const a = b.def.aura;
      if (!a.happy && !a.disease && !a.health) continue;
      const staffed = !b.def.jobCount || b.workers.length > 0 || b.def.passive;
      if (!staffed) continue;
      const rr = a.radius / CFG.NAV;
      const cx = b.cx / CFG.NAV, cy = b.cy / CFG.NAV;
      const o = b.civ * N;
      for (let y = Math.max(0, (cy - rr) | 0); y <= Math.min(CFG.NH - 1, (cy + rr) | 0); y++) for (let x = Math.max(0, (cx - rr) | 0); x <= Math.min(CFG.NW - 1, (cx + rr) | 0); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rr) continue;
        const f = 1 - d / rr * 0.5;
        const k = o + y * CFG.NW + x;
        if (a.happy) this.auraH[k] = Math.min(15, this.auraH[k] + a.happy * f);
        if (a.disease) this.auraDis[k] = Math.max(-0.8, this.auraDis[k] + a.disease * f);
      }
    }
  }

  // Slow environmental processes over a slice of the map each day.
  regrow() {
    const w = this.world;
    const N = w.N;
    const slice = Math.ceil(N / CFG.DAYS_PER_YEAR);
    const end = Math.min(N, this.regrowCursor + slice);
    for (let p = this.regrowCursor; p < end; p++) {
      const d = w.dep[p];
      if (d === D.BERRY || d === D.HERBS || d === D.SPICE || d === D.COTTON) { if (w.amt[p] < 30) { w.amt[p] = 30; } }
      else if (d === D.FISH) { if (w.amt[p] < 70) w.amt[p] = Math.min(100, w.amt[p] + 35); }
      else if (d === 0 && !w.bld[p] && !(w.road[p] & 7)) {
        const t = w.ter[p];
        if ((t === T.FOREST || t === T.JUNGLE || t === T.TAIGA) && w.traffic[p] < 3 && ((p * 2654435761) >>> 0) % 1000 < 60) { this.addDeposit(p, D.SAPLING, 1); this.saplings.push(p); }
      }
      // traffic: desire paths form and fade
      const tr = w.traffic[p];
      const lvl = w.road[p] & 7;
      if (tr > 50 && lvl === 0 && TERRAIN[w.ter[p]].water === 0 && !w.bld[p]) { w.setRoad(p, 1); this.nav.markDirty(p % w.W, (p / w.W) | 0); }
      else if (lvl === 1 && tr < 2 && ((p * 7) & 7) === 0) { w.road[p] &= ~7; w.recomputeSpeed(p); w.markDirty(p); }
      w.traffic[p] = tr >> 1;
    }
    this.regrowCursor = end >= N ? 0 : end;
    // renewable deposits (berries, fish, herbs...) come back after a few days
    const q = this.regrowQueue, nq = [];
    for (let k = 0; k < q.length; k += 2) {
      const p = q[k];
      if (q[k + 1] <= this.day) { const d = w.dep[p]; if (d) { w.amt[p] = d === D.FISH ? 80 : 40; w.markDirty(p); } }
      else nq.push(p, q[k + 1]);
    }
    this.regrowQueue = nq;
    // saplings grow
    const keep = [];
    for (const p of this.saplings) {
      if (w.dep[p] !== D.SAPLING) continue;
      w.amt[p]++;
      if (w.amt[p] >= 12) { this.addDeposit(p, D.TREE, 40 + randInt(40)); }
      else keep.push(p);
    }
    this.saplings = keep;
    // pollution decays
    for (let k = 0; k < w.pollution.length; k++) if (w.pollution[k]) w.pollution[k] = Math.max(0, w.pollution[k] - 1);
  }

  // ------------------------------------------------------------ main step
  step(dt = 1) {
    const P = this.people;
    const prevDay = this.day;
    this.tick += dt;
    this.day = Math.floor(this.tick / CFG.TICKS_PER_DAY);
    this.tod = (this.tick % CFG.TICKS_PER_DAY) / CFG.TICKS_PER_DAY;
    this.season = Math.floor(this.day / CFG.DAYS_PER_SEASON) % 4;
    this.year = Math.floor(this.day / CFG.DAYS_PER_YEAR) + 1;
    this.nav.budget = 20000 + dt * 5000;
    if ((this.tick & 3) < dt || dt >= 4) this.spatial.rebuild(P);
    // people
    const hwm = P.hwm;
    const tickMod = this.tick & 15;
    for (let i = 0; i < hwm; i++) {
      if (P.civ[i] < 0) continue;
      updatePerson(this, i, dt);
      if (P.civ[i] >= 0 && ((i + this.tick) & 15) < dt) {
        explore(this, i, P.age[i] >= CFG.ADULT_AGE ? 1 : 0);
      }
    }
    void tickMod;
    this.lifecycle.step(dt);
    this.military.scan(dt);
    this.military.towers(dt);
    this.military.updateArmies(dt);
    this.animals.update(this, dt);
    this.transport.update(dt);
    this.events.step(dt);
    this.beliefs.step(dt);
    for (let k = this.projectiles.length - 1; k >= 0; k--) { const pr = this.projectiles[k]; pr.t += dt; if (pr.t > pr.dur) this.projectiles.splice(k, 1); }
    // labour market & planners (staggered)
    for (const t of this.towns) {
      if (!t || !t.alive) continue;
      const ph = (this.tick + t.id * 37) % CFG.JOB_INTERVAL;
      if (ph < dt) { this.jobs.houseTown(t); this.jobs.assignTown(t); }
      const pp = (this.tick + t.id * 53) % CFG.PLAN_INTERVAL;
      if (pp < dt) this.planner.run(t);
    }
    if (this.tick % 60 < dt) { this.census(); this.military.refreshWarCache(); }
    if (this.tick % 400 < dt) this.nav.refresh(false);
    if (this.day !== prevDay) this.daily();
  }

  daily() {
    for (const t of this.towns) if (t && t.alive) this.economy.dailyTown(t);
    for (const civ of this.civs) {
      if (!civ.alive) continue;
      this.research.daily(civ);
      if (civ.martyrs) civ.martyrs *= 0.97;
      civ.culture += civ.cultureToday * civ.mod.culture; civ.cultureRate = civ.cultureRate * 0.8 + civ.cultureToday * 0.2; civ.cultureToday = 0;
      civ.faith += civ.faithToday * civ.mod.faith; civ.faithRate = civ.faithRate * 0.8 + civ.faithToday * 0.2; civ.faithToday = 0;
      // passive culture from structures
      for (const tid of civ.towns) { const t = this.towns[tid]; if (!t) continue; for (const id of t.buildings) { const b = this.buildings[id]; if (b && b.built && b.def.fx.culture && b.def.passive) civ.culture += b.def.fx.culture; } }
    }
    this.beliefs.daily();
    this.diplomacy.daily();
    this.military.daily();
    this.military.refreshWarCache();
    this.settle.daily();
    this.transport.daily();
    this.events.daily();
    this.animals.daily(this);
    this.abandonExhausted();
    this.regrow();
    this.computeTerritory();
    this.computeAuras();
    this.nav.refresh(false);
    if (this.day % CFG.DAYS_PER_YEAR === 0) this.yearly();
  }

  // Pits, quarries and mines whose deposits are worked out are abandoned so
  // the planner can open new ones elsewhere.
  abandonExhausted() {
    for (const b of this.buildings) {
      if (!b || !b.built || !b.def.harvest || !b.def.harvest.dep) continue;
      const ex = b.exhausted || 0;
      b.exhausted = ex * 0.5;
      if (ex < 20) continue;
      b.harvestCache = null;
      if (this.pickHarvestPixel(b, b.cx, b.cy) >= 0) continue;
      const town = this.towns[b.town];
      if (b.def.harvest.mine || b.def.id === 'quarry') this.chronicle(`The ${b.def.name.toLowerCase()} of ${town ? town.name : 'the frontier'} is worked out and abandoned.`, b.civ, 'info');
      this.destroyBuilding(b, 'exhausted');
    }
  }

  yearly() {
    const snap = { year: this.year, civs: this.civs.map((c) => ({ pop: c.pop, techs: c.techCount, soldiers: c.soldiers, happy: Math.round(c.happiness), culture: Math.round(c.culture), towns: c.towns.length, alive: c.alive, coins: Math.round(c.stockTotal[this.RES_COINS]), buildings: c.structCount.reduce((a, b) => a + b, 0) })) };
    this.history.push(snap);
    if (this.history.length > 2000) this.history.shift();
  }
}

export { S, A, think, goTo, pick };

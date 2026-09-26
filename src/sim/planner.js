// Town planner: the self-building AI. Scores every available structure by the
// town's needs and the civilisation's beliefs, then searches for a site.
import { CFG } from '../config.js';
import { STRUCTURES, SD } from '../data/structures.js';
import { RESOURCES, R, NRES } from '../data/resources.js';
import { SCALES, NB, B } from '../data/beliefs.js';
import { D, T, TERRAIN } from '../world/terrain.js';
import { placeBuilding, canPlace, countDeposits, footprintFertility, shoreScore, depositTypesForHarvest } from './buildings.js';
import { outputsOf } from './jobs.js';
import { rand, randInt, chance } from '../util/rng.js';

const RES_COINS = R('coins');

// Service categories: how many people each building serves, and how much of
// the population wants that service given the civ's beliefs.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const SERVICE = {
  religion: {
    seats: { shrine: 40, sacred_grove: 50, temple: 140, monastery: 90, cathedral: 450 },
    demand: (civ) => clamp(0.25 + civ.beliefAvg[B.PIETY] / 90 + civ.beliefAvg[B.SPIRITUALITY] / 300, 0.03, 1.1),
    mult: (id, civ) => (id === 'sacred_grove' ? clamp((civ.beliefAvg[B.NATURE] + 30) / 50, 0, 1.5) : id === 'shrine' && civ.has('priesthood') ? 0.3 : id === 'monastery' ? 1 + Math.max(0, -civ.beliefAvg[B.HEDONISM]) / 50 : 1),
  },
  knowledge: {
    seats: { library: 90, academy: 160, university: 320, observatory: 150, laboratory: 260, research_institute: 420 },
    demand: (civ) => clamp(0.45 + (civ.beliefAvg[B.SCHOLARSHIP] + civ.beliefAvg[B.CURIOSITY] + civ.beliefAvg[B.REASON]) / 250, 0.08, 1.3),
    mult: (id, civ) => (id === 'library' && civ.has('education') ? 0.5 : 1) * civ.mod.research,
  },
  culture: {
    seats: { monument: 50, amphitheater: 200, tavern: 70, arena: 300, opera_house: 420 },
    demand: (civ, town) => clamp(0.3 + (civ.beliefAvg[B.HEDONISM] + civ.beliefAvg[B.ART] + civ.beliefAvg[B.REVELRY]) / 300 + Math.max(0, 60 - town.happiness) / 60, 0.05, 1.3),
    mult: (id, civ) => (id === 'monument' ? 0.6 + Math.max(0, civ.beliefAvg[B.PRIDE]) / 40 : id === 'tavern' ? 1 + Math.max(0, civ.beliefAvg[B.REVELRY]) / 40 : id === 'arena' ? 1 + Math.max(0, civ.beliefAvg[B.AGGRESSION]) / 50 : 1),
  },
  health: {
    seats: { herbalist_hut: 70, bathhouse: 180, hospital: 350 },
    demand: (civ, town) => clamp(0.35 + civ.beliefAvg[B.HYGIENE] / 200 + civ.beliefAvg[B.EMPATHY] / 300 + town.sick / Math.max(1, town.pop) * 6, 0.1, 1.3),
    mult: (id, civ) => (id === 'herbalist_hut' && civ.has('medicine') ? 0.3 : 1),
  },
};

export class Planner {
  constructor(sim) {
    this.sim = sim;
    this.lastChoice = new Map();
    this.obtainCache = new Map();
    this.fails = {};
  }

  // Belief-driven category weights for a civ.
  aiWeights(civ) {
    const w = {};
    for (let s = 0; s < NB; s++) {
      const avg = civ.beliefAvg[s] / 100;
      if (Math.abs(avg) < 0.08) continue;
      const pole = avg > 0 ? SCALES[s].pos : SCALES[s].neg;
      for (const [cat, v] of Object.entries(pole.ai || {})) w[cat] = (w[cat] || 0) + v * Math.abs(avg) * 1.6;
    }
    return w;
  }

  run(town) {
    const sim = this.sim;
    const civ = sim.civs[town.civ];
    if (!town.alive) return;
    const builders = this.countBuilders(town);
    const maxC = Math.min(7, 1 + Math.floor(builders / 3) + (town.pop > 150 ? 1 : 0) + (town.pop > 400 ? 1 : 0));
    if (town.construction.length >= maxC) return;
    const weights = this.aiWeights(civ);
    const cands = [];
    const counts = this.countTypes(town);
    for (const def of STRUCTURES) {
      if (!civ.structureAvailable(def)) continue;
      if (def.unique === 'civ' && civ.uniques[def.id] !== undefined) continue;
      if (def.unique === 'civ' && sim.anyUnderConstruction(civ, def.idx)) continue;
      if (def.maxPerTown && counts[def.idx] >= def.maxPerTown) continue;
      if (def.maxPerCiv && this.civCount(civ, def.idx) >= def.maxPerCiv) continue;
      if (def.center && def.center <= town.level) continue;
      if (def.center && def.unique === 'civ' && !town.isCapital) continue;
      if (def.center && def.center > 2 && !town.isCapital) continue;
      let v = this.value(def, town, civ, counts);
      v *= 1 + (weights[def.cat] || 0) * 0.5;
      if (v < 0.6) continue;
      v *= 0.85 + rand() * 0.3;
      cands.push({ def, v });
    }
    cands.sort((a, b) => b.v - a.v);
    const planWants = new Map();
    let tries = 0;
    let placed = false;
    for (const c of cands.slice(0, 10)) {
      const def = c.def;
      if (!town.has(def.cost)) {
        // remember what we need so producers/logistics react
        for (const [k, n] of Object.entries(def.cost)) {
          const r = R(k);
          planWants.set(r, Math.max(planWants.get(r) || 0, n * 1.2));
        }
        if (c.v > 3 && tries === 0) { tries++; continue; }
        continue;
      }
      const site = this.findSite(def, town, civ);
      if (!site) { this.fails[def.id] = (this.fails[def.id] || 0) + 1; continue; }
      town.pay(def.cost);
      const b = placeBuilding(sim, def.idx, civ.id, town.id, site.x, site.y, false, !!site.rotate);
      if (def.id === 'palisade' || def.id === 'stone_wall') b.wallRing = true;
      this.lastChoice.set(town.id, def.id);
      placed = true;
      break;
    }
    town.planWants = planWants;
    if (!placed && town.construction.length === 0 && chance(0.25)) this.renewal(town, civ);
  }

  // Urban renewal: replace an obsolete dwelling so the next plan builds a better one.
  renewal(town, civ) {
    const sim = this.sim;
    let bestCap = 0, bestDef = null;
    for (const def of STRUCTURES) if (def.housing && civ.structureAvailable(def) && def.housing > bestCap && def.housing < 300) { bestCap = def.housing; bestDef = def; }
    if (!bestDef || !town.has(bestDef.cost)) return;
    let victim = null;
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b || !b.built || !b.capacity || b.def.housing * 2.5 > bestCap) continue;
      if (!victim || b.def.housing < victim.def.housing || (b.def.housing === victim.def.housing && b.created < victim.created)) victim = b;
    }
    if (!victim) return;
    // only when the displaced can be rehoused or the town has slack
    if (town.housingCap - victim.capacity < town.pop * 0.95) return;
    sim.destroyBuilding(victim, 'renewal');
  }

  countBuilders(town) {
    const sim = this.sim;
    let n = 0;
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b) continue;
      for (const w of b.workers) if (sim.professions[sim.people.prof[w]].kind === 'builder') n++;
    }
    return n + Math.floor(town.idle * 0.5);
  }

  serviceSeats(town, cat) {
    const seats = SERVICE[cat].seats;
    let n = 0;
    for (const id of town.buildings) {
      const b = this.sim.buildings[id];
      if (!b) continue;
      const v = seats[b.def.id];
      if (v) n += v;
    }
    return n;
  }

  anyStalled(town, typeIdx) {
    for (const id of town.buildings) {
      const b = this.sim.buildings[id];
      if (b && b.type === typeIdx && b.built && (b.stalled || 0) > 1) return true;
    }
    return false;
  }

  civCount(civ, typeIdx) {
    let n = 0;
    for (const tid of civ.towns) { const t = this.sim.towns[tid]; if (!t) continue; for (const id of t.buildings) { const b = this.sim.buildings[id]; if (b && b.type === typeIdx) n++; } }
    return n;
  }

  openSlots(town, typeIdx) {
    let open = 0;
    for (const id of town.buildings) {
      const b = this.sim.buildings[id];
      if (!b || b.type !== typeIdx) continue;
      if (!b.built) { open += b.def.jobCount; continue; }
      let slots = 0;
      for (const n of Object.values(b.slots)) slots += n;
      open += Math.max(0, slots - b.workers.length);
    }
    return open;
  }

  countTypes(town) {
    const counts = new Int32Array(STRUCTURES.length);
    for (const id of town.buildings) { const b = this.sim.buildings[id]; if (b) counts[b.type]++; }
    return counts;
  }

  // ------------------------------------------------------------ valuation
  value(def, town, civ, counts) {
    const sim = this.sim;
    const pop = Math.max(1, town.pop);
    const n = counts[def.idx];
    const cat = def.cat;
    let v = 0;
    let break_ = false;
    // --- housing
    if (def.housing) {
      const free = town.housingCap - town.pop;
      const freeRatio = free / pop;
      const urgency = freeRatio < 0.05 ? 3 + Math.min(4, -free / 8) : freeRatio < 0.15 ? 1.5 : freeRatio < 0.28 ? 0.35 : 0;
      if (!urgency) return 0;
      const eff = def.housing / (4 + costWeight(def.cost));
      v += urgency * (0.6 + eff * 2) * (1 + def.housing / 40);
      if (def.id === 'manor') v *= Math.max(0, civ.beliefAvg[B.HIERARCHY]) / 30;
      if (def.id === 'tenement') v *= Math.max(0.2, 1 - civ.beliefAvg[B.EMPATHY] / 60);
      if (def.id === 'hut' && civ.has('masonry')) v *= 0.3;
      if (def.id === 'cottage' && civ.has('construction')) v *= 0.4;
      if (def.id === 'stone_house' && civ.has('architecture')) v *= 0.5;
      return v;
    }
    // --- town centre upgrades
    if (def.center) return def.center > town.level ? 6 + pop / 50 : 0;
    // --- producers
    const outs = outputsOf(def);
    if (outs.length && def.jobCount) {
      // don't add workplaces while the existing ones of this type are unstaffed
      if (this.openSlots(town, def.idx) > 0) return 0;
      if (n > 0 && def.recipes && this.anyStalled(town, def.idx)) return 0;
      const feeds = outs.some((r) => RESOURCES[r].food > 0.5);
      if (town.idle < 2 && town.openJobs > 4 && !(feeds && town.foodDays < 12)) return 0;
    }
    if (outs.length) {
      let best = 0;
      for (const r of outs) {
        const res = RESOURCES[r];
        const want = town.want[r];
        const stock = town.stock[r];
        let need = want > 0 ? Math.max(0, (want - stock) / want) : 0;
        if (res.food > 0) {
          const fd = town.foodDays;
          need = Math.max(need, fd < 5 ? 3 : fd < 10 ? 1.8 : fd < 20 ? 0.9 : fd < 40 ? 0.3 : 0.05);
          // make sure production keeps up with population
          const prodRatio = (town.prod[r] + 1) / (pop * 0.5);
          if (prodRatio < 1) need += 0.3;
        }
        // inputs must be obtainable for recipes
        best = Math.max(best, need * (0.8 + Math.log2(1 + res.base) * 0.5));
      }
      if (def.recipes) {
        let feasible = false;
        for (const rc of def.recipes) {
          if (rc.tech && !civ.has(rc.tech)) continue;
          let ok = true;
          for (const k of Object.keys(rc.in)) {
            const r = R(k);
            if (town.stock[r] < 1 && town.prod[r] < 0.2 && !this.canObtain(civ, town, r)) { ok = false; break; }
          }
          if (ok) { feasible = true; break; }
        }
        if (!feasible) return 0;
      }
      if (def.harvest && def.harvest.dep) {
        const types = depositTypesForHarvest(def, civ);
        if (!types.length) return 0;
        if (def.place === 'deposit' && !this.hasNearbyDeposit(town, civ, types, def)) return 0;
      }
      if (def.harvest && def.harvest.animals && sim.animals.count < 60) best *= 0.3;
      v += best * 2.2;
      v /= 1 + n * 0.35;
      if (def.id === 'gatherer_camp' && n >= 2) v *= 0.4;
      if (def.id === 'farm') v *= 1.2;
      if (def.id === 'strip_mine') v *= 0.6 + Math.max(0, -civ.beliefAvg[B.NATURE]) / 50;
      if (def.powerUse && town.powerSupply < town.powerDemand) v *= 0.5;
      if (def.recipes && def.recipes.every((rc) => Object.keys(rc.out).length === 0)) v = 0; // pure power: below
    }
    // --- power plants
    if (def.recipes && def.recipes.some((rc) => rc.power) || def.power) {
      const deficit = town.powerDemand - town.powerSupply;
      v = deficit > 0 ? 3 + deficit / 30 : (town.powerDemand > 0 ? 0.1 : 0);
      if (def.id === 'power_plant' && civ.has('nuclear_fission')) v *= 0.5;
      if (def.id === 'nuclear_plant') v *= civ.beliefAvg[B.NATURE] > 30 ? 0.3 : 1.2;
      if (def.id === 'solar_farm') v *= 1 + Math.max(0, civ.beliefAvg[B.NATURE]) / 30;
      if (def.id === 'fusion_reactor') v *= 3;
      return v / (1 + n * 0.5);
    }
    // --- storage
    if (def.storage && !def.center && !def.station && !def.harbor) {
      const sum = town.stockSum();
      if (sum > town.capacity * 0.85 && n < 4) v += 1.2 + (sum / town.capacity - 0.85) * 3;
      else return 0;
      if (def.id === 'warehouse' && sim.civs[town.civ].towns.length > 1) v += 0.5;
      v /= 1 + n;
    }
    // --- services: compare seat capacity with belief-weighted demand
    const svc = SERVICE[cat];
    if (svc && svc.seats[def.id] !== undefined) {
      const seats = this.serviceSeats(town, cat);
      const demand = pop * Math.max(0.03, svc.demand(civ, town, sim));
      const deficit = demand - seats;
      if (deficit <= 0) return 0;
      // prefer the most capable building type available
      const cap = svc.seats[def.id];
      v += Math.min(4, deficit / 50) * (0.7 + Math.min(1.2, cap / 150));
      if (svc.mult) v *= svc.mult(def.id, civ, town, sim);
      break_ = true;
    }
    if (def.id === 'school') {
      const deficit = town.children * 0.8 - n * 60;
      return deficit > 10 ? Math.min(4, deficit / 30) * (1 + Math.max(0, civ.beliefAvg[B.SCHOLARSHIP]) / 60) : 0;
    }
    switch (break_ ? 'none' : cat) {
      case 'commerce': {
        if (def.id === 'marketplace') v += pop > 35 ? 2.5 : 0;
        else if (def.id === 'trading_post') v += sim.diplomacy.anyTradePartner(civ.id) ? 2.2 : 0;
        else if (def.id === 'bank') v += pop > 250 ? 1.5 : 0;
        else if (def.id === 'stock_exchange') v += pop > 400 ? 1.5 : 0;
        else if (def.id === 'mint') v += town.stock[R('gold')] + town.stock[R('silver')] > 5 ? 1.5 : 0.1;
        v *= 1 + Math.max(0, civ.beliefAvg[B.COMMERCE]) / 50;
        break;
      }
      case 'civic': {
        if (def.id === 'courthouse') v += (town.crime > 3 || pop > 150) && n < 1 + Math.floor(pop / 500) ? 1.2 + town.crime * 0.2 : 0;
        else if (def.id === 'embassy') v += sim.diplomacy.anyContact(civ.id) && town.isCapital ? 2.5 : 0;
        else if (def.id === 'spy_den') v += sim.diplomacy.anyContact(civ.id) && town.isCapital ? 1 + Math.max(0, -civ.beliefAvg[B.HONESTY]) / 30 + (sim.military.atWar(civ.id) ? 1.5 : 0) : 0;
        else if (def.id === 'propaganda_office') v += town.isCapital ? 0.8 + Math.max(0, civ.beliefAvg[B.AUTHORITY]) / 20 : 0;
        break;
      }
      case 'military': {
        v += this.militaryValue(def, town, civ, n);
        break;
      }
      case 'transport': {
        if (def.id === 'dock') v += town.coastal ? 1.8 + Math.max(0, civ.beliefAvg[B.SEA]) / 40 : 0;
        else if (def.id === 'shipyard') v += town.coastal && counts[SD('dock').idx] > 0 && pop > 150 ? 1.2 : 0;
        else if (def.id === 'road_guild') v += 2.5;
        else if (def.id === 'train_station') v += civ.towns.length > 1 ? 3 : 0;
        else if (def.id === 'motor_depot') v += civ.towns.length > 1 ? 1.8 : 0.3;
        else if (def.id === 'airport') v += pop > 300 ? 1.8 : 0;
        v /= 1 + n * 2;
        break;
      }
      case 'wonder': {
        if (def.id === 'great_pyramid') v += town.isCapital && pop > 200 ? 1.2 + Math.max(0, civ.beliefAvg[B.PRIDE]) / 25 : 0;
        if (def.id === 'spaceport') v += town.isCapital ? 5 : 0;
        break;
      }
    }
    if (def.aura && def.aura.happy && town.happiness < 50) v += 0.4;
    return v;
  }

  militaryValue(def, town, civ, n) {
    const sim = this.sim;
    const threat = sim.military.threat(civ.id, town);
    const want = sim.military.desiredSoldiers(civ);
    const slots = sim.military.militarySlots(civ);
    let v = 0;
    if (def.jobs && Object.keys(def.jobs).some((k) => k[0] === '@')) {
      if (slots < want) v += 1.5 + (want - slots) / 8 + threat;
      if (def.id === 'stable' && civ.bestUnit('cavalry') < 0) v = 0;
      if (def.id === 'stable' && town.stock[R('horses')] < 2) v *= 0.3;
      if (def.id === 'siege_workshop') v = sim.military.atWar(civ.id) ? v * 0.8 : v * 0.2;
      if (def.id === 'castle') v = (threat > 0.5 || town.isCapital) && town.pop > 150 ? v * 1.2 + threat : 0;
    } else if (def.wall) {
      const caution = Math.max(0, -civ.beliefAvg[B.COURAGE]) + Math.max(0, civ.beliefAvg[B.SUSPICION]);
      const ring = this.wallRingNeeded(town, def);
      v = ring > 0 && town.pop > 80 && threat >= 0.5 ? (threat * 1.5 + caution / 50) : 0;
      if (def.id === 'palisade' && civ.has('fortification')) v = 0;
    } else if (def.id === 'watchtower') {
      v = (threat + 0.3 + Math.max(0, civ.beliefAvg[B.SUSPICION]) / 50) / (1 + n * 0.6);
    } else if (def.id === 'weapon_forge' || def.id === 'armory') {
      v = (want > civ.soldiers ? 1.5 : 0.3) / (1 + n);
    }
    return v;
  }

  canObtain(civ, town, r, depth = 0) {
    const sim = this.sim;
    // any of our towns has or produces it
    for (const tid of civ.towns) { const t = sim.towns[tid]; if (t && (t.stock[r] > 2 || t.prod[r] > 0.2)) return true; }
    // a harvestable deposit is known near this town
    const key = civ.id + ':' + town.id + ':' + r;
    const cached = this.obtainCache.get(key);
    if (cached && sim.day - cached.day < 3) return cached.ok;
    let ok = false;
    for (const def of STRUCTURES) {
      if (!civ.structureAvailable(def)) continue;
      if (def.field && (def.field.out === RESOURCES[r].id || (def.field.extra && def.field.extra[RESOURCES[r].id] !== undefined))) { ok = true; break; }
      if (def.harvest && def.harvest.dep) {
        const types = depositTypesForHarvest(def, civ).filter((d) => sim.depRes[d] === r);
        if (types.length && sim.findDepositCells(town.cx, town.cy, 140, types, civ, 1).length) { ok = true; break; }
      }
      if (def.harvest && def.harvest.animals && (r === R('meat') || r === R('hides'))) { ok = true; break; }
      if (depth < 1 && def.recipes) for (const rc of def.recipes) {
        if (rc.out[RESOURCES[r].id] === undefined || (rc.tech && !civ.has(rc.tech))) continue;
        if (Object.keys(rc.in).every((k) => this.canObtain(civ, town, R(k), depth + 1))) { ok = true; break; }
      }
      if (ok) break;
    }
    this.obtainCache.set(key, { ok, day: sim.day });
    return ok;
  }

  hasNearbyDeposit(town, civ, types, def) {
    const cells = this.sim.findDepositCells(town.cx, town.cy, 130, types, civ, 1);
    return cells.length > 0;
  }

  wallRingNeeded(town, def) {
    const r = town.radius * 0.8 + 8;
    const segs = Math.min(28, Math.floor((2 * Math.PI * r) / (def.size[0] + 5)));
    let have = 0;
    for (const id of town.buildings) { const b = this.sim.buildings[id]; if (b && b.def.wall) have++; }
    return segs - have;
  }

  // ------------------------------------------------------------ site search
  findSite(def, town, civ) {
    const sim = this.sim;
    const c = sim.buildings[town.center];
    const cx = c ? c.cx : town.cx, cy = c ? c.cy : town.cy;
    const bw = def.size[0], bh = def.size[1];
    let best = null, bs = -1e18;
    const tryPos = (x, y, bonus = 0) => {
      x = Math.round(x - bw / 2); y = Math.round(y - bh / 2);
      if (!canPlace(sim, def, x, y, civ.id)) return;
      if (!civ.explored[sim.nav.cellOf(x, y)]) return;
      const s = this.siteScore(def, town, civ, x, y, cx, cy) + bonus;
      if (s > bs) { bs = s; best = { x, y }; }
    };
    const place = def.place || 'land';
    const R0 = town.radius;
    if (def.wall) {
      const r = R0 * 0.8 + 8;
      for (let k = 0; k < 60; k++) {
        const a = rand() * 6.283;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        const vert = Math.abs(Math.cos(a)) > 0.7;
        const d2 = vert ? { ...def, size: [def.size[1], def.size[0]] } : def;
        const xx = Math.round(x - d2.size[0] / 2), yy = Math.round(y - d2.size[1] / 2);
        // leave gaps on busy paths (gates)
        const p = (yy | 0) * sim.world.W + (xx | 0);
        if (sim.world.road[p] & 7) continue;
        if (canPlace(sim, d2, xx, yy, civ.id)) {
          const s = -Math.abs(Math.hypot(xx - cx, yy - cy) - r) + rand();
          if (s > bs) { bs = s; best = { x: xx, y: yy, rotate: vert }; }
        }
      }
      if (best && best.rotate) { best.rotated = true; }
      return best ? this.applyRotation(def, best) : null;
    }
    if (place === 'deposit') {
      const types = depositTypesForHarvest(def, civ).length ? depositTypesForHarvest(def, civ) : (def.deposit || []);
      const wanted = this.wantedDeposits(town, civ, types);
      const cells = sim.findDepositCells(cx, cy, 140, wanted.length ? wanted : types, civ, 6);
      for (const cell of cells) {
        const [px, py] = sim.nav.cellCenter(cell);
        for (let k = 0; k < 10; k++) tryPos(px + (rand() - 0.5) * 16, py + (rand() - 0.5) * 16, 0);
      }
      return best;
    }
    if (place === 'forest') {
      const cells = sim.findDepositCells(cx, cy, 90, [D.TREE], civ, 8);
      for (const cell of cells) {
        const [px, py] = sim.nav.cellCenter(cell);
        for (let k = 0; k < 6; k++) tryPos(px + (rand() - 0.5) * 20, py + (rand() - 0.5) * 20);
      }
      return best;
    }
    if (place === 'shore') {
      for (let k = 0; k < 160; k++) {
        const a = rand() * 6.283, d = 6 + rand() * (R0 + 50);
        tryPos(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      }
      return best;
    }
    // generic ring search, distance band by category
    let rmin = 4, rmax = R0 + 10;
    switch (def.cat) {
      case 'housing': rmin = 4; rmax = Math.max(18, R0 * 0.9); break;
      case 'food': rmin = def.field ? 10 : 5; rmax = R0 + (def.field ? 45 : 30); break;
      case 'material': case 'industry': rmin = 12; rmax = R0 + 35; break;
      case 'military': rmin = R0 * 0.3; rmax = R0 + 15; break;
      case 'wonder': rmin = 12; rmax = R0 + 30; break;
      default: rmin = 5; rmax = R0 * 0.8 + 12;
    }
    if (def.gatherer || def.id === 'gatherer_camp' || def.id === 'hunting_lodge') {
      const types = def.id === 'gatherer_camp' ? [D.BERRY, D.HERBS, D.COTTON, D.SPICE] : null;
      if (types) {
        const cells = sim.findDepositCells(cx, cy, 80, types, civ, 6);
        for (const cell of cells) { const [px, py] = sim.nav.cellCenter(cell); for (let k = 0; k < 5; k++) tryPos(px + (rand() - 0.5) * 16, py + (rand() - 0.5) * 16); }
        if (best) return best;
      }
    }
    for (let k = 0; k < 110; k++) {
      const a = rand() * 6.283, d = rmin + Math.sqrt(rand()) * (rmax - rmin);
      tryPos(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
    if (!best && def.cat === 'housing') {
      for (let k = 0; k < 80; k++) {
        const a = rand() * 6.283, d = rmax + rand() * 30;
        tryPos(cx + Math.cos(a) * d, cy + Math.sin(a) * d, -20);
      }
    }
    return best;
  }

  applyRotation(def, site) {
    if (!site.rotate) return site;
    return { x: site.x, y: site.y, rotate: true };
  }

  wantedDeposits(town, civ, types) {
    const sim = this.sim;
    const out = [];
    for (const d of types) {
      const res = sim.depRes[d];
      if (res < 0) continue;
      const want = town.want[res] + (town.planWants && town.planWants.get(res) || 0);
      if (want > town.stock[res] || town.stock[res] < 10) out.push(d);
    }
    return out;
  }

  siteScore(def, town, civ, x, y, cx, cy) {
    const sim = this.sim, w = sim.world;
    const bw = def.size[0], bh = def.size[1];
    const mx = x + bw / 2, my = y + bh / 2;
    const dist = Math.hypot(mx - cx, my - cy);
    let s = -dist * 0.12 + rand() * 2;
    // near roads
    let roads = 0;
    for (let k = 0; k < 8; k++) {
      const px = (x - 2 + rand() * (bw + 4)) | 0, py = (y - 2 + rand() * (bh + 4)) | 0;
      if (w.inb(px, py) && (w.road[py * w.W + px] & 7)) roads++;
    }
    s += roads * 1.2;
    const place = def.place;
    if (place === 'fertile' || def.field) {
      const f = footprintFertility(w, x, y, bw, bh);
      if (f < 0.35 && !(def.field && def.field.animals)) return -1e9;
      s += f * 30;
      if (def.field && def.field.warm) s += (w.temp[y * w.W + x] - 0.5) * 30;
    }
    if (place === 'shore') {
      const sh = shoreScore(w, x, y, bw, bh);
      if (sh < 3) return -1e9;
      s += Math.min(sh, 20) * 0.6;
      if (def.harvest && def.harvest.water) s += countDeposits(w, mx | 0, my | 0, 20, [D.FISH]) * 0.08;
    }
    if (place === 'forest') {
      const t = countDeposits(w, mx | 0, my | 0, 22, [D.TREE]);
      if (t < 30) return -1e9;
      s += Math.min(t, 300) * 0.05 + dist * 0.05;
    }
    if (place === 'deposit') {
      const types = def.harvest && def.harvest.dep ? depositTypesForHarvest(def, civ) : def.deposit;
      const r = def.harvest ? Math.min(def.harvest.radius, 20) : 10;
      const n = countDeposits(w, mx | 0, my | 0, r, this.wantedDeposits(town, civ, types).length ? this.wantedDeposits(town, civ, types) : types);
      if (n < 8) return -1e9;
      s += Math.min(n, 200) * 0.1;
    }
    if (place === 'hills') {
      const t = w.ter[(my | 0) * w.W + (mx | 0)];
      if (t !== T.HILLS && t !== T.MOUNTAIN) s -= 10;
    }
    if (place === 'open') {
      const t = w.ter[(my | 0) * w.W + (mx | 0)];
      if (t === T.GRASS || t === T.PLAINS || t === T.SAVANNA) s += 5;
    }
    if (def.cat === 'housing' || def.cat === 'religion' || def.cat === 'culture' || def.cat === 'knowledge' || def.cat === 'civic') {
      s -= dist * 0.15; // compact core
      // hygienic civs keep industry away from homes: handled by industry below
    }
    if (def.cat === 'industry' || def.cat === 'material') {
      if (dist < town.radius * 0.35) s -= 6 * (1 + Math.max(0, civ.beliefAvg[B.HYGIENE]) / 50);
    }
    if (def.id === 'gatherer_camp') s += countDeposits(w, mx | 0, my | 0, 30, [D.BERRY, D.HERBS, D.COTTON, D.SPICE]) * 0.15;
    if (def.id === 'hunting_lodge') s += dist * 0.1;
    // don't build on high-value farmland unless it's a field
    if (!def.field && def.cat !== 'housing') s -= footprintFertility(w, x, y, bw, bh) * 4;
    return s;
  }
}

export { CFG, TERRAIN, randInt, chance, NRES, RES_COINS };

function costWeight(cost) {
  let s = 0;
  for (const [k, n] of Object.entries(cost)) s += n * RESOURCES[R(k)].base;
  return s / 8;
}

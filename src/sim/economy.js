// Town economies: daily feeding, spoilage, storage, power, demand targets,
// prices and inter-town logistics (porters, carts, trucks, trains, ships).
import { CFG } from '../config.js';
import { RESOURCES, NRES, R, FOOD_RES, LUX_RES } from '../data/resources.js';
import { STRUCTURES } from '../data/structures.js';
import { PROFESSIONS } from '../data/professions.js';
import { B } from '../data/beliefs.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { rand } from '../util/rng.js';

const FOOD_ORDER = ['bread', 'preserved_food', 'meat', 'fish', 'berries', 'honey', 'grain', 'beer', 'wine', 'spices'].map(R);
const RES_COINS = R('coins');

// recipes indexed by output resource
export const RECIPES_BY_OUT = [];
for (const def of STRUCTURES) for (const rc of def.recipes || []) for (const k of Object.keys(rc.out)) {
  const r = R(k);
  (RECIPES_BY_OUT[r] = RECIPES_BY_OUT[r] || []).push({ def, rc });
}

export class Economy {
  constructor(sim) { this.sim = sim; }

  // Once per day for each town.
  dailyTown(town) {
    const sim = this.sim;
    const civ = sim.civs[town.civ];
    // --- feeding
    let demand = 0;
    demand = (town.adults + town.children * 0.6) * Math.max(0.6, Math.min(1.4, civ.mod.consume));
    let avail = 0;
    for (const r of FOOD_ORDER) avail += town.stock[r] * RESOURCES[r].food;
    const ratio = demand > 0 ? Math.min(1, avail / demand) : 1;
    town.feedRatio = ratio;
    let need = Math.min(avail, demand);
    for (const r of FOOD_ORDER) {
      if (need <= 0) break;
      const fv = RESOURCES[r].food;
      const units = Math.min(town.stock[r], need / fv);
      town.take(r, units);
      need -= units * fv;
    }
    const foodLeft = town.foodStock();
    town.foodDays = demand > 0 ? foodLeft / demand : 99;
    // --- spoilage & storage limits
    let granary = false;
    for (const id of town.buildings) { const b = sim.buildings[id]; if (b && b.built && b.def.id === 'granary') { granary = true; break; } }
    const spoilMul = civ.mod.spoil * (granary ? 0.5 : 1) * (town.stock[R('salt')] > 5 ? 0.8 : 1);
    let sum = 0;
    for (let r = 0; r < NRES; r++) {
      const sp = RESOURCES[r].spoil;
      if (sp > 0 && town.stock[r] > 0) town.stock[r] *= 1 - sp * spoilMul;
      if (r !== RES_COINS) sum += town.stock[r];
    }
    if (sum > town.capacity) {
      const over = (sum - town.capacity) / sum;
      for (let r = 0; r < NRES; r++) if (r !== RES_COINS) town.stock[r] *= 1 - over * 0.25;
    }
    // --- power
    town.powerSupply = town.powerAcc / 3 + town.passivePower * (town.solarFactor || 1);
    town.powerAcc = 0;
    town.powerRatio = town.powerDemand > 0 ? Math.min(1, town.powerSupply / town.powerDemand) : 1;
    // --- production statistics (EMA)
    for (let r = 0; r < NRES; r++) {
      town.prod[r] = town.prod[r] * 0.85 + town.prodDay[r] * 0.15;
      town.cons[r] = town.cons[r] * 0.85 + town.consDay[r] * 0.15;
      town.prodDay[r] = 0; town.consDay[r] = 0;
    }
    // --- crime & order
    const order = (town.orderPts || 0) * civ.mod.order;
    town.crime = Math.max(0, town.crime * 0.9 - order * 0.05);
    town.orderPts = 0;
    town.happyPts = (town.happyPts || 0) * 0.5;
    town.loyaltyPts = 0;
    // --- taxes: administrators & markets already add coins; base tithe
    town.add(RES_COINS, town.adults * 0.02 * civ.mod.coins);
    this.computeWants(town, civ);
    this.planShipments(town, civ);
  }

  computeWants(town, civ) {
    const sim = this.sim;
    const W = town.want;
    W.fill(0);
    const pop = Math.max(10, town.pop);
    const foodTarget = pop * 16;
    // food: spread across types
    W[R('grain')] = foodTarget * 0.5;
    W[R('bread')] = foodTarget * 0.3;
    W[R('berries')] = foodTarget * 0.15;
    W[R('meat')] = foodTarget * 0.15;
    W[R('fish')] = foodTarget * 0.15;
    W[R('flour')] = pop * 1.5;
    W[R('preserved_food')] = pop * 2;
    W[R('wood')] = 60 + pop * 0.8;
    W[R('stone')] = civ.has('masonry') ? 40 + pop * 0.5 : 10;
    W[R('clay')] = civ.has('pottery') ? 20 : 0;
    W[R('tools')] = civ.has('bronze_working') ? 10 + pop * 0.08 : 0;
    W[R('clothing')] = pop * 0.25;
    W[R('medicine')] = civ.has('herbalism') ? 5 + pop * 0.03 : 0;
    W[R('pottery')] = civ.has('pottery') ? 10 + pop * 0.05 : 0;
    W[R('coins')] = 100 + pop;
    for (const r of LUX_RES) W[r] = Math.max(W[r], pop * 0.15 * civ.mod.consume);
    // inputs for existing workshops
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b || !b.built) continue;
      for (const rc of b.def.recipes || []) {
        if (rc.tech && !civ.has(rc.tech)) continue;
        for (const [k, n] of Object.entries(rc.in)) W[R(k)] = Math.max(W[R(k)], n * 12 + 10);
      }
    }
    // pending construction costs + likely upcoming structures
    for (const id of town.construction) {
      const b = sim.buildings[id];
      if (!b) continue;
      for (const [k, n] of Object.entries(b.def.cost)) W[R(k)] += n * 0.5;
    }
    if (town.planWants) for (const [r, n] of town.planWants) W[r] = Math.max(W[r], n);
    // military equipment
    const mil = sim.military.desiredSoldiers(civ);
    if (mil > civ.soldiers) {
      for (const br of ['infantry', 'ranged', 'cavalry']) {
        const pid = civ.bestUnit(br);
        if (pid < 0) continue;
        for (const [k, n] of Object.entries(PROFESSIONS[pid].equip || {})) W[R(k)] = Math.max(W[R(k)], n * 8);
      }
    }
    // power fuel
    if (town.powerDemand > 0) { W[R('coal')] = Math.max(W[R('coal')], 30); W[R('uranium')] = Math.max(W[R('uranium')], 2); }
    // propagate demand up production chains (e.g. tools -> bronze -> copper & tin ore)
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < NRES; r++) {
        const deficit = W[r] - town.stock[r];
        if (deficit <= 2) continue;
        const prods = RECIPES_BY_OUT[r];
        if (!prods) continue;
        for (const { def, rc } of prods) {
          if (!civ.structureAvailable(def) || (rc.tech && !civ.has(rc.tech))) continue;
          const outN = rc.out[RESOURCES[r].id];
          for (const [k, n] of Object.entries(rc.in)) {
            const q = R(k);
            W[q] = Math.max(W[q], Math.min(200, deficit * n / outN) + 8);
          }
          break;
        }
      }
    }
  }

  // Prices per civ: scarcity relative to aggregate wants.
  price(civId, r) {
    const civ = this.sim.civs[civId];
    const base = RESOURCES[r].base;
    let stock = 0, want = 0;
    for (const tid of civ.towns) { const t = this.sim.towns[tid]; if (t) { stock += t.stock[r]; want += t.want[r]; } }
    const ratio = (want + 5) / (stock + 5);
    return base * Math.max(0.25, Math.min(4, ratio));
  }

  // ------------------------------------------------------------ logistics
  planShipments(town, civ) {
    const sim = this.sim;
    // clean finished
    town.shipments = town.shipments.filter((s) => !s.done && sim.tick - s.created < CFG.TICKS_PER_DAY * 6);
    if (civ.towns.length < 2) return;
    // this town ships surplus to deficit towns
    for (const tid of civ.towns) {
      const other = sim.towns[tid];
      if (!other || other === town || !other.alive) continue;
      for (let r = 0; r < NRES; r++) {
        if (r === RES_COINS) continue;
        const surplus = town.stock[r] - town.want[r] * 1.3 - 5;
        const deficit = other.want[r] - other.stock[r];
        if (surplus > 4 && deficit > 4) {
          const amt = Math.min(surplus, deficit, 60);
          const pending = town.shipments.filter((s) => s.to === other.id && s.res === r && !s.done).length;
          if (pending < 2) town.shipments.push({ from: town.id, to: other.id, res: r, amt, assigned: -1, done: false, created: sim.tick });
        }
      }
    }
    // colonial support: established towns send basic supplies to young towns
    for (const tid of civ.towns) {
      const other = sim.towns[tid];
      if (!other || other === town || !other.alive || other.pop > 80 || town.pop < 150) continue;
      for (const k of ['wood', 'stone', 'grain', 'bread', 'lumber', 'tools', 'clay', 'bricks']) {
        const r = R(k);
        const give = Math.min(town.stock[r] * 0.08, 40, Math.max(0, other.want[r] - other.stock[r]));
        const pending = town.shipments.some((s) => s.to === other.id && s.res === r && !s.done);
        if (give > 5 && !pending) town.shipments.push({ from: town.id, to: other.id, res: r, amt: give, assigned: -1, done: false, created: sim.tick });
      }
    }
    if (town.shipments.length > 30) town.shipments.splice(0, town.shipments.length - 30);
  }

  takeShipment(i, town) {
    const sim = this.sim, P = sim.people;
    for (const s of town.shipments) {
      if (s.done || (s.assigned >= 0 && P.civ[s.assigned] >= 0 && P.target2[s.assigned] === s.id)) continue;
      if (town.stock[s.res] < 1) { s.done = true; continue; }
      const dest = sim.towns[s.to];
      if (!dest || !dest.alive) { s.done = true; continue; }
      // trains / ships take over long hauls if available
      if (sim.transport.tryBulk(town, dest, s)) continue;
      s.id = s.id || (sim.shipSerial = (sim.shipSerial || 0) + 1);
      s.assigned = i;
      P.target2[i] = s.id;
      P.target[i] = town.id;
      const src = sim.buildings[town.center];
      const [x, y] = src ? [src.cx, src.cy] : [town.cx, town.cy];
      goTo(sim, i, x + (rand() - 0.5) * 4, y + (rand() - 0.5) * 4, A.PICKUP);
      this.current(i, s);
      return true;
    }
    return false;
  }

  current(i, s) { this.sim.shipByPerson.set(i, s); }

  pickup(i) {
    const sim = this.sim, P = sim.people;
    const s = sim.shipByPerson.get(i);
    const town = s ? sim.towns[s.from] : null;
    if (!s || !town) { P.state[i] = S.IDLE; return; }
    const prof = PROFESSIONS[P.prof[i]];
    const civ = sim.civs[P.civ[i]];
    const cap = 10 * (prof.carry || 1) * civ.mod.carry;
    const amt = town.take(s.res, Math.min(cap, s.amt));
    if (amt <= 0) { s.done = true; sim.shipByPerson.delete(i); P.state[i] = S.IDLE; return; }
    if (prof.vehicle === 'truck') town.take(R('fuel'), 0.2);
    P.carryRes[i] = s.res; P.carryAmt[i] = amt;
    s.amt -= amt;
    if (s.amt <= 1) s.done = true;
    const dest = sim.towns[s.to];
    const c = dest ? sim.buildings[dest.center] : null;
    if (!dest) { P.state[i] = S.IDLE; return; }
    const [x, y] = c ? [c.cx, c.cy] : [dest.cx, dest.cy];
    goTo(sim, i, x + (rand() - 0.5) * 4, y + (rand() - 0.5) * 4, A.DROPOFF);
    P.target[i] = dest.id;
  }

  dropoff(i) {
    const sim = this.sim, P = sim.people;
    const dest = sim.towns[P.target[i]];
    if (dest && P.carryAmt[i] > 0) dest.add(P.carryRes[i], P.carryAmt[i]);
    P.carryAmt[i] = 0;
    sim.shipByPerson.delete(i);
    // head back home
    const home = sim.towns[P.town[i]];
    const c = home ? sim.buildings[home.center] : null;
    if (c && home !== dest) goTo(sim, i, c.cx, c.cy, A.WANDER);
    else P.state[i] = S.IDLE;
  }
}

export { STRUCTURES, FOOD_RES, B };

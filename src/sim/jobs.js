// Labour market and housing: assigns people to job slots (weighted by need,
// skill and personal belief affinity) and homeless people to houses.
import { CFG } from '../config.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { R, RESOURCES } from '../data/resources.js';
import { B } from '../data/beliefs.js';
import { S } from './people.js';
import { rand, chance } from '../util/rng.js';

const P_LABORER = PROF_INDEX.laborer;
const P_BUILDER = PROF_INDEX.builder;
const P_THIEF = PROF_INDEX.thief;

export class Jobs {
  constructor(sim) { this.sim = sim; }

  setProf(i, pid, bid) {
    const sim = this.sim, P = sim.people;
    const old = P.work[i];
    if (old >= 0) {
      const ob = sim.buildings[old];
      if (ob) { const k = ob.workers.indexOf(i); if (k >= 0) ob.workers.splice(k, 1); }
    }
    const civ = sim.civs[P.civ[i]];
    if (civ) { civ.profCount[P.prof[i]]--; civ.profCount[pid]++; }
    P.prof[i] = pid;
    P.work[i] = bid;
    sim.everProf.add(pid);
    if (bid >= 0) sim.buildings[bid].workers.push(i);
    P.skill[i] *= 0.4;
    P.color[i] = 0;
    sim.speedCache[i] = sim.computeSpeed(i);
    if (PROFESSIONS[pid].mil) P.health[i] = Math.min(100, P.health[i]);
  }

  // Priority of a profession slot in a town given current needs.
  priority(town, civ, b, pid) {
    const sim = this.sim;
    const p = PROFESSIONS[pid];
    const def = b.def;
    let pr = 1;
    const food = town.foodDays;
    const foodNeed = food < 4 ? 8 : food < 8 ? 5 : food < 15 ? 3 : food < 30 ? 1.8 : 1.1;
    switch (p.kind) {
      case 'harvest': case 'field': case 'hunt': {
        const outs = outputsOf(def);
        let isFood = false, need = 0;
        for (const r of outs) { if (RESOURCES[r].food >= 0.6) isFood = true; need = Math.max(need, deficit(town, r)); }
        pr = isFood ? 1.5 + foodNeed + need * 2 : 1.4 + need * 3;
        if (def.id === 'gatherer_camp' && civ.has('agriculture')) pr *= 0.6;
        if (def.id === 'farm') pr *= 1.3;
        if (b.exhausted > 3) pr *= 0.2;
        if (p.kind === 'field' && sim.season === 3 && !(def.field && def.field.animals)) pr *= 0.3;
        break;
      }
      case 'craft': {
        const outs = outputsOf(def);
        let need = 0;
        for (const r of outs) need = Math.max(need, deficit(town, r));
        pr = 1.0 + need * 3;
        if (def.recipes && def.recipes.some((rc) => rc.power)) pr = 3 + (town.powerDemand > town.powerSupply ? 3 : 0);
        if (b.stalled > 4) pr *= 0.3;
        if (outs.some((r) => RESOURCES[r].food > 0 || RESOURCES[r].id === 'flour')) pr += foodNeed * 0.9;
        break;
      }
      case 'builder': pr = 1.6 + Math.min(4, town.construction.length * 0.8); break;
      case 'military': case 'watchman': {
        const target = sim.military.desiredSoldiers(civ);
        pr = civ.soldiers < target ? 2.2 + (sim.military.atWar(civ.id) ? 4 : 0) : 0;
        break;
      }
      case 'guard': pr = 1 + Math.min(3, town.crime * 0.2); break;
      case 'porter': pr = 0.9 + Math.min(3, town.shipments.length * 0.5); break;
      case 'trader': case 'diplomat': case 'spy': case 'missionary':
        pr = sim.diplomacy.anyContact(civ.id) ? 1.3 : 0; break;
      case 'scout': pr = civ.exploredCount < CFG.NW * CFG.NH * 0.5 ? 1.5 : 0.4; break;
      case 'teacher': pr = 1.2 + town.children * 0.02; break;
      case 'healer': pr = 1.2 + town.sick * 0.1; break;
      case 'road': pr = 1.1; break;
      default: pr = 1.1;
    }
    if (p.fx.research) pr *= 0.9 + civ.mod.research * 0.3;
    if (p.fx.faith) pr *= 0.7 + Math.max(0, civ.beliefAvg[B.PIETY]) * 0.02;
    if (p.fx.culture) pr *= 0.8 + Math.max(0, civ.beliefAvg[B.ART]) * 0.015;
    if (civ.isBanned(p.id)) pr = 0;
    return pr;
  }

  assignTown(town) {
    const sim = this.sim, P = sim.people;
    const civ = sim.civs[town.civ];
    // gather open slots
    const slots = [];
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b || !b.built) continue;
      if (b.banned) { if (b.workers.length) for (const w of [...b.workers]) this.setProf(w, P_LABORER, -1); continue; }
      for (const [pid, n] of b.slotList) {
        let have = 0;
        for (const w of b.workers) if (P.prof[w] === pid) have++;
        if (have > n) {
          // over-staffed (e.g. slots shrank)
          for (const w of [...b.workers]) if (P.prof[w] === pid && have > n) { this.setProf(w, P_LABORER, -1); have--; }
        }
        if (have < n) {
          const pr = this.priority(town, civ, b, pid);
          if (pr > 0) slots.push({ b, pid, open: n - have, pr: pr * (0.9 + rand() * 0.2) });
        }
      }
    }
    if (!slots.length) return;
    slots.sort((a, b) => b.pr - a.pr);
    // candidates: idle adults
    const cands = [];
    for (const i of town.residentsList) {
      if (P.civ[i] !== town.civ) continue;
      if (P.age[i] < CFG.ADULT_AGE || P.age[i] > CFG.ELDER_AGE + 4) continue;
      if (P.army[i] >= 0 || P.state[i] === S.JAIL || P.state[i] === S.INSIDE) continue;
      if (P.prof[i] === P_THIEF) continue;
      if (P.work[i] < 0) cands.push(i);
    }
    // reallocation: when valuable slots stay empty, workers leave the least
    // useful jobs (urgent needs pull harder and faster)
    const top = slots[0].pr;
    if (cands.length < 3 && top > 1.5) {
      const urgent = top > 4;
      const famine = town.feedRatio < 0.75;
      const limit = famine ? 18 : urgent ? 6 : 2;
      const thresh = top * (urgent ? 0.3 : 0.45);
      let pulled = 0;
      const list = town.residentsList;
      const start = (rand() * list.length) | 0;
      for (let k = 0; k < list.length && pulled < limit; k++) {
        const i = list[(start + k) % list.length];
        const w = P.work[i];
        if (w < 0 || P.army[i] >= 0 || P.civ[i] !== town.civ) continue;
        const b = sim.buildings[w];
        if (!b || PROFESSIONS[P.prof[i]].mil) continue;
        const cur = this.priority(town, civ, b, P.prof[i]);
        if (cur < thresh) { this.setProf(i, P_LABORER, -1); cands.push(i); pulled++; }
      }
    }
    if (!cands.length) return;
    let assigned = 0;
    const maxAssign = 6 + (cands.length >> 2);
    for (const s of slots) {
      if (!cands.length || assigned >= maxAssign) break;
      const p = PROFESSIONS[s.pid];
      const isMil = !!p.mil && p.kind === 'military';
      for (let k = 0; k < s.open && cands.length && assigned < maxAssign; k++) {
        // pick best candidate among a sample
        let best = -1, bs = -1e9;
        const merit = civ.beliefAvg[B.MERIT];
        const sample = Math.min(cands.length, 14);
        for (let t = 0; t < sample; t++) {
          const ci = (rand() * cands.length) | 0;
          const i = cands[ci];
          let sc = 0;
          for (const [key, wgt] of Object.entries(p.aff)) sc += P.b(i, B[key.toUpperCase()]) * wgt;
          if (p.fx.research || p.kind === 'teacher') sc += P.edu[i] * (0.5 + merit * 0.01);
          if (isMil) sc += (40 - Math.abs(P.age[i] - 24)) + P.b(i, B.AGGRESSION) * 0.5 + P.b(i, B.PATRIOTISM) * 0.3;
          sc -= Math.hypot(P.x[i] - s.b.cx, P.y[i] - s.b.cy) * 0.15;
          sc += rand() * (40 - merit * 0.2);
          if (sc > bs) { bs = sc; best = ci; }
        }
        if (best < 0) break;
        const i = cands[best];
        // soldiers need equipment
        if (isMil && p.equip) {
          let ok = true;
          for (const [res, n] of Object.entries(p.equip)) if (town.stock[R(res)] < n) { ok = false; break; }
          if (!ok) break;
          for (const [res, n] of Object.entries(p.equip)) town.take(R(res), n);
        }
        // pacifists refuse to fight unless conscripted by an authoritarian state
        if (isMil && P.b(i, B.AGGRESSION) < -50 && civ.beliefAvg[B.AUTHORITY] < 30 && chance(0.7)) { cands.splice(best, 1); continue; }
        this.setProf(i, s.pid, s.b.id);
        cands[best] = cands[cands.length - 1]; cands.pop();
        assigned++;
      }
    }
  }

  // Assign homeless residents to houses with free space.
  houseTown(town) {
    const sim = this.sim, P = sim.people;
    const houses = [];
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (b && b.built && b.capacity > 0 && b.residents.length < b.capacity) houses.push(b);
    }
    if (!houses.length) return;
    let hi = 0;
    for (const i of town.residentsList) {
      if (P.home[i] >= 0 || P.civ[i] !== town.civ) continue;
      // join partner's or mother's home if possible
      let target = null;
      const pa = P.partner[i] >= 0 ? P.home[P.partner[i]] : -1;
      const mo = P.mother[i] >= 0 && P.civ[P.mother[i]] >= 0 ? P.home[P.mother[i]] : -1;
      for (const h of [pa, mo]) {
        const b = h >= 0 ? sim.buildings[h] : null;
        if (b && b.built && b.residents.length < b.capacity) { target = b; break; }
      }
      if (!target) {
        while (hi < houses.length && houses[hi].residents.length >= houses[hi].capacity) hi++;
        if (hi >= houses.length) break;
        target = houses[hi];
      }
      this.moveIn(i, target);
    }
  }

  moveIn(i, b) {
    const sim = this.sim, P = sim.people;
    const old = P.home[i];
    if (old >= 0) { const ob = sim.buildings[old]; if (ob) { const k = ob.residents.indexOf(i); if (k >= 0) ob.residents.splice(k, 1); } }
    P.home[i] = b.id;
    b.residents.push(i);
  }

  leaveHome(i) {
    const sim = this.sim, P = sim.people;
    const old = P.home[i];
    if (old >= 0) { const ob = sim.buildings[old]; if (ob) { const k = ob.residents.indexOf(i); if (k >= 0) ob.residents.splice(k, 1); } }
    P.home[i] = -1;
  }
}

function deficit(town, r) {
  const want = town.want[r];
  if (want <= 0) return 0;
  return Math.max(0, Math.min(1.5, (want - town.stock[r]) / want));
}

const outCache = new Map();
export function outputsOf(def) {
  if (outCache.has(def.id)) return outCache.get(def.id);
  const out = new Set();
  if (def.harvest && def.harvest.dep) for (const d of def.harvest.dep) { const res = DEP_RES_ID[d]; if (res) out.add(R(res)); }
  if (def.harvest && def.harvest.animals) { out.add(R('meat')); out.add(R('hides')); }
  if (def.field) { out.add(R(def.field.out)); for (const k of Object.keys(def.field.extra || {})) out.add(R(k)); }
  for (const rc of def.recipes || []) for (const k of Object.keys(rc.out)) out.add(R(k));
  const arr = [...out];
  outCache.set(def.id, arr);
  return arr;
}

import { DEPOSITS } from '../world/terrain.js';
const DEP_RES_ID = DEPOSITS.map((d) => d.res || null);
export { P_BUILDER };

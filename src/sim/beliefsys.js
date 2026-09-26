// Belief dynamics: social conformity, building auras, professions, doctrine,
// foreign contact, prophets and civilisation-level adoption & bans.
import { CFG } from '../config.js';
import { SCALES, NB, B, BELIEFS } from '../data/beliefs.js';
import { STRUCTURES } from '../data/structures.js';
import { PROFESSIONS } from '../data/professions.js';
import { rand, randInt, chance } from '../util/rng.js';

export class BeliefSystem {
  constructor(sim) {
    this.sim = sim;
    this.acc = 0;
    this.cursor = 0;
    this.prophets = [];
  }

  step(dt) {
    const sim = this.sim, P = sim.people;
    this.acc += dt;
    if (this.acc < CFG.BELIEF_INTERVAL) return;
    this.acc = 0;
    // 1. social diffusion over a rolling sample
    const n = Math.min(P.hwm, Math.max(200, P.count * 0.12) | 0);
    for (let k = 0; k < n; k++) {
      if (this.cursor >= P.hwm) this.cursor = 0;
      const i = this.cursor++;
      if (P.civ[i] < 0 || P.state[i] === 9) continue;
      this.socialise(i);
    }
    // 2. building auras
    for (const b of sim.buildings) {
      if (!b || !b.built || !b.def.aura || !b.def.aura.beliefs) continue;
      if (b.def.jobs && b.def.jobCount && !b.workers.length && !b.def.passive) continue;
      const aura = b.def.aura;
      const staff = b.def.jobCount ? 0.5 + b.workers.length / b.def.jobCount : 1;
      const entries = Object.entries(aura.beliefs);
      let cnt = 0;
      sim.spatial.query(b.cx, b.cy, aura.radius, (j) => {
        if (P.civ[j] !== b.civ) return false;
        if (chance(0.5)) return false;
        for (const [k, v] of entries) P.persuade(j, B[k.toUpperCase()], v * 3 * staff);
        return ++cnt > 120;
      });
    }
    // 3. prophets
    for (let k = this.prophets.length - 1; k >= 0; k--) {
      const pr = this.prophets[k];
      if (P.civ[pr.i] < 0 || sim.tick > pr.until) { this.prophets.splice(k, 1); continue; }
      sim.spatial.query(P.x[pr.i], P.y[pr.i], 26, (j) => {
        P.pushB(j, pr.scale, pr.dir * 2.5);
        return false;
      });
    }
  }

  socialise(i) {
    const sim = this.sim, P = sim.people;
    let partner = -1, seen = 0;
    const target = randInt(4);
    sim.spatial.query(P.x[i], P.y[i], 7, (j) => {
      if (j === i) return false;
      if (seen++ === target) { partner = j; return true; }
      partner = j;
      return false;
    });
    if (partner < 0) return;
    const j = partner;
    if (P.civ[j] === P.civ[i]) {
      // conformity: converge on a few random scales; charisma (edu/age) matters
      const wi = 0.06 + (P.age[j] > P.age[i] ? 0.02 : 0) + (P.edu[j] > P.edu[i] ? 0.02 : 0);
      for (let k = 0; k < 3; k++) {
        const s = randInt(NB);
        const bi = P.b(i, s), bj = P.b(j, s);
        P.pushB(i, s, (bj - bi) * wi - bi * 0.004);
      }
    } else {
      // foreign contact
      const war = sim.military.atWarBetween(P.civ[i], P.civ[j]);
      if (war) { P.pushB(i, B.XENOPHILIA, -1.5); P.pushB(i, B.AGGRESSION, 0.5); P.pushB(i, B.FORGIVENESS, -0.5); }
      else {
        P.pushB(i, B.XENOPHILIA, 0.5);
        const s = randInt(NB);
        P.pushB(i, s, (P.b(j, s) - P.b(i, s)) * 0.01);
      }
    }
  }

  // Push person i toward the civ's adopted doctrine.
  doctrinePush(i, count = 6) {
    const sim = this.sim, P = sim.people;
    const civ = sim.civs[P.civ[i]];
    let n = 0;
    sim.spatial.query(P.x[i], P.y[i], 30, (j) => {
      if (P.civ[j] !== civ.id) return false;
      for (let k = 0; k < 2; k++) {
        const s = randInt(NB);
        if (civ.adopted[s]) P.persuade(j, s, civ.adopted[s] * 1.2);
      }
      return ++n > count;
    });
  }

  // A shock pushes a fraction of a civ's people on one scale.
  shock(civId, scale, amount, fraction = 0.3) {
    const sim = this.sim, P = sim.people;
    for (let i = 0; i < P.hwm; i++) {
      if (P.civ[i] !== civId || !chance(fraction)) continue;
      P.pushB(i, scale, amount * (0.5 + rand()));
    }
  }

  // Daily: averages, adoption, bans, government.
  daily() {
    const sim = this.sim, P = sim.people;
    const nc = sim.civs.length;
    const sums = new Float64Array(nc * NB);
    const counts = new Float64Array(nc);
    for (let i = 0; i < P.hwm; i++) {
      const c = P.civ[i];
      if (c < 0 || P.age[i] < CFG.ADULT_AGE) continue;
      counts[c]++;
      const base = i * NB, o = c * NB;
      for (let s = 0; s < NB; s++) sums[o + s] += P.beliefs[base + s];
    }
    for (const civ of sim.civs) {
      if (!civ.alive || !counts[civ.id]) continue;
      for (let s = 0; s < NB; s++) civ.beliefAvg[s] = sums[civ.id * NB + s] / counts[civ.id];
      const changes = civ.updateAdoption();
      for (const ch of changes) {
        const sc = SCALES[ch.scale];
        if (ch.to !== 0) sim.chronicle(`${civ.name} embraces ${ch.to > 0 ? sc.pos.name : sc.neg.name}.`, civ.id, 'belief');
        else sim.chronicle(`${civ.name} abandons ${ch.from > 0 ? sc.pos.name : sc.neg.name}.`, civ.id, 'belief');
      }
      const { added, removed } = civ.updateBans();
      for (const b of added) sim.onBan(civ, b, true);
      for (const b of removed) sim.onBan(civ, b, false);
      if (civ.computeGovernment()) sim.chronicle(`${civ.name} becomes a ${civ.government}.`, civ.id, 'government');
      // prophets arise now and then
      if (chance(1 / (CFG.DAYS_PER_YEAR * 6))) this.spawnProphet(civ);
    }
    // wartime identity: peoples at war define themselves against the enemy's creed
    if (sim.day % 3 === 0) {
      for (const civ of sim.civs) {
        if (!civ.alive) continue;
        for (const foe of sim.civs) {
          if (foe === civ || !foe.alive || !sim.military.atWarBetween(civ.id, foe.id)) continue;
          const scales = [];
          for (let s = 0; s < NB; s++) if (foe.adopted[s] && foe.adopted[s] !== civ.adopted[s]) scales.push(s);
          if (!scales.length) continue;
          for (let k = 0; k < 2; k++) {
            const s = scales[randInt(scales.length)];
            this.shock(civ.id, s, -foe.adopted[s] * 2, 0.08);
          }
        }
      }
    }
  }

  spawnProphet(civ) {
    const sim = this.sim, P = sim.people;
    let pick = -1;
    for (let k = 0; k < 50; k++) {
      const i = randInt(Math.max(1, P.hwm));
      if (P.civ[i] === civ.id && P.age[i] > 20 && P.age[i] < 60) { pick = i; break; }
    }
    if (pick < 0) return;
    const scale = randInt(NB);
    const dir = chance(0.5) ? 1 : -1;
    P.setB(pick, scale, dir * 100);
    P.flags[pick] |= 16;
    this.prophets.push({ i: pick, scale, dir, until: sim.tick + CFG.TICKS_PER_YEAR * 3 });
    const pole = dir > 0 ? SCALES[scale].pos : SCALES[scale].neg;
    const town = sim.towns[P.town[pick]];
    sim.chronicle(`A prophet, ${sim.personName(pick)}, rises in ${town ? town.name : 'the wilds'} preaching ${pole.name}.`, civ.id, 'prophet', pick);
  }
}

export { BELIEFS, STRUCTURES, PROFESSIONS };

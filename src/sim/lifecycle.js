// Daily life of every person: eating, luxuries, faith, disease, happiness,
// loyalty, crime, partnership, births, ageing, death and migration.
import { CFG } from '../config.js';
import { S, A } from './people.js';
import { B, NB, SCALES } from '../data/beliefs.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { R, RESOURCES, LUX_RES } from '../data/resources.js';
import { rand, randInt, chance, gauss } from '../util/rng.js';
import { goTo } from './movement.js';

const P_LABORER = PROF_INDEX.laborer;
const P_THIEF = PROF_INDEX.thief;
const RES_CLOTHING = R('clothing');
const RES_COINS = R('coins');

export class Lifecycle {
  constructor(sim) {
    this.sim = sim;
    this.cursor = 0;
    this.acc = 0;
  }

  // Process a slice of the population so each person is visited once per day.
  step(dt) {
    const sim = this.sim, P = sim.people;
    const n = P.hwm;
    if (!n) return;
    this.acc += n * dt / CFG.TICKS_PER_DAY;
    let k = this.acc | 0;
    this.acc -= k;
    while (k-- > 0) {
      if (this.cursor >= P.hwm) this.cursor = 0;
      const i = this.cursor++;
      if (P.civ[i] >= 0) this.daily(i);
    }
  }

  daily(i) {
    const sim = this.sim, P = sim.people;
    const civ = sim.civs[P.civ[i]];
    const town = sim.towns[P.town[i]];
    if (!town || !town.alive) { this.reassignTown(i); return; }
    const oldAge = P.age[i];
    P.age[i] += 1 / CFG.DAYS_PER_YEAR;
    const age = P.age[i];
    const adult = age >= CFG.ADULT_AGE;
    if (oldAge < CFG.ADULT_AGE && adult) { P.color[i] = 0; sim.speedCache[i] = sim.computeSpeed(i); }
    // retirement
    if (age > CFG.ELDER_AGE + 3 + P.b(i, B.DILIGENCE) * 0.05 && P.work[i] >= 0 && !PROFESSIONS[P.prof[i]].mil) sim.jobs.setProf(i, P_LABORER, -1);

    // --- food (town distributes; inequality skews shares)
    let share = town.feedRatio;
    if (share < 1) {
      const ineq = Math.max(0, civ.beliefAvg[B.HIERARCHY] - civ.beliefAvg[B.EMPATHY] * 0.5 + 20) / 100;
      const status = P.work[i] >= 0 ? (PROFESSIONS[P.prof[i]].cat === 'government' ? 1 : 0.6) : 0.2;
      share = Math.max(0, Math.min(1, share + (status - 0.5) * (1 - share) * ineq * 2));
      // empathetic people share what they have with the hungry
      if (P.b(i, B.EMPATHY) > 40 && P.food[i] > 60) share = Math.max(share, 0.7);
    }
    if (share >= 0.95) P.food[i] = Math.min(100, P.food[i] + 45);
    else P.food[i] -= 45 * (1 - share);
    if (P.food[i] <= 0) {
      P.food[i] = 0;
      P.health[i] -= 6;
      if (P.b(i, B.EMPATHY) > -50) P.pushB(i, B.EMPATHY, -0.5);
      if (P.health[i] <= 0) { sim.kill(i, 'starvation'); civ.stats.starved++; return; }
    } else if (P.health[i] < 100 && P.sick[i] <= 0) {
      P.health[i] = Math.min(100, P.health[i] + 2.5 * civ.mod.health + (P.food[i] > 70 ? 1 : 0));
    }

    // --- luxuries
    const hed = P.b(i, B.HEDONISM), mat = -P.b(i, B.SPIRITUALITY);
    const desire = 0.25 + (hed + mat) * 0.004;
    P.lux[i] *= 0.82;
    if (adult && chance(Math.max(0.05, desire) * civ.mod.consume * 0.6)) {
      const r = LUX_RES[randInt(LUX_RES.length)];
      if (town.stock[r] > 0.2) { town.take(r, 0.15); P.lux[i] = Math.min(1, P.lux[i] + RESOURCES[r].lux * 0.5); }
    }
    // clothing in winter in cold places
    if (sim.season === 3 && adult) {
      const t = sim.world.temp[(P.y[i] | 0) * sim.world.W + (P.x[i] | 0)];
      if (t < 0.4) {
        if (town.stock[RES_CLOTHING] > 0.05) town.take(RES_CLOTHING, 0.02);
        else if (chance(0.3)) P.health[i] -= 3;
      }
    }
    // faith satisfaction decays
    P.faithSat[i] = Math.max(0, P.faithSat[i] - 9);

    // --- disease
    if (P.sick[i] > 0) {
      P.sick[i] -= 1;
      P.health[i] -= 6 * sim.events.virulence / Math.max(0.4, civ.mod.health);
      if (P.health[i] <= 0) { sim.kill(i, 'plague'); return; }
      if (P.sick[i] <= 0) { P.immune[i] = 6 + rand() * 6; }
      else sim.events.spread(i);
    } else if (P.immune[i] > 0) P.immune[i] -= 1 / CFG.DAYS_PER_YEAR;

    // --- happiness
    this.happiness(i, civ, town, adult);

    // --- mortality
    const eff = age - civ.mod.lifespan;
    let hz = 0.0005 * Math.exp(0.085 * eff);
    if (age < 2) hz += 0.04 / Math.max(0.5, civ.mod.health);
    if (P.health[i] < 30) hz += 0.2;
    if (chance(hz / CFG.DAYS_PER_YEAR)) { sim.kill(i, age > 55 ? 'old age' : 'illness'); return; }

    if (!adult) return;

    // --- crime
    const prof = P.prof[i];
    if (prof === P_THIEF) {
      if (P.happy[i] > 62 && chance(0.06)) { sim.jobs.setProf(i, P_LABORER, -1); P.flags[i] &= ~3; }
    } else if (P.work[i] < 0 && P.army[i] < 0 && P.happy[i] < 38) {
      const vice = -P.b(i, B.EMPATHY) - P.b(i, B.LAW) - P.b(i, B.HONESTY) - P.b(i, B.CHARITY) * 0.5;
      const p = 0.004 * civ.mod.crime * Math.max(0, vice + 20) / 60 * (P.food[i] < 30 ? 2 : 1);
      if (chance(p)) { sim.jobs.setProf(i, P_THIEF, -1); P.flags[i] |= 1; }
    }

    // --- partnership
    if (P.partner[i] < 0 && age >= 16 && age < 55 && chance(0.25)) this.findPartner(i, town);
    else if (P.partner[i] >= 0 && P.civ[P.partner[i]] < 0) P.partner[i] = -1;

    // --- pregnancy & birth
    if (P.sex[i] === 1) {
      if (P.preg[i] > 0) {
        P.preg[i] -= 1;
        if (P.preg[i] <= 0) { P.preg[i] = 0; sim.birth(i); }
      } else if (P.partner[i] >= 0 && age >= 16 && age < 45) {
        const kids = P.flags[i] >> 5; // small counter stored in high bits
        const housing = town.housingCap > town.pop ? 1 : 0.35;
        const fam = 1 + P.b(i, B.FAMILY) * 0.007;
        const p = 0.03 * civ.mod.birth * fam * town.feedRatio * housing * (0.5 + P.happy[i] / 100) / (1 + kids * 0.35);
        if (chance(p)) P.preg[i] = 9;
      }
    }

    // --- loyalty, emigration and internal migration
    const pat = P.b(i, B.PATRIOTISM);
    P.loyalty[i] += ((P.happy[i] + pat * 0.3 + 15) * civ.mod.loyalty - P.loyalty[i]) * 0.06;
    if (P.loyalty[i] < 22 && P.b(i, B.XENOPHILIA) > 10 && chance(0.02 * civ.mod.immigration * 0.5 + 0.005)) this.emigrate(i, civ, town);
    else if (P.food[i] < 15 && town.feedRatio < 0.6 && chance(0.04)) this.flee(i, civ, town);
    else if (P.work[i] < 0 && P.home[i] < 0 && chance(0.03 + Math.max(0, P.b(i, B.MOBILITY)) * 0.001)) this.internalMigrate(i, civ, town);
  }

  happiness(i, civ, town, adult) {
    const sim = this.sim, P = sim.people;
    let h = 52 + civ.mod.happy;
    const fed = P.food[i];
    h += fed > 70 ? 8 : fed > 40 ? 0 : -20;
    const nomad = P.b(i, B.MOBILITY);
    h += P.home[i] >= 0 ? 6 : -12 * (1 - Math.max(0, nomad) / 120);
    const hed = P.b(i, B.HEDONISM);
    h += P.lux[i] * 16 * (1 + hed / 120);
    if (hed > 30 && P.lux[i] < 0.15) h -= 6;
    const piety = P.b(i, B.PIETY);
    if (piety > 20) h += P.faithSat[i] > 40 ? 6 : -8 * piety / 100;
    h += (P.health[i] - 70) * 0.18;
    if (adult && P.work[i] < 0 && P.age[i] < CFG.ELDER_AGE) h -= 5 * (1 + P.b(i, B.DILIGENCE) / 100);
    if (sim.military.atWar(civ.id)) h += -4 + P.b(i, B.AGGRESSION) * 0.08;
    h += sim.auraHappy(P.x[i], P.y[i], civ.id);
    h += Math.min(12, (town.happyPts || 0) / Math.max(10, town.pop) * 30);
    h -= Math.min(12, town.crime * 0.4);
    h -= town.pollution * (0.5 + Math.max(0, P.b(i, B.NATURE)) / 60);
    if (town.pop > town.housingCap * 1.15 && town.housingCap > 0) h -= 4;
    // ideological dissonance with the civilisation's adopted doctrine
    let dis = 0;
    for (let k = 0; k < 6; k++) {
      const s = (i + k * 7 + sim.day) % NB;
      const a = civ.adopted[s];
      if (a && P.b(i, s) * a < -35) dis += 2;
    }
    h -= Math.min(12, dis);
    if (civ.goldenAge > 0) h += 5;
    // stoics shrug off misery; passionate people amplify it
    const sto = P.b(i, B.STOICISM);
    if (h < 50) h = 50 - (50 - h) * (1 - sto / 250);
    const opt = P.b(i, B.OPTIMISM);
    h += opt * 0.05;
    P.happy[i] += (Math.max(0, Math.min(100, h)) - P.happy[i]) * 0.3;
  }

  findPartner(i, town) {
    const sim = this.sim, P = sim.people;
    const list = town.residentsList;
    if (!list || list.length < 2) return;
    for (let t = 0; t < 12; t++) {
      const j = list[randInt(list.length)];
      if (j === i || P.civ[j] !== P.civ[i] || P.partner[j] >= 0 || P.sex[j] === P.sex[i]) continue;
      if (P.age[j] < 16 || Math.abs(P.age[j] - P.age[i]) > 12) continue;
      if (P.mother[i] >= 0 && P.mother[i] === P.mother[j]) continue;
      P.partner[i] = j; P.partner[j] = i;
      // move in together
      const hi = P.home[i] >= 0 ? sim.buildings[P.home[i]] : null;
      const hj = P.home[j] >= 0 ? sim.buildings[P.home[j]] : null;
      if (hi && hi.residents.length < hi.capacity + 1 && (!hj || hj !== hi)) sim.jobs.moveIn(j, hi);
      else if (hj && !hi) sim.jobs.moveIn(i, hj);
      // partners' beliefs converge a little
      for (let k = 0; k < 5; k++) {
        const s = randInt(NB);
        const d = P.b(j, s) - P.b(i, s);
        P.pushB(i, s, d * 0.15); P.pushB(j, s, -d * 0.15);
      }
      return;
    }
  }

  emigrate(i, civ, town) {
    const sim = this.sim, P = sim.people;
    // choose the most attractive foreign civ in contact
    let best = null, bs = -1e9;
    for (const other of sim.civs) {
      if (!other.alive || other.id === civ.id || !civ.contact[other.id]) continue;
      if (sim.military.atWarBetween(civ.id, other.id)) continue;
      if (other.beliefAvg[B.HOSPITALITY] < -30 || other.mod.immigration < 0.4) continue;
      let sim_ = 0;
      for (let s = 0; s < NB; s += 3) sim_ -= Math.abs(P.b(i, s) - other.beliefAvg[s]);
      const sc = other.happiness * 2 + sim_ * 0.05 + (other.mod.immigration - 1) * 30;
      if (sc > bs) { bs = sc; best = other; }
    }
    if (!best || best.happiness < civ.happiness + 5) return;
    const dest = sim.nearestTownOfCiv(best.id, P.x[i], P.y[i]);
    if (!dest) return;
    const c = sim.buildings[dest.center];
    const [x, y] = c ? [c.cx, c.cy] : [dest.cx, dest.cy];
    if (P.work[i] >= 0) sim.jobs.setProf(i, P_LABORER, -1);
    goTo(sim, i, x + (rand() - 0.5) * 10, y + (rand() - 0.5) * 10, A.MIGRATE);
    P.target[i] = dest.id;
  }

  // Famine refugees head for a better-fed town: their own civ's first, else a neighbour's.
  flee(i, civ, town) {
    const sim = this.sim, P = sim.people;
    let best = null, bs = 0.8;
    for (const t of sim.towns) {
      if (!t || !t.alive || t === town || t.feedRatio < 0.95 || t.foodDays < 6) continue;
      if (t.civ !== civ.id) {
        const other = sim.civs[t.civ];
        if (!civ.contact[t.civ] || sim.military.atWarBetween(civ.id, t.civ) || other.beliefAvg[B.HOSPITALITY] < -35) continue;
      }
      const d = Math.hypot(t.cx - P.x[i], t.cy - P.y[i]);
      const sc = (t.civ === civ.id ? 2 : 1) * t.foodDays / (1 + d / 100);
      if (sc > bs) { bs = sc; best = t; }
    }
    if (!best) return;
    if (P.work[i] >= 0) sim.jobs.setProf(i, P_LABORER, -1);
    const c = sim.buildings[best.center];
    const [x, y] = c ? [c.cx, c.cy] : [best.cx, best.cy];
    goTo(sim, i, x + (rand() - 0.5) * 12, y + (rand() - 0.5) * 12, A.MIGRATE);
    P.target[i] = best.id;
    if (best.civ !== civ.id) {
      civ.refugees = (civ.refugees || 0) + 1;
      if (civ.refugees % 20 === 1) sim.chronicle(`Famine refugees flee ${town.name} for ${best.name} in the lands of ${sim.civs[best.civ].name}.`, civ.id, 'migration');
    }
  }

  internalMigrate(i, civ, town) {
    const sim = this.sim, P = sim.people;
    let best = null, bs = 0;
    for (const tid of civ.towns) {
      const t = sim.towns[tid];
      if (!t || t === town || !t.alive) continue;
      const room = t.housingCap - t.pop;
      const sc = room + (t.foodDays - town.foodDays) * 0.5;
      if (sc > bs) { bs = sc; best = t; }
    }
    if (!best || bs < 5) return;
    sim.transferTown(i, best);
    const c = sim.buildings[best.center];
    const [x, y] = c ? [c.cx, c.cy] : [best.cx, best.cy];
    goTo(sim, i, x + (rand() - 0.5) * 12, y + (rand() - 0.5) * 12, A.WANDER);
  }

  reassignTown(i) {
    const sim = this.sim, P = sim.people;
    const t = sim.nearestTownOfCiv(P.civ[i], P.x[i], P.y[i]);
    if (t) sim.transferTown(i, t);
    else sim.kill(i, 'wandered into the wilderness');
  }
}

export function inheritBeliefs(sim, child, mother, father) {
  const P = sim.people;
  const civ = sim.civs[P.civ[child]];
  for (let s = 0; s < NB; s++) {
    const m = P.b(mother, s);
    const f = father >= 0 && P.civ[father] >= 0 ? P.b(father, s) : m;
    let v = (m + f) * 0.5 * 0.85 + civ.beliefAvg[s] * 0.1 + gauss() * 9;
    P.beliefs[child * NB + s] = Math.max(-100, Math.min(100, Math.round(v)));
  }
}

export { SCALES, RES_COINS, S };

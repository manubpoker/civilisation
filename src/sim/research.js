// Research: daily points, belief- and need-driven tech choice, diffusion
// between civilisations in contact, and resource-gated availability.
import { TECHS, ERAS } from '../data/technologies.js';
import { STRUCTURES } from '../data/structures.js';
import { B } from '../data/beliefs.js';
import { R } from '../data/resources.js';
import { rand } from '../util/rng.js';

// early discoveries come quickly; later eras demand industrial-scale science
const ERA_MUL = [1.0, 1.25, 1.6, 2.0, 2.5, 3.0, 3.6, 4.2, 4.8, 5.5];

// category tags per tech derived from what it unlocks
const TECH_TAGS = TECHS.map((t) => {
  const tags = {};
  for (const s of STRUCTURES) if (s.tech === t.id) tags[s.cat] = (tags[s.cat] || 0) + 1;
  for (const k of Object.keys(t.fx)) {
    if (k === 'research' || k === 'edu') tags.knowledge = (tags.knowledge || 0) + 1;
    if (k === 'attack' || k === 'defense' || k === 'morale') tags.military = (tags.military || 0) + 1;
    if (k === 'faith') tags.religion = (tags.religion || 0) + 1;
    if (k === 'trade' || k === 'coins') tags.commerce = (tags.commerce || 0) + 1;
    if (k === 'farm' || k === 'fish' || k === 'hunt') tags.food = (tags.food || 0) + 1;
    if (k === 'health' || k === 'disease' || k === 'lifespan') tags.health = (tags.health || 0) + 1;
    if (k === 'culture' || k === 'happy') tags.culture = (tags.culture || 0) + 1;
    if (k === 'craft' || k === 'build' || k === 'mine' || k === 'gather') tags.industry = (tags.industry || 0) + 1;
  }
  return tags;
});

export class Research {
  constructor(sim) { this.sim = sim; }

  access(civ, resId) {
    const r = R(resId);
    for (const tid of civ.towns) { const t = this.sim.towns[tid]; if (t && t.stock[r] > 0.5) return true; }
    return this.sim.civKnowsDeposit(civ, resId);
  }

  cost(civ, t) {
    const sim = this.sim;
    let c = t.cost * sim.researchCostMul * ERA_MUL[t.era];
    let known = 0, partner = false;
    for (const o of sim.civs) {
      if (o === civ || !o.alive || !civ.contact[o.id] || !o.techs[t.idx]) continue;
      known++;
      if (sim.diplomacy.tradeAllowed(civ.id, o.id)) partner = true;
    }
    if (known) c *= partner ? 0.6 : 0.75;
    return c;
  }

  daily(civ) {
    const sim = this.sim;
    const base = civ.adults * 0.06 + civ.elders * 0.08;
    const rp = (civ.researchToday + base) * civ.mod.research * (civ.goldenAge > 0 ? 1.15 : 1);
    civ.researchRate = civ.researchRate * 0.8 + rp * 0.2;
    civ.researchToday = 0;
    if (civ.researching < 0 || !civ.techAvailable(TECHS[civ.researching], (n) => this.access(civ, n))) this.choose(civ);
    if (civ.researching < 0) return;
    civ.researchPts += rp;
    const t = TECHS[civ.researching];
    const cost = this.cost(civ, t);
    if (civ.researchPts >= cost) {
      civ.researchPts -= cost;
      this.learn(civ, t.idx, 'research');
      this.choose(civ);
    }
  }

  learn(civ, idx, how) {
    const sim = this.sim;
    const t = TECHS[idx];
    const eraBefore = civ.era;
    if (!civ.learn(idx, sim.year)) return;
    civ.stats.techs++;
    sim.onTechLearned(civ, t, how);
    if (civ.era > eraBefore) sim.chronicle(`${civ.name} enters the ${ERAS[civ.era]}.`, civ.id, 'era');
  }

  choose(civ) {
    const sim = this.sim;
    const weights = sim.planner.aiWeights(civ);
    let best = -1, bs = -1e9;
    const fd = sim.civFoodDays(civ);
    for (const t of TECHS) {
      if (!civ.techAvailable(t, (n) => this.access(civ, n))) continue;
      const tags = TECH_TAGS[t.idx];
      let s = 1;
      for (const [cat, n] of Object.entries(tags)) s += (weights[cat] || 0) * 0.6 * n;
      if (tags.food && fd < 12) s += 2;
      if (tags.military && sim.military.atWar(civ.id)) s += 2;
      if (tags.health && sim.civSickRatio(civ) > 0.05) s += 1.5;
      if (t.fx.research) s += 0.6;
      if (t.flags.roadLevel || t.flags.rail) s += 0.4;
      // prefer rounding out the current era before racing ahead
      s *= Math.pow(0.75, Math.max(0, t.era - civ.era));
      // pious civs slow-walk heretical sciences
      if (civ.beliefAvg[B.PIETY] > 40 && (t.id === 'genetics' || t.id === 'scientific_method')) s *= 0.5;
      const score = s / Math.pow(this.cost(civ, t), 0.7) * (0.8 + rand() * 0.4);
      if (score > bs) { bs = score; best = t.idx; }
    }
    civ.researching = best;
  }
}

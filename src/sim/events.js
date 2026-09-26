// World events: plague, fire, weather, earthquakes, great people, golden
// ages, rebellions/civil wars and industrial accidents.
import { CFG } from '../config.js';
import { B, NB, SCALES } from '../data/beliefs.js';
import { PROFESSIONS } from '../data/professions.js';
import { S, A } from './people.js';
import { rand, randInt, chance } from '../util/rng.js';

const GREAT_RATE = 0.12;
const GREAT = [
  { kind: 'Scientist', fx: (sim, civ) => { civ.researchPts += 400 + civ.era * 250; }, belief: B.REASON },
  { kind: 'Artist', fx: (sim, civ) => { civ.culture += 300 + civ.era * 100; civ.goldenAge = Math.max(civ.goldenAge, 3); }, belief: B.ART },
  { kind: 'General', fx: (sim, civ) => { civ.milPower = (civ.milPower || 0) * 1.2; }, belief: B.AGGRESSION },
  { kind: 'Merchant', fx: (sim, civ) => { const t = sim.towns[civ.capital]; if (t) t.add(sim.RES_COINS, 300 + civ.era * 150); }, belief: B.COMMERCE },
  { kind: 'Engineer', fx: (sim, civ) => { for (const tid of civ.towns) { const t = sim.towns[tid]; if (!t) continue; for (const id of t.construction) { const b = sim.buildings[id]; if (b) b.progress = Math.min(0.99, b.progress + 0.5); } } }, belief: B.INVENTION },
  { kind: 'Healer', fx: (sim, civ) => { for (let i = 0; i < sim.people.hwm; i++) if (sim.people.civ[i] === civ.id) { sim.people.sick[i] = 0; sim.people.health[i] = Math.min(100, sim.people.health[i] + 30); } }, belief: B.EMPATHY },
  { kind: 'Philosopher', fx: (sim, civ) => { civ.researchPts += 200; sim.beliefs.shock(civ.id, B.CURIOSITY, 4, 0.4); }, belief: B.CURIOSITY },
];

export class Events {
  constructor(sim) {
    this.sim = sim;
    this.virulence = 1;
    this.plagueActive = 0;
    this.fires = [];
    this.fireAcc = 0;
  }

  daily() {
    const sim = this.sim;
    const Y = CFG.DAYS_PER_YEAR;
    // plague outbreaks: dense, unhygienic towns
    for (const town of sim.towns) {
      if (!town || !town.alive || town.pop < 60) continue;
      const civ = sim.civs[town.civ];
      const density = town.pop / Math.max(20, town.housingCap);
      const p = 0.07 / Y * density * civ.mod.disease * (1 + town.pop / 500);
      if (chance(p)) this.outbreak(town);
    }
    if (this.plagueActive > 0) this.plagueActive--;
    // weather
    if (sim.day % CFG.DAYS_PER_SEASON === 0) {
      const r = rand();
      if (r < 0.08) { sim.weatherFarm = 0.45; sim.chronicle('Drought withers the crops across the continent.', -1, 'disaster'); }
      else if (r < 0.18) { sim.weatherFarm = 1.35; sim.chronicle('A bountiful season: harvests overflow.', -1, 'good'); }
      else sim.weatherFarm = 1;
    }
    // earthquakes
    if (chance(0.025 / Y)) this.earthquake();
    // great people
    for (const civ of sim.civs) {
      if (!civ.alive || civ.pop < 90) continue;
      const p = (GREAT_RATE + Math.min(0.3, civ.culture / 40000) + civ.era * 0.03) / Y;
      if (chance(p)) this.greatPerson(civ);
      if (civ.goldenAge > 0) { civ.goldenAge -= 1 / Y; if (civ.goldenAge <= 0) { civ.goldenAge = 0; civ.recomputeMods(); sim.chronicle(`The golden age of ${civ.name} fades.`, civ.id, 'culture'); } }
      else if (civ.happiness > 72 && civ.cultureRate > 8 && chance(0.1 / Y)) {
        civ.goldenAge = 8; civ.recomputeMods();
        sim.chronicle(`✨ ${civ.name} enters a Golden Age!`, civ.id, 'culture');
      }
    }
    // rebellions and civil wars
    for (const town of sim.towns) {
      if (!town || !town.alive || town.pop < 40) continue;
      const civ = sim.civs[town.civ];
      if (civ.towns.length < 2 && town.isCapital) continue;
      const unrest = Math.max(0, 40 - town.happiness) * civ.mod.unrest + Math.max(0, 35 - town.loyalty) * 0.8 + (sim.tick - town.lastCaptured < CFG.TICKS_PER_YEAR * 5 ? 10 : 0);
      town.unrest = town.unrest * 0.95 + unrest * 0.05;
      if (town.unrest > 18 && chance(0.02)) {
        if (!town.isCapital && sim.civs.filter((c) => c.alive).length < CFG.CIV_COLORS.length && chance(0.5)) sim.secede(town);
        else this.riot(town);
      }
    }
    // nuclear accidents
    for (const b of sim.buildings) {
      if (!b || !b.built || b.def.id !== 'nuclear_plant') continue;
      if (chance(0.004 / Y * (b.workers.length ? 1 : 5))) this.meltdown(b);
    }
  }

  outbreak(town) {
    const sim = this.sim, P = sim.people;
    const names = ['the Grey Cough', 'the Red Fever', 'the Sweating Sickness', 'the Black Pox', 'the Marsh Ague', 'the Wasting Plague'];
    this.virulence = 0.7 + rand() * 0.9;
    let n = 0;
    for (let k = 0; k < 400 && n < 6; k++) {
      const i = randInt(P.hwm);
      if (P.town[i] === town.id && P.civ[i] === town.civ && P.immune[i] <= 0 && P.sick[i] <= 0) { P.sick[i] = 4 + rand() * 4; n++; }
    }
    if (n) {
      this.plagueActive = 30;
      sim.chronicle(`☠ An outbreak of ${names[randInt(names.length)]} strikes ${town.name}.`, town.civ, 'disaster');
      sim.beliefs.shock(town.civ, B.HYGIENE, 3, 0.4);
      sim.beliefs.shock(town.civ, B.PIETY, 2, 0.3);
    }
  }

  spread(i) {
    const sim = this.sim, P = sim.people;
    const civ = sim.civs[P.civ[i]];
    let n = 0;
    sim.spatial.query(P.x[i], P.y[i], 5, (j) => {
      if (j === i || P.sick[j] > 0 || P.immune[j] > 0 || P.civ[j] < 0) return false;
      const cj = sim.civs[P.civ[j]];
      const hyg = 1 - P.b(j, B.HYGIENE) / 250;
      if (chance(0.12 * cj.mod.disease * hyg * this.virulence * (1 + sim.auraDisease(P.x[j], P.y[j], P.civ[j])))) { P.sick[j] = 3 + rand() * 5; n++; }
      return n > 2;
    });
    void civ;
  }

  ignite(b, cause) {
    const sim = this.sim;
    if (!b || b.fire > 0 || b.def.wall && b.def.id === 'stone_wall') return;
    b.fire = 200 + rand() * 300;
    this.fires.push(b.id);
    const town = sim.towns[b.town];
    if (cause) sim.chronicle(`🔥 Fire set by ${cause} burns the ${b.def.name.toLowerCase()} in ${town ? town.name : 'the land'}.`, b.civ, 'disaster');
  }

  // per-tick fire propagation and damage
  step(dt) {
    const sim = this.sim;
    this.fireAcc += dt;
    // spontaneous fires (summer, wooden buildings)
    if (this.fireAcc > 60) {
      this.fireAcc = 0;
      const n = sim.buildings.length;
      if (n) for (let k = 0; k < 2; k++) {
        const b = sim.buildings[randInt(n)];
        if (!b || !b.built || b.fire > 0) continue;
        const wooden = b.def.cost.wood && !b.def.cost.stone && !b.def.cost.bricks && !b.def.cost.concrete;
        const p = (wooden ? 0.0025 : 0.0003) * (sim.season === 1 ? 2 : 1) * (b.def.recipes && b.def.fx.pollution ? 2 : 1);
        if (chance(p)) this.ignite(b, null);
      }
    }
    for (let k = this.fires.length - 1; k >= 0; k--) {
      const b = sim.buildings[this.fires[k]];
      if (!b || b.fire <= 0) { this.fires.splice(k, 1); continue; }
      b.fire -= dt;
      // firefighting: nearby townsfolk (more with empathy) douse flames
      let helpers = 0;
      sim.spatial.query(b.cx, b.cy, 12, (j) => { if (sim.people.civ[j] === b.civ) helpers++; return helpers > 10; });
      b.fire -= dt * helpers * 0.25;
      b.hp -= dt * 0.8 * (b.def.cost.stone || b.def.cost.bricks || b.def.cost.concrete ? 0.3 : 1);
      if (b.hp <= 0) {
        const town = sim.towns[b.town];
        if (b.def.center && town) { b.hp = 20; b.fire = 0; continue; }
        sim.chronicle(`The ${b.def.name.toLowerCase()} in ${town ? town.name : 'the land'} burns to the ground.`, b.civ, 'disaster');
        sim.destroyBuilding(b, 'fire');
        this.fires.splice(k, 1);
        continue;
      }
      // spread to neighbours
      if (chance(0.004 * dt)) {
        const w = sim.world;
        const px = (b.x - 3 + rand() * (b.w + 6)) | 0, py = (b.y - 3 + rand() * (b.h + 6)) | 0;
        if (w.inb(px, py)) {
          const id = w.bld[py * w.W + px] - 1;
          if (id >= 0 && id !== b.id) this.ignite(sim.buildings[id], null);
        }
      }
    }
  }

  earthquake() {
    const sim = this.sim;
    const towns = sim.towns.filter((t) => t && t.alive);
    if (!towns.length) return;
    const t = towns[randInt(towns.length)];
    let n = 0;
    for (const id of t.buildings) {
      const b = sim.buildings[id];
      if (!b || !chance(0.4)) continue;
      b.hp -= b.maxHp * (0.2 + rand() * 0.6);
      if (b.hp <= 0 && !b.def.center) { sim.destroyBuilding(b, 'earthquake'); n++; }
      else if (b.hp <= 0) b.hp = 10;
    }
    sim.chronicle(`An earthquake shakes ${t.name}; ${n} buildings collapse.`, t.civ, 'disaster');
    sim.beliefs.shock(t.civ, B.PIETY, 3, 0.4);
    sim.beliefs.shock(t.civ, B.OPTIMISM, -3, 0.3);
  }

  greatPerson(civ) {
    const sim = this.sim, P = sim.people;
    const g = GREAT[randInt(GREAT.length)];
    let pick = -1;
    for (let k = 0; k < 60; k++) {
      const i = randInt(Math.max(1, P.hwm));
      if (P.civ[i] === civ.id && P.age[i] > 18 && P.age[i] < 50) { pick = i; break; }
    }
    if (pick < 0) return;
    P.flags[pick] |= 16;
    P.skill[pick] = 100; P.edu[pick] = 100;
    P.setB(pick, g.belief, 80);
    g.fx(sim, civ);
    sim.beliefs.shock(civ.id, g.belief, 2, 0.2);
    civ.greatPeople = (civ.greatPeople || 0) + 1;
    sim.chronicle(`★ Great ${g.kind} ${sim.personName(pick)} is celebrated in ${civ.name}.`, civ.id, 'great', pick);
  }

  riot(town) {
    const sim = this.sim;
    const civ = sim.civs[town.civ];
    sim.chronicle(`Riots erupt in ${town.name} over misery and injustice.`, town.civ, 'unrest');
    for (let k = 0; k < 3; k++) {
      const id = town.buildings[randInt(town.buildings.length)];
      const b = sim.buildings[id];
      if (b && chance(0.5)) this.ignite(b, 'rioters');
    }
    town.unrest *= 0.6;
    sim.beliefs.shock(civ.id, B.LAW, -2, 0.2);
    sim.beliefs.shock(civ.id, B.AUTHORITY, 2, 0.2);
  }

  meltdown(b) {
    const sim = this.sim, P = sim.people;
    const town = sim.towns[b.town];
    sim.chronicle(`☢ Meltdown at the nuclear plant of ${town ? town.name : '?'}!`, b.civ, 'disaster');
    sim.spatial.query(b.cx, b.cy, 40, (j) => { if (chance(0.3)) sim.kill(j, 'radiation'); else P.health[j] -= 40; return false; });
    sim.destroyBuilding(b, 'meltdown');
    sim.beliefs.shock(b.civ, B.NATURE, 10, 0.6);
    for (let k = 0; k < 400; k++) {
      const x = (b.cx + (rand() - 0.5) * 60) | 0, y = (b.cy + (rand() - 0.5) * 60) | 0;
      if (sim.world.inb(x, y)) sim.world.pollution[sim.world.terrIdx(x, y)] = 255;
    }
  }
}

export { SCALES, NB, PROFESSIONS, S, A };

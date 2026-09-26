// Expansion: civilisations send settler parties to found new towns.
import { CFG } from '../config.js';
import { B } from '../data/beliefs.js';
import { SD } from '../data/structures.js';
import { R } from '../data/resources.js';
import { D, T, TERRAIN } from '../world/terrain.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { placeBuilding, canPlace } from './buildings.js';
import { rand, randInt, chance } from '../util/rng.js';

export class Settle {
  constructor(sim) {
    this.sim = sim;
    this.parties = [];
    this.nextId = 1;
  }

  daily() {
    const sim = this.sim;
    for (const civ of sim.civs) {
      if (!civ.alive) continue;
      if (this.parties.some((p) => p.civ === civ.id)) continue;
      // expand when large, or earlier if the home town has run out of room
      const crowded = civ.towns.some((tid) => { const t = sim.towns[tid]; return t && t.pop >= 150 && t.pop >= t.housingCap * 0.95; });
      if (civ.pop < 240 && !(civ.pop >= 170 && crowded)) continue;
      const maxTowns = 1 + Math.floor(civ.pop / 320) + Math.round(Math.max(0, civ.beliefAvg[B.EXPANSION]) / 30);
      if (civ.towns.length >= Math.min(12, maxTowns)) continue;
      // source: the most crowded town with enough people
      let src = null, bs = 0;
      for (const tid of civ.towns) {
        const t = sim.towns[tid];
        if (!t || t.pop < 150 || t.foodDays < 4) continue;
        const s = t.pop - t.housingCap * 0.8 + t.pop * 0.1;
        if (s > bs) { bs = s; src = t; }
      }
      if (!src) continue;
      const p = 0.12 * civ.mod.settle * (1 + Math.max(0, civ.beliefAvg[B.MOBILITY] + civ.beliefAvg[B.ADVENTURE]) / 100);
      if (!chance(p)) continue;
      const site = this.findSite(civ, src);
      if (!site) continue;
      this.launch(civ, src, site);
    }
    // parties that never arrive dissolve
    for (let k = this.parties.length - 1; k >= 0; k--) {
      const p = this.parties[k];
      if (sim.tick - p.started > CFG.TICKS_PER_DAY * 6) { this.found(p, true); }
    }
  }

  findSite(civ, src) {
    const sim = this.sim, w = sim.world;
    let best = null, bs = -1e9;
    for (let k = 0; k < 220; k++) {
      const a = rand() * 6.283, d = 90 + rand() * 170;
      const x = (src.cx + Math.cos(a) * d) | 0, y = (src.cy + Math.sin(a) * d) | 0;
      if (!w.inb(x, y) || x < 20 || y < 20 || x > w.W - 20 || y > w.H - 20) continue;
      const c = sim.nav.cellOf(x, y);
      if (!civ.explored[c] || sim.nav.cost[c] >= 1e9) continue;
      if (!sim.nav.sameLandmass(src.cx, src.cy, x, y)) continue;
      const t = w.ter[y * w.W + x];
      if (TERRAIN[t].build !== 1 || t === T.SNOW || t === T.MARSH) continue;
      const own = w.ownerAt(x, y);
      if (own >= 0 && own !== civ.id) continue;
      // keep distance from every town
      let tooClose = false;
      for (const tt of sim.towns) if (tt && tt.alive && (tt.cx - x) ** 2 + (tt.cy - y) ** 2 < 85 * 85) { tooClose = true; break; }
      if (tooClose) continue;
      let fert = 0, trees = 0, water = 0, stone = 0, ore = 0, fish = 0, land = 0;
      for (let oy = -28; oy <= 28; oy += 4) for (let ox = -28; ox <= 28; ox += 4) {
        const px = x + ox, py = y + oy;
        if (!w.inb(px, py)) continue;
        const i = py * w.W + px;
        const tt = w.ter[i];
        if (TERRAIN[tt].water) { water++; if (w.dep[i] === D.FISH) fish++; } else land++;
        fert += w.fert[i];
        const dp = w.dep[i];
        if (dp === D.TREE) trees++;
        else if (dp === D.STONE) stone++;
        else if (dp >= D.COPPER && dp <= D.URANIUM) ore++;
      }
      if (land < 120) continue;
      const cap = sim.towns[civ.capital];
      const distHome = cap ? Math.hypot(cap.cx - x, cap.cy - y) : 0;
      const s = fert / 300 + Math.min(trees, 40) * 0.5 + Math.min(water, 30) * 0.4 + stone * 0.6 + ore * 0.8 + fish * 0.5 - distHome * 0.03 + rand() * 5;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    return best;
  }

  launch(civ, src, site) {
    const sim = this.sim, P = sim.people;
    const size = 18 + randInt(14);
    const members = [];
    // young adults (and their families) volunteer; nomadic/adventurous first
    const list = [...src.residentsList].filter((i) => P.civ[i] === civ.id && P.age[i] >= 16 && P.age[i] < 45 && P.army[i] < 0 && P.state[i] !== S.JAIL);
    list.sort((a, b) => (P.b(b, B.MOBILITY) + P.b(b, B.ADVENTURE)) - (P.b(a, B.MOBILITY) + P.b(a, B.ADVENTURE)) + (rand() - 0.5) * 60);
    for (const i of list) {
      if (members.length >= size) break;
      if (members.includes(i)) continue;
      members.push(i);
      const pt = P.partner[i];
      if (pt >= 0 && P.civ[pt] === civ.id && !members.includes(pt) && P.army[pt] < 0) members.push(pt);
    }
    if (members.length < 10) return;
    const supplies = { wood: Math.min(src.stock[R('wood')] * 0.3, 60), grain: Math.min(src.stock[R('grain')] * 0.25, 80), berries: Math.min(src.stock[R('berries')] * 0.25, 40), bread: Math.min(src.stock[R('bread')] * 0.2, 40), stone: Math.min(src.stock[R('stone')] * 0.2, 30) };
    for (const [k, v] of Object.entries(supplies)) src.take(R(k), v);
    const party = { id: this.nextId++, civ: civ.id, src: src.id, x: site.x, y: site.y, members, supplies, started: sim.tick };
    this.parties.push(party);
    for (const i of members) {
      if (P.work[i] >= 0) sim.jobs.setProf(i, 0, -1);
      sim.jobs.leaveHome(i);
      goTo(sim, i, site.x + (rand() - 0.5) * 8, site.y + (rand() - 0.5) * 8, A.SETTLE);
      P.target2[i] = party.id;
    }
    sim.chronicle(`Settlers (${members.length}) leave ${src.name} to found a new town.`, civ.id, 'expansion');
  }

  arrive(i) {
    const sim = this.sim, P = sim.people;
    const party = this.parties.find((p) => p.id === P.target2[i]);
    P.state[i] = S.WAIT; P.timer[i] = 60;
    if (!party) return;
    let here = 0;
    for (const m of party.members) if (P.civ[m] === party.civ && (P.x[m] - party.x) ** 2 + (P.y[m] - party.y) ** 2 < 25 * 25) here++;
    if (here >= Math.ceil(party.members.length * 0.5)) this.found(party, false);
  }

  found(party, late) {
    const sim = this.sim, P = sim.people;
    const k = this.parties.indexOf(party);
    if (k >= 0) this.parties.splice(k, 1);
    const civ = sim.civs[party.civ];
    if (!civ.alive) return;
    // find a valid spot for the campfire near the chosen site
    const def = SD('campfire');
    let spot = null;
    for (let t = 0; t < 80 && !spot; t++) {
      const x = Math.round(party.x - 2 + (rand() - 0.5) * (8 + t)), y = Math.round(party.y - 2 + (rand() - 0.5) * (8 + t));
      if (canPlace(sim, def, x, y, civ.id)) spot = { x, y };
    }
    const alive = party.members.filter((m) => P.civ[m] === civ.id);
    if (!spot || alive.length < 4) {
      // failed: return to the source town
      if (!late) return;
      const src = sim.towns[party.src];
      for (const m of alive) if (src) goTo(sim, m, src.cx, src.cy, A.WANDER);
      return;
    }
    const town = sim.createTown(civ, spot.x + 2, spot.y + 2);
    placeBuilding(sim, def.idx, civ.id, town.id, spot.x, spot.y, true);
    for (const [k2, v] of Object.entries(party.supplies)) town.add(R(k2), v);
    for (const m of alive) sim.transferTown(m, town);
    sim.chronicle(`${civ.name} founds the town of ${town.name}.`, civ.id, 'expansion');
  }
}

export { placeBuilding };

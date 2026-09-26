// Military: recruitment targets, armies, combat, towers, sieges and conquest.
import { CFG } from '../config.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { B } from '../data/beliefs.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { rand, randInt, chance } from '../util/rng.js';

const UNARMED = { atk: 2, def: 0, hp: 0, range: 1.5, rate: 30, speed: 1 };
const P_LABORER = PROF_INDEX.laborer;

export class Military {
  constructor(sim) {
    this.sim = sim;
    this.armies = [];
    this.nextArmy = 1;
    this.scanAcc = 0;
    this.towerAcc = 0;
    this.armyAcc = 0;
    this.warCache = new Uint8Array(64);
    this.anyWar = false;
  }

  refreshWarCache() {
    const sim = this.sim;
    this.warCache.fill(0);
    this.anyWar = false;
    for (const p of sim.diplomacy.pairs.values()) {
      if (!p.war) continue;
      this.warCache[p.a * 8 + p.b] = 1; this.warCache[p.b * 8 + p.a] = 1;
      this.anyWar = true;
    }
  }
  atWarBetween(a, b) { return a !== b && a >= 0 && b >= 0 && this.warCache[a * 8 + b] === 1; }
  atWar(c) { for (let o = 0; o < 8; o++) if (this.warCache[c * 8 + o]) return true; return false; }

  desiredSoldiers(civ) {
    const aggr = civ.beliefAvg[B.AGGRESSION];
    let frac = 0.025 + Math.max(-0.02, aggr * 0.0006) + Math.max(0, civ.beliefAvg[B.SUSPICION]) * 0.0002;
    if (this.atWar(civ.id)) frac *= 2.5;
    let threat = 0;
    for (const o of this.sim.civs) if (o.alive && o !== civ && civ.contact[o.id] && civ.relations[o.id] < -30) threat += 0.01;
    return Math.round(civ.adults * (frac + threat));
  }

  militarySlots(civ) {
    // cached per civ for the current tick (the planner and labour market ask often)
    const c = this.slotCache || (this.slotCache = new Map());
    const hit = c.get(civ.id);
    if (hit && hit.tick === this.sim.tick) return hit.n;
    let n = 0;
    for (const tid of civ.towns) {
      const t = this.sim.towns[tid];
      if (!t) continue;
      for (const id of t.buildings) {
        const b = this.sim.buildings[id];
        if (!b) continue;
        n += b.def.milSlots !== undefined ? b.def.milSlots : (b.def.milSlots = Object.entries(b.def.jobs).reduce((a, [k, v]) => a + (k[0] === '@' ? v : 0), 0));
      }
    }
    c.set(civ.id, { tick: this.sim.tick, n });
    return n;
  }

  strength(civId) {
    const civ = this.sim.civs[civId];
    return civ.milPower || 0;
  }

  threat(civId, town) {
    const sim = this.sim;
    const civ = sim.civs[civId];
    let t = 0;
    for (const o of sim.civs) {
      if (!o.alive || o.id === civId || !civ.contact[o.id]) continue;
      if (this.atWarBetween(civId, o.id)) t += 1.5;
      else if (civ.relations[o.id] < -30) t += 0.5;
    }
    if (town && sim.tick - town.lastAttacked < CFG.TICKS_PER_DAY * 3) t += 1.5;
    return t;
  }

  stats(i) {
    const p = PROFESSIONS[this.sim.people.prof[i]];
    return p.mil || UNARMED;
  }

  // ------------------------------------------------------------ garrison
  garrisonThink(i, wb) {
    const sim = this.sim, P = sim.people;
    const town = sim.towns[P.town[i]];
    if (town && sim.tick - town.lastAttacked < 400) {
      // defend: rush toward the town centre where enemies were seen
      const c = sim.buildings[town.center];
      goTo(sim, i, (c ? c.cx : town.cx) + (rand() - 0.5) * 30, (c ? c.cy : town.cy) + (rand() - 0.5) * 30, A.PATROL);
      return;
    }
    if (chance(0.25) && town) {
      // patrol the edge of town
      const a = rand() * 6.283, d = town.radius * (0.7 + rand() * 0.4);
      goTo(sim, i, town.cx + Math.cos(a) * d, town.cy + Math.sin(a) * d, A.PATROL);
      return;
    }
    // drill near the barracks
    const a = rand() * 6.283, d = 2 + rand() * 6;
    goTo(sim, i, wb.cx + Math.cos(a) * (wb.w / 2 + d), wb.cy + Math.sin(a) * (wb.h / 2 + d), A.GARRISON);
    P.target[i] = wb.id;
  }

  // ------------------------------------------------------------ armies
  armyThink(i) {
    const sim = this.sim, P = sim.people;
    const army = this.armies.find((a) => a.id === P.army[i]);
    if (!army) { P.army[i] = -1; P.state[i] = S.WAIT; P.timer[i] = 10; return; }
    const jx = (rand() - 0.5) * 16, jy = (rand() - 0.5) * 16;
    switch (army.state) {
      case 'rally': goTo(sim, i, army.rx + jx, army.ry + jy, A.PATROL); break;
      case 'march': goTo(sim, i, army.tx + jx, army.ty + jy, A.PATROL); break;
      case 'siege': {
        const b = this.nearestEnemyBuilding(i, army.target, 70);
        if (b) { goTo(sim, i, b.cx + (rand() - 0.5) * (b.w + 2), b.cy + (rand() - 0.5) * (b.h + 2), A.ATTACK); P.target[i] = -10 - b.id; }
        else goTo(sim, i, army.tx + jx, army.ty + jy, A.PATROL);
        break;
      }
      case 'retreat': {
        const home = sim.towns[P.town[i]];
        if (home) goTo(sim, i, home.cx + jx, home.cy + jy, A.WANDER);
        P.army[i] = -1;
        break;
      }
    }
  }

  nearestEnemyBuilding(i, townId, r) {
    const sim = this.sim, P = sim.people;
    const town = sim.towns[townId];
    if (!town) return null;
    let best = null, bd = r * r;
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b || b.civ === P.civ[i] || !this.atWarBetween(P.civ[i], b.civ)) continue;
      const d = (b.cx - P.x[i]) ** 2 + (b.cy - P.y[i]) ** 2 - (b.def.center ? 900 : 0) - (b.def.wall ? 400 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  updateArmies(dt) {
    const sim = this.sim, P = sim.people;
    this.armyAcc += dt;
    if (this.armyAcc < 120) return;
    this.armyAcc = 0;
    // form new armies
    for (const civ of sim.civs) {
      if (!civ.alive || !this.atWar(civ.id)) continue;
      if (this.armies.some((a) => a.civ === civ.id && a.state !== 'retreat')) continue;
      const enemies = sim.civs.filter((o) => o.alive && this.atWarBetween(civ.id, o.id));
      if (!enemies.length) continue;
      const cap = sim.towns[civ.capital];
      if (!cap) continue;
      // target: nearest enemy town
      let target = null, td = 1e18;
      for (const e of enemies) for (const tid of e.towns) {
        const t = sim.towns[tid];
        if (!t || !t.alive) continue;
        const d = (t.cx - cap.cx) ** 2 + (t.cy - cap.cy) ** 2;
        if (d < td && sim.nav.sameLandmass(cap.cx, cap.cy, t.cx, t.cy)) { td = d; target = t; }
      }
      if (!target) continue;
      const soldiers = [];
      for (let i = 0; i < P.hwm; i++) {
        if (P.civ[i] !== civ.id || P.army[i] >= 0) continue;
        const p = PROFESSIONS[P.prof[i]];
        if (p.kind === 'military' && p.branch !== 'command' || p.id === 'general') soldiers.push(i);
      }
      const keep = Math.floor(soldiers.length * (0.2 + Math.max(0, -civ.beliefAvg[B.COURAGE]) / 300));
      const go = soldiers.slice(keep);
      if (go.length < 5) continue;
      // rally at our town closest to the target
      let rally = cap, rd = 1e18;
      for (const tid of civ.towns) { const t = sim.towns[tid]; if (!t) continue; const d = (t.cx - target.cx) ** 2 + (t.cy - target.cy) ** 2; if (d < rd) { rd = d; rally = t; } }
      const army = { id: this.nextArmy++, civ: civ.id, target: target.id, targetCiv: target.civ, state: 'rally', rx: rally.cx + (target.cx - rally.cx) * 0.15, ry: rally.cy + (target.cy - rally.cy) * 0.15,
        tx: target.cx, ty: target.cy, members: go, initial: go.length, since: sim.tick };
      for (const i of go) { P.army[i] = army.id; P.state[i] = S.IDLE; }
      this.armies.push(army);
      sim.chronicle(`${civ.name} musters an army of ${go.length} to march on ${target.name}.`, civ.id, 'war');
    }
    // advance army states
    for (let k = this.armies.length - 1; k >= 0; k--) {
      const a = this.armies[k];
      a.members = a.members.filter((i) => P.civ[i] === a.civ && P.army[i] === a.id);
      const target = sim.towns[a.target];
      if (!this.atWarBetween(a.civ, a.targetCiv) || !target || !target.alive || target.civ === a.civ) {
        // war over or objective taken
        for (const i of a.members) { P.army[i] = -1; P.state[i] = S.IDLE; }
        this.armies.splice(k, 1);
        continue;
      }
      a.tx = target.cx; a.ty = target.cy;
      const c = sim.buildings[target.center];
      if (c) { a.tx = c.cx; a.ty = c.cy; }
      if (a.members.length < Math.max(3, a.initial * 0.3)) {
        a.state = 'retreat';
        sim.chronicle(`The army of ${sim.civs[a.civ].name} retreats from ${target.name}.`, a.civ, 'war');
        for (const i of a.members) { P.state[i] = S.IDLE; }
        this.armies.splice(k, 1);
        for (const i of a.members) { const home = sim.towns[P.town[i]]; P.army[i] = -1; if (home) goTo(sim, i, home.cx, home.cy, A.WANDER); }
        continue;
      }
      let near = 0;
      for (const i of a.members) {
        const tx = a.state === 'rally' ? a.rx : a.tx, ty = a.state === 'rally' ? a.ry : a.ty;
        if ((P.x[i] - tx) ** 2 + (P.y[i] - ty) ** 2 < 45 * 45) near++;
      }
      if (a.state === 'rally' && (near > a.members.length * 0.6 || sim.tick - a.since > CFG.TICKS_PER_DAY * 1.5)) {
        a.state = 'march';
        for (const i of a.members) if (P.state[i] !== S.FIGHT) P.state[i] = S.IDLE;
      } else if (a.state === 'march' && near > a.members.length * 0.35) {
        a.state = 'siege';
        target.lastAttacked = sim.tick;
        sim.chronicle(`${sim.civs[a.civ].name} lays siege to ${target.name}!`, a.civ, 'war');
      }
      if (a.state === 'siege') {
        target.lastAttacked = sim.tick;
        target.siege = sim.tick;
        // occupation: many attackers at the centre and few defenders
        let def = 0;
        sim.spatial.query(a.tx, a.ty, 30, (j) => { if (P.civ[j] === target.civ && PROFESSIONS[P.prof[j]].mil) def++; return false; });
        let att = 0;
        sim.spatial.query(a.tx, a.ty, 22, (j) => { if (P.civ[j] === a.civ && P.army[j] === a.id) att++; return false; });
        if (att >= 5 && def === 0) { a.occupy = (a.occupy || 0) + 1; if (a.occupy > 6) this.captureTown(target, a.civ); }
        else a.occupy = 0;
      }
    }
  }

  // ------------------------------------------------------------ combat
  scan(dt) {
    const sim = this.sim, P = sim.people;
    this.scanAcc += dt;
    if (this.scanAcc < 8) return;
    this.scanAcc = 0;
    if (!this.anyWar) return;
    for (let i = 0; i < P.hwm; i++) {
      const c = P.civ[i];
      if (c < 0 || !this.atWar(c)) continue;
      const st = P.state[i];
      if (st === S.FIGHT || st === S.INSIDE || st === S.JAIL || st === S.SLEEP && !PROFESSIONS[P.prof[i]].mil) continue;
      const p = PROFESSIONS[P.prof[i]];
      const combatant = !!p.mil && p.kind !== 'hunter' && p.kind !== 'thief';
      if (!combatant && ((i + sim.tick) & 7)) continue; // civilians check less often
      const R0 = combatant ? (p.mil.cav ? 34 : 26) : 12;
      let best = -1, bd = 1e9;
      const honorable = sim.civs[c].beliefAvg[B.HONOR] > 20;
      sim.spatial.query(P.x[i], P.y[i], R0, (j) => {
        const cj = P.civ[j];
        if (cj < 0 || cj === c || !this.atWarBetween(c, cj) || P.state[j] === S.INSIDE) return false;
        const pj = PROFESSIONS[P.prof[j]];
        const jCombat = !!pj.mil;
        if (!jCombat && (honorable || !combatant)) return false;
        const d = (P.x[j] - P.x[i]) ** 2 + (P.y[j] - P.y[i]) ** 2 - (jCombat ? 200 : 0);
        if (d < bd) { bd = d; best = j; }
        return false;
      });
      if (best < 0) continue;
      const town = sim.towns[P.town[i]];
      if (town) town.lastAttacked = sim.tick;
      if (combatant) {
        P.state[i] = S.FIGHT; P.target[i] = best; P.path[i] = null;
      } else {
        // civilians: the brave fight back, the rest flee
        const brave = P.b(i, B.COURAGE) + sim.civs[c].mod.morale * 10 - 10;
        if (brave > 40 && P.age[i] >= CFG.ADULT_AGE) { P.state[i] = S.FIGHT; P.target[i] = best; P.path[i] = null; }
        else {
          const dx = P.x[i] - P.x[best], dy = P.y[i] - P.y[best];
          const l = Math.hypot(dx, dy) || 1;
          goTo(sim, i, P.x[i] + dx / l * 40, P.y[i] + dy / l * 40, A.FLEE);
        }
      }
    }
  }

  fightTick(i, dt) {
    const sim = this.sim, P = sim.people;
    const t = P.target[i];
    const me = this.stats(i);
    const civ = sim.civs[P.civ[i]];
    // building target (siege)
    if (t <= -10) {
      const b = sim.buildings[-10 - t];
      if (!b || b.civ === P.civ[i] || !this.atWarBetween(P.civ[i], b.civ)) { P.state[i] = S.IDLE; return; }
      const dx = Math.max(b.x - P.x[i], 0, P.x[i] - (b.x + b.w)), dy = Math.max(b.y - P.y[i], 0, P.y[i] - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d > Math.max(2, me.range)) { this.approach(i, b.cx, b.cy, dt); return; }
      P.cooldown[i] -= 0;
      if (P.cooldown[i] <= 0) {
        P.cooldown[i] = me.rate;
        const dmg = me.atk * (me.siege || 1) * civ.mod.attack * (0.7 + rand() * 0.6);
        this.damageBuilding(b, dmg, P.civ[i]);
        if (me.range > 3) sim.projectile(P.x[i], P.y[i], b.cx, b.cy, me.gun ? 2 : 1);
      }
      return;
    }
    if (t < 0 || P.civ[t] < 0 || !this.atWarBetween(P.civ[i], P.civ[t])) { P.state[i] = S.IDLE; return; }
    const dx = P.x[t] - P.x[i], dy = P.y[t] - P.y[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 45) { P.state[i] = S.IDLE; return; }
    if (d > me.range) { this.approach(i, P.x[t], P.y[t], dt); return; }
    if (P.cooldown[i] > 0) return;
    P.cooldown[i] = me.rate * (0.85 + rand() * 0.3);
    const them = this.stats(t);
    const tciv = sim.civs[P.civ[t]];
    let atk = me.atk * civ.mod.attack * (0.7 + rand() * 0.6);
    if (me.antiCav && them.cav) atk *= me.antiCav;
    if (P.army[i] >= 0) atk *= 1 + this.commandBonus(i);
    let def = them.def * tciv.mod.defense;
    // fighting on home ground
    if (sim.world.ownerAt(P.x[t] | 0, P.y[t] | 0) === P.civ[t]) def = def * 1.25 + 1;
    const dmg = Math.max(1, atk - def * 0.5) * 100 / (100 + (them.hp || 0));
    P.health[t] -= dmg;
    if (me.range > 3) sim.projectile(P.x[i], P.y[i], P.x[t], P.y[t], me.gun ? 2 : 1);
    const town = sim.towns[P.town[t]];
    if (town) town.lastAttacked = sim.tick;
    if (P.health[t] <= 0) {
      const pair = sim.diplomacy.pair(P.civ[i], P.civ[t]);
      pair.casualties[P.civ[t] === pair.a ? 0 : 1]++;
      tciv.warWeariness += 0.4 * (1 + Math.max(0, -tciv.beliefAvg[B.AGGRESSION]) / 100);
      civ.stats.killed++;
      sim.kill(t, 'killed in battle by ' + civ.name);
      P.skill[i] = Math.min(100, P.skill[i] + 2);
      P.pushB(i, B.AGGRESSION, 1);
      P.state[i] = S.IDLE;
    }
  }

  commandBonus(i) {
    const sim = this.sim, P = sim.people;
    let bonus = 0;
    sim.spatial.query(P.x[i], P.y[i], 30, (j) => {
      if (P.civ[j] === P.civ[i]) { const m = PROFESSIONS[P.prof[j]].mil; if (m && m.command) { bonus = m.command; return true; } }
      return false;
    });
    return bonus;
  }

  approach(i, x, y, dt) {
    const sim = this.sim, P = sim.people, w = sim.world;
    const dx = x - P.x[i], dy = y - P.y[i];
    const d = Math.hypot(dx, dy) || 1;
    const sp = sim.speedCache[i] * dt * Math.max(0.2, w.speedAt(P.x[i], P.y[i]));
    const nx = P.x[i] + dx / d * Math.min(sp, d), ny = P.y[i] + dy / d * Math.min(sp, d);
    const p = (ny | 0) * w.W + (nx | 0);
    const wall = sim.wallMap[p];
    if (wall && wall - 1 !== P.civ[i] && this.atWarBetween(P.civ[i], wall - 1)) {
      // blocked by an enemy wall: attack it
      const b = sim.buildings[w.bld[p] - 1];
      if (b) { P.target[i] = -10 - b.id; return; }
    }
    if (w.speedAt(nx, ny) > 0) { P.x[i] = nx; P.y[i] = ny; }
  }

  damageBuilding(b, dmg, byCiv) {
    const sim = this.sim;
    b.hp -= dmg;
    b.damageTick = sim.tick;
    const town = sim.towns[b.town];
    if (town) town.lastAttacked = sim.tick;
    if (b.hp <= 0) {
      if (b.def.center && town) { this.captureTown(town, byCiv); b.hp = b.maxHp * 0.25; return; }
      sim.destroyBuilding(b, 'destroyed by ' + sim.civs[byCiv].name);
    } else if (chance(0.02) && (b.def.cat === 'housing' || b.def.cost.wood)) sim.events.ignite(b, null);
  }

  towers(dt) {
    const sim = this.sim, P = sim.people;
    this.towerAcc += dt;
    if (this.towerAcc < 15) return;
    this.towerAcc = 0;
    if (!this.anyWar) return;
    for (const b of sim.buildings) {
      if (!b || !b.built || !b.def.defense || !b.workers.length) continue;
      if (!this.atWar(b.civ)) continue;
      if (sim.tick - b.lastDefense < b.def.defense.rate) continue;
      let best = -1, bd = b.def.defense.range ** 2;
      sim.spatial.query(b.cx, b.cy, b.def.defense.range, (j) => {
        if (P.civ[j] < 0 || !this.atWarBetween(b.civ, P.civ[j])) return false;
        const d = (P.x[j] - b.cx) ** 2 + (P.y[j] - b.cy) ** 2;
        if (d < bd) { bd = d; best = j; }
        return false;
      });
      if (best < 0) continue;
      b.lastDefense = sim.tick;
      const civ = sim.civs[b.civ];
      P.health[best] -= b.def.defense.dmg * civ.mod.defense * (0.7 + rand() * 0.6);
      sim.projectile(b.cx, b.y, P.x[best], P.y[best], 1);
      if (P.health[best] <= 0) { civ.stats.killed++; sim.kill(best, 'shot from the walls of ' + (sim.towns[b.town] ? sim.towns[b.town].name : 'a fort')); }
    }
  }

  captureTown(town, byCiv) {
    const sim = this.sim, P = sim.people;
    const oldCiv = sim.civs[town.civ], newCiv = sim.civs[byCiv];
    if (!oldCiv || !newCiv || town.civ === byCiv) return;
    const wasCapital = oldCiv.capital === town.id;
    const pr = sim.diplomacy.pair(byCiv, oldCiv.id);
    pr.captures = pr.captures || {};
    pr.captures[byCiv] = (pr.captures[byCiv] || 0) + 1;
    sim.chronicle(`🏰 ${newCiv.name} captures ${town.name} from ${oldCiv.name}!`, byCiv, 'conquest');
    // transfer buildings
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b) continue;
      if (b.def.unique === 'civ') { delete oldCiv.uniques[b.def.id]; if (newCiv.uniques[b.def.id] === undefined) newCiv.uniques[b.def.id] = b.id; }
      b.civ = byCiv;
      for (const w of [...b.workers]) if (P.civ[w] !== byCiv) { const k = b.workers.indexOf(w); if (k >= 0) b.workers.splice(k, 1); P.work[w] = -1; }
      sim.renderDirtyBuildings.push(id);
      if (sim.wallBuildings.has(id)) sim.setWall(b, true);
    }
    // people: soldiers flee, civilians submit (low loyalty)
    const mercy = newCiv.beliefAvg[B.MERCY];
    for (let i = 0; i < P.hwm; i++) {
      if (P.civ[i] !== oldCiv.id || P.town[i] !== town.id) continue;
      if (PROFESSIONS[P.prof[i]].mil) {
        const refuge = sim.nearestTownOfCiv(oldCiv.id, P.x[i], P.y[i], town.id);
        if (refuge) { sim.transferTown(i, refuge); goTo(sim, i, refuge.cx, refuge.cy, A.WANDER); continue; }
      }
      if (mercy < -40 && chance(0.1)) { sim.kill(i, 'massacred by ' + newCiv.name); continue; }
      sim.changeCiv(i, byCiv);
      P.loyalty[i] = 10;
      P.pushB(i, B.FORGIVENESS, -10);
    }
    oldCiv.towns = oldCiv.towns.filter((t) => t !== town.id);
    newCiv.towns.push(town.id);
    town.civ = byCiv;
    town.isCapital = false;
    town.lastCaptured = sim.tick;
    town.shipments = [];
    sim.territoryDirty = true;
    newCiv.warWeariness = Math.max(0, newCiv.warWeariness - 10);
    oldCiv.warWeariness += 15;
    sim.beliefs.shock(oldCiv.id, B.FORGIVENESS, -6, 0.5);
    sim.beliefs.shock(oldCiv.id, B.PATRIOTISM, 4, 0.4);
    if (wasCapital) sim.relocateCapital(oldCiv);
    if (!oldCiv.towns.length) sim.eliminateCiv(oldCiv, newCiv);
  }

  disband(a, b) {
    const P = this.sim.people;
    for (let k = this.armies.length - 1; k >= 0; k--) {
      const ar = this.armies[k];
      if ((ar.civ === a && ar.targetCiv === b) || (ar.civ === b && ar.targetCiv === a)) {
        for (const i of ar.members) { if (P.army[i] === ar.id) { P.army[i] = -1; P.state[i] = S.IDLE; } }
        this.armies.splice(k, 1);
      }
    }
    this.refreshWarCache();
  }

  // Daily war bookkeeping.
  daily() {
    const sim = this.sim, P = sim.people;
    for (const civ of sim.civs) {
      if (!civ.alive) continue;
      if (this.atWar(civ.id)) civ.warWeariness += 0.25 * (1 + Math.max(0, -civ.beliefAvg[B.AGGRESSION]) / 80) * (civ.mod.unrest);
      else civ.warWeariness = Math.max(0, civ.warWeariness * 0.97 - 0.1);
    }
    // military power for strength comparisons
    const power = new Float32Array(sim.civs.length);
    for (let i = 0; i < P.hwm; i++) {
      const c = P.civ[i];
      if (c < 0) continue;
      const m = PROFESSIONS[P.prof[i]].mil;
      if (m && PROFESSIONS[P.prof[i]].kind !== 'hunter') power[c] += (m.atk + m.def) * (P.health[i] / 100) * (1 + (m.hp || 0) / 100);
    }
    for (const civ of sim.civs) civ.milPower = power[civ.id] * civ.mod.attack + civ.adults * 0.3;
    void P_LABORER; void randInt;
  }
}

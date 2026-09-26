// Person behaviour: daily schedule, job routines by profession kind, leisure,
// children, elders and crime. Beliefs modulate nearly every choice.
import { CFG } from '../config.js';
import { S, A } from './people.js';
import { goTo, moveStep, explore } from './movement.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { RESOURCES, R, NRES, LUX_RES } from '../data/resources.js';
import { B, NB } from '../data/beliefs.js';
import { D, DEPOSITS, T, TERRAIN } from '../world/terrain.js';
import { rand, randInt, chance } from '../util/rng.js';
import { RAIL, BRIDGE } from '../world/world.js';
import { completeBuilding } from './buildings.js';
import { ANIMALS } from './animals.js';

const P_LABORER = PROF_INDEX.laborer;
const P_THIEF = PROF_INDEX.thief;
const RES_WOOD = R('wood'), RES_STONE = R('stone'), RES_TOOLS = R('tools'), RES_COINS = R('coins');
const RES_MEAT = R('meat'), RES_HIDES = R('hides'), RES_IRON = R('iron'), RES_BERRIES = R('berries');
const RES_MEDICINE = R('medicine');

// deposit -> resource index
const DEP_RES = DEPOSITS.map((d) => (d.res ? R(d.res) : -1));

// ------------------------------------------------------------------ helpers
function inBuilding(b) {
  return [b.x + rand() * b.w, b.y + rand() * b.h];
}
function nearBuilding(b, r = 3) {
  const a = rand() * 6.283;
  return [b.cx + Math.cos(a) * (b.w / 2 + r * rand()), b.cy + Math.sin(a) * (b.h / 2 + r * rand())];
}
export function bld(sim, id) { return id >= 0 ? sim.buildings[id] : null; }
function townOf(sim, i) { return sim.towns[sim.people.town[i]]; }
function workHours(sim, i) {
  const P = sim.people;
  const dil = P.b(i, B.DILIGENCE);
  const start = 0.26, end = 0.70 + dil * 0.0009;
  return sim.tod >= start && sim.tod < end;
}
function isNight(sim) { return sim.tod < 0.235 || sim.tod > 0.9; }

function center(sim, town) {
  const b = bld(sim, town.center);
  return b ? [b.cx, b.cy] : [town.cx, town.cy];
}

// Nearest built dropoff in the town accepting resource r.
export function findDropoff(sim, town, x, y, r) {
  let best = null, bd = 1e18;
  for (const id of town.buildings) {
    const b = sim.buildings[id];
    if (!b || !b.built || !b.def.dropoff) continue;
    if (b.def.dropoff !== true && !b.def.dropoff.includes(RESOURCES[r].id)) continue;
    const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function findLeisure(sim, town, kind, x, y) {
  let best = null, bd = 1e18;
  for (const id of town.buildings) {
    const b = sim.buildings[id];
    if (!b || !b.built || b.def.leisure !== kind || b.banned) continue;
    const d = (b.cx - x) ** 2 + (b.cy - y) ** 2 + rand() * 400;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function setIdle(sim, i, t = 0) {
  const P = sim.people;
  P.state[i] = t > 0 ? S.WAIT : S.IDLE;
  P.timer[i] = t;
  P.act[i] = A.NONE;
}

function wander(sim, i, cx, cy, r, t = 60) {
  const a = rand() * 6.283, d = rand() * r;
  goTo(sim, i, cx + Math.cos(a) * d, cy + Math.sin(a) * d, A.WANDER);
  sim.people.timer[i] = t;
}

// ------------------------------------------------------------------ update
export function updatePerson(sim, i, dt) {
  const P = sim.people;
  const st = P.state[i];
  if (P.cooldown[i] > 0) P.cooldown[i] -= dt;
  switch (st) {
    case S.MOVE:
      if (moveStep(sim, i, dt)) arrive(sim, i);
      break;
    case S.IDLE:
      think(sim, i);
      break;
    case S.WAIT: case S.LEISURE:
      P.timer[i] -= dt;
      if (P.timer[i] <= 0) { P.state[i] = S.IDLE; if (st === S.LEISURE) endLeisure(sim, i); }
      break;
    case S.WORK:
      P.timer[i] -= dt * sim.workSpeed(i);
      if (P.timer[i] <= 0) finishWork(sim, i);
      break;
    case S.HARVEST:
      P.timer[i] -= dt;
      if (P.timer[i] <= 0) finishHarvest(sim, i);
      break;
    case S.BUILD:
      buildTick(sim, i, dt);
      break;
    case S.SLEEP:
      if (!isNight(sim) && sim.tod > 0.2 && sim.tod < 0.5) { P.state[i] = S.IDLE; }
      break;
    case S.FIGHT:
      sim.military.fightTick(i, dt);
      break;
    case S.JAIL:
      P.timer[i] -= dt;
      if (P.timer[i] <= 0) { P.state[i] = S.IDLE; P.flags[i] &= ~3; if (P.prof[i] === P_THIEF) sim.jobs.setProf(i, P_LABORER, -1); }
      break;
    case S.INSIDE:
      break; // carried by a vehicle
  }
}

// ------------------------------------------------------------------ think
export function think(sim, i) {
  const P = sim.people;
  const town = townOf(sim, i);
  if (!town) { setIdle(sim, i, 60); return; }
  const age = P.age[i];
  // severe sickness: go to hospital or rest
  if (P.sick[i] > 0 && P.health[i] < 45 && age >= 6) {
    const hosp = findHospital(sim, town, P.x[i], P.y[i]);
    if (hosp) { const [x, y] = inBuilding(hosp); goTo(sim, i, x, y, A.HEAL); P.target[i] = hosp.id; return; }
  }
  if (isNight(sim)) { goSleep(sim, i, town); return; }
  if (age < CFG.ADULT_AGE) { childThink(sim, i, town); return; }
  const elder = age >= CFG.ELDER_AGE + P.b(i, B.DILIGENCE) * 0.06 && !sim.professions[P.prof[i]].mil;
  if (elder) { elderThink(sim, i, town); return; }
  const prof = sim.professions[P.prof[i]];
  // military/diplomatic/army roles act regardless of the work day
  if (P.army[i] >= 0) { sim.military.armyThink(i); return; }
  if (prof.kind === 'thief') { thiefThink(sim, i, town); return; }
  // the starving look after themselves first
  const feeds = prof.kind === 'field' || prof.kind === 'harvest' || prof.kind === 'hunt';
  if (P.food[i] < 25 && town.feedRatio < 0.9 && sim.season !== 3 && !prof.mil && !(feeds && P.work[i] >= 0) && chance(0.6)) { forageThink(sim, i, town); return; }
  if (workHours(sim, i)) { workThink(sim, i, town, prof); return; }
  leisureThink(sim, i, town);
}

function goSleep(sim, i, town) {
  const P = sim.people;
  const home = bld(sim, P.home[i]);
  if (home && home.built) {
    if (home.contains(P.x[i], P.y[i])) { P.state[i] = S.SLEEP; return; }
    const [x, y] = inBuilding(home);
    goTo(sim, i, x, y, A.SLEEP);
  } else {
    // homeless: sleep by the fire / town center
    const [cx, cy] = center(sim, town);
    const dx = P.x[i] - cx, dy = P.y[i] - cy;
    if (dx * dx + dy * dy < 20 * 20) { P.state[i] = S.SLEEP; return; }
    goTo(sim, i, cx + (rand() - 0.5) * 16, cy + (rand() - 0.5) * 16, A.SLEEP);
  }
}

function childThink(sim, i, town) {
  const P = sim.people;
  const age = P.age[i];
  if (age >= 5 && sim.tod > 0.3 && sim.tod < 0.62) {
    const school = findSchool(sim, town, P.x[i], P.y[i]);
    if (school) { const [x, y] = inBuilding(school); goTo(sim, i, x, y, A.SCHOOL); P.target[i] = school.id; return; }
  }
  // play near home or mother
  const m = P.mother[i];
  let cx, cy;
  if (m >= 0 && P.civ[m] >= 0 && age < 6) { cx = P.x[m]; cy = P.y[m]; }
  else {
    const home = bld(sim, P.home[i]);
    if (home) { cx = home.cx; cy = home.cy; } else [cx, cy] = center(sim, town);
  }
  wander(sim, i, cx, cy, age < 6 ? 5 : 14, 40 + rand() * 80);
}

function elderThink(sim, i, town) {
  const P = sim.people;
  // storytelling: elders pass on tradition to the young nearby
  if (chance(0.3)) {
    sim.spatial.query(P.x[i], P.y[i], 10, (j) => {
      if (P.civ[j] === P.civ[i] && P.age[j] < CFG.ADULT_AGE + 4) {
        P.pushB(j, B.TRADITION, 0.4); P.pushB(j, B.ANCESTRY, 0.4);
        for (let k = 0; k < 2; k++) { const s = randInt(NB); P.pushB(j, s, (P.b(i, s) - P.b(j, s)) * 0.05); }
      }
      return false;
    });
  }
  if (chance(0.35)) { leisureThink(sim, i, town); return; }
  const home = bld(sim, P.home[i]);
  const [cx, cy] = home ? [home.cx, home.cy] : center(sim, town);
  wander(sim, i, cx, cy, 10, 80 + rand() * 120);
}

// ------------------------------------------------------------------ leisure
function leisureThink(sim, i, town) {
  const P = sim.people;
  const piety = P.b(i, B.PIETY), hed = P.b(i, B.HEDONISM), sch = P.b(i, B.SCHOLARSHIP);
  const rev = P.b(i, B.REVELRY), art = P.b(i, B.ART);
  const wFaith = 30 + piety + P.b(i, B.SPIRITUALITY) * 0.4 + (P.faithSat[i] < 40 ? 30 : 0);
  const wFun = 30 + hed * 0.8 + rev * 0.5 + art * 0.3;
  const wStudy = 10 + sch + P.b(i, B.CURIOSITY) * 0.5;
  const wSocial = 40 + P.b(i, B.COLLECTIVISM) * 0.3 + P.b(i, B.HARMONY) * 0.2;
  const wHome = 30 + P.b(i, B.FAMILY) * 0.3 - P.b(i, B.MOBILITY) * 0.2;
  const tot = Math.max(1, wFaith) + Math.max(1, wFun) + Math.max(1, wStudy) + Math.max(1, wSocial) + Math.max(1, wHome);
  let r = rand() * tot;
  let kind;
  if ((r -= Math.max(1, wFaith)) < 0) kind = 'faith';
  else if ((r -= Math.max(1, wFun)) < 0) kind = 'fun';
  else if ((r -= Math.max(1, wStudy)) < 0) kind = 'study';
  else if ((r -= Math.max(1, wSocial)) < 0) kind = 'social';
  else kind = 'home';
  if (kind === 'faith' || kind === 'fun' || kind === 'study') {
    const b = findLeisure(sim, town, kind, P.x[i], P.y[i]);
    if (b) {
      const [x, y] = inBuilding(b);
      goTo(sim, i, x, y, A.LEISURE);
      P.target[i] = b.id;
      return;
    }
  }
  if (kind === 'home') {
    const home = bld(sim, P.home[i]);
    if (home) { const [x, y] = inBuilding(home); goTo(sim, i, x, y, A.WANDER); P.timer[i] = 100; return; }
  }
  // socialise near the town centre or market
  const m = findLeisure(sim, town, null, P.x[i], P.y[i]);
  void m;
  const [cx, cy] = center(sim, town);
  wander(sim, i, cx, cy, 18 + town.radius * 0.3, 60 + rand() * 90);
}

function startLeisure(sim, i) {
  const P = sim.people;
  const b = bld(sim, P.target[i]);
  P.state[i] = S.LEISURE;
  P.timer[i] = 90 + rand() * 120;
  if (b) b.visitors++;
}

function endLeisure(sim, i) {
  const P = sim.people;
  const b = bld(sim, P.target[i]);
  if (!b) return;
  const kind = b.def.leisure;
  if (kind === 'faith') {
    P.faithSat[i] = 100;
    const staff = b.workers.length;
    P.pushB(i, B.PIETY, 0.5 + staff * 0.3);
    sim.civs[P.civ[i]].faithToday += 0.1 * (1 + staff);
  } else if (kind === 'fun') {
    P.lux[i] = Math.min(1, P.lux[i] + 0.25 + b.workers.length * 0.05);
    P.happy[i] = Math.min(100, P.happy[i] + 2);
    // taverns consume beer
    const town = sim.towns[b.town];
    if (b.def.id === 'tavern' && town) town.take(R('beer'), 0.05);
  } else if (kind === 'study') {
    P.edu[i] = Math.min(100, P.edu[i] + 0.4);
    P.pushB(i, B.CURIOSITY, 0.3);
    sim.civs[P.civ[i]].researchToday += 0.05 * (1 + b.workers.length * 0.5);
  }
}

// ------------------------------------------------------------------ work
function workThink(sim, i, town, prof) {
  const P = sim.people;
  let wb = bld(sim, P.work[i]);
  if (wb && (!wb.built || wb.banned || !wb.active)) wb = null;
  if (P.carryAmt[i] > 0 && prof.kind !== 'trader' && prof.kind !== 'porter') {
    // deliver whatever we carry first
    const drop = (wb && wb.def.dropoff && (wb.def.dropoff === true || wb.def.dropoff.includes(RESOURCES[P.carryRes[i]].id))) ? wb : findDropoff(sim, town, P.x[i], P.y[i], P.carryRes[i]);
    if (drop) { const [x, y] = nearBuilding(drop, 1); goTo(sim, i, x, y, A.DEPOSIT); P.target[i] = drop.id; return; }
    P.carryAmt[i] = 0;
  }
  if (!wb && prof.kind !== 'laborer' && prof.kind !== 'thief') {
    laborerThink(sim, i, town);
    return;
  }
  switch (prof.kind) {
    case 'laborer': laborerThink(sim, i, town); break;
    case 'builder': builderThink(sim, i, town, 1); break;
    case 'harvest': harvestThink(sim, i, town, wb); break;
    case 'hunt': huntThink(sim, i, town, wb); break;
    case 'field': fieldThink(sim, i, town, wb); break;
    case 'plant': plantThink(sim, i, town, wb); break;
    case 'craft': case 'service': case 'teacher':
      { const [x, y] = inBuilding(wb); goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id; } break;
    case 'preacher':
      if (chance(0.45)) preachThink(sim, i, town, wb);
      else { const [x, y] = inBuilding(wb); goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id; }
      break;
    case 'healer': healerThink(sim, i, town, wb); break;
    case 'scout': scoutThink(sim, i, town); break;
    case 'guard': guardThink(sim, i, town, wb); break;
    case 'watchman': { const [x, y] = inBuilding(wb); goTo(sim, i, x, y, A.GARRISON); P.target[i] = wb.id; } break;
    case 'military': sim.military.garrisonThink(i, wb); break;
    case 'porter': porterThink(sim, i, town, wb); break;
    case 'merchant':
      if (chance(0.3) && sim.logistics.takeShipment(i, town)) break;
      { const [x, y] = inBuilding(wb); goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id; }
      break;
    case 'trader': sim.trade.traderThink(i, town, wb); break;
    case 'diplomat': sim.diplomacy.diplomatThink(i, town, wb); break;
    case 'spy': sim.diplomacy.spyThink(i, town, wb); break;
    case 'missionary': sim.diplomacy.missionaryThink(i, town, wb); break;
    case 'road': roadThink(sim, i, town, wb); break;
    case 'rail': sim.transport.railThink(i, town, wb); break;
    case 'sailor': case 'pilot':
      { const [x, y] = inBuilding(wb); goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id; } break;
    default:
      laborerThink(sim, i, town);
  }
}

function laborerThink(sim, i, town) {
  const P = sim.people;
  // Help where most needed: food shortage → forage; construction → build; else haul/wander.
  if (town.foodDays < 6 && sim.season !== 3) { forageThink(sim, i, town); return; }
  if (town.construction.length && chance(0.8)) { builderThink(sim, i, town, 0.6); return; }
  if (town.foodDays < 14 && sim.season !== 3 && chance(0.6)) { forageThink(sim, i, town); return; }
  if (chance(0.35)) { woodThink(sim, i, town); return; }
  const [cx, cy] = center(sim, town);
  wander(sim, i, cx, cy, 25, 80 + rand() * 60);
  void P;
}

function forageThink(sim, i, town) {
  const P = sim.people;
  const px = sim.findDepositNear(P.x[i], P.y[i], 70, [D.BERRY, D.HERBS, D.COTTON, D.SPICE], true);
  if (px < 0) { woodThink(sim, i, town); return; }
  const w = sim.world;
  goTo(sim, i, px % w.W + 0.5, ((px / w.W) | 0) + 0.5, A.HARVEST);
  P.target[i] = px;
  P.target2[i] = -1;
}

function woodThink(sim, i, town) {
  const P = sim.people;
  const px = sim.findDepositNear(P.x[i], P.y[i], 60, [D.TREE], true);
  if (px < 0) { const [cx, cy] = center(sim, town); wander(sim, i, cx, cy, 20, 100); return; }
  const w = sim.world;
  goTo(sim, i, px % w.W + 0.5, ((px / w.W) | 0) + 0.5, A.HARVEST);
  P.target[i] = px;
  P.target2[i] = -1;
}

function builderThink(sim, i, town, eff) {
  const P = sim.people;
  let best = null, bs = -1e18;
  for (const id of town.construction) {
    const b = sim.buildings[id];
    if (!b || b.built) continue;
    const d = Math.hypot(b.cx - P.x[i], b.cy - P.y[i]);
    const s = -d * 0.05 - b.builders * 6 + (b.def.cat === 'housing' ? 4 : 0) + (b.def.center ? 10 : 0) + (b.def.cat === 'food' ? 5 : 0);
    if (s > bs) { bs = s; best = b; }
  }
  if (!best) {
    // repair damaged buildings
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (b && b.built && b.hp < b.maxHp * 0.85 && b.fire <= 0) { best = b; break; }
    }
  }
  if (!best) {
    if (eff >= 1 && chance(0.5)) { woodThink(sim, i, town); return; }
    const [cx, cy] = center(sim, town);
    wander(sim, i, cx, cy, 20, 80);
    return;
  }
  const [x, y] = nearBuilding(best, 1);
  goTo(sim, i, x, y, A.BUILD);
  P.target[i] = best.id;
  P.timer[i] = eff;
  best.builders++;
}

function buildTick(sim, i, dt) {
  const P = sim.people;
  const b = bld(sim, P.target[i]);
  if (!b) { P.state[i] = S.IDLE; return; }
  const civ = sim.civs[P.civ[i]];
  const town = sim.towns[b.town];
  let rate = dt * civ.mod.build * (0.7 + P.skill[i] * 0.006) * P.timer[i] * (P.health[i] < 50 ? 0.6 : 1);
  if (town && town.stock[RES_TOOLS] > 0.5) { rate *= 1.35; town.take(RES_TOOLS, dt * 0.0008); }
  if (!b.built) {
    b.progress += rate / b.workNeeded;
    b.hp = Math.min(b.maxHp, b.maxHp * (0.2 + 0.8 * b.progress));
    if (b.progress >= 1) {
      completeBuilding(sim, b);
      P.skill[i] = Math.min(100, P.skill[i] + 1);
      b.builders = 0;
      P.state[i] = S.IDLE;
      return;
    }
  } else {
    b.hp = Math.min(b.maxHp, b.hp + rate * 2);
    if (b.hp >= b.maxHp * 0.99) { P.state[i] = S.IDLE; return; }
  }
  P.cooldown[i] += dt;
  if (P.cooldown[i] > 400 || !workHours(sim, i)) { P.cooldown[i] = 0; P.state[i] = S.IDLE; b.builders = Math.max(0, b.builders - 1); }
}

// ------------------------------------------------------------ harvesting
function harvestThink(sim, i, town, wb) {
  const P = sim.people;
  const h = wb.def.harvest;
  if (h.mine) {
    const [x, y] = inBuilding(wb);
    goTo(sim, i, x, y, A.HARVEST);
    P.target[i] = -1; P.target2[i] = wb.id;
    return;
  }
  const px = sim.pickHarvestPixel(wb, P.x[i], P.y[i]);
  if (px < 0) {
    // nothing left in range: fall back to general labour
    wb.exhausted = (wb.exhausted || 0) + 1;
    laborerThink(sim, i, town);
    return;
  }
  const w = sim.world;
  let tx = px % w.W, ty = (px / w.W) | 0;
  if (TERRAIN[w.ter[px]].water) {
    const s = sim.shorePixel(tx, ty, P.x[i], P.y[i]);
    if (s < 0) { laborerThink(sim, i, town); return; }
    tx = s % w.W; ty = (s / w.W) | 0;
  }
  goTo(sim, i, tx + 0.5, ty + 0.5, A.HARVEST);
  P.target[i] = px; P.target2[i] = wb.id;
}

function startHarvest(sim, i) {
  const P = sim.people;
  const wb = bld(sim, P.target2[i]);
  const h = wb ? wb.def.harvest : null;
  const base = h ? h.time : 70;
  P.state[i] = S.HARVEST;
  P.timer[i] = base * (1.3 - P.skill[i] * 0.004) / Math.max(0.3, sim.workSpeed(i));
}

function finishHarvest(sim, i) {
  const P = sim.people, w = sim.world;
  const civ = sim.civs[P.civ[i]];
  const wb = bld(sim, P.target2[i]);
  const town = townOf(sim, i);
  P.skill[i] = Math.min(100, P.skill[i] + 0.25);
  if (wb && wb.def.harvest && wb.def.harvest.mine) {
    // extract from a deposit pixel in the mine's radius; output straight to stock
    const px = sim.pickHarvestPixel(wb, wb.cx, wb.cy);
    if (px < 0) { wb.exhausted = (wb.exhausted || 0) + 5; P.state[i] = S.IDLE; return; }
    const d = w.dep[px];
    const r = DEP_RES[d];
    let amt = wb.def.harvest.amt * civ.mod.mine * (0.8 + P.skill[i] * 0.005);
    if (town && town.stock[RES_TOOLS] > 0.5) { amt *= 1.25; town.take(RES_TOOLS, 0.01); }
    const take = Math.min(amt, w.amt[px]);
    w.amt[px] -= Math.min(w.amt[px], Math.ceil(take * 0.5));
    if (w.amt[px] <= 0) { sim.depleteDeposit(px); }
    if (town && r >= 0) town.add(r, take);
    if (chance(0.0004)) sim.accident(i, 'mine collapse');
    P.state[i] = S.IDLE;
    return;
  }
  const px = P.target[i];
  const d = px >= 0 ? w.dep[px] : 0;
  if (!d || w.amt[px] <= 0 || DEP_RES[d] < 0) { P.state[i] = S.IDLE; return; }
  const r = DEP_RES[d];
  let base = wb && wb.def.harvest ? wb.def.harvest.amt : 5;
  let mod = civ.mod.gather;
  if (d === D.TREE) mod *= civ.mod.wood;
  else if (d === D.FISH) mod *= civ.mod.fish;
  else if (d === D.STONE || d === D.MARBLE || d === D.CLAY) mod *= civ.mod.mine;
  if (town && town.stock[RES_TOOLS] > 0.5 && d !== D.BERRY) { mod *= 1.25; town.take(RES_TOOLS, 0.008); }
  const amt = Math.min(w.amt[px], Math.max(1, Math.round(base * mod * (0.8 + P.skill[i] * 0.005))));
  w.amt[px] -= amt;
  if (w.amt[px] <= 0) sim.depleteDeposit(px);
  else if (d === D.TREE && w.amt[px] < 40) w.markDirty(px);
  P.carryRes[i] = r; P.carryAmt[i] = amt;
  // the hungry eat what they gather on the spot
  const fv = RESOURCES[r].food;
  if (fv > 0 && P.food[i] < 40) {
    const eat = Math.min(amt, Math.ceil((60 - P.food[i]) / (25 * fv)));
    P.food[i] += eat * fv * 25; P.carryAmt[i] -= eat;
    if (P.carryAmt[i] <= 0) { P.state[i] = S.IDLE; return; }
  }
  // occasional wild honey
  if (d === D.BERRY && chance(0.03) && town) town.add(R('honey'), 1);
  // deliver
  let drop = wb && wb.def.dropoff && (wb.def.dropoff === true || wb.def.dropoff.includes(RESOURCES[r].id)) ? wb : null;
  if (!drop && town) drop = findDropoff(sim, town, P.x[i], P.y[i], r);
  if (!drop) { if (town) town.add(r, amt); P.carryAmt[i] = 0; P.state[i] = S.IDLE; return; }
  const [x, y] = nearBuilding(drop, 1);
  goTo(sim, i, x, y, A.DEPOSIT);
  P.target[i] = drop.id;
  // cutting trees nudges beliefs toward industrialism; gathering toward nature
  if (d === D.TREE && chance(0.1)) P.pushB(i, B.NATURE, -1);
}

function huntThink(sim, i, town, wb) {
  const P = sim.people;
  const civ = sim.civs[P.civ[i]];
  if (civ.isBanned('hunter')) { laborerThink(sim, i, town); return; }
  const an = sim.animals;
  const a = an.nearest(wb.cx, wb.cy, wb.def.harvest.radius, (k) => !ANIMALS[an.type[k]].tameable || !civ.flags.horses);
  if (a < 0) { laborerThink(sim, i, town); return; }
  goTo(sim, i, an.x[a], an.y[a], A.HUNT);
  P.target[i] = a; P.target2[i] = wb.id;
}

function finishHunt(sim, i) {
  const P = sim.people;
  const an = sim.animals;
  const a = P.target[i];
  const town = townOf(sim, i);
  if (a < 0 || !an.alive[a]) { P.state[i] = S.IDLE; return; }
  const dx = an.x[a] - P.x[i], dy = an.y[a] - P.y[i];
  if (dx * dx + dy * dy > 64) {
    // chase a bit more
    if (P.timer[i] > 3) { P.state[i] = S.IDLE; return; }
    P.timer[i] = (P.timer[i] || 0) + 1;
    goTo(sim, i, an.x[a], an.y[a], A.HUNT);
    return;
  }
  const def = ANIMALS[an.type[a]];
  sim.projectile(P.x[i], P.y[i], an.x[a], an.y[a], 0);
  if (def.fierce && chance(0.08)) { P.health[i] -= def.fierce * 3; if (P.health[i] <= 0) { sim.kill(i, 'mauled by a ' + def.name.toLowerCase()); return; } }
  const civ = sim.civs[P.civ[i]];
  an.kill(a);
  P.carryRes[i] = RES_MEAT; P.carryAmt[i] = Math.round(def.meat * civ.mod.hunt);
  P.skill[i] = Math.min(100, P.skill[i] + 0.5);
  if (town) town.add(RES_HIDES, def.hides);
  P.pushB(i, B.ANIMALS, -0.5);
  const wb = bld(sim, P.target2[i]);
  const drop = wb && wb.built ? wb : (town ? findDropoff(sim, town, P.x[i], P.y[i], RES_MEAT) : null);
  if (drop) { const [x, y] = nearBuilding(drop, 1); goTo(sim, i, x, y, A.DEPOSIT); P.target[i] = drop.id; }
  else { if (town) town.add(RES_MEAT, P.carryAmt[i]); P.carryAmt[i] = 0; P.state[i] = S.IDLE; }
}

function fieldThink(sim, i, town, wb) {
  const P = sim.people;
  const f = wb.def.field;
  if (sim.season === 3 && !f.animals) { laborerThink(sim, i, town); return; }
  const [x, y] = inBuilding(wb);
  goTo(sim, i, x, y, A.FIELD);
  P.target[i] = wb.id;
}

function finishField(sim, i) {
  const P = sim.people;
  const wb = bld(sim, P.target[i]);
  const town = townOf(sim, i);
  if (!wb || !town || !wb.def.field) return; // field gone (ids are recycled)
  const civ = sim.civs[P.civ[i]];
  const f = wb.def.field;
  const seasonF = [0.55, 1.0, 1.7, f.animals ? 0.5 : 0][sim.season] * (sim.weatherFarm || 1);
  if (wb.fert === undefined) wb.fert = sim.buildingFertility(wb);
  let y = f.rate * (f.animals ? 0.8 + wb.fert * 0.4 : wb.fert) * seasonF * civ.mod.farm * (0.85 + P.skill[i] * 0.004);
  if (f.warm) y *= Math.max(0.15, Math.min(1.2, (sim.world.temp[(wb.y | 0) * sim.world.W + (wb.x | 0)] - 0.3) * 2.5));
  if (town.stock[RES_TOOLS] > 0.5) { y *= 1.2; town.take(RES_TOOLS, 0.004); }
  // a hungry farmer eats a little of the harvest on the spot
  const fv = RESOURCES[R(f.out)].food;
  if (fv > 0 && P.food[i] < 40) { const eat = Math.min(y, 1.5); y -= eat; P.food[i] += eat * fv * 25; }
  town.add(R(f.out), y);
  if (f.extra) for (const [k, v] of Object.entries(f.extra)) town.add(R(k), v * seasonF * (0.5 + wb.fert * 0.5) * 0.8);
  if (f.horses && civ.flags.horses && chance(f.horses)) town.add(R('horses'), 1);
  wb.growth = Math.min(1, wb.growth + 0.02);
  P.skill[i] = Math.min(100, P.skill[i] + 0.2);
  if (P.b(i, B.TRADITION) < 30 && chance(0.05)) P.pushB(i, B.TRADITION, 1);
}

function plantThink(sim, i, town, wb) {
  const P = sim.people, w = sim.world;
  for (let k = 0; k < 20; k++) {
    const x = (wb.cx + (rand() - 0.5) * 60) | 0, y = (wb.cy + (rand() - 0.5) * 60) | 0;
    if (!w.inb(x, y)) continue;
    const p = y * w.W + x;
    const t = w.ter[p];
    if (w.dep[p] || w.bld[p] || w.road[p]) continue;
    if (t !== T.GRASS && t !== T.FOREST && t !== T.TAIGA && t !== T.JUNGLE && t !== T.PLAINS && t !== T.HILLS) continue;
    goTo(sim, i, x + 0.5, y + 0.5, A.PLANT);
    P.target[i] = p;
    return;
  }
  const [x, y] = inBuilding(wb);
  goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id;
}

// ------------------------------------------------------------ services
function preachThink(sim, i, town, wb) {
  const P = sim.people;
  const [cx, cy] = center(sim, town);
  const a = rand() * 6.283, d = rand() * (town.radius * 0.8 + 10);
  goTo(sim, i, cx + Math.cos(a) * d, cy + Math.sin(a) * d, A.PREACH);
  P.target[i] = wb.id;
}

function healerThink(sim, i, town, wb) {
  const P = sim.people;
  let target = -1, worst = 1e9;
  sim.spatial.query(wb.cx, wb.cy, 70, (j) => {
    if (P.civ[j] !== P.civ[i] || j === i) return false;
    const need = (P.sick[j] > 0 ? 0 : 60) + P.health[j];
    if ((P.sick[j] > 0 || P.health[j] < 60) && need < worst) { worst = need; target = j; }
    return false;
  });
  if (target >= 0 && chance(0.7)) {
    goTo(sim, i, P.x[target], P.y[target], A.HEAL);
    P.target[i] = -2 - target;
    return;
  }
  const [x, y] = inBuilding(wb);
  goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id;
}

function scoutThink(sim, i, town) {
  const P = sim.people;
  const civ = sim.civs[P.civ[i]];
  const NW = CFG.NW, NH = CFG.NH;
  let best = -1, bs = -1;
  const cx0 = (P.x[i] / CFG.NAV) | 0, cy0 = (P.y[i] / CFG.NAV) | 0;
  for (let k = 0; k < 40; k++) {
    const r = 4 + rand() * 25;
    const a = rand() * 6.283;
    const x = (cx0 + Math.cos(a) * r) | 0, y = (cy0 + Math.sin(a) * r) | 0;
    if (x < 0 || y < 0 || x >= NW || y >= NH) continue;
    const c = y * NW + x;
    if (sim.nav.cost[c] >= 1e9) continue;
    let unexplored = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx >= 0 && yy >= 0 && xx < NW && yy < NH && !civ.explored[yy * NW + xx]) unexplored++;
    }
    const s = unexplored * 3 - r * 0.2 + rand() * 2;
    if (s > bs) { bs = s; best = c; }
  }
  if (best < 0 || bs <= 0) {
    // everything nearby explored: roam further from town
    const [cx, cy] = center(sim, town);
    wander(sim, i, cx, cy, 220, 60);
    return;
  }
  const [x, y] = sim.nav.cellCenter(best);
  goTo(sim, i, x, y, A.EXPLORE);
}

function guardThink(sim, i, town, wb) {
  const P = sim.people;
  // chase a known criminal nearby
  let thief = -1;
  sim.spatial.query(P.x[i], P.y[i], 45, (j) => {
    if ((P.flags[j] & 2) && P.state[j] !== S.JAIL && P.civ[j] >= 0) { thief = j; return true; }
    return false;
  });
  if (thief >= 0) { goTo(sim, i, P.x[thief], P.y[thief], A.ATTACK); P.target[i] = thief; return; }
  const [cx, cy] = center(sim, town);
  const a = rand() * 6.283, d = rand() * (town.radius * 0.9 + 10);
  goTo(sim, i, cx + Math.cos(a) * d, cy + Math.sin(a) * d, A.PATROL);
  void wb;
}

function porterThink(sim, i, town, wb) {
  const P = sim.people;
  if (sim.logistics.takeShipment(i, town)) return;
  if (town.construction.length && chance(0.5)) { builderThink(sim, i, town, 0.7); return; }
  const [x, y] = inBuilding(wb);
  goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id;
}

function roadThink(sim, i, town, wb) {
  const P = sim.people, w = sim.world;
  const civ = sim.civs[P.civ[i]];
  const lvl = civ.flags.roadLevel;
  // planned roads first
  while (town.roadPlan.length) {
    const p = town.roadPlan[town.roadPlan.length - 1];
    if ((w.road[p] & 7) >= lvl || w.bld[p]) { town.roadPlan.pop(); continue; }
    goTo(sim, i, p % w.W + 0.5, ((p / w.W) | 0) + 0.5, A.ROAD);
    P.target[i] = p;
    return;
  }
  // otherwise upgrade the busiest path near town
  let best = -1, bt = 0;
  const [cx, cy] = center(sim, town);
  const R0 = town.radius + 30;
  for (let k = 0; k < 60; k++) {
    const x = (cx + (rand() - 0.5) * 2 * R0) | 0, y = (cy + (rand() - 0.5) * 2 * R0) | 0;
    if (!w.inb(x, y)) continue;
    const p = y * w.W + x;
    const tr = w.traffic[p] + ((w.road[p] & 7) ? 30 : 0);
    if ((w.road[p] & 7) >= lvl || w.bld[p]) continue;
    if (TERRAIN[w.ter[p]].water && !(civ.flags.bridge && w.ter[p] === T.RIVER)) continue;
    if (tr > bt) { bt = tr; best = p; }
  }
  if (best >= 0 && bt > 12) {
    goTo(sim, i, best % w.W + 0.5, ((best / w.W) | 0) + 0.5, A.ROAD);
    P.target[i] = best;
    return;
  }
  const [x, y] = inBuilding(wb);
  goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id;
}

function doRoad(sim, i) {
  const P = sim.people, w = sim.world;
  const civ = sim.civs[P.civ[i]];
  const town = townOf(sim, i);
  const lvl = civ.flags.roadLevel;
  const start = P.target[i];
  if (start < 0 || !town) return;
  // pave a short run of the busiest neighbouring pixels
  let p = start, n = 0;
  const seen = new Set();
  while (p >= 0 && n < 8) {
    seen.add(p);
    const t = w.ter[p];
    if (t === T.RIVER) {
      if (!civ.flags.bridge) break;
      const cost = lvl >= 2 ? RES_STONE : RES_WOOD;
      if (town.take(cost, 1.5) < 1) break;
      w.road[p] |= BRIDGE; w.recomputeSpeed(p); w.markDirty(p);
    } else if (TERRAIN[t].water) break;
    if (lvl >= 2) { if (town.take(RES_STONE, 0.4) < 0.3) break; }
    if (lvl >= 4) town.take(R('concrete'), 0.1);
    w.setRoad(p, lvl);
    sim.nav.markDirty(p % w.W, (p / w.W) | 0);
    n++;
    // next: best-traffic 8-neighbour not yet paved
    let next = -1, bt = 4;
    const x = p % w.W, y = (p / w.W) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      if (!w.inb(x + ox, y + oy)) continue;
      const q = (y + oy) * w.W + x + ox;
      if (seen.has(q) || (w.road[q] & 7) >= lvl || w.bld[q]) continue;
      const planned = town.roadPlanSet && town.roadPlanSet.has(q) ? 1000 : 0;
      const tr = w.traffic[q] + planned;
      if (tr > bt) { bt = tr; next = q; }
    }
    p = next;
  }
  P.skill[i] = Math.min(100, P.skill[i] + 0.3);
}

// ------------------------------------------------------------ thieves
function thiefThink(sim, i, town) {
  const P = sim.people;
  if (P.carryAmt[i] > 0) {
    // fence the loot at home: it becomes personal food / luxury
    const home = bld(sim, P.home[i]);
    const [x, y] = home ? inBuilding(home) : center(sim, town);
    goTo(sim, i, x, y, A.RETURN_HOME);
    return;
  }
  if (sim.tod > 0.3 && sim.tod < 0.8 && chance(0.6)) { laborerThink(sim, i, town); return; }
  // pick a storage building to rob (own or a nearby foreign town)
  let targetTown = town;
  if (chance(0.25)) {
    const ft = sim.nearestForeignTown(P.civ[i], P.x[i], P.y[i], 160);
    if (ft) targetTown = ft;
  }
  const store = findDropoff(sim, targetTown, P.x[i], P.y[i], RES_COINS);
  if (!store) { leisureThink(sim, i, town); return; }
  const [x, y] = nearBuilding(store, 1);
  goTo(sim, i, x, y, A.STEAL);
  P.target[i] = store.id;
}

function doSteal(sim, i) {
  const P = sim.people;
  const b = bld(sim, P.target[i]);
  if (!b) return;
  const town = sim.towns[b.town];
  if (!town) return;
  // pick something valuable
  const cands = [RES_COINS, ...LUX_RES, R('bread'), R('meat'), RES_BERRIES, R('grain')];
  let r = -1;
  for (const c of cands) if (town.stock[c] > 3) { r = c; break; }
  if (r < 0) return;
  const amt = Math.min(town.stock[r], r === RES_COINS ? 20 : 6);
  town.take(r, amt);
  town.crime += 1;
  P.carryRes[i] = r; P.carryAmt[i] = amt;
  P.flags[i] |= 2; // wanted
  sim.civs[P.civ[i]].stats.stolen += amt;
  if (town.civ !== P.civ[i]) sim.diplomacy.incident(town.civ, P.civ[i], 1.5, null);
  // caught red-handed?
  let caught = false;
  sim.spatial.query(P.x[i], P.y[i], 14, (j) => {
    if (P.civ[j] === town.civ && (sim.professions[P.prof[j]].kind === 'guard' || sim.professions[P.prof[j]].kind === 'watchman')) { caught = true; return true; }
    return false;
  });
  if (caught) arrest(sim, i, town);
}

export function arrest(sim, i, town) {
  const P = sim.people;
  const civ = sim.civs[town.civ];
  const mercy = civ.beliefAvg[B.MERCY];
  if (P.carryAmt[i] > 0) { town.add(P.carryRes[i], P.carryAmt[i]); P.carryAmt[i] = 0; }
  if (mercy < -40 && chance(0.5)) { sim.kill(i, 'executed for theft'); return; }
  const jail = sim.findBuildingOfType(town, 'courthouse');
  if (jail) {
    P.x[i] = jail.cx; P.y[i] = jail.cy;
    P.state[i] = S.JAIL; P.timer[i] = CFG.TICKS_PER_DAY * (2 + (mercy < 0 ? 3 : 0));
    P.path[i] = null;
  } else {
    P.state[i] = S.WAIT; P.timer[i] = 200;
  }
  P.flags[i] &= ~2;
  P.pushB(i, B.LAW, 3);
  if (chance(0.4 + mercy * 0.003)) sim.jobs.setProf(i, P_LABORER, -1);
}

// ------------------------------------------------------------ arrival
export function arrive(sim, i) {
  const P = sim.people;
  const act = P.act[i];
  P.path[i] = null;
  switch (act) {
    case A.WORK: startWork(sim, i); break;
    case A.HARVEST: startHarvest(sim, i); break;
    case A.DEPOSIT: {
      const b = bld(sim, P.target[i]);
      const town = b ? sim.towns[b.town] : townOf(sim, i);
      if (town && P.carryAmt[i] > 0) {
        if (town.civ === P.civ[i]) town.add(P.carryRes[i], P.carryAmt[i]);
        else townOf(sim, i).add(P.carryRes[i], P.carryAmt[i]);
      }
      P.carryAmt[i] = 0;
      P.state[i] = S.IDLE;
      if (workHours(sim, i)) think(sim, i);
      break;
    }
    case A.BUILD: {
      const b = bld(sim, P.target[i]);
      if (!b) { P.state[i] = S.IDLE; break; }
      P.state[i] = S.BUILD; P.cooldown[i] = 0;
      break;
    }
    case A.SLEEP: P.state[i] = S.SLEEP; break;
    case A.LEISURE: startLeisure(sim, i); break;
    case A.SCHOOL: {
      const b = bld(sim, P.target[i]);
      P.state[i] = S.WAIT; P.timer[i] = 160;
      if (b) {
        const teachers = b.workers.length;
        const civ = sim.civs[P.civ[i]];
        P.edu[i] = Math.min(100, P.edu[i] + (0.6 + teachers * 0.5) * civ.mod.edu);
        // schools teach the civ's official doctrine
        for (let k = 0; k < 2; k++) {
          const s = randInt(NB);
          if (civ.adopted[s]) P.pushB(i, s, civ.adopted[s] * 0.8);
        }
      }
      break;
    }
    case A.FIELD: {
      P.state[i] = S.WORK; P.timer[i] = 110; P.act[i] = A.FIELD;
      break;
    }
    case A.HUNT: finishHunt(sim, i); break;
    case A.PLANT: {
      const w = sim.world, p = P.target[i];
      if (p >= 0 && !w.dep[p] && !w.bld[p]) { w.dep[p] = D.SAPLING; w.amt[p] = 1; w.markDirty(p); sim.saplings.push(p); }
      P.state[i] = S.WAIT; P.timer[i] = 40;
      P.pushB(i, B.NATURE, 0.5);
      break;
    }
    case A.PREACH: {
      const prof = sim.professions[P.prof[i]];
      const civ = sim.civs[P.civ[i]];
      let n = 0;
      sim.spatial.query(P.x[i], P.y[i], 10, (j) => {
        if (j === i || P.civ[j] !== P.civ[i]) return false;
        for (const [k, v] of Object.entries(prof.inf)) P.persuade(j, B[k.toUpperCase()], v * 3);
        if (prof.fx.faith) P.faithSat[j] = Math.min(100, P.faithSat[j] + 30);
        n++;
        return n > 12;
      });
      civ.faithToday += (prof.fx.faith || 0) * 0.3 * (1 + n * 0.1);
      civ.researchToday += (prof.fx.research || 0) * 0.3;
      P.state[i] = S.WAIT; P.timer[i] = 80;
      break;
    }
    case A.HEAL: {
      const t = P.target[i];
      if (t <= -2) {
        const j = -2 - t;
        if (P.civ[j] >= 0) sim.heal(i, j);
        P.state[i] = S.WAIT; P.timer[i] = 60;
      } else {
        // patient reached hospital
        P.state[i] = S.WAIT; P.timer[i] = 240;
        const b = bld(sim, t);
        if (b && b.workers.length) { P.health[i] = Math.min(100, P.health[i] + 15); if (P.sick[i] > 0 && chance(0.25 + b.workers.length * 0.08)) { P.sick[i] = 0; P.immune[i] = 3; } }
      }
      break;
    }
    case A.EXPLORE: {
      const civ = sim.civs[P.civ[i]];
      explore(sim, i, Math.round(3 * civ.mod.vision));
      P.skill[i] = Math.min(100, P.skill[i] + 0.2);
      sim.checkContact(i);
      P.state[i] = S.IDLE;
      if (!isNight(sim)) think(sim, i);
      break;
    }
    case A.PATROL: {
      P.state[i] = S.WAIT; P.timer[i] = 30;
      break;
    }
    case A.ATTACK: {
      const j = P.target[i];
      if (j >= 0 && P.civ[j] >= 0 && (P.flags[j] & 2)) {
        const dx = P.x[j] - P.x[i], dy = P.y[j] - P.y[i];
        if (dx * dx + dy * dy < 36) arrest(sim, j, townOf(sim, i));
        else if (chance(0.7)) { goTo(sim, i, P.x[j], P.y[j], A.ATTACK); break; }
      }
      P.state[i] = S.IDLE;
      break;
    }
    case A.STEAL: doSteal(sim, i); P.state[i] = S.IDLE; break;
    case A.RETURN_HOME: {
      if (P.carryAmt[i] > 0) {
        const r = P.carryRes[i];
        if (RESOURCES[r].food) P.food[i] = 100;
        if (RESOURCES[r].lux || r === RES_COINS) P.lux[i] = Math.min(1, P.lux[i] + 0.5);
        P.carryAmt[i] = 0;
      }
      P.state[i] = S.WAIT; P.timer[i] = 60;
      break;
    }
    case A.ROAD: doRoad(sim, i); P.state[i] = S.WAIT; P.timer[i] = 50; break;
    case A.GARRISON: P.state[i] = S.WAIT; P.timer[i] = 300; break;
    case A.PICKUP: sim.logistics.pickup(i); break;
    case A.DROPOFF: sim.logistics.dropoff(i); break;
    case A.TRADE_SELL: sim.trade.sell(i); break;
    case A.TRADE_HOME: sim.trade.home(i); break;
    case A.DIPLO: sim.diplomacy.arriveDiplomat(i); break;
    case A.SPY: sim.diplomacy.arriveSpy(i); break;
    case A.MISSION: sim.diplomacy.arriveMissionary(i); break;
    case A.SETTLE: sim.settle.arrive(i); break;
    case A.MIGRATE: sim.migrateArrive(i); break;
    case A.RAIL: sim.transport.layRail(i); break;
    case A.BOARD: sim.transport.board(i); break;
    case A.FLEE: P.state[i] = S.WAIT; P.timer[i] = 60; break;
    case A.WANDER: {
      P.state[i] = S.WAIT;
      if (P.timer[i] <= 0) P.timer[i] = 40 + rand() * 60;
      break;
    }
    default:
      P.state[i] = S.IDLE;
  }
}

// ------------------------------------------------------------ work cycles
function startWork(sim, i) {
  const P = sim.people;
  const b = bld(sim, P.target[i]);
  if (!b || !b.built) { P.state[i] = S.IDLE; return; }
  const prof = sim.professions[P.prof[i]];
  P.state[i] = S.WORK;
  if (prof.kind === 'craft' && b.def.recipes) {
    const town = sim.towns[b.town];
    const ri = pickRecipe(sim, b, town, P.civ[i]);
    if (ri < 0) { P.state[i] = S.WAIT; P.timer[i] = 90; P.act[i] = A.NONE; b.stalled = (b.stalled || 0) + 1; return; }
    b.stalled = Math.max(0, (b.stalled || 0) - 2);
    P.target2[i] = ri;
    P.timer[i] = b.def.recipes[ri].time * (1.25 - P.skill[i] * 0.004);
  } else {
    P.target2[i] = -1;
    P.timer[i] = 140;
  }
  P.act[i] = A.WORK;
}

function pickRecipe(sim, b, town, civId) {
  const civ = sim.civs[civId];
  const rs = b.def.recipes;
  let best = -1, bs = -1e9;
  for (let k = 0; k < rs.length; k++) {
    const rc = rs[k];
    if (rc.tech && !civ.has(rc.tech)) continue;
    let ok = true;
    for (const [res, n] of Object.entries(rc.in)) if (town.stock[R(res)] < n) { ok = false; break; }
    if (!ok) continue;
    let s = rand() * 0.2;
    if (rc.power) s += 2 + (town.powerDemand > town.powerSupply ? 3 : 0);
    for (const [res, n] of Object.entries(rc.out)) {
      const r = R(res);
      const want = town.want[r] + 1;
      s += n * RESOURCES[r].base * Math.max(0.05, (want - town.stock[r]) / want);
    }
    for (const [res, n] of Object.entries(rc.in)) {
      const r = R(res);
      s -= n * RESOURCES[r].base * 0.3 * (town.want[r] > town.stock[r] ? 1.5 : 0.5);
    }
    // don't overproduce: stop when well above target
    let over = true;
    for (const res of Object.keys(rc.out)) { const r = R(res); if (town.stock[r] < town.want[r] * 2 + 20) over = false; }
    if (Object.keys(rc.out).length && over) continue;
    if (s > bs) { bs = s; best = k; }
  }
  return best;
}

function finishWork(sim, i) {
  const P = sim.people;
  const act = P.act[i];
  if (act === A.FIELD) { finishField(sim, i); P.state[i] = S.IDLE; return; }
  const b = bld(sim, P.target[i]);
  const prof = sim.professions[P.prof[i]];
  const civ = sim.civs[P.civ[i]];
  if (!b) { P.state[i] = S.IDLE; return; }
  const town = sim.towns[b.town];
  const skillF = 0.75 + P.skill[i] * 0.004 + P.edu[i] * 0.004;
  P.skill[i] = Math.min(100, P.skill[i] + 0.3);
  if (prof.kind === 'craft' && P.target2[i] >= 0 && b.def.recipes && town) {
    const rc = b.def.recipes[P.target2[i]];
    let ok = !!rc;
    if (ok) for (const [res, n] of Object.entries(rc.in)) if (town.stock[R(res)] < n) { ok = false; break; }
    if (ok) {
      for (const [res, n] of Object.entries(rc.in)) town.take(R(res), n);
      const mult = civ.mod.craft * (b.def.cat === 'industry' ? civ.mod.industry : 1) * skillF * (b.def.powerUse ? 0.5 + 0.5 * town.powerRatio : 1);
      for (const [res, n] of Object.entries(rc.out)) town.add(R(res), n * mult);
      if (rc.power) town.powerAcc += rc.power;
      if (rc.fx && rc.fx.happy) town.happyPts = (town.happyPts || 0) + rc.fx.happy;
      b.producedToday++;
    }
  }
  // service outputs
  const fx = prof.fx;
  if (fx.research) civ.researchToday += fx.research * skillF * (1 + P.edu[i] * 0.01);
  if (fx.culture) civ.cultureToday += fx.culture * skillF;
  if (fx.faith) civ.faithToday += fx.faith * skillF;
  if (fx.coins && town) town.add(RES_COINS, fx.coins * skillF * civ.mod.coins);
  if (fx.order && town) town.orderPts = (town.orderPts || 0) + fx.order;
  if (fx.happy && town) town.happyPts = (town.happyPts || 0) + fx.happy * skillF;
  if (fx.diplomacy) sim.diplomacy.goodwill(P.civ[i], fx.diplomacy * 0.02);
  if (fx.loyalty && town) town.loyaltyPts = (town.loyaltyPts || 0) + fx.loyalty;
  if (fx.space) civ.space += fx.space * skillF;
  if (fx.trade && town) town.add(RES_COINS, fx.trade * 0.5);
  if (fx.health && town) {
    let n = 0;
    sim.spatial.query(P.x[i], P.y[i], 25, (j) => {
      if (P.civ[j] === P.civ[i] && P.health[j] < 95) { P.health[j] = Math.min(100, P.health[j] + fx.health * 3); n++; }
      return n > 6;
    });
    if (town.stock[RES_MEDICINE] > 0.5 && chance(0.3)) town.take(RES_MEDICINE, 0.1);
  }
  if (fx.edu && town) {
    sim.spatial.query(P.x[i], P.y[i], 30, (j) => {
      if (P.civ[j] === P.civ[i] && P.age[j] < CFG.ADULT_AGE + 6) P.edu[j] = Math.min(100, P.edu[j] + fx.edu * 0.2 * civ.mod.edu);
      return false;
    });
  }
  // worker's own beliefs drift with their profession
  for (const [k, v] of Object.entries(prof.inf)) P.pushB(i, B[k.toUpperCase()], v * 2);
  if (prof.doctrine) sim.beliefs.doctrinePush(i, 18);
  P.state[i] = S.IDLE;
}

// ------------------------------------------------------------ lookups
function findHospital(sim, town, x, y) {
  let best = null, bd = 1e18;
  for (const id of town.buildings) {
    const b = sim.buildings[id];
    if (!b || !b.built || !(b.def.hospital || b.def.id === 'herbalist_hut')) continue;
    const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function findSchool(sim, town, x, y) {
  let best = null, bd = 1e18;
  for (const id of town.buildings) {
    const b = sim.buildings[id];
    if (!b || !b.built || !b.def.school) continue;
    const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export const _refs = { RES_IRON, RAIL, NRES };

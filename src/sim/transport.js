// Advanced transport: railway lines laid by railwaymen, trains hauling bulk
// freight, ships (fishing boats, freighters, traders, warships) and aircraft.
import { CFG } from '../config.js';
import { RESOURCES, R, NRES } from '../data/resources.js';
import { D, T } from '../world/terrain.js';
import { RAIL } from '../world/world.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { rand, randInt, chance } from '../util/rng.js';

export const SHIP_TYPES = [
  null,
  { name: 'Sailboat', cap: 20, speed: 0.7, len: 2, atk: 0 },
  { name: 'Galley', cap: 40, speed: 0.9, len: 3, atk: 4 },
  { name: 'Caravel', cap: 80, speed: 1.2, len: 3, atk: 8 },
  { name: 'Steamship', cap: 160, speed: 1.7, len: 4, atk: 16 },
  { name: 'Freighter', cap: 300, speed: 2.1, len: 5, atk: 25 },
];
const RES_FISH = R('fish');
const RES_IRON = R('iron');
const RES_COINS = R('coins');

export class Transport {
  constructor(sim) {
    this.sim = sim;
    this.ships = [];
    this.trains = [];
    this.planes = [];
    this.lines = [];
    this.nextId = 1;
  }

  // ------------------------------------------------------------ railways
  planLines(civ) {
    const sim = this.sim;
    if (!civ.flags.rail) return;
    const stations = [];
    for (const tid of civ.towns) {
      const t = sim.towns[tid];
      if (!t) continue;
      for (const id of t.buildings) { const b = sim.buildings[id]; if (b && b.built && b.def.station) { stations.push({ t, b }); break; } }
    }
    // network connectivity over existing lines (a spanning network, not every pair)
    const mine = this.lines.filter((l) => l.civ === civ.id);
    const linked = (ta, tb) => {
      const seen = new Set([ta]), q = [ta];
      while (q.length) {
        const t = q.pop();
        if (t === tb) return true;
        for (const l of mine) {
          const o = l.a === t ? l.b : l.b === t ? l.a : -1;
          if (o >= 0 && !seen.has(o)) { seen.add(o); q.push(o); }
        }
      }
      return false;
    };
    const degree = (tid) => mine.reduce((n, l) => n + (l.a === tid || l.b === tid ? 1 : 0), 0);
    for (let x = 0; x < stations.length; x++) {
      // connect each station to its nearest neighbour not yet reachable by rail
      let best = null, bd = 1e18;
      if (degree(stations[x].t.id) >= 3) continue;
      for (let y = 0; y < stations.length; y++) {
        if (x === y) continue;
        const a = stations[x], b = stations[y];
        if (linked(a.t.id, b.t.id)) continue;
        const d = (a.b.cx - b.b.cx) ** 2 + (a.b.cy - b.b.cy) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) continue;
      const a = stations[x];
      const path = this.railPath(a.b, best.b);
      if (!path) continue;
      const line = { id: this.nextId++, civ: civ.id, a: a.t.id, b: best.t.id, path, laid: 0, active: false, queue: [] };
      for (const p of path) if (sim.world.road[p] & RAIL) line.laid++;
      this.lines.push(line);
      mine.push(line);
      sim.chronicle(`${civ.name} begins a railway between ${a.t.name} and ${best.t.name}.`, civ.id, 'transport');
    }
  }

  railPath(sa, sb) {
    const sim = this.sim, w = sim.world;
    const cells = sim.nav.findPath(sa.cx, sa.y + sa.h + 1, sb.cx, sb.y + sb.h + 1, false);
    if (!cells) return null;
    const pts = [[sa.cx | 0, (sa.y + sa.h + 1) | 0]];
    for (let k = 1; k < cells.length - 1; k++) { const [x, y] = sim.nav.cellCenter(cells[k]); pts.push([x | 0, y | 0]); }
    pts.push([sb.cx | 0, (sb.y + sb.h + 1) | 0]);
    const out = [];
    const seen = new Set();
    for (let k = 0; k < pts.length - 1; k++) {
      let [x0, y0] = pts[k]; const [x1, y1] = pts[k + 1];
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        const p = y0 * w.W + x0;
        if (!seen.has(p)) { seen.add(p); out.push(p); }
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    return Int32Array.from(out);
  }

  railThink(i, town, wb) {
    const sim = this.sim, P = sim.people, w = sim.world;
    for (const line of this.lines) {
      if (line.civ !== P.civ[i] || line.active || (line.a !== town.id && line.b !== town.id)) continue;
      // next unlaid pixel from our end
      const fromA = line.a === town.id;
      const n = line.path.length;
      for (let k = 0; k < n; k++) {
        const p = line.path[fromA ? k : n - 1 - k];
        if (!(w.road[p] & RAIL)) {
          goTo(sim, i, p % w.W + 0.5, ((p / w.W) | 0) + 0.5, A.RAIL);
          P.target[i] = line.id; P.target2[i] = fromA ? k : n - 1 - k;
          return;
        }
      }
    }
    goTo(sim, i, wb.cx, wb.cy, A.WORK); P.target[i] = wb.id;
  }

  layRail(i) {
    const sim = this.sim, P = sim.people, w = sim.world;
    const line = this.lines.find((l) => l.id === P.target[i]);
    const town = sim.towns[P.town[i]];
    if (!line || !town) { P.state[i] = S.IDLE; return; }
    let k = P.target2[i];
    const dir = line.a === town.id ? 1 : -1;
    for (let n = 0; n < 10 && k >= 0 && k < line.path.length; n++, k += dir) {
      const p = line.path[k];
      if (w.road[p] & RAIL) continue;
      if (town.take(RES_IRON, 0.15) < 0.1 && town.take(R('steel'), 0.1) < 0.05) break;
      w.road[p] |= RAIL;
      if (w.dep[p] === D.TREE) { w.dep[p] = 0; w.amt[p] = 0; }
      if (w.ter[p] === T.RIVER) w.road[p] |= 16;
      w.recomputeSpeed(p); w.markDirty(p);
      line.laid++;
    }
    if (line.laid >= line.path.length) {
      let all = true;
      for (const p of line.path) if (!(w.road[p] & RAIL)) { all = false; break; }
      if (all && !line.active) {
        line.active = true;
        const civ = sim.civs[line.civ];
        this.trains.push({ id: this.nextId++, line: line.id, civ: line.civ, pos: 0, dir: 1, wait: 60, cargo: [], x: 0, y: 0, len: 6 });
        sim.chronicle(`🚂 The ${sim.towns[line.a].name}–${sim.towns[line.b].name} railway opens (${civ.name}).`, line.civ, 'transport');
      }
    }
    P.skill[i] = Math.min(100, P.skill[i] + 0.5);
    P.state[i] = S.WAIT; P.timer[i] = 30;
  }

  lineBetween(a, b) {
    return this.lines.find((l) => l.active && ((l.a === a && l.b === b) || (l.a === b && l.b === a)));
  }

  // Try to move a shipment in bulk by train or ship. Returns true if taken.
  tryBulk(src, dest, s) {
    const line = this.lineBetween(src.id, dest.id);
    if (line) {
      const amt = src.take(s.res, Math.min(s.amt, 200));
      if (amt > 0) line.queue.push({ from: src.id, to: dest.id, res: s.res, amt });
      s.done = true;
      return true;
    }
    if (src.coastal && dest.coastal) {
      const ship = this.ships.find((sh) => sh.civ === src.civ && sh.home === src.id && sh.state === 'docked');
      if (ship && this.hasDock(dest)) {
        const amt = src.take(s.res, Math.min(s.amt, SHIP_TYPES[ship.level].cap));
        if (amt > 0) { ship.cargo = { res: s.res, amt }; this.sail(ship, this.hasDock(dest), 'freight'); ship.destTown = dest.id; }
        s.done = true;
        return true;
      }
    }
    return false;
  }

  hasDock(town) {
    for (const id of town.buildings) { const b = this.sim.buildings[id]; if (b && b.built && b.def.harbor) return b; }
    return null;
  }

  board(i) { const P = this.sim.people; P.state[i] = S.IDLE; }

  // ------------------------------------------------------------ vehicles
  update(dt) {
    const sim = this.sim, w = sim.world;
    // trains
    for (let k = this.trains.length - 1; k >= 0; k--) {
      const tr = this.trains[k];
      const line = this.lines.find((l) => l.id === tr.line);
      if (!line) { this.trains.splice(k, 1); continue; }
      const n = line.path.length;
      if (tr.wait > 0) {
        tr.wait -= dt;
        if (tr.wait <= 0) {
          // load at the current terminus
          const here = tr.dir > 0 ? line.a : line.b;
          const keep = [];
          for (const c of line.queue) { if (c.from === here && tr.cargo.length < 8) tr.cargo.push(c); else keep.push(c); }
          line.queue = keep;
        }
      } else {
        const civ = sim.civs[tr.civ];
        tr.pos += tr.dir * dt * 2.6 * (civ.has('electricity') ? 1.4 : 1);
        if (tr.pos >= n - 1 || tr.pos <= 0) {
          tr.pos = Math.max(0, Math.min(n - 1, tr.pos));
          const arrived = tr.dir > 0 ? line.b : line.a;
          const town = sim.towns[arrived];
          for (const c of tr.cargo) if (town && town.alive) town.add(c.res, c.amt);
          if (tr.cargo.length) civ.stats.freight = (civ.stats.freight || 0) + tr.cargo.length;
          tr.cargo = [];
          tr.dir = -tr.dir;
          tr.wait = 80;
          if (town) town.add(RES_COINS, 1);
        }
      }
      const p = line.path[Math.round(tr.pos)];
      tr.x = p % w.W; tr.y = (p / w.W) | 0;
      tr.pathRef = line.path;
    }
    // ships
    for (let k = this.ships.length - 1; k >= 0; k--) {
      const sh = this.ships[k];
      const home = sim.buildings[sh.dock];
      if (!home || home.civ !== sh.civ) { this.ships.splice(k, 1); continue; }
      this.updateShip(sh, dt);
    }
    // planes
    for (let k = this.planes.length - 1; k >= 0; k--) {
      const pl = this.planes[k];
      const dx = pl.tx - pl.x, dy = pl.ty - pl.y;
      const d = Math.hypot(dx, dy);
      const sp = 5 * dt;
      if (d < sp) {
        const civ = sim.civs[pl.civ];
        civ.researchToday += 0.3; civ.cultureToday += 0.2;
        this.planes.splice(k, 1);
      } else { pl.x += dx / d * sp; pl.y += dy / d * sp; }
    }
  }

  sail(sh, targetBuilding, task, tx, ty) {
    const sim = this.sim;
    const x = targetBuilding ? targetBuilding.cx : tx, y = targetBuilding ? targetBuilding.cy : ty;
    const path = sim.nav.findPath(sh.x, sh.y, x, y, true);
    if (!path) { sh.state = 'docked'; sh.wait = 200; return false; }
    sh.path = path; sh.pi = 0; sh.task = task; sh.state = 'sailing';
    sh.target = targetBuilding ? targetBuilding.id : -1;
    return true;
  }

  updateShip(sh, dt) {
    const sim = this.sim, w = sim.world;
    const type = SHIP_TYPES[sh.level];
    if (sh.state === 'docked') {
      sh.wait -= dt;
      if (sh.wait > 0) return;
      this.assignShip(sh);
      return;
    }
    if (sh.state === 'fishing') {
      sh.wait -= dt;
      if (sh.wait <= 0) {
        // gather from fish pixels near the boat
        let got = 0;
        for (let t = 0; t < 30 && got < type.cap * 0.5; t++) {
          const px = (sh.x + (rand() - 0.5) * 20) | 0, py = (sh.y + (rand() - 0.5) * 20) | 0;
          if (!w.inb(px, py)) continue;
          const p = py * w.W + px;
          if (w.dep[p] === D.FISH && w.amt[p] > 0) { const a = Math.min(w.amt[p], 6); w.amt[p] -= a; got += a; }
        }
        sh.cargo = { res: RES_FISH, amt: got * sim.civs[sh.civ].mod.fish * (1 + sim.civs[sh.civ].mod.naval * 0.2) + 2 };
        this.sail(sh, sim.buildings[sh.dock], 'return');
      }
      return;
    }
    if (sh.state === 'sailing') {
      if (!sh.path || sh.pi >= sh.path.length) { this.arriveShip(sh); return; }
      const c = sh.path[sh.pi];
      const [tx, ty] = sim.nav.cellCenter(c);
      const dx = tx - sh.x, dy = ty - sh.y;
      const d = Math.hypot(dx, dy);
      const sp = type.speed * dt * sim.civs[sh.civ].mod.naval;
      if (d < sp) { sh.x = tx; sh.y = ty; sh.pi++; } else { sh.x += dx / d * sp; sh.y += dy / d * sp; sh.ang = Math.atan2(dy, dx); }
      // warships engage enemies at sea
      if (type.atk && sim.military.anyWar && ((sim.tick + sh.id) & 15) === 0) this.naval(sh);
    }
  }

  assignShip(sh) {
    const sim = this.sim;
    const town = sim.towns[sh.home];
    if (!town) return;
    const civ = sim.civs[sh.civ];
    // freight handled via tryBulk; trade with partners' harbors
    if (chance(0.35)) {
      for (const o of sim.civs) {
        if (!o.alive || o.id === civ.id || !sim.diplomacy.tradeAllowed(civ.id, o.id)) continue;
        for (const tid of o.towns) {
          const t = sim.towns[tid];
          const dock = t && t.coastal ? this.hasDock(t) : null;
          if (!dock) continue;
          // export our best surplus
          let best = -1, bs = 0;
          for (let r = 0; r < NRES; r++) {
            if (r === RES_COINS) continue;
            const sur = town.stock[r] - town.want[r] * 1.2;
            if (sur < 10) continue;
            const ratio = sim.economy.price(o.id, r) / sim.economy.price(civ.id, r);
            if (ratio > bs) { bs = ratio; best = r; }
          }
          if (best < 0 || bs < 1.1) continue;
          const amt = town.take(best, Math.min(SHIP_TYPES[sh.level].cap, town.stock[best] - town.want[best] * 1.2));
          sh.cargo = { res: best, amt };
          sh.destTown = tid;
          if (this.sail(sh, dock, 'trade')) return;
          town.add(best, amt); sh.cargo = null;
        }
      }
    }
    // fishing
    let best = -1, bs = 0;
    for (let t = 0; t < 30; t++) {
      const x = sh.x + (rand() - 0.5) * 140, y = sh.y + (rand() - 0.5) * 140;
      const c = sim.nav.cellOf(x, y);
      if (sim.nav.wcost[c] >= 1e9 || sim.nav.wcomp[c] !== sim.nav.wcomp[sim.nav.cellOf(sh.x, sh.y)]) continue;
      const n = sim.cellDepCount(c, D.FISH);
      if (n > bs) { bs = n; best = c; }
    }
    if (best >= 0 && bs > 2) {
      const [x, y] = sim.nav.cellCenter(best);
      if (this.sail(sh, null, 'fish', x, y)) return;
    }
    sh.wait = 300;
  }

  arriveShip(sh) {
    const sim = this.sim;
    if (sh.task === 'fish') { sh.state = 'fishing'; sh.wait = 150; return; }
    if (sh.task === 'return') {
      const town = sim.towns[sh.home];
      if (town && sh.cargo) town.add(sh.cargo.res, sh.cargo.amt);
      sh.cargo = null; sh.state = 'docked'; sh.wait = 60;
      return;
    }
    if (sh.task === 'freight') {
      const t = sim.towns[sh.destTown];
      if (t && sh.cargo) t.add(sh.cargo.res, sh.cargo.amt);
      sh.cargo = null;
      this.sail(sh, sim.buildings[sh.dock], 'return');
      return;
    }
    if (sh.task === 'trade') {
      const t = sim.towns[sh.destTown];
      if (t && sh.cargo && sim.diplomacy.tradeAllowed(sh.civ, t.civ)) {
        const o = sim.civs[t.civ];
        const value = sh.cargo.amt * sim.economy.price(o.id, sh.cargo.res);
        t.add(sh.cargo.res, sh.cargo.amt);
        // buy back the most profitable good
        let best = -1, bs = 1;
        for (let r = 0; r < NRES; r++) {
          if (r === RES_COINS || t.stock[r] - t.want[r] < 5) continue;
          const ratio = sim.economy.price(sh.civ, r) / sim.economy.price(o.id, r);
          if (ratio > bs) { bs = ratio; best = r; }
        }
        if (best >= 0) {
          const units = Math.min(t.stock[best] - t.want[best], value / sim.economy.price(o.id, best));
          sh.cargo = { res: best, amt: t.take(best, units) };
        } else {
          const coins = Math.min(t.stock[RES_COINS], value * 0.8);
          sh.cargo = { res: RES_COINS, amt: t.take(RES_COINS, coins) };
        }
        const p = sim.diplomacy.pair(sh.civ, o.id);
        p.tradeToday += value;
        sim.civs[sh.civ].stats.tradeVolume += value;
        sim.diplomacy.addRel(sh.civ, o.id, 0.4);
      }
      this.sail(sh, sim.buildings[sh.dock], 'return');
      return;
    }
    sh.state = 'docked'; sh.wait = 100;
  }

  naval(sh) {
    const sim = this.sim;
    const type = SHIP_TYPES[sh.level];
    for (const o of this.ships) {
      if (o === sh || !sim.military.atWarBetween(sh.civ, o.civ)) continue;
      if ((o.x - sh.x) ** 2 + (o.y - sh.y) ** 2 > 400) continue;
      o.hp -= type.atk * (0.7 + rand() * 0.6);
      sim.projectile(sh.x, sh.y, o.x, o.y, sh.level >= 4 ? 2 : 1);
      if (o.hp <= 0) {
        this.ships.splice(this.ships.indexOf(o), 1);
        sim.chronicle(`A ${SHIP_TYPES[o.level].name.toLowerCase()} of ${sim.civs[o.civ].name} is sunk by ${sim.civs[sh.civ].name}.`, sh.civ, 'war');
      }
      return;
    }
  }

  // Road builders connect their town to the nearest unlinked sister town.
  planRoads(civ) {
    const sim = this.sim, w = sim.world;
    if (civ.flags.roadLevel < 2 || civ.towns.length < 2) return;
    for (const tid of civ.towns) {
      const town = sim.towns[tid];
      if (!town || town.roadPlan.length) continue;
      if (!sim.findBuildingOfType(town, 'road_guild')) continue;
      town.roadLinks = town.roadLinks || new Set();
      let best = null, bd = 1e18;
      for (const oid of civ.towns) {
        const o = sim.towns[oid];
        if (!o || o === town || town.roadLinks.has(oid)) continue;
        const d = (o.cx - town.cx) ** 2 + (o.cy - town.cy) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      town.roadLinks.add(best.id);
      if (best.roadLinks) best.roadLinks.add(town.id); else best.roadLinks = new Set([town.id]);
      const a = sim.buildings[town.center], b = sim.buildings[best.center];
      if (!a || !b) continue;
      const path = this.railPath(a, b);
      if (!path) continue;
      const pixels = [];
      for (const p of path) {
        if (w.bld[p] || (w.road[p] & 7) >= civ.flags.roadLevel) continue;
        if (w.ter[p] === T.RIVER && !civ.flags.bridge) continue;
        pixels.push(p);
      }
      town.roadPlan = pixels.reverse();
      town.roadPlanSet = new Set(pixels);
      if (pixels.length > 20) sim.chronicle(`Road builders of ${town.name} begin a highway to ${best.name}.`, civ.id, 'transport');
    }
  }

  // Daily: spawn ships at docks, flights at airports, plan railways and roads.
  daily() {
    const sim = this.sim;
    // lines whose termini were lost or abandoned fall out of service (the track remains)
    this.lines = this.lines.filter((l) => {
      const a = sim.towns[l.a], b = sim.towns[l.b];
      return a && b && a.alive && b.alive && a.civ === l.civ && b.civ === l.civ;
    });
    for (const civ of sim.civs) {
      if (!civ.alive) continue;
      if (civ.flags.rail && sim.day % 3 === 0) this.planLines(civ);
      if (sim.day % 4 === 1) this.planRoads(civ);
      const airports = [];
      for (const tid of civ.towns) {
        const town = sim.towns[tid];
        if (!town) continue;
        for (const id of town.buildings) {
          const b = sim.buildings[id];
          if (!b || !b.built) continue;
          if (b.def.harbor && civ.flags.ships) {
            const have = this.ships.filter((s) => s.dock === b.id).length;
            const want = Math.min(b.def.shipyard ? 4 : 2, b.workers.length);
            if (have < want && town.take(R('wood'), 10) >= 10) {
              const level = Math.min(civ.flags.ships, b.def.shipyard ? 5 : 2);
              const wc = sim.nav.nearestWater(sim.nav.cellOf(b.cx, b.cy + b.h));
              if (wc >= 0) {
                const [x, y] = sim.nav.cellCenter(wc);
                this.ships.push({ id: this.nextId++, civ: civ.id, dock: b.id, home: town.id, level, x, y, ang: 0, state: 'docked', wait: 50, hp: 60 + level * 40, cargo: null, path: null, pi: 0 });
              }
            }
          }
          if (b.def.airport && b.workers.length) airports.push(b);
        }
      }
      // flights between airports (own or allied/trade partners)
      if (civ.flags.flight) {
        for (const a of airports) {
          if (!chance(0.5)) continue;
          const dests = [];
          for (const o of sim.civs) {
            if (!o.alive || (o.id !== civ.id && !sim.diplomacy.tradeAllowed(civ.id, o.id))) continue;
            for (const tid of o.towns) { const t = sim.towns[tid]; if (!t) continue; for (const id of t.buildings) { const b = sim.buildings[id]; if (b && b.built && b.def.airport && b !== a) dests.push(b); } }
          }
          if (!dests.length) continue;
          const d = dests[randInt(dests.length)];
          const home = sim.towns[a.town];
          if (!home || home.take(R('fuel'), 2) < 1) continue;
          this.planes.push({ civ: civ.id, x: a.cx, y: a.cy, tx: d.cx, ty: d.cy, sx: a.cx, sy: a.cy });
          // foreign flights carry travellers and business
          if (d.civ !== civ.id) sim.diplomacy.pair(civ.id, d.civ).tradeToday += 20;
        }
      }
    }
  }
}

export { CFG, RESOURCES };

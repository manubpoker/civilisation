// Person movement: path requests, waypoint following and road-seeking steering.
import { CFG } from '../config.js';
import { S, A } from './people.js';

const PENDING = 0;   // sentinel stored in path array while waiting for A*
const COS = Math.cos(0.6), SIN = Math.sin(0.6);

export function goTo(sim, i, x, y, act) {
  const P = sim.people;
  const w = sim.world;
  x = Math.max(1, Math.min(w.W - 2, x)); y = Math.max(1, Math.min(w.H - 2, y));
  P.gx[i] = x; P.gy[i] = y;
  P.act[i] = act;
  P.state[i] = S.MOVE;
  P.stuck[i] = 0;
  P.pathIdx[i] = 0;
  const dx = x - P.x[i], dy = y - P.y[i];
  if (dx * dx + dy * dy < 22 * 22) { P.path[i] = null; return true; }
  const p = sim.nav.findPath(P.x[i], P.y[i], x, y, false);
  if (p === undefined) { P.path[i] = PENDING; return true; }
  if (p === null) {
    // unreachable: give up quietly
    P.path[i] = null;
    P.state[i] = S.WAIT; P.timer[i] = 30; P.act[i] = A.NONE;
    return false;
  }
  P.path[i] = p;
  P.pathIdx[i] = p.length > 1 ? 1 : 0;
  return true;
}

export function personSpeed(sim, i) {
  const P = sim.people;
  let s = CFG.BASE_SPEED * sim.civs[P.civ[i]].mod.move;
  const age = P.age[i];
  if (age < 8) s *= 0.7; else if (age > 65) s *= 0.75;
  if (P.health[i] < 40) s *= 0.6;
  if (P.carryAmt[i] > 0) s *= 0.85;
  return s * sim.profSpeed[P.prof[i]];
}

// Advance a moving person. Returns true on arrival.
export function moveStep(sim, i, dt) {
  const P = sim.people, w = sim.world;
  let path = P.path[i];
  if (path === PENDING) {
    const p = sim.nav.findPath(P.x[i], P.y[i], P.gx[i], P.gy[i], false);
    if (p === null) { P.path[i] = null; P.state[i] = S.WAIT; P.timer[i] = 20; P.act[i] = A.NONE; return false; }
    if (p !== undefined) { P.path[i] = path = p; P.pathIdx[i] = p.length > 1 ? 1 : 0; }
    else path = null; // move straight while waiting
  }
  let tx, ty;
  const NW = CFG.NW, NAV = CFG.NAV;
  if (path && P.pathIdx[i] < path.length - 1) {
    const c = path[P.pathIdx[i]];
    const j = (i * 2654435761) >>> 0;
    tx = (c % NW) * NAV + 1.5 + (j & 7) * 0.7;
    ty = ((c / NW) | 0) * NAV + 1.5 + ((j >> 3) & 7) * 0.7;
  } else { tx = P.gx[i]; ty = P.gy[i]; }
  let x = P.x[i], y = P.y[i];
  let dx = tx - x, dy = ty - y;
  let d = Math.sqrt(dx * dx + dy * dy);
  const here = w.speedAt(x, y);
  const step = personSpeedCached(sim, i) * dt * (here > 0.15 ? here : 0.15);
  if (d <= step) {
    P.x[i] = tx; P.y[i] = ty;
    if (path && P.pathIdx[i] < path.length - 1) {
      P.pathIdx[i]++;
      return false;
    }
    trackPixel(sim, i);
    return true;
  }
  let ux = dx / d, uy = dy / d;
  // look ahead: straight vs. +-34 degrees, prefer faster (roads) ground
  const la = Math.max(1.5, step * 2);
  let best = w.speedAt(x + ux * la, y + uy * la);
  const tickPar = (sim.tick + i) & 3;
  if (tickPar === 0 || best < here * 0.85 || best === 0) {
    const lx = ux * COS - uy * SIN, ly = ux * SIN + uy * COS;
    const rx = ux * COS + uy * SIN, ry = -ux * SIN + uy * COS;
    const sl = w.speedAt(x + lx * la, y + ly * la) * COS;
    const sr = w.speedAt(x + rx * la, y + ry * la) * COS;
    if (sl > best * 1.05 && sl >= sr) { ux = lx; uy = ly; best = sl; }
    else if (sr > best * 1.05) { ux = rx; uy = ry; best = sr; }
    if (best === 0) {
      // blocked: try perpendicular directions
      const px = -uy, py = ux;
      if (w.speedAt(x + px * la, y + py * la) > 0) { ux = px; uy = py; best = 1; }
      else if (w.speedAt(x - px * la, y - py * la) > 0) { ux = -px; uy = -py; best = 1; }
    }
  }
  if (best === 0) {
    P.stuck[i] += dt;
    if (P.stuck[i] > 120) {
      // give up and hop to the waypoint (rare; avoids permanent jams)
      P.x[i] = tx; P.y[i] = ty; P.stuck[i] = 0;
    }
    return false;
  }
  const nx = x + ux * step, ny = y + uy * step;
  if (sim.military.anyWar) {
    const np = (ny | 0) * w.W + (nx | 0);
    const wl = sim.wallMap[np];
    if (wl && wl - 1 !== P.civ[i] && sim.military.atWarBetween(P.civ[i], wl - 1)) {
      // enemy wall blocks the way: soldiers assault it, others wait
      if (sim.professions[P.prof[i]].mil) { P.state[i] = S.FIGHT; P.target[i] = -10 - (w.bld[np] - 1); }
      else { P.state[i] = S.WAIT; P.timer[i] = 40; }
      return false;
    }
  }
  P.x[i] = nx;
  P.y[i] = ny;
  // skip waypoint if we've drifted past it
  if (path && P.pathIdx[i] < path.length - 2) {
    const c2 = path[P.pathIdx[i] + 1];
    const nx2 = (c2 % NW) * NAV + 4, ny2 = ((c2 / NW) | 0) * NAV + 4;
    const e = (nx2 - P.x[i]) ** 2 + (ny2 - P.y[i]) ** 2;
    if (e < d * d) P.pathIdx[i]++;
  }
  trackPixel(sim, i);
  return false;
}

function personSpeedCached(sim, i) {
  return sim.speedCache[i];
}

function trackPixel(sim, i) {
  const P = sim.people, w = sim.world;
  const px = (P.y[i] | 0) * w.W + (P.x[i] | 0);
  if (px !== P.lastPx[i]) {
    P.lastPx[i] = px;
    if (w.traffic[px] < 65000) w.traffic[px] += 1;
  }
}

// Mark cells seen by this person as explored for their civ.
export function explore(sim, i, radiusCells) {
  const P = sim.people;
  const civ = sim.civs[P.civ[i]];
  const NW = CFG.NW, NH = CFG.NH;
  const cx = (P.x[i] / CFG.NAV) | 0, cy = (P.y[i] / CFG.NAV) | 0;
  const r = radiusCells;
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (ox * ox + oy * oy > r * r + 1) continue;
    const x = cx + ox, y = cy + oy;
    if (x < 0 || y < 0 || x >= NW || y >= NH) continue;
    const c = y * NW + x;
    if (!civ.explored[c]) { civ.explored[c] = 1; civ.exploredCount++; }
  }
}

export { PENDING };

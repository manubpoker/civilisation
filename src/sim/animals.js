// Wildlife: herds of deer, boar, bison, wild horses and packs of wolves.
import { CFG } from '../config.js';
import { T, TERRAIN } from '../world/terrain.js';
import { rand, randInt } from '../util/rng.js';

export const ANIMALS = [
  { name: 'Deer', color: [150, 110, 70], hp: 20, speed: 0.7, meat: 6, hides: 2, biomes: [T.FOREST, T.GRASS, T.TAIGA], herd: 5 },
  { name: 'Boar', color: [90, 70, 60], hp: 30, speed: 0.55, meat: 8, hides: 1, biomes: [T.FOREST, T.JUNGLE, T.MARSH], herd: 3, fierce: 4 },
  { name: 'Bison', color: [70, 50, 40], hp: 60, speed: 0.5, meat: 14, hides: 4, biomes: [T.PLAINS, T.GRASS, T.SAVANNA], herd: 8 },
  { name: 'Wild Horse', color: [130, 90, 60], hp: 30, speed: 0.95, meat: 8, hides: 2, biomes: [T.PLAINS, T.SAVANNA, T.GRASS], herd: 6, tameable: true },
  { name: 'Wolf', color: [110, 110, 120], hp: 25, speed: 0.85, meat: 3, hides: 2, biomes: [T.TAIGA, T.FOREST, T.TUNDRA], herd: 4, predator: true, fierce: 7 },
];

export class Animals {
  constructor(cap = CFG.MAX_ANIMALS) {
    this.cap = cap;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.tx = new Float32Array(cap); this.ty = new Float32Array(cap);
    this.type = new Uint8Array(cap);
    this.hp = new Float32Array(cap);
    this.alive = new Uint8Array(cap);
    this.herd = new Int32Array(cap);
    this.timer = new Float32Array(cap);
    this.count = 0;
    this.hwm = 0;
    this.free = [];
    this.nextHerd = 1;
    this.byType = new Int32Array(ANIMALS.length);
  }
  add(type, x, y, herd) {
    let i;
    if (this.free.length) i = this.free.pop();
    else if (this.hwm < this.cap) i = this.hwm++;
    else return -1;
    this.x[i] = x; this.y[i] = y; this.tx[i] = x; this.ty[i] = y;
    this.type[i] = type; this.hp[i] = ANIMALS[type].hp; this.alive[i] = 1; this.herd[i] = herd; this.timer[i] = rand() * 100;
    this.count++; this.byType[type]++;
    return i;
  }
  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0; this.count--; this.byType[this.type[i]]--; this.free.push(i);
  }
  populate(world, n) {
    for (let k = 0; k < n * 4 && this.count < n; k++) {
      const x = 10 + randInt(world.W - 20), y = 10 + randInt(world.H - 20);
      const t = world.ter[y * world.W + x];
      const cands = [];
      for (let a = 0; a < ANIMALS.length; a++) if (ANIMALS[a].biomes.includes(t)) cands.push(a);
      if (!cands.length) continue;
      const type = cands[randInt(cands.length)];
      const herd = this.nextHerd++;
      const size = 1 + randInt(ANIMALS[type].herd);
      for (let h = 0; h < size; h++) this.add(type, x + rand() * 6 - 3, y + rand() * 6 - 3, herd);
    }
  }
  nearest(x, y, r, filter) {
    let best = -1, bd = r * r;
    for (let i = 0; i < this.hwm; i++) {
      if (!this.alive[i]) continue;
      const dx = this.x[i] - x, dy = this.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd && (!filter || filter(i))) { bd = d; best = i; }
    }
    return best;
  }
  update(sim, dt) {
    const w = sim.world;
    // staggered: each animal is updated every 4th step with a 4x time step
    this.phase = ((this.phase || 0) + 1) & 3;
    const ph = this.phase;
    dt *= 4;
    for (let i = ph; i < this.hwm; i += 4) {
      if (!this.alive[i]) continue;
      const def = ANIMALS[this.type[i]];
      this.timer[i] -= dt;
      if (this.timer[i] <= 0) {
        // pick a new wander target near herd-mates
        this.timer[i] = 80 + rand() * 200;
        const ang = rand() * 6.283, d = 5 + rand() * 25;
        let nx = this.x[i] + Math.cos(ang) * d, ny = this.y[i] + Math.sin(ang) * d;
        // flee from nearby people (not wolves)
        if (!def.predator) {
          let fx = 0, fy = 0, n = 0;
          sim.spatial.query(this.x[i], this.y[i], 14, (p) => {
            fx += this.x[i] - sim.people.x[p]; fy += this.y[i] - sim.people.y[p]; n++;
            return n > 4;
          });
          if (n) { const l = Math.hypot(fx, fy) || 1; nx = this.x[i] + fx / l * 30; ny = this.y[i] + fy / l * 30; this.timer[i] = 60; }
        }
        if (w.inb(nx | 0, ny | 0)) {
          const t = w.ter[(ny | 0) * w.W + (nx | 0)];
          if (TERRAIN[t].speed > 0 && !w.bld[(ny | 0) * w.W + (nx | 0)]) { this.tx[i] = nx; this.ty[i] = ny; }
        }
      }
      const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i];
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const sp = def.speed * 0.5 * dt * Math.max(0.2, w.speedAt(this.x[i], this.y[i]));
        const s = Math.min(d, sp);
        const nx = this.x[i] + dx / d * s, ny = this.y[i] + dy / d * s;
        if (w.speedAt(nx, ny) > 0) { this.x[i] = nx; this.y[i] = ny; } else this.timer[i] = 0;
      }
    }
  }
  // Slow natural regrowth, called once per day.
  daily(sim) {
    const target = 1400;
    if (this.count < target) {
      const born = Math.min(40, Math.ceil((target - this.count) * 0.04));
      for (let k = 0; k < born; k++) {
        const j = randInt(Math.max(1, this.hwm));
        if (!this.alive[j]) continue;
        this.add(this.type[j], this.x[j] + rand() * 4 - 2, this.y[j] + rand() * 4 - 2, this.herd[j]);
      }
      if (this.count < 200) this.populate(sim.world, this.count + 60);
    }
  }
}

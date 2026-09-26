// Structure-of-arrays storage for every person (each one is a pixel).
import { CFG } from '../config.js';
import { NB } from '../data/beliefs.js';
import { rand } from '../util/rng.js';

// states
export const S = {
  IDLE: 0, MOVE: 1, WORK: 2, HARVEST: 3, BUILD: 4, SLEEP: 5, LEISURE: 6,
  FIGHT: 7, WAIT: 8, INSIDE: 9, JAIL: 10, DEAD: 255,
};
// arrival actions
export const A = {
  NONE: 0, WORK: 1, HARVEST: 2, DEPOSIT: 3, BUILD: 4, SLEEP: 5, LEISURE: 6, PICKUP: 7,
  DROPOFF: 8, TRADE_SELL: 9, TRADE_HOME: 10, DIPLO: 11, SPY: 12, EXPLORE: 13, PATROL: 14,
  SETTLE: 15, ROAD: 16, PLANT: 17, HUNT: 18, PREACH: 19, MISSION: 20, HEAL: 21, STEAL: 22,
  SCHOOL: 23, ATTACK: 24, FIELD: 25, WANDER: 26, RETURN_HOME: 27, MIGRATE: 28, FLEE: 29,
  RAIL: 30, BOARD: 31, TRADE_BUY: 32, GARRISON: 33,
};

export class People {
  constructor(cap = CFG.MAX_PEOPLE) {
    this.cap = cap;
    this.hwm = 0;          // high-water mark (iterate 0..hwm)
    this.count = 0;
    this.free = [];
    const F32 = () => new Float32Array(cap);
    const I32 = () => new Int32Array(cap);
    const U8 = () => new Uint8Array(cap);
    const I16 = () => new Int16Array(cap);
    this.x = F32(); this.y = F32();
    this.gx = F32(); this.gy = F32();         // final goal
    this.civ = new Int8Array(cap).fill(-1);
    this.town = I16();
    this.home = I32(); this.work = I32();
    this.prof = U8();
    this.state = U8(); this.act = U8();
    this.timer = F32();
    this.target = I32();                      // generic target (pixel / person / building / town)
    this.target2 = I32();
    this.age = F32();
    this.sex = U8();
    this.partner = I32();
    this.mother = I32();
    this.father = I32();
    this.preg = F32();
    this.health = F32();
    this.food = F32();
    this.happy = F32();
    this.lux = F32();
    this.faithSat = F32();
    this.edu = F32();
    this.skill = F32();
    this.loyalty = F32();
    this.carryRes = U8(); this.carryAmt = F32();
    this.sick = F32();                        // remaining infection time
    this.immune = F32();
    this.army = I16();
    this.cooldown = F32();
    this.stuck = F32();
    this.flags = U8();                        // bit0 criminal, bit1 wanted, bit2 foreignAgent, bit3 inside building, bit4 great person
    this.born = F32();
    this.name = I32();
    this.pathIdx = I16();
    this.path = new Array(cap).fill(null);
    this.beliefs = new Int8Array(cap * NB);
    this.color = new Uint32Array(cap);
    this.lastPx = I32();
  }

  alloc() {
    let i;
    if (this.free.length) i = this.free.pop();
    else if (this.hwm < this.cap) i = this.hwm++;
    else return -1;
    this.count++;
    this.home[i] = -1; this.work[i] = -1; this.partner[i] = -1; this.mother[i] = -1; this.father[i] = -1;
    this.target[i] = -1; this.target2[i] = -1; this.army[i] = -1;
    this.state[i] = S.IDLE; this.act[i] = A.NONE; this.timer[i] = 0;
    this.preg[i] = 0; this.health[i] = 100; this.food[i] = 80; this.happy[i] = 60; this.lux[i] = 0;
    this.faithSat[i] = 50; this.edu[i] = 0; this.skill[i] = 0; this.loyalty[i] = 70;
    this.carryRes[i] = 0; this.carryAmt[i] = 0; this.sick[i] = 0; this.immune[i] = 0;
    this.cooldown[i] = 0; this.stuck[i] = 0; this.flags[i] = 0; this.path[i] = null; this.pathIdx[i] = 0;
    this.lastPx[i] = -1;
    return i;
  }

  release(i) {
    this.civ[i] = -1;
    this.state[i] = S.DEAD;
    this.path[i] = null;
    this.free.push(i);
    this.count--;
  }

  alive(i) { return this.civ[i] >= 0; }
  b(i, scale) { return this.beliefs[i * NB + scale]; }
  setB(i, scale, v) { this.beliefs[i * NB + scale] = v > 100 ? 100 : v < -100 ? -100 : v; }
  pushB(i, scale, dv) {
    // stochastic rounding keeps small pushes unbiased on integer storage
    const k = i * NB + scale;
    const fl = Math.floor(dv);
    const v = this.beliefs[k] + fl + (rand() < dv - fl ? 1 : 0);
    this.beliefs[k] = v > 100 ? 100 : v < -100 ? -100 : v;
  }
  isAdult(i) { return this.age[i] >= CFG.ADULT_AGE; }
}

// Towns: stockpiles, housing, production statistics.
import { NRES, RESOURCES, R, FOOD_RES } from '../data/resources.js';

export class Town {
  constructor(id, civ, name, cx, cy) {
    this.id = id;
    this.civ = civ;
    this.name = name;
    this.cx = cx; this.cy = cy;
    this.center = -1;
    this.level = 0;
    this.buildings = [];
    this.construction = [];
    this.stock = new Float32Array(NRES);
    this.want = new Float32Array(NRES);
    this.prodDay = new Float32Array(NRES);   // produced today
    this.consDay = new Float32Array(NRES);   // consumed today
    this.prod = new Float32Array(NRES);      // EMA per day
    this.cons = new Float32Array(NRES);
    this.capacity = 300;
    this.pop = 0; this.adults = 0; this.children = 0;
    this.housingCap = 0;
    this.homeless = 0;
    this.employed = 0;
    this.founded = 0;
    this.happiness = 60;
    this.crime = 0;
    this.health = 100;
    this.sick = 0;
    this.powerSupply = 0; this.powerDemand = 0; this.powerRatio = 0; this.powerAcc = 0;
    this.recount = true;
    this.alive = true;
    this.lastPlan = -1e9;
    this.planDelay = 0;
    this.shipments = [];
    this.unrest = 0;
    this.foodDays = 10;
    this.isCapital = false;
    this.culture = 0;
    this.radius = 40;
    this.coastal = false;
    this.lastCaptured = -1e9;
    this.occupiedBy = -1;
    this.siege = 0;
    this.lastAttacked = -1e9;
    this.roadPlan = [];
    this.pollution = 0;
    this.history = [];
  }

  add(r, amt) {
    if (amt <= 0) return 0;
    this.stock[r] += amt;
    this.prodDay[r] += amt;
    return amt;
  }
  take(r, amt) {
    const a = Math.min(this.stock[r], amt);
    if (a <= 0) return 0;
    this.stock[r] -= a;
    this.consDay[r] += a;
    return a;
  }
  has(costs) {
    for (const k in costs) if (this.stock[R(k)] < costs[k]) return false;
    return true;
  }
  pay(costs) {
    for (const k in costs) this.take(R(k), costs[k]);
  }
  stockSum() {
    let s = 0;
    for (let r = 0; r < NRES; r++) if (r !== RES_COINS) s += this.stock[r];
    return s;
  }
  foodStock() {
    let f = 0;
    for (const r of FOOD_RES) f += this.stock[r] * RESOURCES[r].food;
    return f;
  }
}

export const RES_COINS = R('coins');

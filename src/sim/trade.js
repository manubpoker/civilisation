// Foreign trade: traders carry local surplus to a partner's market, sell at
// the partner's prices, buy what is scarce at home, and return. Both sides
// gain from the price difference; relations and cosmopolitanism grow.
import { RESOURCES, NRES, R } from '../data/resources.js';
import { B } from '../data/beliefs.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { rand, randInt, chance } from '../util/rng.js';

const RES_COINS = R('coins');
const TRADABLE = RESOURCES.filter((r) => r.id !== 'coins').map((r) => r.idx);

export class Trade {
  constructor(sim) {
    this.sim = sim;
    this.routes = new Map(); // "civA:civB" -> recent volume
  }

  partners(civId) {
    const sim = this.sim;
    return sim.civs.filter((o) => o.alive && o.id !== civId && sim.diplomacy.tradeAllowed(civId, o.id));
  }

  marketOf(town) {
    const sim = this.sim;
    let best = null;
    for (const id of town.buildings) {
      const b = sim.buildings[id];
      if (!b || !b.built) continue;
      if (b.def.id === 'trading_post' || b.def.id === 'marketplace') { best = b; if (b.def.id === 'trading_post') break; }
    }
    return best || sim.buildings[town.center];
  }

  traderThink(i, town, wb) {
    const sim = this.sim, P = sim.people;
    const civId = P.civ[i];
    const partners = this.partners(civId);
    if (!partners.length) {
      // domestic caravan between own towns instead
      if (!sim.logistics.takeShipment(i, town)) { goTo(sim, i, wb.cx, wb.cy, A.WORK); P.target[i] = wb.id; }
      return;
    }
    const other = partners[randInt(partners.length)];
    const dest = sim.nearestTownOfCiv(other.id, P.x[i], P.y[i]);
    if (!dest) { P.state[i] = S.IDLE; return; }
    // pick export: our surplus that they value more
    let best = -1, bs = 0;
    for (const r of TRADABLE) {
      const surplus = town.stock[r] - town.want[r] * 1.1;
      if (surplus < 3) continue;
      const ratio = sim.economy.price(other.id, r) / sim.economy.price(civId, r);
      const s = ratio * Math.min(surplus, 20) * RESOURCES[r].base;
      if (ratio > 1.05 && s > bs) { bs = s; best = r; }
    }
    if (best < 0) { goTo(sim, i, wb.cx, wb.cy, A.WORK); P.target[i] = wb.id; return; }
    const civ = sim.civs[civId];
    const cap = 12 * civ.mod.carry * (civ.flags.cart ? 2 : 1) * (civ.flags.horses ? 1.3 : 1);
    const amt = town.take(best, Math.min(cap, town.stock[best] - town.want[best] * 1.1));
    if (amt <= 0) { P.state[i] = S.IDLE; return; }
    P.carryRes[i] = best; P.carryAmt[i] = amt;
    const m = this.marketOf(dest);
    const [x, y] = m ? [m.cx, m.cy] : [dest.cx, dest.cy];
    goTo(sim, i, x + rand() * 4 - 2, y + rand() * 4 - 2, A.TRADE_SELL);
    P.target[i] = dest.id;
  }

  sell(i) {
    const sim = this.sim, P = sim.people;
    const dest = sim.towns[P.target[i]];
    const home = sim.towns[P.town[i]];
    const civId = P.civ[i];
    if (!dest || !dest.alive || !home || P.carryAmt[i] <= 0 || !sim.diplomacy.tradeAllowed(civId, dest.civ)) {
      if (home && P.carryAmt[i] > 0) home.add(P.carryRes[i], P.carryAmt[i]);
      P.carryAmt[i] = 0; P.state[i] = S.IDLE; return;
    }
    const other = sim.civs[dest.civ];
    const r = P.carryRes[i], amt = P.carryAmt[i];
    const value = amt * sim.economy.price(other.id, r);
    dest.add(r, amt);
    // buy what is most profitable to bring home
    let best = -1, bs = 0;
    for (const q of TRADABLE) {
      if (q === r) continue;
      const avail = dest.stock[q] - dest.want[q];
      if (avail < 2) continue;
      const ratio = sim.economy.price(civId, q) / sim.economy.price(other.id, q);
      if (ratio > bs) { bs = ratio; best = q; }
    }
    const civ = sim.civs[civId];
    const tradeMod = civ.mod.trade;
    let brought = 0;
    if (best >= 0 && bs > 1) {
      const units = Math.min(dest.stock[best] - dest.want[best], value * tradeMod / sim.economy.price(other.id, best));
      brought = dest.take(best, Math.max(0, units));
      P.carryRes[i] = best; P.carryAmt[i] = brought;
    } else {
      // paid in coin
      const coins = Math.min(dest.stock[RES_COINS], value * 0.8 * tradeMod);
      dest.take(RES_COINS, coins);
      P.carryRes[i] = RES_COINS; P.carryAmt[i] = coins;
    }
    // tariffs & goodwill
    dest.add(RES_COINS, value * 0.03 * other.mod.trade);
    const p = sim.diplomacy.pair(civId, other.id);
    p.tradeToday += value;
    civ.stats.tradeVolume += value; other.stats.tradeVolume += value;
    sim.diplomacy.addRel(civId, other.id, 0.25 * Math.min(4, value / 30));
    P.pushB(i, B.XENOPHILIA, 1.5);
    P.pushB(i, B.COMMERCE, 1);
    // cultural exchange: the trader absorbs a little of the host culture
    { const s = randInt(50); P.pushB(i, s, (other.beliefAvg[s] - P.b(i, s)) * 0.03); }
    if (!this.routes.has(p.a + ':' + p.b) && sim.tick > 1000) {
      this.routes.set(p.a + ':' + p.b, 1);
      sim.chronicle(`A trade route opens between ${home.name} (${civ.name}) and ${dest.name} (${other.name}).`, civId, 'trade');
    }
    P.skill[i] = Math.min(100, P.skill[i] + 1);
    const m = this.marketOf(home);
    const [x, y] = m ? [m.cx, m.cy] : [home.cx, home.cy];
    goTo(sim, i, x, y, A.TRADE_HOME);
    P.target[i] = home.id;
  }

  home(i) {
    const sim = this.sim, P = sim.people;
    const home = sim.towns[P.town[i]];
    if (home && P.carryAmt[i] > 0) home.add(P.carryRes[i], P.carryAmt[i]);
    P.carryAmt[i] = 0;
    P.state[i] = S.IDLE;
  }
}

export { NRES, chance };

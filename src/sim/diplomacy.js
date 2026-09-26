// Diplomacy: contact, relations, treaties (trade, open borders, alliance,
// non-aggression), war & peace, diplomats, spies and missionaries.
import { CFG } from '../config.js';
import { SCALES, NB, B } from '../data/beliefs.js';
import { TECHS } from '../data/technologies.js';
import { S, A } from './people.js';
import { goTo } from './movement.js';
import { rand, randInt, chance } from '../util/rng.js';

const KEY_SCALES = ['empathy', 'aggression', 'piety', 'tradition', 'collectivism', 'hierarchy', 'nature', 'reason', 'law', 'authority', 'commerce', 'theism', 'zeal', 'honor'].map((k) => B[k.toUpperCase()]);

export class Diplomacy {
  constructor(sim) {
    this.sim = sim;
    this.pairs = new Map(); // "a:b" (a<b) -> treaty state
    this.log = [];
  }

  key(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
  pair(a, b) {
    const k = this.key(a, b);
    let p = this.pairs.get(k);
    if (!p) {
      p = { a: Math.min(a, b), b: Math.max(a, b), trade: false, openBorders: false, alliance: false, nonAggression: false,
        war: false, warStart: 0, truceUntil: 0, grudge: 0, tradeVolume: 0, tradeToday: 0, casualties: [0, 0], lastTreaty: -1e9,
        incidents: 0, history: [] };
      this.pairs.set(k, p);
    }
    return p;
  }
  rel(a, b) { return this.sim.civs[a].relations[b]; }
  addRel(a, b, v) {
    const ca = this.sim.civs[a], cb = this.sim.civs[b];
    ca.relations[b] = Math.max(-100, Math.min(100, ca.relations[b] + v));
    cb.relations[a] = Math.max(-100, Math.min(100, cb.relations[a] + v));
  }
  anyContact(c) { const civ = this.sim.civs[c]; for (const o of this.sim.civs) if (o.alive && o.id !== c && civ.contact[o.id]) return true; return false; }
  anyTradePartner(c) { for (const o of this.sim.civs) if (o.alive && o.id !== c && this.tradeAllowed(c, o.id)) return true; return false; }
  tradeAllowed(a, b) {
    if (a === b) return true;
    const ca = this.sim.civs[a];
    if (!ca.contact[b]) return false;
    const p = this.pair(a, b);
    if (p.war) return false;
    return p.trade || (this.rel(a, b) > -10 && !ca.isBanned('trading_post') && !this.sim.civs[b].isBanned('trading_post'));
  }
  openBorders(a, b) { return a === b || this.pair(a, b).openBorders || this.pair(a, b).alliance; }

  makeContact(a, b) {
    const sim = this.sim;
    const ca = sim.civs[a], cb = sim.civs[b];
    if (ca.contact[b] || !ca.alive || !cb.alive) return;
    ca.contact[b] = 1; cb.contact[a] = 1;
    const sim0 = this.similarity(ca, cb);
    ca.relations[b] = cb.relations[a] = sim0 * 20;
    sim.chronicle(`First contact: ${ca.name} meets ${cb.name}.`, a, 'diplomacy');
  }

  similarity(ca, cb) {
    let d = 0;
    for (const s of KEY_SCALES) d += Math.abs(ca.beliefAvg[s] - cb.beliefAvg[s]);
    return 1 - d / (KEY_SCALES.length * 60);
  }

  incident(victim, culprit, severity, text) {
    if (victim === culprit || victim < 0 || culprit < 0) return;
    const p = this.pair(victim, culprit);
    p.incidents += severity;
    const civ = this.sim.civs[victim];
    const grudgeMul = civ.mod.grudge;
    this.sim.civs[victim].relations[culprit] = Math.max(-100, civ.relations[culprit] - severity * grudgeMul);
    this.sim.civs[culprit].relations[victim] = Math.max(-100, this.sim.civs[culprit].relations[victim] - severity * 0.3);
    p.grudge += severity * 0.5 * grudgeMul;
    if (text) {
      // repeated incidents of one kind are summarised rather than listed
      const key = victim + ':' + culprit + ':' + text.slice(0, 14);
      this.lastIncident = this.lastIncident || new Map();
      const last = this.lastIncident.get(key);
      const now = this.sim.tick;
      if (last && now - last.tick < CFG.TICKS_PER_DAY * 9) { last.n++; return; }
      const extra = last && last.n ? ` (${last.n + 1} such incidents lately)` : '';
      this.lastIncident.set(key, { tick: now, n: 0 });
      this.sim.chronicle(text + extra, victim, 'incident');
    }
  }

  goodwill(c, amt) {
    for (const o of this.sim.civs) if (o.alive && o.id !== c && this.sim.civs[c].contact[o.id]) this.addRel(c, o.id, amt);
  }

  // ------------------------------------------------------------ daily AI
  daily() {
    const sim = this.sim;
    const civs = sim.civs.filter((c) => c.alive);
    for (let x = 0; x < civs.length; x++) for (let y = x + 1; y < civs.length; y++) {
      const a = civs[x], b = civs[y];
      if (!a.contact[b.id]) { this.checkTerritoryContact(a, b); continue; }
      const p = this.pair(a.id, b.id);
      // relation drift toward a target
      const simil = this.similarity(a, b);
      const religion = Math.abs(a.beliefAvg[B.THEISM] - b.beliefAvg[B.THEISM]) / 100 * (1 + Math.max(0, a.beliefAvg[B.ZEAL] + b.beliefAvg[B.ZEAL]) / 100);
      const border = sim.borderTension(a.id, b.id);
      const aggr = (a.beliefAvg[B.AGGRESSION] + b.beliefAvg[B.AGGRESSION]) / 200;
      const xeno = (a.beliefAvg[B.XENOPHILIA] + b.beliefAvg[B.XENOPHILIA]) / 200;
      let target = simil * 35 - religion * 15 - border * (0.6 + aggr) * 25 + xeno * 25 + Math.min(20, p.tradeVolume * 0.01) - p.grudge;
      target += (p.trade ? 6 : 0) + (p.alliance ? 12 : 0) + (p.openBorders ? 4 : 0);
      target += (a.mod.diplomacy + b.mod.diplomacy - 2) * 12;
      if (p.war) target -= 30;
      // what drives the relationship, for the spectator
      p.why = { beliefs: simil * 35, religion: -religion * 15, borders: -border * (0.6 + aggr) * 25, openness: xeno * 25,
        commerce: Math.min(20, p.tradeVolume * 0.01) + (p.trade ? 6 : 0), grudge: -p.grudge, pacts: (p.alliance ? 12 : 0) + (p.openBorders ? 4 : 0),
        statecraft: (a.mod.diplomacy + b.mod.diplomacy - 2) * 12, war: p.war ? -30 : 0, target };
      for (const [c, o] of [[a, b], [b, a]]) {
        c.relations[o.id] += (target - c.relations[o.id]) * 0.03;
        c.relations[o.id] = Math.max(-100, Math.min(100, c.relations[o.id]));
      }
      p.grudge *= 1 - 0.01 * (2 - Math.min(1.9, (a.mod.grudge + b.mod.grudge) / 2));
      p.tradeVolume *= 0.97;
      p.tradeVolume += p.tradeToday; p.tradeToday = 0;
      this.decide(a, b, p);
      this.decide(b, a, p);
    }
  }

  checkTerritoryContact(a, b) {
    // contact if territories touch or explored areas overlap substantially
    if (this.sim.borderTension(a.id, b.id) > 0) this.makeContact(a.id, b.id);
  }

  decide(me, them, p) {
    const sim = this.sim;
    const r = me.relations[them.id];
    const aggr = me.beliefAvg[B.AGGRESSION];
    const honest = me.beliefAvg[B.HONESTY];
    const now = sim.tick;
    const myStr = sim.military.strength(me.id), theirStr = sim.military.strength(them.id);
    const ratio = (myStr + 5) / (theirStr + 5);
    if (!p.war) {
      // --- war declaration
      const expans = me.beliefAvg[B.EXPANSION];
      const truce = now < p.truceUntil;
      const bannedWar = me.bans.has('weapon_forge') && aggr < -40;
      let warDrive = -r * 0.8 + aggr * 0.6 + expans * 0.3 + p.grudge * 0.8 - me.beliefAvg[B.EMPATHY] * 0.1 + (ratio - 1) * 30;
      if (p.nonAggression) warDrive -= 25 + Math.max(0, honest) * 0.3;
      if (p.alliance) warDrive -= 60;
      if (me.warWeariness > 20) warDrive -= me.warWeariness;
      if (!truce && !bannedWar && warDrive > 65 && r < -35 && ratio > 1.1 && me.soldiers > 8 && chance(0.25)) {
        this.declareWar(me, them, p);
        return;
      }
      // --- treaties (I propose, they accept if their relation is good enough)
      if (now - p.lastTreaty < CFG.TICKS_PER_DAY * 4) return;
      const accept = (thr) => them.relations[me.id] > thr;
      if (!p.trade && r > 5 && me.beliefAvg[B.COMMERCE] > -25 && !me.isBanned('trading_post') && accept(0)) {
        p.trade = true; p.lastTreaty = now;
        sim.chronicle(`${me.name} and ${them.name} sign a trade agreement.`, me.id, 'treaty');
      } else if (!p.nonAggression && r > 15 && aggr < 20 && accept(10)) {
        p.nonAggression = true; p.lastTreaty = now;
        sim.chronicle(`${me.name} and ${them.name} sign a non-aggression pact.`, me.id, 'treaty');
      } else if (!p.openBorders && r > 30 && me.beliefAvg[B.HOSPITALITY] > -10 && me.beliefAvg[B.XENOPHILIA] > -10 && accept(25)) {
        p.openBorders = true; p.lastTreaty = now;
        sim.chronicle(`${me.name} and ${them.name} open their borders to each other.`, me.id, 'treaty');
      } else if (!p.alliance && r > 60 && accept(55)) {
        p.alliance = true; p.lastTreaty = now;
        sim.chronicle(`${me.name} and ${them.name} forge an alliance!`, me.id, 'treaty');
      }
      // --- breaking treaties (the deceitful break them when relations sour)
      if ((p.trade || p.openBorders) && r < -30 && chance(0.1)) {
        if (p.openBorders) { p.openBorders = false; sim.chronicle(`${me.name} closes its borders to ${them.name}.`, me.id, 'treaty'); }
        else if (p.trade && r < -45) { p.trade = false; sim.chronicle(`${me.name} imposes a trade embargo on ${them.name}.`, me.id, 'treaty'); }
        if (honest < -20) this.addRel(me.id, them.id, -5);
      }
      if (p.alliance && r < 20) { p.alliance = false; sim.chronicle(`The alliance between ${me.name} and ${them.name} collapses.`, me.id, 'treaty'); }
    } else {
      // --- at war: seek peace when weary, losing, or forgiving
      const dur = (now - p.warStart) / CFG.TICKS_PER_YEAR;
      const forgive = me.beliefAvg[B.FORGIVENESS];
      const pacifism = -aggr;
      const caps = p.captures || {};
      // conquerors are sated by the towns they took; losers want the bleeding to stop
      const peaceDrive = me.warWeariness * 1.2 + pacifism * 0.4 + forgive * 0.3 + dur * 6 + (1 - ratio) * 40 - p.grudge * 0.5 - me.beliefAvg[B.PRIDE] * 0.2
        + (caps[me.id] || 0) * 28 + (caps[them.id] || 0) * 18;
      if (peaceDrive > 55 && chance(0.2)) {
        // the other side accepts if also weary or if the offer comes from the stronger side
        const theirDrive = them.warWeariness * 1.2 - them.beliefAvg[B.AGGRESSION] * 0.3 + (ratio - 1) * 40 + dur * 5 + (caps[them.id] || 0) * 30;
        if (theirDrive > 25 || dur > 12) this.makePeace(me, them, p, ratio);
      }
    }
  }

  declareWar(me, them, p) {
    const sim = this.sim;
    p.war = true; p.trade = false; p.openBorders = false; p.alliance = false; p.nonAggression = false;
    p.warStart = sim.tick; p.casualties = [0, 0]; p.captures = {};
    me.lastWarTick = sim.tick; them.lastWarTick = sim.tick;
    me.warWeariness = 0; them.warWeariness = Math.max(0, them.warWeariness);
    this.addRel(me.id, them.id, -30);
    sim.chronicle(`⚔ ${me.name} declares war on ${them.name}!`, me.id, 'war');
    sim.beliefs.shock(them.id, B.AGGRESSION, 3, 0.3);
    sim.beliefs.shock(them.id, B.PATRIOTISM, 3, 0.3);
    sim.beliefs.shock(me.id, B.PATRIOTISM, 2, 0.2);
    // allies join
    for (const o of sim.civs) {
      if (!o.alive || o === me || o === them) continue;
      if (this.pair(o.id, them.id).alliance && !this.pair(o.id, me.id).war) this.declareWar(o, me, this.pair(o.id, me.id));
    }
  }

  makePeace(me, them, p, ratio) {
    const sim = this.sim;
    p.war = false;
    p.truceUntil = sim.tick + CFG.TICKS_PER_YEAR * 3;
    me.warWeariness *= 0.3; them.warWeariness *= 0.3;
    sim.military.disband(me.id, them.id);
    // tribute from the weaker side
    let terms = 'white peace';
    const loser = ratio < 0.8 ? me : ratio > 1.25 ? them : null;
    const winner = loser === me ? them : loser === them ? me : null;
    if (loser && winner) {
      const cap = sim.towns[loser.capital];
      const wcap = sim.towns[winner.capital];
      if (cap && wcap) {
        const coins = cap.stock[sim.RES_COINS] * (winner.beliefAvg[B.MERCY] > 20 ? 0.1 : 0.3);
        cap.take(sim.RES_COINS, coins); wcap.add(sim.RES_COINS, coins);
        terms = `${loser.name} pays ${Math.round(coins)} coins of tribute`;
      }
    }
    this.addRel(me.id, them.id, 15);
    sim.chronicle(`☮ Peace between ${me.name} and ${them.name} (${terms}).`, me.id, 'peace');
    sim.beliefs.shock(me.id, B.AGGRESSION, -2, 0.25);
    sim.beliefs.shock(them.id, B.AGGRESSION, -2, 0.25);
  }

  // ------------------------------------------------------------ agents
  foreignTarget(i, pickTown) {
    const sim = this.sim, P = sim.people;
    const civ = sim.civs[P.civ[i]];
    const others = sim.civs.filter((o) => o.alive && o.id !== civ.id && civ.contact[o.id]);
    if (!others.length) return null;
    const o = others[randInt(others.length)];
    const t = pickTown === 'capital' ? sim.towns[o.capital] : sim.nearestTownOfCiv(o.id, P.x[i], P.y[i]);
    if (!t || !t.alive) return null;
    return { civ: o, town: t };
  }

  diplomatThink(i, town, wb) {
    const sim = this.sim, P = sim.people;
    const tgt = this.foreignTarget(i, 'capital');
    if (!tgt || chance(0.4)) { const [x, y] = [wb.cx, wb.cy]; goTo(sim, i, x, y, A.WORK); P.target[i] = wb.id; return; }
    const c = sim.buildings[tgt.town.center];
    const [x, y] = c ? [c.cx, c.cy] : [tgt.town.cx, tgt.town.cy];
    goTo(sim, i, x + rand() * 6 - 3, y + rand() * 6 - 3, A.DIPLO);
    P.target[i] = tgt.civ.id;
  }

  arriveDiplomat(i) {
    const sim = this.sim, P = sim.people;
    const me = sim.civs[P.civ[i]], them = sim.civs[P.target[i]];
    if (them && them.alive) {
      const skill = 0.5 + P.skill[i] / 100 + P.edu[i] / 200;
      const honest = P.b(i, B.HONESTY) / 100;
      const p = this.pair(me.id, them.id);
      let gain = (2 + skill * 3) * (1 + honest * 0.5) * me.mod.diplomacy;
      if (p.war) {
        // envoys seek peace
        gain *= 0.5;
        me.warWeariness += 1;
      }
      this.addRel(me.id, them.id, gain);
      P.skill[i] = Math.min(100, P.skill[i] + 2);
      P.pushB(i, B.XENOPHILIA, 2);
      if (chance(0.15)) sim.chronicle(`Envoy ${sim.personName(i)} of ${me.name} is received at the court of ${them.name}.`, me.id, 'diplomacy', i);
    }
    // return home
    const home = sim.towns[P.town[i]];
    if (home) { const c = sim.buildings[home.center]; goTo(sim, i, c ? c.cx : home.cx, c ? c.cy : home.cy, A.WANDER); }
    else P.state[i] = S.IDLE;
  }

  spyThink(i, town, wb) {
    const sim = this.sim, P = sim.people;
    const tgt = this.foreignTarget(i, 'nearest');
    if (!tgt || chance(0.35)) { goTo(sim, i, wb.cx, wb.cy, A.WORK); P.target[i] = wb.id; return; }
    const bs = tgt.town.buildings;
    const b = sim.buildings[bs[randInt(bs.length)]];
    if (!b) { P.state[i] = S.IDLE; return; }
    goTo(sim, i, b.cx, b.cy, A.SPY);
    P.target[i] = b.id;
    P.flags[i] |= 4;
  }

  arriveSpy(i) {
    const sim = this.sim, P = sim.people;
    const me = sim.civs[P.civ[i]];
    const b = sim.buildings[P.target[i]];
    P.flags[i] &= ~4;
    if (!b) { P.state[i] = S.IDLE; return; }
    const them = sim.civs[b.civ];
    const skill = P.skill[i] / 100;
    // detection by guards, watchmen and suspicious populace
    let guards = 0;
    sim.spatial.query(P.x[i], P.y[i], 30, (j) => { const k = sim.professions[P.prof[j]].kind; if (P.civ[j] === them.id && (k === 'guard' || k === 'watchman' || k === 'military')) guards++; return false; });
    const detect = 0.12 + guards * 0.05 + Math.max(0, them.beliefAvg[B.SUSPICION]) / 200 + (them.mod.counterspy - 1) * 0.2 - skill * 0.1;
    if (chance(detect)) {
      this.incident(them.id, me.id, 12, `A spy from ${me.name} is caught in ${sim.towns[b.town] ? sim.towns[b.town].name : 'the realm'} of ${them.name}!`);
      sim.kill(i, 'executed as a spy');
      return;
    }
    const roll = rand();
    if (roll < 0.55) {
      // steal technology
      const cands = [];
      for (let t = 0; t < TECHS.length; t++) if (them.techs[t] && !me.techs[t] && TECHS[t].req.every((r) => me.has(r))) cands.push(t);
      if (cands.length) {
        const t = cands[randInt(cands.length)];
        if (chance(0.35 * me.mod.espionage)) {
          sim.research.learn(me, t, 'espionage');
          sim.chronicle(`Spies of ${me.name} steal the secret of ${TECHS[t].name} from ${them.name}.`, me.id, 'espionage', i);
        } else {
          me.researchPts += TECHS[t].cost * 0.2;
        }
      }
    } else if (roll < 0.75 && (sim.military.atWarBetween(me.id, them.id) || me.relations[them.id] < -40)) {
      // sabotage: arson
      sim.events.ignite(b, `saboteurs from ${me.name}`);
    } else {
      // intelligence: reveal their lands
      const t = sim.towns[b.town];
      if (t) for (let k = 0; k < 30; k++) {
        const c = sim.nav.cellOf(t.cx + (rand() - 0.5) * 120, t.cy + (rand() - 0.5) * 120);
        if (!me.explored[c]) { me.explored[c] = 1; me.exploredCount++; }
      }
    }
    P.skill[i] = Math.min(100, P.skill[i] + 3);
    const home = sim.towns[P.town[i]];
    if (home) goTo(sim, i, home.cx, home.cy, A.WANDER); else P.state[i] = S.IDLE;
  }

  missionaryThink(i, town, wb) {
    const sim = this.sim, P = sim.people;
    const tgt = this.foreignTarget(i, 'nearest');
    if (!tgt || chance(0.3) || this.pair(P.civ[i], tgt.civ.id).war) {
      // preach at home instead
      const a = rand() * 6.283, d = rand() * town.radius;
      goTo(sim, i, town.cx + Math.cos(a) * d, town.cy + Math.sin(a) * d, A.PREACH);
      P.target[i] = wb.id;
      return;
    }
    const c = sim.buildings[tgt.town.center];
    const [x, y] = c ? [c.cx, c.cy] : [tgt.town.cx, tgt.town.cy];
    goTo(sim, i, x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, A.MISSION);
    P.target[i] = tgt.civ.id;
  }

  arriveMissionary(i) {
    const sim = this.sim, P = sim.people;
    const me = sim.civs[P.civ[i]];
    const faithScales = [B.PIETY, B.THEISM, B.ZEAL, B.SPIRITUALITY, B.ANCESTRY, B.MORTALITY];
    let conv = 0;
    sim.spatial.query(P.x[i], P.y[i], 16, (j) => {
      if (P.civ[j] === me.id || P.civ[j] < 0) return false;
      const resist = Math.max(0, P.b(j, B.ZEAL)) / 100;
      for (const s of faithScales) P.pushB(j, s, (me.beliefAvg[s] - P.b(j, s)) * 0.15 * (1 - resist));
      conv++;
      return conv > 15;
    });
    me.stats.converted += conv;
    const civ2 = sim.civs[P.target[i]];
    if (civ2 && civ2.beliefAvg[B.ZEAL] > 30 && chance(0.15)) {
      this.incident(civ2.id, me.id, 2, `Zealots of ${civ2.name} expel a missionary of ${me.name}.`);
      me.martyrs = (me.martyrs || 0) + 1;
      sim.kill(i, 'martyred abroad');
      return;
    }
    const home = sim.towns[P.town[i]];
    if (home) goTo(sim, i, home.cx, home.cy, A.WANDER); else P.state[i] = S.IDLE;
  }
}

export { SCALES, NB };

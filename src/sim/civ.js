// Civilisation state: technologies, modifiers, beliefs, laws and relations.
import { CFG } from '../config.js';
import { TECHS, TECH_INDEX } from '../data/technologies.js';
import { SCALES, NB, ADOPT_THRESHOLD, DROP_THRESHOLD, BAN_THRESHOLD } from '../data/beliefs.js';
import { PROFESSIONS, PROF_INDEX } from '../data/professions.js';
import { STRUCTURES, STRUCT_INDEX } from '../data/structures.js';
import { DEPOSITS, D } from '../world/terrain.js';
import { NRES } from '../data/resources.js';

export const BASE_MOD = {
  gather: 1, farm: 1, fish: 1, hunt: 1, wood: 1, mine: 1, craft: 1, build: 1, research: 1, culture: 1,
  faith: 1, health: 1, disease: 1, lifespan: 0, birth: 1, move: 1, carry: 1, attack: 1, defense: 1,
  happy: 0, trade: 1, storage: 1, housing: 1, crime: 1, spoil: 1, edu: 1, diplomacy: 1, pollution: 1,
  consume: 1, espionage: 1, vision: 1, coins: 1, settle: 1, unrest: 1, morale: 1, grudge: 1,
  immigration: 1, naval: 1, loyalty: 1, order: 1, industry: 1, counterspy: 1,
};

const MINE_TECH = {
  [D.TREE]: 'stone_tools', [D.BERRY]: 'foraging', [D.STONE]: 'masonry', [D.COPPER]: 'mining', [D.TIN]: 'mining',
  [D.IRON]: 'iron_working', [D.COAL]: 'mining', [D.GOLD]: 'currency', [D.SILVER]: 'currency', [D.GEMS]: 'currency',
  [D.SALT]: 'mining', [D.MARBLE]: 'construction', [D.SULFUR]: 'gunpowder', [D.CLAY]: 'pottery', [D.OIL]: 'combustion',
  [D.URANIUM]: 'nuclear_fission', [D.FISH]: 'fishing', [D.SPICE]: 'foraging', [D.HERBS]: 'foraging', [D.COTTON]: 'foraging',
};

const SYL = [
  ['ka', 'ra', 'dun', 'mor', 'gar', 'thal', 'vek', 'ur', 'bran', 'dor', 'kesh', 'ath', 'rum', 'tor', 'zan', 'hel', 'gro', 'mak'],
  ['li', 'sa', 'ven', 'el', 'mira', 'or', 'ae', 'lune', 'sil', 'tha', 'ri', 'no', 'va', 'cel', 'ena', 'lis', 'fa', 'quin'],
  ['bo', 'wen', 'tal', 'fen', 'rik', 'os', 'dal', 'mer', 'hul', 'gan', 'ett', 'sig', 'ald', 'ber', 'nor', 'wy', 'ta', 'lo'],
  ['xa', 'zu', 'qo', 'ix', 'ul', 'yr', 'te', 'ko', 'pa', 'mi', 'az', 'ot', 'cu', 'hi', 'na', 'lu', 'ek', 'sa'],
];
export function makeName(rng, set, parts = 2) {
  const S = SYL[set % SYL.length];
  let n = '';
  for (let k = 0; k < parts; k++) n += S[(rng() * S.length) | 0];
  return n[0].toUpperCase() + n.slice(1);
}

const GOVERNMENTS = [
  { name: 'Tribal Council', test: (a) => true },
];

export class Civ {
  constructor(id, name, color, homeX) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.css = `rgb(${color[0]},${color[1]},${color[2]})`;
    this.homeX = homeX;
    this.alive = true;
    this.towns = [];
    this.capital = -1;
    this.techs = new Uint8Array(TECHS.length);
    this.techCount = 0;
    this.techYear = new Float32Array(TECHS.length);
    this.researching = -1;
    this.researchPts = 0;
    this.researchRate = 0;
    this.researchToday = 0;
    this.mod = { ...BASE_MOD };
    this.flags = { roadLevel: 1, bridge: 0, rail: 0, ships: 0, flight: 0, cart: 0, horses: 0, power: 0, trucks: 0, honey: 0 };
    this.beliefAvg = new Float32Array(NB);
    this.adopted = new Int8Array(NB);
    this.bans = new Set();
    this.banReasons = {};
    this.culture = 0; this.cultureRate = 0; this.cultureToday = 0;
    this.faith = 0; this.faithRate = 0; this.faithToday = 0;
    this.space = 0;
    this.relations = new Float32Array(CFG.CIV_COLORS.length);
    this.contact = new Uint8Array(CFG.CIV_COLORS.length);
    this.uniques = {};
    this.explored = new Uint8Array(CFG.NW * CFG.NH);
    this.exploredCount = 0;
    this.pop = 0; this.adults = 0; this.children = 0; this.soldiers = 0;
    this.history = [];
    this.government = 'Tribal Council';
    this.era = 0;
    this.warWeariness = 0;
    this.armies = [];
    this.nameSet = id;
    this.stats = { born: 0, died: 0, starved: 0, killed: 0, built: 0, techs: 0, tradeVolume: 0, stolen: 0, converted: 0, emigrated: 0, immigrated: 0 };
    this.profCount = new Int32Array(PROFESSIONS.length);
    this.structCount = new Int32Array(STRUCTURES.length);
    this.stockTotal = new Float32Array(NRES);
    this.happiness = 60;
    this.health = 100;
    this.founded = 0;
    this.parent = -1;
    this.unitCache = {};
    this.goldenAge = 0;
    this.lastWarTick = -1e9;
  }

  has(techId) { const i = TECH_INDEX[techId]; return i !== undefined && this.techs[i] === 1; }
  hasIdx(i) { return this.techs[i] === 1; }
  isBanned(id) { return this.bans.has(id); }

  canSeeDeposit(d) { const t = DEPOSITS[d].revealTech; return !t || this.has(t); }
  canMineDeposit(d) { const t = MINE_TECH[d]; return !t || this.has(t); }

  // Best available profession in a military branch.
  bestUnit(branch) {
    if (this.unitCache[branch] !== undefined) return this.unitCache[branch];
    let best = -1, tier = -1;
    for (const p of PROFESSIONS) {
      if (p.branch !== branch) continue;
      if (p.tech && !this.has(p.tech)) continue;
      if (this.bans.has(p.id)) continue;
      if ((p.tier || 0) > tier) { tier = p.tier || 0; best = p.idx; }
    }
    this.unitCache[branch] = best;
    return best;
  }

  structureAvailable(def) {
    if (def.tech && !this.has(def.tech)) return false;
    if (this.bans.has(def.id)) return false;
    return true;
  }

  techAvailable(t, accessFn) {
    if (this.techs[t.idx]) return false;
    for (const r of t.req) if (!this.has(r)) return false;
    if (this.bans.has('tech:' + t.id)) return false;
    if (accessFn) for (const n of t.needs) if (!accessFn(n)) return false;
    return true;
  }

  learn(techIdx, year) {
    if (this.techs[techIdx]) return false;
    this.techs[techIdx] = 1;
    this.techCount++;
    this.techYear[techIdx] = year;
    const t = TECHS[techIdx];
    for (const [k, v] of Object.entries(t.flags)) this.flags[k] = Math.max(this.flags[k] || 0, v);
    this.era = Math.max(this.era, t.era);
    this.unitCache = {};
    this.recomputeMods();
    return true;
  }

  recomputeMods() {
    const m = { ...BASE_MOD };
    for (let i = 0; i < TECHS.length; i++) {
      if (!this.techs[i]) continue;
      for (const [k, v] of Object.entries(TECHS[i].fx)) m[k] = (m[k] || 0) + v;
    }
    for (let s = 0; s < NB; s++) {
      const a = this.adopted[s];
      if (!a) continue;
      const pole = a > 0 ? SCALES[s].pos : SCALES[s].neg;
      const strength = Math.min(1.5, 0.5 + (Math.abs(this.beliefAvg[s]) - ADOPT_THRESHOLD) / 40);
      for (const [k, v] of Object.entries(pole.mods || {})) m[k] = (m[k] || 0) + v * strength;
    }
    if (this.goldenAge > 0) { m.happy += 5; m.culture += 0.3; m.research += 0.15; }
    for (const k of Object.keys(m)) if (k !== 'happy' && k !== 'lifespan' && m[k] < 0.05) m[k] = 0.05;
    this.mod = m;
  }

  // Update adopted poles from averages; returns list of changes.
  updateAdoption() {
    const changes = [];
    for (let s = 0; s < NB; s++) {
      const avg = this.beliefAvg[s];
      const cur = this.adopted[s];
      let next = cur;
      if (cur === 0) {
        if (avg > ADOPT_THRESHOLD) next = 1;
        else if (avg < -ADOPT_THRESHOLD) next = -1;
      } else if (cur === 1 && avg < DROP_THRESHOLD) next = avg < -ADOPT_THRESHOLD ? -1 : 0;
      else if (cur === -1 && avg > -DROP_THRESHOLD) next = avg > ADOPT_THRESHOLD ? 1 : 0;
      if (next !== cur) {
        this.adopted[s] = next;
        changes.push({ scale: s, from: cur, to: next });
      }
    }
    if (changes.length) this.recomputeMods();
    return changes;
  }

  // Recompute bans from strongly held beliefs. Returns {added, removed}.
  updateBans() {
    const want = new Map();
    for (let s = 0; s < NB; s++) {
      const avg = this.beliefAvg[s];
      const pole = avg > 0 ? SCALES[s].pos : SCALES[s].neg;
      const strong = Math.abs(avg) > BAN_THRESHOLD;
      const keep = Math.abs(avg) > BAN_THRESHOLD - 8;
      for (const b of pole.bans || []) {
        if (strong || (keep && this.bans.has(b))) want.set(b, pole.name);
      }
    }
    // Authoritarian governments also ban dissenting professions.
    const added = [], removed = [];
    for (const [b, why] of want) if (!this.bans.has(b)) { this.bans.add(b); this.banReasons[b] = why; added.push(b); }
    for (const b of [...this.bans]) if (!want.has(b)) { this.bans.delete(b); delete this.banReasons[b]; removed.push(b); }
    if (added.length || removed.length) this.unitCache = {};
    return { added, removed };
  }

  adoptedList() {
    const out = [];
    for (let s = 0; s < NB; s++) if (this.adopted[s]) out.push((this.adopted[s] > 0 ? SCALES[s].pos : SCALES[s].neg).name);
    return out;
  }

  computeGovernment() {
    const a = this.beliefAvg;
    const g = (k) => a[SCALES.findIndex((s) => s.key === k)];
    const hierarchy = g('hierarchy'), authority = g('authority'), piety = g('piety'), law = g('law');
    const collect = g('collectivism'), commerce = g('commerce'), reason = g('reason');
    let gov;
    if (law < -35) gov = 'Anarchist Commune';
    else if (this.era < 2) gov = hierarchy > 15 ? 'Chiefdom' : 'Tribal Council';
    else if (piety > 40 && authority > 10) gov = 'Theocracy';
    else if (this.has('democracy') && authority < 5) gov = collect > 25 ? 'Social Democracy' : (commerce > 20 ? 'Liberal Republic' : 'Democracy');
    else if (authority > 35 && collect > 25) gov = 'Collectivist State';
    else if (authority > 35) gov = hierarchy > 10 ? 'Absolute Monarchy' : 'Dictatorship';
    else if (commerce > 30 && hierarchy > 0) gov = 'Merchant Oligarchy';
    else if (reason > 40 && this.era >= 7) gov = 'Technocracy';
    else if (this.has('feudalism') && hierarchy > 10) gov = 'Feudal Kingdom';
    else if (this.has('monarchy')) gov = 'Monarchy';
    else if (collect > 20) gov = 'Commune';
    else gov = 'Council Republic';
    const changed = gov !== this.government;
    this.government = gov;
    return changed;
  }
}

export { GOVERNMENTS, PROF_INDEX, STRUCT_INDEX };

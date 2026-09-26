// Headless simulation run: advances the world and prints civilisation stats.
import { Sim } from '../src/sim/sim.js';
import { CFG } from '../src/config.js';
import { TECHS } from '../src/data/technologies.js';
import { STRUCTURES } from '../src/data/structures.js';
import { PROFESSIONS } from '../src/data/professions.js';
import { RES_INDEX as RES } from '../src/data/resources.js';

const years = +(process.argv[2] || 10);
const seed = +(process.argv[3] || 7);
const dt = +(process.argv[4] || 4);
const t0 = Date.now();
const sim = new Sim(seed);
console.log(`setup ${Date.now() - t0}ms; people=${sim.people.count}`);
let lastLog = 0;
const kinds = {};
sim.onChronicle = (e) => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; if (process.env.QUIET) return; console.log(`  [Y${e.year}] ${e.text}`); };
const endTick = years * CFG.TICKS_PER_YEAR;
let steps = 0;
const t1 = Date.now();
while (sim.tick < endTick) {
  sim.step(dt);
  steps++;
  if (sim.year !== lastLog && sim.day % CFG.DAYS_PER_YEAR === 0) {
    lastLog = sim.year;
    const parts = sim.civs.map((c) => `${c.name.split(' ')[0]}: pop ${c.pop} towns ${c.towns.length} techs ${c.techCount} bld ${c.structCount.reduce((a, b) => a + b, 0)} sold ${c.soldiers} happy ${c.happiness.toFixed(0)} food ${sim.civFoodDays(c).toFixed(0)}d res ${c.researchRate.toFixed(1)}/d`);
    console.log(`Y${sim.year} | ${parts.join(' | ')} | ${((Date.now() - t1) / steps).toFixed(2)}ms/step`);
    if (sim.year % 10 === 0 && sim.civs.length > 1) {
      const [a, b] = sim.civs;
      const p = sim.diplomacy.pair(a.id, b.id);
      console.log(`   rel ${a.relations[b.id].toFixed(0)}/${b.relations[a.id].toFixed(0)} contact ${!!a.contact[b.id]} simil ${sim.diplomacy.similarity(a, b).toFixed(2)} border ${sim.borderTension(a.id, b.id).toFixed(2)} war ${p.war} treaties ${['trade', 'nonAggression', 'openBorders', 'alliance'].filter((k) => p[k]).join(',')}`);
    }
    if (process.env.TOWNS) for (const t of sim.towns) {
      if (!t || !t.alive) continue;
      const food = ['berries', 'grain', 'meat', 'fish', 'bread'].map((r) => r + ':' + t.stock[sim.economy.constructor.name ? RES[r] : 0].toFixed(0) + '/' + t.prod[RES[r]].toFixed(1)).join(' ');
      console.log(`   ${t.name} (${sim.civs[t.civ].name.split(' ')[0]}) pop ${t.pop} adults ${t.adults} idle ${t.idle} open ${t.openJobs} house ${t.housingCap} feed ${t.feedRatio.toFixed(2)} fd ${t.foodDays.toFixed(1)} | ${food} wood:${t.stock[RES.wood].toFixed(0)} stone:${t.stock[RES.stone].toFixed(0)} constr ${t.construction.length}`);
    }
  }
}
console.log(`done ${years}y in ${((Date.now() - t1) / 1000).toFixed(1)}s (${steps} steps)`);
for (const c of sim.civs) {
  console.log(`\n== ${c.name} (${c.government}) pop ${c.pop} techs ${c.techCount}/100 era ${c.era}`);
  console.log(' adopted:', c.adoptedList().join(', '));
  console.log(' bans:', [...c.bans].join(', '));
  const profs = PROFESSIONS.map((p, k) => [p.name, c.profCount[k]]).filter((x) => x[1] > 0).map((x) => x.join(':'));
  console.log(' professions:', profs.join(' '));
  const st = STRUCTURES.map((s, k) => [s.name, c.structCount[k]]).filter((x) => x[1] > 0).map((x) => x.join(':'));
  console.log(' structures:', st.join(' '));
  console.log(' techs:', TECHS.filter((t) => c.techs[t.idx]).map((t) => t.name).join(', '));
  console.log(' stats:', JSON.stringify(c.stats));
  const foodW = PROFESSIONS.reduce((a, p, k) => a + (p.cat === 'food' ? c.profCount[k] : 0), 0);
  console.log(` food workers ${foodW} of ${c.adults} adults (${(foodW / Math.max(1, c.adults) * 100).toFixed(0)}%), farm mod ${c.mod.farm.toFixed(2)}, birth mod ${c.mod.birth.toFixed(2)}`);
}
// coverage report
const everS = new Set(sim.everBuilt), everP = new Set([...sim.everProf].map((k) => PROFESSIONS[k].id));
for (const b of sim.buildings) if (b) everS.add(b.def.id);
for (const c of sim.civs) { STRUCTURES.forEach((s, k) => { if (c.structCount[k] > 0) everS.add(s.id); }); PROFESSIONS.forEach((p, k) => { if (c.profCount[k] > 0) everP.add(p.id); }); }
console.log(`\nstructures seen ${everS.size}/100; missing: ${STRUCTURES.filter((s) => !everS.has(s.id)).map((s) => s.id).join(' ')}`);
console.log(`professions seen ${everP.size}/100; missing: ${PROFESSIONS.filter((p) => !everP.has(p.id)).map((p) => p.id).join(' ')}`);
console.log('ships', sim.transport.ships.length, 'trains', sim.transport.trains.length, 'rail lines', sim.transport.lines.length, 'planes', sim.transport.planes.length, 'armies', sim.military.armies.length);
console.log('chronicle kinds', JSON.stringify(kinds));
if (process.env.CHRON) for (const e of sim.chronicleLog.slice(-120)) console.log(`  [Y${e.year}] ${e.text}`);

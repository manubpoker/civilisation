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
sim.onChronicle = (e) => { if (process.env.QUIET) return; console.log(`  [Y${e.year}] ${e.text}`); };
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
}

// Quick regression check: a short simulation must run without errors and
// both civilisations must be alive, growing, building and researching.
import { Sim } from '../src/sim/sim.js';
import { CFG } from '../src/config.js';
const years = +(process.argv[2] || 8);
const sim = new Sim(+(process.argv[3] || 7));
const start = sim.people.count;
while (sim.tick < years * CFG.TICKS_PER_YEAR) sim.step(4);
let ok = true;
for (const c of sim.civs) {
  const built = c.structCount.reduce((a, b) => a + b, 0);
  const line = `${c.name}: pop ${c.pop} techs ${c.techCount} structures ${built} adopted ${c.adoptedList().length}`;
  if (!c.alive || c.pop < 60 || built < 15 || c.techCount < 5) { ok = false; console.error('FAIL', line); } else console.log('ok  ', line);
}
console.log(`people ${start} → ${sim.people.count}, chronicle entries ${sim.chronicleLog.length}`);
process.exit(ok ? 0 : 1);

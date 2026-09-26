// Runs N years and prints what the planner values and fails to place.
import { Sim } from '../src/sim/sim.js';
import { CFG } from '../src/config.js';
import { STRUCTURES } from '../src/data/structures.js';
import { RESOURCES } from '../src/data/resources.js';
const years = +(process.argv[2] || 20);
const sim = new Sim(+(process.argv[3] || 7));
while (sim.tick < years * CFG.TICKS_PER_YEAR) sim.step(4);
console.log('placement failures:', JSON.stringify(sim.planner.fails));
for (const t of sim.towns) {
  if (!t || !t.alive) continue;
  const civ = sim.civs[t.civ];
  const counts = sim.planner.countTypes(t);
  const vals = [];
  for (const def of STRUCTURES) {
    if (!civ.structureAvailable(def)) continue;
    const v = sim.planner.value(def, t, civ, counts);
    if (v > 0.1) vals.push(def.id + '=' + v.toFixed(2) + (t.has(def.cost) ? '' : '(unaff)'));
  }
  console.log(`\n${t.name} pop ${t.pop} idle ${t.idle} open ${t.openJobs} fd ${t.foodDays.toFixed(1)} constr ${t.construction.length}`);
  console.log(' values:', vals.join(' '));
  const wants = [];
  for (let r = 0; r < RESOURCES.length; r++) if (t.want[r] > t.stock[r] + 2) wants.push(`${RESOURCES[r].id}:${t.stock[r].toFixed(0)}/${t.want[r].toFixed(0)}`);
  console.log(' deficits:', wants.join(' '));
}

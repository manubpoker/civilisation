// Profiles the simulation step after warming up for N years.
import { Sim } from '../src/sim/sim.js';
import { CFG } from '../src/config.js';
const warm = +(process.argv[2] || 40);
const sim = new Sim(+(process.argv[3] || 7));
while (sim.tick < warm * CFG.TICKS_PER_YEAR) sim.step(4);
console.log('pop', sim.people.count, 'buildings', sim.buildings.filter(Boolean).length);
const t0 = performance.now();
for (let k = 0; k < 1500; k++) sim.step(4);
console.log('ms/step', ((performance.now() - t0) / 1500).toFixed(3));

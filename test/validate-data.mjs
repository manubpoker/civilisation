// Validates counts and cross-references across all game data.
import { STRUCTURES, STRUCT_INDEX } from '../src/data/structures.js';
import { PROFESSIONS, PROF_INDEX } from '../src/data/professions.js';
import { TECHS, TECH_INDEX } from '../src/data/technologies.js';
import { SCALES, BELIEFS, B } from '../src/data/beliefs.js';
import { RESOURCES, RES_INDEX } from '../src/data/resources.js';

let errors = 0;
const err = (m) => { console.error('ERROR:', m); errors++; };
const scaleKeys = new Set(SCALES.map((s) => s.key));

const count = (name, arr, n) => {
  if (arr.length !== n) err(`${name}: expected ${n}, got ${arr.length}`);
  else console.log(`${name}: ${arr.length} ✓`);
  const ids = new Set();
  for (const a of arr) { if (ids.has(a.id)) err(`${name}: duplicate id ${a.id}`); ids.add(a.id); }
};
count('structures', STRUCTURES, 100);
count('technologies', TECHS, 100);
count('professions', PROFESSIONS, 100);
count('beliefs', BELIEFS, 100);
if (SCALES.length !== 50) err('scales: expected 50, got ' + SCALES.length); else console.log('belief scales: 50 ✓');
console.log('resources:', RESOURCES.length);

const checkRes = (where, obj) => { for (const k of Object.keys(obj || {})) if (RES_INDEX[k] === undefined) err(`${where}: unknown resource ${k}`); };
const checkBeliefs = (where, obj) => { for (const k of Object.keys(obj || {})) if (!scaleKeys.has(k)) err(`${where}: unknown belief scale ${k}`); };

for (const s of STRUCTURES) {
  if (s.tech && TECH_INDEX[s.tech] === undefined) err(`structure ${s.id}: unknown tech ${s.tech}`);
  checkRes(`structure ${s.id} cost`, s.cost);
  for (const j of Object.keys(s.jobs)) {
    if (j.startsWith('@')) { if (!['@infantry', '@ranged', '@cavalry', '@siege'].includes(j)) err(`structure ${s.id}: bad branch ${j}`); }
    else if (PROF_INDEX[j] === undefined) err(`structure ${s.id}: unknown profession ${j}`);
  }
  for (const r of s.recipes || []) { checkRes(`structure ${s.id} recipe in`, r.in); checkRes(`structure ${s.id} recipe out`, r.out); if (r.tech && TECH_INDEX[r.tech] === undefined) err(`recipe tech ${r.tech}`); }
  if (Array.isArray(s.dropoff)) for (const d of s.dropoff) if (RES_INDEX[d] === undefined) err(`structure ${s.id}: dropoff ${d}`);
  if (s.field) { if (RES_INDEX[s.field.out] === undefined) err(`field out ${s.field.out}`); checkRes('field extra', s.field.extra); }
  if (s.aura) checkBeliefs(`structure ${s.id} aura`, s.aura.beliefs);
  if (s.upgrades && STRUCT_INDEX[s.upgrades] === undefined) err(`structure ${s.id}: upgrades unknown`);
  if (!s.style || !s.style.kind) err(`structure ${s.id}: missing style`);
}
for (const p of PROFESSIONS) {
  if (p.tech && TECH_INDEX[p.tech] === undefined) err(`profession ${p.id}: unknown tech ${p.tech}`);
  checkBeliefs(`profession ${p.id} aff`, p.aff);
  checkBeliefs(`profession ${p.id} inf`, p.inf);
  checkRes(`profession ${p.id} equip`, p.equip);
  // every profession must be employable somewhere (except emergent ones)
  const used = STRUCTURES.some((s) => s.jobs[p.id]) || (p.branch && STRUCTURES.some((s) => s.jobs['@' + p.branch]));
  if (!used && !['laborer', 'thief'].includes(p.id)) err(`profession ${p.id}: no workplace`);
}
for (const t of TECHS) {
  for (const r of t.req) {
    if (TECH_INDEX[r] === undefined) err(`tech ${t.id}: unknown prereq ${r}`);
    else if (TECH_INDEX[r] >= TECH_INDEX[t.id]) err(`tech ${t.id}: prereq ${r} defined later`);
    else if (TECHS[TECH_INDEX[r]].era > t.era) err(`tech ${t.id}: prereq ${r} from later era`);
  }
  for (const n of t.needs) if (RES_INDEX[n] === undefined) err(`tech ${t.id}: needs unknown resource ${n}`);
}
for (const s of SCALES) {
  for (const pole of [s.neg, s.pos]) {
    for (const b of pole.bans || []) {
      if (b.startsWith('tech:')) { if (TECH_INDEX[b.slice(5)] === undefined) err(`belief ${pole.name}: bans unknown tech ${b}`); }
      else if (STRUCT_INDEX[b] === undefined && PROF_INDEX[b] === undefined) err(`belief ${pole.name}: bans unknown ${b}`);
    }
  }
}
// unlock coverage
const unlocks = {};
for (const t of TECHS) unlocks[t.id] = [];
for (const s of STRUCTURES) if (s.tech) unlocks[s.tech].push('S:' + s.id);
for (const p of PROFESSIONS) if (p.tech) unlocks[p.tech].push('P:' + p.id);
let bare = 0;
for (const t of TECHS) {
  if (!unlocks[t.id].length && !Object.keys(t.fx).length && !Object.keys(t.flags).length) { err(`tech ${t.id} unlocks nothing`); bare++; }
}
console.log(errors ? `\n${errors} error(s)` : '\nAll data valid ✓');
process.exit(errors ? 1 : 0);

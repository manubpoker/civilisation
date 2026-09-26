# Pixel Continent

A self-building civilisation simulation where **every pixel is a person**. Two peoples wake on opposite shores of a large procedurally generated continent and build everything themselves — you watch as a spectator with free zoom and pan.

Open `dist/pixel-continent.html` in any modern browser (no install), or run from source:

```sh
npm run dev          # static server at http://localhost:8080
npm run build        # rebuild dist/pixel-continent.html (single self-contained file)
npm test             # validate game data + headless simulation run
node test/headless.mjs 100 7 4   # simulate 100 years headlessly (seed 7, dt 4)
```

Append `#1234` to the URL to pick a different world seed.

## What is simulated

| System | Content |
|---|---|
| Structures | **100** — housing, farms, mines, workshops, factories, temples, universities, walls, castles, docks, railway stations, airports, power plants, wonders… each with jobs, recipes, harvesting, auras and belief influence |
| Technologies | **100** across 10 eras (Dawn → Future), with prerequisites, resource requirements (e.g. Bronze Working needs copper *and* tin), diffusion between civilisations in contact, and espionage |
| Beliefs | **100** beliefs on **50** opposing scales (Selfishness ↔ Empathy, Pacifism ↔ Bellicosity, Secularism ↔ Piety, …). Every person holds a value on every scale |
| Professions | **100** — gatherers to astronauts, each with its own behaviour, output, belief affinity and influence |
| Resources | 56 — from berries and clay to steel, electronics and uranium |

**People.** Each person has a position, age, sex, family, home, job, skill, education, health, hunger, happiness, loyalty and 50 belief values. They follow a daily schedule (work, leisure, sleep), pathfind across the terrain (A* on a navigation grid, with local steering that prefers roads), carry goods, fall in love, have children who inherit their parents' beliefs, fall ill, steal, emigrate, and die.

**Beliefs drive behaviour.** Convictions decide which job a person takes, whether they visit the temple or the tavern, share food in a famine, steal, enlist, flee or fight, and whether they emigrate. Beliefs spread through conversation, parents, elders, schools, preachers, building auras (temples push piety, laboratories secularism, markets openness, mines industrialism…), propaganda, trade contact, prophets and historical shocks (wars, plagues, discoveries). Pressure against a firmly held conviction meets resistance, so peoples keep distinct outlooks. When a civilisation's average passes a threshold it *adopts* the belief, changing its laws, what it builds and researches — and strongly held beliefs **ban** structures, professions or research (Naturalism outlaws strip mines and oil wells, Temperance closes taverns, Anti-intellectualism shuts universities, Pacifism bans weaponsmiths…). Governments emerge from the mix (Tribal Council, Theocracy, Merchant Oligarchy, Social Democracy…).

**Self-building.** A town planner scores every available structure against the town's needs (food, housing, production chains with propagated demand, service capacity) weighted by the civilisation's beliefs, then searches for a valid site (fertile soil for farms, ore deposits for mines, shorelines for docks, forests for lumber camps). Materials that hold up planned construction become bottlenecks the planner works to relieve (more quarries when stone blocks everything, a brickworks when bricks do), idle hands raise the value of new workplaces, and worked-out pits, quarries and mines are abandoned. A labour market assigns people to jobs by urgency and personal belief affinity. Settler parties found new towns, and families leave overgrown towns for small, well-fed colonies. Families have fewer children when the granaries are thin.

**Transport.** Footpaths form wherever people keep walking; road builders pave the busiest ones (dirt → stone → paved → highways) and build bridges; carts, trucks, porters and merchants haul shipments between towns; railwaymen lay track (a spanning network between stations, built from iron) and trains carry bulk freight; ships fish, trade and carry cargo along coasts; aircraft fly between airports or to airfields at large towns, burning fuel refined from oil, distilled from grain or wood.

**Materials.** Deposits are finite, but riverbank clay returns with the floods and weathering exposes fresh stone in the hills; big towns reach farther for quarries, pits and mines. Production chains run from ore, clay and coal through bronze, iron, bricks, glass and concrete to steel, machinery and electronics, with alternatives where a people's laws close a route (hand-built machinery where factories are outlawed, valves and wiring where oil is).

**Trade & diplomacy.** Traders carry surplus to foreign markets priced by scarcity. Relations drift with belief similarity, religion, border tension, trade and grudges — the Diplomacy tab shows what is pushing each relationship up or down. Treaties (trade, non-aggression, open borders, alliance) are signed and broken; diplomats, spies (tech theft, sabotage) and missionaries travel abroad, and zealots expel (sometimes kill) foreign missionaries. Wars bring armies that rally, march and besiege, with melee and ranged combat, towers, walls and town conquest. Soldiers are equipped from the town's stocks, so when the newest unit can't be armed older ones serve instead; an outmatched people mobilises harder, and occupation wearies the conqueror. Peace brings tribute and a truce, and peoples at war define themselves against the enemy's creed. A people besieged in its last town capitulates — paying half its treasury and a fifth of its stores for an eight-year truce — rather than being wiped out, unless a ruthless conqueror faces only a remnant. Unhappy towns riot or secede as new civilisations.

**World events.** Seasons, day and night, droughts and bountiful harvests, plagues that spread person to person, fires, earthquakes, prophets, great people, golden ages and nuclear meltdowns.

## Spectator controls

Drag or WASD to pan · wheel/pinch to zoom in pixel-exact steps · click a pixel to inspect a person or building · **F** follow · **Space** pause · **1–8** speed (½× to MAX; the almanac shows simulated years per second) · **T** territory · **N** night · **L** labels · **G** technology tree · **V** Director mode (the camera chases wars, disasters and discoveries, or follows a random citizen) · **H** guide (with a *new continent* button).

The dossier on the right has tabs for the chronicle, all 100 technologies, the 50 belief scales with each civilisation's average, workforce by profession, structures (including what is outlawed), stockpiles and prices, diplomacy and military, and census charts. Clicking any name opens an encyclopedia entry.

## Code layout

```
src/data/       structures, technologies, beliefs, professions, resources
src/world/      terrain types, continent generation (noise, mountain spine, rivers, lakes, deposits)
src/sim/        people (typed arrays), movement & A*, behaviour, jobs, lifecycle, economy,
                planner, research, belief dynamics, diplomacy, trade, military, transport,
                events, settlement, orchestrator
src/render/     palette, procedural building sprites, pixel-perfect renderer
src/ui/         spectator interface and styles
test/           data validation, headless runs, planner diagnostics, screenshots
```

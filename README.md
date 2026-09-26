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

**Beliefs drive behaviour.** Convictions decide which job a person takes, whether they visit the temple or the tavern, share food in a famine, steal, enlist, flee or fight, and whether they emigrate. Beliefs spread through conversation, parents, schools, preachers, building auras, propaganda, trade contact, prophets and historical shocks (wars, plagues, discoveries). When a civilisation's average passes a threshold it *adopts* the belief, changing its laws, what it builds and researches — and strongly held beliefs **ban** structures, professions or research (Naturalism outlaws strip mines and oil wells, Temperance closes taverns, Anti-intellectualism shuts universities, Pacifism bans weaponsmiths…). Governments emerge from the mix (Tribal Council, Theocracy, Merchant Oligarchy, Social Democracy…).

**Self-building.** A town planner scores every available structure against the town's needs (food, housing, production chains with propagated demand, service capacity) weighted by the civilisation's beliefs, then searches for a valid site (fertile soil for farms, ore deposits for mines, shorelines for docks, forests for lumber camps). A labour market assigns people to jobs by urgency and personal belief affinity. Settler parties found new towns.

**Transport.** Footpaths form wherever people keep walking; road builders pave the busiest ones (dirt → stone → paved → highways) and build bridges; carts, trucks, porters and merchants haul shipments between towns; railwaymen lay track and trains carry bulk freight; ships fish, trade and carry cargo along coasts; aircraft fly between airports.

**Trade & diplomacy.** Traders carry surplus to foreign markets priced by scarcity. Relations drift with belief similarity, religion, border tension, trade and grudges. Treaties (trade, non-aggression, open borders, alliance) are signed and broken; diplomats, spies (tech theft, sabotage) and missionaries travel abroad. Wars bring armies that rally, march and besiege, with melee and ranged combat, towers, walls and town conquest; peace brings tribute and truces. Unhappy towns riot or secede as new civilisations.

**World events.** Seasons, day and night, droughts and bountiful harvests, plagues that spread person to person, fires, earthquakes, prophets, great people, golden ages and nuclear meltdowns.

## Spectator controls

Drag or WASD to pan · wheel/pinch to zoom in pixel-exact steps · click a pixel to inspect a person or building · **F** follow · **Space** pause · **1–8** speed · **T** territory · **N** night · **L** labels · **G** technology tree · **H** guide.

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

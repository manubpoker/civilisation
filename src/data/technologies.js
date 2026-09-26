// 100 technologies in 10 eras. `req` prerequisites; `needs` = resources that
// must be accessible (a known deposit in explored land, or stock from trade);
// `fx` = civilisation modifiers added when learned; `flags` unlock systems.

export const ERAS = [
  'Dawn Age', 'Ancient Age', 'Bronze Age', 'Classical Age', 'Medieval Age',
  'Renaissance', 'Industrial Age', 'Modern Age', 'Information Age', 'Future Age',
];
export const ERA_COST = [50, 150, 340, 680, 1150, 1900, 2900, 4300, 6200, 8800];

const Tn = (id, name, era, req, o = {}) => ({ id, name, era, req, ...o });

export const TECHS = [
  // ---------------------------------------------------------------- Dawn Age
  Tn('foraging', 'Foraging', 0, [], { start: true, desc: 'Knowledge of edible plants, berries and herbs.' }),
  Tn('fire', 'Fire', 0, [], { start: true, desc: 'Controlled fire for warmth, cooking and protection.' }),
  Tn('stone_tools', 'Stone Tools', 0, [], { start: true, desc: 'Knapped flint axes and scrapers; huts and lumber camps.' }),
  Tn('hunting', 'Hunting', 0, ['stone_tools'], { fx: { hunt: 0.2 }, desc: 'Coordinated hunts for game.' }),
  Tn('fishing', 'Fishing', 0, ['stone_tools'], { fx: { fish: 0.2 }, desc: 'Hooks, lines and weirs.' }),
  Tn('mysticism', 'Mysticism', 0, ['fire'], { fx: { faith: 0.1 }, desc: 'Spirits, omens and the first shrines.' }),
  Tn('pottery', 'Pottery', 0, ['fire'], { fx: { spoil: -0.15 }, desc: 'Fired clay vessels to store food.' }),
  Tn('animal_husbandry', 'Animal Husbandry', 0, ['hunting'], { desc: 'Domesticated herds for meat, wool and hides.' }),
  Tn('agriculture', 'Agriculture', 0, ['foraging'], { fx: { farm: 0.1 }, desc: 'Sowing and harvesting grain.' }),
  Tn('herbalism', 'Herbalism', 0, ['foraging'], { fx: { health: 0.1 }, desc: 'Medicinal plants.' }),
  // ------------------------------------------------------------- Ancient Age
  Tn('masonry', 'Masonry', 1, ['stone_tools', 'agriculture'], { fx: { build: 0.05 }, desc: 'Cut stone, quarries and monuments.' }),
  Tn('weaving', 'Weaving', 1, ['agriculture'], { desc: 'Cloth from plant fibre and wool.' }),
  Tn('the_wheel', 'The Wheel', 1, ['pottery', 'animal_husbandry'], { fx: { carry: 0.3 }, flags: { cart: 1 }, desc: 'Carts, mills and faster hauling.' }),
  Tn('barter', 'Barter', 1, ['pottery'], { fx: { trade: 0.1 }, desc: 'Markets and exchange with strangers.' }),
  Tn('writing', 'Writing', 1, ['mysticism', 'barter'], { fx: { research: 0.1 }, desc: 'Symbols to record knowledge; libraries and embassies.' }),
  Tn('archery', 'Archery', 1, ['hunting'], { desc: 'Bows for hunting and war; watchtowers.' }),
  Tn('sailing', 'Sailing', 1, ['fishing', 'weaving'], { flags: { ships: 1 }, desc: 'Sailboats and docks.' }),
  Tn('irrigation', 'Irrigation', 1, ['agriculture'], { fx: { farm: 0.2 }, desc: 'Canals carry water to the fields.' }),
  Tn('calendar', 'Calendar', 1, ['mysticism', 'agriculture'], { fx: { farm: 0.1, spoil: -0.1 }, desc: 'Tracking seasons for planting.' }),
  Tn('tribal_law', 'Tribal Law', 1, ['mysticism'], { fx: { crime: -0.1 }, desc: 'Customs, warriors and palisades.' }),
  // --------------------------------------------------------------- Bronze Age
  Tn('mining', 'Mining', 2, ['masonry'], { fx: { mine: 0.2 }, desc: 'Shafts and tunnels to reach ores and coal.' }),
  Tn('bronze_working', 'Bronze Working', 2, ['mining'], { needs: ['copper_ore', 'tin_ore'], fx: { gather: 0.05 }, desc: 'Alloying copper and tin.' }),
  Tn('horseback_riding', 'Horseback Riding', 2, ['animal_husbandry', 'the_wheel'], { fx: { move: 0.05 }, flags: { horses: 1 }, desc: 'Taming horses for riding and haulage.' }),
  Tn('currency', 'Currency', 2, ['barter', 'mining'], { fx: { trade: 0.15, coins: 0.2 }, desc: 'Minted coins; gold and silver mines.' }),
  Tn('mathematics', 'Mathematics', 2, ['writing', 'masonry'], { fx: { build: 0.05, research: 0.05 }, desc: 'Geometry and arithmetic; great works.' }),
  Tn('priesthood', 'Priesthood', 2, ['mysticism', 'writing'], { fx: { faith: 0.2 }, desc: 'Organised religion and temples.' }),
  Tn('construction', 'Construction', 2, ['masonry', 'the_wheel'], { fx: { build: 0.15 }, flags: { bridge: 1 }, desc: 'Bricks, stone houses, arenas and bridges.' }),
  Tn('code_of_laws', 'Code of Laws', 2, ['tribal_law', 'writing'], { fx: { crime: -0.15 }, desc: 'Written law; town halls and courts.' }),
  Tn('fermentation', 'Fermentation', 2, ['pottery', 'agriculture'], { fx: { happy: 1 }, desc: 'Beer, wine and taverns.' }),
  Tn('beekeeping', 'Beekeeping', 2, ['agriculture', 'animal_husbandry'], { fx: { farm: 0.05 }, flags: { honey: 1 }, desc: 'Hives for honey and better pollination.' }),
  // ------------------------------------------------------------ Classical Age
  Tn('iron_working', 'Iron Working', 3, ['bronze_working'], { needs: ['iron_ore'], fx: { gather: 0.1, attack: 0.1 }, desc: 'Smelting iron with charcoal.' }),
  Tn('philosophy', 'Philosophy', 3, ['mathematics', 'code_of_laws'], { fx: { research: 0.1, culture: 0.1 }, desc: 'Reasoned inquiry and academies.' }),
  Tn('literacy', 'Literacy', 3, ['writing', 'currency'], { fx: { research: 0.1, edu: 0.2 }, desc: 'Schools teach reading to the young.' }),
  Tn('engineering', 'Engineering', 3, ['mathematics', 'construction'], { fx: { build: 0.1 }, flags: { roadLevel: 2 }, desc: 'Stone roads, glass and bridges.' }),
  Tn('drama', 'Drama', 3, ['priesthood', 'currency'], { fx: { culture: 0.15 }, desc: 'Theatre and poetry.' }),
  Tn('shipbuilding', 'Shipbuilding', 3, ['sailing', 'construction'], { fx: { naval: 0.2 }, flags: { ships: 2 }, desc: 'Galleys and shipyards.' }),
  Tn('military_tactics', 'Military Tactics', 3, ['bronze_working', 'horseback_riding'], { fx: { attack: 0.1, defense: 0.1 }, desc: 'Formations, siege engines and generals.' }),
  Tn('astronomy', 'Astronomy', 3, ['mathematics', 'calendar'], { fx: { research: 0.05, naval: 0.1 }, desc: 'Observatories chart the heavens.' }),
  Tn('aqueducts', 'Aqueducts', 3, ['construction', 'irrigation'], { fx: { health: 0.15, disease: -0.2 }, desc: 'Clean water and public baths.' }),
  Tn('monarchy', 'Monarchy', 3, ['code_of_laws', 'priesthood'], { fx: { loyalty: 0.1, order: 0.1 }, desc: 'Hereditary kingship and palaces.' }),
  // ------------------------------------------------------------ Medieval Age
  Tn('feudalism', 'Feudalism', 4, ['monarchy', 'military_tactics'], { fx: { defense: 0.1 }, desc: 'Lords, vassals, manors and pikemen.' }),
  Tn('theology', 'Theology', 4, ['philosophy', 'priesthood'], { fx: { faith: 0.2 }, desc: 'Systematic faith and monasteries.' }),
  Tn('education', 'Education', 4, ['philosophy', 'literacy'], { fx: { research: 0.15, edu: 0.2 }, desc: 'Universities and higher learning.' }),
  Tn('guilds', 'Guilds', 4, ['currency', 'literacy'], { fx: { craft: 0.15 }, desc: 'Craft guilds, jewellers and apprentices.' }),
  Tn('compass', 'Compass', 4, ['shipbuilding', 'astronomy'], { fx: { naval: 0.2, vision: 0.2 }, desc: 'Reliable navigation.' }),
  Tn('machinery', 'Machinery', 4, ['engineering', 'iron_working'], { fx: { craft: 0.1, gather: 0.1 }, desc: 'Gears, cranes and crossbows.' }),
  Tn('fortification', 'Fortification', 4, ['engineering', 'military_tactics'], { fx: { defense: 0.2 }, desc: 'Stone walls and castles.' }),
  Tn('paper', 'Paper', 4, ['literacy', 'weaving'], { fx: { research: 0.05 }, desc: 'Cheap writing material.' }),
  Tn('chivalry', 'Chivalry', 4, ['feudalism', 'horseback_riding'], { fx: { morale: 0.2 }, desc: 'Knights and codes of honour.' }),
  Tn('medicine', 'Medicine', 4, ['herbalism', 'philosophy'], { fx: { health: 0.2, lifespan: 3 }, desc: 'Hospitals and trained physicians.' }),
  // ------------------------------------------------------------- Renaissance
  Tn('printing', 'Printing Press', 5, ['paper', 'machinery'], { fx: { research: 0.2, culture: 0.1 }, desc: 'Mass-produced books.' }),
  Tn('gunpowder', 'Gunpowder', 5, ['fortification', 'machinery'], { needs: ['sulfur'], fx: { attack: 0.15 }, desc: 'Muskets, arsenals and sulfur mining.' }),
  Tn('banking', 'Banking', 5, ['guilds', 'education'], { fx: { coins: 0.3, trade: 0.1 }, desc: 'Banks, credit and patronage of the arts.' }),
  Tn('navigation', 'Navigation', 5, ['compass', 'astronomy'], { fx: { naval: 0.3, trade: 0.1 }, flags: { ships: 3 }, desc: 'Ocean-going caravels.' }),
  Tn('physics', 'Physics', 5, ['education', 'astronomy'], { fx: { research: 0.15 }, desc: 'Laws of motion.' }),
  Tn('architecture', 'Architecture', 5, ['education', 'machinery'], { fx: { build: 0.15, housing: 0.1 }, desc: 'Townhouses, cathedrals and concrete.' }),
  Tn('chemistry', 'Chemistry', 5, ['medicine', 'education'], { fx: { research: 0.1, health: 0.05 }, desc: 'Elements and reactions.' }),
  Tn('optics', 'Optics', 5, ['physics', 'astronomy'], { fx: { research: 0.05, vision: 0.3 }, desc: 'Lenses, telescopes and microscopes.' }),
  Tn('economics', 'Economics', 5, ['banking'], { fx: { trade: 0.2, coins: 0.2 }, desc: 'Stock exchanges and markets theory.' }),
  Tn('metallurgy', 'Metallurgy', 5, ['gunpowder', 'machinery'], { fx: { mine: 0.2, craft: 0.05 }, desc: 'Better alloys and cannon.' }),
  // ---------------------------------------------------------- Industrial Age
  Tn('steam_engine', 'Steam Engine', 6, ['physics', 'metallurgy'], { needs: ['coal'], fx: { craft: 0.15 }, flags: { ships: 4 }, desc: 'Steam power for pumps, mills and ships.' }),
  Tn('railroad', 'Railroad', 6, ['steam_engine'], { needs: ['iron_ore'], flags: { rail: 1 }, desc: 'Iron rails and locomotives.' }),
  Tn('industrialization', 'Industrialization', 6, ['steam_engine', 'economics'], { fx: { craft: 0.25, pollution: 0.5 }, flags: { roadLevel: 3 }, desc: 'Factories, tenements and paved roads.' }),
  Tn('scientific_method', 'Scientific Method', 6, ['physics', 'chemistry', 'optics'], { fx: { research: 0.25 }, desc: 'Hypothesis and experiment; laboratories.' }),
  Tn('sanitation', 'Sanitation', 6, ['chemistry', 'engineering'], { fx: { disease: -0.4, health: 0.1 }, desc: 'Sewers and clean water.' }),
  Tn('electricity', 'Electricity', 6, ['scientific_method', 'metallurgy'], { flags: { power: 1 }, desc: 'Generators, power grids and lights.' }),
  Tn('steel', 'Steel', 6, ['metallurgy', 'industrialization'], { fx: { build: 0.1 }, desc: 'Bessemer steel for rails and towers.' }),
  Tn('rifling', 'Rifling', 6, ['metallurgy', 'gunpowder'], { fx: { attack: 0.2 }, desc: 'Accurate rifles; riflemen and dragoons.' }),
  Tn('democracy', 'Democracy', 6, ['printing', 'economics'], { fx: { happy: 3, unrest: -0.2 }, desc: 'Elected governments; the Capitol.' }),
  Tn('vaccination', 'Vaccination', 6, ['chemistry', 'scientific_method'], { fx: { disease: -0.5, lifespan: 5 }, desc: 'Immunity against plagues.' }),
  // -------------------------------------------------------------- Modern Age
  Tn('combustion', 'Combustion Engine', 7, ['industrialization', 'scientific_method'], { fx: { craft: 0.1 }, flags: { ships: 5 }, desc: 'Internal combustion; oil prospecting.' }),
  Tn('oil_refining', 'Oil Refining', 7, ['combustion'], { needs: ['oil'], desc: 'Fuel from crude oil.' }),
  Tn('mass_production', 'Mass Production', 7, ['industrialization', 'electricity'], { fx: { craft: 0.3 }, desc: 'Assembly lines.' }),
  Tn('radio', 'Radio', 7, ['electricity'], { fx: { culture: 0.1, diplomacy: 0.1 }, desc: 'Broadcasting and propaganda.' }),
  Tn('flight', 'Flight', 7, ['combustion'], { flags: { flight: 1 }, desc: 'Aircraft and airports.' }),
  Tn('plastics', 'Plastics', 7, ['oil_refining'], { fx: { craft: 0.1 }, desc: 'Synthetic polymers.' }),
  Tn('antibiotics', 'Antibiotics', 7, ['vaccination'], { fx: { health: 0.3, lifespan: 6 }, desc: 'Penicillin conquers infection.' }),
  Tn('electronics', 'Electronics', 7, ['electricity', 'mass_production'], { fx: { research: 0.1 }, desc: 'Vacuum tubes and transistors; skyscrapers.' }),
  Tn('automobile', 'Automobile', 7, ['combustion', 'steel'], { fx: { move: 0.1 }, flags: { roadLevel: 4, trucks: 1 }, desc: 'Cars, trucks and highways.' }),
  Tn('mechanized_warfare', 'Mechanized Warfare', 7, ['automobile', 'rifling'], { fx: { attack: 0.2, defense: 0.1 }, desc: 'Tanks and motorised armies.' }),
  // --------------------------------------------------------- Information Age
  Tn('nuclear_fission', 'Nuclear Fission', 8, ['electronics', 'scientific_method'], { needs: ['uranium'], desc: 'Splitting the atom.' }),
  Tn('computers', 'Computers', 8, ['electronics'], { fx: { research: 0.25 }, desc: 'Programmable machines; research institutes.' }),
  Tn('rocketry', 'Rocketry', 8, ['flight', 'electronics'], { fx: { attack: 0.1 }, desc: 'Rockets and missiles.' }),
  Tn('television', 'Television', 8, ['radio', 'electronics'], { fx: { culture: 0.2, happy: 2 }, desc: 'Mass media.' }),
  Tn('genetics', 'Genetics', 8, ['antibiotics', 'computers'], { fx: { farm: 0.3, health: 0.2, lifespan: 5 }, desc: 'Engineered crops and medicine.' }),
  Tn('ecology', 'Ecology', 8, ['combustion', 'antibiotics'], { fx: { pollution: -0.4 }, desc: 'Understanding ecosystems; environmentalism.' }),
  Tn('internet', 'Internet', 8, ['computers', 'television'], { fx: { research: 0.2, trade: 0.2, diplomacy: 0.2 }, desc: 'A global network.' }),
  Tn('robotics', 'Robotics', 8, ['computers', 'mass_production'], { fx: { craft: 0.3, build: 0.3 }, desc: 'Industrial robots.' }),
  Tn('satellites', 'Satellites', 8, ['rocketry', 'computers'], { fx: { vision: 1, naval: 0.2 }, desc: 'Orbital eyes and communications.' }),
  Tn('globalization', 'Globalization', 8, ['internet', 'flight'], { fx: { trade: 0.3, diplomacy: 0.3 }, desc: 'A world economy.' }),
  // -------------------------------------------------------------- Future Age
  Tn('renewable_energy', 'Renewable Energy', 9, ['ecology', 'electronics'], { fx: { pollution: -0.4 }, desc: 'Solar and wind power.' }),
  Tn('fusion', 'Fusion Power', 9, ['nuclear_fission', 'computers'], { desc: 'Harnessing the power of stars.' }),
  Tn('artificial_intelligence', 'Artificial Intelligence', 9, ['robotics', 'internet'], { fx: { research: 0.5, craft: 0.2 }, desc: 'Thinking machines.' }),
  Tn('nanotechnology', 'Nanotechnology', 9, ['genetics', 'robotics'], { fx: { build: 0.3, craft: 0.2 }, desc: 'Machines built atom by atom.' }),
  Tn('quantum_computing', 'Quantum Computing', 9, ['internet', 'nanotechnology'], { fx: { research: 0.4 }, desc: 'Computation beyond classical limits.' }),
  Tn('arcology', 'Arcologies', 9, ['renewable_energy', 'nanotechnology'], { fx: { housing: 0.2 }, desc: 'Self-contained city-buildings.' }),
  Tn('cybernetics', 'Cybernetics', 9, ['genetics', 'robotics'], { fx: { lifespan: 15, health: 0.2 }, desc: 'Augmented humans.' }),
  Tn('climate_engineering', 'Climate Engineering', 9, ['renewable_energy', 'satellites'], { fx: { farm: 0.3, pollution: -0.5 }, desc: 'Controlling the weather itself.' }),
  Tn('space_colonization', 'Space Colonization', 9, ['satellites', 'fusion'], { desc: 'Spaceports and colony ships.' }),
  Tn('transcendence', 'Transcendence', 9, ['artificial_intelligence', 'quantum_computing', 'space_colonization', 'cybernetics'], { fx: { research: 1, happy: 10 }, desc: 'The final frontier of mind and matter.' }),
];

export const TECH_INDEX = {};
TECHS.forEach((t, i) => {
  TECH_INDEX[t.id] = i; t.idx = i;
  t.cost = t.cost || Math.round(ERA_COST[t.era] * (1 + (i % 10) * 0.035));
  t.fx = t.fx || {};
  t.flags = t.flags || {};
  t.needs = t.needs || [];
});
export function TC(id) {
  const i = TECH_INDEX[id];
  if (i === undefined) throw new Error('Unknown tech ' + id);
  return i;
}

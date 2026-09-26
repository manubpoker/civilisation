// Terrain types and map deposit types.

export const T = {
  DEEP: 0, SHALLOW: 1, LAKE: 2, RIVER: 3, BEACH: 4, GRASS: 5, PLAINS: 6, SAVANNA: 7,
  FOREST: 8, JUNGLE: 9, TAIGA: 10, TUNDRA: 11, SNOW: 12, DESERT: 13, MARSH: 14,
  HILLS: 15, MOUNTAIN: 16, PEAK: 17,
};

// speed: movement multiplier (0 = impassable on foot)
// build: 0 none, 1 normal, 2 only mines/quarries
// fert: farm fertility 0..1
export const TERRAIN = [
  { name: 'Deep Ocean', speed: 0, build: 0, fert: 0, water: 1, color: [20, 44, 88], v: 6 },
  { name: 'Shallow Sea', speed: 0, build: 0, fert: 0, water: 1, color: [38, 86, 138], v: 6 },
  { name: 'Lake', speed: 0, build: 0, fert: 0, water: 1, color: [44, 94, 146], v: 5 },
  { name: 'River', speed: 0.22, build: 0, fert: 0, water: 1, color: [56, 112, 172], v: 6 },
  { name: 'Beach', speed: 0.85, build: 1, fert: 0.1, water: 0, color: [212, 198, 148], v: 10 },
  { name: 'Grassland', speed: 1.0, build: 1, fert: 0.85, water: 0, color: [94, 148, 68], v: 12 },
  { name: 'Steppe', speed: 1.0, build: 1, fert: 0.6, water: 0, color: [148, 158, 88], v: 12 },
  { name: 'Savanna', speed: 0.95, build: 1, fert: 0.5, water: 0, color: [176, 162, 86], v: 12 },
  { name: 'Forest', speed: 0.7, build: 1, fert: 0.6, water: 0, color: [70, 116, 58], v: 10 },
  { name: 'Jungle', speed: 0.5, build: 1, fert: 0.55, water: 0, color: [50, 104, 54], v: 10 },
  { name: 'Taiga', speed: 0.65, build: 1, fert: 0.35, water: 0, color: [82, 110, 86], v: 10 },
  { name: 'Tundra', speed: 0.8, build: 1, fert: 0.15, water: 0, color: [146, 148, 128], v: 10 },
  { name: 'Snowfield', speed: 0.4, build: 1, fert: 0.0, water: 0, color: [228, 232, 238], v: 6 },
  { name: 'Desert', speed: 0.75, build: 1, fert: 0.08, water: 0, color: [222, 196, 132], v: 12 },
  { name: 'Marsh', speed: 0.45, build: 1, fert: 0.35, water: 0, color: [86, 108, 80], v: 12 },
  { name: 'Hills', speed: 0.6, build: 1, fert: 0.45, water: 0, color: [128, 138, 88], v: 14 },
  { name: 'Mountains', speed: 0.3, build: 2, fert: 0.0, water: 0, color: [118, 110, 102], v: 16 },
  { name: 'Peaks', speed: 0.18, build: 0, fert: 0, water: 0, color: [150, 144, 140], v: 14 },
];

// Map deposits (per-pixel natural resources). `res` names the economic resource
// harvested. `hidden` deposits are only known to civs owning `revealTech`.
export const D = {
  NONE: 0, TREE: 1, BERRY: 2, STONE: 3, COPPER: 4, TIN: 5, IRON: 6, COAL: 7, GOLD: 8,
  SILVER: 9, GEMS: 10, SALT: 11, MARBLE: 12, SULFUR: 13, CLAY: 14, OIL: 15, URANIUM: 16,
  FISH: 17, SPICE: 18, HERBS: 19, SAPLING: 20, COTTON: 21,
};

export const DEPOSITS = [
  { name: 'None' },
  { name: 'Trees', res: 'wood', color: [34, 82, 36] },
  { name: 'Berry bushes', res: 'berries', color: [150, 50, 90] },
  { name: 'Stone', res: 'stone', color: [150, 148, 144] },
  { name: 'Copper', res: 'copper_ore', color: [196, 110, 60] },
  { name: 'Tin', res: 'tin_ore', color: [170, 176, 186] },
  { name: 'Iron', res: 'iron_ore', color: [130, 76, 58] },
  { name: 'Coal', res: 'coal', color: [36, 34, 36], revealTech: 'mining' },
  { name: 'Gold', res: 'gold', color: [240, 200, 60] },
  { name: 'Silver', res: 'silver', color: [220, 224, 232] },
  { name: 'Gems', res: 'gems', color: [120, 220, 200] },
  { name: 'Salt', res: 'salt', color: [240, 238, 230] },
  { name: 'Marble', res: 'marble', color: [236, 232, 222] },
  { name: 'Sulfur', res: 'sulfur', color: [220, 210, 60], revealTech: 'chemistry' },
  { name: 'Clay', res: 'clay', color: [170, 110, 80] },
  { name: 'Oil', res: 'oil', color: [20, 18, 22], revealTech: 'combustion' },
  { name: 'Uranium', res: 'uranium', color: [120, 230, 80], revealTech: 'nuclear_fission' },
  { name: 'Fish', res: 'fish', color: [80, 140, 190] },
  { name: 'Spices', res: 'spices', color: [200, 90, 40] },
  { name: 'Herbs', res: 'herbs', color: [120, 170, 90] },
  { name: 'Sapling', res: null, color: [80, 130, 60] },
  { name: 'Wild cotton', res: 'fiber', color: [236, 236, 226] },
];

export function depositByRes(resId) {
  for (let i = 1; i < DEPOSITS.length; i++) if (DEPOSITS[i].res === resId) return i;
  return 0;
}

// Economic resources. `food` = nutrition per unit (edible if > 0),
// `lux` = happiness value when consumed as a luxury, `spoil` = fraction lost per day.

export const RESOURCES = [
  // --- food
  { id: 'berries', name: 'Berries & Fruit', cat: 'food', base: 1, food: 1.0, spoil: 0.03, color: '#b03a6a' },
  { id: 'grain', name: 'Grain', cat: 'food', base: 1, food: 0.7, spoil: 0.004, color: '#d9bf5f' },
  { id: 'flour', name: 'Flour', cat: 'food', base: 1.5, food: 0, spoil: 0.004, color: '#efe6cf' },
  { id: 'bread', name: 'Bread', cat: 'food', base: 2.2, food: 1.6, spoil: 0.02, color: '#c68a44' },
  { id: 'meat', name: 'Meat', cat: 'food', base: 2, food: 1.4, spoil: 0.03, color: '#b0413e' },
  { id: 'fish', name: 'Fish', cat: 'food', base: 1.6, food: 1.2, spoil: 0.035, color: '#6fa3c7' },
  { id: 'honey', name: 'Honey', cat: 'food', base: 3, food: 1.0, lux: 0.3, spoil: 0, color: '#e8a81c' },
  { id: 'salt', name: 'Salt', cat: 'raw', base: 3, food: 0, spoil: 0, color: '#f2efe6' },
  { id: 'spices', name: 'Spices', cat: 'luxury', base: 6, food: 0.2, lux: 0.8, spoil: 0, color: '#c8602a' },
  { id: 'wine', name: 'Wine', cat: 'luxury', base: 6, food: 0.2, lux: 1.0, spoil: 0, color: '#7b1f45' },
  { id: 'beer', name: 'Beer', cat: 'luxury', base: 3, food: 0.3, lux: 0.6, spoil: 0.005, color: '#d6a13b' },
  { id: 'preserved_food', name: 'Preserved Food', cat: 'food', base: 3, food: 1.8, spoil: 0, color: '#9c7b52' },
  // --- raw materials
  { id: 'wood', name: 'Wood', cat: 'raw', base: 1, spoil: 0, color: '#8a5a2b' },
  { id: 'stone', name: 'Stone', cat: 'raw', base: 1.2, spoil: 0, color: '#9a9894' },
  { id: 'clay', name: 'Clay', cat: 'raw', base: 1, spoil: 0, color: '#aa6e50' },
  { id: 'marble', name: 'Marble', cat: 'raw', base: 5, spoil: 0, color: '#ece8de' },
  { id: 'copper_ore', name: 'Copper Ore', cat: 'raw', base: 2.5, spoil: 0, color: '#c46e3c' },
  { id: 'tin_ore', name: 'Tin Ore', cat: 'raw', base: 3, spoil: 0, color: '#aab0ba' },
  { id: 'iron_ore', name: 'Iron Ore', cat: 'raw', base: 2.5, spoil: 0, color: '#824c3a' },
  { id: 'coal', name: 'Coal', cat: 'raw', base: 2, spoil: 0, color: '#2a282a' },
  { id: 'gold', name: 'Gold', cat: 'raw', base: 12, spoil: 0, color: '#f0c83c' },
  { id: 'silver', name: 'Silver', cat: 'raw', base: 8, spoil: 0, color: '#dce0e8' },
  { id: 'gems', name: 'Gems', cat: 'raw', base: 15, spoil: 0, color: '#78dcc8' },
  { id: 'sulfur', name: 'Sulfur', cat: 'raw', base: 4, spoil: 0, color: '#dcd23c' },
  { id: 'oil', name: 'Crude Oil', cat: 'raw', base: 6, spoil: 0, color: '#141216' },
  { id: 'uranium', name: 'Uranium', cat: 'raw', base: 25, spoil: 0, color: '#78e650' },
  { id: 'fiber', name: 'Cotton & Flax', cat: 'raw', base: 1.5, spoil: 0, color: '#ecece2' },
  { id: 'wool', name: 'Wool', cat: 'raw', base: 2, spoil: 0, color: '#ddd6c6' },
  { id: 'hides', name: 'Hides', cat: 'raw', base: 1.5, spoil: 0.005, color: '#8c6242' },
  { id: 'herbs', name: 'Herbs', cat: 'raw', base: 2, spoil: 0.01, color: '#78aa5a' },
  { id: 'horses', name: 'Horses', cat: 'raw', base: 10, spoil: 0, color: '#6b4a32' },
  // --- processed materials
  { id: 'lumber', name: 'Lumber', cat: 'material', base: 2.5, spoil: 0, color: '#c08a52' },
  { id: 'bricks', name: 'Bricks', cat: 'material', base: 2.5, spoil: 0, color: '#b24a32' },
  { id: 'pottery', name: 'Pottery', cat: 'good', base: 3, lux: 0.2, spoil: 0, color: '#c07848' },
  { id: 'bronze', name: 'Bronze', cat: 'material', base: 6, spoil: 0, color: '#b8863c' },
  { id: 'iron', name: 'Iron', cat: 'material', base: 6, spoil: 0, color: '#6c6e74' },
  { id: 'steel', name: 'Steel', cat: 'material', base: 12, spoil: 0, color: '#a8b0bc' },
  { id: 'glass', name: 'Glass', cat: 'material', base: 5, spoil: 0, color: '#bce6ea' },
  { id: 'concrete', name: 'Concrete', cat: 'material', base: 5, spoil: 0, color: '#b4b2aa' },
  { id: 'leather', name: 'Leather', cat: 'material', base: 4, spoil: 0, color: '#9a6232' },
  { id: 'cloth', name: 'Cloth', cat: 'material', base: 4, spoil: 0, color: '#e2d2b6' },
  { id: 'paper', name: 'Paper', cat: 'material', base: 4, spoil: 0, color: '#f4f0e0' },
  { id: 'fuel', name: 'Fuel', cat: 'energy', base: 9, spoil: 0, color: '#5a3a1a' },
  { id: 'plastics', name: 'Plastics', cat: 'material', base: 10, spoil: 0, color: '#e8e060' },
  // --- finished goods
  { id: 'tools', name: 'Tools', cat: 'good', base: 8, spoil: 0, color: '#8a8e96' },
  { id: 'clothing', name: 'Clothing', cat: 'good', base: 8, lux: 0.4, spoil: 0, color: '#6a4ca0' },
  { id: 'furniture', name: 'Furniture', cat: 'good', base: 10, lux: 0.5, spoil: 0, color: '#7a4a22' },
  { id: 'jewelry', name: 'Jewelry', cat: 'luxury', base: 30, lux: 1.5, spoil: 0, color: '#f8d860' },
  { id: 'books', name: 'Books', cat: 'good', base: 12, lux: 0.4, spoil: 0, color: '#6a2a2a' },
  { id: 'medicine', name: 'Medicine', cat: 'good', base: 10, spoil: 0, color: '#e84a5a' },
  { id: 'weapons', name: 'Weapons', cat: 'military', base: 14, spoil: 0, color: '#5a5e66' },
  { id: 'armor', name: 'Armor', cat: 'military', base: 16, spoil: 0, color: '#8a9098' },
  { id: 'gunpowder', name: 'Gunpowder', cat: 'military', base: 12, spoil: 0, color: '#3a3a3a' },
  { id: 'machinery', name: 'Machinery', cat: 'good', base: 30, spoil: 0, color: '#6a7a8a' },
  { id: 'electronics', name: 'Electronics', cat: 'good', base: 45, lux: 0.8, spoil: 0, color: '#3ac0e0' },
  { id: 'coins', name: 'Coins', cat: 'currency', base: 1, spoil: 0, color: '#f4d03f' },
];

export const RES_INDEX = {};
RESOURCES.forEach((r, i) => { RES_INDEX[r.id] = i; r.idx = i; });
export const NRES = RESOURCES.length;
export const FOOD_RES = RESOURCES.filter((r) => r.food > 0).map((r) => r.idx);
export const LUX_RES = RESOURCES.filter((r) => r.lux > 0).map((r) => r.idx);
export function R(id) {
  const i = RES_INDEX[id];
  if (i === undefined) throw new Error('Unknown resource ' + id);
  return i;
}

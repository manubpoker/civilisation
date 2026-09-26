// Generate a world headlessly and write a PNG preview.
import { World } from '../src/world/world.js';
import { terrainColor } from '../src/render/palette.js';
import { writePNG } from './png.mjs';
import fs from 'node:fs';

const seed = +(process.argv[2] || 1);
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const t0 = Date.now();
const w = new World(seed);
w.generate();
console.log('generated in', Date.now() - t0, 'ms');
const rgba = new Uint8Array(w.W * w.H * 4);
const u32 = new Uint32Array(rgba.buffer);
for (let i = 0; i < w.N; i++) u32[i] = terrainColor(w, i, 1);
const counts = {};
for (let i = 0; i < w.N; i++) counts[w.ter[i]] = (counts[w.ter[i]] || 0) + 1;
console.log('terrain counts', counts);
writePNG(new URL(`./out/world-${seed}.png`, import.meta.url).pathname, w.W, w.H, rgba);
console.log('wrote');

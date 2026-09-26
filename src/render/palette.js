// Pure colour functions (no DOM) used by the renderer and headless previews.
import { TERRAIN, T, D, DEPOSITS } from '../world/terrain.js';
import { hash2 } from '../util/rng.js';
import { RAIL, BRIDGE } from '../world/world.js';

export function rgba(r, g, b) {
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}
export function unpack(c) { return [c & 255, (c >> 8) & 255, (c >> 16) & 255]; }
export function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}
export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ROAD_COL = [null, [150, 128, 92], [158, 150, 138], [104, 104, 110], [58, 58, 64]];

// season: 0 spring, 1 summer, 2 autumn, 3 winter; seasonT in [0,1) progress
export function terrainColor(world, i, season = 1) {
  const W = world.W;
  const x = i % W, y = (i / W) | 0;
  const t = world.ter[i];
  const td = TERRAIN[t];
  const h = hash2(x, y, 3) - 0.5;
  const h2 = hash2(x, y, 17);
  let r = td.color[0] + h * td.v, g = td.color[1] + h * td.v, b = td.color[2] + h * td.v;
  const e = world.elev[i];
  if (td.water) {
    if (t === T.DEEP || t === T.SHALLOW) {
      const depth = Math.max(-0.35, Math.min(0, e));
      const k = 1 + depth * 1.3;
      r *= k; g *= k; b *= (0.9 + 0.1 * k);
      // coastal foam / lighter shallows
      if (t === T.SHALLOW && e > -0.02) { r += 14; g += 18; b += 12; }
    }
    if (h2 > 0.985) { r += 18; g += 20; b += 22; } // glints
  } else {
    // hill shading from elevation gradient
    const ex = x > 0 ? world.elev[i - 1] : e;
    const ey = y > 0 ? world.elev[i - W] : e;
    const shade = ((e - ex) + (e - ey)) * (t >= 15 ? 1400 : 900);
    const s = Math.max(-28, Math.min(28, shade));
    r += s; g += s; b += s * 0.8;
    // altitude brightening for mountains
    if (t === T.MOUNTAIN || t === T.PEAK) { const a = (e - 0.47) * 160; r += a; g += a; b += a; }
    const temp = world.temp[i];
    if (t === T.PEAK || (t === T.MOUNTAIN && e > 0.58)) {
      const k = Math.max(0, Math.min(1, (e - 0.6) * 7)) * Math.max(0, Math.min(1, 1.25 - temp));
      r += (240 - r) * k; g += (242 - g) * k; b += (248 - b) * k;
    }
    // seasons
    if (season === 3 && temp < 0.45 && t !== T.DESERT && t !== T.BEACH) {
      const k = Math.min(1, (0.45 - temp) * 4.5);
      r += (236 - r) * k; g += (240 - g) * k; b += (246 - b) * k;
    } else if (season === 2 && (t === T.GRASS || t === T.PLAINS || t === T.SAVANNA)) {
      r += 16; g -= 4; b -= 8;
    } else if (season === 1 && (t === T.GRASS || t === T.PLAINS)) {
      r += 6; g += 4;
    }
  }
  // deposits
  const d = world.dep[i];
  if (d) {
    const dc = DEPOSITS[d].color;
    if (d === D.TREE) {
      const temp = world.temp[i];
      let tr = 30 + h2 * 22, tg = 72 + h2 * 34, tb = 30 + h2 * 16;
      if (t === T.TAIGA || temp < 0.3) { tr = 26 + h2 * 14; tg = 60 + h2 * 22; tb = 42 + h2 * 14; }
      else if (t === T.JUNGLE) { tr = 22 + h2 * 20; tg = 84 + h2 * 36; tb = 36 + h2 * 20; }
      else if (season === 2) { tr = 120 + h2 * 80; tg = 70 + h2 * 50; tb = 24; }
      else if (season === 3) {
        if (temp < 0.45) { tr = 150 + h2 * 50; tg = 158 + h2 * 50; tb = 164 + h2 * 50; }
        else { tr = 80 + h2 * 20; tg = 70 + h2 * 20; tb = 50 + h2 * 16; }
      }
      const a = world.amt[i] / 100;
      const k = 0.55 + Math.min(1, a) * 0.45;
      r = r + (tr - r) * k; g = g + (tg - g) * k; b = b + (tb - b) * k;
    } else if (d === D.SAPLING) {
      r = r * 0.6 + 70 * 0.4; g = g * 0.6 + 140 * 0.4; b = b * 0.6 + 60 * 0.4;
    } else if (d === D.FISH) {
      if (h2 > 0.93) { r += 14; g += 16; b += 18; }
    } else {
      const k = d === D.STONE ? 0.55 : 0.72;
      // ore deposits appear as speckles
      if (d === D.STONE || h2 > 0.35) {
        r = r + (dc[0] - r) * k; g = g + (dc[1] - g) * k; b = b + (dc[2] - b) * k;
      }
    }
  }
  // roads / rails / bridges
  const rd = world.road[i];
  if (rd) {
    const lvl = rd & 7;
    if (rd & BRIDGE) { r = 120 + h * 10; g = 90 + h * 8; b = 60; }
    if (lvl) {
      const c = ROAD_COL[lvl];
      const k = lvl === 1 ? 0.55 : 0.9;
      r = r + (c[0] + h * 10 - r) * k; g = g + (c[1] + h * 10 - g) * k; b = b + (c[2] + h * 10 - b) * k;
      if (lvl === 4 && ((x + y) & 7) === 0) { r = 210; g = 190; b = 80; }
    }
    if (rd & RAIL) {
      const tie = ((x * 3 + y * 5) & 3) === 0;
      if (tie) { r = 92; g = 64; b = 40; } else { r = 70; g = 70; b = 78; }
    }
  }
  return rgba(r, g, b);
}

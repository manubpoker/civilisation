// Procedural pixel-art sprites for structures. Each style `kind` paints the
// footprint pixel by pixel; civ colours appear on flags, roofs and trims.
import { hexToRgb, rgba } from './palette.js';
import { hash2 } from '../util/rng.js';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function shade(c, k) { return [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)]; }
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

const cache = new Map();
function col(hex) { let c = cache.get(hex); if (!c) { c = hexToRgb(hex); cache.set(hex, c); } return c; }

// Returns { px: Uint32Array(w*h) (0 = transparent), lights: [[x,y],...] }
export function buildingSprite(b, civColor, season, tick) {
  const w = b.w, h = b.h;
  const out = new Uint32Array(w * h);
  const lights = [];
  const st = b.def.style;
  const wall = col(st.wall), roof = col(st.roof);
  const civ = civColor;
  const kind = st.kind;
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) out[y * w + x] = rgba(c[0], c[1], c[2]); };
  const n = (x, y, s = 0) => hash2(b.x + x, b.y + y, s + b.serial);
  const vary = (c, x, y, amt = 12) => { const d = (n(x, y) - 0.5) * amt; return [c[0] + d, c[1] + d, c[2] + d]; };
  const rect = (x0, y0, x1, y1, c, v = 8) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, vary(c, x, y, v)); };
  const outline = (c) => { for (let x = 0; x < w; x++) { set(x, 0, c); set(x, h - 1, c); } for (let y = 0; y < h; y++) { set(0, y, c); set(w - 1, y, c); } };
  const flag = () => { set(0, 0, civ); if (w > 3) set(1, 0, shade(civ, 0.8)); };
  const window_ = (x, y) => { set(x, y, [60, 50, 40]); lights.push([x, y]); };
  const roofTint = mixc(roof, civ, 0.18);
  const dark = shade(wall, 0.55);

  if (!b.built) {
    // construction site: scaffolding lattice filling from the bottom
    const done = Math.floor(h * b.progress);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const built = y >= h - done;
      if (built) set(x, y, vary(mixc(wall, [150, 120, 80], 0.35), x, y));
      else if ((x + y) % 3 === 0 || x === 0 || x === w - 1 || y === 0) set(x, y, [150, 110, 60]);
      else set(x, y, [120, 104, 80]);
    }
    set(0, 0, civ);
    return { px: out, lights };
  }

  switch (kind) {
    case 'camp': {
      rect(0, 0, w - 1, h - 1, [120, 96, 64], 20);
      const cx = w >> 1, cy = h >> 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - cx, y - cy); if (d > w / 2 - 0.2) out[y * w + x] = 0; }
      set(cx, cy, [255, 150, 40]); set(cx - 1, cy, [230, 90, 30]); set(cx + 1, cy, [200, 70, 20]); set(cx, cy - 1, [255, 210, 80]);
      lights.push([cx, cy], [cx, cy - 1]);
      set(0 + 1, 1, roofTint); set(w - 2, h - 2, roofTint); set(w - 2, 1, roof); set(1, h - 2, roof);
      set(cx, 0, civ);
      break;
    }
    case 'hut': {
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= w / 2 + 0.1) set(x, y, vary(d < w / 2 - 0.8 ? roofTint : shade(roof, 0.75), x, y, 16));
      }
      set(Math.round(cx), Math.round(cy), shade(roof, 0.6));
      set(Math.round(cx), h - 1, [50, 36, 24]);
      lights.push([Math.round(cx), h - 1]);
      break;
    }
    case 'house': case 'tallhouse': {
      const roofH = kind === 'house' ? Math.max(1, Math.ceil(h * 0.55)) : Math.max(1, Math.ceil(h * 0.3));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (y < roofH) {
          let c = roofTint;
          if (y === 0) c = shade(roofTint, 1.15);
          if (x === 0 || x === w - 1) c = shade(roofTint, 0.8);
          set(x, y, vary(c, x, y, 10));
        } else set(x, y, vary(wall, x, y, 8));
      }
      if (kind === 'tallhouse') for (let y = roofH; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) window_(x, y);
      else if (w >= 4) window_(w - 2, h - 1);
      set(1, h - 1, [70, 48, 30]);
      if (w >= 4 && n(0, 0, 3) > 0.5) set(w - 1, 0, [90, 80, 80]);
      flag();
      break;
    }
    case 'manor': {
      rect(0, 0, w - 1, h - 1, [80, 130, 70], 18); // garden
      rect(1, 1, w - 2, Math.floor(h * 0.55), roofTint, 10);
      rect(1, Math.floor(h * 0.55) + 1, w - 2, h - 3, wall, 6);
      for (let x = 2; x < w - 2; x += 2) window_(x, h - 3);
      set((w >> 1), h - 2, [140, 120, 90]); set((w >> 1), h - 1, [160, 140, 110]);
      flag();
      break;
    }
    case 'block': case 'tower': {
      const fl = kind === 'tower' ? mixc(wall, [200, 230, 255], 0.2) : wall;
      rect(0, 0, w - 1, h - 1, fl, 6);
      outline(shade(fl, 0.7));
      if (w >= 4) for (let y = 1; y < h - 1; y += (kind === 'tower' ? 1 : 2)) for (let x = 1; x < w - 1; x += 2) {
        if (n(x, y, 7) > 0.35) window_(x, y); else set(x, y, shade(fl, 0.85));
      }
      if (w <= 3) { set(1, 1, roofTint); lights.push([0, 0]); }
      set(0, 0, civ);
      if (kind === 'tower' && w > 4) set(w >> 1, 0, [220, 60, 60]);
      break;
    }
    case 'arcology': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ring = Math.min(x, y, w - 1 - x, h - 1 - y);
        const c = ring % 3 === 0 ? [70, 150, 90] : mixc(wall, roof, ring / 8);
        set(x, y, vary(c, x, y, 10));
        if (ring % 3 === 1 && n(x, y, 2) > 0.6) lights.push([x, y]);
      }
      set(w >> 1, h >> 1, [230, 250, 255]);
      flag();
      break;
    }
    case 'field': case 'vineyard': {
      const g = Math.min(1, b.growth || 0);
      // season colours: spring sprouts, summer green, autumn gold, winter soil
      const soil = [104, 78, 50];
      let crop;
      if (kind === 'vineyard') crop = season === 3 ? [90, 70, 50] : season === 2 ? [110, 30, 80] : [70, 120, 50];
      else if (st.roof === '#ecece2') crop = season === 3 ? soil : season === 2 ? [236, 236, 226] : [120, 160, 80];
      else crop = season === 0 ? [110, 160, 70] : season === 1 ? [90, 150, 50] : season === 2 ? [215, 185, 80] : [120, 96, 70];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const row = kind === 'vineyard' ? x % 2 === 0 : y % 2 === 0;
        const c = row ? mixc(soil, crop, 0.5 + g * 0.5) : shade(soil, 0.85);
        set(x, y, vary(c, x, y, 14));
      }
      // fence corners
      set(0, 0, [120, 90, 50]); set(w - 1, 0, [120, 90, 50]); set(0, h - 1, [120, 90, 50]); set(w - 1, h - 1, [120, 90, 50]);
      set(1, 0, civ);
      break;
    }
    case 'pasture': {
      const grass = season === 3 ? [180, 180, 170] : season === 2 ? [150, 150, 80] : [110, 160, 70];
      rect(0, 0, w - 1, h - 1, grass, 16);
      for (let x = 0; x < w; x++) { if (x % 2 === 0) { set(x, 0, [130, 96, 56]); set(x, h - 1, [130, 96, 56]); } }
      for (let y = 0; y < h; y++) { if (y % 2 === 0) { set(0, y, [130, 96, 56]); set(w - 1, y, [130, 96, 56]); } }
      set(1, 0, civ);
      break;
    }
    case 'mine': case 'quarry': case 'pit': {
      const base = kind === 'mine' ? [96, 84, 70] : wall;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ring = Math.min(x, y, w - 1 - x, h - 1 - y);
        set(x, y, vary(shade(base, 0.8 + ring * 0.12 * (kind === 'mine' ? -0.5 : 1)), x, y, 18));
      }
      if (kind === 'mine') { const cx = w >> 1, cy = h >> 1; set(cx, cy, [20, 16, 14]); set(cx - 1, cy, [30, 24, 20]); set(cx, cy - 1, [140, 100, 50]); set(cx - 1, cy - 1, [140, 100, 50]); lights.push([cx, cy - 1]); }
      set(0, 0, civ);
      break;
    }
    case 'derrick': {
      rect(0, 0, w - 1, h - 1, [80, 76, 70], 10);
      for (let k = 0; k < w; k++) { set(k, k, [40, 40, 40]); set(w - 1 - k, k, [40, 40, 40]); }
      set(w >> 1, 0, [200, 60, 40]); lights.push([w >> 1, 0]);
      break;
    }
    case 'workshop': case 'forge': case 'furnace': case 'kiln': {
      const roofH = Math.max(1, Math.ceil(h * 0.5));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, vary(y < roofH ? roofTint : wall, x, y, 10));
      const chim = w - 2;
      set(chim, 0, [50, 46, 44]);
      if (kind === 'forge' || kind === 'furnace') { set(1, h - 1, [255, 120, 30]); set(2, h - 1, [240, 80, 20]); lights.push([1, h - 1]); }
      if (kind === 'kiln') { const cx = w >> 1, cy = h >> 1; set(cx, cy, [230, 110, 40]); lights.push([cx, cy]); }
      if (w > 3) window_(w - 2, h - 1);
      flag();
      break;
    }
    case 'factory': case 'refinery': case 'plant': case 'reactor': {
      rect(0, 0, w - 1, h - 1, wall, 8);
      if (kind === 'factory') for (let y = 0; y < h - 2; y++) for (let x = 0; x < w; x++) if ((x + y) % 3 === 0) set(x, y, shade(roofTint, 1.1)); else if (y < h - 2) set(x, y, roofTint);
      if (kind === 'refinery') for (let k = 0; k < 3; k++) { const cx = 2 + k * 3, cy = 2 + (k % 2) * 2; for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) set(cx + x, cy + y, [200, 200, 205]); }
      if (kind === 'plant' || kind === 'reactor') {
        const towers = kind === 'reactor' ? 2 : 1;
        for (let k = 0; k < towers; k++) {
          const cx = 2 + k * 4, cy = 2;
          for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(cx + x, cy + y, x * x + y * y <= 1 ? [120, 120, 120] : [210, 210, 205]);
        }
        if (kind === 'reactor') { const cx = w - 3, cy = h - 3; for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 4) set(cx + x, cy + y, roof); }
      }
      set(w - 1, 0, [40, 40, 40]); set(w - 2, 0, [40, 40, 40]);
      for (let x = 1; x < w - 1; x += 2) window_(x, h - 1);
      flag();
      break;
    }
    case 'solar': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, (x % 3 === 2 || y % 2 === 1) ? [150, 150, 150] : vary(roof, x, y, 20));
      flag();
      break;
    }
    case 'temple': case 'cloister': {
      rect(0, 0, w - 1, h - 1, wall, 6);
      if (kind === 'temple') {
        for (let x = 0; x < w; x++) set(x, 0, roofTint);
        for (let x = 0; x < w; x += 2) for (let y = 1; y < h - 1; y++) set(x, y, shade(wall, 1.08));
        for (let x = 0; x < w; x++) set(x, h - 1, shade(wall, 0.8));
      } else {
        rect(2, 2, w - 3, h - 3, [90, 140, 80], 14);
        outline(roofTint);
        set(w >> 1, h >> 1, [150, 190, 220]);
      }
      set(w >> 1, 1, [240, 200, 60]); lights.push([w >> 1, 1]);
      flag();
      break;
    }
    case 'dome': case 'palace': case 'hall': case 'observatory': {
      rect(0, 0, w - 1, h - 1, wall, 6);
      outline(shade(wall, 0.75));
      if (kind === 'dome' || kind === 'observatory' || kind === 'palace') {
        const cx = (w - 1) / 2, cy = (h - 1) / 2, r = Math.min(w, h) * (kind === 'palace' ? 0.25 : 0.38);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r) set(x, y, vary(shade(roofTint, 1 + (cy - y) * 0.04), x, y, 6)); }
        if (kind === 'observatory') set(Math.round(cx), Math.round(cy - r + 1), [20, 20, 30]);
      } else {
        rect(1, 1, w - 2, Math.floor(h / 2), roofTint, 8);
      }
      if (kind === 'palace') { set(0, 0, roofTint); set(w - 1, 0, roofTint); set(0, h - 1, roofTint); set(w - 1, h - 1, roofTint); }
      for (let x = 2; x < w - 2; x += 2) window_(x, h - 2);
      set(w >> 1, h - 1, [70, 50, 30]);
      flag(); set(w >> 1, 0, civ);
      break;
    }
    case 'cathedral': {
      rect(0, 0, w - 1, h - 1, [0, 0, 0], 0);
      for (let i = 0; i < out.length; i++) out[i] = 0;
      const cx = w >> 1;
      rect(cx - 2, 0, cx + 2, h - 1, wall, 6);
      rect(0, Math.floor(h * 0.3), w - 1, Math.floor(h * 0.3) + 2, wall, 6);
      for (let y = 1; y < h - 1; y++) set(cx, y, roofTint);
      set(cx, 0, [240, 210, 80]);
      for (let y = 2; y < h - 1; y += 2) { window_(cx - 2, y); window_(cx + 2, y); }
      set(cx - 1, 0, civ);
      break;
    }
    case 'shrine': case 'monument': {
      const cx = w >> 1, cy = h >> 1;
      rect(0, 0, w - 1, h - 1, [150, 144, 132], 14);
      set(cx, cy, kind === 'shrine' ? [240, 190, 60] : [240, 236, 226]);
      set(cx, cy - 1, kind === 'shrine' ? [200, 140, 40] : [210, 206, 196]);
      lights.push([cx, cy]);
      set(0, 0, civ);
      break;
    }
    case 'grove': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        set(x, y, vary(edge ? [30, 80, 30] : n(x, y, 5) > 0.5 ? [40, 100, 40] : [80, 130, 60], x, y, 20));
      }
      const cx = w >> 1, cy = h >> 1;
      set(cx, cy, [200, 200, 190]); set(cx + 1, cy, [180, 180, 170]); set(cx, cy + 1, [180, 180, 170]);
      lights.push([cx, cy]);
      set(0, 0, civ);
      break;
    }
    case 'market': {
      rect(0, 0, w - 1, h - 1, [180, 160, 120], 14);
      const awn = [[210, 70, 60], [230, 190, 60], [70, 130, 200], [90, 170, 90], [200, 110, 180]];
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) set(x, y, awn[Math.floor(n(x, y, 9) * awn.length)]);
      flag();
      break;
    }
    case 'warehouse': case 'barracks': case 'station': {
      rect(0, 0, w - 1, h - 1, roofTint, 8);
      for (let x = 0; x < w; x++) if (x % 2 === 0) set(x, 0, shade(roofTint, 1.2));
      if (kind === 'barracks') { rect(1, Math.floor(h / 2), w - 2, h - 2, [150, 130, 100], 10); }
      if (kind === 'station') { for (let x = 0; x < w; x++) { set(x, h - 1, [70, 70, 78]); set(x, h - 2, [150, 140, 130]); } }
      outline(shade(roofTint, 0.7));
      for (let x = 2; x < w - 1; x += 3) window_(x, 1);
      flag();
      break;
    }
    case 'silo': {
      rect(0, 0, w - 1, h - 1, [140, 120, 90], 10);
      const r = w / 4;
      for (const [cx, cy] of [[r, r], [w - 1 - r, r], [r, h - 1 - r], [w - 1 - r, h - 1 - r]]) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) <= r) set(x, y, vary(wall, x, y, 10));
      }
      flag();
      break;
    }
    case 'windmill': {
      rect(0, 0, w - 1, h - 1, wall, 6);
      const cx = w >> 1, cy = h >> 1;
      const a = Math.floor(tick / 60) % 2;
      for (let k = -1; k <= 1; k++) { if (a) { set(cx + k, cy + k, roofTint); set(cx + k, cy - k, roofTint); } else { set(cx + k, cy, roofTint); set(cx, cy + k, roofTint); } }
      set(0, 0, civ);
      break;
    }
    case 'dock': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, vary((y % 2 === 0) ? [140, 104, 64] : [120, 88, 54], x, y, 10));
      for (let x = 0; x < w; x += 3) set(x, 0, roofTint);
      flag();
      break;
    }
    case 'wall': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const cren = (b.rotated ? y : x) % 2 === 0;
        set(x, y, vary(cren ? shade(wall, 1.1) : wall, x, y, 10));
      }
      set(0, 0, shade(civ, 0.9));
      break;
    }
    case 'castle': {
      rect(0, 0, w - 1, h - 1, [120, 110, 90], 12);
      for (let x = 0; x < w; x++) { set(x, 0, wall); set(x, 1, wall); set(x, h - 1, wall); set(x, h - 2, wall); }
      for (let y = 0; y < h; y++) { set(0, y, wall); set(1, y, wall); set(w - 1, y, wall); set(w - 2, y, wall); }
      for (const [x, y] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]]) rect(x, y, x + 2, y + 2, shade(wall, 1.15), 4);
      rect(w / 2 - 2 | 0, h / 2 - 2 | 0, w / 2 + 1 | 0, h / 2 + 1 | 0, roofTint, 6);
      set(w >> 1, h - 1, [60, 40, 20]);
      set(w >> 1, (h >> 1) - 2, civ); set((w >> 1) + 1, (h >> 1) - 2, civ);
      lights.push([w >> 1, h >> 1]);
      break;
    }
    case 'arena': {
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2));
        if (d <= 1) set(x, y, vary(d > 0.6 ? wall : [220, 200, 150], x, y, 10));
      }
      set(w >> 1, 0, civ);
      break;
    }
    case 'pyramid': {
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0.85 : 1.1) : (dy > 0 ? 0.75 : 1.2);
        const step = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, vary(shade(wall, face * (step % 2 === 0 ? 1 : 0.95)), x, y, 6));
      }
      set(Math.round(cx), Math.round(cy), [255, 230, 120]);
      break;
    }
    case 'airport': {
      rect(0, 0, w - 1, h - 1, [120, 140, 90], 10);
      for (let x = 0; x < w; x++) { set(x, h - 3, [60, 60, 66]); set(x, h - 2, x % 3 === 0 ? [230, 230, 230] : [60, 60, 66]); set(x, h - 1, [60, 60, 66]); }
      rect(1, 1, 5, 3, wall, 6);
      for (let x = 1; x < w; x += 3) lights.push([x, h - 2]);
      flag();
      break;
    }
    case 'spaceport': {
      rect(0, 0, w - 1, h - 1, [110, 110, 116], 8);
      const cx = w >> 1, cy = h >> 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) < w / 3) set(x, y, [70, 70, 76]);
      for (let y = cy - 3; y <= cy + 2; y++) set(cx, y, [240, 240, 245]);
      set(cx, cy - 4, roof); set(cx - 1, cy + 2, roof); set(cx + 1, cy + 2, roof);
      lights.push([cx, cy - 4]);
      flag();
      break;
    }
    default:
      rect(0, 0, w - 1, h - 1, wall, 8);
      flag();
  }
  // damage: scorch marks
  if (b.hp < b.maxHp * 0.5) for (let k = 0; k < w * h * 0.25; k++) {
    const x = Math.floor(n(k, 1, 11) * w), y = Math.floor(n(k, 2, 13) * h);
    if (out[y * w + x]) set(x, y, [50, 44, 40]);
  }
  if (b.banned) for (let k = 0; k < Math.min(w, h); k++) { set(k, k, [200, 30, 30]); }
  return { px: out, lights };
}

// Seeded random numbers and gradient noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Global simulation RNG (reseeded by the simulation at start).
let _r = mulberry32(12345);
export function seedRandom(s) { _r = mulberry32(s); }
export function rand() { return _r(); }
export function randInt(n) { return (_r() * n) | 0; }
export function randRange(a, b) { return a + _r() * (b - a); }
export function chance(p) { return _r() < p; }
export function pick(arr) { return arr[(_r() * arr.length) | 0]; }
export function gauss() {
  // Irwin–Hall approximation, cheap and good enough.
  return (_r() + _r() + _r() + _r() - 2) * 1.2247;
}
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (_r() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
export function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightFn(it));
  if (total <= 0) return null;
  let r = _r() * total;
  for (const it of items) {
    r -= Math.max(0, weightFn(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// 2D Perlin gradient noise with a seeded permutation table.
export class Noise2D {
  constructor(seed) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  static grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }
  noise(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const P = this.perm;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = P[P[xi] + yi], ab = P[P[xi] + yi + 1];
    const ba = P[P[xi + 1] + yi], bb = P[P[xi + 1] + yi + 1];
    const g = Noise2D.grad;
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.7071; // approx [-1,1]
  }
  fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f, y * f);
      n += a; a *= gain; f *= lac;
    }
    return s / n;
  }
  ridged(x, y, oct = 5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.noise(x * f, y * f));
      v *= v;
      s += a * v; n += a; a *= 0.5; f *= 2.05;
    }
    return s / n;
  }
}

// Integer hash for per-pixel deterministic variation.
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

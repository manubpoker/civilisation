// Uniform-grid spatial hash for people, rebuilt with a counting sort.
import { CFG } from '../config.js';

export class Spatial {
  constructor(cap) {
    this.SW = CFG.SW; this.SH = CFG.SH; this.S = CFG.SPATIAL;
    this.n = this.SW * this.SH;
    this.start = new Int32Array(this.n + 1);
    this.cnt = new Int32Array(this.n);
    this.items = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
    this.version = 0;
  }
  rebuild(P) {
    const cnt = this.cnt, start = this.start, S = this.S, SW = this.SW, SH = this.SH;
    cnt.fill(0);
    const hwm = P.hwm;
    for (let i = 0; i < hwm; i++) {
      if (P.civ[i] < 0) { this.cellOf[i] = -1; continue; }
      let cx = (P.x[i] / S) | 0, cy = (P.y[i] / S) | 0;
      if (cx < 0) cx = 0; else if (cx >= SW) cx = SW - 1;
      if (cy < 0) cy = 0; else if (cy >= SH) cy = SH - 1;
      const c = cy * SW + cx;
      this.cellOf[i] = c;
      cnt[c]++;
    }
    let acc = 0;
    for (let c = 0; c < this.n; c++) { start[c] = acc; acc += cnt[c]; cnt[c] = start[c]; }
    start[this.n] = acc;
    for (let i = 0; i < hwm; i++) {
      const c = this.cellOf[i];
      if (c < 0) continue;
      this.items[cnt[c]++] = i;
    }
    this.version++;
  }
  // Calls fn(i) for people in cells overlapping the circle; fn returning true stops.
  query(x, y, r, fn) {
    const S = this.S;
    const x0 = Math.max(0, ((x - r) / S) | 0), x1 = Math.min(this.SW - 1, ((x + r) / S) | 0);
    const y0 = Math.max(0, ((y - r) / S) | 0), y1 = Math.min(this.SH - 1, ((y + r) / S) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = cy * this.SW + cx;
      for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) if (fn(this.items[k])) return true;
    }
    return false;
  }
  countIn(x, y, r) {
    let n = 0;
    this.query(x, y, r, () => { n++; });
    return n;
  }
}

// Binary min-heap over integer ids with float priorities (typed-array backed).

export class MinHeap {
  constructor(cap = 1024) {
    this.ids = new Int32Array(cap);
    this.pri = new Float32Array(cap);
    this.size = 0;
  }
  clear() { this.size = 0; }
  grow() {
    const n = this.ids.length * 2;
    const a = new Int32Array(n); a.set(this.ids); this.ids = a;
    const b = new Float32Array(n); b.set(this.pri); this.pri = b;
  }
  push(id, p) {
    if (this.size >= this.ids.length) this.grow();
    let i = this.size++;
    const ids = this.ids, pri = this.pri;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pri[par] <= p) break;
      ids[i] = ids[par]; pri[i] = pri[par]; i = par;
    }
    ids[i] = id; pri[i] = p;
  }
  popPri() { return this.pri[0]; }
  pop() {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n], p = pri[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        ids[i] = ids[c]; pri[i] = pri[c]; i = c;
      }
      ids[i] = id; pri[i] = p;
    }
    return top;
  }
}

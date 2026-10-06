// Small 2D geometry helpers shared by the tile builders.

export interface Pt {
  x: number;
  y: number;
}

/** Sutherland–Hodgman clip of a ring to the square [0, size]². Keeps tiles from overlapping. */
export function clipRing(ring: Pt[], size: number): Pt[] {
  let out = ring;
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= size, (a, b) => lerpAt(a, b, (size - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= size, (a, b) => lerpAt(a, b, (size - a.y) / (b.y - a.y))],
  ];
  for (const [inside, cut] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const cIn = inside(cur), pIn = inside(prev);
      if (cIn) {
        if (!pIn) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pIn) {
        out.push(cut(prev, cur));
      }
    }
  }
  return out;
}

function lerpAt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Signed area of a flat [x0, z0, x1, z1, …] ring. */
export function signedArea(flat: number[]): number {
  let a = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return a / 2;
}

export function pointInRing(x: number, z: number, flat: number[]): boolean {
  let inside = false;
  for (let i = 0, n = flat.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = flat[i], zi = flat[i + 1], xj = flat[j], zj = flat[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Uniform grid of polygons for fast "is this point inside any building?" checks. */
export class PolygonGrid {
  private cells = new Map<string, number[][]>();
  readonly rings: number[][] = [];
  constructor(private cell = 40) {}

  /** Pack all rings for transfer: flat coords + start offsets. */
  pack(): { coords: Float32Array; offsets: Uint32Array } {
    const offsets = new Uint32Array(this.rings.length + 1);
    let n = 0;
    this.rings.forEach((r, i) => {
      offsets[i] = n;
      n += r.length;
    });
    offsets[this.rings.length] = n;
    const coords = new Float32Array(n);
    this.rings.forEach((r, i) => coords.set(r, offsets[i]));
    return { coords, offsets };
  }

  static unpack(coords: Float32Array, offsets: Uint32Array): PolygonGrid {
    const g = new PolygonGrid();
    for (let i = 0; i + 1 < offsets.length; i++) g.add(Array.from(coords.subarray(offsets[i], offsets[i + 1])));
    return g;
  }

  add(flat: number[]) {
    this.rings.push(flat);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      minX = Math.min(minX, flat[i]); maxX = Math.max(maxX, flat[i]);
      minZ = Math.min(minZ, flat[i + 1]); maxZ = Math.max(maxZ, flat[i + 1]);
    }
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
        const k = `${cx},${cz}`;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(flat);
      }
    }
  }

  contains(x: number, z: number, pad = 0): boolean {
    const probes = pad > 0 ? [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]] : [[0, 0]];
    for (const [dx, dz] of probes) {
      const list = this.cells.get(`${Math.floor((x + dx) / this.cell)},${Math.floor((z + dz) / this.cell)}`);
      if (list) for (const ring of list) if (pointInRing(x + dx, z + dz, ring)) return true;
    }
    return false;
  }
}

/** Growable float buffer that avoids huge intermediate JS arrays. */
export class FloatBuf {
  arr: Float32Array;
  len = 0;
  constructor(cap = 4096) {
    this.arr = new Float32Array(cap);
  }
  push(...v: number[]) {
    if (this.len + v.length > this.arr.length) {
      const next = new Float32Array(Math.max(this.arr.length * 2, this.len + v.length));
      next.set(this.arr);
      this.arr = next;
    }
    for (let i = 0; i < v.length; i++) this.arr[this.len++] = v[i];
  }
  result(): Float32Array {
    return this.arr.slice(0, this.len);
  }
}

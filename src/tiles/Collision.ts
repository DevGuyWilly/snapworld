import type * as THREE from 'three';

const CELL = 12;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const TREE_RADIUS = 0.42; // trunk radius per unit of tree scale

/**
 * Per-tile collision data: building walls as vertical segments (with their height range)
 * and tree trunks as circles, bucketed in a uniform grid.
 */
export class TileCollision {
  private segCells = new Map<number, number[]>();
  private treeCells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private query = 0;

  /** `walls` stride 6 (ax, az, bx, bz, minH, h); `trees` stride 4 (x, z, scale, code). */
  constructor(private walls: Float32Array, private trees: Float32Array) {
    this.stamp = new Uint32Array(walls.length / 6);
    for (let i = 0; i < walls.length; i += 6) {
      const minX = Math.min(walls[i], walls[i + 2]), maxX = Math.max(walls[i], walls[i + 2]);
      const minZ = Math.min(walls[i + 1], walls[i + 3]), maxZ = Math.max(walls[i + 1], walls[i + 3]);
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) push(this.segCells, key(cx, cz), i);
    }
    for (let i = 0; i < trees.length; i += 4) push(this.treeCells, key(Math.floor(trees[i] / CELL), Math.floor(trees[i + 1] / CELL)), i);
  }

  /** Calls fn(index) once for each wall whose cell overlaps the box. */
  private eachWall(minX: number, minZ: number, maxX: number, maxZ: number, fn: (i: number) => void) {
    const q = ++this.query;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.segCells.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i / 6] === q) continue;
          this.stamp[i / 6] = q;
          fn(i);
        }
      }
    }
  }

  /**
   * Pushes a vertical capsule (feet at p.y, given height) out of walls and trunks.
   * Accumulates the total push into `push` so callers can cancel velocity into the wall.
   */
  pushOut(p: THREE.Vector3, radius: number, height: number, push: { x: number; z: number }) {
    const w = this.walls;
    this.eachWall(p.x - radius, p.z - radius, p.x + radius, p.z + radius, (i) => {
      const minH = w[i + 4], h = w[i + 5];
      if (minH > p.y + height || h < p.y + 0.3) return; // walk under overhangs, ignore tiny ledges
      const ax = w[i], az = w[i + 1], bx = w[i + 2], bz = w[i + 3];
      const sx = bx - ax, sz = bz - az;
      const len2 = sx * sx + sz * sz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * sx + (p.z - az) * sz) / len2)) : 0;
      const qx = ax + sx * t, qz = az + sz * t;
      let dx = p.x - qx, dz = p.z - qz;
      let d = Math.hypot(dx, dz);
      if (d >= radius) return;
      if (d < 1e-5) {
        // Exactly on the wall: push along the wall's normal.
        dx = -sz; dz = sx; d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d; d = 0;
      } else {
        dx /= d; dz /= d;
      }
      const k = radius - d;
      p.x += dx * k; p.z += dz * k;
      push.x += dx * k; push.z += dz * k;
    });

    if (p.y > 3) return; // jumping never clears a tree, but keeps the lookup cheap
    const tr = this.trees;
    for (let cx = Math.floor((p.x - radius - 1) / CELL); cx <= Math.floor((p.x + radius + 1) / CELL); cx++) {
      for (let cz = Math.floor((p.z - radius - 1) / CELL); cz <= Math.floor((p.z + radius + 1) / CELL); cz++) {
        const list = this.treeCells.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const r = radius + tr[i + 2] * TREE_RADIUS;
          const dx = p.x - tr[i], dz = p.z - tr[i + 1];
          const d = Math.hypot(dx, dz);
          if (d >= r || d < 1e-5) continue;
          const k = r - d;
          p.x += (dx / d) * k; p.z += (dz / d) * k;
          push.x += (dx / d) * k; push.z += (dz / d) * k;
        }
      }
    }
  }

  /** Distance along a normalised ray to the first wall it hits, or `max` if none. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): number {
    let best = max;
    const ex = o.x + d.x * max, ez = o.z + d.z * max;
    const w = this.walls;
    this.eachWall(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), (i) => {
      const ax = w[i], az = w[i + 1], sx = w[i + 2] - ax, sz = w[i + 3] - az;
      const denom = d.x * sz - d.z * sx;
      if (Math.abs(denom) < 1e-9) return;
      const qx = ax - o.x, qz = az - o.z;
      const t = (qx * sz - qz * sx) / denom;
      const u = (qx * d.z - qz * d.x) / denom;
      if (t < 0 || t >= best || u < 0 || u > 1) return;
      const y = o.y + d.y * t;
      if (y >= w[i + 4] && y <= w[i + 5]) best = t;
    });
    return best;
  }
}

function push(map: Map<number, number[]>, k: number, v: number) {
  let list = map.get(k);
  if (!list) map.set(k, (list = []));
  list.push(v);
}

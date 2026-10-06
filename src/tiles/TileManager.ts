import * as THREE from 'three';
import { fromLocal, tileOf, type Origin } from '../geo/mercator';
import { createBuildingMaterial, createGroundMaterial } from '../render/materials';
import { buildTrees, disposeTrees } from '../render/Trees';
import { PolygonGrid } from './builders/geom';
import { TileCollision } from './Collision';
import type { MeshArrays, Poi, TileRequest, TileResult } from './types';

const Z = 14; // highest zoom with full detail in OpenMapTiles
const MAX_CACHED = 40;
const GROUND_ORDER = { base: 0, green: 1, water: 2, roads: 3 } as const;

interface Tile {
  key: string;
  x: number;
  y: number;
  group?: THREE.Group;
  pois: Poi[];
  footprints?: PolygonGrid;
  collision?: TileCollision;
  state: 'loading' | 'ready' | 'error';
  lastUsed: number;
}

/** Streams z14 tiles around a point, builds meshes from worker output, and evicts far tiles. */
export class TileManager extends EventTarget {
  readonly root = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private workers: Worker[] = [];
  private pending = new Map<number, (r: TileResult) => void>();
  private nextId = 1;
  private origin: Origin | null = null;
  private generation = 0;
  private buildingMat = createBuildingMaterial();
  private groundMat = createGroundMaterial();

  constructor(private urlTemplate: string) {
    super();
    const count = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<TileResult>) => {
        this.pending.get(e.data.id)?.(e.data);
        this.pending.delete(e.data.id);
      };
      this.workers.push(w);
    }
  }

  /** Rebuild everything relative to a new origin (first fix, search, or after travelling far). */
  setOrigin(origin: Origin) {
    this.origin = origin;
    this.generation++;
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
  }

  getOrigin() {
    return this.origin;
  }

  /** Call every frame (cheap) with the local point the camera looks at. */
  update(x: number, z: number, radius: number) {
    if (!this.origin) return;
    const center = tileOf(fromLocal(this.origin, x, z), Z);
    const now = performance.now();
    const wanted: { x: number; y: number; d: number }[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) wanted.push({ x: center.x + dx, y: center.y + dy, d: dx * dx + dy * dy });
    }
    wanted.sort((a, b) => a.d - b.d); // nearest first
    for (const w of wanted) {
      const key = `${w.x}/${w.y}`;
      const t = this.tiles.get(key);
      if (t) {
        t.lastUsed = now;
        if (t.group) t.group.visible = true;
      } else {
        this.load(w.x, w.y, key);
      }
    }
    // Hide tiles outside the ring, evict the least recently used beyond the cache size.
    for (const t of this.tiles.values()) {
      if (Math.abs(t.x - center.x) > radius || Math.abs(t.y - center.y) > radius) {
        if (t.group) t.group.visible = false;
      }
    }
    if (this.tiles.size > MAX_CACHED) {
      const old = [...this.tiles.values()].sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of old.slice(0, this.tiles.size - MAX_CACHED)) {
        if (t.state === 'loading') continue;
        this.disposeTile(t);
        this.tiles.delete(t.key);
      }
    }
  }

  /** Named places from all visible tiles. */
  visiblePois(): Poi[] {
    const out: Poi[] = [];
    for (const t of this.tiles.values()) if (t.group?.visible) out.push(...t.pois);
    return out;
  }

  /** True if a circle of radius `r` at (x, z) overlaps a building in any loaded tile. */
  hitsBuilding(x: number, z: number, r: number): boolean {
    for (const t of this.tiles.values()) if (t.group?.visible && t.footprints?.contains(x, z, r)) return true;
    return false;
  }

  /** Push a vertical capsule out of walls and trees in every loaded tile; returns the total push. */
  pushOut(p: THREE.Vector3, radius: number, height: number): { x: number; z: number } {
    const push = { x: 0, z: 0 };
    for (const t of this.tiles.values()) if (t.group?.visible) t.collision?.pushOut(p, radius, height, push);
    return push;
  }

  /** Distance to the first building wall along a normalised ray (or `max`). */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): number {
    let best = max;
    for (const t of this.tiles.values()) if (t.group?.visible && t.collision) best = Math.min(best, t.collision.raycast(o, d, best));
    return best;
  }

  get loadingCount() {
    let n = 0;
    for (const t of this.tiles.values()) if (t.state === 'loading') n++;
    return n;
  }

  private load(x: number, y: number, key: string) {
    const tile: Tile = { key, x, y, pois: [], state: 'loading', lastUsed: performance.now() };
    this.tiles.set(key, tile);
    const gen = this.generation;
    const req: TileRequest = {
      id: this.nextId++, z: Z, x, y, origin: this.origin!,
      url: this.urlTemplate.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y)),
    };
    this.pending.set(req.id, (res) => {
      if (gen !== this.generation || this.tiles.get(key) !== tile) return; // stale
      if (res.error) {
        console.warn(res.error);
        tile.state = 'error';
        setTimeout(() => this.tiles.get(key) === tile && this.tiles.delete(key), 5000); // retry later
        return;
      }
      tile.group = this.buildGroup(res);
      tile.pois = res.pois ?? [];
      if (res.footprints) tile.footprints = PolygonGrid.unpack(res.footprints.coords, res.footprints.offsets);
      tile.collision = new TileCollision(res.walls ?? new Float32Array(0), res.trees ?? new Float32Array(0));
      tile.state = 'ready';
      this.root.add(tile.group);
      this.dispatchEvent(new Event('tileloaded'));
    });
    this.workers[req.id % this.workers.length].postMessage(req);
  }

  private buildGroup(res: TileResult): THREE.Group {
    const group = new THREE.Group();
    if (res.buildings && res.buildings.position.length) {
      const mesh = new THREE.Mesh(toGeometry(res.buildings), this.buildingMat);
      mesh.renderOrder = 10;
      group.add(mesh);
    }
    if (res.ground) {
      for (const [name, arrays] of Object.entries(res.ground) as [keyof typeof GROUND_ORDER, MeshArrays][]) {
        if (!arrays.position.length) continue;
        const mesh = new THREE.Mesh(toGeometry(arrays), this.groundMat);
        mesh.renderOrder = GROUND_ORDER[name];
        group.add(mesh);
      }
    }
    if (res.trees) group.add(buildTrees(res.trees));
    return group;
  }

  private disposeTile(t: Tile) {
    if (!t.group) return;
    this.root.remove(t.group);
    t.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
    });
    t.group.children.forEach((c) => c instanceof THREE.Group && disposeTrees(c));
  }
}

function toGeometry(a: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  if (a.normal) {
    g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  } else {
    const up = new Float32Array(a.position.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  }
  if (a.wall) g.setAttribute('wall', new THREE.BufferAttribute(a.wall, 3));
  g.computeBoundingSphere();
  return g;
}

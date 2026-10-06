import { pointInRing, rng, FloatBuf, type PolygonGrid } from './geom';
import type { GreenArea, RoadLine } from './ground';
import { palette } from '../../render/palette';

// Trees per square metre for each kind of green area.
const DENSITY: Record<string, number> = {
  wood: 1 / 90, forest: 1 / 90, wetland: 1 / 260,
  park: 1 / 200, cemetery: 1 / 260, grass: 1 / 420, golf_course: 1 / 700,
};
const STREET_CLASSES = new Set(['minor', 'tertiary', 'secondary', 'primary', 'trunk']);
const MAX_TREES = 5000;

/**
 * Seeded procedural placement so a given place always gets the same trees.
 * Bounds are the tile's local extent; trees outside it belong to the neighbour tile.
 */
export function placeTrees(
  seed: number,
  greens: GreenArea[],
  roads: RoadLine[],
  buildings: PolygonGrid,
  bounds: { x0: number; z0: number; x1: number; z1: number },
): Float32Array {
  const rand = rng(seed);
  const out = new FloatBuf(4096);
  let count = 0;
  const inside = (x: number, z: number) => x >= bounds.x0 && x < bounds.x1 && z >= bounds.z0 && z < bounds.z1;
  const add = (x: number, z: number, pineChance: number) => {
    const pine = rand() < pineChance;
    const colours = pine ? palette.treePine.length : palette.treeRound.length;
    out.push(x, z, 0.75 + rand() * 0.6, (pine ? 16 : 0) + Math.floor(rand() * colours));
    count++;
  };

  for (const g of greens) {
    const density = DENSITY[g.kind];
    if (!density) continue;
    const outer = g.rings[0];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
    }
    const tries = Math.min(4000, Math.round((maxX - minX) * (maxZ - minZ) * density));
    const pineChance = g.kind === 'wood' || g.kind === 'forest' ? 0.35 : 0.15;
    for (let t = 0; t < tries && count < MAX_TREES; t++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (!inside(x, z) || !pointInRing(x, z, outer)) continue;
      if (g.rings.slice(1).some((h) => pointInRing(x, z, h))) continue;
      if (buildings.contains(x, z, 2)) continue;
      add(x, z, pineChance);
    }
  }

  // Street trees
  for (const road of roads) {
    if (!STREET_CLASSES.has(road.cls)) continue;
    const off = road.width / 2 + 2.2;
    const chance = road.cls === 'minor' ? 0.2 : 0.4;
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const ax = road.pts[i], az = road.pts[i + 1], bx = road.pts[i + 2], bz = road.pts[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = 6; d < len - 4 && count < MAX_TREES; d += 11) {
        for (const side of [1, -1]) {
          if (rand() > chance) continue;
          const x = ax + ((bx - ax) * d) / len + nx * off * side;
          const z = az + ((bz - az) * d) / len + nz * off * side;
          if (inside(x, z) && !buildings.contains(x, z, 1.5)) add(x, z, 0.1);
        }
      }
    }
  }
  return out.result();
}

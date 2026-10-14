import { categoryOf, type CategoryId } from '../../labels/categories';
import type { PolygonGrid } from './geom';
import type { Poi, Sign } from '../types';

const SIGN_CATEGORIES = new Set<CategoryId>(['cafe', 'food', 'bar', 'shop', 'hotel']);
const SEARCH = 14; // metres from the POI to look for a shopfront wall
const CELL = 16;
const GAP = 0.4; // clear space between neighbouring boards
// Rough board width from the name (matches Signs.ts: ~0.25 m per character plus padding).
const estWidth = (name: string, maxW: number) => Math.min(maxW, Math.max(2.1, name.length * 0.25 + 0.7));
const SIGN_Y = 3.2; // centre height: just above ground-floor shop windows

/**
 * Pins each named shop/café/bar/restaurant/hotel to the closest street-facing wall of its
 * building. A wall counts as street-facing if the space a few metres in front of it is not
 * another building (which rules out party walls between terraced shops).
 */
export function placeSigns(pois: Poi[], walls: Float32Array, normals: Float32Array, buildings: PolygonGrid): Sign[] {
  const grid = new Map<string, number[]>();
  for (let w = 0; w < walls.length / 6; w++) {
    const i = w * 6;
    const len = Math.hypot(walls[i + 2] - walls[i], walls[i + 3] - walls[i + 1]);
    if (walls[i + 4] > 1 || walls[i + 5] < 3.8 || len < 2.6) continue; // needs a ground-floor frontage
    const mx = (walls[i] + walls[i + 2]) / 2, mz = (walls[i + 1] + walls[i + 3]) / 2;
    const k = `${Math.floor(mx / CELL)},${Math.floor(mz / CELL)}`;
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(w);
  }

  const signs: Sign[] = [];
  pois.forEach((poi, poiIndex) => {
    const cat = categoryOf(poi.cls, poi.sub);
    if (!cat || !SIGN_CATEGORIES.has(cat)) return;
    let best: { score: number; w: number; t: number } | null = null;
    const r = Math.ceil(SEARCH / CELL) + 1;
    const cx0 = Math.floor(poi.x / CELL), cz0 = Math.floor(poi.z / CELL);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        for (const w of grid.get(`${cx},${cz}`) ?? []) {
          const i = w * 6;
          const ax = walls[i], az = walls[i + 1], sx = walls[i + 2] - ax, sz = walls[i + 3] - az;
          const len2 = sx * sx + sz * sz;
          const t = Math.max(0, Math.min(1, ((poi.x - ax) * sx + (poi.z - az) * sz) / len2));
          const d = Math.hypot(poi.x - (ax + sx * t), poi.z - (az + sz * t));
          if (d > SEARCH || (best && d >= best.score)) continue;
          const nx = normals[w * 2], nz = normals[w * 2 + 1];
          const qx = ax + sx * t, qz = az + sz * t;
          if (buildings.contains(qx + nx * 3, qz + nz * 3)) continue; // faces another building
          best = { score: d, w, t };
        }
      }
    }
    if (!best) return;

    const i = best.w * 6;
    const ax = walls[i], az = walls[i + 1], sx = walls[i + 2] - ax, sz = walls[i + 3] - az;
    const len = Math.hypot(sx, sz);
    // Keep the board on the wall: centre it at least half its max width from either end.
    const maxW = Math.min(len - 0.6, 7.5);
    const half = maxW / 2 / len;
    const t = Math.min(1 - half, Math.max(half, best.t));
    const nx = normals[best.w * 2], nz = normals[best.w * 2 + 1];
    const x = ax + sx * t + nx * 0.06, z = az + sz * t + nz * 0.06;
    const w = estWidth(poi.name, maxW);
    // Boards on (roughly) the same frontage must not overlap; ones on other walls can be close.
    if (signs.some((s) => s.nx * nx + s.nz * nz > 0.7 && Math.hypot(s.x - x, s.z - z) < (estWidth(pois[s.poi].name, s.maxW) + w) / 2 + GAP)) return;
    signs.push({ poi: poiIndex, cat, x, y: SIGN_Y, z, nx, nz, maxW });
  });
  return signs;
}

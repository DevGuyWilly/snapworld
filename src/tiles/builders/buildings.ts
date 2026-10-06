import earcut from 'earcut';
import { classifyRings, type VectorTileLayer } from '@mapbox/vector-tile';
import { clipRing, signedArea, hash2, FloatBuf, PolygonGrid, type Pt } from './geom';
import { palette, linearRGB } from '../../render/palette';
import type { MeshArrays, Projector } from '../types';

const WALLS = palette.walls.map(linearRGB);
const ROOFS = palette.roofs.map(linearRGB);

/** Extrudes building footprints into walls + flat roofs. Also fills `footprints` for tree avoidance. */
export function buildBuildings(layer: VectorTileLayer | undefined, project: Projector, footprints: PolygonGrid): MeshArrays {
  const pos = new FloatBuf(1 << 18), nor = new FloatBuf(1 << 18), col = new FloatBuf(1 << 18), wall = new FloatBuf(1 << 18);
  if (!layer) return { position: pos.result(), normal: nor.result(), color: col.result(), wall: wall.result() };
  const extent = layer.extent;

  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    const tagged = Number(f.properties.render_height) || 0;
    const minH = Number(f.properties.render_min_height) || 0;

    for (const polygon of classifyRings(f.loadGeometry())) {
      // Clip to the tile so neighbouring tiles never draw the same building twice.
      const rings: Pt[][] = [];
      for (let r = 0; r < polygon.length; r++) {
        const c = clipRing(polygon[r], extent);
        if (c.length >= 3) rings.push(c);
        else if (r === 0) break;
      }
      if (rings.length === 0) continue;

      const flats = rings.map((ring) => {
        const out: number[] = [];
        for (const p of ring) out.push(...project(p.x, p.y));
        return out;
      });
      const outerArea = Math.abs(signedArea(flats[0]));
      if (outerArea < 4) continue;

      const seed = hash2(flats[0][0], flats[0][1]);
      // OSM often lacks heights; estimate a plausible one from footprint size.
      let h = tagged;
      if (h < 3) h = outerArea < 40 ? 3 + seed * 1.5 : 7 + seed * 9 + Math.min(outerArea / 400, 6);
      if (h <= minH + 0.5) continue;

      footprints.add(flats[0]);
      const wc = WALLS[Math.floor(seed * WALLS.length)];
      const rc = ROOFS[Math.floor(hash2(seed, 3.1) * ROOFS.length)];

      // Walls
      flats.forEach((flat, r) => {
        const ring = rings[r];
        const isHole = r > 0;
        const sign = Math.sign(signedArea(flat)) * (isHole ? -1 : 1);
        let u = 0;
        for (let k = 0, n = ring.length; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n];
          const ax = flat[k * 2], az = flat[k * 2 + 1];
          const bx = flat[((k + 1) % n) * 2], bz = flat[((k + 1) % n) * 2 + 1];
          const dx = bx - ax, dz = bz - az;
          const len = Math.hypot(dx, dz);
          if (len < 0.05) continue;
          // Skip artificial walls created by clipping along the tile edge.
          const E = 1e-6;
          if ((Math.abs(a.x - b.x) < E && (a.x <= E || a.x >= extent - E)) || (Math.abs(a.y - b.y) < E && (a.y <= E || a.y >= extent - E))) {
            u += len;
            continue;
          }
          let nx = sign > 0 ? dz : -dz, nz = sign > 0 ? -dx : dx;
          nx /= len; nz /= len;
          const flip = nx * -dz + nz * dx < 0; // face winding must agree with the outward normal
          const A = [ax, minH, az, u, minH], B = [bx, minH, bz, u + len, minH];
          const C = [bx, h, bz, u + len, h], D = [ax, h, az, u, h];
          const tris = flip ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
          for (const v of tris) {
            pos.push(v[0], v[1], v[2]);
            nor.push(nx, 0, nz);
            col.push(wc[0], wc[1], wc[2]);
            wall.push(v[3], v[4], seed);
          }
          u += len;
        }
      });

      // Roof
      const all: number[] = [], holes: number[] = [];
      flats.forEach((flat, r) => {
        if (r > 0) holes.push(all.length / 2);
        all.push(...flat);
      });
      const idx = earcut(all, holes.length ? holes : undefined);
      for (let t = 0; t < idx.length; t += 3) {
        let ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
        const cy = (all[ib * 2 + 1] - all[ia * 2 + 1]) * (all[ic * 2] - all[ia * 2]) - (all[ib * 2] - all[ia * 2]) * (all[ic * 2 + 1] - all[ia * 2 + 1]);
        if (cy < 0) [ib, ic] = [ic, ib];
        for (const v of [ia, ib, ic]) {
          pos.push(all[v * 2], h, all[v * 2 + 1]);
          nor.push(0, 1, 0);
          col.push(rc[0], rc[1], rc[2]);
          wall.push(-1, h, seed);
        }
      }
    }
  }
  return { position: pos.result(), normal: nor.result(), color: col.result(), wall: wall.result() };
}

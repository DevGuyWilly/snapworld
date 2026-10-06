import earcut from 'earcut';
import { classifyRings, type VectorTile } from '@mapbox/vector-tile';
import { clipRing, FloatBuf, type Pt } from './geom';
import { palette, linearRGB } from '../../render/palette';
import type { MeshArrays, Projector } from '../types';

type RGB = [number, number, number];

const GREEN: Record<string, RGB> = {
  grass: linearRGB(palette.grass),
  park: linearRGB(palette.grass),
  wood: linearRGB(palette.wood),
  forest: linearRGB(palette.wood),
  pitch: linearRGB(palette.pitch),
  cemetery: linearRGB(palette.grass),
  playground: linearRGB(palette.pitch),
  golf_course: linearRGB(palette.grass),
  stadium: linearRGB(palette.pitch),
  wetland: linearRGB(palette.wood),
  farmland: linearRGB(palette.grass),
};

const ROAD_WIDTH: Record<string, number> = {
  motorway: 16, trunk: 14, primary: 12, secondary: 11, tertiary: 9, minor: 7,
  service: 4.5, track: 3, path: 2.4, raceway: 6, busway: 7, pier: 4,
};

/** A green polygon kept for tree placement: flat ring list + density class. */
export interface GreenArea {
  rings: number[][];
  kind: string;
}

/** A road centreline kept for street-tree placement. */
export interface RoadLine {
  pts: number[];
  width: number;
  cls: string;
}

export interface GroundOut {
  base: MeshArrays;
  green: MeshArrays;
  water: MeshArrays;
  roads: MeshArrays;
  greenAreas: GreenArea[];
  roadLines: RoadLine[];
}

export function buildGround(tile: VectorTile, project: Projector, extent: number): GroundOut {
  const layers = { base: new Layer(), green: new Layer(), water: new Layer(), roads: new Layer() };
  const greenAreas: GreenArea[] = [];
  const roadLines: RoadLine[] = [];

  // Base square covering the whole tile.
  const [x0, z0] = project(0, 0), [x1, z1] = project(extent, extent);
  layers.base.quad([x0, z0], [x1, z0], [x1, z1], [x0, z1], linearRGB(palette.ground));

  // Green areas
  for (const name of ['landcover', 'landuse', 'park']) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const cls = name === 'park' ? 'park' : String(f.properties.class);
      const color = GREEN[cls];
      if (!color) continue;
      for (const poly of classifyRings(f.loadGeometry())) {
        const rings = fillPolygon(layers.green, poly, project, extent, color);
        if (rings) greenAreas.push({ rings, kind: cls });
      }
    }
  }

  // Water
  const water = tile.layers.water;
  const waterColor = linearRGB(palette.water);
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      if (f.type === 3) for (const poly of classifyRings(f.loadGeometry())) fillPolygon(layers.water, poly, project, extent, waterColor);
    }
  }
  const waterway = tile.layers.waterway;
  if (waterway) {
    for (let i = 0; i < waterway.length; i++) {
      const f = waterway.feature(i);
      const w = f.properties.class === 'river' ? 12 : f.properties.class === 'canal' ? 10 : 3;
      if (f.type === 2) for (const line of f.loadGeometry()) layers.water.ribbon(projectLine(line, project), w, waterColor);
    }
  }

  // Roads
  const roads = tile.layers.transportation;
  if (roads) {
    for (let i = 0; i < roads.length; i++) {
      const f = roads.feature(i);
      const cls = String(f.properties.class);
      if (cls === 'rail' || cls === 'transit' || f.properties.brunnel === 'tunnel') continue;
      if (f.type === 3) {
        const c = linearRGB(cls === 'path' ? palette.pedestrian : palette.road);
        for (const poly of classifyRings(f.loadGeometry())) fillPolygon(layers.roads, poly, project, extent, c);
        continue;
      }
      if (f.type !== 2) continue;
      const width = ROAD_WIDTH[cls] ?? 6;
      const major = cls === 'motorway' || cls === 'trunk' || cls === 'primary';
      const color = linearRGB(cls === 'path' || cls === 'track' ? palette.path : major ? palette.roadMajor : palette.road);
      for (const line of f.loadGeometry()) {
        const pts = projectLine(line, project);
        layers.roads.ribbon(pts, width, color);
        roadLines.push({ pts, width, cls });
      }
    }
  }

  return {
    base: layers.base.result(),
    green: layers.green.result(),
    water: layers.water.result(),
    roads: layers.roads.result(),
    greenAreas,
    roadLines,
  };
}

function projectLine(line: Pt[], project: Projector): number[] {
  const out: number[] = [];
  for (const p of line) out.push(...project(p.x, p.y));
  return out;
}

function fillPolygon(layer: Layer, poly: Pt[][], project: Projector, extent: number, color: RGB): number[][] | null {
  const rings: number[][] = [];
  for (let r = 0; r < poly.length; r++) {
    const c = clipRing(poly[r], extent);
    if (c.length < 3) {
      if (r === 0) return null;
      continue;
    }
    rings.push(projectLine(c, project));
  }
  const all: number[] = [], holes: number[] = [];
  rings.forEach((ring, r) => {
    if (r > 0) holes.push(all.length / 2);
    all.push(...ring);
  });
  const idx = earcut(all, holes.length ? holes : undefined);
  for (let t = 0; t < idx.length; t += 3) layer.tri(all, idx[t], idx[t + 1], idx[t + 2], color);
  return rings;
}

/** Flat (y = 0) triangle soup with per-vertex colour. */
class Layer {
  pos = new FloatBuf(1 << 15);
  col = new FloatBuf(1 << 15);

  private v(x: number, z: number, c: RGB) {
    this.pos.push(x, 0, z);
    this.col.push(c[0], c[1], c[2]);
  }

  /** Emits a triangle facing up regardless of the input winding. */
  tri(flat: number[], a: number, b: number, c: number, color: RGB) {
    const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx = flat[c * 2], cz = flat[c * 2 + 1];
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0;
    this.v(ax, az, color);
    if (up) { this.v(bx, bz, color); this.v(cx, cz, color); }
    else { this.v(cx, cz, color); this.v(bx, bz, color); }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: RGB) {
    const flat = [...a, ...b, ...c, ...d];
    this.tri(flat, 0, 1, 2, color);
    this.tri(flat, 0, 2, 3, color);
  }

  /** Thick polyline: one quad per segment plus a disc at every joint so corners stay filled. */
  ribbon(pts: number[], width: number, color: RGB) {
    const hw = width / 2;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = (-(bz - az) / len) * hw, nz = ((bx - ax) / len) * hw;
      this.quad([ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz], color);
    }
    for (let i = 0; i < pts.length; i += 2) this.disc(pts[i], pts[i + 1], hw, color);
  }

  disc(x: number, z: number, r: number, color: RGB) {
    const n = 8;
    const flat = [x, z];
    for (let k = 0; k < n; k++) flat.push(x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r);
    for (let k = 0; k < n; k++) this.tri(flat, 0, 1 + k, 1 + ((k + 1) % n), color);
  }

  result(): MeshArrays {
    return { position: this.pos.result(), color: this.col.result() };
  }
}

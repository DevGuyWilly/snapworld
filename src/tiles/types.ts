import type { Origin } from '../geo/mercator';

export interface TileRequest {
  id: number;
  z: number;
  x: number;
  y: number;
  url: string;
  origin: Origin;
}

export interface MeshArrays {
  position: Float32Array;
  normal?: Float32Array;
  color: Float32Array;
  /** Building walls only: (distance along wall, height, per-building seed); u < 0 marks roofs. */
  wall?: Float32Array;
}

export interface Poi {
  name: string;
  cls: string;
  sub: string;
  rank: number;
  x: number;
  z: number;
}

export interface TileResult {
  id: number;
  error?: string;
  buildings?: MeshArrays;
  ground?: { base: MeshArrays; green: MeshArrays; water: MeshArrays; roads: MeshArrays };
  /** Stride 4: x, z, scale, kind*16 + colourIndex (kind 0 = round, 1 = pine). */
  trees?: Float32Array;
  pois?: Poi[];
  /** Building outlines for walk-mode collisions (see PolygonGrid.pack). */
  footprints?: { coords: Float32Array; offsets: Uint32Array };
}

/** Project tile pixel coords to local metres. */
export type Projector = (px: number, py: number) => [number, number];

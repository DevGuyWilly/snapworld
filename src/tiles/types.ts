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
  /** Daytime colour as normalised sRGB bytes (blended in the shader by time of day). */
  dayColor: Uint8Array;
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

/** A shopfront fascia sign pinned to a building wall. */
export interface Sign {
  /** Index into the tile's `pois`. */
  poi: number;
  cat: string;
  x: number;
  y: number;
  z: number;
  /** Outward wall normal (the sign faces this way). */
  nx: number;
  nz: number;
  /** Widest the board may be without overhanging the wall (m). */
  maxW: number;
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
  /** Wall segments for collisions, stride 6: ax, az, bx, bz, minHeight, height. */
  walls?: Float32Array;
  signs?: Sign[];
}

/** Project tile pixel coords to local metres. */
export type Projector = (px: number, py: number) => [number, number];

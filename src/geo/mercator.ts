// Web Mercator helpers and a local metric frame.
// World units are metres east (+x) and south (+z) of an origin near the user,
// which keeps float32 vertex positions small and jitter-free.

export const EARTH_RADIUS = 6378137;
export const WORLD_SIZE = 2 * Math.PI * EARTH_RADIUS;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Origin {
  mx: number;
  my: number;
  /** Mercator metres → ground metres at the origin latitude. */
  scale: number;
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

export const lonToMx = (lon: number) => lon * DEG * EARTH_RADIUS;
export const latToMy = (lat: number) => EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
export const mxToLon = (mx: number) => mx / EARTH_RADIUS / DEG;
export const myToLat = (my: number) => (2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2) / DEG;

export function makeOrigin({ lat, lon }: LatLon): Origin {
  return { mx: lonToMx(lon), my: latToMy(lat), scale: Math.cos(lat * DEG), lat, lon };
}

export function toLocal(o: Origin, { lat, lon }: LatLon): { x: number; z: number } {
  return { x: (lonToMx(lon) - o.mx) * o.scale, z: (o.my - latToMy(lat)) * o.scale };
}

export function fromLocal(o: Origin, x: number, z: number): LatLon {
  return { lon: mxToLon(o.mx + x / o.scale), lat: myToLat(o.my - z / o.scale) };
}

export function tileOf({ lat, lon }: LatLon, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = lat * DEG;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

/** Great-circle-ish distance in metres (equirectangular; fine for city scales). */
export function distance(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * DEG * Math.cos(((a.lat + b.lat) / 2) * DEG);
  const y = (b.lat - a.lat) * DEG;
  return Math.hypot(x, y) * EARTH_RADIUS;
}

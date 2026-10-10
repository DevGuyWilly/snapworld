// Solar position from date + location (algorithm after Vladimir Agafonkin's SunCalc / NOAA formulas).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

export interface SunPosition {
  /** Radians above the horizon (negative = below). */
  altitude: number;
  /** Radians clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d); // solar mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI; // ecliptic longitude
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - RAD * -lon - ra; // hour angle
  const phi = RAD * lat;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude, azimuth: fromSouth + Math.PI };
}

/**
 * The time to use for lighting: now, unless `?hour=18.5` (local hours) is in the URL for testing.
 */
export function sceneTime(): Date {
  const h = parseFloat(new URLSearchParams(location.search).get('hour') ?? '');
  const now = new Date();
  if (!Number.isFinite(h)) return now;
  const d = new Date(now);
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  return d;
}

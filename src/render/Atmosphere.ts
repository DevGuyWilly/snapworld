import * as THREE from 'three';
import { sunPosition } from '../geo/sun';
import { dayUniform } from './materials';
import { palette } from './palette';

const DEG = Math.PI / 180;
const C = (hex: number) => new THREE.Color(hex);

// Key colours for each phase (sRGB hex).
const SKY = { night: C(palette.background), day: C(0xbcd3ee), golden: C(0xeab08e) };
const FOG = { night: C(palette.fog), day: C(0xc6d9ef), golden: C(0xf2c3a4) };
const HEMI_SKY = { night: C(0xd2d4f2), day: C(0xe6eeff), golden: C(0xffe4d2) };
const HEMI_GROUND = { night: C(0x2a2a48), day: C(0x9a9c94), golden: C(0xb59184) };
const SUN = { day: C(0xfff4e2), golden: C(0xffad6b) };
const MOON = C(0xdcdcf5);

export interface AtmosphereState {
  /** 0 night … 1 day. */
  day: number;
  /** 0 … 1 strength of the sunrise / sunset glow. */
  golden: number;
  sunAltitudeDeg: number;
}

/**
 * Drives lighting, sky/fog colour and the map palette blend from the real sun position
 * at the current location and time.
 */
export class Atmosphere {
  readonly hemi = new THREE.HemisphereLight();
  readonly sun = new THREE.DirectionalLight();
  readonly clear = new THREE.Color();
  readonly fog = new THREE.Color();
  state: AtmosphereState = { day: 0, golden: 0, sunAltitudeDeg: -30 };
  private initialised = false;

  constructor() {
    this.hemi.layers.enableAll();
    this.sun.layers.enableAll();
  }

  /** Recompute for a moment in time; transitions ease so a fresh GPS fix doesn't snap the sky. */
  update(date: Date, lat: number, lon: number, dt: number) {
    const { altitude, azimuth } = sunPosition(date, lat, lon);
    const alt = altitude / DEG;
    // Civil twilight (−6°) to a few degrees above the horizon blends night → day.
    const dayTarget = THREE.MathUtils.smoothstep(alt, -6, 6);
    // Golden hour: strongest just around the horizon, gone by ~15° up or ~8° down.
    const goldenTarget = THREE.MathUtils.smoothstep(alt, -8, -1) * (1 - THREE.MathUtils.smoothstep(alt, 3, 15));
    const k = this.initialised ? 1 - Math.exp(-2 * dt) : 1;
    this.initialised = true;
    const s = this.state;
    s.day += (dayTarget - s.day) * k;
    s.golden += (goldenTarget - s.golden) * k;
    s.sunAltitudeDeg = alt;
    const day = s.day, golden = s.golden;

    dayUniform.value = day;
    mix3(this.clear, SKY, day, golden);
    mix3(this.fog, FOG, day, golden);
    mix3(this.hemi.color, HEMI_SKY, day, golden);
    mix3(this.hemi.groundColor, HEMI_GROUND, day, golden);
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 1.25, day);

    // By day the key light is the real sun (kept a little above the horizon so walls stay lit);
    // by night a fixed soft moonlight.
    const sunAlt = Math.max(altitude, 10 * DEG);
    const sunDir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(sunAlt), Math.sin(sunAlt), -Math.cos(azimuth) * Math.cos(sunAlt));
    const moonDir = new THREE.Vector3(-0.55, 1, 0.35).normalize();
    this.sun.position.copy(moonDir.lerp(sunDir, day));
    this.sun.color.copy(MOON).lerp(SUN.day, day).lerp(SUN.golden, golden * day);
    this.sun.intensity = THREE.MathUtils.lerp(0.95, 1.7, day) * (1 + golden * 0.15);

    document.body.classList.toggle('day', day > 0.5);
  }
}

/** night → day by `day`, then towards the golden-hour tint by `golden`. */
function mix3(out: THREE.Color, c: { night: THREE.Color; day: THREE.Color; golden: THREE.Color }, day: number, golden: number) {
  return out.copy(c.night).lerp(c.day, day).lerp(c.golden, golden * 0.65);
}

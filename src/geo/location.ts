import type { LatLon } from './mercator';

export type LocationStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'override';

export interface LocationState {
  status: LocationStatus;
  position: LatLon | null;
  accuracy: number | null;
  /** Compass heading in degrees clockwise from north, if the device provides one. */
  heading: number | null;
}

const LAST_KNOWN_KEY = 'snapworld.lastKnown';

/**
 * Wraps the Geolocation + DeviceOrientation APIs.
 * `?lat=..&lon=..` in the URL overrides GPS (for testing a specific place).
 */
export class LocationService extends EventTarget {
  state: LocationState = { status: 'idle', position: null, accuracy: null, heading: null };
  private watchId: number | null = null;

  static urlOverride(): LatLon | null {
    const q = new URLSearchParams(location.search);
    const lat = parseFloat(q.get('lat') ?? ''), lon = parseFloat(q.get('lon') ?? '');
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  static lastKnown(): LatLon | null {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_KNOWN_KEY) ?? 'null');
      return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
    } catch {
      return null;
    }
  }

  /** Start GPS tracking. Call from a user gesture so iOS also allows the compass prompt. */
  start() {
    const override = LocationService.urlOverride();
    if (override) {
      this.set({ status: 'override', position: override, accuracy: 5 });
      return;
    }
    if (!('geolocation' in navigator)) {
      this.set({ status: 'unavailable' });
      return;
    }
    this.set({ status: 'locating' });
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        const position = { lat: p.coords.latitude, lon: p.coords.longitude };
        try {
          localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(position));
        } catch { /* storage may be unavailable */ }
        // Prefer the GPS course while moving; otherwise keep the compass heading.
        const course = p.coords.heading != null && (p.coords.speed ?? 0) > 1 ? p.coords.heading : null;
        this.set({ status: 'ok', position, accuracy: p.coords.accuracy, ...(course != null ? { heading: course } : {}) });
      },
      (err) => {
        if (this.state.status === 'ok') return; // transient error after a good fix
        this.set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    this.startCompass();
  }

  retry() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.start();
  }

  private async startCompass() {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return;
    try {
      if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission()) !== 'granted') return;
    } catch {
      return; // not triggered by a gesture, or refused
    }
    const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      let heading: number | null = null;
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS
      else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360; // Android
      if (heading != null) this.set({ heading });
    };
    window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
    window.addEventListener('deviceorientation', onOrient as EventListener);
  }

  private set(patch: Partial<LocationState>) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }
}

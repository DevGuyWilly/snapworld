import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

/**
 * Snap-style map camera: angled view, drag to pan, scroll/pinch to zoom,
 * right-drag / two fingers to rotate and tilt. Follows a target until the user pans away.
 */
export class MapCamera extends EventTarget {
  readonly controls: MapControls;
  following = true;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; follow: boolean } | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    super();
    const c = (this.controls = new MapControls(camera, dom));
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.minDistance = 35;
    c.maxDistance = 2200;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.22;
    c.zoomToCursor = true;
    c.zoomSpeed = 1.2;

    // A single-finger or left-button drag pans the map, which stops following.
    dom.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'mouse' && e.button === 0 && !e.ctrlKey && !e.metaKey) || (e.pointerType === 'touch' && e.isPrimary)) {
        this.panStart = true;
      }
    });
    c.addEventListener('change', () => {
      if (this.panStart && this.following && this.flight == null) {
        const moved = this.lastTarget.distanceTo(c.target) > 0.5;
        if (moved) this.setFollowing(false);
      }
    });
    c.addEventListener('end', () => (this.panStart = false));
  }

  private panStart = false;
  private lastTarget = new THREE.Vector3();

  /** Place the camera looking at `p` from the default Snap-like angle. */
  jumpTo(p: THREE.Vector3, distance = 320, az = Math.PI * 0.15) {
    const c = this.controls;
    const polar = 0.95;
    c.target.copy(p);
    this.camera.position.set(
      p.x + distance * Math.sin(polar) * Math.sin(az),
      p.y + distance * Math.cos(polar),
      p.z + distance * Math.sin(polar) * Math.cos(az),
    );
    c.update();
    this.lastTarget.copy(c.target);
  }

  /** Smoothly glide to `p`; with `follow`, keep tracking the moving follow point afterwards. */
  flyTo(p: THREE.Vector3, follow = true) {
    this.flight = { from: this.controls.target.clone(), to: p.clone(), t: 0, follow };
    this.setFollowing(follow);
  }

  setFollowing(v: boolean) {
    if (this.following === v) return;
    this.following = v;
    this.dispatchEvent(new Event('followchange'));
  }

  /** Rotate so north is up (keeps tilt and zoom). */
  resetNorth() {
    const c = this.controls;
    const offset = this.camera.position.clone().sub(c.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta = 0;
    this.camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    c.update();
  }

  /** Azimuth in radians (0 = looking north). */
  get azimuth() {
    return this.controls.getAzimuthalAngle();
  }

  get distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  update(dt: number, followPoint: THREE.Vector3 | null) {
    const c = this.controls;
    let goal: THREE.Vector3 | null = null;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      goal = f.from.clone().lerp(f.follow && followPoint ? followPoint : f.to, e);
      if (f.t >= 1) this.flight = null;
    } else if (this.following && followPoint) {
      goal = c.target.clone().lerp(followPoint, 1 - Math.exp(-6 * dt));
    }
    if (goal) {
      const delta = goal.sub(c.target);
      c.target.add(delta);
      this.camera.position.add(delta);
    }
    // Anything that moves the target during c.update() past this point came from the user.
    this.lastTarget.copy(c.target);
    c.update();
  }
}

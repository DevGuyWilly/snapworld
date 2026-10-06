import * as THREE from 'three';

const WALK_SPEED = 3.2; // m/s (a little brisk, it's for exploring)
const RUN_SPEED = 9;
const RADIUS = 0.35; // avatar collision radius
const CAM_BACK = 6.5;
const CAM_UP = 2.6;

/**
 * Street-level third-person exploring: WASD/arrows or an on-screen joystick to walk,
 * drag to look around. Slides along building walls instead of passing through them.
 */
export class WalkMode {
  active = false;
  readonly position = new THREE.Vector3();
  yaw = 0; // radians, 0 = facing north (-z)
  pitch = 0.12;
  speed = 0;
  readonly moveDir = new THREE.Vector3();

  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private dragging: { id: number; x: number; y: number } | null = null;
  private stickPointer: number | null = null;
  private camPos = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    joystick: HTMLElement,
    private blocked: (x: number, z: number, r: number) => boolean,
  ) {
    addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || this.dragging) return;
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      const k = e.pointerType === 'touch' ? 0.006 : 0.004;
      this.yaw += (e.clientX - this.dragging.x) * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.dragging.y) * k, -0.35, 0.9);
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
    });
    const endDrag = (e: PointerEvent) => {
      if (this.dragging?.id === e.pointerId) this.dragging = null;
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);

    // Joystick
    const knob = joystick.querySelector('.knob') as HTMLElement;
    const setStick = (e: PointerEvent) => {
      const r = joystick.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.stick = { x, y };
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    };
    joystick.addEventListener('pointerdown', (e) => {
      this.stickPointer = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      setStick(e);
    });
    joystick.addEventListener('pointermove', (e) => e.pointerId === this.stickPointer && setStick(e));
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', endStick);
    joystick.addEventListener('pointercancel', endStick);
  }

  enter(at: THREE.Vector3, yaw: number) {
    this.active = true;
    this.position.set(at.x, 0, at.z);
    // If we start inside a building (GPS drift), nudge outwards to the nearest free spot.
    for (let r = 0; r < 40 && this.blocked(this.position.x, this.position.z, RADIUS); r += 2) {
      for (let a = 0; a < 8; a++) {
        const x = at.x + Math.cos((a / 8) * Math.PI * 2) * r, z = at.z + Math.sin((a / 8) * Math.PI * 2) * r;
        if (!this.blocked(x, z, RADIUS)) { this.position.set(x, 0, z); r = 99; break; }
      }
    }
    this.yaw = yaw;
    this.pitch = 0.12;
    this.desiredCamera(this.camPos);
  }

  /** Move everything by -v (used when the world origin is re-centred). */
  shift(v: THREE.Vector3) {
    this.position.sub(v);
    this.camPos.sub(v);
  }

  exit() {
    this.active = false;
    this.keys.clear();
    this.stick = { x: 0, y: 0 };
    this.speed = 0;
  }

  /** Where the camera wants to be right now (behind and above the avatar). */
  desiredCamera(out: THREE.Vector3): THREE.Vector3 {
    const back = CAM_BACK * Math.cos(this.pitch), up = CAM_UP + CAM_BACK * Math.sin(this.pitch);
    return out.set(this.position.x + Math.sin(this.yaw) * back, up, this.position.z + Math.cos(this.yaw) * back);
  }

  lookTarget(out: THREE.Vector3) {
    return out.set(this.position.x, 1.5, this.position.z);
  }

  update(dt: number, driveCamera: boolean) {
    if (!this.active) return;
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    f -= this.stick.y;
    s += this.stick.x;
    const mag = Math.min(1, Math.hypot(f, s));
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.92;
    const speed = mag * (run ? RUN_SPEED : WALK_SPEED);

    // Forward is away from the camera.
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.moveDir.set(fx * f + rx * s, 0, fz * f + rz * s);
    if (this.moveDir.lengthSq() > 0) this.moveDir.normalize();

    const step = speed * dt;
    const nx = this.position.x + this.moveDir.x * step, nz = this.position.z + this.moveDir.z * step;
    const before = this.position.clone();
    if (!this.blocked(nx, nz, RADIUS)) this.position.set(nx, 0, nz);
    else if (!this.blocked(nx, this.position.z, RADIUS)) this.position.x = nx; // slide along walls
    else if (!this.blocked(this.position.x, nz, RADIUS)) this.position.z = nz;
    this.speed = before.distanceTo(this.position) / Math.max(dt, 1e-4);

    if (driveCamera) {
      const want = this.desiredCamera(new THREE.Vector3());
      this.camPos.lerp(want, 1 - Math.exp(-10 * dt));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.lookTarget(new THREE.Vector3()));
    }
  }
}

import * as THREE from 'three';
import type { InputFrame } from './Input';

export interface CollisionWorld {
  pushOut(p: THREE.Vector3, radius: number, height: number): { x: number; z: number };
}

const SPEED = { walk: 1.7, jog: 4.6, sprint: 7.8 };
const ACCEL = 14; // m/s² towards the wanted velocity on the ground
const BRAKE = 18; // m/s² when letting go of the stick
const AIR_CONTROL = 0.25;
const GRAVITY = 22;
const JUMP_SPEED = 6.2;
const RADIUS = 0.36;
const HEIGHT = 1.8;
const MAX_STEP = 0.12; // metres per collision sub-step (prevents tunnelling)

/**
 * Third-person character motion: camera-relative input, smooth acceleration and turning,
 * jumping, and collision that slides along walls instead of sticking to them.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Facing yaw; forward = (sin facing, cos facing). */
  facing = 0;
  /** Smoothed turning speed in rad/s (drives the lean animation). */
  turnRate = 0;
  grounded = true;
  sprinting = false;

  constructor(private world: CollisionWorld) {}

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  spawn(p: THREE.Vector3, facing: number) {
    this.position.set(p.x, 0, p.z);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.turnRate = 0;
    this.grounded = true;
    // GPS can drop us inside a building: resolve a few times to settle outside.
    for (let i = 0; i < 6; i++) this.world.pushOut(this.position, RADIUS, HEIGHT);
  }

  update(dt: number, input: InputFrame, cameraYaw: number) {
    // Camera-relative wish direction. The camera looks along (-sin yaw, -cos yaw).
    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    const wx = fx * input.moveY + rx * input.moveX, wz = fz * input.moveY + rz * input.moveX;
    const amount = Math.min(1, Math.hypot(wx, wz));
    this.sprinting = input.sprint && amount > 0.3;
    const top = input.walk ? SPEED.walk : this.sprinting ? SPEED.sprint : SPEED.jog;
    // Analog sticks: a light push walks, a full push jogs.
    const wantSpeed = top * (input.walk || this.sprinting ? Math.min(1, amount * 1.4) : amount);

    let tx = 0, tz = 0;
    if (amount > 0.01) {
      tx = (wx / amount) * wantSpeed;
      tz = (wz / amount) * wantSpeed;
    }
    const rate = (amount > 0.01 ? ACCEL : BRAKE) * (this.grounded ? 1 : AIR_CONTROL);
    const dvx = tx - this.velocity.x, dvz = tz - this.velocity.z;
    const dv = Math.hypot(dvx, dvz), maxDv = rate * dt;
    if (dv > maxDv) {
      this.velocity.x += (dvx / dv) * maxDv;
      this.velocity.z += (dvz / dv) * maxDv;
    } else {
      this.velocity.x = tx;
      this.velocity.z = tz;
    }

    // Turn towards the direction we're trying to go; snappier when slow (like GTA's pivot).
    const prevFacing = this.facing;
    if (amount > 0.05) {
      const want = Math.atan2(wx, wz);
      const d = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
      const turnSpeed = THREE.MathUtils.lerp(14, 7, Math.min(1, this.horizontalSpeed / SPEED.sprint));
      this.facing += d * (1 - Math.exp(-turnSpeed * dt));
    }
    const rawTurn = Math.atan2(Math.sin(this.facing - prevFacing), Math.cos(this.facing - prevFacing)) / Math.max(dt, 1e-4);
    this.turnRate += (rawTurn - this.turnRate) * (1 - Math.exp(-10 * dt));

    // Jump / gravity
    if (input.jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    if (!this.grounded) this.velocity.y -= GRAVITY * dt;

    // Move in small steps, resolving collisions and removing velocity into walls (slide).
    const dist = Math.hypot(this.velocity.x, this.velocity.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.position.x += this.velocity.x * sdt;
      this.position.z += this.velocity.z * sdt;
      this.position.y += this.velocity.y * sdt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.velocity.y = 0;
        this.grounded = true;
      }
      const push = this.world.pushOut(this.position, RADIUS, HEIGHT);
      const pl = Math.hypot(push.x, push.z);
      if (pl > 1e-6) {
        const nx = push.x / pl, nz = push.z / pl;
        const into = this.velocity.x * nx + this.velocity.z * nz;
        if (into < 0) {
          this.velocity.x -= into * nx;
          this.velocity.z -= into * nz;
        }
      }
    }
  }
}

import * as THREE from 'three';
import type { InputFrame } from './Input';
import type { PlayerController } from './PlayerController';

export interface CameraWorld {
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): number;
}

const ZOOMS = [2.6, 4.4, 7.2];
const PIVOT_HEIGHT = 1.55;
const SHOULDER = 0.42; // over-the-right-shoulder offset
const WALL_MARGIN = 0.28;
const PITCH_MIN = -0.55; // looking up
const PITCH_MAX = 1.15; // looking down
const DEFAULT_PITCH = 0.16;
const RECENTER_DELAY = 1.6; // seconds without look input before the camera swings back behind
const BASE_FOV = 58;
const SPRINT_FOV = 66;

/**
 * GTA-style orbit camera: free look around the character, over-the-shoulder framing,
 * a collision-aware boom that snaps in when blocked and eases back out, gentle auto-recentre
 * while running, and a slight FOV kick when sprinting.
 */
export class ThirdPersonCamera {
  /** Camera sits at pivot + (sin yaw·cos pitch, sin pitch, cos yaw·cos pitch) · distance. */
  yaw = 0;
  pitch = DEFAULT_PITCH;
  private zoomIndex = 1;
  private targetDistance = ZOOMS[1];
  /** Actual boom length after collisions (what the camera uses). */
  boom = ZOOMS[1];
  private pivot = new THREE.Vector3();
  private sinceLook = 99;
  private fov = BASE_FOV;
  private dir = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private world: CameraWorld) {}

  /** Start behind the player, facing the way they face. */
  reset(player: PlayerController) {
    this.yaw = player.facing + Math.PI;
    this.pitch = DEFAULT_PITCH;
    this.pivotTarget(player, this.pivot);
    this.boom = this.collide(this.pivot, this.targetDistance);
    this.sinceLook = 99;
  }

  /** The pose the camera would take right now, for transition tweens. */
  pose(player: PlayerController, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const pivot = this.pivotTarget(player, new THREE.Vector3());
    const dist = this.collide(pivot, this.targetDistance);
    this.direction(this.dir);
    outPos.copy(pivot).addScaledVector(this.dir, dist);
    const m = new THREE.Matrix4().lookAt(outPos, pivot, this.camera.up);
    outQuat.setFromRotationMatrix(m);
  }

  update(dt: number, input: InputFrame, player: PlayerController) {
    // Look input
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, PITCH_MIN, PITCH_MAX);
    this.sinceLook = input.looked ? 0 : this.sinceLook + dt;

    if (input.cycleZoom) this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length;
    if (input.zoom) this.zoomIndex = THREE.MathUtils.clamp(this.zoomIndex + input.zoom, 0, ZOOMS.length - 1);
    this.targetDistance += (ZOOMS[this.zoomIndex] - this.targetDistance) * (1 - Math.exp(-8 * dt));

    // Auto-recentre behind the player while they run and the user isn't steering the camera.
    const speed = player.horizontalSpeed;
    if (this.sinceLook > RECENTER_DELAY && speed > 1.2) {
      const behind = player.facing + Math.PI;
      const d = Math.atan2(Math.sin(behind - this.yaw), Math.cos(behind - this.yaw));
      const k = 1 - Math.exp(-Math.min(speed / 4, 1.6) * 1.3 * dt);
      this.yaw += d * k;
      this.pitch += (DEFAULT_PITCH - this.pitch) * k;
    }

    // Pivot follows the player with a little lag (and softer vertically, so jumps feel weighty).
    const want = this.pivotTarget(player, this.tmp);
    const kh = 1 - Math.exp(-16 * dt), kv = 1 - Math.exp(-7 * dt);
    this.pivot.x += (want.x - this.pivot.x) * kh;
    this.pivot.z += (want.z - this.pivot.z) * kh;
    this.pivot.y += (want.y - this.pivot.y) * kv;

    // Boom: snap in instantly when something blocks the view, ease back out afterwards.
    const allowed = this.collide(this.pivot, this.targetDistance);
    if (allowed < this.boom) this.boom = allowed;
    else this.boom += (allowed - this.boom) * (1 - Math.exp(-3.5 * dt));

    this.direction(this.dir);
    this.camera.position.copy(this.pivot).addScaledVector(this.dir, this.boom);
    this.camera.lookAt(this.pivot);

    const fovTarget = player.sprinting && speed > 5 ? SPRINT_FOV : BASE_FOV;
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Move by -v (used when the world origin is re-centred). */
  shift(v: THREE.Vector3) {
    this.pivot.sub(v);
  }

  /** 0 when the camera is right on the character's head, 1 at a comfortable distance. */
  get characterOpacity() {
    return THREE.MathUtils.smoothstep(this.boom, 0.55, 1.2);
  }

  private direction(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  /** Head height plus a shoulder offset, pulled in if the shoulder would be inside a wall. */
  private pivotTarget(player: PlayerController, out: THREE.Vector3) {
    const head = out.set(player.position.x, player.position.y + PIVOT_HEIGHT, player.position.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const free = this.world.raycast(head, right, SHOULDER + WALL_MARGIN) - WALL_MARGIN;
    return head.addScaledVector(right, Math.max(0, Math.min(SHOULDER, free)));
  }

  /** Longest boom (≤ want) that keeps the camera clear of walls and above the ground. */
  private collide(pivot: THREE.Vector3, want: number) {
    this.direction(this.dir);
    let d = this.world.raycast(pivot, this.dir, want + WALL_MARGIN) - WALL_MARGIN;
    if (this.dir.y < 0) d = Math.min(d, (pivot.y - 0.25) / -this.dir.y);
    return Math.max(0.35, Math.min(want, d));
  }
}

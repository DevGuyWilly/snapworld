import * as THREE from 'three';

export interface AvatarLook {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
}

export const DEFAULT_LOOK: AvatarLook = { skin: 0x8d5a3b, hair: 0x1d1512, top: 0x6b4a33, bottom: 0x8a8f9c, shoes: 0xf2f2f2 };

/**
 * A stylized person built from primitives, about 1.75 m tall at scale 1.
 * Walking and idling are animated procedurally, so no model files are needed.
 */
export class Avatar {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = 0;
  private walkAmount = 0;
  private yaw = 0;
  private yawTarget = 0;

  constructor(look: AvatarLook = DEFAULT_LOOK) {
    // Lambert with a little self-light so the figure stays readable in the night palette.
    const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.35) });
    const skin = mat(look.skin), hair = mat(look.hair), top = mat(look.top), bottom = mat(look.bottom), shoes = mat(look.shoes);

    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(0.1 * side, 0.84, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.6, 4, 10), bottom);
      thigh.position.y = -0.4;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.28), shoes);
      shoe.position.set(0, -0.79, 0.04);
      leg.add(thigh, shoe);
      this.body.add(leg);
    }

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.34, 4, 14), top);
    torso.scale.set(1, 1, 0.72);
    torso.position.y = 1.13;
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.05, 6, 14), top);
    hood.rotation.x = Math.PI / 2;
    hood.position.y = 1.43;
    this.body.add(torso, hood);

    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(0.28 * side, 1.38, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 10), top);
      sleeve.position.y = -0.25;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), skin);
      hand.position.y = -0.53;
      arm.add(sleeve, hand);
      arm.rotation.z = 0.08 * side;
      this.body.add(arm);
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), skin);
    head.scale.set(1, 1.1, 1.02);
    head.position.y = 1.64;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
    hairCap.position.y = 1.67;
    hairCap.scale.set(1.02, 1.05, 1.06);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), skin);
    neck.position.y = 1.47;
    this.body.add(head, hairCap, neck);

    // Soft contact shadow so the figure sits on the ground.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    shadow.position.y = 0.02;
    shadow.renderOrder = 6;

    this.group.add(shadow, this.body);
    this.group.traverse((o) => (o.renderOrder = Math.max(o.renderOrder, 6)));
  }

  /** Height of the head top in world units (for anchoring the name tag). */
  get headHeight() {
    return 1.85 * this.group.scale.y;
  }

  /** Face a compass heading (degrees clockwise from north). */
  faceHeading(deg: number) {
    this.yawTarget = (-deg * Math.PI) / 180 + Math.PI;
  }

  /** Face a direction of travel in the XZ plane. */
  faceDirection(dx: number, dz: number) {
    if (dx * dx + dz * dz > 1e-6) this.yawTarget = Math.atan2(dx, dz);
  }

  /** `speed` in metres per second drives the walk cycle. */
  update(dt: number, speed: number) {
    const moving = Math.min(speed / 1.4, 1.6);
    this.walkAmount += ((moving > 0.08 ? 1 : 0) - this.walkAmount) * (1 - Math.exp(-8 * dt));
    this.phase += dt * (4 + moving * 5);
    const swing = Math.sin(this.phase) * 0.65 * this.walkAmount;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * this.walkAmount;
    this.body.scale.y = 1 + Math.sin(this.phase * 0.5) * 0.008 * (1 - this.walkAmount); // idle breathing

    let d = this.yawTarget - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-10 * dt));
    this.group.rotation.y = this.yaw;
  }
}

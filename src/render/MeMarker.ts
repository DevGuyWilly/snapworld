import * as THREE from 'three';

/**
 * "You are here": a glowing puck, a pulse ring, and a yellow heading cone.
 * (The avatar figure arrives in phase 4 and stands on top of this.)
 */
export class MeMarker {
  readonly group = new THREE.Group();
  private pulse: THREE.Mesh;
  private cone: THREE.Mesh;
  private target = new THREE.Vector3();
  private headingTarget: number | null = null;
  private heading = 0;
  private placed = false;

  constructor() {
    const puck = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2aa7ff, depthWrite: false, transparent: true, opacity: 0.95 }),
    );
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 4.1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, transparent: true }),
    );
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(4, 5, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2aa7ff, depthWrite: false, transparent: true }),
    );
    // Heading cone: a flat wedge fading out from the centre.
    const wedge = new THREE.BufferGeometry();
    const spread = 0.42, len = 34, segs = 12;
    const pos = [0, 0, 0], alpha = [0.55];
    for (let i = 0; i <= segs; i++) {
      const a = -spread + (2 * spread * i) / segs;
      pos.push(Math.sin(a) * len, 0, -Math.cos(a) * len);
      alpha.push(0);
    }
    const idx: number[] = [];
    for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
    wedge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wedge.setAttribute('alpha', new THREE.Float32BufferAttribute(alpha, 1));
    wedge.setIndex(idx);
    this.cone = new THREE.Mesh(
      wedge,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.86, 0.2, vA); }',
      }),
    );
    this.cone.visible = false;

    this.group.add(this.cone, this.pulse, rim, puck);
    this.group.children.forEach((c, i) => {
      c.position.y = 0.3 + i * 0.05;
      c.renderOrder = 100 + i; // drawn in the overlay pass, so the avatar standing on it still occludes it
    });
    this.group.visible = false;
  }

  setPosition(x: number, z: number) {
    this.target.set(x, 0, z);
    if (!this.placed) {
      this.group.position.copy(this.target);
      this.placed = true;
    }
    this.group.visible = true;
  }

  /** Degrees clockwise from north, or null to hide the cone. */
  setHeading(deg: number | null) {
    this.headingTarget = deg;
    this.cone.visible = deg != null;
  }

  /** Next setPosition snaps instead of gliding (used after the world origin moves). */
  reset() {
    this.placed = false;
  }

  get position() {
    return this.group.position;
  }

  get isPlaced() {
    return this.placed;
  }

  update(dt: number, t: number, cameraDistance: number) {
    // Glide between GPS fixes instead of teleporting.
    this.group.position.lerp(this.target, 1 - Math.exp(-3 * dt));
    if (this.headingTarget != null) {
      const goal = (-this.headingTarget * Math.PI) / 180;
      let d = goal - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-8 * dt));
      this.cone.rotation.y = this.heading;
    }
    // Keep the marker readable at any zoom level.
    this.group.scale.setScalar(THREE.MathUtils.clamp(cameraDistance / 260, 0.45, 4));
    const p = (t % 1.8) / 1.8;
    this.pulse.scale.setScalar(1 + p * 1.6);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - p);
  }
}

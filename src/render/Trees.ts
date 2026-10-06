import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette } from './palette';

// Chunky, toy-like trees in the Snap style: a bell-shaped canopy on a stubby trunk, plus pines.
const canopyGeo = new THREE.LatheGeometry(
  [[0, 1.3], [1.2, 1.45], [1.5, 2.6], [1.0, 3.9], [0, 4.3]].map(([x, y]) => new THREE.Vector2(x, y)),
  6,
);
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1.6, 5, 1, true).translate(0, 0.8, 0);
const pineGeo = mergeGeometries([
  new THREE.ConeGeometry(1.5, 2.6, 7).translate(0, 2.3, 0),
  new THREE.ConeGeometry(1.1, 2.2, 7).translate(0, 3.6, 0),
  new THREE.ConeGeometry(0.7, 1.8, 7).translate(0, 4.7, 0),
])!;

const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: palette.trunk, flatShading: true });

const ROUND = palette.treeRound.map((c) => new THREE.Color(c));
const PINE = palette.treePine.map((c) => new THREE.Color(c));
const SIZE = 2.1; // overall scale so trees read well next to ~10 m buildings

/** Builds instanced trees for one tile from the worker's packed array. */
export function buildTrees(data: Float32Array): THREE.Group {
  const group = new THREE.Group();
  const n = data.length / 4;
  if (n === 0) return group;
  let rounds = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 16) rounds++;

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, Math.max(rounds, 1));
  const pines = new THREE.InstancedMesh(pineGeo, canopyMat, Math.max(n - rounds, 1));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let ri = 0, pi = 0;
  for (let i = 0; i < n; i++) {
    const x = data[i * 4], z = data[i * 4 + 1], sc = data[i * 4 + 2] * SIZE, code = data[i * 4 + 3];
    q.setFromAxisAngle(up, (x * 13.7 + z * 7.1) % (Math.PI * 2));
    m.compose(p.set(x, 0, z), q, s.set(sc, sc * (0.9 + ((x * 3.3) % 0.25)), sc));
    trunks.setMatrixAt(i, m);
    if (code < 16) {
      canopies.setMatrixAt(ri, m);
      canopies.setColorAt(ri++, ROUND[code % ROUND.length]);
    } else {
      pines.setMatrixAt(pi, m);
      pines.setColorAt(pi++, PINE[(code - 16) % PINE.length]);
    }
  }
  canopies.count = ri;
  pines.count = pi;
  for (const im of [trunks, canopies, pines]) {
    im.computeBoundingSphere();
    im.renderOrder = 5; // after the depth-less ground layers
    group.add(im);
  }
  return group;
}

export function disposeTrees(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}

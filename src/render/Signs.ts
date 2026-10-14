import * as THREE from 'three';
import type { Poi, Sign } from '../tiles/types';

const BOARD_H = 0.95; // metres
const DEPTH = 0.14;
const MAX_SIGNS = 90;
const CANVAS_H = 128;

// Fascia colours by category (background, text).
const STYLE: Record<string, [string, string]> = {
  cafe: ['#5a3826', '#fff1dc'],
  food: ['#8c2b2b', '#ffffff'],
  bar: ['#3b2858', '#ffe7a8'],
  shop: ['#1d2849', '#ffffff'],
  hotel: ['#1c4a4c', '#ffffff'],
};

const planeGeo = new THREE.PlaneGeometry(1, 1);
const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
const backMat = new THREE.MeshLambertMaterial({ color: 0x15172a });

interface Live {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  poi: Poi;
}

/**
 * Shopfront signs carrying real place names, built only near the viewer and recycled as you move.
 * Faces are unlit (MeshBasic), so they read like illuminated fascias at night.
 */
export class SignLayer {
  readonly group = new THREE.Group();
  private live = new Map<string, Live>();

  /** Sync to the signs that should exist now (nearest first, capped). */
  update(entries: { sign: Sign; poi: Poi; key: string }[], focus: THREE.Vector3) {
    const wanted = entries
      .map((e) => ({ ...e, d: Math.hypot(e.sign.x - focus.x, e.sign.z - focus.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_SIGNS);
    const keep = new Set(wanted.map((e) => e.key));
    for (const [key, l] of this.live) if (!keep.has(key)) this.remove(key, l);
    let created = 0;
    for (const e of wanted) {
      if (this.live.has(e.key)) continue;
      if (created++ > 6) break; // spread texture work over frames
      this.live.set(e.key, this.build(e.sign, e.poi));
    }
  }

  /** Places that currently have a sign within `r` metres of `p`. */
  signedPois(p: THREE.Vector3, r: number): Set<Poi> {
    const out = new Set<Poi>();
    for (const l of this.live.values()) if (l.group.position.distanceTo(p) < r) out.add(l.poi);
    return out;
  }

  clear() {
    for (const [key, l] of this.live) this.remove(key, l);
  }

  private build(sign: Sign, poi: Poi): Live {
    const [bg, fg] = STYLE[sign.cat] ?? STYLE.shop;
    const { canvas, aspect } = drawSign(poi.name, bg, fg, sign.maxW / BOARD_H);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const w = BOARD_H * aspect;

    const group = new THREE.Group();
    const face = new THREE.Mesh(planeGeo, mat);
    face.scale.set(w, BOARD_H, 1);
    face.position.z = 0.002;
    const back = new THREE.Mesh(boxGeo, backMat);
    back.scale.set(w + 0.08, BOARD_H + 0.08, DEPTH);
    group.add(back, face);
    group.position.set(sign.x + sign.nx * DEPTH, sign.y, sign.z + sign.nz * DEPTH);
    group.rotation.y = Math.atan2(sign.nx, sign.nz); // local +z faces out of the wall
    group.traverse((o) => (o.renderOrder = 12));
    this.group.add(group);
    return { group, mat, poi };
  }

  private remove(key: string, l: Live) {
    this.group.remove(l.group);
    l.mat.map?.dispose();
    l.mat.dispose();
    this.live.delete(key);
  }
}

/** Renders the name onto a fascia board texture; shrinks (then truncates) text to fit `maxAspect`. */
function drawSign(name: string, bg: string, fg: string, maxAspect: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const pad = 44;
  let size = 66;
  const font = (s: number) => `700 ${s}px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font(size);
  let text = name;
  let tw = ctx.measureText(text).width;
  const maxW = Math.max(200, maxAspect * CANVAS_H) - pad * 2;
  if (tw > maxW) {
    size = Math.max(40, Math.floor((size * maxW) / tw));
    ctx.font = font(size);
    tw = ctx.measureText(text).width;
    while (tw > maxW && text.length > 3) {
      text = text.slice(0, -1);
      tw = ctx.measureText(text + '…').width;
    }
    if (text !== name) text += '…';
  }
  canvas.width = Math.ceil(Math.max(tw + pad * 2, CANVAS_H * 2.2));
  canvas.height = CANVAS_H;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Subtle top highlight and bottom trim, like a painted fascia.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 0, canvas.width, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  ctx.font = font(size);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  return { canvas, aspect: canvas.width / canvas.height };
}

import * as THREE from 'three';
import type { Poi } from '../tiles/types';
import { CATEGORY_BY_ID, categoryOf, subtitleOf, type CategoryId } from './categories';

type Box = [number, number, number, number];

const MAX_LABELS = 16;
const RESELECT_MS = 250; // how often the label set is re-decided (positions update every frame)

interface Placed {
  poi: Poi;
  key: string;
  el: HTMLElement;
  w: number;
  h: number;
  pos: THREE.Vector3;
}

/**
 * Snap-style place labels as DOM elements projected from 3D.
 * A greedy pass keeps the most important labels and drops ones that would overlap.
 */
export class LabelLayer {
  private root: HTMLElement;
  private placed = new Map<string, Placed>();
  private lastSelect = 0;
  private filter: CategoryId | null = null;
  private v = new THREE.Vector3();
  onSelect: (poi: Poi) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    parent.appendChild(this.root);
  }

  setFilter(id: CategoryId | null) {
    this.filter = id;
    this.lastSelect = 0;
  }

  update(pois: Poi[], camera: THREE.PerspectiveCamera, focus: THREE.Vector3, viewDistance: number, now: number, reserved: Box[] = []) {
    const W = innerWidth, H = innerHeight;
    if (now - this.lastSelect > RESELECT_MS) {
      this.lastSelect = now;
      this.select(pois, camera, focus, viewDistance, W, H, reserved);
    }
    for (const p of this.placed.values()) {
      this.v.copy(p.pos).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      p.el.style.visibility = this.v.z < 1 ? 'visible' : 'hidden';
    }
  }

  private select(pois: Poi[], camera: THREE.PerspectiveCamera, focus: THREE.Vector3, viewDistance: number, W: number, H: number, reserved: Box[]) {
    const maxRange = Math.min(250 + viewDistance * 1.6, 2500);
    const scored: { poi: Poi; cat: CategoryId; score: number; sx: number; sy: number }[] = [];
    for (const poi of pois) {
      const cat = categoryOf(poi.cls, poi.sub);
      if (!cat || (this.filter && cat !== this.filter)) continue;
      const d = Math.hypot(poi.x - focus.x, poi.z - focus.z);
      if (d > maxRange) continue;
      this.v.set(poi.x, 0, poi.z).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      const sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      // Important + close + already-visible labels win (the last keeps the map from flickering).
      const key = keyOf(poi);
      const score = CATEGORY_BY_ID[cat].weight * 2 - poi.rank * 0.12 - d / 220 + (this.placed.has(key) ? 1.5 : 0);
      scored.push({ poi, cat, score, sx, sy });
    }
    scored.sort((a, b) => b.score - a.score);

    const boxes: Box[] = [...reserved];
    const keep = new Set<string>();
    for (const s of scored) {
      if (keep.size >= MAX_LABELS) break;
      const key = keyOf(s.poi);
      const existing = this.placed.get(key);
      const w = existing?.w ?? Math.min(170, 18 + s.poi.name.length * 7.5), h = existing?.h ?? 46;
      const pad = 18; // breathing room between labels
      const box: [number, number, number, number] = [s.sx - w / 2 - pad, s.sy - h - pad, s.sx + w / 2 + pad, s.sy + pad];
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      keep.add(key);
      if (!existing) this.add(s.poi, s.cat, key);
    }
    for (const [key, p] of this.placed) {
      if (keep.has(key)) continue;
      p.el.remove();
      this.placed.delete(key);
    }
  }

  private add(poi: Poi, cat: CategoryId, key: string) {
    const el = document.createElement('div');
    el.className = `label cat-${cat}`;
    el.innerHTML = `<span class="icon"><svg viewBox="0 0 24 24">${CATEGORY_BY_ID[cat].icon}</svg></span><span class="name"></span><span class="sub"></span>`;
    (el.querySelector('.name') as HTMLElement).textContent = poi.name;
    (el.querySelector('.sub') as HTMLElement).textContent = subtitleOf(poi.cls, poi.sub);
    el.addEventListener('click', () => this.onSelect(poi));
    this.root.appendChild(el);
    const r = el.getBoundingClientRect();
    this.placed.set(key, { poi, key, el, w: r.width || 120, h: r.height || 46, pos: new THREE.Vector3(poi.x, 4, poi.z) });
  }

  clear() {
    for (const p of this.placed.values()) p.el.remove();
    this.placed.clear();
  }
}

const keyOf = (p: Poi) => `${p.name}|${Math.round(p.x)}|${Math.round(p.z)}`;

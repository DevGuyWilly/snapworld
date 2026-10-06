import * as THREE from 'three';
import { makeOrigin, toLocal, fromLocal, distance, type LatLon } from './geo/mercator';
import { LocationService } from './geo/location';
import { TileManager } from './tiles/TileManager';
import { MapCamera } from './camera/MapCamera';
import { Input } from './player/Input';
import { PlayerController } from './player/PlayerController';
import { ThirdPersonCamera } from './player/ThirdPersonCamera';
import { MeMarker } from './render/MeMarker';
import { Avatar } from './render/Avatar';
import { palette } from './render/palette';
import { LabelLayer } from './labels/LabelLayer';
import { CATEGORIES, type CategoryId } from './labels/categories';
import { Gate } from './ui/Gate';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const REBASE_DISTANCE = 6000; // re-centre the local frame after travelling this far (m)
const REORIGIN_ON_FIX = 2500; // a first real GPS fix this far from the provisional view jumps there

const $ = (id: string) => document.getElementById(id)!;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- Renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 2 : 1.75));
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
renderer.setClearColor(palette.background); // cleared manually (two render passes)
const fog = new THREE.Fog(palette.fog, 400, 1600);
scene.fog = fog;

const hemi = new THREE.HemisphereLight(0xd2d4f2, 0x2a2a48, 1.15);
const moon = new THREE.DirectionalLight(0xdcdcf5, 0.95);
moon.position.set(-0.55, 1, 0.35);
hemi.layers.enableAll();
moon.layers.enableAll();
scene.add(hemi, moon);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 2, 6000);
const mapCam = new MapCamera(camera, renderer.domElement);
const me = new MeMarker();
const avatar = new Avatar();
avatar.group.visible = false;
scene.add(me.group, avatar.group);
// The avatar and its marker draw in a second pass on top of the city, like Snap.
const OVERLAY = 1;
for (const root of [me.group, avatar.group]) root.traverse((o) => o.layers.set(OVERLAY));
renderer.autoClear = false;

const location_ = new LocationService();
const gate = new Gate();
const labels = new LabelLayer($('labels'));
let tiles: TileManager | null = null;
let exploringElsewhere = false; // true after searching a place
let mode: 'map' | 'walk' = 'map';

const MAP_FOV = 42;
const input = new Input(renderer.domElement, $('stick'), $('btn-jump'));
const player = new PlayerController({ pushOut: (p, r, h) => tiles?.pushOut(p, r, h) ?? { x: 0, z: 0 } });
const tpCam = new ThirdPersonCamera(camera, { raycast: (o, d, max) => tiles?.raycast(o, d, max) ?? max });
input.addEventListener('exit', () => exitWalk());
input.addEventListener('lockchange', () => {
  if (mode === 'walk' && !isTouch) showHint(input.locked ? WALK_HINT : 'Click the map to look around with the mouse', !input.locked);
});
const WALK_HINT = 'WASD move · Shift sprint · Space jump · C walk · V camera · M map';

function setAvatarLayer(layer: number) {
  avatar.group.traverse((o) => o.layers.set(layer));
}

// ---------- World origin ----------
function centreWorldOn(p: LatLon) {
  if (!tiles) return;
  if (mode === 'walk') exitWalk(true);
  tiles.setOrigin(makeOrigin(p));
  labels.clear();
  mapCam.jumpTo(new THREE.Vector3(0, 0, 0));
  syncMarker(true);
}

function syncMarker(snap = false) {
  const o = tiles?.getOrigin();
  const s = location_.state;
  if (!o || !s.position || exploringElsewhere) {
    me.group.visible = false;
    return;
  }
  const { x, z } = toLocal(o, s.position);
  if (snap) me.reset();
  me.setPosition(x, z);
  me.setHeading(s.heading);
}

location_.addEventListener('change', () => {
  const s = location_.state;
  gate.status(s.status);
  if (s.position && tiles) {
    const o = tiles.getOrigin();
    const firstFix = !me.isPlaced;
    if (!o || (firstFix && !exploringElsewhere && distance(o, s.position) > REORIGIN_ON_FIX)) {
      centreWorldOn(s.position);
    } else {
      syncMarker();
    }
    if (firstFix && !exploringElsewhere && mode === 'map') mapCam.setFollowing(true);
  }
  updateStatus();
});

gate.onPrimary = () => {
  exploringElsewhere = false;
  gate.show('hidden');
  if (location_.state.status === 'idle') location_.start();
  else location_.retry();
  updateStatus();
};
gate.onPlace = (p) => {
  exploringElsewhere = true;
  mapCam.setFollowing(false);
  centreWorldOn(p);
};

// ---------- Camera tweens (map ⇄ walk) ----------
let tween: { fromP: THREE.Vector3; fromQ: THREE.Quaternion; fromFov: number; toP: THREE.Vector3; toQ: THREE.Quaternion; toFov: number; t: number; done: () => void } | null = null;

function startTween(toP: THREE.Vector3, toQ: THREE.Quaternion, toFov: number, done: () => void) {
  tween = { fromP: camera.position.clone(), fromQ: camera.quaternion.clone(), fromFov: camera.fov, toP, toQ, toFov, t: 0, done };
}

function stepTween(dt: number): boolean {
  if (!tween) return false;
  tween.t = Math.min(1, tween.t + dt / 1.1);
  const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
  camera.position.lerpVectors(tween.fromP, tween.toP, e);
  camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, e);
  camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, e);
  camera.updateProjectionMatrix();
  if (tween.t >= 1) {
    const done = tween.done;
    tween = null;
    done();
  }
  return true;
}

function enterWalk() {
  if (mode === 'walk' || tween || !tiles?.getOrigin()) return;
  const start = me.group.visible && mapCam.following ? me.position.clone() : mapCam.controls.target.clone();
  mode = 'walk';
  mapCam.controls.enabled = false;
  // Face the way the map camera was looking.
  player.spawn(start, mapCam.azimuth + Math.PI);
  tpCam.reset(player);
  camera.near = 0.1;
  camera.updateProjectionMatrix();
  setAvatarLayer(0); // at street level the avatar is occluded normally (by trees, corners…)
  input.setEnabled(true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  tpCam.pose(player, p, q);
  startTween(p, q, 58, () => {});
  setWalkUi(true);
  showHint(isTouch ? 'Left thumb to move · drag on the right to look · push the stick fully to sprint' : 'Click the map to look around with the mouse', !isTouch);
}

function exitWalk(instant = false) {
  if (mode !== 'walk') return;
  input.setEnabled(false);
  mode = 'map';
  tween = null;
  setAvatarLayer(OVERLAY);
  avatar.setOpacity(1);
  const fromP = camera.position.clone(), fromQ = camera.quaternion.clone(), fromFov = camera.fov;
  mapCam.jumpTo(player.position.clone().setY(0), 220, tpCam.yaw);
  mapCam.setFollowing(false);
  camera.near = 2;
  camera.fov = MAP_FOV;
  camera.updateProjectionMatrix();
  setWalkUi(false);
  if (instant) {
    mapCam.controls.enabled = true;
    return;
  }
  const toP = camera.position.clone(), toQ = camera.quaternion.clone();
  camera.position.copy(fromP);
  camera.quaternion.copy(fromQ);
  camera.fov = fromFov;
  startTween(toP, toQ, MAP_FOV, () => {
    mapCam.controls.enabled = true;
    mapCam.controls.update();
  });
}

function setWalkUi(on: boolean) {
  $('btn-walk').classList.toggle('on', on);
  $('btn-walk').title = on ? 'Back to map' : 'Walk mode';
  $('btn-jump').classList.toggle('hidden', !on || !isTouch);
  document.body.classList.toggle('walking', on);
  $('btn-compass').classList.toggle('hidden', on);
  if (!on) $('hint').classList.add('hidden');
}

let hintTimer = 0;
function showHint(text: string, sticky = false) {
  const el = $('hint');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(hintTimer);
  if (!sticky) hintTimer = window.setTimeout(() => el.classList.add('hidden'), 6000);
}

// ---------- HUD ----------
function updateStatus() {
  const chip = $('status');
  const st = location_.state.status;
  let text = '';
  if (st === 'locating' && !exploringElsewhere) text = 'Finding you…';
  else if (tiles && tiles.loadingCount > 0) text = 'Loading map…';
  chip.textContent = text;
  chip.classList.toggle('hidden', !text);
}

function buildChips() {
  const bar = $('chips');
  let active: CategoryId | null = null;
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'fchip';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<svg viewBox="0 0 24 24">${c.icon}</svg><span></span>`;
    b.querySelector('span')!.textContent = c.label;
    b.addEventListener('click', () => {
      active = active === c.id ? null : c.id;
      bar.querySelectorAll('.fchip').forEach((el) => el.setAttribute('aria-pressed', String(el === b && active !== null)));
      labels.setFilter(active);
    });
    bar.appendChild(b);
  }
}
buildChips();

labels.onSelect = (poi) => {
  if (mode === 'map') mapCam.flyTo(new THREE.Vector3(poi.x, 0, poi.z), false);
};

$('btn-compass').addEventListener('click', () => mapCam.resetNorth());
$('btn-search').addEventListener('click', () => gate.show('search', true));
$('btn-walk').addEventListener('click', () => (mode === 'walk' ? exitWalk() : enterWalk()));
$('btn-recenter').addEventListener('click', () => {
  if (mode === 'walk') exitWalk(true);
  if (exploringElsewhere && location_.state.position) {
    exploringElsewhere = false;
    centreWorldOn(location_.state.position);
  }
  if (me.isPlaced) mapCam.flyTo(me.position);
});
function updateRecenter() {
  const canRecenter = !!location_.state.position && (!mapCam.following || exploringElsewhere || mode === 'walk');
  $('btn-recenter').classList.toggle('hidden', !canRecenter);
}

// "Me" bubble above the avatar's head and "Me now" tag at its feet.
const tmp = new THREE.Vector3();
function placeScreen(el: HTMLElement, world: THREE.Vector3, anchor: string) {
  tmp.copy(world).project(camera);
  const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
  el.classList.toggle('hidden', !visible);
  if (!visible) return;
  const x = (tmp.x * 0.5 + 0.5) * innerWidth, y = (-tmp.y * 0.5 + 0.5) * innerHeight;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ${anchor}`;
}

// ---------- Boot ----------
async function boot() {
  let template: string;
  try {
    const tj = await (await fetch(TILEJSON)).json();
    template = tj.tiles[0];
  } catch {
    $('status').textContent = 'Map data is unavailable — check your connection';
    $('status').classList.remove('hidden');
    return;
  }
  tiles = new TileManager(template);
  tiles.addEventListener('tileloaded', updateStatus);
  scene.add(tiles.root);

  const override = LocationService.urlOverride();
  if (override) {
    gate.show('hidden');
    location_.start();
    return;
  }
  // Show the last place we saw the user behind the intro card so it isn't empty.
  const last = LocationService.lastKnown();
  if (last) centreWorldOn(last);
  gate.show('intro');
}

// ---------- Loop ----------
const timer = new THREE.Timer();
timer.connect(document);
const lastAvatarPos = new THREE.Vector3();

renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  const tweening = stepTween(dt);
  if (mode === 'walk') {
    const frame = input.read(dt);
    if (!tweening) {
      player.update(dt, frame, tpCam.yaw);
      tpCam.update(dt, frame, player);
    }
  }
  const gpsOnMap = me.isPlaced && !exploringElsewhere && !!location_.state.position;
  me.group.visible = gpsOnMap && mode === 'map';
  if (mode === 'map' && !tweening) mapCam.update(dt, mapCam.following && gpsOnMap ? me.position : null);

  const focus = mode === 'walk' ? player.position : mapCam.controls.target;
  const dist = mode === 'walk' ? 120 : mapCam.distance;

  if (tiles?.getOrigin()) {
    // Keep coordinates small when the user pans or travels far from the origin.
    if (Math.hypot(focus.x, focus.z) > REBASE_DISTANCE) {
      const shift = focus.clone().setY(0);
      tiles.setOrigin(makeOrigin(fromLocal(tiles.getOrigin()!, shift.x, shift.z)));
      mapCam.controls.target.sub(shift);
      camera.position.sub(shift);
      player.position.sub(shift);
      tpCam.shift(shift);
      labels.clear();
      syncMarker(true);
    }
    tiles.update(focus.x, focus.z, mode === 'map' && dist > 700 ? 2 : 1);
  }

  // Avatar: stands on your GPS position on the map, or wherever you walk to.
  me.update(dt, t, dist);
  if (mode === 'walk') {
    avatar.group.visible = true;
    avatar.group.position.copy(player.position);
    avatar.group.scale.setScalar(1);
    avatar.setYaw(player.facing);
    avatar.update(dt, player.horizontalSpeed, player.turnRate, !player.grounded);
    avatar.setOpacity(tweening ? 1 : tpCam.characterOpacity);
  } else {
    avatar.group.visible = gpsOnMap;
    if (gpsOnMap) {
      const speed = lastAvatarPos.distanceTo(me.position) / Math.max(dt, 1e-4);
      if (location_.state.heading != null) avatar.faceHeading(location_.state.heading);
      else avatar.faceDirection(me.position.x - lastAvatarPos.x, me.position.z - lastAvatarPos.z);
      avatar.group.position.copy(me.position);
      avatar.group.scale.setScalar(THREE.MathUtils.clamp(dist / 25, 2, 20));
      avatar.update(dt, speed);
    }
  }
  lastAvatarPos.copy(avatar.group.position);

  if (mode === 'walk') {
    fog.near = 60;
    fog.far = 700;
  } else {
    fog.near = 180 + dist * 0.7;
    fog.far = Math.min(900 + dist * 2.3, 3600);
  }

  const showMe = avatar.group.visible && mode === 'map' && !tweening;
  if (showMe) {
    placeScreen($('me-bubble'), tmp.set(avatar.group.position.x, avatar.headHeight + 0.4 * avatar.group.scale.y, avatar.group.position.z), 'translate(-50%, -100%)');
    placeScreen($('me-tag'), tmp.set(avatar.group.position.x, 0, avatar.group.position.z), 'translate(-50%, 6px)');
  } else {
    $('me-bubble').classList.add('hidden');
    $('me-tag').classList.add('hidden');
  }

  if (tiles) {
    const reserved: [number, number, number, number][] = [];
    if (showMe) {
      const b = $('me-bubble').getBoundingClientRect(), tg = $('me-tag').getBoundingClientRect();
      reserved.push([Math.min(b.left, tg.left) - 10, b.top - 10, Math.max(b.right, tg.right) + 10, tg.bottom + 10]);
    }
    labels.update(tiles.visiblePois(), camera, focus, dist, performance.now(), reserved);
  }
  ($('compass-needle') as unknown as SVGElement).style.transform = `rotate(${(-mapCam.azimuth * 180) / Math.PI}deg)`;
  updateRecenter();
  renderer.clear();
  camera.layers.set(0);
  renderer.render(scene, camera);
  renderer.clearDepth();
  camera.layers.set(OVERLAY);
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (import.meta.env.DEV) Object.assign(window, { __snap: { renderer, scene, camera, mapCam, player, tpCam, input, labels, enterWalk, exitWalk, get tiles() { return tiles; } } });

boot();

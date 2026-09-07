import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Pods } from './pods.js';
import { Explosions } from './explosions.js';
import { Starfield } from './starfield.js';
import { Radar } from './radar.js';
import { OrientationInset } from './orientation.js';
import { HUD } from './hud.js';
import { PODS_PER_LEVEL } from './levels.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);
scene.fog = new THREE.FogExp2(0x02040a, 0.00012);

const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 25000);

scene.add(new THREE.AmbientLight(0x556677, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(0.4, 1, 0.6);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4466ff, 0.5);
rim.position.set(-0.5, -0.3, -0.7);
scene.add(rim);

const input = new Input(canvas);
const audio = new Audio();
const player = new Player();
const weapons = new Weapons(scene);
const explosions = new Explosions(scene);
const enemies = new Enemies(scene);
const pods = new Pods(scene);
const starfield = new Starfield(scene);
const radar = new Radar();
const orient = new OrientationInset();
const hud = new HUD();

let score = 0;
let state = 'playing';   // 'playing' | 'won' | 'lost'
let stateTimer = 0;
let deadAt = 0;          // performance.now() when the player was destroyed

enemies.onKill = (e) => { score += e.stats.score; };

window.__nw = { scene, camera, player, enemies, pods, weapons, explosions, radar, input, audio, hud, paused: false, get score() { return score; }, get state() { return state; } };

canvas.addEventListener('mousedown', () => { audio.resume(); hud.hideHelp(); }, { once: true });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // dead: the fight goes on without you — any key (after a beat) relaunches
  if (!player.alive) {
    if (performance.now() - deadAt > 700) player.respawn();
    return;
  }
  if (e.code === 'KeyH') hud.showHelp(4);
  if (e.code === 'BracketRight' || e.code === 'Equal') { radar.zoom(1); hud.flash(`SCAN Z${radar.zoomLevel} · ${radar.range}`, 0.9); }
  if (e.code === 'BracketLeft' || e.code === 'Minus') { radar.zoom(-1); hud.flash(`SCAN Z${radar.zoomLevel} · ${radar.range}`, 0.9); }
});

function startLevel(n) {
  enemies.startLevel(n);
  pods.spawnLevel(PODS_PER_LEVEL, player.position);
  player.reset();
  state = 'playing';
  hud.flash('LEVEL ' + n, 2.2);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

const onWeaponEvent = (kind) => {
  if (kind === 'podlost') hud.flash('POD DOWN', 1.0);
};

// spectator camera state (while the player is dead the world keeps running)
const UP = new THREE.Vector3(0, 1, 0);
const specPos = new THREE.Vector3();
const specQuat = new THREE.Quaternion();
const _lookM = new THREE.Matrix4();
const _lookAt = new THREE.Vector3();
const _targetQ = new THREE.Quaternion();

// missile lock: nearest enemy whose screen position sits inside the centre ring
const LOCK_PX = 64;                 // must match #lock ring radius
const _ndc = new THREE.Vector3();
function computeLock(W, H) {
  if (!player.alive) return null;
  let best = null;
  let bestDist = Infinity;
  const cx = W / 2;
  const cy = H / 2;
  for (const e of enemies.list) {
    if (e.dead) continue;
    _ndc.copy(e.position).project(camera);
    if (_ndc.z >= 1) continue;                     // behind camera / clipped
    const sx = (_ndc.x * 0.5 + 0.5) * W;
    const sy = (-_ndc.y * 0.5 + 0.5) * H;
    if (Math.hypot(sx - cx, sy - cy) > LOCK_PX) continue;   // outside the ring
    const d = e.position.distanceToSquared(player.position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best;
}

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  if (!Number.isFinite(dt) || dt < 0) dt = 0;

  const wasAlive = player.alive;
  // the world keeps simulating even when the player is dead (spectating);
  // only a manual debug pause freezes it
  const simDt = window.__nw.paused ? 0 : dt;

  player.update(dt, input, weapons, enemies, audio);
  enemies.update(simDt, player, pods, weapons, audio);
  pods.update(simDt);
  if (simDt > 0) {
    if (enemies.checkRam(player, explosions, audio)) hud.flash('COLLISION', 1.2);
    enemies.checkPodStrikes(pods, explosions, audio);
  }
  weapons.update(simDt, player, enemies, pods, explosions, audio, onWeaponEvent);
  explosions.update(simDt);
  starfield.update(player);
  radar.update(player, enemies, pods);
  orient.update(player);

  // player just died -> mark the moment, hold the spectator camera here
  if (wasAlive && !player.alive) {
    deadAt = now;
    specPos.copy(player.position);
    specQuat.copy(player.quaternion);
    hud.flash('', 0);
  }

  // --- level win / lose (paused while the player is dead) --------------
  if (simDt > 0 && player.alive && state === 'playing') {
    if (pods.alive === 0) {
      state = 'lost';
      stateTimer = 3.0;
      hud.flash('ALL PODS LOST — LEVEL FAILED', 3.0);
    } else if (enemies.cleared()) {
      state = 'won';
      stateTimer = 2.8;
      hud.flash('LEVEL ' + enemies.level + ' CLEARED', 2.8);
    }
  } else if (simDt > 0 && player.alive && state !== 'playing') {
    stateTimer -= simDt;
    if (stateTimer <= 0) {
      startLevel(state === 'won' ? enemies.level + 1 : enemies.level);
    }
  }

  // camera: first-person while alive; a fixed wreck-cam that pans to the
  // nearest action while dead
  if (player.alive) {
    camera.position.copy(player.position);
    camera.quaternion.copy(player.quaternion);
  } else {
    _lookAt.copy(pods.centroid);
    let nd = Infinity;
    for (const e of enemies.list) {
      const d = e.position.distanceToSquared(specPos);
      if (d < nd) { nd = d; _lookAt.copy(e.position); }
    }
    _lookM.lookAt(specPos, _lookAt, UP);
    _targetQ.setFromRotationMatrix(_lookM);
    specQuat.slerp(_targetQ, 1 - Math.pow(0.05, dt));
    camera.position.copy(specPos);
    camera.quaternion.copy(specQuat);
  }

  const W = window.innerWidth;
  const H = window.innerHeight;

  renderer.setViewport(0, 0, W, H);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.render(scene, camera);

  const oi = 130;
  orient.render(renderer, { x: 16, y: H - 16 - oi, w: oi, h: oi });

  const rw = Math.min(320, W * 0.34);
  const rh = rw * 0.6;
  radar.render(renderer, { x: W - 16 - rw, y: 16, w: rw, h: rh });

  renderer.setViewport(0, 0, W, H);

  // missile lock is computed from the freshly-updated camera; used by the
  // NEXT frame's missile launch and drawn this frame by the HUD
  const lockTarget = computeLock(W, H);
  player.lockTarget = lockTarget;

  hud.layout({ left: 16, top: 16, h: oi }, { right: 16, bottom: 16, h: rh });
  hud.update(dt, player, enemies, pods, score, radar, {
    locked: !!lockTarget,
    missileActive: weapons.playerMissileActive(),
    missileGuided: weapons.playerMissileGuided(),
  });
}

startLevel(1);
requestAnimationFrame(frame);

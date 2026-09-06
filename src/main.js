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

enemies.onKill = (e) => { score += e.stats.score; };

window.__nw = { scene, camera, player, enemies, pods, weapons, explosions, radar, paused: false, get score() { return score; }, get state() { return state; } };

canvas.addEventListener('mousedown', () => { audio.resume(); hud.hideHelp(); }, { once: true });

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && !player.alive) player.reset();
  if (e.code === 'BracketRight' || e.code === 'Equal') radar.zoom(1);   // ] or =  -> zoom in (shorter range)
  if (e.code === 'BracketLeft' || e.code === 'Minus') radar.zoom(-1);   // [ or -  -> zoom out (longer range)
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

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  if (window.__nw.paused) dt = 0;

  player.update(dt, input, weapons, enemies, audio);
  enemies.update(dt, player, pods, weapons, audio);
  pods.update(dt);
  if (enemies.checkRam(player, explosions, audio)) hud.flash('COLLISION', 1.2);
  enemies.checkPodStrikes(pods, explosions, audio);
  weapons.update(dt, player, enemies, pods, explosions, audio, onWeaponEvent);
  explosions.update(dt);
  starfield.update(player);
  radar.update(player, enemies, pods);
  orient.update(player);

  // --- level win / lose -------------------------------------------------
  if (state === 'playing') {
    if (pods.alive === 0) {
      state = 'lost';
      stateTimer = 3.0;
      hud.flash('ALL PODS LOST — LEVEL FAILED', 3.0);
    } else if (enemies.cleared()) {
      state = 'won';
      stateTimer = 2.8;
      hud.flash('LEVEL ' + enemies.level + ' CLEARED', 2.8);
    }
  } else if (dt > 0) {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      startLevel(state === 'won' ? enemies.level + 1 : enemies.level);
    }
  }

  // first-person cockpit camera
  camera.position.copy(player.position);
  camera.quaternion.copy(player.quaternion);

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

  hud.layout({ left: 16, top: 16, h: oi }, { right: 16, bottom: 16, h: rh });
  hud.update(dt, player, enemies, pods, score, radar);
}

startLevel(1);
requestAnimationFrame(frame);

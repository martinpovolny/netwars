import * as THREE from 'three';
import { Input, goFullscreen, toggleFullscreen } from './input.js';
import { Audio } from './audio.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Pods } from './pods.js';
import { Bonuses } from './bonuses.js';
import { Explosions } from './explosions.js';
import { Environment } from './render/environment.js';
import { Radar } from './radar.js';
import { OrientationInset } from './orientation.js';
import { HUD } from './hud.js';
import { ScreenShake } from './shake.js';
import { Settings } from './settings.js';
import { PODS_PER_LEVEL, ENEMY_TYPES, goalsForLevel } from './levels.js';
import K from '../shared/constants.js';
import { makeWorld, startWorldLevel, stepWorld } from '../shared/sim/world.js';
import { showFatalError } from './webgl.js';
import { Run } from './run.js';
import { tapAction } from './taps.js';
import { loadName, saveName, scoresUrl, fetchScores, submitScore } from './scores.js';

const canvas = document.getElementById('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  // main.js already checks hasWebGL() before importing this module, but a
  // browser can pass that probe and still fail to hand out a real context
  // (driver blocklist, "too many active WebGL contexts", ...).
  showFatalError(String(err && err.message || err));
  throw err;
}
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
const bonuses = new Bonuses(scene);
const environment = new Environment(scene);
const radar = new Radar();
const orient = new OrientationInset();
const hud = new HUD();
const shake = new ScreenShake();
const settings = new Settings(audio, environment);

// the shared, authoritative world — the same code the Go server runs. SP owns
// the ship locally (player.update / stepShip) and hands the rest to stepWorld.
const world = makeWorld({ K, rng: Math.random, ENEMY_TYPES, goalsForLevel, ship: player });
world.fx = audio;                 // client-only: the enemy-laser cue
weapons.attach(world.projectiles);
enemies.attach(world.fleet);
pods.attach(world.pods);
bonuses.attach(world.bonuses);

let deadAt = 0;          // performance.now() when the player was destroyed

// ---- run state + high scores -------------------------------------------
// Lives and the pod-rescue bonus live here (not in the shared sim, which the
// Go server mirrors). Displayed/submitted score = kills + pod bonuses.
let run = new Run();
const totalScore = () => world.score + run.bonusScore;
const SCORES_URL = scoresUrl(new URLSearchParams(location.hash.split('?')[1] || '').get('server_id'));
let prevFsm = 'playing';
// null while playing; else 'wait' (probing backend) | 'entry' (name prompt) |
// 'submitting' | 'table' (results shown) | 'plain' (no backend: any key restarts)
let goState = null;
let goTable = null;       // the table fetched at game over (fallback if submit fails)
let goReadyAt = 0;        // ignore keys until then so the submitting ENTER can't dismiss the table

async function beginGameOver() {
  goState = 'wait';
  if (document.pointerLockElement) document.exitPointerLock?.();
  const result = () => ({ level: world.fleet.level, score: totalScore() });
  hud.showGameOver({ ...result(), waiting: true });
  goTable = await fetchScores(SCORES_URL);
  if (goTable) {
    goState = 'entry';
    hud.showGameOver({ ...result(), canSubmit: true, defaultName: loadName() });
  } else {
    goState = 'plain';
    goReadyAt = performance.now() + 500;
    hud.showGameOver(result());
  }
}

async function submitName() {
  goState = 'submitting';
  const name = hud.nameValue.trim() || loadName() || 'Pilot';
  const entry = { name, level: world.fleet.level, score: totalScore() };
  try {
    const res = await submitScore(SCORES_URL, entry);
    if (res) {
      saveName(name);
      hud.showTable(res.table, { highlightRank: res.rank, recorded: true });
    } else {
      hud.showTable(goTable, { recorded: false });
    }
  } finally {
    // whatever happened above, game over must stay dismissable
    goState = 'table';
    goReadyAt = performance.now() + 500;
  }
}

function skipSubmit() {
  hud.showTable(goTable, { recorded: true });   // skipped on purpose: no "(not recorded)"
  goState = 'table';
  goReadyAt = performance.now() + 500;
}

function newRun() {
  hud.hideGameOver();
  goState = null;
  run = new Run();
  world.score = 0;
  prevFsm = 'playing';
  input.keys.clear();
  startLevel(1);
}

// Touch / mouse: a tap relaunches a dead ship and dismisses the game-over
// screen (phones have no "any key"). The pause button, settings panel and the
// name prompt's own buttons keep their own taps.
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('#pause-btn, #settings, #go-entry')) return;
  const act = tapAction({ alive: player.alive, goState, now: performance.now(), deadAt, goReadyAt });
  if (act === 'respawn') player.respawn();
  else if (act === 'newRun') newRun();
});
document.getElementById('go-submit')?.addEventListener('click', () => { if (goState === 'entry') submitName(); });
document.getElementById('go-skip')?.addEventListener('click', () => { if (goState === 'entry') skipSubmit(); });

function onGameOverKey(e) {
  if (goState === 'entry') {
    // e.key too: virtual keyboards don't always report a useful e.code
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') submitName();
    else if (e.code === 'Escape') skipSubmit();
  } else if ((goState === 'table' || goState === 'plain') && performance.now() >= goReadyAt) {
    newRun();
  }
}

window.__nw = { scene, camera, player, world, enemies, pods, bonuses, weapons, explosions, environment, radar, input, audio, hud, settings, paused: false, get score() { return world.score; }, get run() { return run; }, get state() { return world.fsm.state; } };

canvas.addEventListener('mousedown', () => { goFullscreen(); audio.resume(); audio.startMusicIfWanted(); hud.hideHelp(); }, { once: true });

// pause: freezes the whole sim (SP only — a network game can't pause other
// people's clocks). window.__nw.paused already gated the world tick before
// this; the frame loop below also skips player.update() entirely while
// paused, not just with dt=0, so a cooldown-ready shot can't sneak out and
// mouse motion doesn't snap the ship the instant you resume.
const pauseBtn = document.getElementById('pause-btn');
const pausedBanner = document.getElementById('paused');
function setPaused(v) {
  window.__nw.paused = v;
  pausedBanner.classList.toggle('show', v);
  pauseBtn.classList.toggle('on', v);
  pauseBtn.innerHTML = v ? '&#9654; Resume' : '&#10074;&#10074; Pause';
}
pauseBtn.addEventListener('click', () => setPaused(!window.__nw.paused));

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // game over owns the keyboard (the name field must get every key untouched)
  if (goState) { onGameOverKey(e); return; }
  // settings panel first: while it's open, up/down/left/right/escape belong
  // to it, not flight or any other single-key toggle below.
  if (settings.handleKey(e.code)) return;
  if (e.code === 'Enter') { toggleFullscreen(); return; }
  if (e.code === 'KeyM') { hud.flash(audio.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', 1.2); return; }
  if (e.code === 'KeyL') { hud.flash(environment.toggleConstellations() ? 'CONSTELLATIONS ON' : 'CONSTELLATIONS OFF', 1.2); return; }
  if (e.code === 'KeyO') { settings.toggle(); return; }
  if (e.code === 'KeyP') { setPaused(!window.__nw.paused); return; }
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
  // player.reset() MUST run first: startWorldLevel() spawns pods (and, via
  // the fleet's pod-centroid anchor, enemies) around world.ship.position as
  // it stands *right now* — reset() first so that's the fresh spawn point,
  // not wherever the player happened to end the previous level. The Go
  // server already gets this order right (arena.go sets Ship.Pos before
  // calling StartWorldLevel); this only fixes SP, which had it backwards.
  player.reset();
  startWorldLevel(world, n, PODS_PER_LEVEL);
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

// stepWorld() hands back a flat events[] each tick; this is the client's
// reaction — explosions, sound, HUD flashes, level (re)starts. (Scoring is
// done inside stepWorld.)
function handleWorldEvent(ev) {
  switch (ev.kind) {
    case 'bonusPicked':
      if (ev.bonus === 'missiles') { player.giveMissiles(6); hud.flash('+6 MISSILES', 1.4); }
      else if (ev.bonus === 'guided') { player.guidedShots = K.bonuses.guidedRounds; hud.flash(`+${K.bonuses.guidedRounds} GUIDED ROUNDS`, 1.4); }
      else { player.repair(35); hud.flash('+35 HULL', 1.4); }
      explosions.hit(player.position, ev.bonus === 'repair' ? 0x2fe06a : ev.bonus === 'guided' ? 0xb26bff : 0x3ad0ff);
      audio.pickup();
      break;
    case 'ram':
      explosions.blast(ev.pos, 0xffcc55);
      audio.boom();
      if (ev.hurt) { audio.hit(); shake.kick(1); }
      hud.flash('COLLISION', 1.2);
      break;
    case 'podStrikeKill':
      explosions.blast(ev.pos, 0xff5ad0);
      audio.boom();
      break;
    case 'enemyHit': explosions.hit(ev.pos, ev.isMissile ? 0xffd23a : 0xbfe8ff); break;
    case 'enemyKill': explosions.blast(ev.pos, ev.accent); audio?.boom(); break;
    case 'missileBurst': explosions.blast(ev.pos, 0xffd23a); break;
    case 'playerHit': explosions.spark(ev.pos); if (!ev.absorbed) { audio?.hit(); shake.kick(0.5); } break;
    case 'podHit': explosions.spark(ev.pos); break;
    case 'podKill': explosions.blast(ev.pos, 0xff5ad0); audio?.boom(); hud.flash('POD DOWN', 1.0); break;
    // 'level' is handled by the frame loop (after the render pass) so a level
    // transition swaps state on exactly the same frame as the old code.
  }
}

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
  // a manual pause OR the settings panel being open both freeze it —
  // settings doesn't touch window.__nw.paused itself (that also shows the
  // "Paused" banner, which would double up with the settings panel), it
  // just gets ORed in here.
  const paused = window.__nw.paused || settings.isOpen || goState !== null;
  const simDt = paused ? 0 : dt;

  // client-predicted own ship — fully skipped while paused (not just given
  // dt=0), since a cooldown-ready shot fires as soon as it's asked for
  // regardless of dt. Still drain the accumulated mouse motion so the ship
  // doesn't snap the instant you resume.
  if (paused) input.takeMouse();
  else player.update(dt, input, weapons, enemies, audio);

  // one authoritative tick over enemies / pods / bonuses / projectiles /
  // collisions / level FSM (the same stepWorld the Go server runs)
  let levelAction = null;
  for (const ev of stepWorld(world, simDt)) {
    if (ev.kind === 'level') levelAction = ev.action;
    else handleWorldEvent(ev);
  }

  // render passes: sync meshes from the world state stepWorld just produced
  enemies.update(simDt);
  pods.update(simDt);
  bonuses.update(simDt);
  weapons.update(simDt);
  explosions.update(simDt);
  shake.update(simDt);
  const pr = world.projectiles;
  const radarMissiles = [];
  for (let mi = 0; mi < pr.max; mi++) {
    if (pr.ttl[mi] > 0 && pr.kind[mi] === 'missile') radarMissiles.push({ position: pr.pos[mi], mine: true });
  }
  radar.update(player, enemies, pods, bonuses, null, radarMissiles, null, simDt);
  if (radar.autoZoomStarted) hud.flash('SCANNER AUTO-RANGING…', 1.2);
  else if (radar.autoZoomMaxedOut) hud.flash('NO CONTACTS IN RANGE', 1.6);
  orient.update(player);

  // lives / pod bonus, keyed off the level FSM's transitions (it sits in
  // 'won'/'lost' for several frames, so act only on the change)
  let flashNote = '';
  if (world.fsm.state !== prevFsm) {
    if (world.fsm.state === 'won') {
      const bonus = run.levelCleared(world.fleet.level, pods.alive);
      flashNote = `  ·  PODS +${bonus}  ·  +1 LIFE`;
    } else if (world.fsm.state === 'lost') {
      run.loseLife();
    }
    prevFsm = world.fsm.state;
  }

  // player just died -> mark the moment, hold the spectator camera here
  if (wasAlive && !player.alive) {
    run.loseLife();
    deadAt = now;
    specPos.copy(player.position);
    specQuat.copy(player.quaternion);
    hud.flash('', 0);
  }

  if (run.isOver && goState === null) beginGameOver();

  // level (re)start happens here — after the render pass — so the transition
  // lands on the same frame as the pre-stepWorld code
  if (levelAction) {
    if (levelAction.flash) hud.flash(levelAction.flash + flashNote, levelAction.hold);
    if (levelAction.startLevel) startLevel(levelAction.startLevel);
  }

  // camera: first-person while alive; a fixed wreck-cam that pans to the
  // nearest action while dead
  if (player.alive) {
    camera.position.copy(player.position);
    camera.quaternion.copy(player.quaternion);
    shake.apply(camera);
  } else {
    _lookAt.copy(pods.centroid);
    let nd = Infinity;
    for (const e of enemies.list) {
      const d = e.position.distanceToSquared(specPos);
      if (d < nd) { nd = d; _lookAt.copy(e.position); }
    }
    _lookM.lookAt(specPos, _lookAt, UP);
    _targetQ.setFromRotationMatrix(_lookM);
    specQuat.slerp(_targetQ, 1 - Math.pow(0.05, simDt));
    camera.position.copy(specPos);
    camera.quaternion.copy(specQuat);
  }

  // background tracks the final camera position (stars never translate when
  // you fly), so update it after the camera is placed
  environment.update(player, camera);

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
  hud.setLives(run.lives);
  hud.update(dt, player, enemies, pods, totalScore(), radar, {
    locked: !!lockTarget,
    missileActive: weapons.playerMissileActive(),
    missileGuided: weapons.playerMissileGuided(),
  });
}

startLevel(1);
requestAnimationFrame(frame);

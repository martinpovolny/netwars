// Online mode. Connects to the Go arena server, predicts the local ship, and
// renders the shared world from server snapshots. Only loaded when the URL has
// a #fragment (client/main.js); the plain SP path never touches this file.
//
// A failed connect falls back to single-player (import('./sp.js')).
//
// M2.5a: connect + snapshot-driven rendering + input send + a light reconcile.
// Client-side interpolation of remote entities and full input reconciliation
// against ackSeq are M2.5b.
import * as THREE from 'three';
import { Input } from './input.js';
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
import { ENEMY_TYPES } from './levels.js';
import { makeDart } from './ships.js';
import K from '../shared/constants.js';

const HELLO_TIMEOUT = 6000;

export async function startNetwork({ session, serverId, mode }) {
  const host = serverId || location.host;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${host}/ws`;

  let conn;
  try {
    conn = await connect(url, { session, mode });
  } catch (err) {
    console.warn(
      `[netwars] could not join ${url} (${err && err.message || err}). Starting single-player.`,
    );
    await import('./sp.js');
    return;
  }
  console.log(`[netwars] joined ${url} as ${conn.welcome.playerId} (session "${session || 'default'}", ${mode})`);
  runOnline(conn, { session, mode });
}

// --- connection ---------------------------------------------------------

function connect(url, { session, mode }) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { ws.close(); reject(new Error('welcome timed out')); }, HELLO_TIMEOUT);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', session: session || 'default', mode: mode || 'coop' }));
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('socket error')); };
    ws.onclose = () => { clearTimeout(timer); reject(new Error('closed before welcome')); };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type !== 'welcome') return;
      clearTimeout(timer);
      ws.onerror = null;
      ws.onclose = null;
      resolve({ ws, welcome: msg });
    };
  });
}

// --- the online game ---------------------------------------------------

function runOnline({ ws, welcome }, { mode }) {
  // ---- render shell (mirrors client/sp.js) --------------------------
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
  const bonuses = new Bonuses(scene);
  const environment = new Environment(scene);
  const radar = new Radar();
  const orient = new OrientationInset();
  const hud = new HUD();

  // ---- the mirrored world (fed by snapshots) -----------------------
  const world = {
    fleet: { list: [], level: welcome.snapshot.level || 1, goals: {} },   // goals: M2.6 (server sends per-class remaining)
    pods: { list: [], centroid: new THREE.Vector3(), total: K.pods.perLevel, get alive() { return this.list.length; } },
    bonuses: { list: [] },
    projectiles: makeProjStore(K.weapons.max),
    fsm: { state: welcome.snapshot.fsm || 'playing' },
    score: welcome.snapshot.score || 0,
    others: [],           // other players' ships (meshes)
  };
  enemies.attach(world.fleet);
  pods.attach(world.pods);
  bonuses.attach(world.bonuses);
  weapons.attach(world.projectiles);

  // other players' ships — a diff-rendered mesh + a radar-facing record per
  // remote ship. Each gets a distinct hue (NOT red — that reads as an enemy;
  // NOT green — that's you): amber, then teal / pink / violet for a crowd.
  const OTHER_COLORS = [0xffb020, 0x35e0d0, 0xff5ad0, 0x9b6bff];
  const otherMeshes = [];
  function syncOthers(list) {
    for (let i = 0; i < list.length; i++) {
      const color = OTHER_COLORS[i % OTHER_COLORS.length];
      if (!otherMeshes[i]) { const m = makeDart(color, 1); scene.add(m); otherMeshes[i] = m; }
      if (!world.others[i]) world.others[i] = { position: new THREE.Vector3(), alive: true, color };
      const o = list[i], m = otherMeshes[i];
      m.visible = o.alive;
      m.position.set(o.p[0], o.p[1], o.p[2]);
      m.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
      world.others[i].position.set(o.p[0], o.p[1], o.p[2]);
      world.others[i].alive = o.alive;
      world.others[i].color = color;
    }
    for (let i = list.length; i < otherMeshes.length; i++) scene.remove(otherMeshes[i]);
    otherMeshes.length = list.length;
    world.others.length = list.length;

    // player-count banner
    const players = list.length + 1;
    if (players !== world._players) {
      world._players = players;
      hud.flash(players > 1 ? `${players} PLAYERS IN ARENA` : 'WAITING FOR PLAYERS…', 2.2);
    }
  }

  // the local ship spawns/fires only on the server — a no-op weapons proxy so
  // player.update() does its flight prediction without spawning bolts locally
  const predictWeapons = {
    spawn() {},                                                   // server owns spawns
    playerMissileActive: () => world.projectiles.playerMissileActive(),
    playerMissileGuided: () => false,
  };

  applySnapshot(welcome.snapshot, true);

  window.__nw = {
    online: true, scene, camera, player, world, enemies, pods, bonuses, weapons,
    explosions, environment, radar, input, audio, hud, ws, playerId: welcome.playerId,
    paused: false, get score() { return world.score; }, get state() { return world.fsm.state; },
  };

  canvas.addEventListener('mousedown', () => { audio.resume(); hud.hideHelp(); }, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyH') hud.showHelp(4);
    if (e.code === 'BracketRight' || e.code === 'Equal') { radar.zoom(1); hud.flash(`SCAN Z${radar.zoomLevel} · ${radar.range}`, 0.9); }
    if (e.code === 'BracketLeft' || e.code === 'Minus') { radar.zoom(-1); hud.flash(`SCAN Z${radar.zoomLevel} · ${radar.range}`, 0.9); }
  });

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---- socket ----------------------------------------------------
  let ackSeq = 0;
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'snapshot': ackSeq = msg.ackSeq | 0; applySnapshot(msg, false); break;
      case 'event': for (const e of msg.events || []) handleEvent(e); break;
      case 'pong': /* RTT handling — M2.5b */ break;
    }
  };
  ws.onclose = () => { hud.flash('DISCONNECTED', 5); console.warn('[netwars] socket closed'); };

  // ---- missile lock (same as sp.js) -----------------------------
  const LOCK_PX = 64;
  const _ndc = new THREE.Vector3();
  function computeLock(W, H) {
    if (!player.alive) return null;
    let best = null, bd = Infinity;
    for (const e of enemies.list) {
      if (e.dead) continue;
      _ndc.copy(e.position).project(camera);
      if (_ndc.z >= 1) continue;
      const sx = (_ndc.x * 0.5 + 0.5) * W, sy = (-_ndc.y * 0.5 + 0.5) * H;
      if (Math.hypot(sx - W / 2, sy - H / 2) > LOCK_PX) continue;
      const d = e.position.distanceToSquared(player.position);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---- input send ---------------------------------------------
  let seq = 0;
  function sendInput() {
    if (ws.readyState !== WebSocket.OPEN) return;
    let roll = 0;
    if (input.has('KeyA')) roll += 1;
    if (input.has('KeyD')) roll -= 1;
    let thrust = 0;
    if (input.has('KeyW') || input.has('ArrowUp')) thrust += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) thrust -= 1;
    const mt = player.lockTarget ? enemies.list.indexOf(player.lockTarget) : -1;
    ws.send(JSON.stringify({
      type: 'input', seq: ++seq, t: performance.now(),
      ix: player.intent.x, iy: player.intent.y, roll, thrust,
      brake: input.has('KeyC'),
      boost: input.has('ShiftLeft') || input.has('ShiftRight'),
      stop: input.has('KeyX'),
      gun: input.has('Space') || input.mouseFire,
      msl: input.has('KeyF') || input.mouseRight,
      mt,
    }));
  }

  // ---- event -> FX / HUD (same reactions as sp.js) ------------
  function handleEvent(ev) {
    const pos = ev.pos ? new THREE.Vector3(ev.pos[0], ev.pos[1], ev.pos[2]) : player.position;
    switch (ev.kind) {
      case 'bonusPicked':
        hud.flash(ev.bonus === 'missiles' ? '+6 MISSILES' : '+35 HULL', 1.4);
        explosions.hit(player.position, ev.bonus === 'repair' ? 0x2fe06a : 0x3ad0ff);
        audio.pickup();
        break;
      case 'ram': explosions.blast(pos, 0xffcc55); audio.boom(); if (ev.hurt) audio.hit(); hud.flash('COLLISION', 1.2); break;
      case 'podStrikeKill': explosions.blast(pos, 0xff5ad0); audio.boom(); break;
      case 'enemyHit': explosions.hit(pos, ev.isMissile ? 0xffd23a : 0xbfe8ff); break;
      case 'enemyKill': explosions.blast(pos, 0xffcc55); audio.boom(); break;
      case 'missileBurst': explosions.blast(pos, 0xffd23a); break;
      case 'playerHit': explosions.spark(pos); if (!ev.absorbed) audio.hit(); break;
      case 'podHit': explosions.spark(pos); break;
      case 'podKill': explosions.blast(pos, 0xff5ad0); audio.boom(); hud.flash('POD DOWN', 1.0); break;
      case 'level':
        if (ev.flash) hud.flash(ev.flash, ev.hold || 2.5);
        player.reset();
        break;
    }
  }

  // ---- snapshot -> world ------------------------------------
  const _v = new THREE.Vector3();
  function applySnapshot(s, first) {
    world.fleet.level = s.level;
    world.score = s.score;
    world.fsm.state = s.fsm;

    // own ship: authoritative for hull/missiles/alive; nudge position toward
    // the server (crude reconcile — proper prediction reconcile is M2.5b)
    const sh = s.ship;
    player.hull = sh.hull;
    player.missiles = sh.msl;
    player.alive = sh.alive;
    if (first) {
      player.position.set(sh.p[0], sh.p[1], sh.p[2]);
      player.velocity.set(sh.v[0], sh.v[1], sh.v[2]);
      player.quaternion.set(sh.q[0], sh.q[1], sh.q[2], sh.q[3]);
    } else {
      _v.set(sh.p[0], sh.p[1], sh.p[2]);
      const err = player.position.distanceTo(_v);
      player.position.lerp(_v, err > 200 ? 1 : 0.15);      // snap on a big miss, else ease
      player.velocity.set(sh.v[0], sh.v[1], sh.v[2]);
    }

    syncOthers(s.others || []);

    syncList(world.fleet.list, s.enemies || [], (dst, src) => {
      if (!dst.stats) {
        dst.type = src.t;
        dst.stats = ENEMY_TYPES[src.t] || ENEMY_TYPES.pirate;
        dst.behavior = dst.stats.behavior;
        dst.position = new THREE.Vector3();
        dst.quaternion = new THREE.Quaternion();
        dst.velocity = new THREE.Vector3();
        dst.flash = 0;
        dst.dead = false;
      }
      dst.position.set(src.p[0], src.p[1], src.p[2]);
      dst.quaternion.set(src.q[0], src.q[1], src.q[2], src.q[3]);
      dst.velocity.set(src.v[0], src.v[1], src.v[2]);
      dst.hp = src.hp;
    });

    syncList(world.pods.list, s.pods || [], (dst, src) => {
      if (!dst.position) { dst.position = new THREE.Vector3(); dst.spin = { x: 0, y: 0, z: 0 }; dst.dead = false; dst.radius = K.pods.radius; }
      dst.position.set(src.p[0], src.p[1], src.p[2]);
      dst.hp = src.hp;
    });
    world.pods.centroid.set(0, 0, 0);
    for (const p of world.pods.list) world.pods.centroid.add(p.position);
    if (world.pods.list.length) world.pods.centroid.multiplyScalar(1 / world.pods.list.length);

    syncList(world.bonuses.list, s.bonuses || [], (dst, src) => {
      if (!dst.position) { dst.position = new THREE.Vector3(); dst._t = Math.random() * 6; dst.dead = false; dst.life = 999; }
      dst.kind = src.k;
      dst.position.set(src.p[0], src.p[1], src.p[2]);
    });

    // projectiles: server sends the live ones by pool index
    const pr = world.projectiles;
    pr.ttl.fill(0);
    for (const q of s.proj || []) {
      const i = q.i | 0;
      if (i < 0 || i >= pr.max) continue;
      pr.pos[i].set(q.p[0], q.p[1], q.p[2]);
      pr.vel[i].set(q.v[0], q.v[1], q.v[2]);
      pr.team[i] = q.tm;
      pr.kind[i] = q.kd;
      pr.ttl[i] = 1;
    }
  }

  // ---- frame loop ------------------------------------------
  const UP = new THREE.Vector3(0, 1, 0);
  const specPos = new THREE.Vector3();
  const specQuat = new THREE.Quaternion();
  const _lookM = new THREE.Matrix4();
  const _lookAt = new THREE.Vector3();
  const _targetQ = new THREE.Quaternion();
  let deadAt = 0;
  let wasAlive = true;
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05);
    if (!Number.isFinite(dt) || dt < 0) dt = 0;

    // predict own ship (movement only; fire is server-side)
    player.update(dt, input, predictWeapons, enemies, audio);
    sendInput();

    // advance projectile ages locally so the enemy-bolt strobe animates
    const pr = world.projectiles;
    for (let i = 0; i < pr.max; i++) pr.age[i] = pr.ttl[i] > 0 ? pr.age[i] + dt : 0;

    enemies.update(dt);
    pods.update(dt);
    bonuses.update(dt);
    weapons.update(dt);
    explosions.update(dt);
    radar.update(player, enemies, pods, bonuses, world.others);
    orient.update(player);

    if (wasAlive && !player.alive) {
      deadAt = now;
      specPos.copy(player.position);
      specQuat.copy(player.quaternion);
      hud.flash('', 0);
    }
    wasAlive = player.alive;

    if (player.alive) {
      camera.position.copy(player.position);
      camera.quaternion.copy(player.quaternion);
    } else {
      _lookAt.copy(world.pods.centroid);
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

    environment.update(player, camera);

    const W = window.innerWidth, H = window.innerHeight;
    renderer.setViewport(0, 0, W, H);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, camera);

    const oi = 130;
    orient.render(renderer, { x: 16, y: H - 16 - oi, w: oi, h: oi });
    const rw = Math.min(320, W * 0.34), rh = rw * 0.6;
    radar.render(renderer, { x: W - 16 - rw, y: 16, w: rw, h: rh });
    renderer.setViewport(0, 0, W, H);

    const lockTarget = computeLock(W, H);
    player.lockTarget = lockTarget;
    hud.layout({ left: 16, top: 16, h: oi }, { right: 16, bottom: 16, h: rh });
    hud.update(dt, player, enemies, pods, world.score, radar, {
      locked: !!lockTarget,
      missileActive: weapons.playerMissileActive(),
      missileGuided: weapons.playerMissileGuided(),
    });
  }
  requestAnimationFrame(frame);
}

// --- helpers ---------------------------------------------------------

function makeProjStore(max) {
  const pos = [], vel = [];
  for (let i = 0; i < max; i++) { pos.push(new THREE.Vector3()); vel.push(new THREE.Vector3()); }
  const s = {
    max, pos, vel,
    ttl: new Float32Array(max), age: new Float32Array(max),
    team: new Array(max).fill('player'), kind: new Array(max).fill('bolt'),
    target: new Array(max).fill(null),
    spawn() {},   // net.js never spawns locally; bolts come from snapshots
    playerMissileActive() {
      for (let i = 0; i < max; i++) if (s.ttl[i] > 0 && s.team[i] === 'player' && s.kind[i] === 'missile') return true;
      return false;
    },
    playerMissileGuided() { return false; },
  };
  return s;
}

// reuse dst objects across snapshots (mesh diffing is by identity), matching
// by array index. Spawns/deaths shift indices — good enough for M2.5a; stable
// ids come in M2.5b.
function syncList(dst, src, apply) {
  for (let i = 0; i < src.length; i++) {
    if (!dst[i]) dst[i] = {};
    dst[i].dead = false;
    apply(dst[i], src[i]);
  }
  dst.length = src.length;
}

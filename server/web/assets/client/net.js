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
import { stepShip } from '../shared/sim/flight.js';
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
    projectiles: makeProjStore(K.weapons.max, welcome.playerId),
    fsm: { state: welcome.snapshot.fsm || 'playing' },
    score: welcome.snapshot.score || 0,
    others: [],           // other players' ships (meshes)
  };
  const inputLog = [];   // { seq, ctrl, dt } — a sent input, kept until the server acks it

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
      const o = list[i];
      const fresh = !otherMeshes[i];
      if (fresh) {
        const m = makeDart(color, 1);
        m.position.set(o.p[0], o.p[1], o.p[2]);
        m.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
        scene.add(m); otherMeshes[i] = m;
      }
      if (!world.others[i]) {
        world.others[i] = {
          position: new THREE.Vector3(o.p[0], o.p[1], o.p[2]),
          tpos: new THREE.Vector3(o.p[0], o.p[1], o.p[2]),
          tquat: new THREE.Quaternion(o.q[0], o.q[1], o.q[2], o.q[3]),
          alive: true, color,
        };
      }
      const m = otherMeshes[i];
      m.visible = o.alive;
      world.others[i].tpos.set(o.p[0], o.p[1], o.p[2]);
      world.others[i].tquat.set(o.q[0], o.q[1], o.q[2], o.q[3]);
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

  canvas.addEventListener('mousedown', () => { goFullscreen(); audio.resume(); audio.startMusicIfWanted(); hud.hideHelp(); }, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Enter') { toggleFullscreen(); return; }
    if (e.code === 'KeyM') { hud.flash(audio.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', 1.2); return; }
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
  let rtt = 0, lastPing = 0;
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'snapshot': ackSeq = msg.ackSeq | 0; applySnapshot(msg, false); break;
      case 'event': for (const e of msg.events || []) handleEvent(e); break;
      case 'pong': rtt = rtt ? rtt * 0.7 + (performance.now() - (msg.t || 0)) * 0.3 : performance.now() - (msg.t || 0); break;
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

  // ---- input send + prediction log ---------------------------
  let seq = 0;
  function sendInput(dt) {
    if (ws.readyState !== WebSocket.OPEN) return;
    let roll = 0;
    if (input.has('KeyA')) roll += 1;
    if (input.has('KeyD')) roll -= 1;
    let thrust = 0;
    if (input.has('KeyW') || input.has('ArrowUp')) thrust += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) thrust -= 1;
    // the exact control frame the server will integrate — logged so we can
    // replay the ones it hasn't acked yet on top of the next snapshot
    const ctrl = {
      intentX: player.intent.x, intentY: player.intent.y, roll, thrust,
      brake: input.has('KeyC'),
      boost: input.has('ShiftLeft') || input.has('ShiftRight'),
      stop: input.has('KeyX'),
    };
    const n = ++seq;
    inputLog.push({ seq: n, ctrl, dt });
    if (inputLog.length > 240) inputLog.shift();
    const mt = player.lockTarget ? enemies.list.indexOf(player.lockTarget) : -1;
    ws.send(JSON.stringify({
      type: 'input', seq: n, t: performance.now(),
      ix: ctrl.intentX, iy: ctrl.intentY, roll, thrust,
      brake: ctrl.brake, boost: ctrl.boost, stop: ctrl.stop,
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
        // two events cross a transition: the won/lost banner (has flash) and
        // the actual (re)start (has start). Only the restart resets the ship —
        // resetting on the banner too was the visible "screen resets twice".
        if (ev.flash) hud.flash(ev.flash, ev.hold || 2.5);
        if (ev.start) { player.reset(); inputLog.length = 0; }
        break;
    }
  }

  // ---- snapshot -> world ------------------------------------
  // reconcile scratch: authoritative ship state + replay of unacked inputs.
  const _recon = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  // camErr holds the still-visible part of a correction; the frame loop eases
  // it to zero so the *view* doesn't pop at the snapshot rate. Kept small — it
  // offsets the camera from where the server spawns our bolts.
  const camErr = new THREE.Vector3();
  function applySnapshot(s, first) {
    world.fleet.level = s.level;
    world.fleet.goals = s.goals || {};
    world.score = s.score;
    world.fsm.state = s.fsm;

    const sh = s.ship;
    player.hull = sh.hull;
    player.missiles = sh.msl;
    player.alive = sh.alive;
    if (first) {
      inputLog.length = 0;
      player.position.set(sh.p[0], sh.p[1], sh.p[2]);
      player.velocity.set(sh.v[0], sh.v[1], sh.v[2]);
      player.quaternion.set(sh.q[0], sh.q[1], sh.q[2], sh.q[3]);
    } else {
      // Prediction reconcile: drop inputs the server has acked, anchor on the
      // authoritative ship, then re-apply every input still in flight through
      // the same integrator the server uses. The result is a "present" that
      // agrees with the server AND with what we've already sent — no yank
      // back by ~RTT of movement every snapshot. Unpredicted server effects
      // (a hit, a ram, a knockback) survive as a real correction.
      const ack = s.ackSeq | 0;
      while (inputLog.length && inputLog[0].seq <= ack) inputLog.shift();
      _recon.position.set(sh.p[0], sh.p[1], sh.p[2]);
      _recon.velocity.set(sh.v[0], sh.v[1], sh.v[2]);
      _recon.quaternion.set(sh.q[0], sh.q[1], sh.q[2], sh.q[3]);
      for (const e of inputLog) stepShip(_recon, e.ctrl, e.dt, K.player);

      const err = player.position.distanceTo(_recon.position);
      if (err > 200) {
        // respawn / gross desync — snap hard; the logged inputs describe the
        // old trajectory and must not replay onto the new anchor next time
        camErr.set(0, 0, 0);
        inputLog.length = 0;
      } else {
        camErr.add(player.position).sub(_recon.position);
        const m = camErr.length();
        if (m > 18) camErr.multiplyScalar(18 / m);
      }
      player.position.copy(_recon.position);
      player.velocity.copy(_recon.velocity);
      player.quaternion.copy(_recon.quaternion);
    }

    syncOthers(s.others || []);

    // match on the server's stable id, not list position: when an enemy dies
    // the list shifts, and index-matching would repaint the survivors with
    // each other's meshes ("the ship type changed but it flies the same").
    // remote entities carry the server pose in tpos/tquat; the render pose
    // (position/quaternion) eases toward it each frame in interpRemote() so
    // ~30 Hz snapshots don't step visibly. New entities snap on first sight.
    syncById(world.fleet.list, s.enemies || [], (dst, src, isNew) => {
      if (isNew) {
        dst.type = src.t;
        dst.stats = ENEMY_TYPES[src.t] || ENEMY_TYPES.pirate;
        dst.behavior = dst.stats.behavior;
        dst.position = new THREE.Vector3(src.p[0], src.p[1], src.p[2]);
        dst.quaternion = new THREE.Quaternion(src.q[0], src.q[1], src.q[2], src.q[3]);
        dst.tpos = dst.position.clone();
        dst.tquat = dst.quaternion.clone();
        dst.velocity = new THREE.Vector3();
        dst.flash = 0;
        dst.dead = false;
      }
      dst.tpos.set(src.p[0], src.p[1], src.p[2]);
      dst.tquat.set(src.q[0], src.q[1], src.q[2], src.q[3]);
      dst.velocity.set(src.v[0], src.v[1], src.v[2]);
      dst.hp = src.hp;
      dst.charge = src.ch || 0;   // Guardian lance telegraph
    });

    syncList(world.pods.list, s.pods || [], (dst, src) => {
      if (!dst.position) {
        dst.position = new THREE.Vector3(src.p[0], src.p[1], src.p[2]);
        dst.tpos = dst.position.clone();
        dst.spin = { x: 0, y: 0, z: 0 }; dst.dead = false; dst.radius = K.pods.radius;
      }
      dst.tpos.set(src.p[0], src.p[1], src.p[2]);
      dst.hp = src.hp;
    });
    world.pods.centroid.set(0, 0, 0);
    for (const p of world.pods.list) world.pods.centroid.add(p.tpos);
    if (world.pods.list.length) world.pods.centroid.multiplyScalar(1 / world.pods.list.length);

    syncList(world.bonuses.list, s.bonuses || [], (dst, src) => {
      if (!dst.position) {
        dst.position = new THREE.Vector3(src.p[0], src.p[1], src.p[2]);
        dst.tpos = dst.position.clone();
        dst._t = Math.random() * 6; dst.dead = false; dst.life = 999;
      }
      dst.kind = src.k;
      dst.tpos.set(src.p[0], src.p[1], src.p[2]);
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
      pr.own[i] = q.o || '';
      pr.ttl[i] = 1;
    }
  }

  // ease every remote entity's render pose toward its latest server pose so
  // the ~30 Hz snapshot cadence doesn't read as a vibration. ~60 ms time
  // constant — enough to smooth the steps, little enough lag to still aim.
  function interpRemote(dt) {
    const a = 1 - Math.exp(-dt / 0.06);
    for (const e of world.fleet.list) {
      if (e.tpos) e.position.lerp(e.tpos, a);
      if (e.tquat) e.quaternion.slerp(e.tquat, a);
    }
    for (const p of world.pods.list) if (p.tpos) p.position.lerp(p.tpos, a);
    for (const b of world.bonuses.list) if (b.tpos) b.position.lerp(b.tpos, a);
    for (let i = 0; i < otherMeshes.length; i++) {
      const o = world.others[i], m = otherMeshes[i];
      if (!o || !m) continue;
      if (o.tpos) { m.position.lerp(o.tpos, a); o.position.copy(m.position); }
      if (o.tquat) m.quaternion.slerp(o.tquat, a);
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
    sendInput(dt);
    if (now - lastPing > 1000 && ws.readyState === WebSocket.OPEN) {
      lastPing = now;
      ws.send(JSON.stringify({ type: 'ping', t: now }));
    }

    // advance projectile ages locally so the enemy-bolt strobe animates
    const pr = world.projectiles;
    for (let i = 0; i < pr.max; i++) pr.age[i] = pr.ttl[i] > 0 ? pr.age[i] + dt : 0;

    interpRemote(dt);
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
      camErr.multiplyScalar(Math.exp(-dt / 0.05));   // ~50 ms — clear the offset fast
      if (camErr.lengthSq() < 1e-6) camErr.set(0, 0, 0);
      camera.position.copy(player.position).add(camErr);
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
      rtt,
    });
  }
  requestAnimationFrame(frame);
}

// --- helpers ---------------------------------------------------------

function makeProjStore(max, selfId) {
  const pos = [], vel = [];
  for (let i = 0; i < max; i++) { pos.push(new THREE.Vector3()); vel.push(new THREE.Vector3()); }
  const s = {
    max, pos, vel, selfId,
    ttl: new Float32Array(max), age: new Float32Array(max),
    team: new Array(max).fill('player'), kind: new Array(max).fill('bolt'),
    own: new Array(max).fill(''),
    target: new Array(max).fill(null),
    spawn() {},   // net.js never spawns locally; bolts come from snapshots
    // per-player: only *my* live missile gates *my* re-fire (co-op)
    playerMissileActive() {
      for (let i = 0; i < max; i++) if (s.ttl[i] > 0 && s.kind[i] === 'missile' && s.own[i] === s.selfId) return true;
      return false;
    },
    playerMissileGuided() { return false; },
  };
  return s;
}

// reuse dst objects across snapshots (mesh diffing is by identity), matching
// by array index. Fine for pods/bonuses where every mesh of a kind is
// identical; enemies use syncById so a mid-list death can't repaint survivors.
function syncList(dst, src, apply) {
  for (let i = 0; i < src.length; i++) {
    if (!dst[i]) dst[i] = {};
    dst[i].dead = false;
    apply(dst[i], src[i]);
  }
  dst.length = src.length;
}

// match src[].id to a persistent state object so a given entity keeps the
// same object — and therefore the same mesh — for its whole life. `dst` is
// mutated in place (same array ref the render wrapper holds). apply(o, src,
// isNew).
function syncById(dst, src, apply) {
  const byId = dst._byId || (dst._byId = new Map());
  const seen = new Set();
  const next = [];
  for (const src1 of src) {
    let o = byId.get(src1.id);
    const isNew = !o;
    if (isNew) { o = {}; byId.set(src1.id, o); }
    o.dead = false;
    seen.add(src1.id);
    apply(o, src1, isNew);
    next.push(o);
  }
  for (const id of byId.keys()) if (!seen.has(id)) byId.delete(id);
  dst.length = 0;
  for (const o of next) dst.push(o);
}

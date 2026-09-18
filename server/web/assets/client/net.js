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
import { ScreenShake } from './shake.js';
import { ENEMY_TYPES } from './levels.js';
import { makePlayerShip } from './ships.js';
import { showFatalError } from './webgl.js';
import K from '../shared/constants.js';

const HELLO_TIMEOUT = 6000;

export async function startNetwork({ session, serverId, mode, name, fragLimit, timeLimit }) {
  const host = serverId || location.host;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${host}/ws`;

  let conn;
  try {
    conn = await connect(url, { session, mode, name, fragLimit, timeLimit });
  } catch (err) {
    console.warn(
      `[netwars] could not join ${url} (${err && err.message || err}). Starting single-player.`,
    );
    await import('./sp.js');
    return;
  }
  console.log(`[netwars] joined ${url} as ${conn.welcome.playerId} (session "${session || 'default'}", ${mode})`);
  runOnline(conn, { session, mode, name });
}

// --- connection ---------------------------------------------------------

function connect(url, { session, mode, name, fragLimit, timeLimit }) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { ws.close(); reject(new Error('welcome timed out')); }, HELLO_TIMEOUT);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'hello', session: session || 'default', mode: mode || 'coop', name: name || '',
        fragLimit: fragLimit || 0, timeLimit: timeLimit || 0,
      }));
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

function runOnline({ ws, welcome }, { mode, name }) {
  const actualMode = mode || welcome.mode;
  const dm = actualMode === 'dm' || actualMode === 'tdm'; // deathmatch (either variant): PvP, frags, no AI
  const teams = actualMode === 'tdm';   // 2-team deathmatch: teammates don't hurt each other, team-scored
  const myTeam = welcome.team;          // meaningful only when teams — 0 or 1, assigned by the server at join
  const myName = name || welcome.playerId;
  // ---- render shell (mirrors client/sp.js) --------------------------
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

  // deathmatch match-over overlay — only ever shown/hidden here, driven by
  // the server's matchOver/matchStart events (frame loop just ticks the
  // countdown text; the freeze itself is server-side, this is display only).
  const matchoverEl = document.getElementById('matchover');
  const matchoverTitle = document.getElementById('matchover-title');
  const matchoverSub = document.getElementById('matchover-sub');
  let matchOverUntil = 0; // performance.now() ms timestamp, 0 = not showing

  // ---- the mirrored world (fed by snapshots) -----------------------
  const world = {
    fleet: { list: [], level: welcome.snapshot.level || 1, goals: {} },   // goals: M2.6 (server sends per-class remaining)
    pods: { list: [], centroid: new THREE.Vector3(), total: K.pods.perLevel, get alive() { return this.list.length; } },
    bonuses: { list: [] },
    projectiles: makeProjStore(K.weapons.max, welcome.playerId),
    fsm: { state: welcome.snapshot.fsm || 'playing' },
    score: welcome.snapshot.score || 0,
    others: [],           // other players' ships (meshes)
    board: welcome.snapshot.board || [],   // deathmatch scoreboard
    timeLeft: welcome.snapshot.tl || 0,    // deathmatch countdown, seconds; 0 = no time limit
    teamScores: welcome.snapshot.ts || [0, 0], // 2-team deathmatch only
  };
  const dmFragLimit = welcome.fragLimit || 0; // 0 = no limit — fixed for the arena's lifetime
  const inputLog = [];   // { seq, ctrl, dt } — a sent input, kept until the server acks it

  enemies.attach(world.fleet);
  pods.attach(world.pods);
  bonuses.attach(world.bonuses);
  weapons.attach(world.projectiles);

  // other players' ships — a diff-rendered mesh + a radar-facing record per
  // remote ship. Each gets a distinct hue (NOT red — that reads as an enemy;
  // NOT green — that's you): amber, then teal / pink / violet for a crowd.
  // 2-team deathmatch colors by TEAM instead — blue vs rose-red, ~130° apart
  // for max separation and both well clear of hostile-fire red, so at a
  // glance a hull reads as "mine" or "theirs" regardless of which specific
  // teammate/opponent it is (reserved in PLAN.md ahead of this build).
  const OTHER_COLORS = [0xffb020, 0x35e0d0, 0xff5ad0, 0x9b6bff];
  const TEAM_COLORS = [0x2f8fff, 0xff2f6e];
  const otherMeshes = [];

  // Remote ships render from a small timestamped sample buffer, not a
  // single "latest known" target eased toward every frame — see
  // interpOthers() for why: a fixed-time-constant ease assumes roughly
  // regular ~33ms snapshot delivery, and a laggier/jitterier player's
  // packets don't arrive that way, which read as visible shaking.
  const OTHER_BUF_MAX = 12; // ~400ms of history at 30Hz — comfortably covers RENDER_DELAY below + jitter
  function pushOtherSample(rec, t, p, q) {
    rec.buf.push({ t, p: [p[0], p[1], p[2]], q: [q[0], q[1], q[2], q[3]] });
    while (rec.buf.length > OTHER_BUF_MAX) rec.buf.shift();
  }

  function syncOthers(list) {
    const now = performance.now();
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const color = teams ? TEAM_COLORS[(o.tm || 0) & 1] : OTHER_COLORS[i % OTHER_COLORS.length];
      const fresh = !otherMeshes[i];
      if (fresh) {
        const m = makePlayerShip(color, 1);
        m.position.set(o.p[0], o.p[1], o.p[2]);
        m.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
        scene.add(m); otherMeshes[i] = m;
      }
      if (!world.others[i]) {
        world.others[i] = { position: new THREE.Vector3(o.p[0], o.p[1], o.p[2]), buf: [], alive: true, color };
      }
      const rec = world.others[i];
      // a slot that used to belong to a different player (join/leave
      // reshuffled indices) must not interpolate from their old position
      // toward this one — start that slot's buffer over.
      if (fresh || rec.id !== o.id) rec.buf.length = 0;
      pushOtherSample(rec, now, o.p, o.q);
      const m = otherMeshes[i];
      m.visible = o.alive;
      rec.alive = o.alive;
      rec.color = color;
      rec.id = o.id;
      rec.name = o.n || o.id;
      rec.hull = o.hull;
      rec.maxHull = o.maxHull || K.player.maxHull;
      rec.rtt = o.rt || 0; // that player's own measured RTT to the server, ms (0 = not yet known)
      rec.team = o.tm || 0; // 2-team deathmatch only
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

  // buffered render-delay interpolation for other players' ships: render
  // "now minus RENDER_DELAY" by finding the two buffered samples that
  // straddle that instant and lerping/slerping between them. Unlike easing
  // toward a single always-moving target, this never fully converges and
  // sits still during a gap only to lurch forward when the next snapshot
  // finally lands — it always has two *real* points to interpolate between,
  // so it degrades gracefully (a brief hold, not a stutter) regardless of
  // how irregular a given player's packet delivery is.
  const RENDER_DELAY = 120; // ms — enough buffer to absorb normal jitter, little enough lag to still track
  const _op = new THREE.Vector3();
  const _oq0 = new THREE.Quaternion();
  const _oq1 = new THREE.Quaternion();
  function interpOthers() {
    const renderT = performance.now() - RENDER_DELAY;
    for (let i = 0; i < otherMeshes.length; i++) {
      const o = world.others[i], m = otherMeshes[i];
      const buf = o && o.buf;
      if (!o || !m || !buf || buf.length === 0) continue;
      let s0 = buf[0], s1 = buf[buf.length - 1];
      if (renderT <= s0.t) {
        s1 = s0;
      } else if (renderT >= s1.t) {
        s0 = s1; // ran past the newest sample (a lag spike) — hold there; the
                 // next arriving sample resolves it smoothly, not with a snap
      } else {
        for (let k = 0; k < buf.length - 1; k++) {
          if (buf[k].t <= renderT && renderT <= buf[k + 1].t) { s0 = buf[k]; s1 = buf[k + 1]; break; }
        }
      }
      const span = s1.t - s0.t;
      const a = span > 0 ? (renderT - s0.t) / span : 1;
      _op.set(
        s0.p[0] + (s1.p[0] - s0.p[0]) * a,
        s0.p[1] + (s1.p[1] - s0.p[1]) * a,
        s0.p[2] + (s1.p[2] - s0.p[2]) * a,
      );
      _oq0.set(s0.q[0], s0.q[1], s0.q[2], s0.q[3]);
      _oq1.set(s1.q[0], s1.q[1], s1.q[2], s1.q[3]);
      _oq0.slerp(_oq1, a);
      m.position.copy(_op);
      m.quaternion.copy(_oq0);
      o.position.copy(_op);
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
    if (e.code === 'KeyL') { hud.flash(environment.toggleConstellations() ? 'CONSTELLATIONS ON' : 'CONSTELLATIONS OFF', 1.2); return; }
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
    const consider = (obj) => {
      _ndc.copy(obj.position).project(camera);
      if (_ndc.z >= 1) return;
      const sx = (_ndc.x * 0.5 + 0.5) * W, sy = (-_ndc.y * 0.5 + 0.5) * H;
      if (Math.hypot(sx - W / 2, sy - H / 2) > LOCK_PX) return;
      const d = obj.position.distanceToSquared(player.position);
      if (d < bd) { bd = d; best = obj; }
    };
    for (const e of enemies.list) if (!e.dead) consider(e);
    // lock onto another player (deathmatch) — but never a teammate (2-team)
    if (dm) for (const o of world.others) if (o.alive && !(teams && o.team === myTeam)) consider(o);
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
    // the lock is either an enemy (index into the fleet, co-op) or — in
    // deathmatch — another player's ship (sent by id, no shared index space)
    const enemyIdx = player.lockTarget ? enemies.list.indexOf(player.lockTarget) : -1;
    const mt = enemyIdx >= 0 ? enemyIdx : -1;
    const mp = enemyIdx < 0 && player.lockTarget ? (player.lockTarget.id || '') : '';
    ws.send(JSON.stringify({
      type: 'input', seq: n, t: performance.now(),
      ix: ctrl.intentX, iy: ctrl.intentY, roll, thrust,
      brake: ctrl.brake, boost: ctrl.boost, stop: ctrl.stop,
      gun: input.has('Space') || input.mouseFire,
      msl: input.has('KeyF') || input.mouseRight,
      mt, mp,
      // self-reported RTT so other players can see it next to our name —
      // ping/pong only round-trips this client<->server, it never reaches
      // anyone else on its own, so it has to be piggybacked here.
      rt: rtt,
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
      // ram/playerHit are broadcast to every player in the arena with no
      // victim id — "was it ME who got hit" is answered separately, from an
      // actual hull drop in applySnapshot (see there for why). audio.boom()/
      // the explosion FX below stay unconditional: a collision or impact is
      // reasonable for anyone nearby to see/hear, "you got hurt" isn't.
      case 'ram': explosions.blast(pos, 0xffcc55); audio.boom(); hud.flash('COLLISION', 1.2); break;
      case 'podStrikeKill': explosions.blast(pos, 0xff5ad0); audio.boom(); break;
      case 'enemyHit': explosions.hit(pos, ev.isMissile ? 0xffd23a : 0xbfe8ff); break;
      case 'enemyKill': explosions.blast(pos, 0xffcc55); audio.boom(); break;
      case 'missileBurst': explosions.blast(pos, 0xffd23a); break;
      case 'playerHit': explosions.spark(pos); break;
      case 'podHit': explosions.spark(pos); break;
      case 'podKill': explosions.blast(pos, 0xff5ad0); audio.boom(); hud.flash('POD DOWN', 1.0); break;
      case 'frag': {
        explosions.blast(pos, 0xff3a24); audio.boom();
        const nameOf = (id) => { const r = (world.board || []).find((x) => x.id === id); return r ? r.n : id; };
        if (ev.kr === welcome.playerId) hud.flash(`FRAGGED ${nameOf(ev.vk)}`, 1.6);
        else if (ev.vk === welcome.playerId) hud.flash(`${nameOf(ev.kr)} FRAGGED YOU`, 1.8);
        else hud.flash(`${nameOf(ev.kr)} ▸ ${nameOf(ev.vk)}`, 1.1);
        break;
      }
      case 'level':
        // two events cross a transition: the won/lost banner (has flash) and
        // the actual (re)start (has start). Only the restart resets the ship —
        // resetting on the banner too was the visible "screen resets twice".
        if (ev.flash) hud.flash(ev.flash, ev.hold || 2.5);
        if (ev.start) { player.reset(); inputLog.length = 0; }
        break;
      case 'matchOver': {
        // the arena is frozen server-side for ev.hold seconds; this just
        // drives the overlay text + countdown for that same window.
        const nameOf = (id) => { const r = (world.board || []).find((x) => x.id === id); return r ? r.n : id; };
        matchOverUntil = performance.now() + ev.hold * 1000;
        matchoverEl.classList.remove('win', 'lose');
        if (teams) {
          // ev.wn is a TEAM id ("0"/"1") here, not a player id — omitted
          // (falsy) on a tie, same omitempty convention as the dm branch.
          const TEAM_NAMES = ['TEAM A', 'TEAM B'];
          if (!ev.wn) {
            matchoverTitle.textContent = 'MATCH OVER — TIE';
          } else if (Number(ev.wn) === myTeam) {
            matchoverTitle.textContent = 'MATCH OVER — YOUR TEAM WINS';
            matchoverEl.classList.add('win');
          } else {
            matchoverTitle.textContent = `MATCH OVER — ${TEAM_NAMES[Number(ev.wn)]} WINS`;
            matchoverEl.classList.add('lose');
          }
        } else if (!ev.wn) {
          matchoverTitle.textContent = 'MATCH OVER — TIE';
        } else if (ev.wn === welcome.playerId) {
          matchoverTitle.textContent = 'MATCH OVER — YOU WIN';
          matchoverEl.classList.add('win');
        } else {
          matchoverTitle.textContent = `MATCH OVER — ${nameOf(ev.wn)} WINS`;
          matchoverEl.classList.add('lose');
        }
        matchoverEl.classList.add('show');
        audio.boom();
        break;
      }
      case 'matchStart':
        matchOverUntil = 0;
        matchoverEl.classList.remove('show');
        break;
    }
  }

  // ---- snapshot -> world ------------------------------------
  // reconcile scratch: authoritative ship state + replay of unacked inputs.
  const _recon = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), boostFuel: 0, boosting: false };
  // camErr holds the still-visible part of a correction; the frame loop eases
  // it to zero so the *view* doesn't pop at the snapshot rate. Kept small — it
  // offsets the camera from where the server spawns our bolts.
  const camErr = new THREE.Vector3();
  function applySnapshot(s, first) {
    world.fleet.level = s.level;
    world.fleet.goals = s.goals || {};
    if (s.board) world.board = s.board;
    if (s.ts) world.teamScores = s.ts; // 2-team deathmatch: [teamA frags, teamB frags]
    world.timeLeft = s.tl || 0; // deathmatch countdown, seconds; 0 = no time limit
    world.score = s.score;
    world.fsm.state = s.fsm;

    const sh = s.ship;
    // A hull drop between two of MY OWN snapshots is the one unambiguous
    // signal that I actually just took damage — the event stream
    // ('playerHit'/'ram') is broadcast to every player in the arena with no
    // victim id attached, so driving hit-feedback from it would flash/shake
    // everyone's screen whenever anyone gets hit, not just the one who did
    // (confirmed: that's exactly what the old `if (ev.hurt) audio.hit()` /
    // `if (!ev.absorbed) audio.hit()` calls did). Skipped on the very first
    // snapshot (no real "before" to compare against) and while already dead.
    if (!first && player.alive && sh.hull < player.hull - 0.01) {
      const drop = player.hull - sh.hull;
      player.hitPulse = 1;
      audio?.hit();
      shake.kick(Math.min(1, 0.4 + 0.6 * (drop / (player.maxHull * 0.15))));
    }
    player.hull = sh.hull;
    player.missiles = sh.msl;
    player.alive = sh.alive;
    if (first) {
      inputLog.length = 0;
      player.position.set(sh.p[0], sh.p[1], sh.p[2]);
      player.velocity.set(sh.v[0], sh.v[1], sh.v[2]);
      player.quaternion.set(sh.q[0], sh.q[1], sh.q[2], sh.q[3]);
      player.boostFuel = sh.bf;
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
      _recon.boostFuel = sh.bf;
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
      player.boostFuel = _recon.boostFuel;
      player.boosting = _recon.boosting;
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

  // ease AI/pod/bonus render pose toward its latest server pose so the
  // ~30 Hz snapshot cadence doesn't read as a vibration. ~60 ms time
  // constant — enough to smooth the steps, little enough lag to still aim.
  // Other players' ships use interpOthers() instead (buffered render-delay
  // interpolation) — see its comment for why a fixed-time-constant ease
  // isn't enough once a player's own packet delivery is laggy or jittery.
  function interpRemote(dt) {
    const a = 1 - Math.exp(-dt / 0.06);
    for (const e of world.fleet.list) {
      if (e.tpos) e.position.lerp(e.tpos, a);
      if (e.tquat) e.quaternion.slerp(e.tquat, a);
    }
    for (const p of world.pods.list) if (p.tpos) p.position.lerp(p.tpos, a);
    for (const b of world.bonuses.list) if (b.tpos) b.position.lerp(b.tpos, a);
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
    interpOthers();
    shake.update(dt);
    // net.js never calls Player.update() (MP prediction drives the ship via
    // stepShip directly), so hitPulse — set to 1 in applySnapshot on a real
    // hit — has nothing else decaying it back down; without this the red
    // vignette would flash once and then stay stuck at full opacity.
    if (player.hitPulse > 0) player.hitPulse = Math.max(0, player.hitPulse - dt * 2.5);
    enemies.update(dt);
    pods.update(dt);
    bonuses.update(dt);
    weapons.update(dt);
    explosions.update(dt);
    const radarMissiles = [];
    // 2-team: a teammate's missile is no more a threat than my own — the
    // radar's "mine" bucket (calm gold, not amber/red danger) covers it too.
    const ownerTeam = teams ? new Map(world.others.map((o) => [o.id, o.team])) : null;
    for (let mi = 0; mi < pr.max; mi++) {
      if (pr.ttl[mi] > 0 && pr.kind[mi] === 'missile') {
        const owner = pr.own[mi];
        const friendly = owner === pr.selfId || (teams && ownerTeam.get(owner) === myTeam);
        radarMissiles.push({ position: pr.pos[mi], mine: friendly });
      }
    }
    radar.update(player, enemies, pods, bonuses, world.others, radarMissiles, dt);
    if (radar.autoZoomStarted) hud.flash('SCANNER AUTO-RANGING…', 1.2);
    else if (radar.autoZoomMaxedOut) hud.flash('NO CONTACTS IN RANGE', 1.6);
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
      shake.apply(camera);
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
    const roster = [{ id: welcome.playerId, n: myName, hull: player.hull, maxHull: player.maxHull, a: player.alive, rt: rtt }];
    for (const o of world.others) roster.push({ id: o.id, n: o.name, hull: o.hull, maxHull: o.maxHull, a: o.alive, rt: o.rtt || 0 });

    hud.update(dt, player, enemies, pods, world.score, radar, {
      locked: !!lockTarget,
      missileActive: weapons.playerMissileActive(),
      missileGuided: weapons.playerMissileGuided(),
      rtt,
      dm,
      online: true,
      board: world.board,
      fragLimit: dmFragLimit,
      timeLeft: world.timeLeft,
      roster,
      selfId: welcome.playerId,
      teams,
      myTeam,
      teamScores: world.teamScores,
    });

    if (matchOverUntil > 0) {
      const left = Math.max(0, Math.ceil((matchOverUntil - performance.now()) / 1000));
      matchoverSub.textContent = `next match in ${left}s`;
    }
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

// Enemy AI — shared by the SP client and the Go server (authoritative).
// Pure: mutates an `enemy` state object from `ctx` (player, pods, weapons).
// Tactical constants live here as literals; the Go port keeps the same numbers
// and the golden-vector test guards parity.
import { Vector3, Quaternion } from './vec.js';

const FWD = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);

// module scratch (one enemy stepped at a time)
const _f = new Vector3(0, 0, -1);
const _d = new Vector3();
const _q = new Quaternion();
const _side = new Vector3();

function nearestPod(pos, pods) {
  let best = null;
  let bd = Infinity;
  for (const p of pods.list) {
    if (p.dead) continue;
    const d = pos.distanceToSquared(p.position);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// --- unified Newtonian flight for an enemy -----------------------------------
// Turn the nose toward `aimDir`, then thrust / brake. Momentum carries.
function fly(e, dt, aimDir, { turn = e.stats.turn, throttle = 1, brake = 0, brakeAll = 0, drag = 0.1, vmax = e.vmax } = {}) {
  const tq = _q.setFromUnitVectors(FWD, aimDir);
  e.quaternion.rotateTowards(tq, turn * dt);
  _f.copy(FWD).applyQuaternion(e.quaternion);

  if (throttle) e.velocity.addScaledVector(_f, e.thrust * throttle * dt);

  if (brake) {
    const along = e.velocity.dot(_f);
    const cut = Math.sign(along) * Math.min(Math.abs(along), e.thrust * brake * dt);
    e.velocity.addScaledVector(_f, -cut);
  }
  if (brakeAll) e.velocity.multiplyScalar(Math.max(0, 1 - 3.5 * brakeAll * dt));

  e.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
  if (e.velocity.length() > vmax) e.velocity.setLength(vmax);
  e.position.addScaledVector(e.velocity, dt);
}

function tryFire(e, dt, targetPos, ctx, aimDot = 0.985) {
  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  const to = _d.copy(targetPos).sub(e.position);
  const dist = to.length();
  to.multiplyScalar(1 / Math.max(dist, 1e-3));
  if (dist > e.stats.fireRange) return;
  if (aimDot > -1 && _f.dot(to) < aimDot) return;
  const g = e.stats.fireGap;
  e.fireCd = g[0] + Math.random() * (g[1] - g[0]);
  const v = to.clone().multiplyScalar(950).addScaledVector(e.velocity, 0.4);
  ctx.weapons.spawn(e.position.clone().addScaledVector(to, e.radius + 4), v, 'enemy', 3.2);
  ctx.fx?.enemyLaser?.();
}

// --- behaviours ------------------------------------------------------------
function brawler(e, dt, ctx) {
  const { player } = ctx;
  let tgt = e.aimPos;
  if (player.alive && player.position.distanceTo(e.position) < 380) tgt = player.position;
  const to = _d.copy(tgt).sub(e.position);
  const dist = to.length();
  to.multiplyScalar(1 / Math.max(dist, 1e-3));
  _side.crossVectors(to, UP).normalize().multiplyScalar(e.strafeSign);

  let dir;
  let brake = 0;
  if (dist > 340) {
    dir = to.clone();
  } else if (dist > 170) {
    dir = to.clone().multiplyScalar(0.4).add(_side.clone().multiplyScalar(0.92)).normalize();
  } else {
    dir = _side.clone().add(to.clone().multiplyScalar(-0.5)).normalize();
    brake = 0.4;
  }
  fly(e, dt, dir, { throttle: dist > 340 ? 1 : 0.7, brake });
  tryFire(e, dt, tgt, ctx);
}

function strafer(e, dt, ctx) {
  if (e.state !== 'run' && e.state !== 'break') { e.state = 'run'; e.stateT = 0; }
  const to = _d.copy(e.aimPos).sub(e.position);
  const dist = to.length();
  to.multiplyScalar(1 / Math.max(dist, 1e-3));

  if (e.state === 'run') {
    fly(e, dt, to.clone(), { throttle: 1, turn: e.stats.turn * 0.85, vmax: e.vmax * 1.15 });
    tryFire(e, dt, e.aimPos, ctx, 0.95);
    if (dist < 240 || e.stateT > 5) {
      e.state = 'break';
      e.stateT = 0;
      const off = new Vector3().randomDirection();
      off.y = off.y * 0.5 + 0.2;
      e.movePos.copy(e.aimPos).addScaledVector(off.normalize(), 700 + Math.random() * 400);
    }
  } else {
    const bd = _d.copy(e.movePos).sub(e.position);
    const bdist = bd.length();
    fly(e, dt, bd.multiplyScalar(1 / Math.max(bdist, 1e-3)), { throttle: 1, vmax: e.vmax * 1.25 });
    if (bdist < 180 || e.stateT > 4) { e.state = 'run'; e.stateT = 0; }
  }
  e.stateT += dt;
}

function pickPerch(e, player) {
  const off = new Vector3().randomDirection();
  off.y = off.y * 0.5 + 0.25;
  e.perch.copy(player.position).addScaledVector(off.normalize(), 1000 + Math.random() * 500);
}

function sniper(e, dt, ctx) {
  const { player } = ctx;
  if (e.state !== 'relocate' && e.state !== 'hold') { e.state = 'relocate'; pickPerch(e, player); }
  const toPlayer = player.position.distanceTo(e.position);

  if (e.state === 'relocate') {
    const d = _d.copy(e.perch).sub(e.position);
    const dd = d.length();
    d.multiplyScalar(1 / Math.max(dd, 1e-3));
    const closing = dd < 280;
    const facePlayer = _side.copy(player.position).sub(e.position).normalize();
    fly(e, dt, closing ? facePlayer : d, {
      throttle: closing ? 0 : 1,
      brakeAll: closing ? 1 : 0,
      turn: e.stats.turn * 1.3,
      vmax: e.vmax * 1.25,
    });
    if (dd < 130 && e.velocity.length() < 55) {
      e.state = 'hold';
      e.stateT = 0;
      e.holdFor = 3.5 + Math.random() * 2.5;
    }
  } else {
    const d = _d.copy(player.position).sub(e.position).normalize();
    fly(e, dt, d, { throttle: 0, brakeAll: 1.2, turn: e.stats.turn * 1.5 });
    tryFire(e, dt, player.position, ctx, 0.95);
    e.stateT += dt;
    if (e.stateT > e.holdFor || toPlayer < 480) { e.state = 'relocate'; pickPerch(e, player); }
  }
}

function charger(e, dt, ctx) {
  const { player } = ctx;
  const to = _d.copy(player.position).sub(e.position).normalize();
  fly(e, dt, to, { throttle: 1, drag: 0.06, vmax: e.vmax * 1.1 });
  tryFire(e, dt, player.position, ctx, 0.9);
}

function thief(e, dt, ctx) {
  const { player, pods } = ctx;
  if (!e._loot || e._loot.dead || (e._loot.captor && e._loot.captor !== e)) {
    if (e.state === 'haul') e.state = 'approach';
    e._loot = nearestPod(e.position, pods);
    if (!e._loot) { brawler(e, dt, ctx); return; }
  }
  const to = _d.copy(e._loot.position).sub(e.position);
  const dist = to.length();
  to.multiplyScalar(1 / Math.max(dist, 1e-3));

  if (e.state !== 'haul') {
    const closing = dist < 240;
    fly(e, dt, to.clone(), { throttle: closing ? 0.15 : 1, brakeAll: closing ? 0.8 : 0 });
    tryFire(e, dt, player.position, ctx, 0.99);
    if (dist < e.radius + e._loot.radius + 10 && e.velocity.length() < 80) {
      e.state = 'haul';
      e._loot.captor = e;
      e.haulDir.copy(e._loot.position).sub(pods.centroid);
      if (e.haulDir.lengthSq() < 1) e.haulDir.copy(to).negate();
      e.haulDir.normalize();
      e.haulStart.copy(e._loot.position);
    }
  } else {
    fly(e, dt, e.haulDir, { throttle: 1, turn: e.stats.turn * 0.6, vmax: 95 });
    _f.copy(FWD).applyQuaternion(e.quaternion);
    e._loot.position.copy(e.position).addScaledVector(_f, e.radius + e._loot.radius);
    e._loot.velocity.set(0, 0, 0);
    if (e._loot.position.distanceTo(e.haulStart) > 2600) {
      e._loot.dead = true;
      e._loot.captor = null;
      e.dead = true;
      e.escaped = true;
    }
  }
}

// one AI tick for one enemy
export function stepEnemy(e, ctx, dt) {
  const { player, pods } = ctx;
  e.repick -= dt;

  if (e.stats.target === 'player') {
    e.aimPos.copy(player.position);
  } else if (e.behavior !== 'thief') {
    if (e.repick <= 0 || !e._targetPod || e._targetPod.dead) {
      e._targetPod = nearestPod(e.position, pods);
      e.repick = 2 + Math.random() * 2;
    }
    e.aimPos.copy(e._targetPod ? e._targetPod.position : player.position);
  }

  switch (e.behavior) {
    case 'strafer': strafer(e, dt, ctx); break;
    case 'sniper': sniper(e, dt, ctx); break;
    case 'charger': charger(e, dt, ctx); break;
    case 'thief': thief(e, dt, ctx); break;
    default: brawler(e, dt, ctx);
  }
}

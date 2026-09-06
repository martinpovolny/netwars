import * as THREE from 'three';
import { makeDart, SHIP_SCALE } from './ships.js';
import { ENEMY_TYPES, goalsForLevel } from './levels.js';

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

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

class Enemy {
  constructor(scene, typeKey) {
    const t = ENEMY_TYPES[typeKey];
    this.type = typeKey;
    this.stats = t;
    this.behavior = t.behavior;

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.hp = t.hp;
    this.radius = (10 + t.bulk * 8) * SHIP_SCALE;
    this.dead = false;
    this.escaped = false;

    // Newtonian budget derived from the NetWars Speed factor
    this.thrust = t.speed * 2.4;      // u/s^2
    this.vmax = t.speed * 2.2;        // u/s

    this.fireCd = t.fireGap[0] + Math.random() * (t.fireGap[1] - t.fireGap[0]);
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.repick = 0;
    this._targetPod = null;
    this._loot = null;

    this.state = 'init';
    this.stateT = 0;
    this.holdFor = 0;
    this.perch = new THREE.Vector3();
    this.movePos = new THREE.Vector3();
    this.aimPos = new THREE.Vector3();
    this.haulDir = new THREE.Vector3();
    this.haulStart = new THREE.Vector3();

    this.mesh = makeDart(t.accent, t.bulk);
    scene.add(this.mesh);

    this._f = new THREE.Vector3(0, 0, -1);
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._side = new THREE.Vector3();
  }

  dispose(scene) { scene.remove(this.mesh); }

  // --- unified Newtonian flight ----------------------------------------
  // Turn the nose toward `aimDir`, then apply thrust along the nose and/or
  // brake (kill velocity along the nose). Momentum carries between frames.
  _fly(dt, aimDir, { turn = this.stats.turn, throttle = 1, brake = 0, brakeAll = 0, drag = 0.1, vmax = this.vmax } = {}) {
    const tq = this._q.setFromUnitVectors(FWD, aimDir);
    this.quaternion.rotateTowards(tq, turn * dt);
    this._f.copy(FWD).applyQuaternion(this.quaternion);

    if (throttle) this.velocity.addScaledVector(this._f, this.thrust * throttle * dt);

    if (brake) {  // bleed speed along the nose axis
      const along = this.velocity.dot(this._f);
      const cut = Math.sign(along) * Math.min(Math.abs(along), this.thrust * brake * dt);
      this.velocity.addScaledVector(this._f, -cut);
    }
    if (brakeAll) this.velocity.multiplyScalar(Math.max(0, 1 - 3.5 * brakeAll * dt));

    this.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
    if (this.velocity.length() > vmax) this.velocity.setLength(vmax);
    this.position.addScaledVector(this.velocity, dt);
  }

  _tryFire(dt, targetPos, weapons, audio, aimDot = 0.985) {
    this.fireCd -= dt;
    if (this.fireCd > 0) return;
    const to = this._d.copy(targetPos).sub(this.position);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(dist, 1e-3));
    if (dist > this.stats.fireRange) return;
    if (aimDot > -1 && this._f.dot(to) < aimDot) return;
    const g = this.stats.fireGap;
    this.fireCd = g[0] + Math.random() * (g[1] - g[0]);
    const v = to.clone().multiplyScalar(950).addScaledVector(this.velocity, 0.4);
    weapons.spawn(this.position.clone().addScaledVector(to, this.radius + 4), v, 'enemy', 3.2);
    audio?.enemyLaser();
  }

  // --- behaviours -----------------------------------------------------
  _brawler(dt, player, weapons, audio) {
    let tgt = this.aimPos;
    if (player.alive && player.position.distanceTo(this.position) < 380) tgt = player.position;
    const to = this._d.copy(tgt).sub(this.position);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(dist, 1e-3));
    this._side.crossVectors(to, UP).normalize().multiplyScalar(this.strafeSign);

    let dir;
    let brake = 0;
    if (dist > 340) {
      dir = to.clone();
    } else if (dist > 170) {
      dir = to.clone().multiplyScalar(0.4).add(this._side.clone().multiplyScalar(0.92)).normalize();
    } else {
      dir = this._side.clone().add(to.clone().multiplyScalar(-0.5)).normalize();
      brake = 0.4;
    }
    this._fly(dt, dir, { throttle: dist > 340 ? 1 : 0.7, brake });
    this._tryFire(dt, tgt, weapons, audio);
  }

  _strafer(dt, player, weapons, audio) {
    if (this.state !== 'run' && this.state !== 'break') { this.state = 'run'; this.stateT = 0; }
    const to = this._d.copy(this.aimPos).sub(this.position);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(dist, 1e-3));

    if (this.state === 'run') {
      this._fly(dt, to.clone(), { throttle: 1, turn: this.stats.turn * 0.85, vmax: this.vmax * 1.15 });
      this._tryFire(dt, this.aimPos, weapons, audio, 0.95);
      if (dist < 240 || this.stateT > 5) {
        this.state = 'break';
        this.stateT = 0;
        const off = new THREE.Vector3().randomDirection();
        off.y = off.y * 0.5 + 0.2;
        this.movePos.copy(this.aimPos).addScaledVector(off.normalize(), 700 + Math.random() * 400);
      }
    } else {
      const bd = this._d.copy(this.movePos).sub(this.position);
      const bdist = bd.length();
      this._fly(dt, bd.multiplyScalar(1 / Math.max(bdist, 1e-3)), { throttle: 1, vmax: this.vmax * 1.25 });
      if (bdist < 180 || this.stateT > 4) { this.state = 'run'; this.stateT = 0; }
    }
    this.stateT += dt;
  }

  _sniper(dt, player, weapons, audio) {
    if (this.state !== 'relocate' && this.state !== 'hold') { this.state = 'relocate'; this._pickPerch(player); }
    const toPlayer = player.position.distanceTo(this.position);

    if (this.state === 'relocate') {
      const d = this._d.copy(this.perch).sub(this.position);
      const dd = d.length();
      d.multiplyScalar(1 / Math.max(dd, 1e-3));
      const closing = dd < 280;
      const facePlayer = this._side.copy(player.position).sub(this.position).normalize();
      // thrust toward the perch, then decelerate while turning to face the player
      this._fly(dt, closing ? facePlayer : d, {
        throttle: closing ? 0 : 1,
        brakeAll: closing ? 1 : 0,
        turn: this.stats.turn * 1.3,
        vmax: this.vmax * 1.25,
      });
      if (dd < 130 && this.velocity.length() < 55) {
        this.state = 'hold';
        this.stateT = 0;
        this.holdFor = 3.5 + Math.random() * 2.5;
      }
    } else {
      // hold station: face the player, bleed off drift, shoot straight
      const d = this._d.copy(player.position).sub(this.position).normalize();
      this._fly(dt, d, { throttle: 0, brakeAll: 1.2, turn: this.stats.turn * 1.5 });
      this._tryFire(dt, player.position, weapons, audio, 0.97);
      this.stateT += dt;
      if (this.stateT > this.holdFor || toPlayer < 480) { this.state = 'relocate'; this._pickPerch(player); }
    }
  }

  _pickPerch(player) {
    const off = new THREE.Vector3().randomDirection();
    off.y = off.y * 0.5 + 0.25;
    this.perch.copy(player.position).addScaledVector(off.normalize(), 1000 + Math.random() * 500);
  }

  // Newtonian charge: thrust straight at the player, never brakes, so it
  // overshoots, banks around under its turn rate, and charges again.
  _charger(dt, player, weapons, audio) {
    const to = this._d.copy(player.position).sub(this.position).normalize();
    this._fly(dt, to, { throttle: 1, drag: 0.06, vmax: this.vmax * 1.1 });
    this._tryFire(dt, player.position, weapons, audio, 0.9);
  }

  _thief(dt, player, pods, weapons, audio) {
    if (!this._loot || this._loot.dead || (this._loot.captor && this._loot.captor !== this)) {
      if (this.state === 'haul') this.state = 'approach';
      this._loot = nearestPod(this.position, pods);
      if (!this._loot) { this._brawler(dt, player, weapons, audio); return; }
    }
    const to = this._d.copy(this._loot.position).sub(this.position);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(dist, 1e-3));

    if (this.state !== 'haul') {
      const closing = dist < 240;
      this._fly(dt, to.clone(), {
        throttle: closing ? 0.15 : 1,
        brakeAll: closing ? 0.8 : 0,
      });
      this._tryFire(dt, player.position, weapons, audio, 0.99);
      if (dist < this.radius + this._loot.radius + 10 && this.velocity.length() < 80) {
        this.state = 'haul';
        this._loot.captor = this;
        this.haulDir.copy(this._loot.position).sub(pods.centroid);
        if (this.haulDir.lengthSq() < 1) this.haulDir.copy(to).negate();
        this.haulDir.normalize();
        this.haulStart.copy(this._loot.position);
      }
    } else {
      // drag the pod off in a straight line at a limited speed
      this._fly(dt, this.haulDir, { throttle: 1, turn: this.stats.turn * 0.6, vmax: 95 });
      this._f.copy(FWD).applyQuaternion(this.quaternion);
      this._loot.position.copy(this.position).addScaledVector(this._f, this.radius + this._loot.radius);
      this._loot.velocity.set(0, 0, 0);
      if (this._loot.position.distanceTo(this.haulStart) > 2600) {
        this._loot.dead = true;      // stolen -> a pod is lost
        this._loot.captor = null;
        this.dead = true;
        this.escaped = true;         // left the field; no score, quota still clears
      }
    }
  }

  update(dt, player, pods, weapons, audio) {
    this.repick -= dt;

    if (this.stats.target === 'player') {
      this.aimPos.copy(player.position);
    } else if (this.behavior !== 'thief') {
      if (this.repick <= 0 || !this._targetPod || this._targetPod.dead) {
        this._targetPod = nearestPod(this.position, pods);
        this.repick = 2 + Math.random() * 2;
      }
      this.aimPos.copy(this._targetPod ? this._targetPod.position : player.position);
    }

    switch (this.behavior) {
      case 'strafer': this._strafer(dt, player, weapons, audio); break;
      case 'sniper': this._sniper(dt, player, weapons, audio); break;
      case 'charger': this._charger(dt, player, weapons, audio); break;
      case 'thief': this._thief(dt, player, pods, weapons, audio); break;
      default: this._brawler(dt, player, weapons, audio);
    }

    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }
}

export class Enemies {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.level = 0;
    this.maxAlive = 5;
    this.goals = {};
    this.pending = {};
    this.onKill = null;   // (enemy) => void  — set by main for scoring
  }

  startLevel(n) {
    this.clearAll();
    this.level = n;
    this.goals = goalsForLevel(n);
    this.pending = { ...this.goals };
  }

  clearAll() {
    for (const e of this.list) {
      if (e._loot && e._loot.captor === e) e._loot.captor = null;
      e.dispose(this.scene);
    }
    this.list = [];
  }

  goalsRemaining() { return Object.values(this.goals).reduce((a, b) => a + b, 0); }
  pendingRemaining() { return Object.values(this.pending).reduce((a, b) => a + b, 0); }
  cleared() { return this.goalsRemaining() === 0 && this.list.length === 0; }

  _spawn(pods, player) {
    const keys = Object.keys(this.pending).filter((k) => this.pending[k] > 0);
    if (!keys.length) return false;
    const k = keys[Math.floor(Math.random() * keys.length)];
    this.pending[k]--;
    const e = new Enemy(this.scene, k);
    const anchor = pods.alive ? pods.centroid : player.position;
    e.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 500)).add(anchor);
    e.quaternion.setFromUnitVectors(FWD, player.position.clone().sub(e.position).normalize());
    this.list.push(e);
    return true;
  }

  nearestInFront(player, minDot) {
    const f = player.forward();
    let best = null;
    let bd = Infinity;
    for (const e of this.list) {
      if (e.dead) continue;
      const d = e.position.clone().sub(player.position);
      const dist = d.length();
      if (dist < 1) continue;
      if (f.dot(d.divideScalar(dist)) < minDot) continue;
      if (dist < bd) { bd = dist; best = e; }
    }
    return best;
  }

  checkRam(player, explosions, audio) {
    for (const e of this.list) {
      if (e.dead) continue;
      if (player.alive && player.position.distanceToSquared(e.position) < (e.radius + 8) ** 2) {
        e.dead = true;
        explosions.blast(e.position, 0xffcc55);
        audio?.boom();
        player.damage(26, audio);
        const away = player.position.clone().sub(e.position).normalize();
        player.velocity.addScaledVector(away, 150);
        return true;
      }
    }
    return false;
  }

  checkPodStrikes(pods, explosions, audio) {
    for (const e of this.list) {
      if (e.dead || e.behavior === 'thief') continue;
      for (const p of pods.list) {
        if (p.dead) continue;
        if (e.position.distanceToSquared(p.position) < (e.radius + p.radius) ** 2) {
          p.hp -= 20;
          if (p.hp <= 0) { p.dead = true; explosions.blast(p.position, 0xff5ad0); audio?.boom(); }
          const away = e.position.clone().sub(p.position).normalize();
          e.velocity.addScaledVector(away, 120);
        }
      }
    }
  }

  update(dt, player, pods, weapons, audio) {
    for (const e of this.list) if (!e.dead) e.update(dt, player, pods, weapons, audio);

    const keep = [];
    for (const e of this.list) {
      if (!e.dead) { keep.push(e); continue; }
      if (this.goals[e.type] > 0) this.goals[e.type]--;   // any removal counts toward the quota
      if (e._loot && e._loot.captor === e) e._loot.captor = null;
      if (!e.escaped) this.onKill?.(e);                    // escaped thief: no score
      e.dispose(this.scene);
    }
    this.list = keep;

    while (this.list.length < this.maxAlive && this.pendingRemaining() > 0) {
      if (!this._spawn(pods, player)) break;
    }
  }
}

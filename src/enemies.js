import * as THREE from 'three';
import { makeDart } from './ships.js';
import { ENEMY_TYPES, goalsForLevel } from './levels.js';

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

class Enemy {
  constructor(scene, typeKey) {
    const t = ENEMY_TYPES[typeKey];
    this.type = typeKey;
    this.stats = t;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.hp = t.hp;
    this.radius = 16 + t.bulk * 6;
    this.dead = false;
    this.fireCd = t.fireGap[0] + Math.random() * (t.fireGap[1] - t.fireGap[0]);
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.reSteer = 1 + Math.random() * 2;

    this.mesh = makeDart(t.accent, t.bulk);
    scene.add(this.mesh);

    this._f = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._side = new THREE.Vector3();
  }

  dispose(scene) { scene.remove(this.mesh); }

  update(dt, player, weapons, audio) {
    const to = this._to.copy(player.position).sub(this.position);
    const dist = to.length();
    to.normalize();

    this.reSteer -= dt;
    if (this.reSteer <= 0) {
      this.reSteer = 1.5 + Math.random() * 2.5;
      if (Math.random() < 0.4) this.strafeSign *= -1;
    }

    // approach far, orbit mid, break off when too close
    let dir;
    this._side.crossVectors(to, UP).normalize().multiplyScalar(this.strafeSign);
    if (dist > 950) {
      dir = to.clone();
    } else if (dist > 550) {
      dir = to.clone().multiplyScalar(0.5).add(this._side.clone().multiplyScalar(0.9)).normalize();
    } else {
      dir = this._side.clone().add(to.clone().multiplyScalar(-0.35)).normalize();
    }

    const targetQ = this._q.setFromUnitVectors(FWD, dir);
    this.quaternion.rotateTowards(targetQ, this.stats.turn * dt);

    this._f.copy(FWD).applyQuaternion(this.quaternion);
    const speed = dist > 780 ? this.stats.speed : this.stats.speed * 0.7;
    this.velocity.lerp(this._f.clone().multiplyScalar(speed), 1 - Math.pow(0.02, dt));
    this.position.addScaledVector(this.velocity, dt);

    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    this.fireCd -= dt;
    if (this.fireCd <= 0 && dist < this.stats.fireRange && this._f.dot(to) > 0.99 && player.alive) {
      const [lo, hi] = this.stats.fireGap;
      this.fireCd = lo + Math.random() * (hi - lo);
      const v = this._f.clone().multiplyScalar(950).add(this.velocity);
      weapons.spawn(this.position.clone().addScaledVector(this._f, 16), v, 'enemy', 3.0);
      audio?.enemyLaser();
    }
  }
}

export class Enemies {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.level = 0;
    this.maxAlive = 5;
    this._interlevel = 1.2;
    this.goals = {};       // remaining kills required per type
    this.pending = {};     // not-yet-spawned per type
    this.startLevel(1);
  }

  startLevel(n) {
    this.level = n;
    this.goals = goalsForLevel(n);
    this.pending = { ...this.goals };
    this._interlevel = 0;
  }

  goalsRemaining() {
    return Object.values(this.goals).reduce((a, b) => a + b, 0);
  }

  _spawnFromPending() {
    const keys = Object.keys(this.pending).filter((k) => this.pending[k] > 0);
    if (keys.length === 0) return;
    const k = keys[Math.floor(Math.random() * keys.length)];
    this.pending[k]--;
    const e = new Enemy(this.scene, k);
    e.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(1200 + Math.random() * 700).add(this._playerPos || new THREE.Vector3()));
    this.list.push(e);
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
      if (player.alive && player.position.distanceToSquared(e.position) < (e.radius + 6) ** 2) {
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

  // called by weapons.js when a shot kills an enemy
  registerKill(enemy) {
    const k = enemy.type;
    if (this.goals[k] > 0) this.goals[k]--;
  }

  update(dt, player, weapons, audio, onLevel) {
    this._playerPos = player.position;

    for (const e of this.list) if (!e.dead) e.update(dt, player, weapons, audio);

    const keep = [];
    for (const e of this.list) {
      if (e.dead) e.dispose(this.scene);
      else keep.push(e);
    }
    this.list = keep;

    // level cleared -> brief pause -> next level
    if (this.goalsRemaining() === 0 && this.list.length === 0) {
      this._interlevel -= dt;
      if (this._interlevel <= 0) {
        this.startLevel(this.level + 1);
        onLevel?.(this.level);
        this._interlevel = 2.5;
      }
      return;
    }

    // keep the arena populated from the pending pool
    const pendingTotal = Object.values(this.pending).reduce((a, b) => a + b, 0);
    while (this.list.length < this.maxAlive && pendingTotal > 0 && this.list.length < this.goalsRemaining()) {
      const before = Object.values(this.pending).reduce((a, b) => a + b, 0);
      this._spawnFromPending();
      if (Object.values(this.pending).reduce((a, b) => a + b, 0) === before) break;
    }
  }
}

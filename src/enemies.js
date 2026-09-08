import * as THREE from 'three';
import { makeDart, makeSniper } from './ships.js';
import { K } from '../shared/constants.js';
import { ENEMY_TYPES, goalsForLevel } from './levels.js';
import { stepEnemy } from '../shared/sim/ai.js';

const FWD = new THREE.Vector3(0, 0, -1);
const KE = K.enemy;

// Enemy = sim state (in shared/sim/ai.js) + a THREE mesh + the hull hit-flash.
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
    this.radius = (KE.radiusBase + t.bulk * KE.radiusPerBulk) * KE.shipScale;
    this.dead = false;
    this.escaped = false;

    // Newtonian budget derived from the NetWars Speed factor
    this.thrust = t.speed * KE.thrustMult;
    this.vmax = t.speed * KE.vmaxMult;

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

    this.mesh = t.shape === 'sniper' ? makeSniper(t.accent, t.bulk) : makeDart(t.accent, t.bulk);
    scene.add(this.mesh);

    // hull material + hit-flash: enemy glows white briefly when shot
    this.flash = 0;
    this._hullMat = this.mesh.children.find((c) => c.material && c.material.emissive)?.material || null;
  }

  dispose(scene) { scene.remove(this.mesh); }

  update(dt, player, pods, weapons, audio) {
    stepEnemy(this, { player, pods, weapons, fx: audio }, dt);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      if (this._hullMat) this._hullMat.emissive.setScalar(this.flash * 0.9);
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
    this.maxAlive = KE.maxAlive;
    this.goals = {};
    this.pending = {};
    this.onKill = null;   // (enemy) => void  — set by main for scoring
    this._leash = new THREE.Vector3();
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
    e.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(KE.spawnMin + Math.random() * KE.spawnRange)).add(anchor);
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
      if (player.alive && player.position.distanceToSquared(e.position) < (e.radius + KE.ramDist) ** 2) {
        e.dead = true;
        explosions.blast(e.position, 0xffcc55);
        audio?.boom();
        player.damage(KE.ramDmg, audio);
        const away = player.position.clone().sub(e.position).normalize();
        player.velocity.addScaledVector(away, KE.ramKnockback);
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
          p.hp -= KE.podStrikeDmg;
          if (p.hp <= 0) { p.dead = true; explosions.blast(p.position, 0xff5ad0); audio?.boom(); }
          const away = e.position.clone().sub(p.position).normalize();
          e.velocity.addScaledVector(away, KE.podStrikeKnockback);
        }
      }
    }
  }

  update(dt, player, pods, weapons, audio) {
    for (const e of this.list) {
      if (e.dead) continue;
      e.update(dt, player, pods, weapons, audio);
      // leash: never let an enemy stray so far the level can't be finished
      const d = e.position.distanceTo(player.position);
      if (d > KE.leashSoft) {
        const back = this._leash.copy(player.position).sub(e.position).multiplyScalar(1 / d);
        e.velocity.addScaledVector(back, e.thrust * KE.leashThrustMult * dt);
        if (d > KE.leashHard) e.position.copy(player.position).addScaledVector(back, -KE.leashSnapDist);
      }
    }

    const keep = [];
    for (const e of this.list) {
      if (!e.dead) { keep.push(e); continue; }
      if (this.goals[e.type] > 0) this.goals[e.type]--;
      if (e._loot && e._loot.captor === e) e._loot.captor = null;
      if (!e.escaped) this.onKill?.(e);
      e.dispose(this.scene);
    }
    this.list = keep;

    while (this.list.length < this.maxAlive && this.pendingRemaining() > 0) {
      if (!this._spawn(pods, player)) break;
    }
  }
}

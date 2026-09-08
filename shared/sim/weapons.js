// Projectile simulation — shared by the SP client and the Go server.
// Owns the pooled projectile state and steps motion / missile guidance /
// collisions, applying gameplay outcomes (hp, dead, ttl) and returning a list
// of events for the caller to turn into FX + sound. No THREE meshes, no DOM.
import { Vector3 } from './vec.js';

const _tmp = new Vector3();

export class Projectiles {
  constructor(K) {
    this.K = K;                 // constants.weapons
    this.max = K.max;
    this.pos = [];
    this.vel = [];
    this.ttl = new Float32Array(this.max);
    this.age = new Float32Array(this.max);
    this.team = new Array(this.max).fill(null);
    this.kind = new Array(this.max).fill('bolt');
    this.target = new Array(this.max).fill(null);
    for (let i = 0; i < this.max; i++) { this.pos.push(new Vector3()); this.vel.push(new Vector3()); }
    this.cursor = 0;
  }

  spawn(pos, vel, team, ttl, target = null, kind = 'bolt') {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i].copy(pos);
    this.vel[i].copy(vel);
    this.ttl[i] = ttl;
    this.age[i] = 0;
    this.team[i] = team;
    this.kind[i] = kind;
    this.target[i] = target;
  }

  playerMissileActive() {
    for (let i = 0; i < this.max; i++) {
      if (this.ttl[i] > 0 && this.team[i] === 'player' && this.kind[i] === 'missile') return true;
    }
    return false;
  }

  playerMissileGuided() {
    for (let i = 0; i < this.max; i++) {
      if (this.ttl[i] > 0 && this.team[i] === 'player' && this.kind[i] === 'missile') {
        return !!(this.target[i] && !this.target[i].dead);
      }
    }
    return false;
  }

  // world: { player, enemies, pods, bonuses }  -> mutates state, returns events[]
  step(dt, world, K) {
    const { player, enemies, pods, bonuses } = world;
    const KW = this.K;
    const events = [];

    for (let i = 0; i < this.max; i++) {
      if (this.ttl[i] <= 0) continue;

      this.ttl[i] -= dt;
      this.age[i] += dt;
      const isMissile = this.kind[i] === 'missile';

      if (isMissile && this.team[i] === 'player') {
        const sp = this.vel[i].length();
        if (sp > 1e-3 && sp < KW.missileMaxSpeed) this.vel[i].multiplyScalar(1 + KW.missileSelfPropel * dt);
        if (this.age[i] > KW.missileGuideDelay) {
          const tgt = this.target[i];
          if (tgt && !tgt.dead) {
            const desired = _tmp.copy(tgt.position).sub(this.pos[i]).normalize().multiplyScalar(this.vel[i].length());
            this.vel[i].lerp(desired, 1 - Math.pow(KW.missileGuideRate, dt));
          }
        }
      }
      this.pos[i].addScaledVector(this.vel[i], dt);

      // --- collisions ---
      let hit = false;
      const dmg = isMissile ? KW.missileDmg : KW.cannonDmg;
      if (this.team[i] === 'player') {
        for (const e of enemies.list) {
          if (e.dead) continue;
          const r = e.radius + (isMissile ? KW.missileHitPad : 0);
          if (this.pos[i].distanceToSquared(e.position) < r * r) {
            e.hp -= dmg;
            e.flash = 1;
            events.push({ kind: 'enemyHit', pos: this.pos[i].clone(), isMissile });
            if (e.hp <= 0) {
              e.dead = true;
              events.push({ kind: 'enemyKill', pos: e.position.clone(), accent: e.stats.accent || 0xffcc55 });
            } else if (isMissile) {
              events.push({ kind: 'missileBurst', pos: this.pos[i].clone() });
            }
            hit = true;
            break;
          }
        }
        if (!hit && bonuses && bonuses.hitByShot(this.pos[i])) hit = true;
      } else {
        if (player.alive && this.pos[i].distanceToSquared(player.position) < KW.playerHitRadius * KW.playerHitRadius) {
          const absorbed = player.invuln > 0;   // grace period soaks it (no hurt sound)
          player.damage(KW.enemyDmgPlayer);
          events.push({ kind: 'playerHit', pos: this.pos[i].clone(), absorbed });
          hit = true;
        }
        if (!hit) {
          for (const pod of pods.list) {
            if (pod.dead) continue;
            if (this.pos[i].distanceToSquared(pod.position) < pod.radius * pod.radius) {
              pod.hp -= KW.enemyDmgPod;
              events.push({ kind: 'podHit', pos: this.pos[i].clone() });
              if (pod.hp <= 0) {
                pod.dead = true;
                events.push({ kind: 'podKill', pos: pod.position.clone(), pod });
              }
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) this.ttl[i] = 0;
    }

    return events;
  }
}

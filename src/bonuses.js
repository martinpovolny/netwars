import * as THREE from 'three';
import { makeBonus } from './ships.js';

// Collectible bonus pods (a 2nd kind of pod). Fly into one to grab it:
//   'missiles' -> refills guided missiles
//   'repair'   -> restores hull
// They drift slowly, spin, and time out if not collected.
class Bonus {
  constructor(scene, kind) {
    this.kind = kind;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.radius = 60;          // generous — scoop it up by flying near OR shooting it
    this.life = 26;            // seconds before it fades away
    this.dead = false;
    this._collected = false;
    this.mesh = makeBonus(kind);
    scene.add(this.mesh);
    this._t = Math.random() * 6;
  }

  update(dt) {
    this._t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y += 0.9 * dt;
    this.mesh.rotation.x = Math.sin(this._t * 0.7) * 0.25;
    if (this.mesh.userData.ring) this.mesh.userData.ring.rotation.z += 1.6 * dt;
    // gentle pulse; shrink away over the last 4 s
    const fade = THREE.MathUtils.clamp(this.life / 4, 0, 1);
    const pulse = 1 + 0.08 * Math.sin(this._t * 4);
    this.mesh.scale.setScalar(pulse * (0.3 + 0.7 * fade));
  }

  dispose(scene) { scene.remove(this.mesh); }
}

export class Bonuses {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.maxAlive = 2;
    this.timer = 12 + Math.random() * 8;   // first one comes fairly soon
  }

  reset() {
    for (const b of this.list) b.dispose(this.scene);
    this.list = [];
    this.timer = 12 + Math.random() * 8;
  }

  _spawn(around, player) {
    // bias toward whichever the player needs more
    const wantRepair = player.hull < player.maxHull * 0.6;
    const wantMsl = player.missiles < player.maxMissiles * 0.4;
    let kind;
    if (wantRepair && !wantMsl) kind = 'repair';
    else if (wantMsl && !wantRepair) kind = 'missiles';
    else kind = Math.random() < 0.5 ? 'repair' : 'missiles';

    const b = new Bonus(this.scene, kind);
    b.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(500 + Math.random() * 700)).add(around);
    b.velocity.copy(new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 8));
    this.list.push(b);
  }

  // a player projectile at `pos` scores a hit on a bonus -> counts as collecting
  hitByShot(pos) {
    for (const b of this.list) {
      if (b.dead) continue;
      if (pos.distanceToSquared(b.position) < b.radius * b.radius) { b._collected = true; return true; }
    }
    return false;
  }

  // returns a collected bonus {kind} this frame, or null
  update(dt, player, around) {
    let collected = null;

    this.timer -= dt;
    if (this.timer <= 0 && this.list.length < this.maxAlive) {
      this.timer = 22 + Math.random() * 18;
      this._spawn(around, player);
    }

    for (const b of this.list) {
      if (b.dead) continue;
      b.update(dt);
      if (b._collected || (player.alive && b.position.distanceToSquared(player.position) < b.radius * b.radius)) {
        b.dead = true;
        collected = { kind: b.kind };
      }
    }

    const keep = [];
    for (const b of this.list) {
      if (b.dead) b.dispose(this.scene);
      else keep.push(b);
    }
    this.list = keep;

    return collected;
  }
}

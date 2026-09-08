import * as THREE from 'three';
import { makeBonus } from './ships.js';
import { K } from '../shared/constants.js';
import { makeBonuses, stepBonuses, bonusHitByShot } from '../shared/sim/rules.js';

// Render side of the collectible bonus pods. Sim (spawn cadence / drift / life
// / collect) is in shared/sim/rules.js; this wraps it and keeps a spinning,
// pulsing THREE mesh per bonus.
export class Bonuses {
  constructor(scene) {
    this.scene = scene;
    this._sim = makeBonuses(K.bonuses);
    this._meshes = new Map();   // bonusState -> THREE.Group
  }

  get list() { return this._sim.list; }

  reset() {
    for (const m of this._meshes.values()) this.scene.remove(m);
    this._meshes.clear();
    this._sim = makeBonuses(K.bonuses);
  }

  // a player projectile hit -> counts as collecting (called from weapons sim)
  hitByShot(pos) { return bonusHitByShot(this._sim, pos); }

  // returns a collected bonus { kind } this frame, or null
  update(dt, player, around) {
    const collected = stepBonuses(this._sim, player, around, dt, K.bonuses);

    // attach meshes for newly spawned bonuses
    for (const b of this._sim.list) {
      if (!this._meshes.has(b)) {
        const m = makeBonus(b.kind);
        this.scene.add(m);
        this._meshes.set(b, m);
      }
    }
    // drop meshes for removed bonuses
    for (const [b, m] of this._meshes) {
      if (!this._sim.list.includes(b)) { this.scene.remove(m); this._meshes.delete(b); }
    }
    // sync survivors
    for (const b of this._sim.list) {
      const m = this._meshes.get(b);
      if (!m) continue;
      m.position.copy(b.position);
      m.rotation.y += 0.9 * dt;
      m.rotation.x = Math.sin(b._t * 0.7) * 0.25;
      if (m.userData.ring) m.userData.ring.rotation.z += 1.6 * dt;
      const fade = THREE.MathUtils.clamp(b.life / 4, 0, 1);
      const pulse = 1 + 0.08 * Math.sin(b._t * 4);
      m.scale.setScalar(pulse * (0.3 + 0.7 * fade));
    }

    return collected;
  }
}

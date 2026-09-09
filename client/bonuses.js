import * as THREE from 'three';
import { makeBonus } from './ships.js';

// Render side of the collectible bonus pods. Sim (spawn cadence / drift / life
// / collect) is in shared/sim/rules.js and driven by
// shared/sim/world.js#stepWorld. This keeps a spinning, pulsing mesh per
// bonus, diffed against `bonuses.list`.
export class Bonuses {
  constructor(scene) {
    this.scene = scene;
    this._sim = null;                 // world.bonuses — set by attach()
    this._meshes = new Map();         // bonusState -> THREE.Group
  }

  attach(bonuses) { this._sim = bonuses; }

  get list() { return this._sim ? this._sim.list : []; }

  update(dt) {
    const live = this._sim ? this._sim.list : [];
    const liveSet = new Set(live);

    for (const b of live) {
      if (this._meshes.has(b)) continue;
      const m = makeBonus(b.kind);
      this.scene.add(m);
      this._meshes.set(b, m);
    }
    for (const [b, m] of this._meshes) {
      if (!liveSet.has(b)) { this.scene.remove(m); this._meshes.delete(b); }
    }
    for (const b of live) {
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
  }

  clear() {
    for (const m of this._meshes.values()) this.scene.remove(m);
    this._meshes.clear();
  }
}

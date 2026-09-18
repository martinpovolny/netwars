import { makeRock } from './ships.js';

// Render side of deathmatch/tdm meteorites. Unlike pods/bonuses (whose sim
// lives in shared/sim/rules.js, reused by co-op), rocks have no client-side
// sim at all — server/game/rocks.go is the only place they're simulated —
// so this just meshes whatever position/quaternion/radius each snapshot
// sends, exactly like enemies (net.js#interpRemote eases world.rocks.list
// toward the server pose the same way it does world.fleet.list).
export class Meteorites {
  constructor(scene) {
    this.scene = scene;
    this._sim = null;          // world.rocks — set by attach()
    this._meshes = new Map();  // rockState -> THREE.Group
  }

  attach(rocks) { this._sim = rocks; }

  get list() { return this._sim ? this._sim.list : []; }

  update() {
    const live = this._sim ? this._sim.list : [];
    const liveSet = new Set(live);

    for (const r of live) {
      if (this._meshes.has(r)) continue;
      const m = makeRock(r.radius);
      m.position.copy(r.position);
      if (r.quaternion) m.quaternion.copy(r.quaternion);
      this.scene.add(m);
      this._meshes.set(r, m);
    }
    for (const [r, m] of this._meshes) {
      if (!liveSet.has(r)) { this.scene.remove(m); this._meshes.delete(r); }
    }
    for (const r of live) {
      const m = this._meshes.get(r);
      if (!m) continue;
      m.position.copy(r.position);
      if (r.quaternion) m.quaternion.copy(r.quaternion);
    }
  }

  clear() {
    for (const m of this._meshes.values()) this.scene.remove(m);
    this._meshes.clear();
  }
}

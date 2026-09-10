import { makePod } from './ships.js';

// Render side of the pods. The sim (spawn, drift, capture, cull, recentre) is
// in shared/sim/rules.js and driven by shared/sim/world.js#stepWorld. This
// diffs `pods.list` against a mesh-per-pod Map and applies the visual tumble.
export class Pods {
  constructor(scene) {
    this.scene = scene;
    this._sim = null;                 // world.pods — set by attach()
    this._meshes = new Map();         // podState -> THREE.Group
  }

  attach(pods) { this._sim = pods; }

  get list() { return this._sim ? this._sim.list : []; }
  get centroid() { return this._sim.centroid; }
  get total() { return this._sim ? this._sim.total : 0; }
  get alive() { return this._sim ? this._sim.list.length : 0; }

  update(dt) {
    const live = this._sim ? this._sim.list : [];
    const liveSet = new Set(live);

    for (const p of live) {
      if (this._meshes.has(p)) continue;
      const m = makePod();
      m.position.copy(p.position);
      this.scene.add(m);
      this._meshes.set(p, m);
    }
    for (const [p, m] of this._meshes) {
      if (!liveSet.has(p)) { this.scene.remove(m); this._meshes.delete(p); }
    }
    for (const p of live) {
      const m = this._meshes.get(p);
      if (!m) continue;
      m.position.copy(p.position);
      m.rotation.x += p.spin.x * dt;
      m.rotation.y += p.spin.y * dt;
      m.rotation.z += p.spin.z * dt;
    }
  }

  clear() {
    for (const m of this._meshes.values()) this.scene.remove(m);
    this._meshes.clear();
  }
}

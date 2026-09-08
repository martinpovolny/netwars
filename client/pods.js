import * as THREE from 'three';
import { makePod } from './ships.js';
import { K } from '../shared/constants.js';
import { spawnPods, stepPods, recentrePods } from '../shared/sim/rules.js';

// Render side of the pods: the sim state lives in shared/sim/rules.js; this
// wraps it and keeps a THREE mesh per pod (position + visual tumble).
export class Pods {
  constructor(scene) {
    this.scene = scene;
    this._sim = { list: [], centroid: new THREE.Vector3(), lost: 0, total: 0 };
    this._meshes = new Map();   // podState -> THREE.Group
  }

  get list() { return this._sim.list; }
  get centroid() { return this._sim.centroid; }
  get total() { return this._sim.total; }
  get alive() { return this._sim.list.length; }

  spawnLevel(count, around = new THREE.Vector3()) {
    this.clear();
    this._sim.list = spawnPods(count, around, K.pods);
    this._sim.total = count;
    this._sim.lost = 0;
    for (const p of this._sim.list) this._attach(p);
    recentrePods(this._sim);
  }

  _attach(p) {
    const m = makePod();
    m.position.copy(p.position);
    this.scene.add(m);
    this._meshes.set(p, m);
  }

  update(dt) {
    stepPods(this._sim, dt);
    // drop meshes for culled pods
    for (const [p, m] of this._meshes) {
      if (!this._sim.list.includes(p)) { this.scene.remove(m); this._meshes.delete(p); }
    }
    // sync survivors
    for (const p of this._sim.list) {
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
    this._sim.list = [];
  }
}

import { makeDart, makeSniper } from './ships.js';

// Render side of the enemy fleet. The sim — roster, per-class quota, AI,
// spawn cadence, leash, culling, ram / pod-strike — lives in
// shared/sim/enemies.js and is driven by shared/sim/world.js#stepWorld.
// This diffs `fleet.list` against a Map<enemyState, mesh> each frame:
// instantiate on new states, dispose on gone ones, sync transform + the
// hull hit-flash.
export class Enemies {
  constructor(scene) {
    this.scene = scene;
    this._fleet = null;                  // set by attach()
    this._meshes = new Map();            // enemyState -> { group, hullMat }
  }

  attach(fleet) { this._fleet = fleet; }

  get list() { return this._fleet ? this._fleet.list : []; }
  get level() { return this._fleet ? this._fleet.level : 0; }
  get goals() { return this._fleet ? this._fleet.goals : {}; }

  _spawnMesh(e) {
    const t = e.stats;
    const group = t.shape === 'sniper' ? makeSniper(t.accent, t.bulk) : makeDart(t.accent, t.bulk);
    this.scene.add(group);
    const hullMat = group.children.find((c) => c.material && c.material.emissive)?.material || null;
    this._meshes.set(e, { group, hullMat });
  }

  update(dt) {
    const live = this._fleet ? this._fleet.list : [];
    const liveSet = new Set(live);

    for (const e of live) if (!this._meshes.has(e)) this._spawnMesh(e);
    for (const [e, m] of this._meshes) {
      if (!liveSet.has(e)) { this.scene.remove(m.group); this._meshes.delete(e); }
    }

    for (const e of live) {
      const m = this._meshes.get(e);
      if (!m) continue;
      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 6);
        if (m.hullMat) m.hullMat.emissive.setScalar(e.flash * 0.9);
      }
      m.group.position.copy(e.position);
      m.group.quaternion.copy(e.quaternion);
    }
  }

  clearAll() {
    for (const m of this._meshes.values()) this.scene.remove(m.group);
    this._meshes.clear();
  }
}

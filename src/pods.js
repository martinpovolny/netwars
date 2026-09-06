import * as THREE from 'three';
import { makePod } from './ships.js';

// Pods are the objective: protect them. A level is lost if every pod is
// destroyed. They do NOT respawn during a level.
class Pod {
  constructor(scene) {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.6
    );
    this.hp = 24;
    this.radius = 28;
    this.dead = false;
    this.captor = null;      // set to a Raider while it hauls this pod away
    this.mesh = makePod();
    scene.add(this.mesh);
  }

  update(dt) {
    if (!this.captor) this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
  }

  dispose(scene) { scene.remove(this.mesh); }
}

export class Pods {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.total = 0;
    this.lost = 0;
    this.centroid = new THREE.Vector3();
  }

  spawnLevel(count, around = new THREE.Vector3()) {
    this.clear();
    this.total = count;
    this.lost = 0;
    for (let i = 0; i < count; i++) {
      const p = new Pod(this.scene);
      // a loose cluster you can patrol
      p.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(260 + Math.random() * 520)).add(around);
      p.velocity.copy(new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 5));
      this.list.push(p);
    }
    this._recentre();
  }

  _recentre() {
    if (this.list.length === 0) return;
    this.centroid.set(0, 0, 0);
    for (const p of this.list) this.centroid.add(p.position);
    this.centroid.multiplyScalar(1 / this.list.length);
  }

  update(dt) {
    for (const p of this.list) if (!p.dead) p.update(dt);
    const keep = [];
    for (const p of this.list) {
      if (p.dead) { p.dispose(this.scene); this.lost++; }
      else keep.push(p);
    }
    this.list = keep;
    this._recentre();
  }

  get alive() { return this.list.length; }

  clear() {
    for (const p of this.list) p.dispose(this.scene);
    this.list = [];
  }
}

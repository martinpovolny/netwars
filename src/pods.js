import * as THREE from 'three';
import { makePod } from './ships.js';

// Drifting pink pods: bonus score targets, no return fire (NetWars "pods").
class Pod {
  constructor(scene) {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 0.7
    );
    this.hp = 18;
    this.radius = 16;
    this.dead = false;
    this.mesh = makePod();
    scene.add(this.mesh);
  }

  update(dt) {
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
  }

  dispose(scene) { scene.remove(this.mesh); }
}

export class Pods {
  constructor(scene, count = 6) {
    this.scene = scene;
    this.count = count;
    this.list = [];
    for (let i = 0; i < count; i++) this.spawn();
  }

  spawn(around = new THREE.Vector3()) {
    const p = new Pod(this.scene);
    p.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(500 + Math.random() * 1500)).add(around);
    p.velocity.copy(new THREE.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 12));
    this.list.push(p);
  }

  update(dt, around) {
    for (const p of this.list) if (!p.dead) p.update(dt);
    const keep = [];
    for (const p of this.list) {
      if (p.dead) p.dispose(this.scene);
      else keep.push(p);
    }
    this.list = keep;
    while (this.list.length < this.count) this.spawn(around);
  }

  clear() {
    for (const p of this.list) p.dispose(this.scene);
    this.list = [];
  }
}

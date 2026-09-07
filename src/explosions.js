import * as THREE from 'three';

// Expanding wireframe shells + point-spray sparks. Self-disposing.
export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  blast(pos, color = 0xffcc55) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(6, 0),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true })
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.items.push({ mesh: m, life: 0, max: 0.55, kind: 'shell' });
  }

  spark(pos, color = 0xfff2b0) {
    const N = 14;
    const arr = new Float32Array(N * 3);
    const vel = [];
    for (let i = 0; i < N; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z;
      vel.push(new THREE.Vector3().randomDirection().multiplyScalar(35 + Math.random() * 70));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 3, transparent: true }));
    this.scene.add(m);
    this.items.push({ mesh: m, life: 0, max: 0.4, kind: 'spark', vel });
  }

  update(dt) {
    const keep = [];
    for (const it of this.items) {
      it.life += dt;
      const t = it.life / it.max;
      if (t >= 1) {
        this.scene.remove(it.mesh);
        it.mesh.geometry.dispose();
        it.mesh.material.dispose();
        continue;
      }
      if (it.kind === 'shell') {
        it.mesh.scale.setScalar(1 + t * 9);
        it.mesh.material.opacity = 1 - t;
      } else {
        const a = it.mesh.geometry.attributes.position.array;
        for (let i = 0; i < it.vel.length; i++) {
          a[i * 3] += it.vel[i].x * dt;
          a[i * 3 + 1] += it.vel[i].y * dt;
          a[i * 3 + 2] += it.vel[i].z * dt;
        }
        it.mesh.geometry.attributes.position.needsUpdate = true;
        it.mesh.material.opacity = 1 - t;
      }
      keep.push(it);
    }
    this.items = keep;
  }
}

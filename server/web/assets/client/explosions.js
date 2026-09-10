import * as THREE from 'three';

// Bombastic vector explosions: a hot flash core, twin expanding wire shells,
// a shockwave ring, a fast spark burst and tumbling debris shards.
export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  // --- small stuff --------------------------------------------------------
  spark(pos, color = 0xfff2b0, n = 14, spread = 90) {
    const arr = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z;
      vel.push(new THREE.Vector3().randomDirection().multiplyScalar(spread * (0.4 + Math.random())));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({
      color, size: 3.5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(m);
    this.items.push({ mesh: m, life: 0, max: 0.45, kind: 'spark', vel });
  }

  // impact puff on an enemy — bright, quick, so hits register
  hit(pos, color = 0xffffff) {
    const flash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flash.position.copy(pos);
    this.scene.add(flash);
    this.items.push({ mesh: flash, life: 0, max: 0.22, kind: 'flash', from: 3, to: 0 });
    this.spark(pos, color, 10, 130);
  }

  // --- the big one ------------------------------------------------------
  blast(pos, color = 0xffcc55) {
    // 1. hot white core flash — full size instantly, collapses fast
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    core.position.copy(pos);
    this.scene.add(core);
    this.items.push({ mesh: core, life: 0, max: 0.28, kind: 'flash', from: 3.2, to: 0 });

    // 2. two expanding wireframe shells at different rates
    for (const [seg, grow, life, col] of [[1, 14, 0.55, 0xffffff], [0, 22, 0.8, color]]) {
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(6, seg),
        new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      shell.position.copy(pos);
      this.scene.add(shell);
      this.items.push({ mesh: shell, life: 0, max: life, kind: 'shell', grow });
    }

    // 3. shockwave ring on a random plane
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6, 0.8, 6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.copy(pos);
    ring.quaternion.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    this.scene.add(ring);
    this.items.push({ mesh: ring, life: 0, max: 0.6, kind: 'ring', grow: 10 });

    // 4. spark burst — dense + fast, two colours
    this.spark(pos, 0xffffff, 22, 220);
    this.spark(pos, color, 18, 150);

    // 5. tumbling debris shards
    const shards = 7;
    const dv = [];
    const dspin = [];
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const shardMat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < shards; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(1.6 + Math.random() * 1.4), shardMat);
      grp.add(s);
      dv.push(new THREE.Vector3().randomDirection().multiplyScalar(50 + Math.random() * 90));
      dspin.push(new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
    }
    this.scene.add(grp);
    this.items.push({ mesh: grp, life: 0, max: 0.9, kind: 'debris', dv, dspin });
  }

  update(dt) {
    const keep = [];
    for (const it of this.items) {
      it.life += dt;
      const t = it.life / it.max;
      if (t >= 1) {
        this.scene.remove(it.mesh);
        it.mesh.traverse?.((o) => { o.geometry?.dispose?.(); });
        it.mesh.geometry?.dispose?.();
        it.mesh.material?.dispose?.();
        continue;
      }

      if (it.kind === 'flash') {
        it.mesh.scale.setScalar(it.from + (it.to - it.from) * t);
        it.mesh.material.opacity = 1 - t;
      } else if (it.kind === 'shell') {
        it.mesh.scale.setScalar(1 + t * it.grow);
        it.mesh.material.opacity = (1 - t) * 0.9;
      } else if (it.kind === 'ring') {
        it.mesh.scale.setScalar(1 + t * it.grow);
        it.mesh.material.opacity = (1 - t) * 0.9;
      } else if (it.kind === 'spark') {
        const a = it.mesh.geometry.attributes.position.array;
        for (let i = 0; i < it.vel.length; i++) {
          a[i * 3] += it.vel[i].x * dt;
          a[i * 3 + 1] += it.vel[i].y * dt;
          a[i * 3 + 2] += it.vel[i].z * dt;
        }
        it.mesh.geometry.attributes.position.needsUpdate = true;
        it.mesh.material.opacity = 1 - t;
      } else if (it.kind === 'debris') {
        it.mesh.children.forEach((s, i) => {
          s.position.addScaledVector(it.dv[i], dt);
          s.rotation.x += it.dspin[i].x * dt;
          s.rotation.y += it.dspin[i].y * dt;
          s.rotation.z += it.dspin[i].z * dt;
        });
        it.mesh.children[0].material.opacity = 1 - t;
      }
      keep.push(it);
    }
    this.items = keep;
  }
}

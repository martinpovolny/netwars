import * as THREE from 'three';
import { K } from '../shared/constants.js';
import { Projectiles } from '../shared/sim/weapons.js';

const FZ = new THREE.Vector3(0, 0, 1);

// Render side of the projectile system: wraps the shared Projectiles pool and
// owns the bolt / missile / trail meshes + the FX triggered by hit events.
export class Weapons {
  constructor(scene) {
    this.p = new Projectiles(K.weapons);
    const MAX = this.p.max;

    // --- bolt meshes (dull tracers) -------------------------------------
    const boltGeo = new THREE.OctahedronGeometry(1, 0);
    boltGeo.scale(2.2, 2.2, 9);
    this._matP = new THREE.MeshBasicMaterial({ color: 0x9fc4d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
    this._matE = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 });
    this._matL = new THREE.MeshBasicMaterial({ color: 0x62d0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 }); // Guardian lance
    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    coreGeo.scale(1.1, 1.1, 4.5);
    const matCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });

    this.bolts = [];
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.Mesh(boltGeo, this._matP);
      m.add(new THREE.Mesh(coreGeo, matCore));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.bolts.push(m);
    }

    // --- missile meshes (few — only one active at a time) --------------
    this.mslMeshes = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const yellow = new THREE.MeshBasicMaterial({ color: 0xffd23a });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 12, 8), yellow);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(1.7, 5, 8), yellow);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -8.5;
      g.add(nose);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 3), yellow);
      fin.position.z = 5;
      g.add(fin);
      const fin2 = fin.clone();
      fin2.rotation.z = Math.PI / 2;
      g.add(fin2);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 7, 6),
        new THREE.MeshBasicMaterial({ color: 0xff9020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.z = 8;
      g.add(flame);
      g.userData.flame = flame;
      g.visible = false;
      g.frustumCulled = false;
      scene.add(g);
      this.mslMeshes.push(g);
    }

    // --- trails --------------------------------------------------------
    this.tpos = new Float32Array(MAX * 2 * 3);
    this.tcol = new Float32Array(MAX * 2 * 3);
    this.tgeom = new THREE.BufferGeometry();
    this.tgeom.setAttribute('position', new THREE.BufferAttribute(this.tpos, 3));
    this.tgeom.setAttribute('color', new THREE.BufferAttribute(this.tcol, 3));
    this.trails = new THREE.LineSegments(
      this.tgeom,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 })
    );
    this.trails.frustumCulled = false;
    scene.add(this.trails);

    this._cBolt = new THREE.Color(0x7fa8b6);
    this._cE = new THREE.Color(0xff3a24);
    this._cL = new THREE.Color(0x62d0ff);
    this._cMsl = new THREE.Color(0xffd23a);
    this._dir = new THREE.Vector3();
  }

  // The shared projectile pool is owned by world.js now; point at it.
  attach(projectiles) { this.p = projectiles; }

  // pass-throughs to the shared pool
  spawn(pos, vel, team, ttl, target = null, kind = 'bolt') { this.p.spawn(pos, vel, team, ttl, target, kind); }
  playerMissileActive() { return this.p.playerMissileActive(); }
  playerMissileGuided() { return this.p.playerMissileGuided(); }

  // Render-only: stepWorld() already stepped the pool and surfaced the hit
  // events; this just drives the bolt / missile / trail meshes from it.
  update(dt) {
    const p = this.p;
    const tp = this.tpos;
    const tc = this.tcol;
    let mi = 0;

    for (let i = 0; i < p.max; i++) {
      const a = i * 6;
      const bolt = this.bolts[i];

      if (p.ttl[i] <= 0) {
        if (bolt.visible) bolt.visible = false;
        tp[a] = tp[a + 1] = tp[a + 2] = tp[a + 3] = tp[a + 4] = tp[a + 5] = 0;
        continue;
      }

      const isMissile = p.kind[i] === 'missile';
      const speed = p.vel[i].length();
      if (speed > 1e-3) this._dir.copy(p.vel[i]).multiplyScalar(1 / speed);

      if (isMissile && p.team[i] === 'player') {
        bolt.visible = false;
        const m = this.mslMeshes[mi < this.mslMeshes.length ? mi++ : this.mslMeshes.length - 1];
        m.visible = true;
        m.position.copy(p.pos[i]);
        if (speed > 1e-3) m.quaternion.setFromUnitVectors(FZ, this._dir);
        m.userData.flame.scale.setScalar(0.8 + Math.random() * 0.5);
        tp[a] = p.pos[i].x; tp[a + 1] = p.pos[i].y; tp[a + 2] = p.pos[i].z;
        tp[a + 3] = p.pos[i].x - p.vel[i].x * 0.06;
        tp[a + 4] = p.pos[i].y - p.vel[i].y * 0.06;
        tp[a + 5] = p.pos[i].z - p.vel[i].z * 0.06;
        tc[a] = this._cMsl.r; tc[a + 1] = this._cMsl.g; tc[a + 2] = this._cMsl.b;
        tc[a + 3] = this._cMsl.r * 0.1; tc[a + 4] = this._cMsl.g * 0.1; tc[a + 5] = this._cMsl.b * 0.1;
      } else {
        const isLance = p.kind[i] === 'lance';
        const isEnemy = p.team[i] === 'enemy';
        bolt.visible = true;
        bolt.material = isLance ? this._matL : isEnemy ? this._matE : this._matP;
        bolt.position.copy(p.pos[i]);
        if (speed > 1e-3) bolt.quaternion.setFromUnitVectors(FZ, this._dir);
        if (isLance) {
          const pulse = 3.4 + 0.7 * Math.sin(p.age[i] * 60);
          bolt.scale.set(pulse, pulse, 7);          // long bright shard
        } else if (isEnemy) {
          const pulse = 2.6 + 0.9 * Math.sin(p.age[i] * 42);
          bolt.scale.set(pulse, pulse, 1.7);
        } else {
          bolt.scale.set(1, 1, 1);
        }
        const col = isLance ? this._cL : isEnemy ? this._cE : this._cBolt;
        const trail = isLance ? 0.14 : isEnemy ? 0.07 : 0.04;
        tp[a] = p.pos[i].x; tp[a + 1] = p.pos[i].y; tp[a + 2] = p.pos[i].z;
        tp[a + 3] = p.pos[i].x - p.vel[i].x * trail;
        tp[a + 4] = p.pos[i].y - p.vel[i].y * trail;
        tp[a + 5] = p.pos[i].z - p.vel[i].z * trail;
        const tail = isLance ? 0.55 : 0.1;   // lance draws a near-solid beam
        tc[a] = col.r; tc[a + 1] = col.g; tc[a + 2] = col.b;
        tc[a + 3] = col.r * tail; tc[a + 4] = col.g * tail; tc[a + 5] = col.b * tail;
      }
    }

    for (; mi < this.mslMeshes.length; mi++) this.mslMeshes[mi].visible = false;

    this.tgeom.attributes.position.needsUpdate = true;
    this.tgeom.attributes.color.needsUpdate = true;
  }
}

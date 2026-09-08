import * as THREE from 'three';

const MAX = 240;
const FZ = new THREE.Vector3(0, 0, 1);

// Pooled projectiles. Two player weapons:
//   'bolt'    — dull unlimited cannon, no guidance
//   'missile' — guided, one on screen at a time, limited ammo, yellow
// Enemy shots are always 'bolt'.
export class Weapons {
  constructor(scene) {
    this.pos = [];
    this.vel = [];
    this.ttl = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.team = new Array(MAX).fill(null);
    this.kind = new Array(MAX).fill('bolt');
    this.target = new Array(MAX).fill(null);
    for (let i = 0; i < MAX; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
    }
    this.cursor = 0;

    // --- bolt meshes (dull tracers) -------------------------------------
    const boltGeo = new THREE.OctahedronGeometry(1, 0);
    boltGeo.scale(2.2, 2.2, 9);
    this._matP = new THREE.MeshBasicMaterial({ color: 0x9fc4d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
    // incoming enemy fire: bright, saturated, so it reads coming head-on
    this._matE = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 });
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
    this._cMsl = new THREE.Color(0xffd23a);
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  spawn(pos, vel, team, ttl, target = null, kind = 'bolt') {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i].copy(pos);
    this.vel[i].copy(vel);
    this.ttl[i] = ttl;
    this.age[i] = 0;
    this.team[i] = team;
    this.kind[i] = kind;
    this.target[i] = target;
  }

  playerMissileActive() {
    for (let i = 0; i < MAX; i++) {
      if (this.ttl[i] > 0 && this.team[i] === 'player' && this.kind[i] === 'missile') return true;
    }
    return false;
  }

  // true if the active player missile is homing a live target (vs. ballistic)
  playerMissileGuided() {
    for (let i = 0; i < MAX; i++) {
      if (this.ttl[i] > 0 && this.team[i] === 'player' && this.kind[i] === 'missile') {
        return !!(this.target[i] && !this.target[i].dead);
      }
    }
    return false;
  }

  update(dt, player, enemies, pods, explosions, audio, onKill, bonuses) {
    const tp = this.tpos;
    const tc = this.tcol;
    let mi = 0;

    for (let i = 0; i < MAX; i++) {
      const a = i * 6;
      const bolt = this.bolts[i];

      if (this.ttl[i] <= 0) {
        if (bolt.visible) bolt.visible = false;
        tp[a] = tp[a + 1] = tp[a + 2] = tp[a + 3] = tp[a + 4] = tp[a + 5] = 0;
        continue;
      }

      this.ttl[i] -= dt;
      this.age[i] += dt;
      const isMissile = this.kind[i] === 'missile';

      if (isMissile && this.team[i] === 'player') {
        // self-propelled: keep building speed along its heading
        const sp = this.vel[i].length();
        if (sp > 1e-3 && sp < 1500) this.vel[i].multiplyScalar(1 + 1.6 * dt);
        // homes only toward the target it was locked to at launch — no
        // re-acquire. No lock -> flies straight. Brief straight phase first.
        if (this.age[i] > 0.35) {
          const tgt = this.target[i];
          if (tgt && !tgt.dead) {
            const desired = this._tmp.copy(tgt.position).sub(this.pos[i]).normalize().multiplyScalar(this.vel[i].length());
            this.vel[i].lerp(desired, 1 - Math.pow(0.01, dt));
          }
        }
      }
      this.pos[i].addScaledVector(this.vel[i], dt);

      // collisions
      let hit = false;
      const dmg = isMissile ? 30 : 8;
      if (this.team[i] === 'player') {
        for (const e of enemies.list) {
          if (e.dead) continue;
          const r = e.radius + (isMissile ? 8 : 0);
          if (this.pos[i].distanceToSquared(e.position) < r * r) {
            e.hp -= dmg;
            e.flash = 1;                                  // brief bright hull flash
            explosions.hit(this.pos[i], isMissile ? 0xffd23a : 0xbfe8ff);
            if (e.hp <= 0) { e.dead = true; explosions.blast(e.position, e.stats.accent || 0xffcc55); audio?.boom(); }
            else if (isMissile) explosions.blast(this.pos[i], 0xffd23a);
            hit = true;
            break;
          }
        }
        // shooting a bonus pod counts as collecting it
        if (!hit && bonuses && bonuses.hitByShot(this.pos[i])) hit = true;
      } else {
        if (player.alive && this.pos[i].distanceToSquared(player.position) < 100) {
          player.damage(9, audio);
          explosions.spark(this.pos[i]);
          hit = true;
        }
        if (!hit) {
          for (const pod of pods.list) {
            if (pod.dead) continue;
            if (this.pos[i].distanceToSquared(pod.position) < pod.radius * pod.radius) {
              pod.hp -= 8;
              explosions.spark(this.pos[i]);
              if (pod.hp <= 0) { pod.dead = true; explosions.blast(pod.position, 0xff5ad0); audio?.boom(); onKill?.('podlost', pod); }
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) this.ttl[i] = 0;

      // --- render ---
      if (this.ttl[i] <= 0) {
        bolt.visible = false;
        tp[a] = tp[a + 1] = tp[a + 2] = tp[a + 3] = tp[a + 4] = tp[a + 5] = 0;
        continue;
      }

      const speed = this.vel[i].length();
      if (speed > 1e-3) this._dir.copy(this.vel[i]).multiplyScalar(1 / speed);

      if (isMissile && this.team[i] === 'player') {
        bolt.visible = false;
        const m = this.mslMeshes[mi < this.mslMeshes.length ? mi++ : this.mslMeshes.length - 1];
        m.visible = true;
        m.position.copy(this.pos[i]);
        if (speed > 1e-3) m.quaternion.setFromUnitVectors(FZ, this._dir);
        m.userData.flame.scale.setScalar(0.8 + Math.random() * 0.5);
        // yellow trail
        tp[a] = this.pos[i].x; tp[a + 1] = this.pos[i].y; tp[a + 2] = this.pos[i].z;
        tp[a + 3] = this.pos[i].x - this.vel[i].x * 0.06;
        tp[a + 4] = this.pos[i].y - this.vel[i].y * 0.06;
        tp[a + 5] = this.pos[i].z - this.vel[i].z * 0.06;
        tc[a] = this._cMsl.r; tc[a + 1] = this._cMsl.g; tc[a + 2] = this._cMsl.b;
        tc[a + 3] = this._cMsl.r * 0.1; tc[a + 4] = this._cMsl.g * 0.1; tc[a + 5] = this._cMsl.b * 0.1;
      } else {
        const isEnemy = this.team[i] === 'enemy';
        bolt.visible = true;
        bolt.material = isEnemy ? this._matE : this._matP;
        bolt.position.copy(this.pos[i]);
        if (speed > 1e-3) bolt.quaternion.setFromUnitVectors(FZ, this._dir);
        if (isEnemy) {
          // always fat, and strobing, so incoming fire is impossible to miss
          const pulse = 2.6 + 0.9 * Math.sin(this.age[i] * 42);
          bolt.scale.set(pulse, pulse, 1.7);
        } else {
          bolt.scale.set(1, 1, 1);
        }
        const col = isEnemy ? this._cE : this._cBolt;
        const trail = isEnemy ? 0.07 : 0.04;
        tp[a] = this.pos[i].x; tp[a + 1] = this.pos[i].y; tp[a + 2] = this.pos[i].z;
        tp[a + 3] = this.pos[i].x - this.vel[i].x * trail;
        tp[a + 4] = this.pos[i].y - this.vel[i].y * trail;
        tp[a + 5] = this.pos[i].z - this.vel[i].z * trail;
        tc[a] = col.r; tc[a + 1] = col.g; tc[a + 2] = col.b;
        tc[a + 3] = col.r * 0.1; tc[a + 4] = col.g * 0.1; tc[a + 5] = col.b * 0.1;
      }
    }

    for (; mi < this.mslMeshes.length; mi++) this.mslMeshes[mi].visible = false;

    this.tgeom.attributes.position.needsUpdate = true;
    this.tgeom.attributes.color.needsUpdate = true;
  }
}

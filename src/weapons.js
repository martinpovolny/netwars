import * as THREE from 'three';

const MAX = 240;
const FZ = new THREE.Vector3(0, 0, 1);

// Pooled projectiles: each active shot is a chunky glowing bolt mesh oriented
// along its velocity, plus a bright additive trail. Player shots gently home
// toward a locked target (NetWars missiles tracked a little).
export class Weapons {
  constructor(scene) {
    this.pos = [];
    this.vel = [];
    this.ttl = new Float32Array(MAX);
    this.team = new Array(MAX).fill(null);
    this.target = new Array(MAX).fill(null);
    for (let i = 0; i < MAX; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
    }
    this.cursor = 0;

    // --- bolt meshes -------------------------------------------------------
    const boltGeo = new THREE.OctahedronGeometry(1, 0);
    boltGeo.scale(2.6, 2.6, 10);            // chunky diamond, elongated along local Z
    this._matP = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });
    this._matE = new THREE.MeshBasicMaterial({ color: 0xff6a44, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });
    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    coreGeo.scale(1.3, 1.3, 5.5);
    const matCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });

    this.bolts = [];
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.Mesh(boltGeo, this._matP);
      m.add(new THREE.Mesh(coreGeo, matCore));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.bolts.push(m);
    }

    // --- trails ----------------------------------------------------------
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

    this._cP = new THREE.Color(0x8fe8ff);
    this._cE = new THREE.Color(0xff5a3c);
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  spawn(pos, vel, team, ttl, target = null) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i].copy(pos);
    this.vel[i].copy(vel);
    this.ttl[i] = ttl;
    this.team[i] = team;
    this.target[i] = target;
  }

  update(dt, player, enemies, pods, explosions, audio, onKill) {
    const tp = this.tpos;
    const tc = this.tcol;

    for (let i = 0; i < MAX; i++) {
      const a = i * 6;
      const bolt = this.bolts[i];

      if (this.ttl[i] <= 0) {
        if (bolt.visible) bolt.visible = false;
        tp[a] = tp[a+1] = tp[a+2] = tp[a+3] = tp[a+4] = tp[a+5] = 0;
        continue;
      }

      this.ttl[i] -= dt;

      // homing for player missiles with a live target
      const tgt = this.target[i];
      if (tgt && !tgt.dead && this.team[i] === 'player') {
        const desired = this._tmp.copy(tgt.position).sub(this.pos[i]).normalize().multiplyScalar(this.vel[i].length());
        this.vel[i].lerp(desired, 1 - Math.pow(0.02, dt));
      }
      this.pos[i].addScaledVector(this.vel[i], dt);

      // collisions
      let hit = false;
      if (this.team[i] === 'player') {
        // player fire hits enemies only — no friendly fire on the pods
        for (const e of enemies.list) {
          if (e.dead) continue;
          if (this.pos[i].distanceToSquared(e.position) < e.radius * e.radius) {
            e.hp -= 12;
            explosions.spark(this.pos[i]);
            if (e.hp <= 0) { e.dead = true; explosions.blast(e.position, 0xffcc55); audio?.boom(); }
            hit = true;
            break;
          }
        }
      } else if (this.team[i] === 'enemy') {
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

      if (this.ttl[i] > 0) {
        const isP = this.team[i] === 'player';
        // bolt mesh
        bolt.visible = true;
        bolt.material = isP ? this._matP : this._matE;
        bolt.position.copy(this.pos[i]);
        const speed = this.vel[i].length();
        if (speed > 1e-3) {
          this._dir.copy(this.vel[i]).multiplyScalar(1 / speed);
          bolt.quaternion.setFromUnitVectors(FZ, this._dir);
        }
        // trail
        const tx = this.pos[i].x - this.vel[i].x * 0.045;
        const ty = this.pos[i].y - this.vel[i].y * 0.045;
        const tz = this.pos[i].z - this.vel[i].z * 0.045;
        tp[a] = this.pos[i].x; tp[a+1] = this.pos[i].y; tp[a+2] = this.pos[i].z;
        tp[a+3] = tx; tp[a+4] = ty; tp[a+5] = tz;
        const col = isP ? this._cP : this._cE;
        tc[a] = col.r; tc[a+1] = col.g; tc[a+2] = col.b;
        tc[a+3] = col.r * 0.1; tc[a+4] = col.g * 0.1; tc[a+5] = col.b * 0.1;
      } else {
        bolt.visible = false;
        tp[a] = tp[a+1] = tp[a+2] = tp[a+3] = tp[a+4] = tp[a+5] = 0;
      }
    }

    this.tgeom.attributes.position.needsUpdate = true;
    this.tgeom.attributes.color.needsUpdate = true;
  }
}

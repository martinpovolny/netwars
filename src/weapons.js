import * as THREE from 'three';

const MAX = 240;

// Pooled projectiles rendered as one LineSegments streak buffer. Player shots
// gently home toward a locked target (NetWars missiles tracked a little).
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

    this.positions = new Float32Array(MAX * 2 * 3);
    this.colors = new Float32Array(MAX * 2 * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.LineSegments(this.geom, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._cP = new THREE.Color(0x9ff0ff);
    this._cE = new THREE.Color(0xff5a3c);
    this._tmp = new THREE.Vector3();
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
    const p = this.positions;
    const c = this.colors;

    for (let i = 0; i < MAX; i++) {
      const a = i * 6;
      if (this.ttl[i] <= 0) { p[a] = p[a+1] = p[a+2] = p[a+3] = p[a+4] = p[a+5] = 0; continue; }

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
        for (const e of enemies.list) {
          if (e.dead) continue;
          if (this.pos[i].distanceToSquared(e.position) < e.radius * e.radius) {
            e.hp -= 12;
            explosions.spark(this.pos[i]);
            if (e.hp <= 0) { e.dead = true; explosions.blast(e.position, 0xffcc55); audio?.boom(); onKill?.('enemy', e); }
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (const pod of pods.list) {
            if (pod.dead) continue;
            if (this.pos[i].distanceToSquared(pod.position) < pod.radius * pod.radius) {
              pod.hp -= 12;
              explosions.spark(this.pos[i]);
              if (pod.hp <= 0) { pod.dead = true; explosions.blast(pod.position, 0xff5ad0); audio?.boom(); onKill?.('pod', pod); }
              hit = true;
              break;
            }
          }
        }
      } else if (this.team[i] === 'enemy') {
        if (player.alive && this.pos[i].distanceToSquared(player.position) < 64) {
          player.damage(9, audio);
          explosions.spark(this.pos[i]);
          hit = true;
        }
      }
      if (hit) this.ttl[i] = 0;

      // write streak
      if (this.ttl[i] > 0) {
        const tx = this.pos[i].x - this.vel[i].x * 0.018;
        const ty = this.pos[i].y - this.vel[i].y * 0.018;
        const tz = this.pos[i].z - this.vel[i].z * 0.018;
        p[a] = this.pos[i].x; p[a+1] = this.pos[i].y; p[a+2] = this.pos[i].z;
        p[a+3] = tx; p[a+4] = ty; p[a+5] = tz;
        const col = this.team[i] === 'player' ? this._cP : this._cE;
        c[a] = c[a+3] = col.r;
        c[a+1] = c[a+4] = col.g;
        c[a+2] = c[a+5] = col.b;
      } else {
        p[a] = p[a+1] = p[a+2] = p[a+3] = p[a+4] = p[a+5] = 0;
      }
    }

    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }
}

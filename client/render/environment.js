import * as THREE from 'three';
import { K } from '../../shared/constants.js';

const E = K.env;
const hex = (s) => parseInt(s.slice(1), 16);

// A soft radial-gradient sprite texture, built once and shared by the nebula
// blobs (tinted per-blob through the material colour).
function nebulaTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

function sphereShell(count, radius) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // even-ish direction on the unit sphere, then a thin radial jitter
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const rad = radius * (0.92 + Math.random() * 0.08);
    arr[i * 3]     = Math.cos(t) * r * rad;
    arr[i * 3 + 1] = u * rad;
    arr[i * 3 + 2] = Math.sin(t) * r * rad;
  }
  return arr;
}

// --- 3-layer flight environment -------------------------------------------
//
//  1. star sphere  — tracks the camera POSITION every frame and nothing else,
//     so stars sweep past when you turn but never translate when you fly.
//     Unfogged; far enough to sit behind everything.
//  2. near-field motes — a small cloud that wraps around the ship and is
//     drawn as short streaks scaled by your velocity (a speed cue, never a
//     hyperspace tunnel).
//  3. reference grid — the y=0 plane, its opacity fading to nothing as you
//     pick up speed.
export class Environment {
  constructor(scene) {
    // ---- layer 1: fixed stars + nebulae -------------------------------
    this.sky = new THREE.Group();
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    const mkStars = (n, size, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(sphereShell(n, E.starRadius), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        color, size, sizeAttenuation: false, fog: false,
        transparent: true, depthWrite: false,
      }));
      pts.frustumCulled = false;
      this.sky.add(pts);
      return pts;
    };
    mkStars(E.starCountDim, E.starSizeDim, hex(E.starColorDim));
    mkStars(E.starCountBright, E.starSizeBright, hex(E.starColorBright));

    const nebTex = nebulaTexture();
    for (const nb of E.nebula) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nebTex, color: hex(nb.color), opacity: E.nebulaOpacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        transparent: true,
      }));
      const d = new THREE.Vector3(...nb.dir).normalize().multiplyScalar(E.starRadius * 0.9);
      spr.position.copy(d);
      spr.scale.setScalar(nb.size);
      this.sky.add(spr);
    }

    // ---- layer 2: near-field motes (drawn as velocity streaks) -------
    this._base = sphereShell(E.moteCount, E.moteField * 0.5);
    // scatter through the volume rather than only on a shell
    for (let i = 0; i < this._base.length; i++) this._base[i] *= Math.random();

    const verts = new Float32Array(E.moteCount * 6);
    const cols = new Float32Array(E.moteCount * 6);
    const head = new THREE.Color(hex(E.moteColorHead));
    const tail = new THREE.Color(hex(E.moteColorTail));
    for (let i = 0; i < E.moteCount; i++) {
      cols[i * 6]     = head.r; cols[i * 6 + 1] = head.g; cols[i * 6 + 2] = head.b;
      cols[i * 6 + 3] = tail.r; cols[i * 6 + 4] = tail.g; cols[i * 6 + 5] = tail.b;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    mg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.motes = new THREE.LineSegments(mg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: E.moteOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);

    // ---- layer 3: reference grid ------------------------------------
    this.grid = new THREE.GridHelper(
      E.gridSize, E.gridDivisions, hex(E.gridColorMajor), hex(E.gridColorMinor),
    );
    this.grid.material.transparent = true;
    this.grid.material.opacity = E.gridOpacityMax;
    scene.add(this.grid);

    this._v = new THREE.Vector3();
  }

  // camera: the viewpoint (drives stars + mote wrap). player: supplies the
  // velocity that stretches the mote streaks and fades the grid.
  update(player, camera) {
    const eye = camera.position;

    // 1. stars — position only, never rotation
    this.sky.position.copy(eye);

    // 2. motes: wrap into an axis-aligned box around the eye, then draw
    //    each as head -> head - vel*k. No floor on the length: when you're
    //    nearly still the segments collapse to nothing and the dust vanishes
    //    (it's purely a speed cue).
    const field = E.moteField;
    const halfF = field * 0.5;
    const b = this._base;
    const pos = this.motes.geometry.attributes.position.array;

    const s = this._v.copy(player.velocity).multiplyScalar(-E.moteStreakScale);
    if (s.lengthSq() > E.moteStreakMax * E.moteStreakMax) s.setLength(E.moteStreakMax);

    for (let i = 0; i < E.moteCount; i++) {
      let x = b[i * 3]     + eye.x;
      let y = b[i * 3 + 1] + eye.y;
      let z = b[i * 3 + 2] + eye.z;
      if (x - eye.x >  halfF) { b[i * 3]     -= field; x -= field; }
      if (x - eye.x < -halfF) { b[i * 3]     += field; x += field; }
      if (y - eye.y >  halfF) { b[i * 3 + 1] -= field; y -= field; }
      if (y - eye.y < -halfF) { b[i * 3 + 1] += field; y += field; }
      if (z - eye.z >  halfF) { b[i * 3 + 2] -= field; z -= field; }
      if (z - eye.z < -halfF) { b[i * 3 + 2] += field; z += field; }
      pos[i * 6]     = x;         pos[i * 6 + 1] = y;         pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + s.x;   pos[i * 6 + 4] = y + s.y;   pos[i * 6 + 5] = z + s.z;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;

    // 3. grid: snap under the ship, fade out as speed climbs
    const snap = E.gridSnap;
    this.grid.position.set(
      Math.round(eye.x / snap) * snap, 0, Math.round(eye.z / snap) * snap,
    );
    const speed = player.velocity.length();
    const f = Math.max(0, 1 - speed / E.gridFadeSpeed);
    this.grid.material.opacity = E.gridOpacityMax * f;
    this.grid.visible = f > 0.01;
  }
}

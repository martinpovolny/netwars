import * as THREE from 'three';
import { K } from '../../shared/constants.js';
import STARS from './stars.json' with { type: 'json' };
import CONSTELLATIONS from './constellations.json' with { type: 'json' };

const E = K.env;
const hex = (s) => parseInt(s.slice(1), 16);

// RA (hours) / Dec (degrees) -> a point on the sky sphere of radius R. Same
// convention the star catalogue uses, so constellation lines land exactly on
// their stars.
function radecToVec(raHours, decDeg, R) {
  const ra = raHours * Math.PI / 12;
  const dec = decDeg * Math.PI / 180;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra) * R, Math.sin(dec) * R, cd * Math.sin(ra) * R];
}

// B-V colour index -> approximate RGB. A few stops, lerped; enough to tell a
// hot blue star from a cool orange one without a full black-body fit.
const BV_STOPS = [
  [-0.4, [0.70, 0.80, 1.00]],
  [ 0.0, [0.82, 0.88, 1.00]],
  [ 0.6, [1.00, 0.97, 0.92]],
  [ 1.0, [1.00, 0.88, 0.74]],
  [ 1.6, [1.00, 0.78, 0.60]],
  [ 2.2, [1.00, 0.70, 0.52]],
];
function bvColor(bv, out) {
  let a = BV_STOPS[0], b = BV_STOPS[BV_STOPS.length - 1];
  for (let i = 0; i < BV_STOPS.length - 1; i++) {
    if (bv >= BV_STOPS[i][0] && bv <= BV_STOPS[i + 1][0]) {
      a = BV_STOPS[i]; b = BV_STOPS[i + 1]; break;
    }
  }
  const t = b[0] === a[0] ? 0 : (bv - a[0]) / (b[0] - a[0]);
  out[0] = a[1][0] + (b[1][0] - a[1][0]) * t;
  out[1] = a[1][1] + (b[1][1] - a[1][1]) * t;
  out[2] = a[1][2] + (b[1][2] - a[1][2]) * t;
  return out;
}

// A constellation name as a camera-facing billboard, rendered once to a
// canvas texture (cheap: 12 of these total, built once at load).
function makeLabelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '400 48px "DejaVu Sans Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = E.constellationLabelColor;
  ctx.shadowColor = E.constellationLabelColor;
  ctx.shadowBlur = 6;
  ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: E.constellationLabelOpacity,
    depthWrite: false, fog: false,
  }));
  const h = E.constellationLabelSize;
  sprite.scale.set(h * (canvas.width / canvas.height), h, 1);
  return sprite;
}

function scatterShell(count, radius) {
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
//  1. star sphere  — the real HYG catalogue (naked-eye sky, mag <= 6.5) placed
//     by RA/Dec, sized and coloured per star. Tracks the camera POSITION every
//     frame and nothing else, so constellations sweep past when you turn but
//     never translate when you fly. Unfogged; sits behind everything.
//  2. near-field motes — a small cloud that wraps around the ship, drawn as
//     short faint streaks scaled by your velocity (a speed cue, never a
//     hyperspace tunnel; invisible at rest).
//  3. reference grid — the y=0 plane, its opacity fading to nothing as you
//     pick up speed.
//
// A 4th, optional overlay rides on the star sphere: the official/traditional
// stick-figure lines for a dozen well-known constellations, off by default
// (see setConstellations/toggleConstellations).
export class Environment {
  constructor(scene) {
    // ---- layer 1: real star catalogue -----------------------------
    this.sky = new THREE.Group();
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    this._buildStars();
    this._buildConstellations();

    // ---- layer 2: near-field motes (drawn as velocity streaks) -------
    this._base = scatterShell(E.moteCount, E.moteField * 0.5);
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

  // Split the catalogue into a few magnitude buckets so bright stars render
  // bigger (constellations stay legible) without a per-point-size shader.
  _buildStars() {
    const n = STARS.n;
    const R = E.starRadius;
    const splits = E.starBucketMag;    // e.g. [3.0, 5.0]
    const sizes = E.starBucketSize;    // one per bucket, bright -> faint
    const faintDim = E.starFaintDim;

    const buckets = sizes.map(() => ({ pos: [], col: [] }));
    const rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const [x, y, z] = radecToVec(STARS.ra[i], STARS.dec[i], R);

      const mag = STARS.mag[i];
      let bi = buckets.length - 1;
      for (let s = 0; s < splits.length; s++) {
        if (mag <= splits[s]) { bi = s; break; }
      }
      bvColor(STARS.ci[i], rgb);
      // fade the faintest bucket a touch so a dense sky doesn't wash grey
      const k = bi === buckets.length - 1 ? faintDim : 1;
      const b = buckets[bi];
      b.pos.push(x, y, z);
      b.col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
    }

    this.starLayers = buckets.map((b, bi) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        size: sizes[bi], sizeAttenuation: false, vertexColors: true,
        fog: false, transparent: true, depthWrite: false,
      }));
      pts.frustumCulled = false;
      this.sky.add(pts);
      return pts;
    });
  }

  // The official/traditional stick-figure charts (a dozen well-known
  // constellations, see client/render/constellations.json) — one shared
  // line buffer plus a small billboard label per constellation. Off by
  // default; toggled at runtime via setConstellations()/toggleConstellations().
  _buildConstellations() {
    const R = E.starRadius;
    const pos = [];
    for (const c of CONSTELLATIONS.constellations) {
      const vecs = c.stars.map(([ra, dec]) => radecToVec(ra, dec, R));
      for (const [i, j] of c.lines) pos.push(...vecs[i], ...vecs[j]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: hex(E.constellationColor), transparent: true,
      opacity: E.constellationOpacity, depthWrite: false, fog: false,
    }));
    lines.frustumCulled = false;

    const labels = new THREE.Group();
    for (const c of CONSTELLATIONS.constellations) {
      const raC = c.stars.reduce((s, st) => s + st[0], 0) / c.stars.length;
      const decC = c.stars.reduce((s, st) => s + st[1], 0) / c.stars.length;
      const sprite = makeLabelSprite(c.name);
      sprite.position.set(...radecToVec(raC, decC, R));
      labels.add(sprite);
    }

    this.constellations = new THREE.Group();
    this.constellations.add(lines, labels);
    this.constellations.visible = E.constellationDefaultOn;
    this.sky.add(this.constellations);
    this.showConstellations = E.constellationDefaultOn;
  }

  setConstellations(on) {
    this.showConstellations = on;
    this.constellations.visible = on;
    return on;
  }

  toggleConstellations() {
    return this.setConstellations(!this.showConstellations);
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

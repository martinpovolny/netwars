import * as THREE from 'three';

// log-scale zoom ladder. The first 5 steps (800..8000) are the original,
// hand-tuned combat-range steps — unchanged. Six more continue at roughly
// the same ~1.75x ratio out past 200,000u: comfortably beyond any distance
// a drifting or boosting player could realistically reach mid-session, so
// the auto zoom-out below (see Radar#_autoZoom) always has a wider step
// left to try instead of ever just running out of road.
function buildRadarRanges() {
  const ranges = [800, 1500, 2600, 4500, 8000];
  const ratio = 1.75, extraSteps = 6;
  let r = ranges[ranges.length - 1];
  for (let i = 0; i < extraSteps; i++) {
    r *= ratio;
    ranges.push(Math.round(r / 100) * 100);
  }
  return ranges;
}

// Bottom-right "scanner": a perspective grid plane aligned with the ship
// (x = right, -z = forward). Each contact is a vertical line segment (stalk)
// rising/falling from the plane by its relative altitude — the NetWars way of
// showing the third dimension on a flat radar.
export class Radar {
  constructor() {
    // selectable scan range (world units mapped to the grid edge)
    this.ranges = buildRadarRanges();
    this.rangeIndex = 2;
    this.range = this.ranges[this.rangeIndex];
    this.halfW = 10;         // grid half-width in radar space
    this.vScale = 1.15;      // altitude exaggeration for readability

    this.depth = 13;         // grid half-depth in radar space (forward & aft)

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 100);
    this.camera.position.set(0, 13, 21);
    this.camera.lookAt(0, 0, -2);

    // grid lines on y=0, symmetric so the ship sits at the centre
    const seg = [];
    const x0 = -this.halfW, x1 = this.halfW, z0 = -this.depth, z1 = this.depth;
    const cols = 6, rows = 8;
    for (let i = 0; i <= cols; i++) {
      const x = x0 + (x1 - x0) * (i / cols);
      seg.push(x, 0, z0, x, 0, z1);
    }
    for (let j = 0; j <= rows; j++) {
      const z = z0 + (z1 - z0) * (j / rows);
      seg.push(x0, 0, z, x1, 0, z);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xd21f1f, transparent: true, opacity: 0.7 })));

    // own-ship marker at the centre of the plane, pointing forward (-z / into screen)
    const me = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 4), new THREE.MeshBasicMaterial({ color: 0x35e04a }));
    me.rotation.x = -Math.PI / 2;
    this.scene.add(me);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8fffa0 }));
    this.scene.add(dot);

    this.blips = [];
    const bg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 48; i++) {
      const cube = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xff3030 }));
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff3030 }));
      cube.visible = false;
      line.visible = false;
      this.scene.add(cube, line);
      this.blips.push({ cube, line });
    }

    this._inv = new THREE.Quaternion();
    this._rel = new THREE.Vector3();

    // auto zoom-out: a player who drifts or boosts off the edge of their
    // current range has nothing on radar and no cue which way to fly back.
    // Once the radar has read completely empty for autoExpandDelay seconds
    // straight, it starts stepping outward on its own (one ranges[] step
    // every autoStepInterval) until a contact reappears or it tops out at
    // the widest level — never zooms back in on its own, only out. A manual
    // zoom (either direction, see `zoom()`) resets the grace timer, so
    // deliberately zooming into empty space isn't instantly overridden.
    this.autoExpandDelay = 0.8;
    this.autoStepInterval = 0.15;
    this._emptyT = 0;
    this._stepCd = 0;
    this._autoActive = false;   // currently mid-episode (for the one-shot "started" flag)
    this._maxedNotified = false; // this episode already told the caller it topped out empty
    this.autoZoomStarted = false;  // one-shot per episode: caller may flash a "scanning" message
    this.autoZoomMaxedOut = false; // one-shot per episode: topped out and still nothing
  }

  // dir > 0 zooms in (shorter range), dir < 0 zooms out (longer range)
  zoom(dir) {
    this.rangeIndex = THREE.MathUtils.clamp(this.rangeIndex - Math.sign(dir), 0, this.ranges.length - 1);
    this.range = this.ranges[this.rangeIndex];
    this._emptyT = 0; // manual input always gets a fresh grace window before auto-expand reconsiders
  }

  // called from update() with whether anything was placed on radar this
  // frame; steps rangeIndex outward on its own per the constructor comment.
  _autoZoom(hasContacts, dt) {
    this.autoZoomStarted = false;
    this.autoZoomMaxedOut = false;
    if (hasContacts) {
      this._emptyT = 0;
      this._stepCd = 0;
      this._autoActive = false;
      this._maxedNotified = false;
      return;
    }
    this._emptyT += dt;
    if (this._emptyT < this.autoExpandDelay) return;
    if (this.rangeIndex >= this.ranges.length - 1) {
      if (!this._maxedNotified) { this._maxedNotified = true; this.autoZoomMaxedOut = true; }
      return;
    }
    this._stepCd -= dt;
    if (this._stepCd > 0) return;
    this._stepCd = this.autoStepInterval;
    if (!this._autoActive) { this._autoActive = true; this.autoZoomStarted = true; }
    this.rangeIndex++;
    this.range = this.ranges[this.rangeIndex];
  }

  // level 1 = most zoomed in (shortest range) .. N = most zoomed out
  get zoomLevel() { return this.ranges.length - this.rangeIndex; }
  get maxZoom() { return this.ranges.length; }

  _place(b, rel, color) {
    const s = this.halfW / this.range;
    let x = rel.x * s;
    let z = rel.z * s;
    x = THREE.MathUtils.clamp(x, -this.halfW, this.halfW);
    z = THREE.MathUtils.clamp(z, -this.depth, this.depth);
    const y = THREE.MathUtils.clamp(rel.y * s * this.vScale, -8, 8);

    b.cube.visible = true;
    b.line.visible = true;
    b.cube.position.set(x, y, z);
    // keep blips roughly constant on screen despite perspective
    const camDist = Math.hypot(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
    b.cube.scale.setScalar(THREE.MathUtils.clamp(camDist * 0.03, 0.35, 0.9));
    const a = b.line.geometry.attributes.position.array;
    a[0] = x; a[1] = 0; a[2] = z;
    a[3] = x; a[4] = y; a[5] = z;
    b.line.geometry.attributes.position.needsUpdate = true;
    b.cube.material.color.setHex(color);
    b.line.material.color.setHex(color);
  }

  // missiles: [{ position, mine }] — active missile-kind projectiles. `mine`
  // picks a calmer colour for your own outgoing shot; an opponent's missile
  // (the actual threat) shows as amber, flipping to red once it's close.
  // dt drives the auto zoom-out (see _autoZoom) — omit it (e.g. a one-off
  // render) to just skip that bookkeeping for the call.
  update(player, enemies, pods, bonuses, others, missiles, dt = 0) {
    this._inv.copy(player.quaternion).invert();
    let i = 0;

    const feed = (obj, color, dangerColor, dangerDist) => {
      if (i >= this.blips.length) return;
      this._rel.copy(obj.position).sub(player.position);
      const d = this._rel.length();
      if (d > this.range * 1.5) return;
      this._rel.applyQuaternion(this._inv);
      const c = dangerDist && d < dangerDist ? dangerColor : color;
      this._place(this.blips[i++], this._rel, c);
    };

    for (const e of enemies.list) if (!e.dead) feed(e, 0xff5555, 0xff1010, 500);
    for (const p of pods.list) if (!p.dead) feed(p, 0xd93bd0, 0xd93bd0, 0);
    if (bonuses) for (const b of bonuses.list) if (!b.dead) feed(b, b.kind === 'repair' ? 0x2fe06a : 0x3ad0ff, 0xffffff, 0);
    if (others) for (const o of others) if (o.alive !== false) feed(o, o.color || 0xffb020, o.color || 0xffb020, 0);
    if (missiles) for (const m of missiles) feed(m, m.mine ? 0xfff2a8 : 0xff8a1a, 0xff2020, m.mine ? 0 : 500);

    for (; i < this.blips.length; i++) {
      this.blips[i].cube.visible = false;
      this.blips[i].line.visible = false;
    }

    this._autoZoom(i > 0, dt);
  }

  render(renderer, r) {
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    renderer.setViewport(r.x, r.y, r.w, r.h);
    this.camera.aspect = r.w / r.h;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

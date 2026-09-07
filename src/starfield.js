import * as THREE from 'three';

// Wrapping point starfield + faint reference grid so motion reads in empty space.
export class Starfield {
  constructor(scene) {
    this.size = 7000;
    const N = 3800;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) arr[i] = (Math.random() - 0.5) * this.size;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xc8d4ff, size: 2, sizeAttenuation: false })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.grid = new THREE.GridHelper(16000, 64, 0x14384a, 0x0b2230);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.22;
    scene.add(this.grid);
  }

  update(player) {
    const a = this.points.geometry.attributes.position.array;
    const s = this.size;
    const h = s / 2;
    const c = player.position;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i]     - c.x > h) a[i]     -= s; else if (a[i]     - c.x < -h) a[i]     += s;
      if (a[i + 1] - c.y > h) a[i + 1] -= s; else if (a[i + 1] - c.y < -h) a[i + 1] += s;
      if (a[i + 2] - c.z > h) a[i + 2] -= s; else if (a[i + 2] - c.z < -h) a[i + 2] += s;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.grid.position.set(Math.round(c.x / 400) * 400, 0, Math.round(c.z / 400) * 400);
  }
}

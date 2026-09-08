import * as THREE from 'three';

// Top-left "direction indication": a 3D world-axis tripod drawn in a fixed
// camera while the axes carry the inverse of the ship's orientation, so the
// cross swings as you pitch/yaw/roll (as in NetWars).
export class OrientationInset {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(6, 5, 26);
    this.camera.lookAt(0, 0, 0);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    const L = 11;
    const arm = (ax, color) => {
      const pos = new THREE.BufferGeometry();
      pos.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ax[0] * L, ax[1] * L, ax[2] * L], 3));
      this.group.add(new THREE.LineSegments(pos, new THREE.LineBasicMaterial({ color })));

      const neg = new THREE.BufferGeometry();
      neg.setAttribute('position', new THREE.Float32BufferAttribute(
        [0, 0, 0, -ax[0] * L * 0.5, -ax[1] * L * 0.5, -ax[2] * L * 0.5], 3));
      this.group.add(new THREE.LineSegments(neg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })));

      const tip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshBasicMaterial({ color }));
      tip.position.set(ax[0] * L, ax[1] * L, ax[2] * L);
      this.group.add(tip);
    };

    arm([1, 0, 0], 0xff3030);   // X  red
    arm([0, 1, 0], 0x35e04a);   // Y  green
    arm([0, 0, 1], 0xdfe7ef);   // Z  white

    this._inv = new THREE.Quaternion();
  }

  update(player) {
    this._inv.copy(player.quaternion).invert();
    this.group.quaternion.copy(this._inv);
  }

  render(renderer, r) {
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    renderer.setViewport(r.x, r.y, r.w, r.h);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

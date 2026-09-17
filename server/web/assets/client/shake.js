import * as THREE from 'three';

const FORWARD = new THREE.Vector3(0, 0, -1);

// Camera-space "you got hit" feedback: a brief random positional jitter plus
// a one-shot roll impulse that snaps in and eases back to zero. Purely a
// rendering effect applied to the camera each frame — it never touches the
// ship's own position/quaternion, so it can't affect flight feel, aiming,
// or (in multiplayer) the server-authoritative state / reconciliation.
export class ScreenShake {
  constructor() {
    this._t = 0;         // seconds remaining in the current shake
    this._dur = 0.001;   // total duration of the current shake, for normalizing decay
    this._posMag = 0;    // current positional jitter amplitude, world units
    this._rollMag = 0;   // current roll amplitude, radians
    this._rollSign = 1;
    this._offset = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  // amount: 0..1 relative severity (a grazing bolt vs. a ship-to-ship ram).
  // Kicking while a shake is already playing takes the stronger/longer of
  // the two rather than restarting from a weaker baseline, so a rapid
  // string of hits escalates instead of constantly resetting to a flicker.
  kick(amount = 1) {
    const dur = 0.25 + 0.18 * amount;
    const posMag = 3 + 9 * amount;
    const rollMag = THREE.MathUtils.degToRad(6 + 10 * amount);
    if (dur > this._t) { this._t = dur; this._dur = dur; }
    this._posMag = Math.max(this._posMag, posMag);
    this._rollMag = Math.max(this._rollMag, rollMag);
    this._rollSign = Math.random() < 0.5 ? -1 : 1;
  }

  update(dt) {
    if (this._t > 0) this._t = Math.max(0, this._t - dt);
  }

  get active() { return this._t > 0; }

  // Offsets camera.position and rolls camera.quaternion around its own
  // forward axis. Call AFTER the camera has been set to the ship's real
  // pose for this frame (first-person only — never while spectating).
  apply(camera) {
    if (this._t <= 0) return;
    const k = this._t / this._dur; // 1 -> 0 over the shake's life

    const posMag = this._posMag * k;
    if (posMag > 0.01) {
      this._offset.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      this._offset.multiplyScalar(posMag);
      camera.position.add(this._offset);
    }

    const roll = this._rollMag * k * k * this._rollSign; // k^2: snaps in hard, eases out
    if (Math.abs(roll) > 0.0005) {
      this._q.setFromAxisAngle(FORWARD, roll);
      camera.quaternion.multiply(this._q);
    }
  }
}

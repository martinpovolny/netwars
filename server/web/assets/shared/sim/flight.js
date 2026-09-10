// Newtonian flight step — shared by the SP client, the MP client (prediction)
// and the Go server (authority). Pure: mutates `ship.{position,quaternion,
// velocity}` in place from a normalized control struct. No THREE meshes, no DOM.
import { Vector3, Quaternion, Euler } from './vec.js';

const FWD = new Vector3(0, 0, -1);

// module scratch (one ship stepped at a time)
const _dq = new Quaternion();
const _e = new Euler();
const _f = new Vector3();

// ship:    { position:Vector3, quaternion:Quaternion, velocity:Vector3 }
// control: { intentX, intentY, roll:-1|0|1, thrust:-1|0|1, brake:bool,
//            boost:bool, stop:bool }   (intent is already eased, -1..1)
// K:       constants.player
export function stepShip(ship, control, dt, K) {
  // --- turn toward the deployed intent marker, rate-limited ---
  const yaw = -control.intentX * K.turnFactor * dt;
  const pitch = -control.intentY * K.turnFactor * dt;
  const roll = (control.roll || 0) * K.rollRate * dt;
  _e.set(pitch, yaw, roll, 'XYZ');
  _dq.setFromEuler(_e);
  ship.quaternion.multiply(_dq).normalize();

  // --- thrust / reverse: impulses along the nose; momentum persists ---
  const fwd = _f.copy(FWD).applyQuaternion(ship.quaternion);
  const boost = control.boost ? K.boostMult : 1;
  if (control.thrust) {
    ship.velocity.addScaledVector(fwd, control.thrust * K.thrustAccel * boost * dt);
  }

  // --- brake: bleed speed along the facing axis, either direction ---
  if (control.brake) {
    const along = ship.velocity.dot(fwd);
    const cut = Math.sign(along) * Math.min(Math.abs(along), K.brakeAccel * dt);
    ship.velocity.addScaledVector(fwd, -cut);
  }
  // --- full stop: quickly null all momentum ---
  if (control.stop) ship.velocity.multiplyScalar(Math.max(0, 1 - 4 * dt));

  // --- ambient drag (tiny) + speed cap + integrate ---
  ship.velocity.multiplyScalar(Math.max(0, 1 - K.drag * dt));
  if (ship.velocity.length() > K.maxSpeed) ship.velocity.setLength(K.maxSpeed);
  ship.position.addScaledVector(ship.velocity, dt);
}

// Newtonian flight step — shared by the SP client, the MP client (prediction)
// and the Go server (authority). Pure: mutates `ship.{position,quaternion,
// velocity}` in place from a normalized control struct. No THREE meshes, no DOM.
import { Vector3, Quaternion, Euler } from './vec.js';

const FWD = new Vector3(0, 0, -1);

// module scratch (one ship stepped at a time)
const _dq = new Quaternion();
const _e = new Euler();
const _f = new Vector3();

// ship:    { position:Vector3, quaternion:Quaternion, velocity:Vector3,
//            boostFuel:number }   (boostFuel: seconds of boost left, 0..K.boostFuelMax)
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

  // --- boost fuel: a few seconds of continuous boost, then it's spent and
  // recharges over a couple more. Recharge is gated on the raw held-key
  // state, not on `boosting` below — otherwise the instant fuel hits 0
  // while the key is still down, boosting would flip false, fall into the
  // recharge branch, refill a hair, flip true again next tick, and drain
  // again: a one-tick stutter that's effectively free boost forever right
  // at empty. Held past empty is simply pinned at 0 until you let go.
  // `ship.boosting` is finalized here so the HUD (which reads it after this
  // call) reflects whether boost actually took effect, not just the key.
  const wantBoost = !!control.boost;
  const boosting = wantBoost && ship.boostFuel > 0;
  ship.boosting = boosting;
  if (wantBoost) ship.boostFuel = Math.max(0, ship.boostFuel - dt);
  else ship.boostFuel = Math.min(K.boostFuelMax, ship.boostFuel + K.boostRechargeRate * dt);

  // --- thrust / reverse: impulses along the nose; momentum persists ---
  const fwd = _f.copy(FWD).applyQuaternion(ship.quaternion);
  const boost = boosting ? K.boostMult : 1;
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
  // the cap itself lifts while boosting (boostMaxSpeed, well above a
  // missile's cruise speed) so holding boost in a straight line is a real
  // way to outrun a missile, not just a faster way to reach the same wall.
  // Releasing boost (or running out of fuel) mid-chase reverts the cap
  // immediately rather than easing back down — a deliberate simplification:
  // it only bites if you're still above the base cap when that happens,
  // i.e. after you've already opened the gap that mattered.
  ship.velocity.multiplyScalar(Math.max(0, 1 - K.drag * dt));
  const cap = boosting ? K.boostMaxSpeed : K.maxSpeed;
  if (ship.velocity.length() > cap) ship.velocity.setLength(cap);
  ship.position.addScaledVector(ship.velocity, dt);
}

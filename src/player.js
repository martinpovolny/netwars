import * as THREE from 'three';

const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// NetWars-style control:
//  - the mouse moves a screen-space "deployed" intent marker (`intent`)
//  - `intent` chases the raw mouse position with a short lag
//  - the ship yaws/pitches toward `intent` at a capped rate (its Turn Factor)
// So the nose (screen centre) swings to follow the marker with weight.
export class Player {
  constructor() {
    this.position = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    this.boosting = false;
    this.thrusting = 0;        // -1 reverse, 0, +1 forward (for the HUD)
    this.hull = 100;
    this.maxHull = 100;
    this.alive = true;
    this.invuln = 0;         // brief grace after (re)spawn
    this.hitPulse = 0;       // 0..1, spikes on damage, decays -> drives the red vignette

    this.missiles = 16;       // guided missiles (the dull cannon is unlimited)
    this.maxMissiles = 16;
    this.lockTarget = null;   // enemy currently inside the centre lock ring (set by main)

    // control state (each component roughly -1..1, fraction of full deflection)
    this.mouse = new THREE.Vector2(0, 0);   // raw cursor (tiny white rect)
    this.intent = new THREE.Vector2(0, 0);  // deployed direction marker

    // tuning — Newtonian: thrust/reverse are impulses, momentum persists
    this.thrustAccel = 240;   // u/s^2 along the nose
    this.brakeAccel = 320;    // u/s^2 bleeding speed along the facing axis
    this.boostMult = 2.4;
    this.drag = 0.02;         // almost none — momentum stays
    this.maxSpeed = 620;
    this.mouseGain = 0.0042;   // px -> deflection
    this.intentLag = 8;        // how fast the marker chases the cursor
    this.mouseRecenter = 0.35; // gentle pull of the cursor back to centre
    this.turnFactor = 1.9;     // rad/s at full deflection
    this.rollRate = 2.0;
    this.gunInterval = 0.1;    // unlimited dull cannon
    this.missileInterval = 0.35;
    this.missileMuzzle = 700;  // constant added to ship momentum on launch
    this.missileLife = 4.5;    // limited lifespan (s)
    this._gunCd = 0;
    this._mslCd = 0;

    this._dq = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  forward(out = new THREE.Vector3()) { return out.copy(FWD).applyQuaternion(this.quaternion); }
  right(out = new THREE.Vector3()) { return out.copy(RIGHT).applyQuaternion(this.quaternion); }
  up(out = new THREE.Vector3()) { return out.copy(UP).applyQuaternion(this.quaternion); }
  speed() { return this.velocity.length(); }

  update(dt, input, weapons, enemies, audio) {
    // missiles are a limited resource — refilled only on respawn / new level
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.hitPulse > 0) this.hitPulse = Math.max(0, this.hitPulse - dt * 3.5);
    if (!this.alive) return;

    // --- cursor + deployed intent marker ---
    const m = input.takeMouse();
    this.mouse.x = THREE.MathUtils.clamp(this.mouse.x + m.x * this.mouseGain, -1, 1);
    this.mouse.y = THREE.MathUtils.clamp(this.mouse.y + m.y * this.mouseGain, -1, 1);
    const rc = Math.max(0, 1 - this.mouseRecenter * dt);
    this.mouse.multiplyScalar(rc);

    const k = 1 - Math.exp(-this.intentLag * dt);
    this.intent.x += (this.mouse.x - this.intent.x) * k;
    this.intent.y += (this.mouse.y - this.intent.y) * k;

    // --- turn the ship toward the marker (rate-limited) ---
    let roll = 0;
    if (input.has('KeyA')) roll += this.rollRate * dt;
    if (input.has('KeyD')) roll -= this.rollRate * dt;
    const yaw = -this.intent.x * this.turnFactor * dt;
    const pitch = -this.intent.y * this.turnFactor * dt;
    this._e.set(pitch, yaw, roll, 'XYZ');
    this._dq.setFromEuler(this._e);
    this.quaternion.multiply(this._dq).normalize();

    // --- thrust / reverse: impulses along the nose; momentum persists ---
    this.boosting = input.has('ShiftLeft') || input.has('ShiftRight');
    const boost = this.boosting ? this.boostMult : 1;
    const fwd = this.forward(this._f);

    let thrusting = 0;
    if (input.has('KeyW') || input.has('ArrowUp')) thrusting += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) thrusting -= 1;
    this.thrusting = thrusting;
    if (thrusting) this.velocity.addScaledVector(fwd, thrusting * this.thrustAccel * boost * dt);

    // brake (C): bleed off speed along the facing axis, either direction
    if (input.has('KeyC')) {
      const along = this.velocity.dot(fwd);
      const cut = Math.sign(along) * Math.min(Math.abs(along), this.brakeAccel * dt);
      this.velocity.addScaledVector(fwd, -cut);
    }
    // full stop (X): quickly null all momentum
    if (input.has('KeyX')) this.velocity.multiplyScalar(Math.max(0, 1 - 4 * dt));

    this.velocity.multiplyScalar(Math.max(0, 1 - this.drag * dt));
    if (this.velocity.length() > this.maxSpeed) this.velocity.setLength(this.maxSpeed);
    this.position.addScaledVector(this.velocity, dt);

    // --- primary: unlimited dull cannon (Space / LMB) ---
    // fired from wing pods set back beside/below the cockpit, so the bolts
    // stream forward into view from the sides rather than popping up ahead
    this._gunCd -= dt;
    const right = this.right(this._r);
    const up = this.up(this._u);
    if ((input.has('Space') || input.mouseFire) && this._gunCd <= 0) {
      this._gunCd = this.gunInterval;
      const muzzle = 1500;
      for (const side of [-1, 1]) {
        const p = this.position.clone()
          .addScaledVector(right, side * 18)
          .addScaledVector(up, -4)
          .addScaledVector(fwd, -10);
        const v = this.velocity.clone().addScaledVector(fwd, muzzle);
        weapons.spawn(p, v, 'player', 2.0, null, 'bolt');
      }
      audio?.laser();
    }

    // --- secondary: guided missile (F / RMB), one on screen, limited ammo ---
    this._mslCd -= dt;
    const wantMissile = input.has('KeyF') || input.mouseRight;
    if (wantMissile && this._mslCd <= 0 && this.missiles > 0 && !weapons.playerMissileActive()) {
      this._mslCd = this.missileInterval;
      this.missiles--;
      // guides only if something is locked in the centre ring at launch;
      // otherwise it flies ballistic (no re-acquire)
      const target = this.lockTarget && !this.lockTarget.dead ? this.lockTarget : null;
      // launch from a belly rail: slightly ahead and low
      const p = this.position.clone().addScaledVector(fwd, 6).addScaledVector(up, -4);
      // straight ahead: ship momentum + a constant forward
      const v = this.velocity.clone().addScaledVector(fwd, this.missileMuzzle);
      weapons.spawn(p, v, 'player', this.missileLife, target, 'missile');
      audio?.laser();
    }
  }

  damage(amount, audio) {
    if (!this.alive || this.invuln > 0) return;
    this.hull -= amount;
    this.hitPulse = 1;
    audio?.hit();
    if (this.hull <= 0) {
      this.hull = 0;
      this.alive = false;
    }
  }

  // full reset — used when a level (re)starts
  reset() {
    this.position.set(0, 0, 0);
    this.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.thrusting = 0;
    this.hull = this.maxHull;
    this.missiles = this.maxMissiles;
    this.mouse.set(0, 0);
    this.intent.set(0, 0);
    this.invuln = 1.5;
    this.hitPulse = 0;
    this.alive = true;
  }

  // respawn in place after being destroyed — the level continues
  respawn() {
    this.velocity.set(0, 0, 0);
    this.thrusting = 0;
    this.hull = this.maxHull;
    this.missiles = this.maxMissiles;
    this.mouse.set(0, 0);
    this.intent.set(0, 0);
    this.invuln = 2.0;
    this.hitPulse = 0;
    this.alive = true;
  }
}

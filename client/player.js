import * as THREE from 'three';
import { K } from '../shared/constants.js';
import { stepShip } from '../shared/sim/flight.js';

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

    // Newtonian flight tuning now lives in shared/constants.json (K.player);
    // stepShip() reads it. These are client-side feel knobs only:
    this.maxSpeed = K.player.maxSpeed;   // kept for the V-gauge readout
    this.mouseGain = K.player.mouseGain;
    this.intentLag = K.player.intentLag;
    this.mouseRecenter = K.player.mouseRecenter;
    this.gunInterval = K.player.gunInterval;
    this.missileInterval = K.player.missileInterval;
    this.missileMuzzle = K.player.missileMuzzle;
    this.missileLife = K.player.missileLife;
    this._gunCd = 0;
    this._mslCd = 0;

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

    // --- Newtonian flight (shared sim) ---
    this.boosting = input.has('ShiftLeft') || input.has('ShiftRight');
    let thrusting = 0;
    if (input.has('KeyW') || input.has('ArrowUp')) thrusting += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) thrusting -= 1;
    this.thrusting = thrusting;

    let roll = 0;
    if (input.has('KeyA')) roll += 1;
    if (input.has('KeyD')) roll -= 1;

    stepShip(this, {
      intentX: this.intent.x,
      intentY: this.intent.y,
      roll,
      thrust: thrusting,
      brake: input.has('KeyC'),
      boost: this.boosting,
      stop: input.has('KeyX'),
    }, dt, K.player);

    const fwd = this.forward(this._f);

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

  giveMissiles(n) { this.missiles = Math.min(this.maxMissiles, this.missiles + n); }
  repair(n) { this.hull = Math.min(this.maxHull, this.hull + n); }

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

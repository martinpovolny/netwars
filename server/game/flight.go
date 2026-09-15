package game

import "math"

// Newtonian flight — the Go twin of shared/sim/flight.js#stepShip. The client
// predicts its own ship with the same maths; the server integrates each ship
// from its inputs so it stays authoritative for hits and collisions.

// Control is one frame of normalized ship input (intent already eased, -1..1).
type Control struct {
	IntentX, IntentY   float64
	Roll               float64 // -1|0|1
	Thrust             float64 // -1|0|1
	Brake, Boost, Stop bool
	FireGun            bool
	FireMissile        bool
}

// StepShip mutates ship.{Pos,Quat,Vel} from control over dt seconds.
func StepShip(ship *Ship, c Control, dt float64, kp PlayerBlock) {
	// turn toward the deployed intent marker, rate-limited
	yaw := -c.IntentX * kp.TurnFactor * dt
	pitch := -c.IntentY * kp.TurnFactor * dt
	roll := c.Roll * kp.RollRate * dt
	var dq Quat
	dq.SetFromEulerXYZ(pitch, yaw, roll)
	ship.Quat.Multiply(dq)
	ship.Quat.Normalize()

	// boost fuel: a few seconds of continuous boost, then it's spent and
	// recharges over a couple more. Recharge is gated on the raw held-key
	// state (c.Boost), not on `boosting` below — otherwise the instant fuel
	// hits 0 while the key is still down, boosting would flip false, fall
	// into the recharge branch, refill a hair, flip true again next tick,
	// and drain again: a one-tick stutter that's effectively free boost
	// forever right at empty. Held past empty is pinned at 0 until you let
	// go (twin of shared/sim/flight.js#stepShip).
	boosting := c.Boost && ship.BoostFuel > 0
	if c.Boost {
		ship.BoostFuel = math.Max(0, ship.BoostFuel-dt)
	} else {
		ship.BoostFuel = math.Min(kp.BoostFuelMax, ship.BoostFuel+kp.BoostRechargeRate*dt)
	}

	// thrust / reverse: impulse along the nose; momentum persists
	f := fwd
	f.ApplyQuaternion(ship.Quat)
	boost := 1.0
	if boosting {
		boost = kp.BoostMult
	}
	if c.Thrust != 0 {
		ship.Vel.AddScaledVector(f, c.Thrust*kp.ThrustAccel*boost*dt)
	}

	// brake: bleed speed along the facing axis, either direction
	if c.Brake {
		along := ship.Vel.Dot(f)
		cut := sign(along) * math.Min(math.Abs(along), kp.BrakeAccel*dt)
		ship.Vel.AddScaledVector(f, -cut)
	}
	// full stop
	if c.Stop {
		ship.Vel.MultiplyScalar(math.Max(0, 1-4*dt))
	}

	// ambient drag + speed cap + integrate — the cap itself lifts while
	// boosting (twin of shared/sim/flight.js#stepShip; see the comment
	// there for why releasing boost reverts it immediately)
	ship.Vel.MultiplyScalar(math.Max(0, 1-kp.Drag*dt))
	cap := kp.MaxSpeed
	if boosting {
		cap = kp.BoostMaxSpeed
	}
	if ship.Vel.Length() > cap {
		ship.Vel.SetLength(cap)
	}
	ship.Pos.AddScaledVector(ship.Vel, dt)
}

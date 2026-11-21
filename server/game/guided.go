package game

import "math"

// interceptPoint — the Go twin of shared/sim/intercept.js: where to aim a
// projectile of `speed` so it meets a target moving at constant tVel, i.e. the
// target's position after the bolt's flight time (first-order). lead 0 = aim at
// the target where it is now, 1 = full lead; maxT caps the flight time used so
// far or fleeing targets are not led absurdly.
func interceptPoint(pos Vec3, speed float64, tPos, tVel Vec3, lead, maxT float64) Vec3 {
	if !(speed > 0) || lead == 0 {
		return tPos
	}
	flight := func(a Vec3) float64 { return a.DistanceTo(pos) / speed }
	at := func(T float64) Vec3 {
		a := tPos
		a.AddScaledVector(tVel, T*lead)
		return a
	}
	T := flight(tPos)
	for k := 0; k < 3; k++ { // the flight time depends on the aim point: iterate
		T = flight(at(math.Min(T, maxT)))
	}
	return at(math.Min(T, maxT))
}

// pickGuidedTarget — the Go twin of client/aim.js. The guided-cannon bonus
// locks the live enemy nearest the player's CROSSHAIR: the smallest angle off
// `fwd` (a unit vector), and only inside a cone of coneDeg degrees. Enemies
// behind or off to the side are never chosen, however close they are. Equal
// angles (e.g. two enemies in line) go to the nearer one. nil = no lock.
func pickGuidedTarget(pos, fwd Vec3, list []*Enemy, coneDeg float64) *Enemy {
	minCos := math.Cos(coneDeg * math.Pi / 180)
	var best *Enemy
	bestCos, bestDist := math.Inf(-1), math.Inf(1)
	for _, e := range list {
		if e == nil || e.Dead {
			continue
		}
		d := e.Position
		d.Sub(pos)
		dist := d.Length()
		c := 1.0 // sitting on top of the ship: treat as dead ahead
		if dist > 0 {
			c = fwd.Dot(d) / dist
		}
		if c < minCos {
			continue
		}
		const eps = 1e-9
		if c > bestCos+eps || (math.Abs(c-bestCos) <= eps && dist < bestDist) {
			best, bestCos, bestDist = e, c, dist
		}
	}
	return best
}

package game

import "math"

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

package game

// Rock is one large solid tumbling body — deathmatch/tdm only. Unlike pods
// and bonuses (shared with co-op via World), rocks have no co-op equivalent
// and no client-side sim: DM/TDM already only predicts the local player's
// own ship, everything else renders straight from the snapshot, so rocks
// are Go-only, server-authoritative from the start (arena.go's dmRocks/
// dmRockCollisions), same simplification already used for dmBonuses.
//
// Spin is kept as accumulated per-axis Euler angle rather than an
// integrated quaternion — trivial to step, and immune to the normalization
// drift a long match would otherwise accumulate.
type Rock struct {
	Position, Velocity Vec3
	Radius             float64
	Spin               Vec3 // tumble rate per axis, rad/s
	Ax, Ay, Az         float64
}

type Rocks struct {
	List []*Rock
}

// makeRocks seeds a fixed field of rocks scattered through a sphere of
// fieldRadius around the arena origin — deliberately not anchored on
// actionCentroid (unlike dmSpawnPos): a field that chased the players around
// would never let anyone out-fly it, and "terrain scattered through the
// wider arena" is the intent, not "obstacles glued to the fight."
func makeRocks(kb Block, rng *Rng) *Rocks {
	n := int(kb["count"])
	field := kb["fieldRadius"]
	rMin, rMax := kb["radiusMin"], kb["radiusMax"]
	sMin, sMax := kb["driftSpeedMin"], kb["driftSpeedMax"]
	spinMin, spinMax := kb["spinRateMin"], kb["spinRateMax"]

	rk := &Rocks{List: make([]*Rock, 0, n)}
	for i := 0; i < n; i++ {
		var pos Vec3
		RandomDir(rng, &pos)
		pos.MultiplyScalar(field * (0.25 + 0.75*rng.Float64())) // keep a clear-ish core near the origin

		var drift Vec3
		RandomDir(rng, &drift)
		drift.MultiplyScalar(sMin + rng.Float64()*(sMax-sMin))

		rk.List = append(rk.List, &Rock{
			Position: pos,
			Velocity: drift,
			Radius:   rMin + rng.Float64()*(rMax-rMin),
			Spin: Vec3{
				X: spinMin + rng.Float64()*(spinMax-spinMin),
				Y: spinMin + rng.Float64()*(spinMax-spinMin),
				Z: spinMin + rng.Float64()*(spinMax-spinMin),
			},
		})
	}
	return rk
}

// stepRocks drifts and tumbles every rock, wrapping it back in from roughly
// the opposite side of the field once it drifts past fieldRadius — an
// evergreen hazard that a long match's drift never empties out.
func stepRocks(rk *Rocks, field, dt float64) {
	for _, r := range rk.List {
		r.Position.AddScaledVector(r.Velocity, dt)
		r.Ax += r.Spin.X * dt
		r.Ay += r.Spin.Y * dt
		r.Az += r.Spin.Z * dt
		if d := r.Position.Length(); d > field {
			// reappear from roughly the opposite side, well inside the field
			// — a plain Negate() would preserve the out-of-bounds magnitude
			// and leave it just as outside on the far side.
			r.Position.MultiplyScalar(-0.9 * field / d)
		}
	}
}

// rockAbsorbs reports (and consumes, via the caller killing the shot) whether
// pos lands inside any rock — the server twin of bonusHitByShot's shape, used
// so a bolt/missile dies on impact instead of passing through solid terrain.
func rockAbsorbs(rk *Rocks, pos Vec3) bool {
	for _, r := range rk.List {
		if pos.DistanceToSq(r.Position) < r.Radius*r.Radius {
			return true
		}
	}
	return false
}

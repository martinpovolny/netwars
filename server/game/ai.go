package game

import "math"

// Enemy AI — the Go twin of shared/sim/ai.js. Same tactical literals, same
// structure, same RNG draw order. The golden-vector test guards parity.

const enemyBoltSpeed = 950.0

var fwd = Vec3{0, 0, -1}
var up = Vec3{0, 1, 0}

// eStats: the derived per-type fields the AI reads (see ENEMY_TYPES in
// shared/constants.js — turn = turnFactor*turnK, etc.).
type eStats struct {
	Turn      float64
	FireRange float64
	Score     float64
	FireGap   [2]float64
	Behavior  string
	Target    string
	Shape     string
}

// Enemy: the non-render half of the old client Enemy (shared/sim/enemies.js
// makeEnemyState).
type Enemy struct {
	Type       string
	Stats      *eStats
	Behavior   string
	Position   Vec3
	Quaternion Quat
	Velocity   Vec3
	HP         float64
	Radius     float64
	Dead       bool
	Escaped    bool
	Thrust     float64
	Vmax       float64
	FireCd     float64
	StrafeSign int
	Repick     float64
	TargetPod  *Pod
	Loot       *Pod
	State      string
	StateT     float64
	HoldFor    float64
	Perch      Vec3
	MovePos    Vec3
	AimPos     Vec3
	HaulDir    Vec3
	HaulStart  Vec3
	Flash      float64
}

func sign(x float64) float64 {
	if x > 0 {
		return 1
	}
	if x < 0 {
		return -1
	}
	return x // 0 or -0
}

func nearestPod(pos Vec3, pods *Pods) *Pod {
	var best *Pod
	bd := math.Inf(1)
	for _, p := range pods.List {
		if p.Dead {
			continue
		}
		d := pos.DistanceToSq(p.Position)
		if d < bd {
			bd = d
			best = p
		}
	}
	return best
}

// leadPoint — writes the predicted intercept position into out, returns it.
func leadPoint(from, tpos, tvel Vec3, out *Vec3) *Vec3 {
	out.Copy(tpos).Sub(from)
	t := out.Length() / enemyBoltSpeed
	for i := 0; i < 2; i++ {
		out.Copy(tvel).MultiplyScalar(t).Add(tpos).Sub(from)
		t = out.Length() / enemyBoltSpeed
	}
	return out.Copy(tvel).MultiplyScalar(t).Add(tpos)
}

type flyOpts struct {
	turn, throttle, brake, brakeAll, drag, vmax float64
	set                                         uint8 // bitmask: which of turn/drag/vmax were given
}

const (
	optTurn = 1 << iota
	optDrag
	optVmax
)

// fly — unified Newtonian flight (shared/sim/ai.js fly). Defaults: turn =
// e.Stats.Turn, throttle = 1, brake = 0, brakeAll = 0, drag = 0.1, vmax =
// e.Vmax. `set` marks the ones the caller overrode.
func fly(e *Enemy, dt float64, aimDir Vec3, o flyOpts) {
	turn := e.Stats.Turn
	if o.set&optTurn != 0 {
		turn = o.turn
	}
	drag := 0.1
	if o.set&optDrag != 0 {
		drag = o.drag
	}
	vmax := e.Vmax
	if o.set&optVmax != 0 {
		vmax = o.vmax
	}
	throttle := o.throttle // caller always passes throttle explicitly here

	var tq Quat
	tq.SetFromUnitVectors(fwd, aimDir)
	e.Quaternion.RotateTowards(tq, turn*dt)

	f := fwd
	f.ApplyQuaternion(e.Quaternion)

	if throttle != 0 {
		e.Velocity.AddScaledVector(f, e.Thrust*throttle*dt)
	}
	if o.brake != 0 {
		along := e.Velocity.Dot(f)
		cut := sign(along) * math.Min(math.Abs(along), e.Thrust*o.brake*dt)
		e.Velocity.AddScaledVector(f, -cut)
	}
	if o.brakeAll != 0 {
		e.Velocity.MultiplyScalar(math.Max(0, 1-3.5*o.brakeAll*dt))
	}
	e.Velocity.MultiplyScalar(math.Max(0, 1-drag*dt))
	if e.Velocity.Length() > vmax {
		e.Velocity.SetLength(vmax)
	}
	e.Position.AddScaledVector(e.Velocity, dt)
}

// tryFire — shared/sim/ai.js tryFire. targetVel != nil leads the shot.
func tryFire(e *Enemy, dt float64, targetPos Vec3, w *World, aimDot float64, targetVel *Vec3) {
	e.FireCd -= dt
	if e.FireCd > 0 {
		return
	}
	d := targetPos
	d.Sub(e.Position)
	if d.Length() > e.Stats.FireRange {
		return
	}

	aimAt := targetPos
	if targetVel != nil {
		var lead Vec3
		leadPoint(e.Position, targetPos, *targetVel, &lead)
		aimAt = lead
	}
	d = aimAt
	d.Sub(e.Position)
	d.MultiplyScalar(1 / math.Max(d.Length(), 1e-3))
	if aimDot > -1 && fwdDot(e, d) < aimDot {
		return
	}

	g := e.Stats.FireGap
	e.FireCd = g[0] + w.Rng.Float64()*(g[1]-g[0])
	v := d
	v.MultiplyScalar(enemyBoltSpeed).AddScaledVector(e.Velocity, 0.4)
	muzzle := e.Position
	muzzle.AddScaledVector(d, e.Radius+4)
	w.Projectiles.Spawn(muzzle, v, teamEnemy, 3.2, nil, kindBolt)
	// fx?.enemyLaser() is client-only
}

// fwdDot: _f.dot(x) where _f is the enemy's nose after fly() ran this tick.
// fly() leaves the nose on e via the quaternion; recompute it.
func fwdDot(e *Enemy, x Vec3) float64 {
	f := fwd
	f.ApplyQuaternion(e.Quaternion)
	return f.Dot(x)
}

// ---- behaviours -------------------------------------------------------

func brawler(e *Enemy, dt float64, w *World) {
	player := w.Ship
	tgt := e.AimPos
	tgtIsPlayer := false
	if player.Alive && player.Pos.DistanceTo(e.Position) < 380 {
		tgt = player.Pos
		tgtIsPlayer = true
	}
	to := tgt
	to.Sub(e.Position)
	dist := to.Length()
	to.MultiplyScalar(1 / math.Max(dist, 1e-3))

	var side Vec3
	side.CrossVectors(to, up).Normalize().MultiplyScalar(float64(e.StrafeSign))

	var dir Vec3
	brake := 0.0
	switch {
	case dist > 340:
		dir = to
	case dist > 170:
		a := to
		a.MultiplyScalar(0.4)
		b := side
		b.MultiplyScalar(0.92)
		dir = a
		dir.Add(b).Normalize()
	default:
		nt := to
		nt.MultiplyScalar(-0.5)
		dir = side
		dir.Add(nt).Normalize()
		brake = 0.4
	}
	throttle := 0.7
	if dist > 340 {
		throttle = 1
	}
	fly(e, dt, dir, flyOpts{throttle: throttle, brake: brake})

	var tvel *Vec3
	if tgtIsPlayer {
		v := player.Vel
		tvel = &v
	}
	tryFire(e, dt, tgt, w, 0.985, tvel)
}

func strafer(e *Enemy, dt float64, w *World) {
	if e.State != "run" && e.State != "break" {
		e.State = "run"
		e.StateT = 0
	}
	to := e.AimPos
	to.Sub(e.Position)
	dist := to.Length()
	to.MultiplyScalar(1 / math.Max(dist, 1e-3))

	if e.State == "run" {
		fly(e, dt, to, flyOpts{throttle: 1, turn: e.Stats.Turn * 0.85, vmax: e.Vmax * 1.15, set: optTurn | optVmax})
		tryFire(e, dt, e.AimPos, w, 0.95, nil)
		if dist < 240 || e.StateT > 5 {
			e.State = "break"
			e.StateT = 0
			var off Vec3
			RandomDir(w.Rng, &off)
			off.Y = off.Y*0.5 + 0.2
			off.Normalize()
			e.MovePos = e.AimPos
			e.MovePos.AddScaledVector(off, 700+w.Rng.Float64()*400)
		}
	} else {
		bd := e.MovePos
		bd.Sub(e.Position)
		bdist := bd.Length()
		bd.MultiplyScalar(1 / math.Max(bdist, 1e-3))
		fly(e, dt, bd, flyOpts{throttle: 1, vmax: e.Vmax * 1.25, set: optVmax})
		if bdist < 180 || e.StateT > 4 {
			e.State = "run"
			e.StateT = 0
		}
	}
	e.StateT += dt
}

func pickPerch(e *Enemy, playerPos Vec3, rng *Rng) {
	var off Vec3
	RandomDir(rng, &off)
	off.Y = off.Y*0.5 + 0.25
	off.Normalize()
	e.Perch = playerPos
	e.Perch.AddScaledVector(off, 1000+rng.Float64()*500)
}

func sniper(e *Enemy, dt float64, w *World) {
	player := w.Ship
	if e.State != "relocate" && e.State != "hold" {
		e.State = "relocate"
		pickPerch(e, player.Pos, w.Rng)
	}
	toPlayer := player.Pos.DistanceTo(e.Position)

	if e.State == "relocate" {
		d := e.Perch
		d.Sub(e.Position)
		dd := d.Length()
		d.MultiplyScalar(1 / math.Max(dd, 1e-3))
		closing := dd < 280
		facePlayer := player.Pos
		facePlayer.Sub(e.Position).Normalize()

		aim := d
		throttle := 1.0
		brakeAll := 0.0
		if closing {
			aim = facePlayer
			throttle = 0
			brakeAll = 1
		}
		fly(e, dt, aim, flyOpts{throttle: throttle, brakeAll: brakeAll, turn: e.Stats.Turn * 1.3, vmax: e.Vmax * 1.25, set: optTurn | optVmax})
		if dd < 130 && e.Velocity.Length() < 55 {
			e.State = "hold"
			e.StateT = 0
			e.HoldFor = 3.5 + w.Rng.Float64()*2.5
		}
	} else {
		var lead Vec3
		leadPoint(e.Position, player.Pos, player.Vel, &lead)
		d := lead
		d.Sub(e.Position).Normalize()
		fly(e, dt, d, flyOpts{throttle: 0, brakeAll: 1.2, turn: e.Stats.Turn * 1.6, set: optTurn})
		pv := player.Vel
		tryFire(e, dt, player.Pos, w, 0.985, &pv)
		e.StateT += dt
		if e.StateT > e.HoldFor || toPlayer < 480 {
			e.State = "relocate"
			pickPerch(e, player.Pos, w.Rng)
		}
	}
}

func charger(e *Enemy, dt float64, w *World) {
	player := w.Ship
	var lead Vec3
	leadPoint(e.Position, player.Pos, player.Vel, &lead)
	to := lead
	to.Sub(e.Position).Normalize()
	fly(e, dt, to, flyOpts{throttle: 1, drag: 0.06, vmax: e.Vmax * 1.1, turn: e.Stats.Turn * 1.3, set: optDrag | optVmax | optTurn})
	pv := player.Vel
	tryFire(e, dt, player.Pos, w, 0.94, &pv)
}

func thief(e *Enemy, dt float64, w *World) {
	player := w.Ship
	pods := w.Pods
	if e.Loot == nil || e.Loot.Dead || (e.Loot.Captor != nil && e.Loot.Captor != e) {
		if e.State == "haul" {
			e.State = "approach"
		}
		e.Loot = nearestPod(e.Position, pods)
		if e.Loot == nil {
			brawler(e, dt, w)
			return
		}
	}
	to := e.Loot.Position
	to.Sub(e.Position)
	dist := to.Length()
	to.MultiplyScalar(1 / math.Max(dist, 1e-3))

	if e.State != "haul" {
		closing := dist < 240
		throttle := 1.0
		brakeAll := 0.0
		if closing {
			throttle = 0.15
			brakeAll = 0.8
		}
		fly(e, dt, to, flyOpts{throttle: throttle, brakeAll: brakeAll})
		var pv *Vec3
		if player.Alive {
			v := player.Vel
			pv = &v
		}
		tryFire(e, dt, player.Pos, w, 0.99, pv)
		if dist < e.Radius+e.Loot.Radius+10 && e.Velocity.Length() < 80 {
			e.State = "haul"
			e.Loot.Captor = e
			e.HaulDir = e.Loot.Position
			e.HaulDir.Sub(pods.Centroid)
			if e.HaulDir.LengthSq() < 1 {
				e.HaulDir = to
				e.HaulDir.Negate()
			}
			e.HaulDir.Normalize()
			e.HaulStart = e.Loot.Position
		}
	} else {
		fly(e, dt, e.HaulDir, flyOpts{throttle: 1, turn: e.Stats.Turn * 0.6, vmax: 95, set: optTurn | optVmax})
		f := fwd
		f.ApplyQuaternion(e.Quaternion)
		e.Loot.Position = e.Position
		e.Loot.Position.AddScaledVector(f, e.Radius+e.Loot.Radius)
		e.Loot.Velocity = Vec3{}
		if e.Loot.Position.DistanceTo(e.HaulStart) > 2600 {
			e.Loot.Dead = true
			e.Loot.Captor = nil
			e.Dead = true
			e.Escaped = true
		}
	}
}

// stepEnemy — one AI tick for one enemy (shared/sim/ai.js stepEnemy).
func stepEnemy(e *Enemy, w *World, dt float64) {
	e.Repick -= dt

	if e.Stats.Target == "player" {
		e.AimPos = w.Ship.Pos
	} else if e.Behavior != "thief" {
		if e.Repick <= 0 || e.TargetPod == nil || e.TargetPod.Dead {
			e.TargetPod = nearestPod(e.Position, w.Pods)
			e.Repick = 2 + w.Rng.Float64()*2
		}
		if e.TargetPod != nil {
			e.AimPos = e.TargetPod.Position
		} else {
			e.AimPos = w.Ship.Pos
		}
	}

	switch e.Behavior {
	case "strafer":
		strafer(e, dt, w)
	case "sniper":
		sniper(e, dt, w)
	case "charger":
		charger(e, dt, w)
	case "thief":
		thief(e, dt, w)
	default:
		brawler(e, dt, w)
	}
}

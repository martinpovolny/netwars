package game

import (
	"math"
	"testing"
)

const goldenPath = "testdata/golden.json"

// The committed golden vector loads and is internally consistent.
func TestGoldenLoads(t *testing.T) {
	g, err := LoadGolden(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	if g.Seed != "golden" {
		t.Fatalf("seed = %q, want %q", g.Seed, "golden")
	}
	if g.Ticks != 600 || len(g.Frames) != 600 {
		t.Fatalf("ticks=%d frames=%d, want 600/600", g.Ticks, len(g.Frames))
	}
	if g.Frames[0].T != 0 || g.Frames[599].T != 599 {
		t.Fatalf("frame t range = [%d..%d], want [0..599]", g.Frames[0].T, g.Frames[599].T)
	}
	last := g.Frames[599]
	t.Logf("golden ok: final level=%d score=%d fsm=%s enemies=%d pods=%d proj=%d",
		last.Level, last.Score, last.FSM.State, len(last.Enemies), len(last.Pods), len(last.Proj))
}

// ---- parity: Go StepWorld must reproduce every golden frame within tol -----

const parityTol = 1e-4

// driveShip mirrors tools/golden.html#driveShip (deterministic Lissajous).
func driveShip(s *Ship, t int, dt float64) {
	sec := float64(t) * dt
	s.Pos.Set(700*math.Sin(sec*0.31), 220*math.Sin(sec*0.53+1), 640*math.Cos(sec*0.24))
	s.Vel.Set(700*0.31*math.Cos(sec*0.31), 220*0.53*math.Cos(sec*0.53+1), -640*0.24*math.Sin(sec*0.24))
	spd := s.Vel.Length()
	if spd > 1e-3 {
		dir := s.Vel
		dir.MultiplyScalar(1 / spd)
		s.Quat.SetFromUnitVectors(Vec3{0, 0, -1}, dir)
	}
}

// fireCannon mirrors tools/golden.html#fireCannon.
func fireCannon(w *World, t int) {
	if t%9 != 0 {
		return
	}
	var best *Enemy
	bd := math.Inf(1)
	for _, e := range w.Fleet.List {
		if e.Dead {
			continue
		}
		d := e.Position.DistanceToSq(w.Ship.Pos)
		if d < bd {
			bd = d
			best = e
		}
	}
	if best == nil {
		return
	}
	dir := best.Position
	dir.Sub(w.Ship.Pos).Normalize()
	vel := w.Ship.Vel
	vel.AddScaledVector(dir, w.K.Player.CannonMuzzle)
	muzzle := w.Ship.Pos
	muzzle.AddScaledVector(dir, 12)
	w.Projectiles.Spawn(muzzle, vel, teamPlayer, w.K.Player.BoltTtl, nil, kindBolt)
}

func near(a, b float64) bool { return math.Abs(a-b) <= parityTol }
func nearV(v Vec3, j jVec3) bool {
	return near(v.X, j[0]) && near(v.Y, j[1]) && near(v.Z, j[2])
}
func nearQ(q Quat, j jQuat) bool {
	return near(q.X, j[0]) && near(q.Y, j[1]) && near(q.Z, j[2]) && near(q.W, j[3])
}

func TestGoldenParity(t *testing.T) {
	g, err := LoadGolden(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}

	w := NewWorld(k, g.Seed)
	w.StartWorldLevel(g.StartLevel, int(k.Pods["perLevel"]))

	for i := 0; i < g.Ticks; i++ {
		driveShip(w.Ship, i, g.DT)
		fireCannon(w, i)
		for _, ev := range w.StepWorld(g.DT) {
			if ev.Kind == "level" && ev.Action.StartLevel != 0 {
				w.StartWorldLevel(ev.Action.StartLevel, int(k.Pods["perLevel"]))
			}
		}

		f := g.Frames[i]
		fail := func(format string, args ...any) {
			t.Fatalf("tick %d: "+format, append([]any{i}, args...)...)
		}

		if w.Score != f.Score {
			fail("score got %d want %d", w.Score, f.Score)
		}
		if w.Fleet.Level != f.Level {
			fail("level got %d want %d", w.Fleet.Level, f.Level)
		}
		if w.FSM.State != f.FSM.State {
			fail("fsm state got %q want %q", w.FSM.State, f.FSM.State)
		}
		if !near(w.FSM.Timer, f.FSM.Timer) {
			fail("fsm timer got %v want %v", w.FSM.Timer, f.FSM.Timer)
		}

		if !nearV(w.Ship.Pos, f.Ship.Pos) {
			fail("ship pos got %+v want %v", w.Ship.Pos, f.Ship.Pos)
		}
		if !nearV(w.Ship.Vel, f.Ship.Vel) {
			fail("ship vel got %+v want %v", w.Ship.Vel, f.Ship.Vel)
		}
		if !nearQ(w.Ship.Quat, f.Ship.Quat) {
			fail("ship quat got %+v want %v", w.Ship.Quat, f.Ship.Quat)
		}
		if !near(w.Ship.Hull, f.Ship.Hull) {
			fail("ship hull got %v want %v", w.Ship.Hull, f.Ship.Hull)
		}
		if w.Ship.Missiles != f.Ship.Missiles {
			fail("ship missiles got %d want %d", w.Ship.Missiles, f.Ship.Missiles)
		}
		if w.Ship.Alive != f.Ship.Alive {
			fail("ship alive got %v want %v", w.Ship.Alive, f.Ship.Alive)
		}

		if len(w.Fleet.List) != len(f.Enemies) {
			fail("enemy count got %d want %d", len(w.Fleet.List), len(f.Enemies))
		}
		for j, e := range w.Fleet.List {
			ge := f.Enemies[j]
			if e.Type != ge.Type {
				fail("enemy %d type got %q want %q", j, e.Type, ge.Type)
			}
			if !nearV(e.Position, ge.Pos) {
				fail("enemy %d (%s/%s) pos got %+v want %v", j, e.Type, e.State, e.Position, ge.Pos)
			}
			if !nearV(e.Velocity, ge.Vel) {
				fail("enemy %d (%s) vel got %+v want %v", j, e.Type, e.Velocity, ge.Vel)
			}
			if !nearQ(e.Quaternion, ge.Quat) {
				fail("enemy %d (%s) quat got %+v want %v", j, e.Type, e.Quaternion, ge.Quat)
			}
			if !near(e.HP, ge.HP) {
				fail("enemy %d hp got %v want %v", j, e.HP, ge.HP)
			}
			if e.State != ge.State {
				fail("enemy %d state got %q want %q", j, e.State, ge.State)
			}
			if !near(e.FireCd, ge.FireCd) {
				fail("enemy %d fireCd got %v want %v", j, e.FireCd, ge.FireCd)
			}
			if e.StrafeSign != ge.StrafeSign {
				fail("enemy %d strafeSign got %d want %d", j, e.StrafeSign, ge.StrafeSign)
			}
		}

		if len(w.Pods.List) != len(f.Pods) {
			fail("pod count got %d want %d", len(w.Pods.List), len(f.Pods))
		}
		for j, p := range w.Pods.List {
			gp := f.Pods[j]
			if !nearV(p.Position, gp.Pos) {
				fail("pod %d pos got %+v want %v", j, p.Position, gp.Pos)
			}
			if !near(p.HP, gp.HP) {
				fail("pod %d hp got %v want %v", j, p.HP, gp.HP)
			}
			if p.Dead != gp.Dead {
				fail("pod %d dead got %v want %v", j, p.Dead, gp.Dead)
			}
			if (p.Captor != nil) != gp.Captor {
				fail("pod %d captor got %v want %v", j, p.Captor != nil, gp.Captor)
			}
		}

		if len(w.Bonuses.List) != len(f.Bonuses) {
			fail("bonus count got %d want %d", len(w.Bonuses.List), len(f.Bonuses))
		}
		for j, b := range w.Bonuses.List {
			gb := f.Bonuses[j]
			if b.Kind != gb.Kind {
				fail("bonus %d kind got %q want %q", j, b.Kind, gb.Kind)
			}
			if !nearV(b.Position, gb.Pos) {
				fail("bonus %d pos got %+v want %v", j, b.Position, gb.Pos)
			}
			if !near(b.Life, gb.Life) {
				fail("bonus %d life got %v want %v", j, b.Life, gb.Life)
			}
		}

		// projectiles: compare the live ones the golden captured, by pool index
		for _, gp := range f.Proj {
			pi := gp.I
			if w.Projectiles.Ttl[pi] <= 0 {
				fail("proj[%d] gone in Go (want ttl %v, team %s)", pi, gp.Ttl, gp.Team)
			}
			if !nearV(w.Projectiles.Pos[pi], gp.Pos) {
				fail("proj[%d] pos got %+v want %v", pi, w.Projectiles.Pos[pi], gp.Pos)
			}
			if !nearV(w.Projectiles.Vel[pi], gp.Vel) {
				fail("proj[%d] vel got %+v want %v", pi, w.Projectiles.Vel[pi], gp.Vel)
			}
			if !near(w.Projectiles.Ttl[pi], gp.Ttl) {
				fail("proj[%d] ttl got %v want %v", pi, w.Projectiles.Ttl[pi], gp.Ttl)
			}
			if w.Projectiles.Team[pi] != gp.Team {
				fail("proj[%d] team got %q want %q", pi, w.Projectiles.Team[pi], gp.Team)
			}
		}
	}
	t.Logf("parity ok: %d ticks, final level=%d score=%d", g.Ticks, w.Fleet.Level, w.Score)
}

package game

import (
	"math"
	"testing"
)

// Guided bolts steer at where the target WILL be (first-order intercept), not
// where it is now. Go twin of shared/sim/intercept.js — same cases.

func TestGuidedLeadConstants(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	if got := k.Weapons["guidedLead"]; got != 1 {
		t.Errorf("weapons.guidedLead = %v, want 1", got)
	}
	if got := k.Weapons["guidedLeadMaxT"]; got != 1.5 {
		t.Errorf("weapons.guidedLeadMaxT = %v, want 1.5", got)
	}
	// leading must not make bolts turn as hard as missiles: the turn rate stays weaker
	if !(k.Weapons["guidedBoltGuideRate"] > k.Weapons["missileGuideRate"]) {
		t.Errorf("guided bolts must still turn more slowly than missiles")
	}
}

func TestInterceptPoint(t *testing.T) {
	const speed = 1500.0
	eq := func(a, b Vec3) bool {
		return math.Abs(a.X-b.X) < 1e-6 && math.Abs(a.Y-b.Y) < 1e-6 && math.Abs(a.Z-b.Z) < 1e-6
	}

	// stationary: aim straight at it
	if got := interceptPoint(Vec3{}, speed, Vec3{X: 100, Y: 20, Z: -900}, Vec3{}, 1, 1.5); !eq(got, Vec3{X: 100, Y: 20, Z: -900}) {
		t.Errorf("stationary: got %+v", got)
	}

	// crossing: the aim point is the target's position after the bolt's flight time to it
	tpos, tvel := Vec3{Z: -900}, Vec3{X: 300}
	aim := interceptPoint(Vec3{}, speed, tpos, tvel, 1, 1.5)
	T := aim.Length() / speed
	if !(aim.X > 0) || math.Abs(aim.X-(tpos.X+tvel.X*T)) > 1 {
		t.Errorf("crossing: aim %+v, flight time %v — not target position after flight", aim, T)
	}

	// lead scales the offset
	none := interceptPoint(Vec3{}, speed, tpos, tvel, 0, 1.5)
	half := interceptPoint(Vec3{}, speed, tpos, tvel, 0.5, 1.5)
	if !eq(none, tpos) || !(half.X > 0 && half.X < aim.X) {
		t.Errorf("lead scaling: none %+v half %+v full %+v", none, half, aim)
	}

	// capped flight time
	far := interceptPoint(Vec3{}, speed, Vec3{Z: -90000}, Vec3{X: 300}, 1, 1.5)
	if math.Abs(far.X-450) > 1e-6 {
		t.Errorf("cap: x = %v, want 450", far.X)
	}
	// fleeing faster than the bolt: finite, capped
	flee := interceptPoint(Vec3{}, speed, Vec3{Z: -500}, Vec3{Z: -3000}, 1, 1.5)
	if math.IsNaN(flee.Z) || math.Abs(flee.Z-(-5000)) > 1e-6 {
		t.Errorf("fleeing: z = %v, want -5000", flee.Z)
	}
	// degenerate: zero speed, and an enemy on top of the shooter
	if got := interceptPoint(Vec3{}, 0, Vec3{Z: -500}, Vec3{X: 100}, 1, 1.5); !eq(got, Vec3{Z: -500}) {
		t.Errorf("zero speed: got %+v", got)
	}
	if got := interceptPoint(Vec3{}, speed, Vec3{}, Vec3{X: 100}, 1, 1.5); math.IsNaN(got.X) || math.IsNaN(got.Z) {
		t.Errorf("enemy on top: NaN %+v", got)
	}
}

// End to end through the real projectile step: a guided bolt fired straight
// ahead at a target crossing at 300 u/s, 600 units out, hits it with lead on
// and misses with lead off (guidedLead = 0). Without this, "fire at it and let
// the bolt sort it out" fails on every crossing shot.
func TestGuidedBoltHitsCrossingTargetOnlyWithLead(t *testing.T) {
	fly := func(lead float64) bool {
		k, err := LoadConstants()
		if err != nil {
			t.Fatal(err)
		}
		k.Weapons["guidedLead"] = lead
		w := NewWorld(k, "guided-lead-seed")
		tgt := &Enemy{ID: 1, Position: Vec3{Z: -600}, Velocity: Vec3{X: 300}, HP: 100, Radius: 30}
		w.Fleet.List = []*Enemy{tgt}
		w.Ships = []*Ship{w.Ship}
		w.Projectiles.Spawn(Vec3{}, Vec3{Z: -1500}, teamPlayer, k.Player.BoltTtl, tgt, kindBolt, "p1")
		const dt = 1.0 / 60.0
		for i := 0; i < 120; i++ {
			w.Projectiles.Step(dt, w)
			tgt.Position.AddScaledVector(tgt.Velocity, dt)
			if tgt.HP < 100 {
				return true
			}
		}
		return false
	}
	if fly(0) {
		t.Fatal("test setup is wrong: without lead the bolt should miss this crossing target")
	}
	if !fly(1) {
		t.Fatal("with lead the bolt should hit the crossing target")
	}
}

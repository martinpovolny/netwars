package game

import "testing"

// The guided cannon homes on the enemy nearest the player's CROSSHAIR — the
// smallest angle off the nose, inside a cone — not nearest to the ship.

// Tuning: the cone is wide enough to lock a shot aimed roughly at the enemy,
// and homing is moderate — clearly weaker than a missile (rate 0.01; a larger
// rate means weaker homing) so the bolt still needs sensible aim, but strong
// enough to bend onto a target a few degrees off the nose.
func TestGuidedTuningConstants(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	if got := k.Bonuses["guidedConeDeg"]; got != 45 {
		t.Errorf("bonuses.guidedConeDeg = %v, want 45", got)
	}
	if got := k.Weapons["guidedBoltGuideRate"]; got != 0.05 {
		t.Errorf("weapons.guidedBoltGuideRate = %v, want 0.05", got)
	}
	if !(k.Weapons["guidedBoltGuideRate"] > k.Weapons["missileGuideRate"]) {
		t.Errorf("guided bolts must stay gentler than missiles: bolt %v vs missile %v",
			k.Weapons["guidedBoltGuideRate"], k.Weapons["missileGuideRate"])
	}
}

// A locked bolt fired at a stationary enemy ~8 degrees off the nose, 1000 units
// out, must reach it within its lifetime; the same shot unguided passes by.
func TestGuidedBoltReachesNearlyAimedTarget(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	fly := func(guided bool) bool {
		w := NewWorld(k, "guided-reach-seed")
		tgt := &Enemy{ID: 1, Position: Vec3{X: 140.5, Z: -990}, HP: 100, Radius: 30}
		w.Fleet.List = []*Enemy{tgt}
		w.Ships = []*Ship{w.Ship}
		var target guideTarget
		if guided {
			target = tgt
		}
		w.Projectiles.Spawn(Vec3{}, Vec3{Z: -1500}, teamPlayer, k.Player.BoltTtl, target, kindBolt, "p1")
		for i := 0; i < 200; i++ {
			w.Projectiles.Step(1.0/60.0, w)
			if tgt.HP < 100 {
				return true
			}
		}
		return false
	}
	if fly(false) {
		t.Fatal("test setup is wrong: an unguided bolt should miss a target 8 degrees off")
	}
	if !fly(true) {
		t.Fatal("a guided bolt should bend onto a target 8 degrees off the nose within its lifetime")
	}
}

func TestPickGuidedTarget(t *testing.T) {
	fwdZ := Vec3{Z: -1} // identity ship looks down -Z
	at := func(x, y, z float64) *Enemy { return &Enemy{Position: Vec3{X: x, Y: y, Z: z}, HP: 10} }

	ahead := at(0, 0, -900)       // dead on the nose, far
	offAxis := at(150, 0, -300)   // ~26.6 deg off, much closer — still inside 30 deg
	outside := at(400, 0, -300)   // ~53 deg off
	behind := at(0, 0, 100)       // behind the ship
	dead := at(0, 0, -100)
	dead.Dead = true

	cases := []struct {
		name string
		list []*Enemy
		want *Enemy
	}{
		{"empty fleet", nil, nil},
		{"closest to the crosshair beats closest to the ship", []*Enemy{offAxis, ahead}, ahead},
		{"outside the cone is ignored", []*Enemy{outside}, nil},
		{"behind the ship is ignored", []*Enemy{behind}, nil},
		{"dead enemies are ignored", []*Enemy{dead}, nil},
		{"dead ahead is skipped, next one in the cone is taken", []*Enemy{dead, offAxis, outside, behind}, offAxis},
		{"equal angle: the nearer one wins", []*Enemy{at(0, 0, -900), at(0, 0, -300)}, nil /* set below */},
	}
	// the tie case needs identity of the nearer enemy
	cases[len(cases)-1].want = cases[len(cases)-1].list[1]

	for _, c := range cases {
		if got := pickGuidedTarget(Vec3{}, fwdZ, c.list, 30); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestPickGuidedTargetRespectsCone(t *testing.T) {
	e := &Enemy{Position: Vec3{X: 150, Z: -300}, HP: 10} // ~26.6 deg off the nose
	if pickGuidedTarget(Vec3{}, Vec3{Z: -1}, []*Enemy{e}, 20) != nil {
		t.Fatal("a 20-degree cone must not catch an enemy 26.6 degrees off")
	}
	if pickGuidedTarget(Vec3{}, Vec3{Z: -1}, []*Enemy{e}, 30) != e {
		t.Fatal("a 30-degree cone must catch an enemy 26.6 degrees off")
	}
}

// Firing with an enemy inside the cone locks it onto both bolts and spends one
// round; the nearer-but-off-aim enemy is NOT chosen.
func TestFireWeaponsGuidedCannonLocksCrosshairEnemy(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-guided-aim", "coop", "guided-aim-seed", 0, 0)
	p := joinBare(a)
	p.Ship.GuidedShots = 5
	p.wantGun = true
	p.gunCd = 0

	aimed := &Enemy{ID: 1, Position: Vec3{Z: -900}, HP: 10}
	closer := &Enemy{ID: 2, Position: Vec3{X: 150, Z: -300}, HP: 10}
	a.world.Fleet.List = []*Enemy{closer, aimed}

	before := a.world.Projectiles.Cursor
	a.fireWeapons(p)
	after := a.world.Projectiles.Cursor
	for i := before; i != after; i = (i + 1) % a.world.Projectiles.Max {
		if tgt, ok := a.world.Projectiles.Target[i].(*Enemy); !ok || tgt != aimed {
			t.Fatalf("bolt[%d] target = %+v, want the enemy on the crosshair", i, a.world.Projectiles.Target[i])
		}
	}
	if p.Ship.GuidedShots != 4 {
		t.Fatalf("GuidedShots = %d, want 4", p.Ship.GuidedShots)
	}
}

// Nothing inside the cone: the shot still fires (ballistic) but the round is
// NOT spent.
func TestFireWeaponsGuidedCannonNoTargetKeepsRound(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	for name, fleet := range map[string][]*Enemy{
		"empty fleet":          nil,
		"enemy outside cone":   {{ID: 1, Position: Vec3{X: 400, Z: -300}, HP: 10}},
		"enemy behind the nose": {{ID: 2, Position: Vec3{Z: 500}, HP: 10}},
	} {
		a := newArena(k, "unit-guided-notarget", "coop", "guided-notarget-seed", 0, 0)
		p := joinBare(a)
		p.Ship.GuidedShots = 5
		p.wantGun = true
		p.gunCd = 0
		a.world.Fleet.List = fleet

		before := a.world.Projectiles.Cursor
		a.fireWeapons(p)
		after := a.world.Projectiles.Cursor
		if (after-before+a.world.Projectiles.Max)%a.world.Projectiles.Max != 2 {
			t.Fatalf("%s: expected 2 bolts to still fire", name)
		}
		for i := before; i != after; i = (i + 1) % a.world.Projectiles.Max {
			if a.world.Projectiles.Target[i] != nil {
				t.Fatalf("%s: bolt[%d] should be ballistic, got target %+v", name, i, a.world.Projectiles.Target[i])
			}
		}
		if p.Ship.GuidedShots != 5 {
			t.Fatalf("%s: GuidedShots = %d, want 5 (no lock, no round spent)", name, p.Ship.GuidedShots)
		}
	}
}

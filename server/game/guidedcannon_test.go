package game

import "testing"

// Old NetWars had a bonus that made the cannon's shots gently home in on a
// target — weaker and shorter-lived than a missile lock, and SP/co-op only,
// never deathmatch. These tests cover: the bonus kind is gated by
// allowGuided, applying it sets GuidedShots, firing while it's active locks
// the nearest enemy and spends a round even with nothing to lock onto, and a
// locked bolt actually curves toward its target over its (short) lifetime.

// spawnBonus must only ever produce "guided" when allowGuided is true — DM's
// dmBonuses always passes false (see arena.go), so even with guidedChance
// cranked to certainty, the deathmatch path must never see it.
func TestSpawnBonusGuidedGatedByAllowGuided(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	kb := Block{}
	for key, v := range k.Bonuses {
		kb[key] = v
	}
	kb["guidedChance"] = 1.0 // would always pick "guided" if allowed at all

	ship := newShip(k)
	rng := NewRng("guided-gate-seed")

	b := &Bonuses{}
	spawnBonus(b, Vec3{}, ship, kb, rng, true)
	if b.List[0].Kind != "guided" {
		t.Fatalf("allowGuided=true, guidedChance=1: kind = %q, want %q", b.List[0].Kind, "guided")
	}

	b2 := &Bonuses{}
	spawnBonus(b2, Vec3{}, ship, kb, rng, false)
	if b2.List[0].Kind == "guided" {
		t.Fatalf("allowGuided=false must never produce a guided bonus, even with guidedChance=1: got %q", b2.List[0].Kind)
	}
}

// This is the user-facing guarantee end to end: a real deathmatch arena,
// cycled through dmBonuses() many times with guidedChance forced to 1, must
// never once spawn a "guided" bonus.
func TestDMNeverSpawnsGuidedBonus(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	k.Bonuses["guidedChance"] = 1.0
	k.Bonuses["respawnMin"] = 0
	k.Bonuses["respawnRange"] = 0
	k.Bonuses["firstDelayMin"] = 0
	k.Bonuses["firstDelayRange"] = 0

	a := newArena(k, "unit-dm-no-guided", "dm", "dm-no-guided-seed", 0, 0)
	joinBare(a)
	joinBare(a)

	for i := 0; i < 2000; i++ {
		a.dmBonuses()
		for _, bo := range a.world.Bonuses.List {
			if bo.Kind == "guided" {
				t.Fatalf("deathmatch spawned a guided bonus at iteration %d: %+v", i, bo)
			}
		}
	}
}

// applyBonus("guided", ...) sets GuidedShots to the constants amount, not an
// additive top-up like repair/missiles — a fresh grant of rounds.
func TestApplyBonusGuidedSetsShots(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	s := newShip(k)
	s.GuidedShots = 3
	applyBonus(s, "guided", k)
	want := int(k.Bonuses["guidedRounds"])
	if s.GuidedShots != want {
		t.Fatalf("GuidedShots = %d, want %d", s.GuidedShots, want)
	}
}

// Firing the cannon while GuidedShots > 0 locks the nearest live enemy onto
// BOTH bolts of that shot (not just one) and spends exactly one round per
// shot — not per bolt, even though the gun fires two bolts at once.
func TestFireWeaponsGuidedCannonLocksNearestEnemy(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-guided-fire", "coop", "guided-fire-seed", 0, 0)
	p := joinBare(a)
	p.Ship.GuidedShots = 5
	p.wantGun = true
	p.gunCd = 0

	near := &Enemy{ID: 1, Position: Vec3{Z: -300}, HP: 10}
	far := &Enemy{ID: 2, Position: Vec3{Z: -900}, HP: 10}
	a.world.Fleet.List = []*Enemy{far, near}

	before := a.world.Projectiles.Cursor
	a.fireWeapons(p)
	after := a.world.Projectiles.Cursor

	if (after-before+a.world.Projectiles.Max)%a.world.Projectiles.Max != 2 {
		t.Fatalf("expected exactly 2 bolts spawned, cursor moved from %d to %d", before, after)
	}
	for i := before; i != after; i = (i + 1) % a.world.Projectiles.Max {
		tgt, ok := a.world.Projectiles.Target[i].(*Enemy)
		if !ok || tgt != near {
			t.Fatalf("bolt[%d] target = %+v, want the nearer enemy %+v", i, a.world.Projectiles.Target[i], near)
		}
	}
	if p.Ship.GuidedShots != 4 {
		t.Fatalf("GuidedShots = %d, want 4 (spent exactly 1 for this shot, not 2)", p.Ship.GuidedShots)
	}
}

// With GuidedShots active but nothing alive to lock onto, the shot still
// fires (ballistic, target nil) and still spends a round — "the next 50
// rounds behave like that" isn't refunded just because nothing was in range.
func TestFireWeaponsGuidedCannonNoTargetStillSpendsRound(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-guided-fire-notarget", "coop", "guided-fire-notarget-seed", 0, 0)
	p := joinBare(a)
	p.Ship.GuidedShots = 5
	p.wantGun = true
	p.gunCd = 0
	// a.world.Fleet.List is empty: nothing to lock onto

	before := a.world.Projectiles.Cursor
	a.fireWeapons(p)
	after := a.world.Projectiles.Cursor
	if (after-before+a.world.Projectiles.Max)%a.world.Projectiles.Max != 2 {
		t.Fatalf("expected 2 bolts spawned even with no target, cursor moved from %d to %d", before, after)
	}
	for i := before; i != after; i = (i + 1) % a.world.Projectiles.Max {
		if a.world.Projectiles.Target[i] != nil {
			t.Fatalf("bolt[%d] should be ballistic (nil target) with no enemy alive: %+v", i, a.world.Projectiles.Target[i])
		}
	}
	if p.Ship.GuidedShots != 4 {
		t.Fatalf("GuidedShots = %d, want 4 (still spent, even with nothing to lock)", p.Ship.GuidedShots)
	}
}

// A locked guided bolt actually curves toward its target over its lifetime —
// not just a flag that does nothing.
func TestGuidedBoltCurvesTowardTarget(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "guided-curve-seed")
	target := &Enemy{ID: 1, Position: Vec3{X: 600, Z: -400}, HP: 10}
	w.Fleet.List = []*Enemy{target}
	w.Ships = []*Ship{w.Ship}

	// fired straight down -Z; the target sits off to the +X side, so a
	// working guide should visibly bend the bolt's velocity toward +X.
	w.Projectiles.Spawn(Vec3{}, Vec3{Z: -1500}, teamPlayer, 2.0, target, kindBolt, "p1")
	idx := (w.Projectiles.Cursor - 1 + w.Projectiles.Max) % w.Projectiles.Max

	startVX := w.Projectiles.Vel[idx].X
	for i := 0; i < 60; i++ { // ~1s at 60Hz — comfortably inside boltTtl
		w.Projectiles.Step(1.0/60.0, w)
	}
	endVX := w.Projectiles.Vel[idx].X

	if !(endVX > startVX+1) {
		t.Fatalf("guided bolt didn't curve toward the target: vx %v -> %v", startVX, endVX)
	}
}

// The guided bonus must be gentler than a missile lock — same target, same
// flight time, the bolt's guide should bend its velocity noticeably less
// than a missile's would.
func TestGuidedBoltGentlerThanMissile(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	target := &Enemy{ID: 1, Position: Vec3{X: 600, Z: -400}, HP: 10}

	run := func(kind string) float64 {
		w := NewWorld(k, "guided-vs-missile-seed")
		w.Fleet.List = []*Enemy{target}
		w.Ships = []*Ship{w.Ship}
		ttl := k.Player.BoltTtl
		if kind == kindMsl {
			ttl = k.Player.MissileLife
		}
		w.Projectiles.Spawn(Vec3{}, Vec3{Z: -1500}, teamPlayer, ttl, target, kind, "p1")
		idx := (w.Projectiles.Cursor - 1 + w.Projectiles.Max) % w.Projectiles.Max
		for i := 0; i < 36; i++ { // 0.6s — well inside both a bolt's and a missile's life
			w.Projectiles.Step(1.0/60.0, w)
		}
		return w.Projectiles.Vel[idx].X
	}

	boltVX := run(kindBolt)
	mslVX := run(kindMsl)
	if !(mslVX > boltVX) {
		t.Fatalf("guided bolt should bend less than a locked missile over the same time: bolt vx=%v missile vx=%v", boltVX, mslVX)
	}
}

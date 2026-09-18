package game

import "testing"

// Rocks are deathmatch/tdm-only terrain — co-op/SP arenas must never pay for
// or render a field they can't reach (co-op's own bonus/pod machinery has no
// concept of them), while every dm/tdm arena gets a real, non-empty field.
func TestArenaSeedsRocksOnlyForDM(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	dm := newArena(k, "unit-rocks-dm", "dm", "rocks-dm-seed", 0, 0)
	if dm.world.Rocks == nil || len(dm.world.Rocks.List) != int(k.Rocks["count"]) {
		t.Fatalf("dm arena: Rocks = %+v, want %v rocks", dm.world.Rocks, k.Rocks["count"])
	}
	tdm := newArena(k, "unit-rocks-tdm", "tdm", "rocks-tdm-seed", 0, 0)
	if tdm.world.Rocks == nil || len(tdm.world.Rocks.List) != int(k.Rocks["count"]) {
		t.Fatalf("tdm arena: Rocks = %+v, want %v rocks", tdm.world.Rocks, k.Rocks["count"])
	}
	coop := newArena(k, "unit-rocks-coop", "coop", "rocks-coop-seed", 0, 0)
	if coop.world.Rocks != nil {
		t.Fatalf("coop arena should have no rock field: %+v", coop.world.Rocks)
	}
}

// A rock that drifts past the field boundary must reappear inside it (roughly
// the opposite side) rather than drifting away forever — over a long match
// the field must stay populated, not empty out one rock at a time.
func TestStepRocksWrapsAtFieldEdge(t *testing.T) {
	rk := &Rocks{List: []*Rock{{
		Position: Vec3{X: 4999},
		Velocity: Vec3{X: 100}, // one step comfortably past the 5000u field edge
		Radius:   50,
	}}}
	stepRocks(rk, 5000, 1.0)
	r := rk.List[0]
	if d := r.Position.Length(); d > 5000 {
		t.Fatalf("rock still outside the field after wrapping: pos=%+v (len=%.1f)", r.Position, d)
	}
	if r.Position.X > 0 {
		t.Fatalf("rock didn't wrap to roughly the opposite side: pos=%+v", r.Position)
	}
}

// A ship overlapping a rock takes ram damage and is pushed clear of it (not
// left overlapping, which would re-trigger the same collision every
// subsequent tick) — the rock itself is untouched, it's indestructible
// terrain, not another combatant.
func TestDMRockCollisionDamagesAndPushesShipClear(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-rock-collide", "dm", "rock-collide-seed", 0, 0)
	p := joinBare(a)
	p.Ship.Invuln = 0
	p.Ship.Hull = p.Ship.MaxHull

	rock := &Rock{Position: Vec3{X: 1000}, Radius: 100}
	a.world.Rocks.List = []*Rock{rock}
	p.Ship.Pos = Vec3{X: 1000 + 50} // well inside touch distance (100 + player radius)

	evs := a.dmRockCollisions()

	if p.Ship.Hull != p.Ship.MaxHull-k.Rocks["ramDmg"] {
		t.Fatalf("hull = %v, want %v (maxHull - ramDmg)", p.Ship.Hull, p.Ship.MaxHull-k.Rocks["ramDmg"])
	}
	touch := k.Player.Radius + rock.Radius
	if d := p.Ship.Pos.DistanceTo(rock.Position); d < touch {
		t.Fatalf("ship still overlapping the rock after collision: dist=%.1f, want >= %.1f", d, touch)
	}
	if rock.Position != (Vec3{X: 1000}) {
		t.Fatalf("rock moved on ship impact, should be immovable terrain: %+v", rock.Position)
	}
	found := false
	for _, e := range evs {
		if e.Kind == "rockHit" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no rockHit event: %+v", evs)
	}
}

// A bolt that reaches a rock is destroyed on impact instead of passing
// through to hit a player standing behind it.
func TestDMProjectileAbsorbedByRock(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-rock-shot", "dm", "rock-shot-seed", 0, 0)
	shooter := joinBare(a)
	victim := joinBare(a)

	rockPos := Vec3{X: 500}
	a.world.Rocks.List = []*Rock{{Position: rockPos, Radius: 80}}
	// victim sits right behind the rock, in the bolt's line of flight
	victim.Ship.Pos = Vec3{X: 900}
	victim.Ship.Invuln = 0
	victim.Ship.Hull = victim.Ship.MaxHull

	a.world.Projectiles.Spawn(rockPos, Vec3{}, "player", 3.0, nil, kindBolt, shooter.ID)
	evs := a.dmProjectiles()

	idx := (a.world.Projectiles.Cursor - 1 + a.world.Projectiles.Max) % a.world.Projectiles.Max
	if a.world.Projectiles.Ttl[idx] != 0 {
		t.Fatalf("bolt survived hitting a rock: ttl=%v", a.world.Projectiles.Ttl[idx])
	}
	if victim.Ship.Hull != victim.Ship.MaxHull {
		t.Fatalf("victim behind the rock took damage: hull=%v", victim.Ship.Hull)
	}
	found := false
	for _, e := range evs {
		if e.Kind == "rockHit" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no rockHit event: %+v", evs)
	}
}

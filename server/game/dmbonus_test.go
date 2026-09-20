package game

import "testing"

// Deathmatch didn't spawn bonus pickups at all before — dmBonuses reuses
// co-op's own Bonus state/spawn/effect (server/game/rules.go) with no
// single "focus" ship to gauge repair-vs-missile want from. A fresh arena's
// timer should still eventually produce a real, collectible bonus.
func TestDMBonusesSpawnOverTime(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-dm-bonus-spawn", "dm", "dm-bonus-spawn-seed", 0, 0)
	joinBare(a)
	joinBare(a)

	maxWait := k.Bonuses["firstDelayMin"] + k.Bonuses["firstDelayRange"] + 1
	for elapsed := 0.0; elapsed < maxWait; elapsed += tickDT {
		a.dmBonuses()
		if len(a.world.Bonuses.List) > 0 {
			return
		}
	}
	t.Fatalf("no bonus spawned within %.1fs (firstDelay range is %v-%v)", maxWait, k.Bonuses["firstDelayMin"], k.Bonuses["firstDelayMin"]+k.Bonuses["firstDelayRange"])
}

// A bonus must be collectible by ANY alive ship that touches it, not just
// order[0] (the stand-in "focus" ship for the spawn-kind heuristic) — a
// second player flying over one should get its effect and a bonusPicked
// event, exactly like the first player would.
func TestDMBonusesCollectibleByAnyPlayer(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-dm-bonus-collect", "dm", "dm-bonus-collect-seed", 0, 0)
	p1 := joinBare(a) // order[0], the spawn-heuristic "focus" ship
	p2 := joinBare(a) // NOT order[0] — exercises the sweep loop specifically

	p2.Ship.Hull = 50 // below max, so a repair pickup is visibly effective
	bonusPos := Vec3{X: 300}
	p2.Ship.Pos = bonusPos
	p1.Ship.Pos = Vec3{X: -9999} // nowhere near the bonus, so it can't grab it first
	a.world.Bonuses.List = append(a.world.Bonuses.List, &Bonus{
		Kind: "repair", Position: bonusPos, Radius: k.Bonuses["radius"], Life: 999,
	})

	evs := a.dmBonuses()

	if len(a.world.Bonuses.List) != 0 {
		t.Fatalf("bonus was not collected: %+v", a.world.Bonuses.List)
	}
	if p2.Ship.Hull <= 50 {
		t.Fatalf("p2's hull didn't increase after collecting a repair bonus: %v", p2.Ship.Hull)
	}
	found := false
	for _, e := range evs {
		if e.Kind == "bonusPicked" && e.Bonus == "repair" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no bonusPicked event: %+v", evs)
	}
}

// A shot that reaches a bonus must collect it for whoever fired it — DM's own
// dmProjectiles() never called bonusHitByShot (co-op's Projectiles.Step
// does, via weapons.go), so shooting a bonus in DM/TDM silently did nothing:
// the shot passed straight through and the bonus was left uncollected.
func TestDMBonusCollectedByShot(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-dm-bonus-shot", "dm", "dm-bonus-shot-seed", 0, 0)
	shooter := joinBare(a)
	other := joinBare(a) // must NOT be credited — the shooter fired, not this ship
	other.Ship.Pos = Vec3{X: -9999}

	shooter.Ship.Missiles = 0 // below max, so a missile pickup is visibly effective
	bonusPos := Vec3{X: 400}
	a.world.Bonuses.List = append(a.world.Bonuses.List, &Bonus{
		Kind: "missiles", Position: bonusPos, Radius: k.Bonuses["radius"], Life: 999,
	})

	a.world.Projectiles.Spawn(bonusPos, Vec3{}, "player", 3.0, nil, kindBolt, shooter.ID)
	evs := a.dmProjectiles()

	idx := (a.world.Projectiles.Cursor - 1 + a.world.Projectiles.Max) % a.world.Projectiles.Max
	if a.world.Projectiles.Ttl[idx] != 0 {
		t.Fatalf("bolt survived hitting a bonus: ttl=%v", a.world.Projectiles.Ttl[idx])
	}
	if len(a.world.Bonuses.List) != 0 {
		t.Fatalf("bonus was not collected by the shot: %+v", a.world.Bonuses.List)
	}
	if shooter.Ship.Missiles != 0+int(k.Bonuses["missileAmount"]) {
		t.Fatalf("shooter's missiles = %v, want %v (0 + missileAmount)", shooter.Ship.Missiles, int(k.Bonuses["missileAmount"]))
	}
	if other.Ship.Missiles != int(k.Player.MaxMissiles) {
		t.Fatalf("the wrong player was credited: other.Missiles = %v, want untouched default %v", other.Ship.Missiles, int(k.Player.MaxMissiles))
	}
	found := false
	for _, e := range evs {
		if e.Kind == "bonusPicked" && e.Bonus == "missiles" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no bonusPicked event: %+v", evs)
	}
}

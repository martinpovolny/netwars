package game

import "testing"

// joinBare mirrors the arena run() join case without the goroutine/channels.
func joinBare(a *Arena) *Player {
	a.nextID++
	p := &Player{ID: "p" + itoa(a.nextID), out: make(chan []byte, 256)}
	p.Ship = newShip(a.k)
	p.Ship.Pos = spawnSlot(len(a.order))
	p.mslTarget = -1
	a.players[p.ID] = p
	a.order = append(a.order, p.ID)
	return p
}

// The server used to set Invuln on every level reset but never tick it down,
// so a ship stayed permanently invulnerable and hits played their FX without
// ever denting the hull.
func TestArenaInvulnDecaysAndHitsLand(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-hit", "coop", "hit-seed")
	a.world.StartWorldLevel(1, int(k.Pods["perLevel"]))
	p := joinBare(a)

	// grace period must count down
	p.Ship.Invuln = k.Player.InvulnOnReset
	for i := 0; i < int(k.Player.InvulnOnReset/tickDT)+30; i++ {
		a.step()
	}
	if p.Ship.Invuln > 0 {
		t.Fatalf("Invuln never decayed to 0 (stuck at %v)", p.Ship.Invuln)
	}

	// with grace gone, a point-blank enemy must take hull off
	p.Ship.Hull = p.Ship.MaxHull
	p.Ship.Invuln = 0
	e := makeEnemyState("pirate", k, a.world.Rng)
	e.Position = p.Ship.Pos
	a.world.Fleet.List = append(a.world.Fleet.List, e)

	before := p.Ship.Hull
	a.step()
	if p.Ship.Hull >= before {
		t.Fatalf("ram on a non-invuln ship did no damage: hull %v -> %v", before, p.Ship.Hull)
	}
}

// A second player (not a.order[0]) must also be shot at / rammable — enemy
// resolution used to only ever see the focus ship.
func TestArenaSecondPlayerIsVulnerable(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-hit2", "coop", "hit-seed2")
	a.world.StartWorldLevel(1, int(k.Pods["perLevel"]))
	p1 := joinBare(a)
	p2 := joinBare(a)
	_ = p1

	p2.Ship.Invuln = 0
	p2.Ship.Hull = p2.Ship.MaxHull
	// drop an enemy on player 2, far from player 1
	p2.Ship.Pos = Vec3{X: 4000}
	e := makeEnemyState("pirate", k, a.world.Rng)
	e.Position = p2.Ship.Pos
	a.world.Fleet.List = append(a.world.Fleet.List, e)

	before := p2.Ship.Hull
	a.step()
	if p2.Ship.Hull >= before {
		t.Fatalf("enemy ram never touched the non-focus ship: hull %v -> %v", before, p2.Ship.Hull)
	}
}

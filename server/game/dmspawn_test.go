package game

import "testing"

// A deathmatch spawn used to be a plain random point with no separation
// check at all — for a handful of players sharing the same ~550-950u ring,
// that could (and did) put two ships right on top of each other, or close
// enough that one dies before it can react. dmSpawnPos now retries until a
// candidate clears every other currently-alive ship by a minimum distance.
func TestDMSpawnPosKeepsPlayersApart(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	const minSep = 400.0 // must match dmSpawnPos's own minSep
	// "seed-1" isn't special — picked because it's confirmed (by disabling
	// the fix locally and re-running) to produce a 323.8u collision between
	// two of 4 players under the old, unchecked-random dmSpawnPos; a seed
	// that happens not to collide would make this test pass either way.
	a := newArena(k, "unit-dm-spawnsep", "dm", "seed-1", 0, 0)

	var players []*Player
	for i := 0; i < 4; i++ {
		p := joinBare(a)
		p.Ship.Pos = a.dmSpawnPos(p.ID, -1) // -1: plain dm, no team-side bias
		players = append(players, p)
	}

	for i, pi := range players {
		for j, pj := range players {
			if i == j {
				continue
			}
			if d := pi.Ship.Pos.DistanceTo(pj.Ship.Pos); d < minSep-1e-6 {
				t.Fatalf("players %d and %d spawned only %.1f apart (want >= %.1f)\n  p%d=%+v\n  p%d=%+v",
					i, j, d, minSep, i, pi.Ship.Pos, j, pj.Ship.Pos)
			}
		}
	}
}

// dmSpawnPos must exclude the ship it's positioning from its own separation
// check — at join time that ship still sits at the zero-value origin with
// Alive already true, which would otherwise bias every candidate away from
// (0,0,0) for no reason (and, worse, could starve a single joining player's
// very first spawn if minSep ever approached the spawn ring's own radius).
func TestDMSpawnPosExcludesSelf(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-dm-spawnself", "dm", "spawnself-seed", 0, 0)
	p := joinBare(a)
	// p.Ship.Pos is still the zero value here, Alive is true (set by newShip) —
	// exactly the join-time state dmSpawnPos must not compare itself against.
	pos := a.dmSpawnPos(p.ID, -1)
	if pos == (Vec3{}) {
		t.Fatalf("dmSpawnPos(self) returned the origin — it compared the ship against itself")
	}
}

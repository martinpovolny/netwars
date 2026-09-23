package game

import "testing"

// Any enemy should shoot at the player if it happens to have a nice shot
// while doing its task — before this, brawler/strafer only ever fired at
// their own pod target (or, for brawler, the player once already within its
// 380u aggro range) and a hauling thief never fired at all, even when the
// player was sitting dead ahead of an already-cocked gun.

// pirate's behavior is brawler. Pod straight off to +X (a ~90 degree turn
// brawler won't complete in one tick), player straight down -Z — exactly
// where the enemy's identity-quaternion nose already points, well outside
// brawler's own 380u close-range player-switch (450u), and well inside
// fireRange (900u). The pod-aimed shot would fail its own aim-dot gate this
// tick (nose barely turned toward +X yet); only the opportunistic
// player-aimed shot can succeed.
func TestBrawlerFiresOpportunisticallyAtDistantAlignedPlayer(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "brawler-opp-seed")
	w.Ship.Pos = Vec3{Z: -450}
	w.Ship.Alive = true

	e := makeEnemyState("pirate", k, w.Rng)
	e.Position = Vec3{}
	e.Quaternion = Quat{0, 0, 0, 1} // identity: nose faces (0,0,-1), straight at the ship
	e.FireCd = 0
	e.AimPos = Vec3{X: 1000} // its actual task target: a pod far off to the side

	before := w.Projectiles.Cursor
	brawler(e, 1.0/60, w)
	after := w.Projectiles.Cursor

	if after == before {
		t.Fatalf("no shot fired — the player was dead ahead and in range, brawler should have taken it")
	}
	idx := (after - 1 + w.Projectiles.Max) % w.Projectiles.Max
	vel := w.Projectiles.Vel[idx]
	if vel.Z >= 0 {
		t.Fatalf("shot fired away from the player (toward the pod?): vel=%+v, want mostly -Z toward the ship at (0,0,-450)", vel)
	}
	if vel.X > 100 {
		t.Fatalf("shot aimed toward the pod (+X) instead of the player: vel=%+v", vel)
	}
}

// fighter's behavior is strafer, whose "run" state used to ONLY ever fire at
// e.aimPos (its pod) — no player-awareness at all, regardless of alignment.
func TestStraferFiresOpportunisticallyAtAlignedPlayer(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "strafer-opp-seed")
	w.Ship.Pos = Vec3{Z: -450}
	w.Ship.Alive = true

	e := makeEnemyState("fighter", k, w.Rng)
	e.Position = Vec3{}
	e.Quaternion = Quat{0, 0, 0, 1}
	e.FireCd = 0
	e.State = "run"
	e.AimPos = Vec3{X: 1000}

	before := w.Projectiles.Cursor
	strafer(e, 1.0/60, w)
	after := w.Projectiles.Cursor

	if after == before {
		t.Fatalf("no shot fired — the player was dead ahead and in range, strafer should have taken it")
	}
	idx := (after - 1 + w.Projectiles.Max) % w.Projectiles.Max
	if vel := w.Projectiles.Vel[idx]; vel.Z >= 0 || vel.X > 100 {
		t.Fatalf("shot not aimed at the player: vel=%+v", vel)
	}
}

// A hauling thief never fired at all before — no primary target to fall
// back to (it isn't chasing a pod, it's already carrying one), so it just
// silently flew past the player. Now it takes the shot if it's aligned.
func TestThiefFiresOpportunisticallyWhileHauling(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "thief-haul-opp-seed")
	w.Ship.Pos = Vec3{Z: -450}
	w.Ship.Alive = true

	e := makeEnemyState("raider", k, w.Rng)
	e.Position = Vec3{}
	e.Quaternion = Quat{0, 0, 0, 1}
	e.FireCd = 0
	e.State = "haul"
	e.HaulDir = Vec3{X: 1, Z: 0} // hauling off to the side, away from the player
	e.HaulStart = Vec3{}
	pod := &Pod{Position: Vec3{}, Radius: k.Pods["radius"], HP: k.Pods["hp"]}
	e.Loot = pod
	pod.Captor = e

	before := w.Projectiles.Cursor
	thief(e, 1.0/60, w)
	after := w.Projectiles.Cursor

	if after == before {
		t.Fatalf("no shot fired while hauling — the player was dead ahead and in range")
	}
	idx := (after - 1 + w.Projectiles.Max) % w.Projectiles.Max
	if vel := w.Projectiles.Vel[idx]; vel.Z >= 0 {
		t.Fatalf("shot not aimed at the player: vel=%+v", vel)
	}
}

// When nothing lines up with the player, behavior is unchanged: brawler
// still only fires at (and only when aligned with) its own pod target.
func TestBrawlerNoOpportunisticFireWhenPlayerNotAligned(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "brawler-noopp-seed")
	w.Ship.Pos = Vec3{X: 1000} // off to the side, not where the nose points, not close enough to aggro
	w.Ship.Alive = true

	e := makeEnemyState("pirate", k, w.Rng)
	e.Position = Vec3{}
	e.Quaternion = Quat{0, 0, 0, 1}
	e.FireCd = 0
	e.AimPos = Vec3{Z: -450} // pod dead ahead, nose already on it, well within fireRange

	before := w.Projectiles.Cursor
	brawler(e, 1.0/60, w)
	after := w.Projectiles.Cursor
	if after == before {
		t.Fatalf("brawler should still fire at its own aligned pod target when the player isn't a nice shot")
	}
	idx := (after - 1 + w.Projectiles.Max) % w.Projectiles.Max
	if vel := w.Projectiles.Vel[idx]; vel.X > 100 {
		t.Fatalf("shot pulled toward the player's direction (+X) despite a bad angle to it: vel=%+v", vel)
	}
}

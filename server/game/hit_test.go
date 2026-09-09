package game

import (
	"math"
	"testing"
)

// A shooter that is itself moving used to drag every bolt sideways (the bolt
// keeps boltInherit * its own velocity) while aiming straight at the target —
// so a charger circling the player missed even a motionless one. The aim solve
// now compensates.
func TestTryFireHitsAStillTarget(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	hr := k.Weapons["playerHitRadius"]

	closest := func(shooterVel Vec3) float64 {
		w := NewWorld(k, "aim-seed")
		w.Ship.Pos = Vec3{}
		w.Ship.Vel = Vec3{}
		e := makeEnemyState("commander", k, w.Rng)
		e.Position = Vec3{Z: 1000}
		e.Velocity = shooterVel
		e.FireCd = 0
		tv := w.Ship.Vel
		tryFire(e, 1.0/60, w.Ship.Pos, w, -1, &tv) // aimDot -1 => cone check skipped
		idx := (w.Projectiles.Cursor - 1 + w.Projectiles.Max) % w.Projectiles.Max
		if w.Projectiles.Ttl[idx] <= 0 {
			t.Fatalf("no bolt spawned for shooter vel %+v", shooterVel)
		}
		pos, vel := w.Projectiles.Pos[idx], w.Projectiles.Vel[idx]
		best := math.Inf(1)
		for i := 0; i < 600; i++ {
			pos.AddScaledVector(vel, 1.0/60)
			if d := pos.Length(); d < best {
				best = d
			}
		}
		return best
	}

	if d := closest(Vec3{}); d > hr {
		t.Fatalf("still shooter missed a still target by %.1f (hit radius %.0f)", d, hr)
	}
	if d := closest(Vec3{X: 400}); d > hr {
		t.Fatalf("shooter moving 400 u/s sideways missed a still target by %.1f", d)
	}
	if d := closest(Vec3{X: -260, Y: 120, Z: 90}); d > hr {
		t.Fatalf("shooter moving diagonally missed a still target by %.1f", d)
	}
}

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

// A dead co-op player respawns on its own after respawnDelay; the others
// keep playing and the level does not restart.
func TestArenaIndependentRespawn(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-respawn", "coop", "rs-seed")
	a.world.StartWorldLevel(1, int(k.Pods["perLevel"]))
	p1 := joinBare(a)
	p2 := joinBare(a)

	p2.Ship.Alive = false
	p2.Ship.Hull = 0
	lvl := a.world.Fleet.Level
	p1Hull := p1.Ship.Hull

	revived := false
	for i := 0; i < int(respawnDelay/tickDT)+40; i++ {
		a.step()
		if p2.Ship.Alive {
			revived = true
			break
		}
	}
	if !revived {
		t.Fatalf("dead player never respawned after %.1fs", respawnDelay)
	}
	if p2.Ship.Hull != p2.Ship.MaxHull {
		t.Fatalf("respawned hull = %v, want %v", p2.Ship.Hull, p2.Ship.MaxHull)
	}
	if p2.Ship.Invuln <= 0 {
		t.Fatalf("respawn gave no spawn grace")
	}
	if a.world.Fleet.Level != lvl {
		t.Fatalf("level restarted (%d -> %d) on a single respawn", lvl, a.world.Fleet.Level)
	}
	if !p1.Ship.Alive || p1.Ship.Hull != p1Hull {
		t.Fatalf("the other player was disturbed: alive=%v hull=%v", p1.Ship.Alive, p1.Ship.Hull)
	}
}

// In co-op the server owns hull/missiles, so a collected pod has to heal the
// ship server-side (SP does it client-side). Both the focus ship and a
// second ship must be able to pick one up.
func TestCoopBonusHealsCollector(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	repair := k.Bonuses["repairAmount"]

	heal := func(onSecond bool) float64 {
		w := NewWorld(k, "bonus-seed")
		s1 := w.Ship
		s1.Hull = 20
		s2 := &Ship{Alive: true, Hull: 20, MaxHull: k.Player.MaxHull, Pos: Vec3{X: 5000}}
		w.Ships = []*Ship{s1, s2}
		target := s1
		if onSecond {
			target = s2
		}
		w.Bonuses.List = append(w.Bonuses.List, &Bonus{
			Kind: "repair", Position: target.Pos, Radius: k.Bonuses["radius"], Life: 20,
		})
		w.Bonuses.Timer = 999 // no new spawn this tick
		w.StepWorld(1.0 / 60)
		return target.Hull
	}

	if got := heal(false); got <= 20 {
		t.Fatalf("focus ship not healed by a bonus: hull %v", got)
	} else if got != math.Min(k.Player.MaxHull, 20+repair) {
		t.Fatalf("focus ship heal = %v, want %v", got, 20+repair)
	}
	if got := heal(true); got != math.Min(k.Player.MaxHull, 20+repair) {
		t.Fatalf("second ship heal = %v, want %v", got, 20+repair)
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

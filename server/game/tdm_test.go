package game

import "testing"

// joinBareTeam mirrors the real join handler's team assignment (arena.go's
// `case p := <-a.join:`) for tests that bypass the join channel — team must
// be assigned before the new player is counted in a.order, same as there.
func joinBareTeam(a *Arena) *Player {
	a.nextID++
	p := &Player{ID: "p" + itoa(a.nextID), out: make(chan []byte, 256)}
	p.Ship = newShip(a.k)
	p.mslTarget = -1
	p.team = a.assignTeam()
	a.players[p.ID] = p
	a.order = append(a.order, p.ID)
	p.Ship.Pos = a.dmSpawnPos(p.ID, a.teamOrNone(p))
	return p
}

// A player's team has to actually reach OTHER clients' snapshots (Others[])
// for their ship to render in the right team color / be excluded from
// friendly missile lock client-side — not just the scoreboard (which is
// built from a separate path, board(), and could silently mask this).
// Caught live: BuildSnapshot's Others[] loop set Rtt but not Team, so every
// other player's ship rendered as team 0 (blue) regardless of their actual
// team.
func TestOtherPlayersTeamAppearsInSnapshot(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-snap-team", "tdm", "tdm-snap-team-seed", 0, 0)
	p1 := joinBareTeam(a)
	p2 := joinBareTeam(a)
	if p1.team == p2.team {
		t.Fatal("test setup: expected p1 and p2 on different teams (first two joins always balance apart)")
	}

	snap := BuildSnapshot(a.world, a.tick, 0, p1.Ship, a.othersOf(p1))
	if len(snap.Others) != 1 || snap.Others[0].ID != p2.ID || snap.Others[0].Team != p2.team {
		t.Fatalf("p1's snapshot doesn't carry p2's real team: got %+v, want Team=%d", snap.Others, p2.team)
	}
}

// New joins auto-balance onto whichever team has fewer players so far —
// ties broken to team 0 — without anyone having to pick a side.
func TestTeamAssignmentBalances(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-balance", "tdm", "tdm-balance-seed", 0, 0)
	want := []int{0, 1, 0, 1, 0}
	for i, w := range want {
		p := joinBareTeam(a)
		if p.team != w {
			t.Fatalf("join %d: team = %d, want %d", i, p.team, w)
		}
	}
}

// A bolt from one teammate must not damage another — it passes through to a
// real (enemy-team) target beyond instead of stopping dead on a friendly hull.
func TestTeamFriendlyFireOffBolts(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-ff-bolt", "tdm", "tdm-ff-bolt-seed", 0, 0)
	shooter := joinBareTeam(a) // team 0
	teammate := joinBareTeam(a)
	for teammate.team != shooter.team { // force onto the same team regardless of the balancer
		teammate = joinBareTeam(a)
	}
	enemy := joinBareTeam(a)
	for enemy.team == shooter.team {
		enemy = joinBareTeam(a)
	}

	teammate.Ship.Pos = Vec3{Z: -100}
	teammate.Ship.Invuln = 0
	teammate.Ship.Hull = teammate.Ship.MaxHull
	enemy.Ship.Pos = Vec3{Z: -100}
	enemy.Ship.Invuln = 0
	enemy.Ship.Hull = enemy.Ship.MaxHull

	// one bolt sitting exactly on both the teammate and the enemy (same
	// spot) — order in a.order decides who it "reaches" first; what matters
	// is it must never damage the teammate, only ever the enemy.
	a.world.Projectiles.Spawn(Vec3{Z: -100}, Vec3{}, "player", 3.0, nil, kindBolt, shooter.ID)
	a.dmProjectiles()

	if teammate.Ship.Hull != teammate.Ship.MaxHull {
		t.Fatalf("teammate took damage from a friendly bolt: hull %v", teammate.Ship.Hull)
	}
	if shooter.frags != 0 && enemy.Ship.Alive {
		t.Fatalf("frag credited without the enemy actually dying: shooter.frags=%d enemy.alive=%v", shooter.frags, enemy.Ship.Alive)
	}
}

// A same-team ram must not damage either ship — teammates pass through each
// other instead of colliding.
func TestTeamFriendlyFireOffRams(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-ff-ram", "tdm", "tdm-ff-ram-seed", 0, 0)
	p1 := joinBareTeam(a)
	p2 := joinBareTeam(a)
	for p2.team != p1.team {
		p2 = joinBareTeam(a)
	}
	p1.Ship.Pos = Vec3{}
	p1.Ship.Invuln, p1.Ship.Hull = 0, p1.Ship.MaxHull
	p2.Ship.Pos = Vec3{X: 5} // overlapping
	p2.Ship.Invuln, p2.Ship.Hull = 0, p2.Ship.MaxHull

	a.dmRams()

	if p1.Ship.Hull != p1.Ship.MaxHull || p2.Ship.Hull != p2.Ship.MaxHull {
		t.Fatalf("teammates damaged each other on ram: p1=%v p2=%v", p1.Ship.Hull, p2.Ship.Hull)
	}
}

// A kill on an enemy-team ship must credit the killer's TEAM total, not just
// their own individual frags.
func TestTeamFragsTrackOnKill(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-teamfrags", "tdm", "tdm-teamfrags-seed", 0, 0)
	shooter := joinBareTeam(a)
	victim := joinBareTeam(a)
	for victim.team == shooter.team {
		victim = joinBareTeam(a)
	}
	victim.Ship.Pos = Vec3{Z: -50}
	victim.Ship.Invuln = 0
	victim.Ship.Hull = 5 // one bolt kills

	a.world.Projectiles.Spawn(Vec3{Z: -50}, Vec3{}, "player", 3.0, nil, kindBolt, shooter.ID)
	a.dmProjectiles()

	if victim.Ship.Alive {
		t.Fatalf("victim survived a lethal bolt: hull %v", victim.Ship.Hull)
	}
	if shooter.frags != 1 {
		t.Fatalf("shooter.frags = %d, want 1", shooter.frags)
	}
	if a.teamFrags[shooter.team] != 1 {
		t.Fatalf("teamFrags[%d] = %d, want 1", shooter.team, a.teamFrags[shooter.team])
	}
	if a.teamFrags[victim.team] != 0 {
		t.Fatalf("teamFrags[%d] (victim's team) = %d, want 0", victim.team, a.teamFrags[victim.team])
	}
}

// The match-end frag limit compares TEAM totals — a limit reached by two
// different players on the same team combining their frags, not any one
// player individually reaching it, must still end the match.
func TestTeamMatchOverUsesTeamTotals(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-matchover", "tdm", "tdm-matchover-seed", 3, 0) // first team to 3
	p1 := joinBareTeam(a)
	p2 := joinBareTeam(a)
	for p2.team != p1.team {
		p2 = joinBareTeam(a)
	}
	p1.frags = 2
	p2.frags = 1
	a.teamFrags[p1.team] = 3 // neither player individually at the limit

	winner, over := a.checkMatchOver()
	if !over {
		t.Fatalf("match should be over: team %d has %d frags (limit 3)", p1.team, a.teamFrags[p1.team])
	}
	if winner != itoa(p1.team) {
		t.Fatalf("winner = %q, want %q (team %d)", winner, itoa(p1.team), p1.team)
	}
}

// A missile locked on a teammate (mslTargetPlayer) must not actually guide
// onto them — it should fall back to ballistic (nil target) instead of
// homing in on a friendly ship.
func TestTeamMissileCannotLockTeammate(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-msl-lock", "tdm", "tdm-msl-lock-seed", 0, 0)
	shooter := joinBareTeam(a)
	teammate := joinBareTeam(a)
	for teammate.team != shooter.team {
		teammate = joinBareTeam(a)
	}
	shooter.Ship.Pos = Vec3{}
	shooter.Ship.Quat = Quat{0, 0, 0, 1}
	shooter.wantMsl = true
	shooter.mslTarget = -1
	shooter.mslTargetPlayer = teammate.ID

	a.fireWeapons(shooter)

	idx := (a.world.Projectiles.Cursor - 1 + a.world.Projectiles.Max) % a.world.Projectiles.Max
	if a.world.Projectiles.Ttl[idx] <= 0 || a.world.Projectiles.Kind[idx] != kindMsl {
		t.Fatal("no missile spawned")
	}
	if a.world.Projectiles.Target[idx] != nil {
		t.Fatalf("missile guided onto a teammate: target = %+v", a.world.Projectiles.Target[idx])
	}
}

// Each team spawns on its own side of the arena (team 0 always +X, team 1
// always -X) for positional identity.
func TestTeamSpawnSideBias(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-tdm-side", "tdm", "tdm-side-seed", 0, 0)
	for i := 0; i < 40; i++ {
		p := joinBareTeam(a)
		switch p.team {
		case 0:
			if p.Ship.Pos.X < 0 {
				t.Fatalf("team 0 spawn on the wrong side: %+v", p.Ship.Pos)
			}
		case 1:
			if p.Ship.Pos.X > 0 {
				t.Fatalf("team 1 spawn on the wrong side: %+v", p.Ship.Pos)
			}
		}
	}
}

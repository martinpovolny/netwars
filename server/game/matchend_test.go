package game

import (
	"strings"
	"testing"
)

// findMatchOver drains whatever's already queued on a player's outbox
// (snapshots and event batches interleave there) and returns the raw bytes
// of the matchOver event batch, or fails the test if none is queued.
func findMatchOver(t *testing.T, ch chan []byte) []byte {
	t.Helper()
	for {
		select {
		case b := <-ch:
			if strings.Contains(string(b), `"kind":"matchOver"`) {
				return b
			}
		default:
			t.Fatal("no matchOver event found among the queued outbound messages")
			return nil
		}
	}
}

// Reaching the frag limit freezes the arena (no respawn, no combat) for
// matchOverHold seconds, fires a matchOver event naming the leader, then
// quietly clears frags and respawns everyone so the session keeps going.
func TestArenaDeathmatchFragLimitEndsAndRestartsMatch(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-dm-fraglimit", "dm", "dm-fraglimit", 2, 0) // first to 2 frags, no time limit
	p1 := joinBare(a)
	p2 := joinBare(a)
	p1.frags = 1 // one frag short of the limit already
	p2.Ship.Pos = p1.Ship.Pos
	p2.Ship.Invuln, p2.Ship.Hull = 0, 5 // one bolt kills

	a.world.Projectiles.Spawn(p2.Ship.Pos, Vec3{}, teamPlayer, 3.0, nil, kindBolt, p1.ID)
	a.step() // this tick's kill should push p1 to the frag limit

	if p1.frags != 2 {
		t.Fatalf("p1.frags = %d, want 2 (the limit)", p1.frags)
	}
	hold := k.DM["matchOverHold"]
	if a.matchOverCd != hold {
		t.Fatalf("matchOverCd = %v, want the full matchOverHold (%v) — match should have just ended", a.matchOverCd, hold)
	}

	raw := findMatchOver(t, p1.out)
	if !strings.Contains(string(raw), `"wn":"`+p1.ID+`"`) {
		t.Fatalf("matchOver event doesn't name p1 as winner: %s", raw)
	}

	// while frozen: nobody respawns, nothing moves, even though p2 is dead
	// and would normally start its respawn countdown
	for i := 0; i < 30; i++ {
		a.step()
	}
	if p2.Ship.Alive {
		t.Fatalf("dead player respawned while the match-over screen was still up")
	}
	if p1.frags != 2 || p2.frags != 0 {
		t.Fatalf("frags changed during the frozen results screen: p1=%d p2=%d", p1.frags, p2.frags)
	}

	// run out the rest of the hold — the match should quietly restart
	for i := 0; i < int(hold/tickDT)+30; i++ {
		a.step()
	}
	if a.matchOverCd != 0 {
		t.Fatalf("matchOverCd never reached 0 (stuck at %v) — match never restarted", a.matchOverCd)
	}
	if p1.frags != 0 || p2.frags != 0 {
		t.Fatalf("restartMatch didn't clear frags: p1=%d p2=%d", p1.frags, p2.frags)
	}
	if !p1.Ship.Alive || !p2.Ship.Alive {
		t.Fatalf("restartMatch didn't respawn both ships: p1.alive=%v p2.alive=%v", p1.Ship.Alive, p2.Ship.Alive)
	}
}

// A time limit ends the match even with nobody having scored a frag — the
// board is tied 0-0, so the match declares no winner rather than picking an
// arbitrary player.
func TestArenaDeathmatchTimeLimitEndsInATieWithNoFrags(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	timeLimit := 5 * tickDT // a handful of ticks, not a real match length
	a := newArena(k, "unit-dm-timelimit", "dm", "dm-timelimit", 0, timeLimit)
	p1 := joinBare(a)
	p2 := joinBare(a)
	p2.Ship.Pos = Vec3{X: 5000} // out of each other's reach — no incidental frags

	for i := 0; i < 10; i++ {
		a.step()
	}
	if a.matchOverCd <= 0 {
		t.Fatalf("time limit (%v) elapsed but the match never ended", timeLimit)
	}

	raw := findMatchOver(t, p1.out)
	if strings.Contains(string(raw), `"wn":"`) {
		t.Fatalf("expected a winner-less (tied) matchOver event, got: %s", raw)
	}
}

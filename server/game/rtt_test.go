package game

import (
	"testing"

	"github.com/martinpovolny/netwars/server/proto"
)

// A player's own self-reported RTT (piggybacked on every Input, since
// ping/pong only round-trips that one connection) tracks the latest
// positive value, but a 0 — which just means "haven't remeasured since the
// last pong", not "connection gone" — must never erase a previously known
// value.
func TestApplyInputTracksRttWithoutClobberingOnZero(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-rtt", "coop", "rtt-seed", 0, 0)
	p := joinBare(a)

	a.applyInput(p, proto.Input{Seq: 1, Rtt: 85})
	if p.rtt != 85 {
		t.Fatalf("rtt = %v, want 85", p.rtt)
	}
	a.applyInput(p, proto.Input{Seq: 2, Rtt: 0})
	if p.rtt != 85 {
		t.Fatalf("a zero-rtt input clobbered the last known rtt: got %v, want still 85", p.rtt)
	}
	a.applyInput(p, proto.Input{Seq: 3, Rtt: 42})
	if p.rtt != 42 {
		t.Fatalf("rtt didn't update to a fresh positive value: got %v, want 42", p.rtt)
	}
}

// Another player's rtt has to actually reach a client so it can be shown
// next to their name — both in a co-op snapshot's Others[] and in the
// deathmatch scoreboard.
func TestOtherPlayersRttAppearsInSnapshotAndBoard(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	a := newArena(k, "unit-rtt-board", "dm", "rtt-board-seed", 0, 0)
	p1 := joinBare(a)
	p2 := joinBare(a)
	p2.rtt = 123.4

	snap := BuildSnapshot(a.world, a.tick, 0, p1.Ship, a.othersOf(p1))
	if len(snap.Others) != 1 || snap.Others[0].ID != p2.ID || snap.Others[0].Rtt != 123.4 {
		t.Fatalf("p1's snapshot doesn't carry p2's rtt correctly: %+v", snap.Others)
	}

	board := a.board()
	var row *proto.ScoreS
	for i := range board {
		if board[i].ID == p2.ID {
			row = &board[i]
		}
	}
	if row == nil || row.Rtt != 123.4 {
		t.Fatalf("board row for p2 missing or has the wrong rtt: %+v", board)
	}
}

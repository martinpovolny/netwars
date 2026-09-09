package game

import "testing"

// Regression: a cleared level must advance exactly once, not re-fire "LEVEL N
// CLEARED" every FSM cycle. The arena reacts to the level event by calling
// StartWorldLevel; this test does the same and asserts one flash + one restart.
func TestLevelClearedAdvancesOnce(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "lvl-regression")
	perLevel := int(k.Pods["perLevel"])
	w.StartWorldLevel(1, perLevel)

	// simulate "all enemies cleared": no roster, no quota
	w.Fleet.List = nil
	for i := range w.Fleet.Goals {
		w.Fleet.Goals[i].N = 0
	}
	for i := range w.Fleet.Pending {
		w.Fleet.Pending[i].N = 0
	}
	if !fleetCleared(w.Fleet) {
		t.Fatal("test setup: fleet should read as cleared")
	}

	flashes, restarts, podsAtRestart := 0, 0, -1
	for i := 0; i < 60*10; i++ { // 10 sim-seconds — well past the 2.8s hold
		for _, ev := range w.StepWorld(1.0 / 60) {
			if ev.Kind != "level" {
				continue
			}
			if ev.Action.Flash != "" {
				flashes++
			}
			if ev.Action.StartLevel != 0 {
				restarts++
				w.StartWorldLevel(ev.Action.StartLevel, perLevel) // what arena.step does
				podsAtRestart = len(w.Pods.List)
			}
		}
	}

	if flashes != 1 || restarts != 1 {
		t.Fatalf("flashes=%d restarts=%d, want 1/1 (loop = flashes climbs forever)", flashes, restarts)
	}
	if w.Fleet.Level != 2 {
		t.Fatalf("level = %d, want 2", w.Fleet.Level)
	}
	if fleetPendingRemaining(w.Fleet)+len(w.Fleet.List) == 0 {
		t.Fatal("level 2 has no enemies queued")
	}
	if podsAtRestart != perLevel {
		t.Fatalf("pods at restart = %d, want %d", podsAtRestart, perLevel)
	}
}

// The lost path restarts the same level, not the next.
func TestLevelLostRestartsSameLevel(t *testing.T) {
	k, _ := LoadConstants()
	w := NewWorld(k, "lvl-lost")
	perLevel := int(k.Pods["perLevel"])
	w.StartWorldLevel(1, perLevel)
	w.Ship.Alive = true

	for _, p := range w.Pods.List {
		p.Dead = true
	}

	flashes, restarts, restartedTo := 0, 0, 0
	for i := 0; i < 60*8; i++ {
		for _, ev := range w.StepWorld(1.0 / 60) {
			if ev.Kind != "level" {
				continue
			}
			if ev.Action.Flash != "" {
				flashes++
			}
			if ev.Action.StartLevel != 0 {
				restarts++
				restartedTo = ev.Action.StartLevel
				w.StartWorldLevel(ev.Action.StartLevel, perLevel)
			}
		}
	}
	if flashes != 1 || restarts != 1 || restartedTo != 1 {
		t.Fatalf("flashes=%d restarts=%d to=%d, want 1/1/1", flashes, restarts, restartedTo)
	}
	if len(w.Pods.List) != perLevel {
		t.Fatalf("pods after restart = %d, want %d", len(w.Pods.List), perLevel)
	}
}

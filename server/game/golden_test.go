package game

import "testing"

const goldenPath = "testdata/golden.json"

// The committed golden vector loads and is internally consistent. This runs in
// CI today; the frame-by-frame stepWorld comparison is wired in M2.3.
func TestGoldenLoads(t *testing.T) {
	g, err := LoadGolden(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	if g.Seed != "golden" {
		t.Fatalf("seed = %q, want %q", g.Seed, "golden")
	}
	if g.Ticks != 600 || len(g.Frames) != 600 {
		t.Fatalf("ticks=%d frames=%d, want 600/600", g.Ticks, len(g.Frames))
	}
	if g.Frames[0].T != 0 || g.Frames[599].T != 599 {
		t.Fatalf("frame t range = [%d..%d], want [0..599]", g.Frames[0].T, g.Frames[599].T)
	}
	last := g.Frames[599]
	if last.Level < 1 {
		t.Fatalf("final level %d", last.Level)
	}
	t.Logf("golden ok: final level=%d score=%d fsm=%s enemies=%d pods=%d proj=%d",
		last.Level, last.Score, last.FSM.State, len(last.Enemies), len(last.Pods), len(last.Proj))
}

// Placeholder for the real parity check (M2.3): build a World from g.Seed,
// drive the same scripted ship + cannon cadence tools/golden.html uses, run
// StepWorld for g.Ticks and assert each frame matches within 1e-4.
func TestGoldenParity(t *testing.T) {
	t.Skip("stepWorld port lands in M2.3")
}

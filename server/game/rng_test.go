package game

import "testing"

// Reference values captured from shared/sim/rng.js: makeRng("golden") then
// eight draws, as raw uint32 (float = u32 / 2^32). If this breaks, the Go and
// JS RNGs have diverged and every seeded world will disagree.
func TestRngMatchesJS(t *testing.T) {
	want := []uint32{
		3451867010, 3507615967, 1764380002, 980861888,
		226646099, 1393266236, 1752275042, 3834986095,
	}
	r := NewRng("golden")
	for i, w := range want {
		if got := r.U32(); got != w {
			t.Fatalf("draw %d: got %d, want %d", i, got, w)
		}
	}
}

func TestRngFloatRange(t *testing.T) {
	r := NewRng("eneas")
	for i := 0; i < 100000; i++ {
		v := r.Float64()
		if v < 0 || v >= 1 {
			t.Fatalf("draw %d out of [0,1): %v", i, v)
		}
	}
}

func TestRngDeterministic(t *testing.T) {
	a, b := NewRng("arena-42"), NewRng("arena-42")
	for i := 0; i < 1000; i++ {
		if a.U32() != b.U32() {
			t.Fatalf("same seed diverged at draw %d", i)
		}
	}
	c := NewRng("arena-43")
	same := true
	d := NewRng("arena-42")
	for i := 0; i < 8; i++ {
		if c.U32() != d.U32() {
			same = false
			break
		}
	}
	if same {
		t.Fatal("different seeds produced the same sequence")
	}
}

package game

import "testing"

// A pod ram is meant to be two discrete hits (podStrikeDmg=20 vs a 24hp pod),
// but without a per-enemy cooldown a single ram that stays overlapping for a
// couple of ticks landed podStrikeDmg every one of those ticks — killing the
// pod in what read as one hit. checkPodStrikes now debounces via PodStrikeCd.
func TestCheckPodStrikesDebouncesRepeatedOverlap(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	ke := k.Enemy

	e := &Enemy{Behavior: "brawler", Radius: 10}
	p := &Pod{Position: Vec3{}, Radius: 10, HP: 24}
	fleet := &Fleet{List: []*Enemy{e}}
	pods := &Pods{List: []*Pod{p}}

	// enemy stays glued to the pod (position never separates, as if the
	// knockback hadn't carried it clear yet) across several ticks at 60Hz
	dt := 1.0 / 60
	for i := 0; i < 10; i++ {
		checkPodStrikes(fleet, pods, ke, dt)
	}
	if p.Dead {
		t.Fatalf("pod died from a single sustained overlap — one hit killed it, want two separate hits")
	}
	if p.HP != 24-ke["podStrikeDmg"] {
		t.Fatalf("pod HP = %v after repeated overlap, want exactly one podStrikeDmg (%v) applied", p.HP, ke["podStrikeDmg"])
	}

	// let the cooldown fully lapse, then one more overlapping tick lands the
	// second hit and (20+20=40 > 24hp) kills the pod
	checkPodStrikes(fleet, pods, ke, ke["podStrikeCd"]+dt)
	if !p.Dead {
		t.Fatalf("pod survived a second ram hit (HP=%v) — want it dead after two hits", p.HP)
	}
}

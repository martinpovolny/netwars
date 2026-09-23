package game

import "testing"

// Thieves used to only claim a pod (set Captor) once physically adjacent and
// slow — while still approaching, Captor stayed nil. nearestPod (used for
// both the initial pick and every re-pick) never excluded a pod another
// thief was already approaching either, so two thieves could both target
// the same pod, and a "loser" thief re-picking away from an
// already-captured pod would often land right back on it (still "nearest").
// With both then alternately overwriting the pod's position from their own
// diverging haul paths, the pod's apparent distance from either thief's own
// haulStart could spike far past normal, tripping the escape check much
// sooner than a real haul ever would — "thieves disappear with the pod too
// early." Fixed by claiming (Captor) the moment a pod is picked, and adding
// nearestUnclaimedPod so a re-pick can never land on a claimed pod.

// A thief claims its target the instant it picks it, long before it's
// actually close enough to grab — not just once physically adjacent.
func TestThiefClaimsPodAtPickTime(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "thief-claim-seed")
	e := makeEnemyState("raider", k, w.Rng) // raider's behavior is "thief"
	e.Position = Vec3{X: 2000}              // far from the pod — nowhere near capture range
	pod := &Pod{Position: Vec3{}, Radius: k.Pods["radius"], HP: k.Pods["hp"]}
	w.Pods.List = []*Pod{pod}
	w.Fleet.List = []*Enemy{e}

	thief(e, 1.0/60, w)

	if e.State == "haul" {
		t.Fatalf("thief shouldn't be hauling yet from 2000u away: state=%q", e.State)
	}
	if pod.Captor != e {
		t.Fatalf("pod.Captor = %v, want the thief claimed on pick, before it's even close", pod.Captor)
	}
	if e.Loot != pod {
		t.Fatalf("thief.Loot = %+v, want the only pod in the world", e.Loot)
	}
}

// Two thieves converging on the only pod in range must never both end up
// targeting (let alone hauling) it — exactly one claims it, the other backs
// off it entirely.
func TestTwoThievesNeverClaimSamePod(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "two-thieves-seed")
	a := makeEnemyState("raider", k, w.Rng)
	b := makeEnemyState("raider", k, w.Rng)
	a.Position = Vec3{X: 1000}
	b.Position = Vec3{X: -1000}
	pod := &Pod{Position: Vec3{}, Radius: k.Pods["radius"], HP: k.Pods["hp"]}
	w.Pods.List = []*Pod{pod}
	w.Fleet.List = []*Enemy{a, b}

	dt := 1.0 / 60
	for i := 0; i < 600; i++ { // 10s — plenty of time for both to converge if the bug were present
		thief(a, dt, w)
		thief(b, dt, w)
	}

	if a.Loot == pod && b.Loot == pod {
		t.Fatalf("both thieves are still targeting the same pod after 10s: a.Loot==pod=%v b.Loot==pod=%v", a.Loot == pod, b.Loot == pod)
	}
	if pod.Captor != nil && (a.Loot == pod) && (b.Loot == pod) {
		t.Fatalf("pod has a captor but both thieves still reference it as their loot")
	}
}

// nearestUnclaimedPod must skip a pod another thief already has Captor on,
// even when it's the closer one — nearestPod (used for non-thief attack
// targeting) has no reason to change, so this is a separate function.
func TestNearestUnclaimedPodSkipsClaimedPods(t *testing.T) {
	other := &Enemy{}
	near := &Pod{Position: Vec3{X: 100}, Captor: other}
	far := &Pod{Position: Vec3{X: 500}}
	pods := &Pods{List: []*Pod{near, far}}

	got := nearestUnclaimedPod(Vec3{}, pods)
	if got != far {
		t.Fatalf("nearestUnclaimedPod returned %+v, want the farther unclaimed pod (nearer one is claimed by another thief)", got)
	}
	// sanity: plain nearestPod (used elsewhere) is unaffected and still
	// returns the claimed-but-nearer pod — confirming these are genuinely
	// different functions, not an accidental no-op change.
	if plain := nearestPod(Vec3{}, pods); plain != near {
		t.Fatalf("nearestPod (non-thief targeting) changed behavior: got %+v, want the nearer pod regardless of captor", plain)
	}
}

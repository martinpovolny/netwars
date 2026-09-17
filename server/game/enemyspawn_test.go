package game

import "testing"

// A fresh enemy's spawn point is drawn far from the pod CENTROID, not from
// any individual pod — once several pods are destroyed, a couple of
// scattered survivors can leave the centroid sitting right between them,
// each still up to pods.spawnMin+spawnRange out on their own. spawnEnemy
// must still keep every spawn clear of every individual pod by at least
// podClearance, not just far from their average position.
func TestSpawnEnemyClearsEveryIndividualPod(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	clearance := k.Enemy["podClearance"]
	if clearance <= 0 {
		t.Fatal("enemy.podClearance is not configured")
	}

	// Two survivors on opposite sides of a shared centroid, each at the pod
	// system's own max individual spread — the adversarial case the fix
	// targets: the centroid (0,0,0) is far from a fresh spawn's own anchor
	// radius, but each pod itself sits right at spawnMin+spawnRange from it.
	spread := k.Pods["spawnMin"] + k.Pods["spawnRange"]
	pods := []*Pod{
		{Position: Vec3{X: spread}, Radius: k.Pods["radius"]},
		{Position: Vec3{X: -spread}, Radius: k.Pods["radius"]},
	}
	anchor := Vec3{} // centroid of the two pods above

	rng := NewRng("clearance-seed")
	f := &Fleet{Pending: []goalEntry{{Type: "pirate", N: 200}}}
	for i := 0; i < 200; i++ {
		if !spawnEnemy(f, anchor, Vec3{Z: 1}, k, rng, pods) {
			t.Fatalf("spawnEnemy returned false before exhausting pending (i=%d)", i)
		}
	}
	if len(f.List) != 200 {
		t.Fatalf("got %d enemies, want 200", len(f.List))
	}
	for i, e := range f.List {
		for j, p := range pods {
			if d := e.Position.DistanceTo(p.Position); d < clearance-1e-6 {
				t.Fatalf("enemy %d spawned %.1f from pod %d (want >= %.1f)\n  enemy=%+v\n  pod=%+v", i, d, j, clearance, e.Position, p.Position)
			}
		}
	}
}

// Enemies must still spawn (nothing gets stuck) when there are no pods at
// all — the clearance loop must be a no-op, not a source of a nil-slice
// panic or infinite loop.
func TestSpawnEnemyWithNoPods(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	rng := NewRng("no-pods-seed")
	f := &Fleet{Pending: []goalEntry{{Type: "pirate", N: 3}}}
	for i := 0; i < 3; i++ {
		if !spawnEnemy(f, Vec3{}, Vec3{Z: 1}, k, rng, nil) {
			t.Fatalf("spawnEnemy(nil pods) returned false (i=%d)", i)
		}
	}
	if len(f.List) != 3 {
		t.Fatalf("got %d enemies, want 3", len(f.List))
	}
}

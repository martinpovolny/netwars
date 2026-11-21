package game

import "testing"

// A player bolt that was fired with a lock (the guided-cannon bonus) goes out
// in the snapshot as kind "gbolt" so every client can draw it in the guided
// colour; plain bolts, missiles and enemy bolts keep their kind. The sim's own
// Kind is untouched (still "bolt").
func TestSnapshotMarksGuidedBolts(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	w := NewWorld(k, "snap-guided-seed")
	tgt := &Enemy{ID: 1, Position: Vec3{Z: -500}, HP: 10}

	spawn := func(team, kind string, target guideTarget) int {
		w.Projectiles.Spawn(Vec3{}, Vec3{Z: -1500}, team, 2.0, target, kind, "p1")
		return (w.Projectiles.Cursor - 1 + w.Projectiles.Max) % w.Projectiles.Max
	}
	guided := spawn(teamPlayer, kindBolt, tgt)
	plain := spawn(teamPlayer, kindBolt, nil)
	msl := spawn(teamPlayer, kindMsl, tgt)
	enemy := spawn(teamEnemy, kindBolt, tgt)

	snap := BuildSnapshot(w, 1, 0, w.Ship, nil)
	got := map[int]string{}
	for _, q := range snap.Proj {
		got[q.I] = q.Kind
	}
	want := map[int]string{guided: "gbolt", plain: "bolt", msl: "missile", enemy: "bolt"}
	for i, kd := range want {
		if got[i] != kd {
			t.Errorf("projectile %d: snapshot kind %q, want %q", i, got[i], kd)
		}
	}
	if w.Projectiles.Kind[guided] != kindBolt {
		t.Fatalf("sim kind changed to %q; only the wire form may differ", w.Projectiles.Kind[guided])
	}
}

package game

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

func e(name string, level, score int, sec int) Entry {
	return Entry{Name: name, Level: level, Score: score, At: t0.Add(time.Duration(sec) * time.Second)}
}

func newStore(t *testing.T) (*ScoreStore, string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "scores.json")
	return OpenScoreStore(p), p
}

func TestRankingOrder(t *testing.T) {
	s, _ := newStore(t)
	mustSubmit := func(en Entry) int {
		r, err := s.Submit(en)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	mustSubmit(e("lowlevel-highscore", 2, 99999, 0))
	mustSubmit(e("highlevel-lowscore", 3, 10, 1))
	mustSubmit(e("same-level-higher", 3, 500, 2))
	mustSubmit(e("tie-late", 3, 500, 9))
	mustSubmit(e("tie-early", 3, 500, 5))
	got := []string{}
	for _, en := range s.Top() {
		got = append(got, en.Name)
	}
	want := []string{"same-level-higher", "tie-early", "tie-late", "highlevel-lowscore", "lowlevel-highscore"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order\n got %v\nwant %v", got, want)
	}
}

func TestTruncatesToTen(t *testing.T) {
	s, _ := newStore(t)
	for i := 0; i < 15; i++ {
		if _, err := s.Submit(e(fmt.Sprintf("p%d", i), 1, 100+i, i)); err != nil {
			t.Fatal(err)
		}
	}
	top := s.Top()
	if len(top) != MaxScores {
		t.Fatalf("len %d, want %d", len(top), MaxScores)
	}
	if top[0].Score != 114 || top[9].Score != 105 {
		t.Fatalf("wrong cut: first %d last %d", top[0].Score, top[9].Score)
	}
	rank, err := s.Submit(e("loser", 1, 1, 99))
	if err != nil || rank != 0 {
		t.Fatalf("rank %d err %v, want 0,nil", rank, err)
	}
	if len(s.Top()) != MaxScores {
		t.Fatal("store grew")
	}
}

func TestSubmitReturnsRank(t *testing.T) {
	s, _ := newStore(t)
	s.Submit(e("a", 2, 100, 0))
	r, _ := s.Submit(e("b", 3, 1, 1))
	if r != 1 {
		t.Fatalf("rank %d, want 1", r)
	}
	r, _ = s.Submit(e("c", 2, 50, 2))
	if r != 3 {
		t.Fatalf("rank %d, want 3", r)
	}
}

func TestPersistRoundTrip(t *testing.T) {
	s, p := newStore(t)
	s.Submit(e("a", 2, 100, 0))
	s.Submit(e("b", 3, 1, 1))
	s2 := OpenScoreStore(p)
	if !reflect.DeepEqual(s.Top(), s2.Top()) {
		t.Fatalf("reopen differs:\n%v\n%v", s.Top(), s2.Top())
	}
}

func TestCorruptFileStartsEmpty(t *testing.T) {
	p := filepath.Join(t.TempDir(), "scores.json")
	os.WriteFile(p, []byte("not json"), 0o644)
	s := OpenScoreStore(p)
	if len(s.Top()) != 0 {
		t.Fatal("expected empty")
	}
	if _, err := s.Submit(e("a", 1, 1, 0)); err != nil {
		t.Fatal(err)
	}
	if len(OpenScoreStore(p).Top()) != 1 {
		t.Fatal("did not recover by overwriting")
	}
}

func TestNoTmpLeftBehind(t *testing.T) {
	s, p := newStore(t)
	s.Submit(e("a", 1, 1, 0))
	ents, _ := os.ReadDir(filepath.Dir(p))
	for _, d := range ents {
		if filepath.Ext(d.Name()) == ".tmp" {
			t.Fatalf("leftover %s", d.Name())
		}
	}
}

func TestPersistFailureRollsBack(t *testing.T) {
	s := OpenScoreStore(filepath.Join(t.TempDir(), "nope", "scores.json"))
	if _, err := s.Submit(e("a", 1, 1, 0)); err == nil {
		t.Fatal("expected persist error")
	}
	if len(s.Top()) != 0 {
		t.Fatal("memory not rolled back")
	}
}

func TestTopReturnsCopy(t *testing.T) {
	s, _ := newStore(t)
	s.Submit(e("a", 1, 1, 0))
	top := s.Top()
	top[0].Name = "mutated"
	if s.Top()[0].Name != "a" {
		t.Fatal("Top leaked internal slice")
	}
}

func TestConcurrentSubmit(t *testing.T) {
	s, p := newStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := s.Submit(e(fmt.Sprintf("p%d", i), 1+i%5, i*10, i)); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	top := s.Top()
	if len(top) != MaxScores {
		t.Fatalf("len %d", len(top))
	}
	for i := 1; i < len(top); i++ {
		a, b := top[i-1], top[i]
		if a.Level < b.Level || (a.Level == b.Level && a.Score < b.Score) {
			t.Fatalf("unsorted at %d: %v then %v", i, a, b)
		}
	}
	if !reflect.DeepEqual(top, OpenScoreStore(p).Top()) {
		t.Fatal("file differs from memory")
	}
}

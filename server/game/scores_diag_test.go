package game

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A scores file that can't be written must never fail silently: the server
// checks at startup / on /healthz, and logs every failed submit.

func TestWritable(t *testing.T) {
	ok := OpenScoreStore(filepath.Join(t.TempDir(), "scores.json"))
	if err := ok.Writable(); err != nil {
		t.Fatalf("writable dir reported as unwritable: %v", err)
	}

	bad := OpenScoreStore(filepath.Join(t.TempDir(), "no-such-dir", "scores.json"))
	if err := bad.Writable(); err == nil {
		t.Fatal("a path in a missing directory must report an error")
	}
}

func TestWritableLeavesNothingBehind(t *testing.T) {
	dir := t.TempDir()
	s := OpenScoreStore(filepath.Join(dir, "scores.json"))
	if err := s.Writable(); err != nil {
		t.Fatal(err)
	}
	ents, _ := os.ReadDir(dir)
	if len(ents) != 0 {
		t.Fatalf("probe left files behind: %v", ents)
	}
	// and it must not have created or clobbered the scores file itself
	s.Submit(Entry{Name: "a", Level: 1, Score: 1})
	before, _ := os.ReadFile(filepath.Join(dir, "scores.json"))
	if err := s.Writable(); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(dir, "scores.json"))
	if string(before) != string(after) {
		t.Fatal("Writable() modified the scores file")
	}
}

func TestScoresStatus(t *testing.T) {
	ok := OpenScoreStore(filepath.Join(t.TempDir(), "scores.json"))
	if got := ScoresStatus(ok); got != "scores=ok" {
		t.Errorf("got %q, want scores=ok", got)
	}
	bad := OpenScoreStore(filepath.Join(t.TempDir(), "nope", "scores.json"))
	got := ScoresStatus(bad)
	if !strings.HasPrefix(got, "scores=READONLY") {
		t.Errorf("got %q, want it to start with scores=READONLY", got)
	}
}

func TestFailedSubmitIsLogged(t *testing.T) {
	var buf bytes.Buffer
	old := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(old)

	st := OpenScoreStore(filepath.Join(t.TempDir(), "nope", "scores.json"))
	c := &clock{t: t0}
	h := newScoresHandler(st, c.now)
	w := do(h, "POST", `{"name":"Ace","level":2,"score":900}`, nil)
	if w.Code != 500 {
		t.Fatalf("status %d, want 500", w.Code)
	}
	out := buf.String()
	if !strings.Contains(out, "could not save score") || !strings.Contains(out, "no-such-dir") && !strings.Contains(out, "nope") {
		t.Fatalf("the failed submit was not logged with its cause; log: %q", out)
	}
}

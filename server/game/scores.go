package game

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// MaxScores is how many entries the world-wide table keeps.
const MaxScores = 10

// Entry is one high-score row. Ranking is level desc, then score desc, then
// earlier At first.
type Entry struct {
	Name  string    `json:"name"`
	Level int       `json:"level"`
	Score int       `json:"score"`
	At    time.Time `json:"at"`
}

func better(a, b Entry) bool {
	if a.Level != b.Level {
		return a.Level > b.Level
	}
	if a.Score != b.Score {
		return a.Score > b.Score
	}
	return a.At.Before(b.At)
}

// ScoreStore is the top-10 table: held in memory under a mutex and persisted
// as JSON via write-temp-then-rename, so a crash never leaves a torn file.
type ScoreStore struct {
	mu      sync.Mutex
	path    string
	entries []Entry
}

// OpenScoreStore loads path. A missing or corrupt file yields an empty table
// (logged, never fatal) — the next successful Submit overwrites it.
func OpenScoreStore(path string) *ScoreStore {
	s := &ScoreStore{path: path}
	b, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("scores: read %s: %v (starting empty)", path, err)
		}
		return s
	}
	if err := json.Unmarshal(b, &s.entries); err != nil {
		log.Printf("scores: %s is corrupt: %v (starting empty)", path, err)
		s.entries = nil
		return s
	}
	sort.SliceStable(s.entries, func(i, j int) bool { return better(s.entries[i], s.entries[j]) })
	if len(s.entries) > MaxScores {
		s.entries = s.entries[:MaxScores]
	}
	return s
}

// Top returns a copy of the table, best first.
func (s *ScoreStore) Top() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Entry{}, s.entries...)
}

// Submit inserts e and persists. rank is 1-based, 0 if e didn't make the top
// 10. On a persist error the in-memory table is left unchanged.
func (s *ScoreStore) Submit(e Entry) (rank int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := append(append([]Entry{}, s.entries...), e)
	sort.SliceStable(next, func(i, j int) bool { return better(next[i], next[j]) })
	if len(next) > MaxScores {
		next = next[:MaxScores]
	}
	if err := s.persist(next); err != nil {
		return 0, err
	}
	s.entries = next
	for i, x := range next {
		if x == e {
			return i + 1, nil
		}
	}
	return 0, nil
}

// Writable reports whether the scores file's directory accepts new files — the
// thing Submit needs (it writes a temp file and renames it into place). It
// creates and removes a probe file in that directory; the scores file itself is
// never touched. Used at startup and by /healthz so a read-only deploy (e.g. a
// systemd unit without StateDirectory) is loud instead of silently dropping
// every score.
func (s *ScoreStore) Writable() error {
	f, err := os.CreateTemp(filepath.Dir(s.path), ".scores-probe-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

// ScoresStatus is the /healthz fragment: "scores=ok" or "scores=READONLY(cause)".
func ScoresStatus(s *ScoreStore) string {
	if err := s.Writable(); err != nil {
		return "scores=READONLY(" + err.Error() + ")"
	}
	return "scores=ok"
}

func (s *ScoreStore) persist(entries []Entry) error {
	b, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

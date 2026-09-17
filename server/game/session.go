package game

import (
	"context"
	"sync"
	"sync/atomic"
)

// Sessions maps a session_id string to its running Arena. An arena is created
// on the first join and removed when its last player leaves.
type Sessions struct {
	ctx context.Context
	k   *Constants

	nextPID atomic.Int64 // global player-id counter

	mu     sync.Mutex
	arenas map[string]*Arena
}

func NewSessions(ctx context.Context, k *Constants) *Sessions {
	return &Sessions{ctx: ctx, k: k, arenas: map[string]*Arena{}}
}

// getOrCreate returns the arena for (session, mode), starting its goroutine if
// it's new. The seed is the session id so every arena / client agrees.
// fragLimit/timeLimit only apply to a brand-new dm arena — like mode, a
// latecomer joining an existing session inherits whatever it was created
// with, not their own hello's values.
func (s *Sessions) getOrCreate(session, mode string, fragLimit int, timeLimit float64) *Arena {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a, ok := s.arenas[session]; ok {
		return a
	}
	a := newArena(s.k, session, mode, session, fragLimit, timeLimit)
	a.onEmpty = func() {
		s.mu.Lock()
		delete(s.arenas, session)
		s.mu.Unlock()
	}
	s.arenas[session] = a
	go a.run(s.ctx)
	return a
}

// Count is the number of live arenas (for /healthz, tests).
func (s *Sessions) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.arenas)
}

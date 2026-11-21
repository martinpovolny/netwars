package game

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxScoreBody   = 1024
	maxNameRunes   = 16
	maxLevel       = 999
	maxScoreValue  = 10_000_000
	postMinSpacing = 5 * time.Second
)

// ScoresHandler serves GET (the table) and POST (submit) on /scores.
func ScoresHandler(s *ScoreStore) http.HandlerFunc {
	return newScoresHandler(s, time.Now).ServeHTTP
}

type scoresHandler struct {
	store *ScoreStore
	now   func() time.Time

	mu   sync.Mutex
	last map[string]time.Time // client IP -> last POST time
}

func newScoresHandler(s *ScoreStore, now func() time.Time) *scoresHandler {
	return &scoresHandler{store: s, now: now, last: map[string]time.Time{}}
}

func (h *scoresHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.cors(w, r)
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		writeJSON(w, http.StatusOK, h.store.Top())
	case http.MethodPost:
		h.post(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, OPTIONS")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (h *scoresHandler) post(w http.ResponseWriter, r *http.Request) {
	if !h.allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "slow down"})
		return
	}
	var in struct {
		Name  string `json:"name"`
		Level int    `json:"level"`
		Score int    `json:"score"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxScoreBody)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return
	}
	name := cleanName(in.Name)
	if name == "" || in.Level < 1 || in.Level > maxLevel || in.Score < 0 || in.Score > maxScoreValue {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid entry"})
		return
	}
	rank, err := h.store.Submit(Entry{Name: name, Level: in.Level, Score: in.Score, At: h.now().UTC()})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save score"})
		return
	}
	var rp *int
	if rank > 0 {
		rp = &rank
	}
	writeJSON(w, http.StatusOK, struct {
		Rank  *int    `json:"rank"`
		Table []Entry `json:"table"`
	}{rp, h.store.Top()})
}

// allow enforces 1 POST per postMinSpacing per IP and prunes stale keys so
// the map can't grow without bound.
func (h *scoresHandler) allow(ip string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	for k, t := range h.last {
		if now.Sub(t) >= postMinSpacing {
			delete(h.last, k)
		}
	}
	if _, busy := h.last[ip]; busy {
		return false
	}
	h.last[ip] = now
	return true
}

// clientIP prefers the first X-Forwarded-For hop (Caddy sits in front).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if first, _, _ := strings.Cut(xff, ","); strings.TrimSpace(first) != "" {
			return strings.TrimSpace(first)
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// cleanName drops control characters, collapses whitespace, and truncates to
// maxNameRunes runes (not bytes).
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && !unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if rs := []rune(s); len(rs) > maxNameRunes {
		s = strings.TrimSpace(string(rs[:maxNameRunes]))
	}
	return s
}

// cors echoes the request Origin only when its host matches AllowedOrigins.
func (h *scoresHandler) cors(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return
	}
	for _, pat := range AllowedOrigins {
		if ok, _ := path.Match(pat, u.Host); ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

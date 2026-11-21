package game

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newHandler(t *testing.T) (http.Handler, *clock, *ScoreStore) {
	t.Helper()
	st := OpenScoreStore(filepath.Join(t.TempDir(), "scores.json"))
	c := &clock{t: t0}
	return newScoresHandler(st, c.now), c, st
}

func do(h http.Handler, method, body string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/scores", strings.NewReader(body))
	r.RemoteAddr = "10.0.0.1:5555"
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestGetEmptyIsArray(t *testing.T) {
	h, _, _ := newHandler(t)
	w := do(h, "GET", "", nil)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
}

func TestPostReturnsRankAndTable(t *testing.T) {
	h, _, _ := newHandler(t)
	w := do(h, "POST", `{"name":"Ace","level":3,"score":4200}`, nil)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var res struct {
		Rank  *int    `json:"rank"`
		Table []Entry `json:"table"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Rank == nil || *res.Rank != 1 || len(res.Table) != 1 || res.Table[0].Name != "Ace" || !res.Table[0].At.Equal(t0) {
		t.Fatalf("bad response %s", w.Body)
	}
	g := do(h, "GET", "", nil)
	if !strings.Contains(g.Body.String(), `"Ace"`) {
		t.Fatalf("GET missing entry: %s", g.Body)
	}
}

func TestPostNotInTopTenRankNull(t *testing.T) {
	h, c, _ := newHandler(t)
	for i := 0; i < 10; i++ {
		c.t = c.t.Add(10 * time.Second)
		if w := do(h, "POST", `{"name":"p","level":5,"score":1000}`, nil); w.Code != 200 {
			t.Fatal(w.Body)
		}
	}
	c.t = c.t.Add(10 * time.Second)
	w := do(h, "POST", `{"name":"low","level":1,"score":1}`, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"rank":null`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestValidation(t *testing.T) {
	h, c, st := newHandler(t)
	bad := map[string]string{
		"malformed":      `{`,
		"level 0":        `{"name":"a","level":0,"score":1}`,
		"level 1000":     `{"name":"a","level":1000,"score":1}`,
		"level float":    `{"name":"a","level":1.5,"score":1}`,
		"score neg":      `{"name":"a","level":1,"score":-1}`,
		"score too big":  `{"name":"a","level":1,"score":10000001}`,
		"name empty":     `{"name":"","level":1,"score":1}`,
		"name blank":     `{"name":"  \t\n","level":1,"score":1}`,
		"name ctrl only": `{"name":"\u0000\u0007","level":1,"score":1}`,
		"missing name":   `{"level":1,"score":1}`,
		"oversize":       `{"name":"a","level":1,"score":1,"pad":"` + strings.Repeat("x", 1100) + `"}`,
	}
	for name, body := range bad {
		c.t = c.t.Add(10 * time.Second)
		if w := do(h, "POST", body, nil); w.Code != 400 {
			t.Errorf("%s: got %d, want 400", name, w.Code)
		}
	}
	if len(st.Top()) != 0 {
		t.Fatal("invalid submits were stored")
	}

	ok := []struct{ in, want string }{
		{`{"name":"A\u0000B","level":1,"score":0}`, "AB"},
		{`{"name":"  a   b ","level":999,"score":10000000}`, "a b"},
		{`{"name":"` + strings.Repeat("ž", 20) + `","level":1,"score":1}`, strings.Repeat("ž", 16)},
	}
	for _, tc := range ok {
		c.t = c.t.Add(10 * time.Second)
		if w := do(h, "POST", tc.in, nil); w.Code != 200 {
			t.Fatalf("%s: %d %s", tc.in, w.Code, w.Body)
		}
		found := false
		for _, en := range st.Top() {
			if en.Name == tc.want {
				found = true
			}
		}
		if !found {
			t.Errorf("name %q not stored; table %v", tc.want, st.Top())
		}
	}
}

func TestRateLimit(t *testing.T) {
	h, c, _ := newHandler(t)
	body := `{"name":"a","level":1,"score":1}`
	if w := do(h, "POST", body, nil); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := do(h, "POST", body, nil); w.Code != 429 {
		t.Fatalf("second post %d, want 429", w.Code)
	}
	if w := do(h, "POST", body, map[string]string{"X-Forwarded-For": "9.9.9.9"}); w.Code != 200 {
		t.Fatalf("other IP %d, want 200", w.Code)
	}
	// first hop of X-Forwarded-For is the key
	if w := do(h, "POST", body, map[string]string{"X-Forwarded-For": "9.9.9.9, 1.1.1.1"}); w.Code != 429 {
		t.Fatalf("same XFF first hop %d, want 429", w.Code)
	}
	c.t = c.t.Add(5 * time.Second)
	if w := do(h, "POST", body, nil); w.Code != 200 {
		t.Fatalf("after 5s %d, want 200", w.Code)
	}
	// a rejected (invalid) post must not be able to lock out later valid ones forever, and GET is never limited
	for i := 0; i < 3; i++ {
		if w := do(h, "GET", "", nil); w.Code != 200 {
			t.Fatal("GET limited")
		}
	}
}

func TestCORS(t *testing.T) {
	h, _, _ := newHandler(t)
	allowed := map[string]string{"Origin": "http://localhost:3000"}
	for _, m := range []string{"GET", "OPTIONS"} {
		w := do(h, m, "", allowed)
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
			t.Errorf("%s: allow-origin %q", m, got)
		}
	}
	if w := do(h, "OPTIONS", "", allowed); w.Code != 204 || !strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), "POST") {
		t.Errorf("preflight %d %v", w.Code, w.Header())
	}
	w := do(h, "POST", `{"name":"a","level":1,"score":1}`, map[string]string{"Origin": "https://evil.example", "Content-Type": "application/json"})
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("evil origin allowed: %q", got)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h, _, _ := newHandler(t)
	if w := do(h, "PUT", "{}", nil); w.Code != 405 {
		t.Fatalf("%d", w.Code)
	}
}

# High-score table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single-player gets 3 lives (+1 per cleared level), a pod-rescue score bonus, and a world-wide top-10 table on the Go server that the game works fine without.

**Architecture:** A mutex-guarded, atomically-persisted JSON store plus `GET/POST /scores` in the Go server (`server/game`). Client-side run logic (`run.js`) and network/storage helpers (`scores.js`) are pure modules unit-tested with `node --test`; `sp.js`/`hud.js`/`index.html` wire them in. `shared/sim/*` and `server/game/world.go` are NOT touched.

**Tech Stack:** Go 1.27 (stdlib only, `net/http`, `httptest`, `-race`), vanilla ES modules, `node --test` (Node ≥ 22), Playwright MCP for the manual check.

**Spec:** `docs/superpowers/specs/2026-11-21-highscores-design.md`

## Global Constraints

- Lives: start **3**; **+1** per cleared level, **no cap**; losing a life = player death or level failed (all pods lost).
- Pod bonus on level clear: `500 × pods alive × level number`. Kill points unchanged.
- Ranking: `level` desc, then `score` desc, then earlier `at` first. Keep **top 10** only.
- Validation (400): body ≤ **1 KB**; `level` int **1–999**; `score` int **0–10 000 000**; name trimmed, control chars removed, whitespace collapsed, **1–16 runes**.
- Rate limit: **1 POST / 5 s / IP** (first `X-Forwarded-For` hop, else `RemoteAddr` host) → **429**.
- Persistence: write `<path>.tmp` then `rename` over `<path>`, under the lock; write failure → 500 and in-memory table rolled back. Missing/corrupt file → empty table, logged.
- Client network calls: **~3 s** `AbortController` timeout; resolve `null` on **any** failure, never throw. `localStorage` access always in try/catch.
- Remembered name saved only after a **successful** submit; empty field → remembered name → `"Pilot"`.
- No new dependencies. `server/web/assets/` is regenerated with `make web` (in `server/`), never hand-edited.
- Existing `go test ./...` (incl. golden parity) must still pass.

## Review Focus

- Concurrent POSTs from many clients → table stays consistent, file stays valid JSON (Task 1, `-race`).
- Name that is only whitespace/control chars, or emoji/multibyte near the 16-rune limit → 400 / truncated by runes, not bytes (Task 2).
- Server unreachable, returns HTML (e.g. SPA fallback/proxy error page), or hangs → game over still completes, no unhandled rejection (Task 4).
- `localStorage` throwing (private mode) → game still works, name just isn't remembered (Task 4).
- Typing a name containing game keys (WASD, P, M, digits) must not trigger game actions; ESC skips; page refocus after submit (Task 5, manual check).

---

### Task 1: Score store (ranking + atomic persistence)

**Files:**
- Create: `server/game/scores.go`
- Test: `server/game/scores_test.go`

**Interfaces:**
- Produces:
  ```go
  type Entry struct {
      Name  string    `json:"name"`
      Level int       `json:"level"`
      Score int       `json:"score"`
      At    time.Time `json:"at"`
  }
  type ScoreStore struct{ /* mu, path, entries */ }
  func OpenScoreStore(path string) *ScoreStore            // missing/corrupt file => empty, logs
  func (s *ScoreStore) Top() []Entry                      // copy, sorted, ≤10
  func (s *ScoreStore) Submit(e Entry) (rank int, err error) // rank is 1-based; 0 = not in top 10; err = persist failure (state rolled back)
  const MaxScores = 10
  ```

- [ ] **Step 1: Write failing tests** in `scores_test.go` (use `t.TempDir()` paths): `TestRankingOrder` (higher level beats higher score; same level → higher score; same level+score → earlier `At` first), `TestTruncatesToTen` (submit 15 → `Top()` len 10, lowest dropped, `Submit` of a too-low entry returns rank 0), `TestPersistRoundTrip` (submit, `OpenScoreStore` same path → same `Top()`), `TestCorruptFileStartsEmpty` (file contains `not json` → empty, `Submit` works), `TestNoTmpLeftBehind` (no `*.tmp` in dir after submit), `TestPersistFailureRollsBack` (path inside a nonexistent directory → `Submit` returns err and `Top()` is still empty), `TestConcurrentSubmit` (50 goroutines × distinct entries via `sync.WaitGroup`; afterwards `Top()` len 10, sorted, and re-opening the file yields identical contents).
- [ ] **Step 2: Run** `cd server && go test ./game -run 'Test(Ranking|Truncates|Persist|Corrupt|NoTmp|Concurrent)' -race` → FAIL (undefined).
- [ ] **Step 3: Implement** `scores.go` per the Interfaces block. `Submit` copies the slice, inserts, `sort.SliceStable` with the Global-Constraints order, truncates to `MaxScores`, writes JSON to `path+".tmp"` then `os.Rename`; on error leave `s.entries` unchanged. Rank = index+1 of the inserted entry (matched by pointer-free identity, e.g. name+level+score+At) or 0 if truncated away.
- [ ] **Step 4: Run** same command with `-race` → PASS.
- [ ] **Step 5: Commit** `git add server/game/scores.go server/game/scores_test.go && git commit -m "scores: ranked, atomically persisted top-10 store"`

### Task 2: HTTP handler, validation, rate limit, wiring, deploy

**Files:**
- Modify: `server/game/scores.go` (add handler), `server/cmd/netwars-server/main.go`, `server/deploy/netwars-server.service`, `server/deploy/README.md`
- Test: `server/game/scores_http_test.go`

**Interfaces:**
- Consumes: `ScoreStore`, `Entry`, `MaxScores`, `AllowedOrigins` (Task 1 / `serve.go`).
- Produces:
  ```go
  func ScoresHandler(s *ScoreStore) http.HandlerFunc
  // GET  → 200 []Entry (JSON array, [] never null)
  // POST {"name","level","score"} → 200 {"rank": int|null, "table": []Entry}
  // OPTIONS → 204 with CORS headers; CORS allow-origin echoes request Origin only if it matches AllowedOrigins (same host[:port] glob logic: "*" wildcard)
  ```
  Rate limiter is internal to the handler (map[ip]time, pruned of entries older than 5 s on each request) and clock-injectable for tests (unexported `now func() time.Time` field via a `scoresHandler` struct, with `ScoresHandler` as the production constructor).

- [ ] **Step 1: Write failing tests** with `httptest` against the handler and a temp store: `TestGetEmptyIsArray` (body is `[]`), `TestPostReturnsRankAndTable`, `TestValidation` table-driven → 400 for: body > 1 KB, malformed JSON, level 0 / 1000 / 1.5, score −1 / 10 000 001, name `""`, name `"  \t\n"`, name of control chars only; and OK cases: name with ctrl chars stripped (`"A\x00B"` → `"AB"`), name collapsed (`"a   b"` → `"a b"`), 20-rune multibyte name `"ž"×20` truncated to 16 **runes**. `TestRateLimit` (2nd POST same IP within 5 s → 429; after advancing injected clock 5 s → 200; different IP via `X-Forwarded-For` unaffected; `X-Forwarded-For: a, b` uses `a`). `TestCORS` (allowed Origin gets header on GET/POST/OPTIONS; disallowed origin gets none). `TestMethodNotAllowed` (PUT → 405).
- [ ] **Step 2: Run** `cd server && go test ./game -run 'Test(Get|Post|Validation|RateLimit|CORS|MethodNot)' -race` → FAIL.
- [ ] **Step 3: Implement** `ScoresHandler` per Interfaces and Global Constraints (`http.MaxBytesReader` 1 KB, `json.Decoder` without `DisallowUnknownFields`, sanitize name with `unicode.IsControl` / `strings.Fields`, rune-wise truncate, server sets `At = now()`). Write failure from `Submit` → 500 `{"error":"..."}`.
- [ ] **Step 4: Wire** in `main.go`: flag `-scores` (default `scores.json`), `store := game.OpenScoreStore(*scores)`, `mux.HandleFunc("/scores", game.ScoresHandler(store))` registered before the `/` file server. In `netwars-server.service` add `StateDirectory=netwars` and `ExecStart=… -scores /var/lib/netwars/scores.json`; add a short "Scores file" note to `deploy/README.md` (path, safe to delete to reset).
- [ ] **Step 5: Run** `cd server && go vet ./... && go test ./... -race` → all PASS (golden tests included). Smoke: `go run ./cmd/netwars-server -addr 127.0.0.1:18080 -scores $CLAUDE_JOB_DIR/tmp/s.json &` then `curl -s -XPOST -d '{"name":"x","level":2,"score":900}' 127.0.0.1:18080/scores` returns rank 1; stop the server.
- [ ] **Step 6: Commit** `git add server && git commit -m "scores: /scores endpoint with validation, rate limit, CORS; deploy config"`

### Task 3: Run state (lives + pod bonus)

**Files:**
- Create: `client/run.js`
- Test: `client/run.test.mjs`

**Interfaces:**
- Produces:
  ```js
  export const LIVES = 3, POD_BONUS = 500;
  export class Run {
    lives;                       // starts LIVES
    bonusScore;                  // sum of pod bonuses only (kills live in world.score)
    levelCleared(level, podsAlive) // bonusScore += POD_BONUS*level*podsAlive; lives += 1; returns the bonus awarded
    loseLife()                   // lives -= 1 (never below 0)
    get isOver()                 // lives === 0
  }
  ```
  Total displayed/submitted score = `world.score + run.bonusScore` (decided in Task 5; `world.score` is not mutated — sim untouched).

- [ ] **Step 1: Write failing tests** (`node:test` + `node:assert/strict`, import `./run.js`): new Run has `lives === 3`, `bonusScore === 0`, `isOver === false`; `levelCleared(3, 6)` returns `9000`, `bonusScore === 9000`, `lives === 4`; two clears accumulate; `levelCleared(1, 0)` returns 0 but still grants the life; three `loseLife()` from a fresh run → `isOver`; extra `loseLife()` keeps `lives === 0`; no cap (10 clears → 13 lives).
- [ ] **Step 2: Run** `node --test client/run.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** `client/run.js` per Interfaces (no DOM/THREE imports).
- [ ] **Step 4: Run** same → PASS.
- [ ] **Step 5: Commit** `git add client/run.js client/run.test.mjs && git commit -m "client: Run state — lives, pod bonus"`

### Task 4: Scores client (network + remembered name)

**Files:**
- Create: `client/scores.js`
- Test: `client/scores.test.mjs`

**Interfaces:**
- Produces:
  ```js
  export const NAME_KEY = 'netwars.playerName';
  export function loadName(storage = globalThis.localStorage): string   // '' if unset or storage throws
  export function saveName(name, storage = globalThis.localStorage): void // swallows errors
  export function scoresUrl(serverId, loc = globalThis.location): string // serverId ? `${proto}//${serverId}/scores` : '/scores'
  export async function fetchScores(url, fetchFn = globalThis.fetch, timeoutMs = 3000): Promise<Entry[] | null>
  export async function submitScore(url, {name, level, score}, fetchFn = globalThis.fetch, timeoutMs = 3000): Promise<{rank: number|null, table: Entry[]} | null>
  ```
  (`Entry` = `{name, level, score, at}`.) Both fetch helpers return `null` on network error, non-2xx, abort/timeout, non-JSON body, or JSON of the wrong shape (array / `{table: array}`).

- [ ] **Step 1: Write failing tests** with injected fakes: `loadName`/`saveName` round trip with a Map-backed storage; throwing `getItem`/`setItem` → `''` / no throw; `fetchScores` happy path; returns `null` for: rejected fetch, `ok:false`, `json()` rejecting (HTML body), `json()` returning `{}`; a fetch that never resolves + `timeoutMs=20` → `null` within ~100 ms (fake honours `signal`); `submitScore` posts JSON with `Content-Type: application/json` and the exact body, returns parsed `{rank, table}`; 429 → `null`.
- [ ] **Step 2: Run** `node --test client/scores.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `client/scores.js` per Interfaces (one shared internal `request()` wrapping `AbortController` + `setTimeout`, always `clearTimeout`).
- [ ] **Step 4: Run** `node --test client/` → both test files PASS.
- [ ] **Step 5: Commit** `git add client/scores.js client/scores.test.mjs && git commit -m "client: scores network/storage helpers (never throw)"`

### Task 5: Single-player integration (lives, game over, name prompt, table)

**Files:**
- Modify: `client/sp.js`, `client/hud.js`, `index.html`; regenerate `server/web/assets/` via `make -C server web`
- Test: manual browser check (below) — DOM/THREE wiring isn't unit-tested; logic already is (Tasks 3–4).

**Interfaces:**
- Consumes: `Run`, `LIVES` (Task 3); `loadName`, `saveName`, `scoresUrl`, `fetchScores`, `submitScore` (Task 4); existing `world`, `player`, `hud`, `startLevel(n)`, `handleWorldEvent`, the `level` event handling in `frame()`, `deadAt` / respawn key handler.
- Produces (in `hud.js`): `hud.setLives(n)`; `hud.showGameOver({level, score, canSubmit, defaultName})`; `hud.showTable(entries, {highlightRank, recorded})`; `hud.hideGameOver()`. Overlay markup in `index.html` (`#gameover` with `#go-sub`, `#go-name` input maxlength 16, `#go-table`, hint line), styled like `#dead` (non-pointer-blocking except the input).

- [ ] **Step 1: HUD + markup.** Add a `Lives n` line in the top-right block next to Score; add the `#gameover` overlay and CSS; implement the four `hud.*` methods. Total score shown = `world.score + run.bonusScore`.
- [ ] **Step 2: Lives and bonus in `sp.js`.** Create `const run = new Run()`. On the existing player-death transition (`wasAlive && !player.alive`) call `run.loseLife()`; when `levelAction` flash indicates level lost (`fsm.state === 'lost'` transition — detect via the `'ALL PODS LOST'` action / `world.fsm.state` becoming `'lost'`, once per loss) call `run.loseLife()`; when the FSM becomes `'won'` call `run.levelCleared(level, world.pods alive count)` once and flash `+N PODS · +1 LIFE`. Update `hud.setLives` each frame.
- [ ] **Step 3: Game over flow.** When `run.isOver` (after the life was taken): freeze input handling for the existing respawn-on-keypress path, probe `fetchScores(url)`. If non-null → `hud.showGameOver({canSubmit:true, defaultName: loadName()})`; ENTER submits `name || loadName() || 'Pilot'` via `submitScore`; on a non-null result `saveName(name)` and `hud.showTable(res.table, {highlightRank: res.rank, recorded:true})`; on null show the score with `(not recorded)`. If the probe is null → `hud.showGameOver({canSubmit:false})` ("GAME OVER — press any key"), no input, no table. ESC (or any key when `canSubmit:false`) skips. While `#go-name` is focused, `keydown` handlers in `sp.js` and `input.js` must early-return (check `document.activeElement`). After the table, any key starts a fresh run: `run = new Run()`, `world.score = 0`, `player.respawn()`/reset, `startLevel(1)`, `hud.hideGameOver()`.
- [ ] **Step 4: Sync assets and run all automated tests.** `make -C server web && cd server && go vet ./... && go test ./... -race && cd .. && node --test client/` → all PASS.
- [ ] **Step 5: Browser check (Playwright MCP)** against `go run ./cmd/netwars-server -addr 127.0.0.1:18080 -scores $CLAUDE_JOB_DIR/tmp/s.json`: (a) HUD shows Lives 3; clearing a level (use `window.__nw` to kill enemies / set state) shows pod bonus + Lives 4; (b) lose all lives → overlay with empty name, type `Ace`, ENTER → table with highlighted row; reload, play to game over again → field pre-filled `Ace`, bare ENTER submits it; (c) typing `wasd` in the field doesn't move the ship; (d) stop the server, play to game over → "GAME OVER — press any key", no prompt, no console errors, new run starts; (e) check the browser console for uncaught errors in all cases. Record results.
- [ ] **Step 6: Commit** `git add client index.html server/web && git commit -m "single-player: lives, pod bonus, game over + high-score table"`

### Task 6: Docs

**Files:**
- Modify: `README.md` (controls/HUD section near lines 61–65), `SPEC.md` (a short "High scores" subsection beside the existing death/score text near lines 53/162)

- [ ] **Step 1:** Document lives, pod bonus, the `/scores` endpoint, offline behaviour, and the remembered-name key. Keep it to a short paragraph each.
- [ ] **Step 2: Commit** `git add README.md SPEC.md && git commit -m "docs: high scores"`

---

## Self-review

- **Spec coverage:** lives / +1 per clear / no cap → T3, T5; pod bonus → T3, T5; ranking/top-10/atomic/concurrency → T1; validation, rate limit, CORS, wiring, deploy path → T2; offline stand-alone, name memory, prompt → T4, T5; tests (Go, node, browser) → T1–T5; docs → T6. Sim untouched → Global Constraints.
- **Type consistency:** `Entry`, `ScoreStore.Submit/Top`, `ScoresHandler`, `Run.levelCleared/loseLife/isOver`, `fetchScores/submitScore/scoresUrl/loadName/saveName`, `hud.showGameOver/showTable/setLives/hideGameOver` used identically in every task that references them.
- **Known risk:** Task 5 hooks into `sp.js` internals (level FSM transitions, death transition) described by symbol, not line number — the implementer must read those spots first; "once per loss/win" guards are required because the FSM stays in `won`/`lost` for several frames.

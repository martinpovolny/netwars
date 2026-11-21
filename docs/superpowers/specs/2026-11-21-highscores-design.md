# High-score table (single-player) — design

Status: draft for approval · 2026-11-21

## Intent

Give single-player a goal beyond "survive": a run ends, the player enters a
name, and a world-wide top 10 shows how they did. The table lives on the
existing Go server. The game must stay fully stand-alone: no server, no
problem — it just doesn't log or show anything.

## Goals

- A run has an end: **3 lives**. Dying costs a life (respawn in place, as
  today). A failed level (all pods lost) also costs a life and retries the
  level. **Clearing a level awards +1 life** (no cap). Out of lives → game
  over.
- **Score**: existing kill points (unchanged) **plus** a level-clear bonus of
  `500 × pods alive × level number`. (Kills are 100–500, so pods dominate.)
- On game over: name prompt (pre-filled from `localStorage`, editable, ENTER
  submits), then the top-10 table with the player's row highlighted.
- Ranking: **level reached desc, then score desc**, then earlier submission
  wins ties. Server keeps only the top 10.
- Remembered name: after a successful name entry, store it in
  `localStorage` so next time ENTER alone submits it.

## Non-goals / anti-goals

- No real anti-cheat (replay/sim validation). Sanity checks only; this is a
  trust-based table. Anyone who can POST can post.
- No accounts, no per-player history, no co-op / deathmatch tables.
- The game must never block, delay, or error visibly because the backend is
  down. A dead backend is a normal state, not a failure.
- No change to `shared/sim/*` or `server/game/world.go` — the sim stays
  byte-parity-tested between JS and Go.

## Approaches considered

| | Trade-off |
|---|---|
| **A. Pod bonus + lives in the shared sim** (JS + Go port) | Identical scoring in co-op, but touches the parity-tested sim, needs a Go port and regenerated golden fixtures — for a table only single-player uses. |
| **B. Pod bonus + lives in the single-player client** ✅ chosen | Sim and co-op untouched; golden tests unaffected. Co-op simply doesn't get the pod bonus. |

Storage: JSON file with atomic write (chosen) vs SQLite (extra dependency for
10 rows — rejected).

## Design

### Server (Go, `server/game/scores.go` + wiring in `cmd/netwars-server/main.go`)

- `GET /scores` → `200 [{"name","level","score","at"}…]`, sorted, max 10.
- `POST /scores` body `{"name","level","score"}` →
  `200 {"rank": n|null, "table":[…]}` (`rank` null = didn't make the top 10).
  The response carries the fresh table so the client needs one round trip.
- **Store**: in-memory slice guarded by a `sync.Mutex`; loaded from a JSON
  file at start (missing/corrupt file → empty table, logged, not fatal).
  Each accepted submit: insert, sort, truncate to 10, write
  `scores.json.tmp` then `rename` over `scores.json` (atomic), all under the
  lock so concurrent submits can't interleave or clobber. Write failure →
  500 and the in-memory table is rolled back (memory never disagrees with
  disk).
- File path: flag `-scores` (default `scores.json` in the working dir;
  systemd unit gets a `StateDirectory`-based path — see deploy README
  update).
- **Validation** (reject with 400): body ≤ 1 KB; `level` int 1–999; `score`
  int 0–10 000 000; name trimmed, control chars removed, whitespace
  collapsed, 1–16 runes (empty after cleanup → 400). Unknown JSON fields
  ignored.
- **Rate limit**: per client IP (`X-Forwarded-For` first hop, since Caddy
  fronts it, else RemoteAddr), max 1 POST per 5 s; excess → 429. Map is
  pruned so it can't grow unbounded.
- **CORS**: reuse `game.AllowedOrigins` so the client served from another
  origin (e.g. GitHub Pages) can reach `/scores`; `OPTIONS` preflight
  handled.

### Client

- `client/run.js` (pure, no DOM/THREE → unit-testable): `Run` object —
  `lives`, `levelCleared(level, podsAlive)` (adds the pod bonus **and** +1
  life), `loseLife()`, `isOver`,
  `summary()` → `{level, score}`. Constants `LIVES = 3`,
  `POD_BONUS = 500`.
- `client/scores.js` (testable with injected `fetch`/`storage`):
  `loadName()/saveName()` (try/catch around `localStorage`),
  `fetchScores()`, `submitScore()`. Both network calls use
  `AbortController` with a ~3 s timeout and **resolve to `null` on any
  failure** — never throw.
- `client/sp.js` integration: score gets the pod bonus on the level
  "cleared" event; death and pod-loss call `loseLife()`; HUD shows
  `Lives n`. At `isOver`, show the game-over overlay (new markup in
  `index.html` + `hud.js`): "GAME OVER — Level L, Score S", name input,
  ENTER to submit. On submit → table with player's row highlighted, any key
  → fresh run (lives/score/level reset).
  - Backend unreachable: on game over, a quick `GET /scores` probe decides
    whether the name field + table appear; if it fails the overlay is just
    "GAME OVER … press any key" (no name prompt, no table). If the probe
    succeeds but the POST later fails, show the score with "(not
    recorded)".
  - Name field must swallow game keys while focused (WASD etc.) and ESC
    skips submitting.
- API base: same origin by default; if the page was launched with a server
  id (existing `serverId` mechanism in `net.js`), use that host.
- Name remembered only after a *successful* submit; field pre-filled from
  it; empty field falls back to the remembered name; if neither, "Pilot".
- Level/score of a run is read from the single-player world (`world.score`,
  current level).

### Not duplicated

`server/web/assets/` is a generated copy of the client (`make web`); we
re-sync it, not hand-edit it.

## Tests

- **Go** (`server/game/scores_test.go`, `httptest`): ranking order (level →
  score → earlier), truncation to 10, validation table (bad name/level/
  score/oversize), rate limit 429, persistence round-trip (restart reads the
  file), corrupt file → empty, atomicity (no `.tmp` left; failed write rolls
  back), **concurrent POSTs under `-race`** (N goroutines → table
  consistent, valid JSON on disk).
- **JS** (`node --test`, `client/run.test.js`, `client/scores.test.js`):
  pod bonus math, +1 life per cleared level, lives → game over, run reset, `loadName/saveName` incl.
  throwing storage, fetch wrapper returns `null` on network error / non-200 /
  timeout / bad JSON.
- **Manual/browser check** (Playwright): play to game over against the real
  server; verify prompt prefill, ENTER submit, table; then stop the server
  and verify the game still reaches game over cleanly with no prompt.
- Existing `go test ./...` (incl. golden parity) must still pass untouched.

## Left to the builder

Overlay styling (match `#dead`), exact HUD placement of lives, wording of
messages, ordering of JSON keys, how `make web` / deploy README mention the
scores file location.

## My calls (not discussed — please check)

- Lives = 3; failed level costs a life. (Confirmed by the user: start with 3,
  +1 per cleared level, no cap.)
- Rate limit 1 POST / 5 s / IP; score cap 10 M; name ≤ 16 runes (matches
  the existing `f-name` maxlength).
- Probe-on-game-over (rather than at page load) decides whether the
  prompt/table show.
- Ties on level+score → earlier submission ranks higher.

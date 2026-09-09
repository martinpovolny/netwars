# NETWARS — build plan (living doc)

Working checklist for the shared-core split + online multiplayer. Tick items as
they land; amend freely. Design reference is `SPEC.md`; this file is the *path*.

**Status:** M0 + M1 merged & deployed to `www.hmpf.cz/netwars/`. Follow-ups
also in: mote polish, real HYG star catalogue, leading enemy fire.
**M2 (Go server, co-op) in progress — `m2-world` branch. M2.1–M2.4 + M2.7
done: `stepWorld` consolidated + parity-verified; `shared/sim` ported to Go
(golden parity green); ws transport + arena loop **deployed live** at
`netwars.hmpf.cz` (binary serves the game on `/` too). M2.5 next — real
`client/net.js`. M2.6 — N-ship authority. M2.8 — 2-player co-op test.**

---

## Decisions (locked)

- **Hybrid-authoritative** MP: server owns the shared world (enemies, pods,
  bonuses, level FSM, damage, score) + validates hit claims; each client
  predicts its own ship and interpolates everyone else.
- **Co-op first**, deathmatch second. `#<session>?server_id=<host>&mode=coop|dm`.
- **Refactor lands before server code**, single-player playing identically.
- TLS via **Caddy reverse proxy** (`netwars.hmpf.cz` → `localhost:PORT`); the Go
  binary speaks plain `ws://`.
- **3-layer environment**: fixed star background, near-field motes, speed-faded
  grid.
- One tuning source: `shared/constants.json` (JS `import … with {type:'json'}`,
  Go `go:embed`).

---

## M0 — extract `shared/`, split `client/`  (behaviour-neutral)

Each slice: committed + verified in-browser (SP plays identically) before the next.

- [x] **M0.1** `shared/constants.json` + `shared/constants.js` — all enemy-type
      factors + level tables; derives `ENEMY_TYPES` / `goalsForLevel`.
      `src/levels.js` is a thin re-export.  *(89e34fa)*
- [x] **M0.2** `shared/sim/vec.js` (THREE math re-export) + `shared/sim/flight.js`
      `stepShip(ship, control, dt, K.player)`. `player.js` builds a `control`
      struct from `Input` and delegates the movement block; intent-marker
      easing + fire logic stay in `player.js`. Parity-verified vs. the old
      math: 400-step varied control script, pos/vel/quat deltas exactly 0.
- [x] **M0.3** `shared/sim/ai.js` — `stepEnemy(e, ctx, dt)` covering
      brawler / strafer / sniper / charger / thief + `fly`/`tryFire` helpers.
      `enemies.js` `Enemy` = state + mesh + hull-flash, delegates the step;
      `Enemies` keeps spawn/quota/leash/ram/pod-strikes (now K.enemy). AI
      tactical literals stay in ai.js (ported with the Go twin, golden-vector
      test guards them). Parity-verified vs. the old code for all 5 behaviours
      over 200 seeded steps: pos/vel deltas 0, quat ~1e-8 (angleTo rounding).
- [x] **M0.4** `shared/sim/weapons.js` — `class Projectiles` (pooled state) +
      `step(dt, world, K)` doing motion, missile self-propel + guidance, and
      collisions; applies hp/dead/ttl outcomes and returns events
      (`enemyHit`/`enemyKill`/`missileBurst`/`playerHit`/`podHit`/`podKill`).
      `src/weapons.js` wraps the pool, maps events → `explosions.*`/`audio.*`/
      `onKill('podlost')`, and keeps all the bolt/missile/trail meshes.
      Parity-verified: positions, hp, dead flags, FX counts, podlost all
      identical after 180 steps (a lone `audio.hit` diff was a test-stub
      artifact — real `player.damage` still triggers it via the `!absorbed`
      event). 0 console errors.
- [x] **M0.5** `shared/sim/rules.js` — `spawnPods`/`stepPods`/`recentrePods`
      (drift when uncaptured, cull → `lost`, recentre) and
      `makeBonuses`/`stepBonuses`/`bonusHitByShot` (spawn cadence + need-bias,
      drift, life, fly-in *or* shot collect). `src/pods.js` + `src/bonuses.js`
      wrap the sim and keep one THREE mesh per entity (tumble / pulse / rings).
      `spin` and `_t` carried on the state so RNG order matches exactly.
      Parity-verified: pods 240 steps (drift + kills + capture) → centroid &
      all positions identical; bonuses spawn + fly-in collect + shot collect →
      identical events & residual state. Level win/lose FSM stays in the loop
      until M0.6's `stepWorld`.
- [x] **M0.6** `src/` → `client/`; `client/sp.js` (was `main.js` — the local
      loop), `client/net.js` (stub: logs + falls back to sp), `client/main.js`
      (parses `#<session>?server_id=&mode=` → net.js, else sp.js). Level
      win/lose FSM extracted to `shared/sim/rules.js`
      (`makeLevelFSM`/`stepLevelFSM`, `dt=0` to pause). `index.html` →
      `client/main.js`. README/SPEC layout updated. Each entity module stayed
      a thin render wrapper (kept per-file, not a single `entities.js` — same
      effect, smaller diff). FSM verified: pods-lost → "LEVEL FAILED" → 3 s →
      restart same level, pods refill; network URL → warn + SP fallback.
      0 console errors.
- [x] **M0 verify** — `node --check` all 23 modules; browser: 0 console
      errors, HUD/tripod/scanner/pods/enemies render as before, level FSM
      cycles (forced pods-loss → "LEVEL FAILED" → 3 s → same level restarts,
      pods refill), network-mode URL falls back to SP cleanly.
      **Production deploy to `www.hmpf.cz/netwars/` waits for the PR merge**
      (per "refactor lands as its own PR first"); deploy then copies
      `index.html` + `client/` + `shared/` and drops `src/`.
- note: the pure `World` + `stepWorld(world, controls, dt)` consolidation is
  deferred to the **start of M2** — it's the natural first step of the Go port.

## M1 — 3-layer environment

- [x] **M1** `starfield.js` → `client/render/environment.js`:
      (1) fixed star sphere — 3000 dim + 700 bright non-attenuated points on a
      20k shell, 3 additive nebula sprites; group `.position.copy(camera)` each
      frame, nothing else; all `fog:false`. (2) 400 motes in an 800u box around
      the eye, wrapped, drawn as faint (`opacity 0.35`) `LineSegments` streaks
      `head → head − vel·k` (capped at 60u; collapse to nothing at rest).
      (3) `GridHelper` opacity
      `gridOpacityMax · max(0, 1 − speed/gridFadeSpeed)`, hidden past the fade.
      All params in `shared/constants.json` `env`. sp.js calls
      `environment.update(player, camera)` *after* the camera is placed.
      README / SPEC updated.

## M2 — Go server + `net.js`, co-op

**Hard constraint (every slice):** the no-hash SP experience
(`client/main.js` → `sp.js`, no server) must keep playing byte-identically.
`net.js` is only imported when `location.hash` is present; a failed connect
falls back to `sp.js`. Each slice: committed + SP re-verified before the next.

**No Node in the loop.** Toolchain is Go + the browser only. The one place
that wanted a JS runtime — generating the golden reference vector — is done
by a one-off browser page (`tools/golden.html`) that dumps
`server/testdata/golden.json`; it's committed, and `go test` / CI just read
the file. Regenerate it (open the page, save) only when `shared/sim`
changes on purpose — that's also when the Go port must be re-synced, which
the now-failing Go test flags. (`tools/build-stars.mjs` stays a rare
manual one-off; not part of build or CI.)

- [x] **M2.1** shared world tick. *(m2-world: 5e4fb6f, fb63ae4)*
      - **M2.1a** threaded `rng` through `rules.js` (spawnPods/makeBonuses/
        stepBonuses) + `ai.js` (`ctx.rng`), default `Math.random`;
        `randomDir` mirrors THREE.randomDirection draw-for-draw. Parity vs
        origin/main: spawnPods / stepBonuses×1200 / stepEnemy×400 all Δ 0.
      - **M2.1b** `shared/sim/enemies.js` (pure fleet: makeEnemyState,
        makeFleet/startFleetLevel/stepFleet, checkRam/checkPodStrikes) +
        `shared/sim/world.js` (`makeWorld` / `startWorldLevel` /
        `stepWorld(world, dt) → events[]`, order = fleet → pods → bonuses →
        ram → pod-strike → projectiles → FSM; `world.fx` optional client
        side-channel). `client/enemies|pods|bonuses|weapons.js` → pure
        diff-render wrappers (`attach()` + mesh sync only). `sp.js` swaps
        its sim+FSM block for one `stepWorld` call + `handleWorldEvent`;
        ship stays client-predicted (`player.update`/`stepShip`).
        **Parity:** headless A/B (old sp.js orchestration vs stepWorld,
        seeded LCG, 9000 ticks / 150 s incl. a level-lost restart) →
        WORST Δ 0. Browser: 60 fps, 0 errors, restart + mesh diff-render
        (6/6 pods, 4/4 enemies) clean.
- [x] **M2.2** *(m2-world: 0d250bb)* `tools/golden.html` runs `stepWorld` 600
      ticks off `makeRng('golden')` (scripted Lissajous ship + fixed cannon
      cadence), snapshots every tick → `server/game/testdata/golden.json`
      (committed, 1.7 MB). Go module `server/`: `game/rng.go` (xorshift128
      twin — `rng_test.go` asserts the exact first-8 u32 for seed "golden"
      from JS, **passes**), `game/constants.go` (`//go:embed constants.json`
      copy + `GoalsForLevel`; server prints `map[pirate:3 raider:1]`,
      matches), `game/world.go` stub (`StepWorld` panics until M2.3),
      `game/golden{,_test}.go` (loads + validates the vector; parity test
      skipped until M2.3), `cmd/netwars-server/main.go` (flags, embedded
      constants, SIGINT/TERM). `go vet && go build && go test ./...` green.
      No `coder/websocket` dep yet (M2.4). SP path untouched.
- [x] **M2.3** *(m2-world: a6d03d8)* Ported `shared/sim` → Go: `vec.go`
      (Vec3/Quat, faithful THREE ops), `rng.go` (+`RandomDir`), `rules.go`,
      `ai.go` (5 behaviours), `weapons.go` (`Projectiles.Step`),
      `enemies.go` (fleet + ordered goals + checkRam/checkPodStrikes),
      `world.go` (`StepWorld`). `constants.go` ordered-decodes `levels` /
      `levelsBeyond` (key order drives spawn pick). **`TestGoldenParity`
      replays seed "golden" through the Go `StepWorld` (same scripted ship +
      cannon cadence) and matches all 600 frames within 1e-4 — score, level,
      FSM, ship, every enemy / pod / bonus / live projectile. PASSES.**
      `go vet && go build && go test ./...` green. No client impact, no Node.
- [x] **M2.4** *(m2-world: 8b88f4f)* Transport + arena. `proto/` (hello /
      input / ping ↔ welcome / snapshot / event / pong / error, compact
      JSON). `game/flight.go` (`StepShip` twin). `game/session.go` (session_id
      → `*Arena`, drop when empty). `game/arena.go` (one goroutine: 60 Hz
      `StepShip`+`fireWeapons`+`StepWorld`, snapshot every 2nd tick ≈ 30 Hz,
      event batches as they happen). `game/snapshot.go`. `game/serve.go`
      (`HandleConn`: accept, hello handshake, read/write pumps).
      `cmd/netwars-server` now serves `/ws` + `/healthz` with graceful
      shutdown. `TestArenaEndToEnd` (real ws dial): welcome→snapshots, tick
      advances, ackSeq tracks input, fleet moves, cannon fire lands,
      ping↔pong, arena tears down on leave. `StepWorld` still targets one
      focus ship — N-ship authority is M2.6.
- [ ] **M2.5** `client/net.js` real impl (replaces the stub): parse
      `#session?server_id&mode`, open `wss://<server_id>/ws`, `hello` →
      `welcome` seeds a local `World`; each frame send `input` (seq+t) and
      predict own ship via `stepShip`; on `snapshot` push to a ~120 ms interp
      buffer, reconcile own ship to `ackSeq`, interpolate everyone else; on
      `event` play the same FX/HUD handlers SP uses. Connect failure →
      `import('./sp.js')`. SP path still never loads this file.
- [ ] **M2.6** Authority / co-op: arena holds N player ships, server
      integrates each from its inputs and owns all shared state; clients
      predict own + interpolate others; ≥ 2 humans share one pod defence,
      both scores count, one can die/respawn while the other plays on.
- [x] **M2.7** Deployed & live *(m2-world: …bde1050)*. `server/Makefile`
      (`web`, `build-remote` — auto-detects box arch via `uname -m`,
      `install-unit`, `deploy`, `logs`, `healthz`; ssh alias `vpn-ora-m`),
      hardened systemd unit (binary at `/usr/local/bin`, loopback:8080,
      `install -m 0755`), `Caddyfile.snippet` (`netwars.hmpf.cz` →
      `127.0.0.1:8080`, `encode zstd gzip`), `deploy/README.md`. Box = **x86-64**
      Oracle Cloud, static IP, Caddy on 80/443. **The binary also serves the
      whole game client on `/`** (`server/web/` — `//go:embed all:assets`, a
      committed copy of `index.html` + `client/` + `shared/` kept fresh by
      `make web`); `https://netwars.hmpf.cz/` is a standalone deploy, no
      GitHub Pages needed. Verified live: `wss://netwars.hmpf.cz/ws` → 101 →
      `welcome` + streaming snapshots with the AI fleet moving server-side.
- [ ] **M2.8 Verify**: `go test ./...` (golden-vector) green in CI; two local
      browser profiles co-op on `netwars.localhost` (Caddy internal CA); real
      2-person internet co-op with an RTT/jitter overlay. If a JS-only
      `shared/sim` change ever needs an *automatic* parity gate, add a
      Playwright CI step — deferred, heavier than the manual re-bless.

## M3 — deathmatch

- [ ] `&mode=dm`: no AI/pods; player↔player friendly fire, respawn timer, frag
      scoring, HUD scoreboard.

## M4+ — polish (ordered)

- [ ] Client `hit` claims + server lag-compensated rewind.
- [ ] Delta snapshots vs `ackSeq`; then binary/Float32 framing if profiling shows it.
- [ ] Reconnect: reload same `#session_id` within a grace window resumes your ship.
- [ ] Idle-arena teardown delay; per-process arena cap.
- [ ] Input rate-limit + value/timestamp sanity clamps.
- [ ] Server-side spectator feed for a dead player.

---

## Backlog (unscheduled)

- **Meteorites** — *in progress* (branch stacked after the star catalogue):
  solid tumbling rocks. `shared/sim/rocks.js` (seeded field, drift + tumble +
  wrap, collide vs player / enemies / projectiles) + `client/render/meteorites.js`;
  MP seeds the field from `session_id`. `rocks` block in `constants.json`.
- **Real star background** — *done* (`star-catalog` branch): HYG v41 reduced by
  `tools/build-stars.mjs` to `client/render/stars.json` (mag ≤ 6.5, ~8.9k stars),
  placed by RA/Dec, sized per magnitude bucket, tinted by B-V.
- **Nebulae / Milky Way** — the 3 procedural nebula blobs were dropped with the
  star-catalogue rewrite. Options to bring atmosphere back: (a) re-add a few dim
  additive blobs; (b) a faint procedural dust band along the real galactic
  plane (l/b → sphere, noise-modulated).
- **Constellation lines + labels** — for a dozen or so famous constellations,
  draw the figure lines between their catalogue stars (HYG has `bf`/`bayer`
  designations to match against a small hand-built line list) and float a name
  label. Toggleable; off by default. Data as `client/render/constellations.json`.

---

## Risks / watch-list

- **Sim parity JS↔Go** — keep `shared/sim` tiny & branch-light; matching seeded
  RNG; golden-vector test; port function-for-function.
- **Float/quaternion determinism** — same op order, compare with tolerance.
- **M0.6 diff-renderer** — dispose leaks / missed updates; watch `renderer.info`.
- **M0 discipline** — strictly behaviour-neutral, no drive-by tweaks.

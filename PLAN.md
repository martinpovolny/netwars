# NETWARS — build plan (living doc)

Working checklist for the shared-core split + online multiplayer. Tick items as
they land; amend freely. Design reference is `SPEC.md`; this file is the *path*.

**Status:** M0 in progress — `shared-core-split` branch.

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
- [ ] **M0 verify** — full manual play of levels 1–3 (flight feel, 5 AI
      behaviours, missile lock, bonuses, spectator death, scanner) unchanged;
      screenshot-compare vs live; deploy split build to Pages, stays green.
- note: the pure `World` + `stepWorld(world, controls, dt)` consolidation is
  deferred to the **start of M2** — it's the natural first step of the Go port.

## M1 — 3-layer environment

- [ ] **M1** replace `starfield.js` with `client/render/environment.js`:
      (1) fixed star sphere (follows camera *position* only, unfogged,
      procedural points + 2–3 nebula blobs); (2) ~400 near-field motes wrapped
      in an ~800u sphere, streak at speed; (3) y=0 grid, opacity faded by speed.
      Params in `shared/constants.json` (`env` block).

## M2 — Go server + `net.js`, co-op

- [ ] Go module `server/`: `cmd/netwars-server` (flags, `go:embed`
      constants.json, signals), `ws/conn.go` (github.com/coder/websocket,
      read/write pumps, JSON), `proto/`, `game/session.go` (session→arena
      registry), `game/arena.go` (60Hz tick, 25Hz snapshot, 1Hz ping goroutine),
      `game/sim.go` (function-for-function Go port of `shared/sim`),
      `game/snapshot.go`, `game/rng.go` (xorshift matching JS seed).
- [ ] Authority split: server sims enemies/pods/bonuses/level/damage/score,
      integrates player ships from client inputs; client predicts own ship,
      interpolates the rest.
- [ ] `client/net.js`: parse `#session?server_id&mode`, `wss://` via Caddy,
      `hello` / `input` / `snapshot` / `event`; interpolation buffer ~120ms;
      reconcile own ship to `ackSeq`.
- [ ] Deploy: linux binary + systemd unit; Caddyfile
      `netwars.hmpf.cz { reverse_proxy localhost:8080 }`; DNS.
- [ ] **Verify**: golden-vector JS↔Go parity test (600 ticks, tol 1e-4, in CI);
      two local browser profiles co-op; real 2-person internet co-op.

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

- **Meteorites** — slowly tumbling low-poly rocks. Decorative vs. solid
  (cover/hazard). If solid → `shared/sim/world.js` bodies +
  `client/render/ships.js#makeRock`; MP seeds the field from `session_id`.
- **Real star background** — swap procedural points for actual Earth-view
  constellations from a star catalog (HYG / Yale Bright Star Catalog):
  RA/Dec + magnitude → points on the sphere, brightness by magnitude; reduced
  dataset as `client/render/stars.json`.

---

## Risks / watch-list

- **Sim parity JS↔Go** — keep `shared/sim` tiny & branch-light; matching seeded
  RNG; golden-vector test; port function-for-function.
- **Float/quaternion determinism** — same op order, compare with tolerance.
- **M0.6 diff-renderer** — dispose leaks / missed updates; watch `renderer.info`.
- **M0 discipline** — strictly behaviour-neutral, no drive-by tweaks.

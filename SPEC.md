# NETWARS — Design Spec

A browser remake of **NetWars** (Novell, 1993): a first-person polygon space
shooter whose reason to exist was **networked multiplayer**. The original was an
IPX LAN game; ours is played over the **internet** against a single small
self-hosted **Go** server. This document is the reference for what we're
building and why. It describes the target; the code may lag it. Current values
in parentheses come from the phase-1 prototype and are tuning knobs, not
commitments.

**Status:** phase-1 single-player client is live at `https://www.hmpf.cz/netwars/`
(static files on GitHub Pages). Phase-2 is the Go server + client network mode.

---

## 1. Vision

- Recreate the *feel* of NetWars, then improve on it: floaty inertial flight,
  the deploy-a-marker-and-chase-it steering, the tilted-grid scanner that shows
  the third dimension as vertical stalks, the vector-polygon look.
- **Online multiplayer is the point.** One small Go server on a cheap box with
  a single open port; players open the web client and pick *network mode* to
  connect. Single-player vs AI is the foundation and the practice range; the
  same AI runs server-side as bots to fill multiplayer slots.
- Keep it frictionless: no install for players, no per-OS builds, no accounts.

## 2. Platform & tech

| Concern | Choice | Why |
|---|---|---|
| Client | HTML + ES modules + **Three.js core** from CDN, no build step | Zero install, instant iteration, shareable by link; flat-shaded / wireframe look is native to Three.js |
| Client hosting | **GitHub Pages** at `www.hmpf.cz/netwars/` (static `index.html` + `client/` + `shared/`) | already live; no build |
| Rendering | WebGL via Three.js; three viewports (main + orientation inset + scanner inset) | insets are separate scenes composited with scissor/viewport |
| Server (phase 2) | **Go**, single static binary, self-hosted on a small box, one open port | tiny footprint, easy deploy (`scp` one file + a systemd unit), goroutine-per-conn scales fine for a handful of arenas |
| Transport | **WebSocket over TLS (`wss://`)** | the client is served over HTTPS, so a plain `ws://` is blocked as mixed content — TLS is mandatory, not optional |
| TLS | Let's Encrypt via `golang.org/x/crypto/acme/autocert` on a subdomain (e.g. `netwars.hmpf.cz`), **or** a one-line Caddy reverse proxy in front | keeps it to one open port and no cert plumbing by hand |
| Audio | WebAudio blip synth, resumed on first gesture | no asset files |

Not chosen: Node server (Go is the pick), P2P / WebRTC data channels (needs
signaling + STUN/TURN; a single public server has no NAT problem to solve),
Godot / Unity, raw WebGL. Revisit WebRTC only if WSS jitter proves unplayable.

## 3. Core loop

1. Each level starts with a **cluster of pods** you must protect and a kill
   quota of enemies to destroy.
2. Fly (mouse steers via the intent marker; keyboard for thrust/reverse/guns).
3. Some enemies attack the pods, some hunt you, one type steals pods.
4. **Level won** when the kill quota is met *and* at least one pod survives →
   brief pause → next level. **Level lost** if every pod is destroyed or
   stolen → the level restarts.
5. Hull hits 0 → **the whole world freezes**, a SHIP DESTROYED panel shows
   (level + score); any key after ~0.7 s launches a fresh ship *in place*
   with ~2 s invulnerability. The level continues with the surviving pods.
6. The campaign is endless — levels past the hand-authored table are generated
   and keep escalating. (No hard win screen yet; see §18.)

## 4. Controls

The steering model is the distinctive part and must match NetWars:

- **Raw mouse cursor** — a tiny white rectangle. Moves 1:1 with the mouse,
  clamped to a box around center. Pointer-locked.
- **Deployed intent marker** — a **45° cross (X) with the centre missing**
  (four diagonal ticks). Chases the raw cursor with a short lag (first-order,
  `intentLag` ≈ 8 /s). This is "where you are telling the ship to point."
- **Heading indicator** — fixed at screen center: an **upright cross (+) with
  the centre missing** (four ticks pointing inward, gap in the middle), amber.
  The nose. In first person it's always center; it's the reference the intent
  marker is offset *from*. The two markers are deliberately different shapes
  (+ vs ×) so they never read as the same thing.
- The ship **yaws/pitches toward the intent marker** at a rate proportional to
  the marker's offset, capped at the ship's **Turn Factor** (`turnFactor` rad/s).
- The raw cursor eases back toward center slowly (`mouseRecenter` ≈ 0.35 /s) so
  the ship doesn't spin forever if you let go. *(Open question: keep this, or
  make centering fully manual like the original?)*

| Input | Action |
|---|---|
| Mouse | Move raw cursor → intent marker follows → ship turns toward it |
| Left click | Lock pointer (first click) / fire |
| `W` | Thrust forward (impulse while held) |
| `S` | Reverse thrust (impulse while held) |
| `C` | Brake — bleed speed along the facing axis |
| `X` | Full stop — null all momentum quickly |
| `A` / `D` | Roll left / right (`rollRate` ≈ 2.0 rad/s) |
| `Shift` | Extra thrust — shows `EXTRA THRUST` |
| `Space` | Fire cannon |
| `F` / RMB | Fire guided missile |
| `[` / `]` | Scanner zoom out / in (5 levels) |
| `H` | Flash the key list for ~4 s |
| any key | Respawn (while the SHIP DESTROYED panel is up) |

Later: gamepad, rebindable keys.

## 5. Flight model

**Newtonian, no throttle.** You point the nose and apply impulses; momentum
persists. This applies identically to the player *and* every enemy (see §9).

- `W` adds `thrustAccel` (240 u/s²) along +nose; `S` adds it along −nose
  (reverse). `Shift` multiplies by `boostMult` (2.4).
- `C` brake removes velocity along the facing axis (either direction) at
  `brakeAccel` (320 u/s²). `X` scales the whole velocity down fast.
- Ambient drag is almost nothing (`drag` 0.02) — drift stays until you brake.
  Speed capped at `maxSpeed` (620 u/s).
- Orientation is a quaternion composed in the ship's **local frame** each frame
  (`q = q · Δq`) — no gimbal lock, real roll.
- `Δq` = Euler(pitchRate·dt, yawRate·dt, rollFromKeys), with
  `yawRate = −intent.x · turnFactor`, `pitchRate = −intent.y · turnFactor`
  (`turnFactor` 1.9 rad/s for the player).
- Camera = ship transform exactly (true first person, no cockpit offset yet).

Shared enemy flight helper `_fly(dt, aimDir, {throttle, brake, brakeAll, …})`:
turn nose toward `aimDir` at the class Turn Factor, then thrust / brake. Enemy
`thrust` and `vmax` are derived from the class Speed Factor.

## 6. Weapons

Two player weapons:

**Cannon** (primary — `Space` / LMB) — **unlimited** dull ammo. Fired in pairs
from wing points, `gunInterval` ≈ 0.1 s. Muzzle 1500 u/s added to ship velocity.
No guidance. 8 dmg. Rendered as dim additive tracers (grey-cyan, small).

**Missile** (secondary — `F` / RMB) — **guided**, **one on screen at a time**,
**limited ammo** (`missiles` 16, no regen; refilled on respawn / new level).
- Launches straight ahead: `velocity = shipVelocity + missileMuzzle·nose`
  (`missileMuzzle` 700). Self-propelled (builds speed to ~1500 u/s).
- Flies straight for `age` < 0.35 s, then homes toward the nearest target in a
  forward cone (velocity lerps toward target dir).
- Limited lifespan `missileLife` 4.5 s, then it expires (and frees the "one at
  a time" slot).
- 30 dmg. Yellow tiny-missile model (body + nose + fins + additive flame),
  oriented along velocity, with a yellow trail.

Enemy fire is always cannon-style bolts (orange-red), muzzle ~950 u/s, 9 dmg to
the player / 8 to a pod.

Projectiles are pooled (240 max). Ramming an enemy ship: enemy dies, player
takes 26 and is knocked back.

## 7. HUD

Phosphor palette: amber `#ff2b2b`, green `#35e04a`, scanner red `#d21f1f`.

| Element | Position | Behaviour |
|---|---|---|
| Score | top-right | zero-padded |
| Missiles | top-right | current count |
| `EXTRA THRUST` | top-right, under missiles | visible while thrusting with `Shift` |
| Objectives | top-center | `Level N` + remaining `Class×n` + `Scan <range>` |
| `PODS n/total` | top-center (below objectives) | green; blinks amber when ≤ 2 |
| Orientation tripod | top-left inset (WebGL) | world axes X-red / Y-green / Z-white, carrying the inverse of ship orientation, fixed camera — swings as you maneuver |
| `V` gauge | bottom-left | speed / maxSpeed |
| `S` gauge | bottom-left | hull / maxHull |
| Scanner | bottom-right inset (WebGL) | see §8 |
| Heading indicator (`+`, centre missing) | center | fixed; the nose |
| Intent marker (`×`, centre missing) | center + `intent · (0.34·viewport)` | lags toward cursor |
| Raw mouse | center + `mouse · (0.34·viewport)` | tiny white square |
| Message | upper-center | `LEVEL n`, `LEVEL n CLEARED`, `COLLISION`, `POD DOWN`, flashes ~1–3 s |
| `SHIP DESTROYED` panel | center | bordered, dims the frozen scene, shows level + score + "press any key" |

## 8. Scanner (the signature element)

A **plane aligned with the ship's orientation**, drawn in tilted perspective in
its own scene, with **you at its center**.

- Transform each contact into ship-local space:
  `rel = (contact.pos − ship.pos)` then `rel.applyQuaternion(ship.q⁻¹)`.
- Map to radar space with scale `s = halfWidth / range` (`halfWidth` 10,
  `range` 2600 world units, `depth` 13):
  - `x = clamp(rel.x · s, ±halfWidth)` — lateral (right = +x)
  - `z = clamp(rel.z · s, ±depth)` — **forward is −z**, so a contact ahead sits
    *deeper* into the plane (farther from the viewer)
  - `y = clamp(rel.y · s · vScale, ±8)` — **relative altitude**; `vScale` 1.15
- Draw a **vertical stalk** from `(x, 0, z)` to `(x, y, z)` with a blip at the
  top. A contact dead ahead at your altitude → `(0, 0, −d)` → **zero-length
  stalk**. Above you → stalk up; below → stalk down.
- Colors: enemy red (bright when < 500 u), pod magenta. Danger contacts pulse.
- Own-ship marker: green cone at the origin pointing −z (forward / into screen).
- Blips kept ~constant screen size despite perspective.
- **Zoom**: `[` / `]` step `range` through `800 / 1500 / 2600 / 4500 / 8000` u;
  the current value shows in the HUD objectives line.
- Scanner camera: fov ~40, at `(0, 13, 21)` looking at `(0, 0, −2)`, grid 6×8.

## 9. Enemies

Flat-shaded darts, grey/white hull with a per-class accent, vector edge outline,
scaled up by `SHIP_SCALE` (2.0). All fly with the shared Newtonian helper.

Raw NetWars factors scaled by: `SPEED_K` 0.19 (→ base u/s; `thrust` = 2.4×,
`vmax` = 2.2×), `TURN_K` 0.062 (→ rad/s), `SHIELD_K` 12 (→ hull hp; a player
missile does 12, so Shield = hits-to-kill).

| Class | Behaviour | Target | Speed F. | Turn F. | Shield | Accent | Score |
|---|---|---|---|---|---|---|---|
| Pirate | brawler | pods | 500 | 24 | 2 | green `#35e04a` | 100 |
| Raider | thief | pods | 620 | 20 | 2 | amber `#f0b000` | 120 |
| Fighter | strafer | pods | 700 | 24 | 2 | cyan `#2fd0d0` | 150 |
| Guardian | sniper | player | 1100 | 32 | 4 | blue `#3a6bff` | 250 |
| Commander | charger | player | 900 | 22 | 8 | magenta `#d93bd0` | 500 |

**brawler** — close on the assigned pod; orbit + strafe when near; break off and
brake when very close; turn on the player if it comes within ~380 u. Fires when
aimed (`nose·to > 0.985`) and in `fireRange`.

**strafer** — attack runs: thrust straight at the pod firing; at < 240 u or
after 5 s, pick a wide waypoint 700–1100 u off the pod and blast out to it, then
re-run.

**thief** — fly to the nearest pod; on contact (and slow enough) grab it
(`pod.captor = this`), then drag it in a straight line away from the pod
centroid at a capped `vmax` of ~95 u/s. If it gets > 2600 u from the grab
point the pod is **stolen** (counts as lost) and the Raider leaves the field —
no score, but the quota still clears. Kill the Raider first and the pod is
released, still drifting.

**sniper** — state machine: *relocate* to a perch `1000–1500 u` from the player
(biased high), decelerating with `brakeAll` on arrival; *hold* for 3.5–6 s
facing the player, near-stationary, firing straight; then relocate. Bails out of
*hold* early if the player closes within 480 u.

**charger** — Newtonian joust: turn toward the player, full thrust, **never
brakes** (low drag), so it overshoots, banks around under its Turn Factor, and
charges again. Fires on a loose aim gate (`nose·to > 0.9`).

Spawning: keep ≤ 5 alive from the level's remaining quota, appearing 900–1400 u
from the pod centroid (or the player if no pods remain).

Any removal (shot, ram, or Raider escape) decrements that class's quota.
Score is awarded for shot/ram kills only.

## 10. Levels & objectives

Each level = **per-class kill quotas** + a cluster of pods to protect.

- **Won** when every quota is met, the arena is empty, and ≥ 1 pod survives.
- **Lost** the instant the last pod is destroyed or stolen → the level restarts.
- Pods do **not** respawn within a level. `PODS_PER_LEVEL` = 6.

| Level | Quotas |
|---|---|
| 1 | Pirate ×3, Raider ×1 |
| 2 | Pirate ×2, Raider ×2, Fighter ×2 |
| 3 | Fighter ×3, Raider ×2, Guardian ×1, Commander ×1 |
| 4 | Pirate ×2, Fighter ×2, Raider ×3, Guardian ×2, Commander ×1 |
| 5+ | generated: `fighter 2+N, raider 1+⌊N/2⌋, guardian ⌊N/2⌋, commander ⌊N/3⌋` |

Modes (planned): **Campaign** (above, solo or co-op) · **Deathmatch**
(multiplayer, bots fill slots, frag limit) · **Escort** (pods have a
destination).

## 11. Pods

Pink faceted octahedra (radius ~28, `SHIP_SCALE`-independent) with white antenna
spikes. Drift slowly (3–8 u/s), spin, don't shoot. `hp` 24 — enemy fire does 8,
an enemy ramming a pod does 20. **No friendly fire**: player projectiles pass
through pods entirely. A pod being hauled by a Raider has `captor` set and stops
drifting; freeing it (killing the Raider) clears `captor`.

## 12. Visual style

- **Flat-shaded low-poly** ships + **bright vector edge lines** (EdgesGeometry).
  Hull grey/white, per-player/-class accent stripe and canopy.
- Black space (`#02040a`), exponential fog, and a **3-layer environment**
  (`client/render/environment.js`, tuned from `constants.json` `env`):
  1. **Fixed star sphere** — the real HYG catalogue reduced to the naked-eye
     sky (`client/render/stars.json`, mag ≤ 6.5, ~8.9k stars, built by
     `tools/build-stars.mjs`). Each star placed by RA/Dec, sized by a magnitude
     bucket so bright stars pop, tinted from its B-V colour index. Tracks the
     camera *position* every frame and nothing else, so constellations sweep
     past when you turn but never translate when you fly. Unfogged.
  2. **Near-field motes** — ~400 dust points wrapped in an ~800u box around the
     eye, drawn as short streaks scaled by your velocity (a speed cue, capped
     so it never becomes a hyperspace tunnel).
  3. **Reference grid** — the faint blue y=0 grid, its opacity fading to zero
     as speed climbs (present when hovering, gone in a dogfight).
- Explosions: expanding amber wireframe shell + point-spray sparks.
- HUD is thin monospace, phosphor colors, subtle glow. CRT scanlines optional.

## 13. Audio

WebAudio only, created/resumed on first click:

| Sound | Shape |
|---|---|
| Player laser | square, 900→240 Hz, 0.12 s |
| Enemy laser | sawtooth, 320→120 Hz, 0.14 s |
| Hit taken | square, 150→60 Hz, 0.18 s |
| Explosion | filtered noise burst, 0.45 s |

Later: throttle hum, lock-on tone, UI blips.

## 14. Multiplayer (phase 2) — internet, Go server

### Topology

- **Client** stays on GitHub Pages (`www.hmpf.cz/netwars/`). *Network mode* is
  triggered entirely by the **URL fragment** (never sent to the Pages host):

  ```
  https://www.hmpf.cz/netwars/#<session_id>?server_id=<host>
  ```

  - `session_id` — a human-picked string, e.g. `eneas`. **Everyone who loads
    the same `session_id` on the same server plays the same match.** It is the
    room name; no lobby, no list — you share a link.
  - `server_id` — which Go server to reach. The client opens
    `wss://<server_id>/ws` and sends `session_id` in `hello`.
  - No fragment ⇒ the single-player client, unchanged.

- **Game server** is a separate Go binary on a small always-on box, one open
  port serving `wss://`. It groups connections into **arenas keyed by
  `session_id`** (created on first join, torn down when empty). It does **not**
  serve the client — that's Pages' job.

- **`server_id` must be a hostname with valid TLS** (so `wss://` works from the
  HTTPS client). A bare IP won't do — Let's Encrypt doesn't issue for IPs and
  the browser blocks mixed content. Point a name at the box (e.g.
  `netwars.hmpf.cz`) and let the server's `autocert` handle it, or front it
  with Caddy / Cloudflare.

### Authority — server-authoritative

Public internet means clients can't be trusted, so the **server runs the
simulation** and is the single source of truth:

- Clients send **inputs** only (`intent` vector, thrust/reverse/brake/roll
  flags, fire flags), timestamped and sequence-numbered.
- The server steps the same Newtonian physics + AI as single-player (§5, §9)
  at a fixed tick, resolves collisions, owns hull / score / pods / level state,
  and assigns spawns / accents.
- **Hit detection is server-side with lag compensation**: on a fire input the
  server rewinds other entities to the shooter's render time
  (`now − interpDelay − rtt/2`) before testing.
- Clients run **prediction** for their own ship (apply local input immediately,
  reconcile against the authoritative snapshot for their `lastSeq`) and
  **entity interpolation** for everyone else (render ~100–150 ms in the past
  from a snapshot buffer).
- Cheap anti-abuse: per-connection input rate limit, sanity clamps on input
  values, ignore inputs with implausible timestamps.

### Rates

- Client → server: inputs at 30–60 Hz (coalesced; one packet per client tick).
- Server tick: 60 Hz simulation.
- Server → clients: delta snapshots at 20–30 Hz, full snapshot on join / resync.
- `ping`/`pong` every ~1 s for RTT and to keep proxies from idling the socket.

### Shared constants

Physics and tuning values (thrust, `turnFactor`, weapon speeds, enemy stats,
pod hp, …) must be **identical** on the predicting client and the authoritative
server. Keep one source: `shared/constants.json`, imported by the JS client and
embedded (`go:embed`) or code-generated into the Go server. Never hand-copy.

### Join flow

1. Client parses `location.hash` → `session_id`, `server_id`; opens
   `wss://<server_id>/ws`; sends `hello { name, session, ver }`.
2. Server finds-or-creates the arena for `session`, assigns `id`, `accent`,
   spawn transform; replies
   `welcome { id, you, tickRate, snapRate, players[], pods[], mode, level }`.
3. Server broadcasts `join { player }` to that arena.
4. Steady state: client sends `input`; server broadcasts `snapshot` (+ `event`
   for discrete things: `kill`, `spawn`, `podlost`, `score`, `level`, `leave`).
5. On packet loss / big desync the client sends `resync`; server replies with a
   full snapshot.

### Message sketch (JSON to start; switch to a binary/Float32 packing if the
snapshot size or GC pressure warrants it)

```
C→S  hello   { name, session, ver }
C→S  input   { seq, t, intent:[x,y], thrust:-1|0|1, roll:-1|0|1, brake, boost,
               fireGun, fireMissile }
C→S  ping    { t }
C→S  resync  {}
S→C  welcome { id, you, tickRate, snapRate, players:[{id,name,accent}],
               pods:[...], mode, level }
S→C  snapshot{ t, ackSeq, ships:[{id,pos,quat,vel,hull}], pods:[...],
               shots:[...] }        // delta vs last ack where possible
S→C  event   { kind:"kill"|"spawn"|"podlost"|"score"|"level"|"leave", ... }
S→C  pong    { t, srvT }
```

### Bots

The §9 AI is ported to Go and runs on the server. Empty arena slots are filled
with bots so a 2-player game still feels populated; they appear in snapshots
exactly like players.

### Deploy

Single static binary. `GOOS=linux GOARCH=amd64 go build -o netwars-server
./cmd/netwars-server`, `scp` it over, run under a systemd unit with
`autocert` pointed at `netwars.hmpf.cz` (needs ports 80+443, or 443 only if a
cert is provisioned another way) — or bind a high port and put Caddy in front.
Graceful shutdown drains arenas.

## 15. Non-goals (for now)

- P2P / WebRTC data channels, STUN/TURN, NAT traversal — a single public
  server sidesteps all of it.
- Matchmaking service, accounts, persistence, leaderboards.
- Native desktop clients.
- NWDRAW-style in-game ship editor.
- External / chase camera.
- Mobile / touch.

## 16. Module map

```
index.html             canvas + HUD DOM + CSS + importmap

shared/                pure sim — no THREE meshes, no DOM; the Go port mirrors it
  constants.json        all tuning: physics, weapons, enemy factors, level tables
  constants.js          derives ENEMY_TYPES / goalsForLevel from the JSON
  sim/vec.js            THREE math primitives (the only THREE in shared/)
  sim/flight.js         stepShip() — Newtonian turn/thrust/brake/integrate
  sim/ai.js             stepEnemy() — 5 per-class Newtonian behaviours + helpers
  sim/weapons.js        Projectiles pool: motion, guidance, collision → events
  sim/rules.js          pods drift/cull, bonus spawn/collect, level win/lose FSM

client/                rendering + UI over the shared sim
  main.js              entry: #<session>?server_id=… → net.js, else sp.js
  sp.js                single-player loop: scene, lights, render, viewports, camera
  net.js               (phase 2) network mode: wss client, prediction, interp — stub
  input.js             keyboard + pointer-lock mouse deltas
  player.js            intent-marker easing + cannon/missile fire; delegates flight
  weapons.js           bolt/missile/trail meshes; maps sim events → FX/audio
  enemies.js           spawn/quota/leash/ram/pod-strikes; mesh + hull-flash sync
  pods.js  bonuses.js  thin render wrappers (tumble / pulse / rings)
  ships.js             hand-built low-poly dart + pod + bonus meshes
  levels.js            re-exports ENEMY_TYPES / goalsForLevel / PODS_PER_LEVEL
  explosions.js        wire shells + spark sprays (client-only FX)
  render/environment.js  3-layer background: real HYG star sky, speed motes, faded grid
  render/stars.json      reduced HYG catalogue (mag <= 6.5), built by tools/build-stars.mjs
  radar.js             the scanner (own scene + tilted viewport)
  orientation.js       the axis tripod (own scene + viewport)
  hud.js               DOM HUD updates

server/                (phase 2) Go module
  cmd/netwars-server/main.go   flags, TLS/autocert, listen, graceful shutdown
  net/                         wss upgrade, per-conn read/write pumps, framing
  game/                        arena, fixed-tick loop, Newtonian sim, collisions
  game/ai.go                   §9 enemy behaviours ported from enemies.js
  game/snapshot.go             delta snapshot build + lag-comp rewind buffer
```

## 17. Tuning knobs

| Param | Where | Current |
|---|---|---|
| `thrustAccel`, `brakeAccel`, `boostMult`, `drag`, `maxSpeed` | `player.js` | 240, 320, 2.4, 0.02, 620 |
| `turnFactor`, `rollRate` | `player.js` | 1.9, 2.0 |
| `mouseGain`, `intentLag`, `mouseRecenter` | `player.js` | 0.0042, 8, 0.35 |
| `gunInterval` / `missileInterval` / `missileMuzzle` / `missileLife` | `player.js` | 0.1 / 0.35 s / 700 / 4.5 s |
| missiles max (no regen) | `player.js` | 16 |
| dmg: cannon→enemy / missile→enemy / enemy→player / enemy→pod | `weapons.js` | 8 / 30 / 9 / 8 |
| enemy leash distance (pull-back / hard snap) | `enemies.js` | 5000 / 6500 |
| enemy `thrust` / `vmax` multipliers of Speed F. | `enemies.js` | 2.4× / 2.2× |
| `SPEED_K`, `TURN_K`, `SHIELD_K` | `levels.js` | 0.19, 0.062, 12 |
| Raider haul `vmax` / steal distance | `enemies.js` | 95 / 2600 |
| `SHIP_SCALE` | `ships.js` | 2.0 |
| scanner `ranges[]`, `halfW`, `depth`, `vScale` | `radar.js` | 800..8000, 10, 13, 1.15 |
| ram: enemy→player dmg / knockback; enemy→pod dmg | `enemies.js` | 26 / 150 ; 20 |
| `PODS_PER_LEVEL`, pod `hp` | `levels.js`, `pods.js` | 6 / 24 |

Phase-2 server knobs (proposed): sim tick 60 Hz · snapshot 20–30 Hz · client
interp delay 100–150 ms · max players/arena 8 · max arenas per process (cap for
the small box) · input rate limit ~90/s/conn · ping interval 1 s.

## 18. Open questions

- Does the intent marker auto-center, or is centering fully manual (more
  authentic, harder)?
- Missile economy: hard cap like the original (16–20, pickups) or slow regen?
- Pod fragility / enemy pod-DPS — a level is lost fast if you don't engage; is
  the current balance too punishing?
- Should losing all pods restart the level, drop back a level, or end the run?
- Level pacing — kills-per-minute target, and how fast quotas scale.
- Snapshot format: stay JSON or go binary (Float32Array) before it matters?
- Co-op friendly fire on/off (player→pod is already off).

Phase-2 / networking:

- `server_id` TLS: `autocert` on the box (needs 80+443), Caddy in front, or
  Cloudflare? Whichever, `server_id` ends up a hostname, not the raw IP.
- What's the multiplayer *mode* per `session_id` — co-op defend-the-pods,
  deathmatch, or both selectable? Does the session creator's first choice stick?
- Full server-authoritative sim from day one, or ship a relay first and harden
  later? (Public internet argues for authoritative now.)
- Shared constants: JSON consumed both sides, or generate a `.go` from the JS?
- Reconnect: if a player drops and reloads the same `#session_id`, do they
  resume their ship (grace timer) or respawn fresh?
- Idle arena teardown delay; per-process arena cap for the small box.

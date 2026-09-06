# NETWARS — Design Spec

A browser remake of **NetWars** (Novell, 1993): a first-person polygon space
shooter whose reason to exist was **LAN multiplayer**. This document is the
reference for what we're building and why. It describes the target; the code may
lag it. Current values in parentheses come from the phase-1 prototype and are
tuning knobs, not commitments.

---

## 1. Vision

- Recreate the *feel* of NetWars, then improve on it: floaty inertial flight,
  the deploy-a-marker-and-chase-it steering, the tilted-grid scanner that shows
  the third dimension as vertical stalks, the vector-polygon look.
- **Multiplayer on a LAN is the point.** Friends on the same network, one host,
  everyone else joins by URL. Single-player vs AI is the foundation and the
  practice range; AI ships double as bots to fill multiplayer slots.
- Keep it frictionless: no install for players, no per-OS builds, no accounts.

## 2. Platform & tech

| Concern | Choice | Why |
|---|---|---|
| Client | HTML + ES modules + **Three.js core** from CDN, no build step | Zero install, instant iteration, shareable by link; flat-shaded / wireframe look is native to Three.js |
| Rendering | WebGL via Three.js; three viewports (main + orientation inset + scanner inset) | insets are separate scenes composited with scissor/viewport |
| Server (phase 2) | **Node + `ws`**, serves the static client *and* runs the game server on one port | Host runs `node server.js`, shares `http://<host-ip>:PORT` |
| Transport | WebSocket (TCP) | LAN latency ~1 ms, negligible loss — UDP/WebRTC solve NAT problems we don't have |
| Audio | WebAudio blip synth, resumed on first gesture | no asset files |

Not chosen: Godot (native builds to distribute), Unity (overkill), raw WebGL
(slower iteration). Revisit Godot only if we want native desktop clients or
rollback netcode.

## 3. Core loop

1. Each level starts with a **cluster of pods** you must protect and a kill
   quota of enemies to destroy.
2. Fly (mouse steers via the intent marker; keyboard for thrust/reverse/guns).
3. Some enemies attack the pods, some hunt you, one type steals pods.
4. **Level won** when the kill quota is met *and* at least one pod survives →
   brief pause → next level. **Level lost** if every pod is destroyed or
   stolen → the level restarts.
5. Hull hits 0 → destroyed → `R` respawns; the level continues (pods persist).

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
| `Space` | Fire missiles |
| `[` / `]` | Scanner zoom out / in |
| `R` | Respawn when destroyed |

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

- **Missiles**, limited ammo (`missiles` start/max 20), regenerate 1 per ~2.2 s.
- Fired in pairs from wing points; cooldown `fireInterval` ≈ 0.16 s.
- Muzzle speed added to ship velocity: player 1300 u/s, enemy ~950 u/s.
- Player missiles **lightly home** toward the nearest enemy within a forward
  cone (velocity lerps toward target dir; weak). NetWars missiles tracked a bit.
- Damage: player hit = 12 to enemy shields; enemy hit = 9 to player hull.
- TTL ~2.6 s (player) / 3.0 s (enemy). Pooled (240 max).
- **Render**: each active shot is a chunky elongated-octahedron **bolt mesh**
  (~8 u wide, ~26 u long) with a hot white core, additive-blended, oriented
  along its velocity, plus a short additive trail. Player bolts cyan, enemy
  bolts orange-red. They must read as substantial objects, not hairlines.
- Ramming an enemy ship: enemy dies, player takes 26 and is knocked back.

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
| Message | upper-center | `LEVEL n`, `COLLISION`, flashes ~2 s |
| `SHIP DESTROYED / press R` | center | when hull = 0 |

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
- Black space (`#02040a`), exponential fog, white non-attenuated point stars
  (~3800, wrapped around the player for an infinite field), faint blue reference
  grid on y=0 for spatial sense.
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

## 14. Multiplayer (phase 2)

### Topology

One process on the host: an HTTP server for the static client **and** a
WebSocket game server on the same port. Players open `http://<host-ip>:PORT`.
No matchmaking, no discovery service — the host reads their LAN IP off the
console banner and tells people.

### Authority

**Shooter-authoritative, server-relayed** — simple and fine for friends on a
LAN:

- Each client simulates its own ship fully and sends state.
- The client that fired a shot detects the hit and sends a `hit` claim; the
  server validates loosely (range/plausibility) and applies damage + score.
- The server owns: player roster, ship/accent/spawn assignment, authoritative
  score, pod state, AI/bots, level/mode state.
- Add client-side prediction + reconciliation later only if the LAN feel needs
  it (it probably won't).

### Rates

- Client → server: input/state at 30–60 Hz.
- Server → clients: world snapshot at 20–30 Hz.
- Clients render remote ships from an interpolation buffer (~100 ms behind).

### Join flow

1. Client connects, sends `hello { name }`.
2. Server assigns `id`, `accent`, spawn transform; replies `welcome { id, you,
   players[], mode, level }`.
3. Server broadcasts `join { player }` to others.
4. Steady state: client sends `state` / `fire` / `hit`; server broadcasts
   `snapshot`, plus `kill`, `spawn`, `leave`, `score`, `level` events.

### Message sketch (JSON; may switch to binary later)

```
C→S  hello  { name }
C→S  state  { t, pos:[x,y,z], quat:[x,y,z,w], vel:[x,y,z], throttle, hull }
C→S  fire   { t, origin:[..], dir:[..], seq }
C→S  hit    { target, seq, dmg }
S→C  welcome { id, you, players:[{id,name,accent}], mode, level }
S→C  snapshot{ t, ships:[{id,pos,quat,vel,hull,throttle}], pods:[..], bots:[..] }
S→C  join   { player } / leave { id }
S→C  kill   { victim, killer } / spawn { id, pos, quat }
S→C  score  { id, score } / level { n, goals }
```

### Bots

Empty slots are filled with the §9 AI so a 2-player game still feels populated.
Bots run on the server and appear in snapshots like players.

## 15. Non-goals (for now)

- Internet play across NAT (would need WebRTC + a signaling/TURN setup).
- Native desktop clients.
- NWDRAW-style in-game ship editor.
- External / chase camera.
- Mobile / touch.

## 16. Module map

```
index.html            canvas + HUD DOM + CSS + importmap
src/main.js            scene, lights, render loop, viewports, level win/lose FSM
src/input.js           keyboard + pointer-lock mouse deltas
src/player.js          Newtonian flight, intent marker, missiles
src/weapons.js         pooled bolt projectiles, homing, collision
src/enemies.js         5 typed enemies, per-class Newtonian behaviours, quotas
src/pods.js            protect-the-pods objective + Raider capture
src/ships.js           hand-built low-poly dart + pod meshes with vector edges
src/levels.js          enemy roster + behaviours + level goal tables
src/explosions.js      wire shells + spark sprays
src/starfield.js       wrapping point stars + reference grid
src/radar.js           the scanner (own scene + tilted viewport)
src/orientation.js     the axis tripod (own scene + viewport)
src/hud.js             DOM HUD updates
server/server.js       (phase 2) static host + WS game server
server/bots.js         (phase 2) server-side AI
```

## 17. Tuning knobs

| Param | Where | Current |
|---|---|---|
| `thrustAccel`, `brakeAccel`, `boostMult`, `drag`, `maxSpeed` | `player.js` | 240, 320, 2.4, 0.02, 620 |
| `turnFactor`, `rollRate` | `player.js` | 1.9, 2.0 |
| `mouseGain`, `intentLag`, `mouseRecenter` | `player.js` | 0.0042, 8, 0.35 |
| `fireInterval`, missiles max, regen period | `player.js` | 0.16 s, 20, 2.2 s |
| projectile dmg: player→enemy / enemy→player / enemy→pod | `weapons.js` | 12 / 9 / 8 |
| enemy `thrust` / `vmax` multipliers of Speed F. | `enemies.js` | 2.4× / 2.2× |
| `SPEED_K`, `TURN_K`, `SHIELD_K` | `levels.js` | 0.19, 0.062, 12 |
| Raider haul `vmax` / steal distance | `enemies.js` | 95 / 2600 |
| `SHIP_SCALE` | `ships.js` | 2.0 |
| scanner `ranges[]`, `halfW`, `depth`, `vScale` | `radar.js` | 800..8000, 10, 13, 1.15 |
| ram: enemy→player dmg / knockback; enemy→pod dmg | `enemies.js` | 26 / 150 ; 20 |
| `PODS_PER_LEVEL`, pod `hp` | `levels.js`, `pods.js` | 6 / 24 |

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

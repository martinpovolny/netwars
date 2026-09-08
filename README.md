# NETWARS

A browser remake of **NetWars** (Novell, 1993) — a first-person polygon space
shooter. The mouse deploys an *intent marker* that your ship swings to follow;
the keyboard drives Newtonian thrust and two weapons. Retro flat-shaded vector
ships, a ship-aligned scanner that shows contact altitude as vertical stalks,
and the NetWars orientation tripod.

This is the **single-player prototype** (phase 1). LAN multiplayer — the whole
point of the original — is the next phase: a small Node WebSocket server that
serves this client and broadcasts world snapshots, so everyone on the LAN just
opens `http://<host-ip>:PORT`. See `SPEC.md` for the full design.

## Run

Any static file server works; the client is plain ES modules + Three.js from a
CDN (no build step).

```sh
./serve.sh                 # -> http://localhost:8777/
# or: python3 -m http.server 8777
# or: npx serve -l 8777 .
```

## Controls

| Input | Action |
|---|---|
| Mouse | Move the raw cursor; the intent marker chases it; the ship turns toward the marker |
| Click | Lock the pointer (first click) |
| `W` | Thrust forward (impulse — momentum persists) |
| `S` | Reverse thrust |
| `C` | Brake — bleed speed along the way you're pointing |
| `X` | Full stop |
| `A` / `D` | Roll left / right |
| `Shift` | Extra thrust (boost) — shows `EXTRA THRUST` |
| `Space` / LMB | **Cannon** — unlimited, fired from the wing pods |
| `F` / RMB | **Guided missile** — one on screen at a time, limited ammo, launched from a belly rail |
| `[` / `]` | Scanner zoom out / in (5 levels) |
| `H` | Flash the key list for a few seconds |
| any key | Relaunch (while the `SHIP DESTROYED` panel is up) |

Flight is fully Newtonian and identical for you and every enemy: point the nose,
apply thrust or reverse, momentum carries; the brake only bleeds speed along the
facing axis. There is no throttle.

## HUD

- **Centre** — amber `+` (centre gap): your nose heading. White `×` (centre
  gap): the deployed intent marker, lagging toward the mouse. Tiny white
  square: the raw mouse cursor. Green chevrons: your ship.
- **Top-left** — orientation tripod: world axes (X red, Y green, Z white) seen
  from the cockpit; it swings as you pitch / yaw / roll.
- **Top-centre** — `Level N` + remaining kills per class; below it `PODS n/total`
  (blinks amber at ≤ 2).
- **Bottom-left** — `V` speed, `S` shields (hull).
- **Bottom-right** — scanner: a ship-aligned grid plane with you at its centre.
  A contact dead ahead sits *deeper* in the plane with a zero-length stalk; the
  stalk length is the contact's relative altitude. The label reads
  `Z<n>/5 · <range>` (`[` / `]` to change).
- **Top-right** — score, missile count (limited, no regen — refilled on
  respawn / new level), `EXTRA THRUST` light.

When your hull hits 0 the whole world **freezes** and a `SHIP DESTROYED` panel
shows your level and score; press any key (after a short beat) to relaunch in
place with brief invulnerability. The level continues with whatever pods survived.

## Objective — protect the pods

Each level spawns a cluster of pink **pods** and a kill quota of enemies.

- **Level won** — the quota is met *and* at least one pod survives.
- **Level lost** — every pod is destroyed or stolen (a Raider hauls one off the
  scanner). The level restarts.

Player fire cannot hurt pods. The campaign is endless: levels past the authored
table are generated and keep escalating.

## Enemies

Base stats echo the NetWars "Level Goals" screen (Speed / Turn / Shield
factors, `shared/constants.json`); behaviour per class is ours.

| Class | Target | Behaviour |
|---|---|---|
| **Pirate** | pods | Charges a pod, orbits close, strafes; turns on you if crowded |
| **Raider** | pods | Flies to a pod, grabs it, hauls it away slowly — kill it to free the pod |
| **Fighter** | pods | Fast attack runs, wide break-off, re-engage |
| **Guardian** | player | Jumps to a distant perch, holds, shoots straight at you, relocates |
| **Commander** | player | Newtonian charge straight at you — accelerates, overshoots, banks around |

## Layout

Gameplay logic (physics, AI, weapons, pod/bonus/level rules) lives in `shared/`
as pure modules with no THREE meshes or DOM, so the same code drives the SP
client, the MP client's prediction, and (ported) the Go server. `client/`
is rendering + UI.

```
index.html               canvas + HUD DOM + CSS + importmap

shared/
  constants.json          all tuning: physics, weapons, enemy factors, levels…
  constants.js            derives ENEMY_TYPES / goalsForLevel from the JSON
  sim/vec.js              THREE math primitives (the only THREE in shared/)
  sim/flight.js           stepShip() — Newtonian turn/thrust/brake/integrate
  sim/ai.js               stepEnemy() — brawler/strafer/sniper/charger/thief
  sim/weapons.js          Projectiles pool: motion, guidance, collision → events
  sim/rules.js            pods drift/cull, bonus spawn/collect, level win/lose FSM

client/
  main.js                 entry: #<session>?server_id=… → net.js, else sp.js
  sp.js                    single-player loop: scene, render, viewports, camera
  net.js                   online mode (M2) — stub, falls back to sp.js
  input.js                 keyboard + pointer-lock mouse deltas
  player.js  enemies.js  pods.js  bonuses.js  weapons.js
                           thin render wrappers over the shared sim (mesh sync)
  ships.js                 hand-built low-poly dart / pod / bonus meshes
  levels.js                re-exports ENEMY_TYPES / goalsForLevel / PODS_PER_LEVEL
  explosions.js            expanding wire shells + spark sprays (client-only FX)
  render/environment.js    3-layer background: real HYG star sky, speed motes, faded grid
  render/stars.json        reduced HYG catalogue (mag ≤ 6.5); built by tools/build-stars.mjs
  radar.js                 the scanner (own scene, tilted viewport, zoom levels)
  orientation.js           the axis tripod (own scene + viewport)
  hud.js                   DOM HUD updates
```

`window.__nw` is a debug hook (`paused`, `player`, `enemies`, `pods`, `radar`, …).

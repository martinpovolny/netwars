# NETWARS

A browser remake of **NetWars** (Novell, 1993) — a first-person polygon space
shooter. Mouse deploys an *intent marker* that your ship swings to follow;
keyboard drives throttle and guns. Retro flat-shaded vector ships, a 3D-ish
scanner that shows contact altitude as vertical stalks, and the NetWars
orientation tripod.

This is the **single-player prototype** (phase 1). LAN multiplayer — the whole
point of the original — is the next phase: a small Node WebSocket server that
serves this client and broadcasts world snapshots, so everyone on the LAN just
opens `http://<host-ip>:PORT`.

## Run

Any static file server works; the client is plain ES modules + Three.js from a
CDN (no build step).

```sh
# option A
python3 -m http.server 8777
# option B (if you have node)
npx serve -l 8777 .

# then open http://localhost:8777/
```

## Controls

| Input | Action |
|---|---|
| Mouse | Move the deployed direction marker; the ship turns toward it |
| Click | Lock the pointer / fire |
| `W` / `S` | Throttle up / down (`X` cut throttle) |
| `A` / `D` | Roll left / right |
| `Shift` | Extra thrust (afterburner) |
| `C` | Airbrake |
| `Space` | Fire missiles |
| `R` | Respawn after you're destroyed |

## HUD

- **Centre** — green chevrons + red cross: your nose heading. White brackets:
  the deployed intent marker (lags toward the mouse). Tiny white square: the
  raw mouse.
- **Top-left** — orientation tripod: world axes (X red, Y green, Z white) seen
  from the cockpit; it swings as you pitch/yaw/roll.
- **Bottom-left** — `V` velocity, `S` shields (hull).
- **Bottom-right** — scanner: a ship-aligned grid plane, you at its centre. A
  contact dead ahead sits *deeper* in the plane with a zero-length stalk; the
  stalk length is the contact's relative altitude.
- **Top-right** — score, missiles (regenerate slowly), `EXTRA THRUST` light.

## Enemies & levels

Modelled on the NetWars "Level Goals" screen. Each class has Speed / Turn /
Shield factors; each level sets kill quotas (`src/levels.js`):

| Class | Speed | Turn | Shield | Score |
|---|---|---|---|---|
| Pirate | 500 | 24 | 2 | 100 |
| Fighter | 700 | 24 | 2 | 150 |
| Guardian | 1100 | 32 | 4 | 250 |
| Commander | 900 | 32 | 8 | 500 |

Pink **pods** drift around as bonus targets and don't shoot back.

## Layout

```
index.html          canvas + HUD DOM + CSS + importmap
src/main.js          scene, lights, render loop, 3 viewports (main + 2 insets)
src/input.js         keyboard + pointer-lock mouse deltas
src/player.js        flight model: intent-marker-with-lag, throttle, missiles
src/weapons.js       pooled projectiles (player shots lightly home)
src/enemies.js       typed enemies, per-level quotas, orbit/strafe AI
src/pods.js          drifting bonus pods
src/ships.js         hand-built low-poly dart + pod meshes with vector edges
src/levels.js        enemy stats + level goal tables
src/explosions.js    expanding wire shells + spark sprays
src/starfield.js     wrapping point stars + reference grid
src/radar.js         the scanner (own scene, tilted perspective viewport)
src/orientation.js   the axis tripod (own scene + viewport)
src/hud.js           DOM HUD updates
```

`window.__nw` is a debug hook (`paused`, `player`, `enemies`, …).

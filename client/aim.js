// Should this projectile be drawn as a guided-cannon bolt? In single-player the
// sim keeps kind 'bolt' and the lock lives in `target`; in co-op the server
// sends wire kind 'gbolt' (and the client store has no targets at all).
export function isGuidedBolt(kind, team, target) {
  return kind === 'gbolt' || (kind === 'bolt' && team === 'player' && !!target);
}

// Guided-cannon target pick (the JS twin of pickGuidedTarget in
// server/game/guided.go). Locks the live enemy nearest the CROSSHAIR — the
// smallest angle off `fwd` (a unit vector) — and only inside a cone of
// coneDeg degrees; enemies behind or off to the side are never chosen however
// close they are. Equal angles go to the nearer one. null = no lock.
// Pure: reads only {x,y,z} from positions, so it's unit-testable without THREE.
export function pickGuidedTarget(pos, fwd, list, coneDeg) {
  const minCos = Math.cos((coneDeg * Math.PI) / 180);
  const EPS = 1e-9;
  let best = null;
  let bestCos = -Infinity;
  let bestDist = Infinity;
  for (const e of list) {
    if (!e || e.dead) continue;
    const dx = e.position.x - pos.x;
    const dy = e.position.y - pos.y;
    const dz = e.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const c = dist > 0 ? (fwd.x * dx + fwd.y * dy + fwd.z * dz) / dist : 1;   // on top of us = dead ahead
    if (c < minCos) continue;
    if (c > bestCos + EPS || (Math.abs(c - bestCos) <= EPS && dist < bestDist)) {
      best = e; bestCos = c; bestDist = dist;
    }
  }
  return best;
}

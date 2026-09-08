// Pod + bonus simulation — shared by the SP client and the Go server.
// Pure: operates on plain state ({position, velocity, ...}). Spin / pulse /
// meshes are the render layer's job. RNG is Math.random for now; M2 swaps in a
// seeded xorshift so the server is deterministic.
import { Vector3 } from './vec.js';

// ---------------------------------------------------------------- pods -------

// pods: { list:[podState], centroid:Vector3, lost:number, total:number }
// podState: { position, velocity, spin, hp, radius, dead, captor }
// `spin` is a visual-tumble vector kept on the state so RNG order matches the
// original exactly; the server just doesn't stream it.
export function spawnPods(count, around, K) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const spin = new Vector3(
      (Math.random() - 0.5) * K.spinRange,
      (Math.random() - 0.5) * K.spinRange,
      (Math.random() - 0.5) * K.spinRange,
    );
    list.push({
      position: new Vector3().randomDirection().multiplyScalar(K.spawnMin + Math.random() * K.spawnRange).add(around),
      velocity: new Vector3().randomDirection().multiplyScalar(K.driftMin + Math.random() * K.driftRange),
      spin,
      hp: K.hp,
      radius: K.radius,
      dead: false,
      captor: null,
    });
  }
  return list;
}

export function recentrePods(pods) {
  if (pods.list.length === 0) return;
  pods.centroid.set(0, 0, 0);
  for (const p of pods.list) pods.centroid.add(p.position);
  pods.centroid.multiplyScalar(1 / pods.list.length);
}

export function stepPods(pods, dt) {
  for (const p of pods.list) if (!p.dead && !p.captor) p.position.addScaledVector(p.velocity, dt);
  const keep = [];
  for (const p of pods.list) {
    if (p.dead) pods.lost++;
    else keep.push(p);
  }
  pods.list = keep;
  recentrePods(pods);
}

// ------------------------------------------------------------- bonuses ------

// bonuses: { list:[bonusState], timer, maxAlive }
// bonusState: { kind:'missiles'|'repair', position, velocity, radius, life, dead, _collected }
function spawnBonus(bonuses, around, player, K) {
  const wantRepair = player.hull < player.maxHull * K.wantRepairBelow;
  const wantMsl = player.missiles < player.maxMissiles * K.wantMissilesBelow;
  let kind;
  if (wantRepair && !wantMsl) kind = 'repair';
  else if (wantMsl && !wantRepair) kind = 'missiles';
  else kind = Math.random() < 0.5 ? 'repair' : 'missiles';

  bonuses.list.push({
    kind,
    _t: Math.random() * 6,        // visual phase (RNG order matches the original)
    position: new Vector3().randomDirection().multiplyScalar(K.spawnMin + Math.random() * K.spawnRange).add(around),
    velocity: new Vector3().randomDirection().multiplyScalar(K.driftMin + Math.random() * K.driftRange),
    radius: K.radius,
    life: K.life,
    dead: false,
    _collected: false,
  });
}

// a player projectile at `pos` scores a hit on a bonus -> counts as collecting
export function bonusHitByShot(bonuses, pos) {
  for (const b of bonuses.list) {
    if (b.dead) continue;
    if (pos.distanceToSquared(b.position) < b.radius * b.radius) { b._collected = true; return true; }
  }
  return false;
}

// returns { kind } for a bonus collected this step, or null
export function stepBonuses(bonuses, player, around, dt, K) {
  let collected = null;

  bonuses.timer -= dt;
  if (bonuses.timer <= 0 && bonuses.list.length < K.maxAlive) {
    bonuses.timer = K.respawnMin + Math.random() * K.respawnRange;
    spawnBonus(bonuses, around, player, K);
  }

  for (const b of bonuses.list) {
    if (b.dead) continue;
    b._t += dt;
    b.life -= dt;
    if (b.life <= 0) b.dead = true;
    b.position.addScaledVector(b.velocity, dt);
    if (b._collected || (player.alive && b.position.distanceToSquared(player.position) < b.radius * b.radius)) {
      b.dead = true;
      collected = { kind: b.kind };
    }
  }

  bonuses.list = bonuses.list.filter((b) => !b.dead);
  return collected;
}

export function makeBonuses(K) {
  return { list: [], timer: K.firstDelayMin + Math.random() * K.firstDelayRange, maxAlive: K.maxAlive };
}

// --------------------------------------------------------- level FSM -------

export function makeLevelFSM() {
  return { state: 'playing', timer: 0 };   // 'playing' | 'won' | 'lost'
}

// Call with dt = 0 to pause it (e.g. while the player is dead). ctx:
//   { podsAlive, enemiesCleared, level }
// Returns an action the caller performs, or null:
//   { flash: text, hold: seconds }   — show a banner
//   { startLevel: n }                — (re)start level n
export function stepLevelFSM(fsm, ctx, dt) {
  if (dt <= 0) return null;

  if (fsm.state === 'playing') {
    if (ctx.podsAlive === 0) {
      fsm.state = 'lost';
      fsm.timer = 3.0;
      return { flash: 'ALL PODS LOST — LEVEL FAILED', hold: 3.0 };
    }
    if (ctx.enemiesCleared) {
      fsm.state = 'won';
      fsm.timer = 2.8;
      return { flash: 'LEVEL ' + ctx.level + ' CLEARED', hold: 2.8 };
    }
    return null;
  }

  fsm.timer -= dt;
  if (fsm.timer <= 0) {
    const next = fsm.state === 'won' ? ctx.level + 1 : ctx.level;
    fsm.state = 'playing';
    return { startLevel: next };
  }
  return null;
}

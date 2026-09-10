// Enemy fleet simulation — shared by the SP client and the Go server.
// Pure: plain state objects, no THREE meshes, no DOM. The per-enemy AI tick is
// in ai.js; this owns the roster: spawn cadence, per-class quota, the leash
// that keeps a stray enemy reachable, and culling the dead.
//
// RNG draw order in spawnEnemy MUST match the old client Enemies._spawn so a
// seeded run reproduces exactly: key index, then fireCd, strafeSign (inside
// makeEnemyState), then the spawn direction (2 draws) and its magnitude.
import { Vector3, Quaternion } from './vec.js';
import { randomDir } from './rng.js';
import { stepEnemy } from './ai.js';

const FWD = new Vector3(0, 0, -1);
const _leash = new Vector3();

// The non-render half of the old `Enemy` class.
export function makeEnemyState(typeKey, ENEMY_TYPES, KE, rng = Math.random) {
  const t = ENEMY_TYPES[typeKey];
  return {
    type: typeKey,
    stats: t,
    behavior: t.behavior,

    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    hp: t.hp,
    radius: (KE.radiusBase + t.bulk * KE.radiusPerBulk) * KE.shipScale,
    dead: false,
    escaped: false,

    thrust: t.speed * KE.thrustMult,
    vmax: t.speed * KE.vmaxMult,

    fireCd: t.fireGap[0] + rng() * (t.fireGap[1] - t.fireGap[0]),
    strafeSign: rng() < 0.5 ? -1 : 1,
    repick: 0,
    _targetPod: null,
    _loot: null,

    state: 'init',
    stateT: 0,
    holdFor: 0,
    charge: 0,          // Guardian lance windup (seconds remaining); visual-only elsewhere
    perch: new Vector3(),
    movePos: new Vector3(),
    aimPos: new Vector3(),
    haulDir: new Vector3(),
    haulStart: new Vector3(),

    // visual-only, carried on the state (like pod `spin`); the server never
    // streams it, the client decays it and drives the hull hit-flash.
    flash: 0,
  };
}

// fleet: { list:[enemyState], level, goals, pending }
export function makeFleet() {
  return { list: [], level: 0, goals: {}, pending: {} };
}

export function startFleetLevel(fleet, n, goalsForLevel) {
  fleet.list.length = 0;
  fleet.level = n;
  fleet.goals = goalsForLevel(n);
  fleet.pending = { ...fleet.goals };
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
export function fleetPendingRemaining(fleet) { return sum(fleet.pending); }
export function fleetGoalsRemaining(fleet) { return sum(fleet.goals); }
export function fleetCleared(fleet) { return fleetGoalsRemaining(fleet) === 0 && fleet.list.length === 0; }

function spawnEnemy(fleet, anchor, playerPos, ENEMY_TYPES, KE, rng) {
  const keys = Object.keys(fleet.pending).filter((k) => fleet.pending[k] > 0);
  if (!keys.length) return null;
  const k = keys[Math.floor(rng() * keys.length)];
  fleet.pending[k]--;
  const e = makeEnemyState(k, ENEMY_TYPES, KE, rng);
  e.position
    .copy(randomDir(rng, new Vector3()).multiplyScalar(KE.spawnMin + rng() * KE.spawnRange))
    .add(anchor);
  e.quaternion.setFromUnitVectors(FWD, playerPos.clone().sub(e.position).normalize());
  fleet.list.push(e);
  return e;
}

// One fleet tick. ctx: { player, pods, weapons, fx?, rng?, ENEMY_TYPES }
//   player  — the local ship state (position, alive, …)
//   pods    — the pod sim state ({ list, centroid, … })
//   weapons — anything with .spawn() (the shared Projectiles pool)
// Returns events[]: { kind:'enemyKilled', e } for each culled non-escaped kill.
export function stepFleet(fleet, ctx, dt, KE) {
  const events = [];
  const rng = ctx.rng || Math.random;
  const player = ctx.player;

  for (const e of fleet.list) {
    if (e.dead) continue;
    stepEnemy(e, ctx, dt);
    // leash: never let an enemy stray so far the level can't be finished
    const d = e.position.distanceTo(player.position);
    if (d > KE.leashSoft) {
      const back = _leash.copy(player.position).sub(e.position).multiplyScalar(1 / d);
      e.velocity.addScaledVector(back, e.thrust * KE.leashThrustMult * dt);
      if (d > KE.leashHard) e.position.copy(player.position).addScaledVector(back, -KE.leashSnapDist);
    }
  }

  const keep = [];
  for (const e of fleet.list) {
    if (!e.dead) { keep.push(e); continue; }
    if (fleet.goals[e.type] > 0) fleet.goals[e.type]--;
    if (e._loot && e._loot.captor === e) e._loot.captor = null;
    if (!e.escaped) events.push({ kind: 'enemyKilled', e });
  }
  fleet.list = keep;

  const anchor = ctx.pods.list.length ? ctx.pods.centroid : player.position;
  while (fleet.list.length < KE.maxAlive && fleetPendingRemaining(fleet) > 0) {
    if (!spawnEnemy(fleet, anchor, player.position, ctx.ENEMY_TYPES, KE, rng)) break;
  }

  return events;
}

// Enemy rams the player: kills the enemy, damages + knocks back the player.
// Returns { pos, hurt } for FX (hurt=false when invuln soaked it, matching the
// old path where player.damage(_, audio) returned before playing the hit
// sound), or null. (Was client Enemies.checkRam.)
export function checkRam(fleet, player, KE) {
  for (const e of fleet.list) {
    if (e.dead) continue;
    if (player.alive && player.position.distanceToSquared(e.position) < (e.radius + KE.ramDist) ** 2) {
      e.dead = true;
      const hurt = player.invuln <= 0;
      player.damage(KE.ramDmg);
      const away = player.position.clone().sub(e.position).normalize();
      player.velocity.addScaledVector(away, KE.ramKnockback);
      return { pos: e.position.clone(), hurt };
    }
  }
  return null;
}

// Non-thief enemies bump the pods they orbit: pod takes damage + knockback,
// the enemy is shoved off. Only a lethal bump surfaces an event (matching the
// old checkPodStrikes, which drew FX on kill only). Returns events[]
// ({ kind:'podStrikeKill', pos, pod }).
export function checkPodStrikes(fleet, pods, KE) {
  const events = [];
  for (const e of fleet.list) {
    if (e.dead || e.behavior === 'thief') continue;
    for (const p of pods.list) {
      if (p.dead) continue;
      if (e.position.distanceToSquared(p.position) < (e.radius + p.radius) ** 2) {
        p.hp -= KE.podStrikeDmg;
        if (p.hp <= 0) {
          p.dead = true;
          events.push({ kind: 'podStrikeKill', pos: p.position.clone(), pod: p });
        }
        const away = e.position.clone().sub(p.position).normalize();
        e.velocity.addScaledVector(away, KE.podStrikeKnockback);
      }
    }
  }
  return events;
}

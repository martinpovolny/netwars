// The shared world: one authoritative tick over enemies, pods, bonuses,
// projectiles, collisions and the level FSM. Pure — plain state, no THREE
// meshes, no DOM, no audio. `world.fx` is an optional client-only side channel
// (the SP client passes its Audio for the enemy-laser cue; the server passes
// null).
//
// The local player's ship is NOT stepped here: in the hybrid-authoritative
// model each client predicts its own ship (client/player.js → stepShip) and
// the server integrates the others. stepWorld runs everything the shared world
// owns and hands back a flat events[] for the client to turn into FX / HUD /
// sound.
//
// Tick order mirrors the old sp.js frame exactly:
//   fleet (AI + spawn/quota/leash/cull) → pods → bonuses → ram → pod-strike →
//   projectiles → level FSM
import { Vector3 } from './vec.js';
import { Projectiles } from './weapons.js';
import { spawnPods, recentrePods, stepPods, makeBonuses, stepBonuses, bonusHitByShot, makeLevelFSM, stepLevelFSM } from './rules.js';
import { makeFleet, startFleetLevel, stepFleet, fleetCleared, checkRam, checkPodStrikes } from './enemies.js';

export function makeWorld({ K, rng = Math.random, ENEMY_TYPES, goalsForLevel, ship }) {
  return {
    K,
    rng,
    ENEMY_TYPES,
    goalsForLevel,
    ship,                 // the local ship state (client/player.js Player, or a plain ship on the server)
    fx: null,             // optional: client Audio for the enemy-laser cue

    fleet: makeFleet(),
    pods: { list: [], centroid: new Vector3(), lost: 0, total: 0 },
    bonuses: makeBonuses(K.bonuses, rng),
    projectiles: new Projectiles(K.weapons),
    fsm: makeLevelFSM(),
    score: 0,
    events: [],
  };
}

// (Re)start a level. Mirrors the RNG order of the old sp.js startLevel:
// fleet roster (no RNG) → spawnPods → makeBonuses.
export function startWorldLevel(world, n, podsPerLevel) {
  startFleetLevel(world.fleet, n, world.goalsForLevel);
  world.pods.list = spawnPods(podsPerLevel, world.ship.position, world.K.pods, world.rng);
  world.pods.total = podsPerLevel;
  world.pods.lost = 0;
  recentrePods(world.pods);
  // reset bonuses in place so the render wrapper's reference stays valid
  const b = makeBonuses(world.K.bonuses, world.rng);
  world.bonuses.list = b.list;
  world.bonuses.timer = b.timer;
  world.bonuses.maxAlive = b.maxAlive;
  world.fsm.state = 'playing';
}

// One shared tick. `dt` is the sim delta (the caller passes 0 to freeze it,
// e.g. a debug pause). Returns world.events (also stored on the world).
export function stepWorld(world, dt) {
  const events = [];
  const { ship, fleet, pods, bonuses, projectiles, K, rng } = world;

  // 1. enemies — AI, then spawn/quota/leash/cull
  const fleetCtx = { player: ship, pods, weapons: projectiles, fx: world.fx, rng, ENEMY_TYPES: world.ENEMY_TYPES };
  for (const e of stepFleet(fleet, fleetCtx, dt, K.enemy)) {
    world.score += e.e.stats.score;
    events.push(e);                                  // { kind:'enemyKilled', e }
  }

  // 2. pods — drift, cull, recentre
  stepPods(pods, dt);

  // 3. bonuses — cadence, drift, life, fly-in / shot collect
  const around = pods.list.length ? pods.centroid : ship.position;
  const got = stepBonuses(bonuses, ship, around, dt, K.bonuses, rng);
  if (got) events.push({ kind: 'bonusPicked', bonus: got.kind });

  // 4. collisions that the old loop guarded with simDt > 0
  if (dt > 0) {
    const ram = checkRam(fleet, ship, K.enemy);
    if (ram) events.push({ kind: 'ram', pos: ram.pos });
    for (const pe of checkPodStrikes(fleet, pods, K.enemy)) events.push(pe);
  }

  // 5. projectiles — motion, guidance, hit resolution
  const bonusSink = { hitByShot: (p) => bonusHitByShot(bonuses, p) };
  const pworld = { player: ship, enemies: { list: fleet.list }, pods, bonuses: bonusSink };
  for (const pe of projectiles.step(dt, pworld, K)) events.push(pe);

  // 6. level win / lose (paused while the player is dead)
  const action = stepLevelFSM(
    world.fsm,
    { podsAlive: pods.list.length, enemiesCleared: fleetCleared(fleet), level: fleet.level },
    (dt > 0 && ship.alive) ? dt : 0,
  );
  if (action) events.push({ kind: 'level', action });

  world.events = events;
  return events;
}

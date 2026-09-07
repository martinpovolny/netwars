// Enemy roster + level goals. Base stats echo the NetWars "Level Goals" screen
// (Speed Factor / Turn Factor / Shield Strength); behaviour per class is ours.

const SPEED_K = 0.19;   // Speed Factor -> u/s
const TURN_K = 0.062;   // Turn Factor  -> rad/s
const SHIELD_K = 12;    // Shield Strength -> hull hp (player projectile = 12)

export const PODS_PER_LEVEL = 6;

export const ENEMY_TYPES = {
  pirate: {
    name: 'Pirate',
    behavior: 'brawler',     // charges a pod, orbits close, strafes
    target: 'pods',
    speed: 500 * SPEED_K,
    turn: 24 * TURN_K,
    hp: 2 * SHIELD_K,
    accent: 0x35e04a,
    bulk: 0.9,
    score: 100,
    fireRange: 900,
    fireGap: [1.4, 2.4],
  },
  raider: {
    name: 'Raider',
    behavior: 'thief',       // flies to a pod, grabs it, hauls it away slowly
    target: 'pods',
    speed: 620 * SPEED_K,
    turn: 20 * TURN_K,
    hp: 2 * SHIELD_K,
    accent: 0xf0b000,
    bulk: 1.05,
    score: 120,
    fireRange: 700,
    fireGap: [1.8, 3.0],
  },
  fighter: {
    name: 'Fighter',
    behavior: 'strafer',     // fast attack runs on a pod, wide break-off, repeat
    target: 'pods',
    speed: 700 * SPEED_K,
    turn: 24 * TURN_K,
    hp: 2 * SHIELD_K,
    accent: 0x2fd0d0,
    bulk: 1.0,
    score: 150,
    fireRange: 1100,
    fireGap: [1.1, 1.9],
  },
  guardian: {
    name: 'Guardian',
    behavior: 'sniper',      // jump to a distant perch, hold, shoot the player, relocate
    target: 'player',
    speed: 1100 * SPEED_K,
    turn: 32 * TURN_K,
    hp: 4 * SHIELD_K,
    accent: 0x3a6bff,
    bulk: 1.2,
    score: 250,
    fireRange: 1500,
    fireGap: [0.9, 1.6],
  },
  commander: {
    name: 'Commander',
    behavior: 'charger',     // Newtonian charge straight at the player, momentum, overshoot
    target: 'player',
    speed: 900 * SPEED_K,
    turn: 22 * TURN_K,
    hp: 8 * SHIELD_K,
    accent: 0xd93bd0,
    bulk: 1.6,
    score: 500,
    fireRange: 1300,
    fireGap: [0.7, 1.2],
  },
};

// Kill quotas per level. The level is WON when every quota is met and pods
// remain; LOST if all pods are destroyed or stolen.
export const LEVELS = [
  { pirate: 3, raider: 1 },
  { pirate: 2, raider: 2, fighter: 2 },
  { fighter: 3, raider: 2, guardian: 1, commander: 1 },
  { pirate: 2, fighter: 2, raider: 3, guardian: 2, commander: 1 },
];

export function goalsForLevel(n) {
  if (n - 1 < LEVELS.length) return { ...LEVELS[n - 1] };
  return {
    fighter: 2 + n,
    raider: 1 + Math.floor(n / 2),
    guardian: Math.floor(n / 2),
    commander: Math.floor(n / 3),
  };
}

// Enemy roster + level goals, modelled on the NetWars "Level Goals" screen
// (Speed Factor / Turn Factor / Shield Strength per class).

// Raw NetWars factors are large integers; scale them into game units here.
const SPEED_K = 0.19;   // Speed Factor -> u/s
const TURN_K = 0.062;   // Turn Factor  -> rad/s
const SHIELD_K = 12;    // Shield Strength -> hull hp (projectile = 12)

export const ENEMY_TYPES = {
  pirate: {
    name: 'Pirate',
    speed: 500 * SPEED_K,
    turn: 24 * TURN_K,
    hp: 2 * SHIELD_K,
    accent: 0x35e04a,
    bulk: 0.85,
    score: 100,
    fireRange: 1000,
    fireGap: [1.4, 2.4],
  },
  fighter: {
    name: 'Fighter',
    speed: 700 * SPEED_K,
    turn: 24 * TURN_K,
    hp: 2 * SHIELD_K,
    accent: 0x2fd0d0,
    bulk: 1.0,
    score: 150,
    fireRange: 1150,
    fireGap: [1.1, 1.9],
  },
  guardian: {
    name: 'Guardian',
    speed: 1100 * SPEED_K,
    turn: 32 * TURN_K,
    hp: 4 * SHIELD_K,
    accent: 0x3a6bff,
    bulk: 1.25,
    score: 250,
    fireRange: 1300,
    fireGap: [0.9, 1.6],
  },
  commander: {
    name: 'Commander',
    speed: 900 * SPEED_K,
    turn: 32 * TURN_K,
    hp: 8 * SHIELD_K,
    accent: 0xd93bd0,
    bulk: 1.5,
    score: 500,
    fireRange: 1400,
    fireGap: [0.8, 1.4],
  },
};

// Kill quotas per level. Past the table, quotas are generated.
export const LEVELS = [
  { pirate: 4 },
  { pirate: 2, fighter: 3, commander: 1 },
  { fighter: 4, guardian: 2, commander: 1 },
  { fighter: 3, guardian: 3, commander: 2 },
];

export function goalsForLevel(n) {
  if (n - 1 < LEVELS.length) return { ...LEVELS[n - 1] };
  const g = { fighter: 2 + n, guardian: Math.floor(n / 2), commander: Math.floor(n / 3) };
  return g;
}

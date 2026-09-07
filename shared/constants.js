// Gameplay tuning — single source of truth, shared by the SP client, the MP
// client, and (via the same JSON) the Go server. Edit constants.json.
import K from './constants.json' with { type: 'json' };

export default K;
export { K };

// derived enemy-type table: applies speedK / turnK / shieldK to the raw factors
// and resolves the accent hex string to a THREE-friendly integer.
const e = K.enemy;
export const ENEMY_TYPES = Object.fromEntries(
  Object.entries(K.types).map(([key, t]) => [key, {
    ...t,
    key,
    accent: parseInt(t.accent.slice(1), 16),
    speed: t.speedFactor * e.speedK,
    turn: t.turnFactor * e.turnK,
    hp: t.shield * e.shieldK,
  }])
);

export function goalsForLevel(n) {
  if (n - 1 < K.levels.length) return { ...K.levels[n - 1] };
  const g = {};
  for (const [type, [base, per]] of Object.entries(K.levelsBeyond)) {
    const v = Math.floor(base + per * n);
    if (v > 0) g[type] = v;
  }
  return g;
}

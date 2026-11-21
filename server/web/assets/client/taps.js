// What a tap/click on the screen should do in single-player. Touch devices
// have no keyboard, so "press any key" (relaunch after death, dismiss the game
// over screen) must also be reachable by tapping. Pure so it can be tested.
export const RESPAWN_DELAY_MS = 700;   // same beat as the keyboard path

// state: { alive, goState, now, deadAt, goReadyAt } — goState is sp.js's
// game-over state machine (null while playing).
// Returns 'newRun' | 'respawn' | null.
export function tapAction({ alive, goState, now, deadAt, goReadyAt }) {
  if (goState) {
    // game over owns the screen; only the results/plain screens take a tap
    // (the name prompt has its own SUBMIT / SKIP buttons)
    return (goState === 'table' || goState === 'plain') && now >= goReadyAt ? 'newRun' : null;
  }
  if (!alive && now - deadAt > RESPAWN_DELAY_MS) return 'respawn';
  return null;
}

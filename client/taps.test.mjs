import test from 'node:test';
import assert from 'node:assert/strict';
import { tapAction, RESPAWN_DELAY_MS } from './taps.js';

const base = { alive: true, goState: null, now: 10_000, deadAt: 0, goReadyAt: 0 };

test('RESPAWN_DELAY_MS matches the keyboard path (700 ms)', () => {
  assert.equal(RESPAWN_DELAY_MS, 700);
});

test('alive and playing: a tap does nothing', () => {
  assert.equal(tapAction(base), null);
});

test('dead: a tap respawns after the beat', () => {
  assert.equal(tapAction({ ...base, alive: false, deadAt: 10_000 - 701 }), 'respawn');
});

test('dead: a tap inside the 700 ms beat is ignored', () => {
  assert.equal(tapAction({ ...base, alive: false, deadAt: 10_000 - 100 }), null);
});

test('game over, results shown: a tap starts a new run once the guard has passed', () => {
  assert.equal(tapAction({ ...base, alive: false, goState: 'table', goReadyAt: 9_999 }), 'newRun');
  assert.equal(tapAction({ ...base, alive: false, goState: 'plain', goReadyAt: 10_000 }), 'newRun');
});

test('game over: a tap inside the guard window is ignored', () => {
  assert.equal(tapAction({ ...base, alive: false, goState: 'table', goReadyAt: 10_500 }), null);
});

test('game over: taps never act while probing, entering a name or submitting', () => {
  for (const goState of ['wait', 'entry', 'submitting']) {
    assert.equal(tapAction({ ...base, alive: false, goState }), null, goState);
  }
});

test('game over beats the dead-respawn path (dead player must not respawn into a finished run)', () => {
  assert.equal(tapAction({ ...base, alive: false, goState: 'entry', deadAt: 0 }), null);
});

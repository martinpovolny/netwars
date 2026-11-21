import test from 'node:test';
import assert from 'node:assert/strict';
import { Run, LIVES, POD_BONUS } from './run.js';

test('a new run starts with 3 lives, no bonus, not over', () => {
  const r = new Run();
  assert.equal(LIVES, 3);
  assert.equal(POD_BONUS, 500);
  assert.equal(r.lives, 3);
  assert.equal(r.bonusScore, 0);
  assert.equal(r.isOver, false);
});

test('levelCleared(3, 6) awards 9000 and a life', () => {
  const r = new Run();
  assert.equal(r.levelCleared(3, 6), 9000);
  assert.equal(r.bonusScore, 9000);
  assert.equal(r.lives, 4);
});

test('pod bonuses accumulate across levels', () => {
  const r = new Run();
  r.levelCleared(1, 6);   // 3000
  r.levelCleared(2, 4);   // 4000
  assert.equal(r.bonusScore, 7000);
});

test('clearing a level with no pods left still grants the life', () => {
  const r = new Run();
  assert.equal(r.levelCleared(1, 0), 0);
  assert.equal(r.lives, 4);
});

test('losing all lives ends the run', () => {
  const r = new Run();
  r.loseLife(); r.loseLife();
  assert.equal(r.isOver, false);
  r.loseLife();
  assert.equal(r.lives, 0);
  assert.equal(r.isOver, true);
});

test('lives never go below zero', () => {
  const r = new Run();
  for (let i = 0; i < 6; i++) r.loseLife();
  assert.equal(r.lives, 0);
});

test('lives have no cap', () => {
  const r = new Run();
  for (let i = 1; i <= 10; i++) r.levelCleared(i, 1);
  assert.equal(r.lives, 13);
});

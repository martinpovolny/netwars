import test from 'node:test';
import assert from 'node:assert/strict';
import { pickGuidedTarget, isGuidedBolt } from './aim.js';

test('isGuidedBolt: SP (a player bolt that carries a target) and co-op (wire kind "gbolt")', () => {
  assert.equal(isGuidedBolt('bolt', 'player', { dead: false }), true);   // SP sim: locked player bolt
  assert.equal(isGuidedBolt('gbolt', 'player', null), true);             // co-op snapshot
  assert.equal(isGuidedBolt('bolt', 'player', null), false);             // plain cannon
  assert.equal(isGuidedBolt('bolt', 'player', undefined), false);        // co-op store has no targets
  assert.equal(isGuidedBolt('bolt', 'enemy', { dead: false }), false);   // enemy shots are never "guided" visuals
  assert.equal(isGuidedBolt('missile', 'player', { dead: false }), false);
  assert.equal(isGuidedBolt('lance', 'enemy', null), false);
});

const P = (x, y, z) => ({ x, y, z });
const en = (x, y, z, extra = {}) => ({ position: P(x, y, z), dead: false, ...extra });
const FWD = P(0, 0, -1);   // an un-rotated ship looks down -Z
const CONE = 30;

test('empty list -> null', () => {
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [], CONE), null);
});

test('the enemy closest to the crosshair beats the one closest to the ship', () => {
  const ahead = en(0, 0, -900);          // on the nose, far away
  const offAxis = en(150, 0, -300);      // ~26.6 deg off, much nearer
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [offAxis, ahead], CONE), ahead);
});

test('enemies outside the cone, behind the ship, or dead are ignored', () => {
  const outside = en(400, 0, -300);      // ~53 deg
  const behind = en(0, 0, 100);
  const dead = en(0, 0, -100, { dead: true });
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [outside, behind, dead], CONE), null);
});

test('the cone angle is honoured', () => {
  const e = en(150, 0, -300);            // ~26.6 deg off
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [e], 20), null);
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [e], 30), e);
});

test('equal angle: the nearer enemy wins', () => {
  const far = en(0, 0, -900), near = en(0, 0, -300);
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [far, near], CONE), near);
});

test('works from a non-origin position and a rotated nose', () => {
  const pos = P(1000, 0, 0);
  const fwd = P(1, 0, 0);                // nose pointing +X
  const target = en(1800, 50, 0);
  const wrongWay = en(200, 0, 0);        // nearer, but behind the nose
  assert.equal(pickGuidedTarget(pos, fwd, [wrongWay, target], CONE), target);
});

test('an enemy exactly on the ship counts as dead ahead (no NaN)', () => {
  const onTop = en(0, 0, 0);
  assert.equal(pickGuidedTarget(P(0, 0, 0), FWD, [onTop], CONE), onTop);
});

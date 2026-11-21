import test from 'node:test';
import assert from 'node:assert/strict';
import { interceptPoint } from './intercept.js';

const P = (x, y, z) => ({ x, y, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const SPEED = 1500;

test('a stationary target is aimed at directly', () => {
  const aim = interceptPoint(P(0, 0, 0), SPEED, P(100, 20, -900), P(0, 0, 0), 1, 1.5);
  assert.deepEqual(aim, P(100, 20, -900));
});

test('a crossing target is led: the aim point is where it will be when the bolt arrives', () => {
  const tpos = P(0, 0, -900), tvel = P(300, 0, 0);
  const aim = interceptPoint(P(0, 0, 0), SPEED, tpos, tvel, 1, 1.5);
  const T = dist(aim, P(0, 0, 0)) / SPEED;                       // bolt flight time to the aim point
  assert.ok(aim.x > 0, 'leads in the direction the target is moving');
  assert.ok(Math.abs(aim.x - (tpos.x + tvel.x * T)) < 1, 'aim = target position after the flight time');
  assert.ok(Math.abs(aim.z - tpos.z) < 1e-6);
});

test('lead scales the offset: 0 = aim at the target, 0.5 = halfway', () => {
  const tpos = P(0, 0, -900), tvel = P(300, 0, 0);
  const full = interceptPoint(P(0, 0, 0), SPEED, tpos, tvel, 1, 1.5);
  const none = interceptPoint(P(0, 0, 0), SPEED, tpos, tvel, 0, 1.5);
  const half = interceptPoint(P(0, 0, 0), SPEED, tpos, tvel, 0.5, 1.5);
  assert.deepEqual(none, tpos);
  assert.ok(half.x > 0 && half.x < full.x);
});

test('flight time is capped (far targets are not led absurdly)', () => {
  const tpos = P(0, 0, -90000), tvel = P(300, 0, 0);
  const aim = interceptPoint(P(0, 0, 0), SPEED, tpos, tvel, 1, 1.5);
  assert.ok(Math.abs(aim.x - 300 * 1.5) < 1e-6, `capped at maxT: x = ${aim.x}`);
});

test('a target running away faster than the bolt stays finite (capped)', () => {
  const aim = interceptPoint(P(0, 0, 0), SPEED, P(0, 0, -500), P(0, 0, -3000), 1, 1.5);
  for (const c of [aim.x, aim.y, aim.z]) assert.ok(Number.isFinite(c));
  assert.ok(Math.abs(aim.z - (-500 + -3000 * 1.5)) < 1e-6);
});

test('zero bolt speed or an enemy on top of the shooter gives no NaN', () => {
  const a = interceptPoint(P(0, 0, 0), 0, P(0, 0, -500), P(100, 0, 0), 1, 1.5);
  assert.deepEqual(a, P(0, 0, -500));
  const b = interceptPoint(P(0, 0, 0), SPEED, P(0, 0, 0), P(100, 0, 0), 1, 1.5);
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
});

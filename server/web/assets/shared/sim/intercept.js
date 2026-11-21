// Where to aim a projectile of the given speed so it meets a moving target:
// the target's position after the bolt's flight time (first-order, constant
// target velocity). Pure — reads only {x,y,z} — so it needs no THREE and is
// unit-tested in node. The Go twin is interceptPoint in server/game/guided.go.
//
//   lead  — 0 = aim at the target where it is now, 1 = full lead
//   maxT  — cap on the flight time used (seconds), so far-away or fleeing
//           targets are not led absurdly
export function interceptPoint(pos, speed, tpos, tvel, lead, maxT) {
  if (!(speed > 0) || lead === 0) return { x: tpos.x, y: tpos.y, z: tpos.z };
  const flight = (a) => Math.hypot(a.x - pos.x, a.y - pos.y, a.z - pos.z) / speed;
  const at = (T) => ({
    x: tpos.x + tvel.x * T * lead,
    y: tpos.y + tvel.y * T * lead,
    z: tpos.z + tvel.z * T * lead,
  });
  let T = flight(tpos);
  let aim = tpos;
  for (let k = 0; k < 3; k++) {            // the flight time depends on the aim point: iterate
    aim = at(Math.min(T, maxT));
    T = flight(aim);
  }
  return at(Math.min(T, maxT));
}

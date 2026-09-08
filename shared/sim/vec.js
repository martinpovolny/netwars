// The only place shared/sim/ is allowed to touch three: pure math primitives
// (Vector3 / Quaternion / Euler / Vector2 / MathUtils). No scene, mesh, or
// geometry. The Go server reimplements these as plain structs with the same
// operation order.
export { Vector3, Quaternion, Euler, Vector2, MathUtils } from 'three';

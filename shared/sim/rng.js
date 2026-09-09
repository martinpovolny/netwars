// Seeded RNG for the shared sim.
//
// The SP client is happy with Math.random, but the co-op server (M2) must be
// deterministic: every arena is seeded from its `session_id` string so the Go
// server and each JS client generate the identical enemy waves, pod cluster,
// bonus cadence, AI jitter, etc. without streaming any of it.
//
// This is a plain xorshift128 producing a float in [0, 1). The Go twin
// (`server/game/rng.go`) mirrors it bit-for-bit, so `mulberry`/`Math.random`
// must NOT be substituted here — the exact integer recurrence is the contract.
//
// Usage:
//   const rng = makeRng('eneas');       // or makeRng(12345)
//   rng();                              // -> 0.something, deterministic
//   const r2 = makeRng('eneas'); r2();  // -> same first value
//
// Every shared/sim function that consumes randomness takes an `rng` argument
// defaulting to Math.random, so existing SP call sites are unaffected.

// FNV-1a over the UTF-16 code units of a string, then split into four 32-bit
// lanes for the xorshift state. Numbers are used directly (low 32 bits).
function seedState(seed) {
  let h = 0x811c9dc5;
  const s = typeof seed === 'number' ? String(seed >>> 0) : String(seed ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  // scramble h into 4 non-zero lanes
  const lane = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;  h >>>= 0;
    return h || 0x9e3779b9;
  };
  return [lane(), lane(), lane(), lane()];
}

// xorshift128 (Marsaglia 2003). Returns a function -> float in [0, 1).
export function makeRng(seed) {
  const st = seedState(seed);
  let x = st[0], y = st[1], z = st[2], w = st[3];
  return function rng() {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    // 32-bit int -> [0, 1): divide by 2^32
    return w / 4294967296;
  };
}

// A drop-in that just wraps Math.random, so code can always call `rng()`
// regardless of whether it was handed a seeded one.
export const systemRng = Math.random;

// Convenience: uniform in [min, max).
export function range(rng, min, max) {
  return min + (max - min) * rng();
}

// A unit vector, uniform on the sphere. This is byte-for-byte
// THREE.Vector3.randomDirection() — same two draws in the same order, same
// axis mapping — so `randomDir(Math.random, v)` == `v.randomDirection()`.
// Passing a seeded rng makes it reproducible for the server. Writes into
// `out` ({x,y,z}) and returns it.
export function randomDir(rng, out) {
  const r = rng() * Math.PI * 2;
  const z = rng() * 2 - 1;
  const zScale = Math.sqrt(1 - z * z);
  out.x = Math.cos(r) * zScale;
  out.y = Math.sin(r) * zScale;
  out.z = z;
  return out;
}

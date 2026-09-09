package game

// Seeded RNG — the Go twin of shared/sim/rng.js. The integer recurrence must
// stay bit-for-bit identical: same FNV-1a seed hash, same xorshift128, same
// float mapping (w / 2^32). Every arena seeds from its session_id so the
// server and each JS client generate the same world.

// Rng is xorshift128; call Float64() for a value in [0, 1).
type Rng struct{ x, y, z, w uint32 }

// NewRng mirrors makeRng(seed) in rng.js. Only a string seed is supported here
// (session ids are strings); rng.js also accepts a number, stringified.
func NewRng(seed string) *Rng {
	// FNV-1a over the code units (ASCII bytes) of the seed string.
	var h uint32 = 0x811c9dc5
	for i := 0; i < len(seed); i++ {
		h ^= uint32(seed[i])
		h *= 0x01000193
	}
	// scramble h into four non-zero lanes
	lane := func() uint32 {
		h ^= h << 13
		h ^= h >> 17
		h ^= h << 5
		if h == 0 {
			return 0x9e3779b9
		}
		return h
	}
	return &Rng{lane(), lane(), lane(), lane()}
}

// Float64 returns the next value in [0, 1). Matches rng.js's returned rng().
func (r *Rng) Float64() float64 {
	t := r.x ^ (r.x << 11)
	r.x, r.y, r.z = r.y, r.z, r.w
	r.w = r.w ^ (r.w >> 19) ^ (t ^ (t >> 8))
	return float64(r.w) / 4294967296.0
}

// U32 returns the raw 32-bit state after one step — handy for parity tests
// (Float64 is exactly U32 / 2^32).
func (r *Rng) U32() uint32 {
	t := r.x ^ (r.x << 11)
	r.x, r.y, r.z = r.y, r.z, r.w
	r.w = r.w ^ (r.w >> 19) ^ (t ^ (t >> 8))
	return r.w
}

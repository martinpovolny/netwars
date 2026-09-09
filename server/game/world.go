package game

// World is the Go twin of shared/sim/world.js — the authoritative shared state
// for one arena. StepWorld advances it one tick and returns the events the
// arena broadcasts to clients.
//
// M2.2: skeleton only. The function-for-function port of stepShip / stepEnemy /
// Projectiles.step / rules lands in M2.3, verified against testdata/golden.json.

type Vec = Vec3 // reuse the golden aliases for now; M2.3 gives these methods

type Ship struct {
	Pos, Vel Vec3
	Quat     Quat
	Hull     float64
	Missiles int
	Alive    bool
	Invuln   float64
}

type World struct {
	K     *Constants
	Rng   *Rng
	Ship  *Ship
	Score int
	Level int
	// fleet / pods / bonuses / projectiles / fsm — added in M2.3
}

type Event struct {
	Kind string
	// payload fields added with the port
}

// NewWorld seeds an arena from its session id.
func NewWorld(k *Constants, seed string) *World {
	return &World{
		K:    k,
		Rng:  NewRng(seed),
		Ship: &Ship{Alive: true, Hull: k.Player.MaxHull, Missiles: int(k.Player.MaxMissiles)},
	}
}

// StepWorld advances the shared world by dt seconds. Not implemented yet.
func (w *World) StepWorld(dt float64) []Event {
	panic("game.StepWorld: not implemented until M2.3")
}

package game

// World is the Go twin of shared/sim/world.js — the authoritative shared state
// for one arena. The local player's ship is integrated elsewhere (client
// prediction / server input integration); StepWorld runs everything the shared
// world owns: fleet -> pods -> bonuses -> ram -> pod-strike -> projectiles ->
// level FSM, returning a flat []Event.

// Ship is the minimal ship state the shared sim reads + mutates (the Go twin
// of the bits of client/player.js that shared code touches).
type Ship struct {
	Pos, Vel    Vec3
	Quat        Quat
	Hull        float64
	MaxHull     float64
	Missiles    int
	MaxMissiles float64
	Alive       bool
	Invuln      float64
	HitPulse    float64
}

// Damage — Player.damage without the audio side effect.
func (s *Ship) Damage(amount float64) {
	if !s.Alive || s.Invuln > 0 {
		return
	}
	s.Hull -= amount
	s.HitPulse = 1
	if s.Hull <= 0 {
		s.Hull = 0
		s.Alive = false
	}
}

// Event is one thing that happened this tick, for the arena to broadcast.
type Event struct {
	Kind     string
	Pos      Vec3
	Absorbed bool        // playerHit: soaked by invuln
	Hurt     bool        // ram: damage actually landed
	Bonus    string      // bonusPicked: "missiles" | "repair"
	Enemy    *Enemy      // enemyKilled: for scoring / kill feed
	Action   LevelAction // level: what the FSM decided
}

type World struct {
	K           *Constants
	Rng         *Rng
	Ship        *Ship
	Fleet       *Fleet
	Pods        *Pods
	Bonuses     *Bonuses
	Projectiles *Projectiles
	FSM         *LevelFSM
	Score       int
	Events      []Event
}

// NewWorld seeds an arena from its session id. Matches makeWorld's RNG use
// (one draw for the bonus timer).
func NewWorld(k *Constants, seed string) *World {
	rng := NewRng(seed)
	return &World{
		K:   k,
		Rng: rng,
		Ship: &Ship{
			Alive: true, Hull: k.Player.MaxHull, MaxHull: k.Player.MaxHull,
			Missiles: int(k.Player.MaxMissiles), MaxMissiles: k.Player.MaxMissiles,
			Quat: Quat{0, 0, 0, 1},
		},
		Fleet:       makeFleet(),
		Pods:        &Pods{},
		Bonuses:     makeBonuses(k.Bonuses, rng),
		Projectiles: newProjectiles(k.Weapons),
		FSM:         makeLevelFSM(),
	}
}

// StartWorldLevel — (re)start level n. RNG order matches startWorldLevel:
// startFleetLevel (no RNG) -> spawnPods -> makeBonuses (1 draw).
func (w *World) StartWorldLevel(n, podsPerLevel int) {
	startFleetLevel(w.Fleet, n, w.K)
	w.Pods.List = spawnPods(podsPerLevel, w.Ship.Pos, w.K.Pods, w.Rng)
	w.Pods.Total = podsPerLevel
	w.Pods.Lost = 0
	recentrePods(w.Pods)
	nb := makeBonuses(w.K.Bonuses, w.Rng)
	w.Bonuses.List = nil
	w.Bonuses.Timer = nb.Timer
	w.Bonuses.MaxAlive = nb.MaxAlive
	w.FSM.State = "playing"
}

// StepWorld advances the shared world by dt seconds and returns its events.
func (w *World) StepWorld(dt float64) []Event {
	var events []Event
	ke := w.K.Enemy

	// 1. enemies
	for _, ev := range stepFleet(w.Fleet, w, dt, w.K) {
		w.Score += int(ev.Enemy.Stats.Score)
		events = append(events, ev)
	}

	// 2. pods
	stepPods(w.Pods, dt)

	// 3. bonuses
	around := w.Ship.Pos
	if len(w.Pods.List) > 0 {
		around = w.Pods.Centroid
	}
	if kind := stepBonuses(w.Bonuses, w.Ship, around, dt, w.K.Bonuses, w.Rng); kind != "" {
		events = append(events, Event{Kind: "bonusPicked", Bonus: kind})
	}

	// 4. ram + pod strikes (the old loop guarded these with simDt > 0)
	if dt > 0 {
		if ram, ok := checkRam(w.Fleet, w.Ship, ke); ok {
			events = append(events, ram)
		}
		events = append(events, checkPodStrikes(w.Fleet, w.Pods, ke)...)
	}

	// 5. projectiles
	events = append(events, w.Projectiles.Step(dt, w)...)

	// 6. level win / lose
	gate := 0.0
	if dt > 0 && w.Ship.Alive {
		gate = dt
	}
	if act, ok := stepLevelFSM(w.FSM, len(w.Pods.List), fleetCleared(w.Fleet), w.Fleet.Level, gate); ok {
		events = append(events, Event{Kind: "level", Action: act})
	}

	w.Events = events
	return events
}

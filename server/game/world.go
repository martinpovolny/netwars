package game

import "math"

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
	Killer   string      // frag (dm): player id that scored the kill
	Victim   string      // frag (dm): player id that died
}

type World struct {
	K   *Constants
	Rng *Rng
	// Ship is the "focus" ship (pods spawn around it, the level FSM watches
	// it). Ships is every player ship in the arena — enemy AI, fire and rams
	// resolve against all of them. In SP / the golden test there is exactly
	// one, so the two are the same pointer and behaviour is unchanged.
	Ship        *Ship
	Ships       []*Ship
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

// shipList is every player ship, falling back to the focus ship (SP / golden
// build a 1-ship world and never populate Ships).
func (w *World) shipList() []*Ship {
	if len(w.Ships) > 0 {
		return w.Ships
	}
	return []*Ship{w.Ship}
}

// aimShip is the ship an enemy at `from` should target — the nearest live
// one, else the focus ship (so a fight never goes fully passive).
func (w *World) aimShip(from Vec3) *Ship {
	best := w.Ship
	bd := math.Inf(1)
	for _, s := range w.shipList() {
		if !s.Alive {
			continue
		}
		if d := from.DistanceToSq(s.Pos); d < bd {
			bd, best = d, s
		}
	}
	return best
}

// applyBonus — the server-side effect of a collected pod (client/sp.js does
// this for SP; the co-op server owns hull/missiles so it does it here).
func applyBonus(s *Ship, kind string, k *Constants) {
	if kind == "repair" {
		s.Hull = math.Min(s.MaxHull, s.Hull+k.Bonuses["repairAmount"])
	} else {
		s.Missiles = int(math.Min(k.Player.MaxMissiles, float64(s.Missiles)+k.Bonuses["missileAmount"]))
	}
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

	// 3. bonuses. stepBonuses runs the cadence/drift and the focus ship's
	// pickup; sweep the rest here so any co-op player can grab one. Unlike SP
	// (where client/sp.js applies the effect on the event) the server owns the
	// hull/missiles, so it heals the ship that actually touched the pod.
	around := w.Ship.Pos
	if len(w.Pods.List) > 0 {
		around = w.Pods.Centroid
	}
	if kind := stepBonuses(w.Bonuses, w.Ship, around, dt, w.K.Bonuses, w.Rng); kind != "" {
		applyBonus(w.Ship, kind, w.K)
		events = append(events, Event{Kind: "bonusPicked", Bonus: kind})
	}
	if len(w.Ships) > 1 {
		for _, bo := range w.Bonuses.List {
			if bo.Dead {
				continue
			}
			for _, sh := range w.Ships {
				if sh == w.Ship || !sh.Alive {
					continue
				}
				if bo.Position.DistanceToSq(sh.Pos) < bo.Radius*bo.Radius {
					bo.Dead = true
					applyBonus(sh, bo.Kind, w.K)
					events = append(events, Event{Kind: "bonusPicked", Bonus: bo.Kind})
					break
				}
			}
		}
	}

	// 4. ram + pod strikes (the old loop guarded these with simDt > 0)
	if dt > 0 {
		for _, sh := range w.shipList() {
			if ram, ok := checkRam(w.Fleet, sh, ke); ok {
				events = append(events, ram)
			}
		}
		events = append(events, checkPodStrikes(w.Fleet, w.Pods, ke)...)
	}

	// 5. projectiles
	events = append(events, w.Projectiles.Step(dt, w)...)

	// 6. level win / lose — runs while ANY player ship is alive (a dead co-op
	// player is respawning, not game-over)
	anyAlive := false
	for _, sh := range w.shipList() {
		if sh.Alive {
			anyAlive = true
			break
		}
	}
	gate := 0.0
	if dt > 0 && anyAlive {
		gate = dt
	}
	if act, ok := stepLevelFSM(w.FSM, len(w.Pods.List), fleetCleared(w.Fleet), w.Fleet.Level, gate); ok {
		events = append(events, Event{Kind: "level", Action: act})
	}

	w.Events = events
	return events
}

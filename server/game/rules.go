package game

import "strconv"

// Pods, bonuses and the level FSM — the Go twin of shared/sim/rules.js.
// RNG draw order matches the JS exactly (see comments).

// ---- pods -----------------------------------------------------------------

type Pod struct {
	Position Vec3
	Velocity Vec3
	Spin     Vec3
	HP       float64
	Radius   float64
	Dead     bool
	Captor   *Enemy
}

type Pods struct {
	List     []*Pod
	Centroid Vec3
	Lost     int
	Total    int
}

// spawnPods — 9 rng draws per pod: spin(3), dir(2)+mag(1), dir(2)+mag(1).
func spawnPods(count int, around Vec3, kp Block, rng *Rng) []*Pod {
	list := make([]*Pod, 0, count)
	for i := 0; i < count; i++ {
		spin := Vec3{
			(rng.Float64() - 0.5) * kp["spinRange"],
			(rng.Float64() - 0.5) * kp["spinRange"],
			(rng.Float64() - 0.5) * kp["spinRange"],
		}
		var pos, vel Vec3
		RandomDir(rng, &pos)
		pos.MultiplyScalar(kp["spawnMin"] + rng.Float64()*kp["spawnRange"]).Add(around)
		RandomDir(rng, &vel)
		vel.MultiplyScalar(kp["driftMin"] + rng.Float64()*kp["driftRange"])
		list = append(list, &Pod{
			Position: pos, Velocity: vel, Spin: spin,
			HP: kp["hp"], Radius: kp["radius"],
		})
	}
	return list
}

func recentrePods(p *Pods) {
	if len(p.List) == 0 {
		return
	}
	c := Vec3{}
	for _, pd := range p.List {
		c.Add(pd.Position)
	}
	c.MultiplyScalar(1 / float64(len(p.List)))
	p.Centroid = c
}

func stepPods(p *Pods, dt float64) {
	for _, pd := range p.List {
		if !pd.Dead && pd.Captor == nil {
			pd.Position.AddScaledVector(pd.Velocity, dt)
		}
	}
	keep := p.List[:0:0]
	for _, pd := range p.List {
		if pd.Dead {
			p.Lost++
		} else {
			keep = append(keep, pd)
		}
	}
	p.List = keep
	recentrePods(p)
}

// ---- bonuses ------------------------------------------------------------

type Bonus struct {
	Kind      string // "missiles" | "repair"
	T         float64
	Position  Vec3
	Velocity  Vec3
	Radius    float64
	Life      float64
	Dead      bool
	Collected bool
}

type Bonuses struct {
	List     []*Bonus
	Timer    float64
	MaxAlive int
}

func makeBonuses(kb Block, rng *Rng) *Bonuses {
	return &Bonuses{
		Timer:    kb["firstDelayMin"] + rng.Float64()*kb["firstDelayRange"],
		MaxAlive: int(kb["maxAlive"]),
	}
}

// spawnBonus draw order: kind (0 or 1 — only when both/neither wanted), _t(1),
// dir(2)+mag(1), dir(2)+mag(1).
func spawnBonus(b *Bonuses, around Vec3, ship *Ship, kb Block, rng *Rng) {
	wantRepair := ship.Hull < ship.MaxHull*kb["wantRepairBelow"]
	wantMsl := float64(ship.Missiles) < ship.MaxMissiles*kb["wantMissilesBelow"]
	var kind string
	switch {
	case wantRepair && !wantMsl:
		kind = "repair"
	case wantMsl && !wantRepair:
		kind = "missiles"
	default:
		if rng.Float64() < 0.5 {
			kind = "repair"
		} else {
			kind = "missiles"
		}
	}
	t := rng.Float64() * 6
	var pos, vel Vec3
	RandomDir(rng, &pos)
	pos.MultiplyScalar(kb["spawnMin"] + rng.Float64()*kb["spawnRange"]).Add(around)
	RandomDir(rng, &vel)
	vel.MultiplyScalar(kb["driftMin"] + rng.Float64()*kb["driftRange"])
	b.List = append(b.List, &Bonus{
		Kind: kind, T: t, Position: pos, Velocity: vel,
		Radius: kb["radius"], Life: kb["life"],
	})
}

func bonusHitByShot(b *Bonuses, pos Vec3) bool {
	for _, bo := range b.List {
		if bo.Dead {
			continue
		}
		if pos.DistanceToSq(bo.Position) < bo.Radius*bo.Radius {
			bo.Collected = true
			return true
		}
	}
	return false
}

// stepBonuses returns the kind collected this tick, or "".
func stepBonuses(b *Bonuses, ship *Ship, around Vec3, dt float64, kb Block, rng *Rng) string {
	collected := ""

	b.Timer -= dt
	if b.Timer <= 0 && len(b.List) < b.MaxAlive {
		b.Timer = kb["respawnMin"] + rng.Float64()*kb["respawnRange"]
		spawnBonus(b, around, ship, kb, rng)
	}

	for _, bo := range b.List {
		if bo.Dead {
			continue
		}
		bo.T += dt
		bo.Life -= dt
		if bo.Life <= 0 {
			bo.Dead = true
		}
		bo.Position.AddScaledVector(bo.Velocity, dt)
		if bo.Collected || (ship.Alive && bo.Position.DistanceToSq(ship.Pos) < bo.Radius*bo.Radius) {
			bo.Dead = true
			collected = bo.Kind
		}
	}

	keep := b.List[:0:0]
	for _, bo := range b.List {
		if !bo.Dead {
			keep = append(keep, bo)
		}
	}
	b.List = keep
	return collected
}

// ---- level FSM --------------------------------------------------------

type LevelFSM struct {
	State string // "playing" | "won" | "lost"
	Timer float64
}

func makeLevelFSM() *LevelFSM { return &LevelFSM{State: "playing"} }

// LevelAction is the FSM's output for a tick (zero value = nothing).
type LevelAction struct {
	Flash      string
	Hold       float64
	StartLevel int // 0 = none
}

func stepLevelFSM(f *LevelFSM, podsAlive int, enemiesCleared bool, level int, dt float64) (LevelAction, bool) {
	if dt <= 0 {
		return LevelAction{}, false
	}
	if f.State == "playing" {
		if podsAlive == 0 {
			f.State = "lost"
			f.Timer = 3.0
			return LevelAction{Flash: "ALL PODS LOST — LEVEL FAILED", Hold: 3.0}, true
		}
		if enemiesCleared {
			f.State = "won"
			f.Timer = 2.8
			return LevelAction{Flash: "LEVEL " + strconv.Itoa(level) + " CLEARED", Hold: 2.8}, true
		}
		return LevelAction{}, false
	}
	f.Timer -= dt
	if f.Timer <= 0 {
		next := level
		if f.State == "won" {
			next = level + 1
		}
		f.State = "playing"
		return LevelAction{StartLevel: next}, true
	}
	return LevelAction{}, false
}

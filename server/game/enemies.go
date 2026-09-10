package game

import "math"

// Enemy fleet — the Go twin of shared/sim/enemies.js: makeEnemyState, the
// roster (spawn cadence / quota / leash / cull), and checkRam / checkPodStrikes.

type goalEntry struct {
	Type string
	N    int
}

type Fleet struct {
	List    []*Enemy
	Level   int
	Goals   []goalEntry // ordered — matches the JSON key order of the level table
	Pending []goalEntry
	NextID  int // monotonic per arena — a stable handle for the client to match on
}

func makeFleet() *Fleet { return &Fleet{} }

func cloneGoals(g []goalEntry) []goalEntry {
	out := make([]goalEntry, len(g))
	copy(out, g)
	return out
}

func startFleetLevel(f *Fleet, n int, k *Constants) {
	f.List = nil
	f.Level = n
	f.Goals = k.goalsForLevelOrdered(n)
	f.Pending = cloneGoals(f.Goals)
}

func goalSum(g []goalEntry) int {
	s := 0
	for _, e := range g {
		s += e.N
	}
	return s
}
func fleetPendingRemaining(f *Fleet) int { return goalSum(f.Pending) }
func fleetGoalsRemaining(f *Fleet) int   { return goalSum(f.Goals) }
func fleetCleared(f *Fleet) bool {
	return fleetGoalsRemaining(f) == 0 && len(f.List) == 0
}

func decGoal(g []goalEntry, typ string) {
	for i := range g {
		if g[i].Type == typ && g[i].N > 0 {
			g[i].N--
			return
		}
	}
}

// makeEnemyState — 2 rng draws: fireCd, strafeSign. Derives speed/turn/hp/etc.
// from K.types + K.enemy exactly as ENEMY_TYPES does in shared/constants.js.
func makeEnemyState(typeKey string, k *Constants, rng *Rng) *Enemy {
	t := k.Types[typeKey]
	ke := k.Enemy

	speed := t.SpeedFactor * ke["speedK"]
	turn := t.TurnFactor * ke["turnK"]
	hp := t.Shield * ke["shieldK"]

	var fg [2]float64
	if len(t.FireGap) >= 2 {
		fg[0], fg[1] = t.FireGap[0], t.FireGap[1]
	}

	e := &Enemy{
		Type:     typeKey,
		Behavior: t.Behavior,
		HP:       hp,
		Radius:   (ke["radiusBase"] + t.Bulk*ke["radiusPerBulk"]) * ke["shipScale"],
		Thrust:   speed * ke["thrustMult"],
		Vmax:     speed * ke["vmaxMult"],
		State:    "init",
		Stats: &eStats{
			Turn:      turn,
			FireRange: t.FireRange,
			Score:     t.Score,
			FireGap:   fg,
			Behavior:  t.Behavior,
			Target:    t.Target,
			Shape:     t.Shape,
		},
	}
	e.FireCd = fg[0] + rng.Float64()*(fg[1]-fg[0])
	if rng.Float64() < 0.5 {
		e.StrafeSign = -1
	} else {
		e.StrafeSign = 1
	}
	return e
}

// spawnEnemy — 6 rng draws: key index, fireCd, strafeSign, dir(2), mag.
func spawnEnemy(f *Fleet, anchor, playerPos Vec3, k *Constants, rng *Rng) bool {
	keys := make([]string, 0, len(f.Pending))
	for _, e := range f.Pending {
		if e.N > 0 {
			keys = append(keys, e.Type)
		}
	}
	if len(keys) == 0 {
		return false
	}
	typ := keys[int(math.Floor(rng.Float64()*float64(len(keys))))]
	decGoal(f.Pending, typ)

	e := makeEnemyState(typ, k, rng)
	e.ID = f.NextID
	f.NextID++
	var dir Vec3
	RandomDir(rng, &dir)
	dir.MultiplyScalar(k.Enemy["spawnMin"] + rng.Float64()*k.Enemy["spawnRange"]).Add(anchor)
	e.Position = dir

	to := playerPos
	to.Sub(e.Position).Normalize()
	e.Quaternion.SetFromUnitVectors(fwd, to)

	f.List = append(f.List, e)
	return true
}

// stepFleet — AI, leash, cull, refill. Returns { enemyKilled } events.
func stepFleet(f *Fleet, w *World, dt float64, k *Constants) []Event {
	var events []Event
	ke := k.Enemy
	ship := w.Ship

	for _, e := range f.List {
		if e.Dead {
			continue
		}
		stepEnemy(e, w, dt)
		d := e.Position.DistanceTo(ship.Pos)
		if d > ke["leashSoft"] {
			back := ship.Pos
			back.Sub(e.Position).MultiplyScalar(1 / d)
			e.Velocity.AddScaledVector(back, e.Thrust*ke["leashThrustMult"]*dt)
			if d > ke["leashHard"] {
				e.Position = ship.Pos
				e.Position.AddScaledVector(back, -ke["leashSnapDist"])
			}
		}
	}

	keep := f.List[:0:0]
	for _, e := range f.List {
		if !e.Dead {
			keep = append(keep, e)
			continue
		}
		decGoal(f.Goals, e.Type)
		if e.Loot != nil && e.Loot.Captor == e {
			e.Loot.Captor = nil
		}
		if !e.Escaped {
			events = append(events, Event{Kind: "enemyKilled", Enemy: e})
		}
	}
	f.List = keep

	anchor := ship.Pos
	if len(w.Pods.List) > 0 {
		anchor = w.Pods.Centroid
	}
	for len(f.List) < int(ke["maxAlive"]) && fleetPendingRemaining(f) > 0 {
		if !spawnEnemy(f, anchor, ship.Pos, k, w.Rng) {
			break
		}
	}
	return events
}

// checkRam — enemy hits the ship. Returns ({pos, hurt}, true) or (_, false).
func checkRam(f *Fleet, ship *Ship, ke Block) (Event, bool) {
	for _, e := range f.List {
		if e.Dead {
			continue
		}
		rr := e.Radius + ke["ramDist"]
		if ship.Alive && ship.Pos.DistanceToSq(e.Position) < rr*rr {
			e.Dead = true
			hurt := ship.Invuln <= 0
			ship.Damage(ke["ramDmg"])
			away := ship.Pos
			away.Sub(e.Position).Normalize()
			ship.Vel.AddScaledVector(away, ke["ramKnockback"])
			return Event{Kind: "ram", Pos: e.Position, Hurt: hurt}, true
		}
	}
	return Event{}, false
}

// checkPodStrikes — non-thief enemies bump pods. Lethal bumps surface an event.
func checkPodStrikes(f *Fleet, pods *Pods, ke Block) []Event {
	var events []Event
	for _, e := range f.List {
		if e.Dead || e.Behavior == "thief" {
			continue
		}
		for _, p := range pods.List {
			if p.Dead {
				continue
			}
			rr := e.Radius + p.Radius
			if e.Position.DistanceToSq(p.Position) < rr*rr {
				p.HP -= ke["podStrikeDmg"]
				if p.HP <= 0 {
					p.Dead = true
					events = append(events, Event{Kind: "podStrikeKill", Pos: p.Position})
				}
				away := e.Position
				away.Sub(p.Position).Normalize()
				e.Velocity.AddScaledVector(away, ke["podStrikeKnockback"])
			}
		}
	}
	return events
}

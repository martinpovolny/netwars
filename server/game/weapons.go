package game

import "math"

// Pooled projectiles — the Go twin of shared/sim/weapons.js.

const (
	teamPlayer = "player"
	teamEnemy  = "enemy"
	kindBolt   = "bolt"
	kindMsl    = "missile"
)

type Projectiles struct {
	K      Block // constants.weapons
	Max    int
	Pos    []Vec3
	Vel    []Vec3
	Ttl    []float64
	Age    []float64
	Team   []string
	Kind   []string
	Owner  []string // player id that fired it ("" for enemy shots)
	Target []*Enemy
	Cursor int
}

func newProjectiles(kw Block) *Projectiles {
	n := int(kw["max"])
	return &Projectiles{
		K: kw, Max: n,
		Pos: make([]Vec3, n), Vel: make([]Vec3, n),
		Ttl: make([]float64, n), Age: make([]float64, n),
		Team: make([]string, n), Kind: make([]string, n),
		Owner:  make([]string, n),
		Target: make([]*Enemy, n),
	}
}

func (p *Projectiles) Spawn(pos, vel Vec3, team string, ttl float64, target *Enemy, kind, owner string) {
	i := p.Cursor
	p.Cursor = (p.Cursor + 1) % p.Max
	p.Pos[i] = pos
	p.Vel[i] = vel
	p.Ttl[i] = ttl
	p.Age[i] = 0
	p.Team[i] = team
	p.Kind[i] = kind
	p.Owner[i] = owner
	p.Target[i] = target
}

// PlayerMissileActive reports whether `owner` already has a guided missile in
// the air — the "one missile on screen" rule is per player, so in co-op one
// pilot's missile never blocks another's.
func (p *Projectiles) PlayerMissileActive(owner string) bool {
	for i := 0; i < p.Max; i++ {
		if p.Ttl[i] > 0 && p.Team[i] == teamPlayer && p.Kind[i] == kindMsl && p.Owner[i] == owner {
			return true
		}
	}
	return false
}

// Step advances the pool and resolves collisions, mutating enemy/pod/ship
// state. Returns events for the arena to broadcast.
func (p *Projectiles) Step(dt float64, w *World) []Event {
	kw := p.K
	var events []Event

	for i := 0; i < p.Max; i++ {
		if p.Ttl[i] <= 0 {
			continue
		}
		p.Ttl[i] -= dt
		p.Age[i] += dt
		isMissile := p.Kind[i] == kindMsl

		if isMissile && p.Team[i] == teamPlayer {
			sp := p.Vel[i].Length()
			if sp > 1e-3 && sp < kw["missileMaxSpeed"] {
				p.Vel[i].MultiplyScalar(1 + kw["missileSelfPropel"]*dt)
			}
			if p.Age[i] > kw["missileGuideDelay"] {
				tgt := p.Target[i]
				if tgt != nil && !tgt.Dead {
					desired := tgt.Position
					desired.Sub(p.Pos[i]).Normalize().MultiplyScalar(p.Vel[i].Length())
					p.Vel[i].Lerp(desired, 1-math.Pow(kw["missileGuideRate"], dt))
				}
			}
		}
		p.Pos[i].AddScaledVector(p.Vel[i], dt)

		hit := false
		dmg := kw["cannonDmg"]
		if isMissile {
			dmg = kw["missileDmg"]
		}

		if p.Team[i] == teamPlayer {
			for _, e := range w.Fleet.List {
				if e.Dead {
					continue
				}
				r := e.Radius
				if isMissile {
					r += kw["missileHitPad"]
				}
				if p.Pos[i].DistanceToSq(e.Position) < r*r {
					e.HP -= dmg
					e.Flash = 1
					events = append(events, Event{Kind: "enemyHit", Pos: p.Pos[i]})
					if e.HP <= 0 {
						e.Dead = true
						events = append(events, Event{Kind: "enemyKill", Pos: e.Position})
					} else if isMissile {
						events = append(events, Event{Kind: "missileBurst", Pos: p.Pos[i]})
					}
					hit = true
					break
				}
			}
			if !hit && bonusHitByShot(w.Bonuses, p.Pos[i]) {
				hit = true
			}
		} else {
			hr := kw["playerHitRadius"] * kw["playerHitRadius"]
			for _, sh := range w.shipList() {
				if sh.Alive && p.Pos[i].DistanceToSq(sh.Pos) < hr {
					absorbed := sh.Invuln > 0
					sh.Damage(kw["enemyDmgPlayer"])
					events = append(events, Event{Kind: "playerHit", Pos: p.Pos[i], Absorbed: absorbed})
					hit = true
					break
				}
			}
			if !hit {
				for _, pod := range w.Pods.List {
					if pod.Dead {
						continue
					}
					if p.Pos[i].DistanceToSq(pod.Position) < pod.Radius*pod.Radius {
						pod.HP -= kw["enemyDmgPod"]
						events = append(events, Event{Kind: "podHit", Pos: p.Pos[i]})
						if pod.HP <= 0 {
							pod.Dead = true
							events = append(events, Event{Kind: "podKill", Pos: pod.Position})
						}
						hit = true
						break
					}
				}
			}
		}
		if hit {
			p.Ttl[i] = 0
		}
	}
	return events
}

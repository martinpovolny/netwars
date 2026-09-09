package game

import (
	"context"
	"log"
	"math"
	"time"

	"github.com/martinpovolny/netwars/server/proto"
)

const (
	tickHz     = 60
	snapEvery  = 2 // send a snapshot every N sim ticks (~30 Hz)
	tickDT     = 1.0 / float64(tickHz)
	outboxSize = 64
)

// Player is one connected client inside an arena.
type Player struct {
	ID   string
	Name string
	Ship *Ship
	out  chan []byte // -> this client's write pump

	// input state, updated by the arena from Input frames
	ctrl      Control
	lastSeq   int
	wantGun   bool
	wantMsl   bool
	mslTarget int // enemy index the client locked, -1 = none
	gunCd     float64
	mslCd     float64
}

func (p *Player) send(b []byte) {
	select {
	case p.out <- b:
	default: // client is too slow — drop the frame rather than block the tick
	}
}

type arenaInput struct {
	pid string
	in  proto.Input
}

// Arena owns one shared World and runs its 60 Hz loop on a single goroutine.
type Arena struct {
	Session string
	Mode    string

	k     *Constants
	world *World

	join  chan *Player
	leave chan *Player
	in    chan arenaInput

	// run()-only
	players map[string]*Player
	order   []string // join order; order[0] drives StepWorld's focus ship
	tick    int
	nextID  int

	onEmpty func() // called when the last player leaves (registry teardown)
}

func newArena(k *Constants, session, mode, seed string) *Arena {
	a := &Arena{
		Session: session, Mode: mode, k: k,
		world:   NewWorld(k, seed),
		join:    make(chan *Player),
		leave:   make(chan *Player),
		in:      make(chan arenaInput, 256),
		players: map[string]*Player{},
	}
	return a
}

func newShip(k *Constants) *Ship {
	return &Ship{
		Alive: true,
		Hull:  k.Player.MaxHull, MaxHull: k.Player.MaxHull,
		Missiles: int(k.Player.MaxMissiles), MaxMissiles: k.Player.MaxMissiles,
		Quat: Quat{0, 0, 0, 1},
	}
}

// spawnSlot spreads players so no two ships start on top of each other.
// Slot 0 is the origin; the rest sit on a phyllotaxis spiral in the y=0
// plane — the golden angle keeps any number of players from stacking up
// collinearly. Spacing is well beyond the ship radius (7).
func spawnSlot(i int) Vec3 {
	if i <= 0 {
		return Vec3{}
	}
	const spacing = 70.0
	r := spacing * math.Sqrt(float64(i))
	ang := float64(i) * 2.399963229728653 // golden angle, radians
	return Vec3{X: r * math.Cos(ang), Z: r * math.Sin(ang)}
}

// resetShip — the Go twin of client/player.js#reset (level (re)start).
func resetShip(s *Ship, k *Constants) {
	s.Pos = Vec3{}
	s.Vel = Vec3{}
	s.Quat = Quat{0, 0, 0, 1}
	s.Hull = s.MaxHull
	s.Missiles = int(s.MaxMissiles)
	s.HitPulse = 0
	s.Invuln = k.Player.InvulnOnReset
	s.Alive = true
}

func (a *Arena) run(ctx context.Context) {
	a.world.StartWorldLevel(1, int(a.k.Pods["perLevel"]))
	sim := time.NewTicker(time.Second / tickHz)
	defer sim.Stop()
	log.Printf("arena %q (%s): started", a.Session, a.Mode)

	for {
		select {
		case <-ctx.Done():
			return

		case p := <-a.join:
			a.nextID++
			p.ID = "p" + itoa(a.nextID)
			p.Ship = newShip(a.k)
			p.Ship.Pos = spawnSlot(len(a.order)) // index this player is about to take
			p.mslTarget = -1
			a.players[p.ID] = p
			a.order = append(a.order, p.ID)
			p.send(proto.Marshal(proto.Welcome{
				Type: proto.TypeWelcome, PlayerID: p.ID, Session: a.Session,
				Mode: a.Mode, Tick: a.tick,
				Snapshot: BuildSnapshot(a.world, a.tick, 0, p.Ship, a.othersOf(p)),
			}))
			log.Printf("arena %q: +%s (%d players)", a.Session, p.ID, len(a.players))

		case p := <-a.leave:
			if _, ok := a.players[p.ID]; !ok {
				continue
			}
			delete(a.players, p.ID)
			a.order = removeStr(a.order, p.ID)
			close(p.out)
			log.Printf("arena %q: -%s (%d players)", a.Session, p.ID, len(a.players))
			if len(a.players) == 0 {
				log.Printf("arena %q: empty, stopping", a.Session)
				if a.onEmpty != nil {
					a.onEmpty()
				}
				return
			}

		case ai := <-a.in:
			if p := a.players[ai.pid]; p != nil {
				a.applyInput(p, ai.in)
			}

		case <-sim.C:
			a.step()
		}
	}
}

func (a *Arena) applyInput(p *Player, in proto.Input) {
	if in.Seq <= p.lastSeq {
		return // stale / out of order
	}
	p.lastSeq = in.Seq
	p.ctrl = Control{
		IntentX: in.IntentX, IntentY: in.IntentY, Roll: in.Roll, Thrust: in.Thrust,
		Brake: in.Brake, Boost: in.Boost, Stop: in.Stop,
	}
	if in.FireGun {
		p.wantGun = true
	}
	if in.FireMissile {
		p.wantMsl = true
	}
	p.mslTarget = in.MslTarget
}

func (a *Arena) step() {
	a.tick++

	// integrate every ship from its input, then resolve its fire
	for _, id := range a.order {
		p := a.players[id]
		StepShip(p.Ship, p.ctrl, tickDT, a.k.Player)
		a.fireWeapons(p)
	}

	// StepWorld targets one "focus" ship (M2.6 generalises to N).
	if len(a.order) > 0 {
		a.world.Ship = a.players[a.order[0]].Ship
	}
	evs := a.world.StepWorld(tickDT)

	// the FSM asks for a level (re)start — do it here, the arena's job (the
	// SP client does the same in its frame loop). Respawn every ship.
	for _, ev := range evs {
		if ev.Kind == "level" && ev.Action.StartLevel != 0 {
			for i, id := range a.order {
				resetShip(a.players[id].Ship, a.k)
				a.players[id].Ship.Pos = spawnSlot(i)
			}
			a.world.StartWorldLevel(ev.Action.StartLevel, int(a.k.Pods["perLevel"]))
		}
	}

	if pe := EventsToProto(evs); pe != nil {
		b := proto.Marshal(proto.EventBatch{Type: proto.TypeEvent, Tick: a.tick, Events: pe})
		for _, id := range a.order {
			a.players[id].send(b)
		}
	}

	if a.tick%snapEvery == 0 {
		for _, id := range a.order {
			p := a.players[id]
			s := BuildSnapshot(a.world, a.tick, p.lastSeq, p.Ship, a.othersOf(p))
			p.send(proto.Marshal(s))
		}
	}
}

// fireWeapons — the Go twin of the cannon / missile spawn in client/player.js.
func (a *Arena) fireWeapons(p *Player) {
	kp := a.k.Player
	s := p.Ship
	if !s.Alive {
		p.wantGun, p.wantMsl = false, false
		return
	}
	fwdV := fwd
	fwdV.ApplyQuaternion(s.Quat)
	rightV := Vec3{1, 0, 0}
	rightV.ApplyQuaternion(s.Quat)
	upV := up
	upV.ApplyQuaternion(s.Quat)

	p.gunCd -= tickDT
	if p.wantGun && p.gunCd <= 0 {
		p.gunCd = kp.GunInterval
		for _, side := range [2]float64{-1, 1} {
			pos := s.Pos
			pos.AddScaledVector(rightV, side*kp.GunHardpoint.Side)
			pos.AddScaledVector(upV, kp.GunHardpoint.Up)
			pos.AddScaledVector(fwdV, kp.GunHardpoint.Fwd)
			vel := s.Vel
			vel.AddScaledVector(fwdV, kp.CannonMuzzle)
			a.world.Projectiles.Spawn(pos, vel, teamPlayer, kp.BoltTtl, nil, kindBolt)
		}
	}
	p.wantGun = false

	p.mslCd -= tickDT
	if p.wantMsl && p.mslCd <= 0 && s.Missiles > 0 && !a.world.Projectiles.PlayerMissileActive() {
		p.mslCd = kp.MissileInterval
		s.Missiles--
		pos := s.Pos
		pos.AddScaledVector(fwdV, kp.MissileHardpoint.Fwd)
		pos.AddScaledVector(upV, kp.MissileHardpoint.Up)
		vel := s.Vel
		vel.AddScaledVector(fwdV, kp.MissileMuzzle)

		// guide toward the enemy the client had locked (index into the
		// snapshot's fleet), if it's still alive; else the missile is ballistic
		var tgt *Enemy
		if p.mslTarget >= 0 && p.mslTarget < len(a.world.Fleet.List) {
			if e := a.world.Fleet.List[p.mslTarget]; !e.Dead {
				tgt = e
			}
		}
		a.world.Projectiles.Spawn(pos, vel, teamPlayer, kp.MissileLife, tgt, kindMsl)
	}
	p.wantMsl = false
}

func (a *Arena) othersOf(self *Player) []*Ship {
	var out []*Ship
	for _, id := range a.order {
		if id == self.ID {
			continue
		}
		out = append(out, a.players[id].Ship)
	}
	return out
}

func removeStr(s []string, v string) []string {
	for i, x := range s {
		if x == v {
			return append(s[:i], s[i+1:]...)
		}
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

package game

import (
	"context"
	"log"
	"math"
	"sort"
	"time"

	"github.com/martinpovolny/netwars/server/proto"
)

const (
	tickHz     = 60
	snapEvery  = 2 // send a snapshot every N sim ticks (~30 Hz)
	tickDT     = 1.0 / float64(tickHz)
	outboxSize = 64

	respawnDelay   = 3.0 // co-op: seconds a dead player waits before coming back
	dmRespawnDelay = 2.5 // deathmatch: a touch quicker
)

// Player is one connected client inside an arena.
type Player struct {
	ID   string
	Name string
	Ship *Ship
	out  chan []byte // -> this client's write pump

	// input state, updated by the arena from Input frames
	ctrl            Control
	lastSeq         int
	wantGun         bool
	wantMsl         bool
	mslTarget       int    // enemy index the client locked, -1 = none
	mslTargetPlayer string // deathmatch: id of the other player locked, "" = none
	gunCd           float64
	mslCd           float64
	respawnCd       float64 // >0 while dead and counting down to respawn
	frags           int     // deathmatch kills
	rtt             float64 // this player's own self-reported RTT to the server (ms), from Input.Rtt — shown to other players next to their name
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

	dm bool // Mode == "dm" — no AI/pods, player-vs-player friendly fire, frags

	// deathmatch match-end (0 = no limit); set at arena creation, fixed for
	// the arena's lifetime. matchOverCd counts down while the results are
	// on screen and combat/respawn is frozen; matchElapsed only advances
	// while the match is live.
	fragLimit    int
	timeLimit    float64
	matchElapsed float64
	matchOverCd  float64

	// run()-only
	players map[string]*Player
	order   []string // join order; order[0] drives StepWorld's focus ship
	tick    int
	nextID  int

	onEmpty func() // called when the last player leaves (registry teardown)
}

// fragLimit/timeLimit (0 = no limit) only matter when mode is "dm" — the
// caller decides, same as mode itself: whoever's hello creates the arena
// sets it for the match's lifetime (see Sessions.getOrCreate).
func newArena(k *Constants, session, mode, seed string, fragLimit int, timeLimit float64) *Arena {
	a := &Arena{
		Session: session, Mode: mode, k: k,
		dm:        mode == "dm",
		fragLimit: fragLimit,
		timeLimit: timeLimit,
		world:     NewWorld(k, seed),
		join:      make(chan *Player),
		leave:     make(chan *Player),
		in:        make(chan arenaInput, 256),
		players:   map[string]*Player{},
	}
	return a
}

func newShip(k *Constants) *Ship {
	return &Ship{
		Alive: true,
		Hull:  k.Player.MaxHull, MaxHull: k.Player.MaxHull,
		Missiles: int(k.Player.MaxMissiles), MaxMissiles: k.Player.MaxMissiles,
		BoostFuel: k.Player.BoostFuelMax,
		Quat:      Quat{0, 0, 0, 1},
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
	s.BoostFuel = k.Player.BoostFuelMax
	s.HitPulse = 0
	s.Invuln = k.Player.InvulnOnReset
	s.Alive = true
}

func (a *Arena) run(ctx context.Context) {
	if !a.dm {
		a.world.StartWorldLevel(1, int(a.k.Pods["perLevel"]))
	}
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
			p.mslTarget = -1
			a.players[p.ID] = p
			a.order = append(a.order, p.ID)
			if a.dm {
				p.Ship.Pos = a.dmSpawnPos()
				p.Ship.Invuln = a.k.Player.InvulnOnRespawn
			} else {
				p.Ship.Pos = spawnSlot(len(a.order) - 1)
			}
			wel := proto.Welcome{
				Type: proto.TypeWelcome, PlayerID: p.ID, Session: a.Session,
				Mode: a.Mode, Tick: a.tick,
				Snapshot: BuildSnapshot(a.world, a.tick, 0, p.Ship, a.othersOf(p)),
			}
			if a.dm {
				wel.Snapshot.Board = a.board()
				wel.Snapshot.TimeLeft = a.timeLeft()
				wel.FragLimit = a.fragLimit
				wel.TimeLimit = a.timeLimit
			}
			p.send(proto.Marshal(wel))
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
	p.mslTargetPlayer = in.MslTargetPlayer
	// guard against a stale/missing 0 unlearning a previously known RTT —
	// the client always sends its current best-known value, but that's 0
	// for the first second or so after connecting, before its first pong.
	if in.Rtt > 0 {
		p.rtt = in.Rtt
	}
}

func (a *Arena) step() {
	if a.dm {
		a.stepDM()
		return
	}
	a.stepCoop()
}

func (a *Arena) stepCoop() {
	a.tick++

	// integrate every ship from its input, then resolve its fire
	a.world.Ships = a.world.Ships[:0]
	for i, id := range a.order {
		p := a.players[id]

		// dead player: count down, then respawn just this one — the others
		// keep playing (co-op doesn't wait for the level to end).
		if !p.Ship.Alive {
			if p.respawnCd <= 0 {
				p.respawnCd = respawnDelay
			}
			if p.respawnCd -= tickDT; p.respawnCd <= 0 {
				resetShip(p.Ship, a.k)
				p.Ship.Pos = spawnSlot(i)
				p.Ship.Invuln = a.k.Player.InvulnOnRespawn
				p.respawnCd = 0
			}
			a.world.Ships = append(a.world.Ships, p.Ship) // dead ships are skipped by the Alive checks
			continue
		}
		p.respawnCd = 0

		// grace + hit-pulse decay — client/player.js does this in its flight
		// step; the server had no equivalent, so a reset ship stayed invuln
		// forever and never took a hit.
		if p.Ship.Invuln > 0 {
			if p.Ship.Invuln -= tickDT; p.Ship.Invuln < 0 {
				p.Ship.Invuln = 0
			}
		}
		if p.Ship.HitPulse > 0 {
			if p.Ship.HitPulse -= tickDT * a.k.Player.HitPulseDecay; p.Ship.HitPulse < 0 {
				p.Ship.HitPulse = 0
			}
		}
		StepShip(p.Ship, p.ctrl, tickDT, a.k.Player)
		a.fireWeapons(p)
		a.world.Ships = append(a.world.Ships, p.Ship)
	}

	// order[0] is the "focus" ship (pods spawn around it, FSM watches it);
	// enemy AI / fire / rams resolve against every ship in a.world.Ships.
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

// stepDM — the deathmatch tick: no fleet / pods / level FSM. Ships fly and
// fire, bolts hurt every ship but their owner, a kill is a frag, the dead
// respawn on a short timer. Once a frag/time limit is reached, the match
// freezes (no physics, fire, respawn or combat resolution — everyone just
// holds their final position) for matchOverHold seconds so the results are
// readable, then quietly resets frags and ships and play continues.
func (a *Arena) stepDM() {
	a.tick++
	a.world.Ships = a.world.Ships[:0]
	frozen := a.matchOverCd > 0

	for _, id := range a.order {
		p := a.players[id]
		if frozen {
			a.world.Ships = append(a.world.Ships, p.Ship)
			continue
		}
		if !p.Ship.Alive {
			if p.respawnCd <= 0 {
				p.respawnCd = dmRespawnDelay
			}
			if p.respawnCd -= tickDT; p.respawnCd <= 0 {
				resetShip(p.Ship, a.k)
				p.Ship.Pos = a.dmSpawnPos()
				p.Ship.Invuln = a.k.Player.InvulnOnRespawn
				p.respawnCd = 0
			}
			continue
		}
		p.respawnCd = 0
		if p.Ship.Invuln > 0 {
			if p.Ship.Invuln -= tickDT; p.Ship.Invuln < 0 {
				p.Ship.Invuln = 0
			}
		}
		if p.Ship.HitPulse > 0 {
			if p.Ship.HitPulse -= tickDT * a.k.Player.HitPulseDecay; p.Ship.HitPulse < 0 {
				p.Ship.HitPulse = 0
			}
		}
		StepShip(p.Ship, p.ctrl, tickDT, a.k.Player)
		a.fireWeapons(p)
		a.world.Ships = append(a.world.Ships, p.Ship)
	}

	var evs []Event
	if frozen {
		if a.matchOverCd -= tickDT; a.matchOverCd <= 0 {
			a.matchOverCd = 0
			a.restartMatch()
			evs = append(evs, Event{Kind: "matchStart"})
		}
	} else {
		evs = append(evs, a.dmRams()...)
		evs = append(evs, a.dmProjectiles()...)

		a.matchElapsed += tickDT
		if winner, over := a.checkMatchOver(); over {
			a.matchOverCd = a.k.DM["matchOverHold"]
			evs = append(evs, Event{Kind: "matchOver", Winner: winner, Hold: a.matchOverCd})
		}
	}

	if pe := EventsToProto(evs); pe != nil {
		b := proto.Marshal(proto.EventBatch{Type: proto.TypeEvent, Tick: a.tick, Events: pe})
		for _, id := range a.order {
			a.players[id].send(b)
		}
	}
	if a.tick%snapEvery == 0 {
		board := a.board()
		for _, id := range a.order {
			p := a.players[id]
			s := BuildSnapshot(a.world, a.tick, p.lastSeq, p.Ship, a.othersOf(p))
			s.Board = board
			s.TimeLeft = a.timeLeft()
			p.send(proto.Marshal(s))
		}
	}
}

// dmProjectiles advances the pool and resolves player-vs-player hits. Bolts
// carry their firer's id (Owner) from fireWeapons, so a kill credits the
// right player.
func (a *Arena) dmProjectiles() []Event {
	pr := a.world.Projectiles
	kw := a.k.Weapons
	var evs []Event

	for i := 0; i < pr.Max; i++ {
		if pr.Ttl[i] <= 0 {
			continue
		}
		pr.Ttl[i] -= tickDT
		pr.Age[i] += tickDT
		isMsl := pr.Kind[i] == kindMsl
		if isMsl {
			sp := pr.Vel[i].Length()
			if sp > 1e-3 && sp < kw["missileMaxSpeed"] {
				pr.Vel[i].MultiplyScalar(1 + kw["missileSelfPropel"]*tickDT)
			}
			// home on the locked target once it's clear of the muzzle — this
			// was missing entirely, so a locked deathmatch missile always flew
			// dead straight regardless of the lock (twin of Projectiles.Step).
			if pr.Age[i] > kw["missileGuideDelay"] {
				if tgt := pr.Target[i]; tgt != nil && !tgt.GuideDead() {
					desired := tgt.GuidePos()
					desired.Sub(pr.Pos[i]).Normalize().MultiplyScalar(pr.Vel[i].Length())
					pr.Vel[i].Lerp(desired, 1-math.Pow(kw["missileGuideRate"], tickDT))
				}
			}
		}
		pr.Pos[i].AddScaledVector(pr.Vel[i], tickDT)
		if pr.Ttl[i] <= 0 {
			continue
		}

		r := kw["playerHitRadius"]
		dmg := kw["cannonDmg"]
		if isMsl {
			r += kw["missileHitPad"]
			dmg = kw["missileDmg"]
		}
		for _, id := range a.order {
			if id == pr.Owner[i] {
				continue
			}
			vic := a.players[id]
			if !vic.Ship.Alive {
				continue
			}
			if pr.Pos[i].DistanceToSq(vic.Ship.Pos) < r*r {
				absorbed := vic.Ship.Invuln > 0
				vic.Ship.Damage(dmg)
				pr.Ttl[i] = 0
				evs = append(evs, Event{Kind: "playerHit", Pos: pr.Pos[i], Absorbed: absorbed})
				if !absorbed && !vic.Ship.Alive {
					if kr := a.players[pr.Owner[i]]; kr != nil {
						kr.frags++
					}
					evs = append(evs, Event{Kind: "frag", Pos: vic.Ship.Pos, Killer: pr.Owner[i], Victim: id})
				}
				break
			}
		}
	}

	// bolt-vs-missile: fly straight at an incoming missile and shoot it
	// down before it reaches you. A missile can't intercept another
	// missile, and can't be shot down by its own shooter's bolts.
	ir := kw["missileInterceptRadius"]
	for i := 0; i < pr.Max; i++ {
		if pr.Ttl[i] <= 0 || pr.Kind[i] != kindMsl {
			continue
		}
		for j := 0; j < pr.Max; j++ {
			if j == i || pr.Ttl[j] <= 0 || pr.Kind[j] == kindMsl || pr.Owner[j] == pr.Owner[i] {
				continue
			}
			if pr.Pos[i].DistanceToSq(pr.Pos[j]) < ir*ir {
				pr.Ttl[i] = 0
				pr.Ttl[j] = 0
				evs = append(evs, Event{Kind: "missileBurst", Pos: pr.Pos[i]})
				break
			}
		}
	}

	return evs
}

// dmRams — deathmatch ship-to-ship collisions. Both take ram damage and are
// knocked apart; if one dies, the survivor is credited with the frag.
func (a *Arena) dmRams() []Event {
	ke := a.k.Enemy
	rr := 2*a.k.Player.Radius + ke["ramDist"]
	dmg := ke["ramDmg"]
	kb := ke["ramKnockback"]
	var evs []Event
	for i := 0; i < len(a.order); i++ {
		for j := i + 1; j < len(a.order); j++ {
			pa, pb := a.players[a.order[i]], a.players[a.order[j]]
			sa, sb := pa.Ship, pb.Ship
			if !sa.Alive || !sb.Alive {
				continue
			}
			if sa.Pos.DistanceToSq(sb.Pos) >= rr*rr {
				continue
			}
			sa.Damage(dmg)
			sb.Damage(dmg)
			away := sa.Pos
			away.Sub(sb.Pos).Normalize()
			sa.Vel.AddScaledVector(away, kb)
			sb.Vel.AddScaledVector(away, -kb)
			evs = append(evs, Event{Kind: "ram", Pos: sa.Pos})
			if !sa.Alive && sb.Alive {
				pb.frags++
				evs = append(evs, Event{Kind: "frag", Pos: sa.Pos, Killer: pb.ID, Victim: pa.ID})
			}
			if !sb.Alive && sa.Alive {
				pa.frags++
				evs = append(evs, Event{Kind: "frag", Pos: sb.Pos, Killer: pa.ID, Victim: pb.ID})
			}
		}
	}
	return evs
}

// board is the deathmatch scoreboard, highest frags first.
func (a *Arena) board() []proto.ScoreS {
	rows := make([]proto.ScoreS, 0, len(a.order))
	for _, id := range a.order {
		p := a.players[id]
		name := p.Name
		if name == "" {
			name = id
		}
		rows = append(rows, proto.ScoreS{ID: id, Name: name, Frags: p.frags, Alive: p.Ship.Alive, Rtt: p.rtt})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Frags > rows[j].Frags })
	return rows
}

// timeLeft is the deathmatch countdown shown on the scoreboard; 0 when no
// time limit is configured, so the client knows to hide the countdown.
func (a *Arena) timeLeft() float64 {
	if a.timeLimit <= 0 {
		return 0
	}
	if left := a.timeLimit - a.matchElapsed; left > 0 {
		return left
	}
	return 0
}

// checkMatchOver reports whether the configured frag/time limit has just
// been reached, and who's leading ("" on a tie for the lead). Only called
// while the match is live — stepDM skips it once frozen.
func (a *Arena) checkMatchOver() (winner string, over bool) {
	best, bestFrags, tie := "", -1, false
	for _, id := range a.order {
		f := a.players[id].frags
		switch {
		case f > bestFrags:
			best, bestFrags, tie = id, f, false
		case f == bestFrags:
			tie = true
		}
	}
	if tie {
		best = ""
	}

	if a.fragLimit > 0 && bestFrags >= a.fragLimit {
		return best, true
	}
	if a.timeLimit > 0 && a.matchElapsed >= a.timeLimit {
		return best, true
	}
	return "", false
}

// restartMatch clears frags and puts every ship back at a fresh dm spawn —
// called once matchOverCd runs out, so a session keeps going through as many
// matches as its players want without anyone having to rejoin.
func (a *Arena) restartMatch() {
	a.matchElapsed = 0
	for _, id := range a.order {
		p := a.players[id]
		p.frags = 0
		p.respawnCd = 0
		resetShip(p.Ship, a.k)
		p.Ship.Pos = a.dmSpawnPos()
		p.Ship.Invuln = a.k.Player.InvulnOnRespawn
	}
}

// dmSpawnPos drops a respawning fighter onto a random point ~700 u out, so
// players don't materialise on top of each other.
func (a *Arena) dmSpawnPos() Vec3 {
	var d Vec3
	RandomDir(a.world.Rng, &d)
	d.MultiplyScalar(550 + a.world.Rng.Float64()*400)
	return d
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
			a.world.Projectiles.Spawn(pos, vel, teamPlayer, kp.BoltTtl, nil, kindBolt, p.ID)
		}
	}
	p.wantGun = false

	p.mslCd -= tickDT
	if p.wantMsl && p.mslCd <= 0 && s.Missiles > 0 && !a.world.Projectiles.PlayerMissileActive(p.ID) {
		p.mslCd = kp.MissileInterval
		s.Missiles--
		pos := s.Pos
		pos.AddScaledVector(fwdV, kp.MissileHardpoint.Fwd)
		pos.AddScaledVector(upV, kp.MissileHardpoint.Up)
		vel := s.Vel
		vel.AddScaledVector(fwdV, kp.MissileMuzzle)

		// guide toward whatever the client had locked — an enemy (index into
		// the snapshot's fleet, co-op) or another player's ship (deathmatch)
		// — if it's still alive; else the missile is ballistic. `target` is
		// declared as the interface and only ever assigned a genuine non-nil
		// value, so it stays truly nil (not a non-nil interface wrapping a
		// nil *Enemy) when nothing valid is locked.
		var target guideTarget
		if p.mslTarget >= 0 && p.mslTarget < len(a.world.Fleet.List) {
			if e := a.world.Fleet.List[p.mslTarget]; !e.Dead {
				target = e
			}
		}
		if target == nil && p.mslTargetPlayer != "" {
			if v, ok := a.players[p.mslTargetPlayer]; ok && v.ID != p.ID && v.Ship.Alive {
				target = v.Ship
			}
		}
		a.world.Projectiles.Spawn(pos, vel, teamPlayer, kp.MissileLife, target, kindMsl, p.ID)
	}
	p.wantMsl = false
}

func (a *Arena) othersOf(self *Player) []*Player {
	var out []*Player
	for _, id := range a.order {
		if id == self.ID {
			continue
		}
		out = append(out, a.players[id])
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

package game

import "github.com/martinpovolny/netwars/server/proto"

func pv(v Vec3) proto.Vec3 { return proto.Vec3{v.X, v.Y, v.Z} }
func pq(q Quat) proto.Quat { return proto.Quat{q.X, q.Y, q.Z, q.W} }

// BuildSnapshot serialises the shared world for one player. `self` is that
// player's ship (reconcile target); `others` are the rest (interpolate).
func BuildSnapshot(w *World, tick, ackSeq int, self *Ship, others []*Ship) proto.Snapshot {
	var goals map[string]int
	for _, g := range w.Fleet.Goals {
		if g.N > 0 {
			if goals == nil {
				goals = map[string]int{}
			}
			goals[g.Type] = g.N
		}
	}
	s := proto.Snapshot{
		Type:     proto.TypeSnapshot,
		Tick:     tick,
		AckSeq:   ackSeq,
		Level:    w.Fleet.Level,
		Goals:    goals,
		Score:    w.Score,
		FSMState: w.FSM.State,
		Ship: proto.ShipS{
			Pos: pv(self.Pos), Vel: pv(self.Vel), Quat: pq(self.Quat),
			Hull: self.Hull, Missiles: self.Missiles, Alive: self.Alive,
		},
	}
	for _, o := range others {
		s.Others = append(s.Others, proto.ShipS{
			Pos: pv(o.Pos), Vel: pv(o.Vel), Quat: pq(o.Quat),
			Hull: o.Hull, Missiles: o.Missiles, Alive: o.Alive,
		})
	}
	for _, e := range w.Fleet.List {
		if e.Dead {
			continue
		}
		s.Enemies = append(s.Enemies, proto.EnemyS{
			ID: e.ID, Type: e.Type, Pos: pv(e.Position), Vel: pv(e.Velocity), Quat: pq(e.Quaternion), HP: e.HP, Ch: e.Charge,
		})
	}
	for _, p := range w.Pods.List {
		if p.Dead {
			continue
		}
		s.Pods = append(s.Pods, proto.PodS{Pos: pv(p.Position), HP: p.HP})
	}
	for _, b := range w.Bonuses.List {
		if b.Dead {
			continue
		}
		s.Bonuses = append(s.Bonuses, proto.BonusS{Kind: b.Kind, Pos: pv(b.Position)})
	}
	for i := 0; i < w.Projectiles.Max; i++ {
		if w.Projectiles.Ttl[i] <= 0 {
			continue
		}
		s.Proj = append(s.Proj, proto.ProjS{
			I: i, Pos: pv(w.Projectiles.Pos[i]), Vel: pv(w.Projectiles.Vel[i]),
			Team: w.Projectiles.Team[i], Kind: w.Projectiles.Kind[i], Own: w.Projectiles.Owner[i],
		})
	}
	return s
}

// EventsToProto converts a StepWorld []Event to the wire form.
func EventsToProto(evs []Event) []proto.EventS {
	if len(evs) == 0 {
		return nil
	}
	out := make([]proto.EventS, 0, len(evs))
	for _, e := range evs {
		pe := proto.EventS{
			Kind: e.Kind, Pos: pv(e.Pos),
			Absorbed: e.Absorbed, Hurt: e.Hurt, Bonus: e.Bonus,
		}
		if e.Kind == "level" {
			pe.Flash = e.Action.Flash
			pe.Hold = e.Action.Hold
			pe.Start = e.Action.StartLevel != 0
		}
		out = append(out, pe)
	}
	return out
}

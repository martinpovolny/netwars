// Package proto is the NETWARS client<->server wire protocol. JSON framing for
// now (M4 may switch snapshots to a binary/Float32 packing). Every frame is a
// JSON object with a "type" field; unmarshal into Envelope first, then the
// concrete struct.
package proto

import "encoding/json"

// client -> server
const (
	TypeHello = "hello"
	TypeInput = "input"
	TypePing  = "ping"
)

// server -> client
const (
	TypeWelcome  = "welcome"
	TypeSnapshot = "snapshot"
	TypeEvent    = "event"
	TypePong     = "pong"
	TypeError    = "error"
)

// Envelope peeks at the type of an incoming frame.
type Envelope struct {
	Type string `json:"type"`
}

func PeekType(b []byte) string {
	var e Envelope
	_ = json.Unmarshal(b, &e)
	return e.Type
}

// ---- client -> server --------------------------------------------------

type Hello struct {
	Type    string `json:"type"`
	Session string `json:"session"`
	Mode    string `json:"mode"` // "coop" | "dm"
	Name    string `json:"name,omitempty"`
}

// Input is one frame of ship control (intent already eased on the client) plus
// fire edges. Seq is a monotonic client counter; the server echoes the highest
// applied Seq back as AckSeq so the client can reconcile its prediction.
type Input struct {
	Type        string  `json:"type"`
	Seq         int     `json:"seq"`
	T           float64 `json:"t"` // client clock, ms
	IntentX     float64 `json:"ix"`
	IntentY     float64 `json:"iy"`
	Roll        float64 `json:"roll"`   // -1|0|1
	Thrust      float64 `json:"thrust"` // -1|0|1
	Brake       bool    `json:"brake"`
	Boost       bool    `json:"boost"`
	Stop        bool    `json:"stop"`
	FireGun     bool    `json:"gun"`
	FireMissile bool    `json:"msl"`
}

type Ping struct {
	Type string  `json:"type"`
	T    float64 `json:"t"`
}

// ---- server -> client ------------------------------------------------

type Welcome struct {
	Type     string   `json:"type"`
	PlayerID string   `json:"playerId"`
	Session  string   `json:"session"`
	Mode     string   `json:"mode"`
	Tick     int      `json:"tick"`
	Snapshot Snapshot `json:"snapshot"`
}

type Vec3 [3]float64
type Quat [4]float64

type ShipS struct {
	ID       string  `json:"id"`
	Pos      Vec3    `json:"p"`
	Vel      Vec3    `json:"v"`
	Quat     Quat    `json:"q"`
	Hull     float64 `json:"hull"`
	Missiles int     `json:"msl"`
	Alive    bool    `json:"alive"`
}

type EnemyS struct {
	Type string  `json:"t"`
	Pos  Vec3    `json:"p"`
	Vel  Vec3    `json:"v"`
	Quat Quat    `json:"q"`
	HP   float64 `json:"hp"`
}

type PodS struct {
	Pos Vec3    `json:"p"`
	HP  float64 `json:"hp"`
}

type BonusS struct {
	Kind string `json:"k"`
	Pos  Vec3   `json:"p"`
}

type ProjS struct {
	I    int    `json:"i"`
	Pos  Vec3   `json:"p"`
	Vel  Vec3   `json:"v"`
	Team string `json:"tm"`
	Kind string `json:"kd"`
}

// Snapshot is the authoritative shared world for one client. Ship is that
// client's own ship (reconcile target); Others are everyone else (interpolate).
type Snapshot struct {
	Type     string   `json:"type"`
	Tick     int      `json:"tick"`
	AckSeq   int      `json:"ackSeq"`
	Level    int      `json:"level"`
	Score    int      `json:"score"`
	FSMState string   `json:"fsm"`
	Ship     ShipS    `json:"ship"`
	Others   []ShipS  `json:"others"`
	Enemies  []EnemyS `json:"enemies"`
	Pods     []PodS   `json:"pods"`
	Bonuses  []BonusS `json:"bonuses"`
	Proj     []ProjS  `json:"proj"`
}

type EventS struct {
	Kind string `json:"kind"`
	Pos  Vec3   `json:"pos,omitempty"`
	// small extras the client FX layer uses
	Absorbed bool    `json:"absorbed,omitempty"`
	Hurt     bool    `json:"hurt,omitempty"`
	Bonus    string  `json:"bonus,omitempty"`
	Flash    string  `json:"flash,omitempty"`
	Hold     float64 `json:"hold,omitempty"`
}

type EventBatch struct {
	Type   string   `json:"type"`
	Tick   int      `json:"tick"`
	Events []EventS `json:"events"`
}

type Pong struct {
	Type string  `json:"type"`
	T    float64 `json:"t"`
}

type Err struct {
	Type string `json:"type"`
	Msg  string `json:"msg"`
}

// Marshal is a small helper — panics only on programmer error (unencodable).
func Marshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

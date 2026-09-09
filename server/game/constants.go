package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
)

// constants.json is a copy of ../../shared/constants.json — the single tuning
// source shared with the JS client. Keep it in sync; the golden-vector test
// catches a mismatch once the port is live.
//
//go:generate cp ../../shared/constants.json constants.json
//go:embed constants.json
var constantsJSON []byte

// Block is a flat tuning group (weapons / enemy / pods / bonuses / sim). The
// JS side reads these the same loose way (K.enemy.leashSoft); M2.3 can tighten
// the ones stepWorld actually needs.
type Block map[string]float64

// Hardpoint is a weapon mount offset (side/up/fwd) in ship-local space.
type Hardpoint struct {
	Side float64 `json:"side"`
	Up   float64 `json:"up"`
	Fwd  float64 `json:"fwd"`
}

// PlayerBlock is K.player — flat scalars plus the two hardpoints. Extra keys in
// the JSON are ignored; add fields here as stepWorld needs them.
type PlayerBlock struct {
	MaxHull          float64   `json:"maxHull"`
	MaxMissiles      float64   `json:"maxMissiles"`
	Radius           float64   `json:"radius"`
	ThrustAccel      float64   `json:"thrustAccel"`
	BrakeAccel       float64   `json:"brakeAccel"`
	BoostMult        float64   `json:"boostMult"`
	Drag             float64   `json:"drag"`
	MaxSpeed         float64   `json:"maxSpeed"`
	TurnFactor       float64   `json:"turnFactor"`
	RollRate         float64   `json:"rollRate"`
	MouseGain        float64   `json:"mouseGain"`
	IntentLag        float64   `json:"intentLag"`
	MouseRecenter    float64   `json:"mouseRecenter"`
	HitPulseDecay    float64   `json:"hitPulseDecay"`
	InvulnOnReset    float64   `json:"invulnOnReset"`
	InvulnOnRespawn  float64   `json:"invulnOnRespawn"`
	GunInterval      float64   `json:"gunInterval"`
	MissileInterval  float64   `json:"missileInterval"`
	CannonMuzzle     float64   `json:"cannonMuzzle"`
	BoltTtl          float64   `json:"boltTtl"`
	MissileMuzzle    float64   `json:"missileMuzzle"`
	MissileLife      float64   `json:"missileLife"`
	GunHardpoint     Hardpoint `json:"gunHardpoint"`
	MissileHardpoint Hardpoint `json:"missileHardpoint"`
}

// EnemyType mirrors one entry of K.types.
type EnemyType struct {
	Name        string    `json:"name"`
	Behavior    string    `json:"behavior"`
	Target      string    `json:"target"`
	Shape       string    `json:"shape,omitempty"`
	SpeedFactor float64   `json:"speedFactor"`
	TurnFactor  float64   `json:"turnFactor"`
	Shield      float64   `json:"shield"`
	Accent      string    `json:"accent"`
	Bulk        float64   `json:"bulk"`
	Score       float64   `json:"score"`
	FireRange   float64   `json:"fireRange"`
	FireGap     []float64 `json:"fireGap"`
}

// Constants is the whole tuning table.
type Constants struct {
	Player       PlayerBlock          `json:"player"`
	Weapons      Block                `json:"weapons"`
	Enemy        Block                `json:"enemy"`
	Types        map[string]EnemyType `json:"types"`
	Levels       []map[string]int     `json:"levels"`
	LevelsBeyond map[string][]float64 `json:"levelsBeyond"`
	Pods         Block                `json:"pods"`
	Bonuses      Block                `json:"bonuses"`
	Sim          Block                `json:"sim"`
}

// LoadConstants parses the embedded copy.
func LoadConstants() (*Constants, error) {
	var k Constants
	if err := json.Unmarshal(constantsJSON, &k); err != nil {
		return nil, fmt.Errorf("constants.json: %w", err)
	}
	return &k, nil
}

// GoalsForLevel is the Go twin of shared/constants.js#goalsForLevel: the
// authored table for early levels, then a generated escalation.
func (k *Constants) GoalsForLevel(n int) map[string]int {
	if n-1 < len(k.Levels) {
		out := make(map[string]int, len(k.Levels[n-1]))
		maps.Copy(out, k.Levels[n-1])
		return out
	}
	out := map[string]int{}
	for typ, bp := range k.LevelsBeyond {
		if len(bp) < 2 {
			continue
		}
		v := int(bp[0] + bp[1]*float64(n)) // JS Math.floor on a non-negative sum
		if v > 0 {
			out[typ] = v
		}
	}
	return out
}

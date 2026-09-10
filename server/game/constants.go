package game

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
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

// Constants is the whole tuning table. `levels` / `levelsBeyond` are decoded
// with key order preserved (spawnEnemy's keys[floor(rng*len)] depends on it).
type Constants struct {
	Player       PlayerBlock          `json:"player"`
	Weapons      Block                `json:"weapons"`
	Enemy        Block                `json:"enemy"`
	Types        map[string]EnemyType `json:"types"`
	Levels       orderedLevels        `json:"levels"`
	LevelsBeyond orderedBeyond        `json:"levelsBeyond"`
	Pods         Block                `json:"pods"`
	Bonuses      Block                `json:"bonuses"`
	Sim          Block                `json:"sim"`
}

// orderedLevels is []levelGoals — one per authored level — each an ordered
// [{type,count}] list.
type orderedLevels [][]goalEntry

func (ol *orderedLevels) UnmarshalJSON(b []byte) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	if t, err := dec.Token(); err != nil || t != json.Delim('[') {
		return fmt.Errorf("levels: expected array, got %v (%v)", t, err)
	}
	for dec.More() {
		if t, err := dec.Token(); err != nil || t != json.Delim('{') {
			return fmt.Errorf("levels: expected object, got %v (%v)", t, err)
		}
		var lvl []goalEntry
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			var n int
			if err := dec.Decode(&n); err != nil {
				return err
			}
			lvl = append(lvl, goalEntry{Type: key.(string), N: n})
		}
		dec.Token() // '}'
		*ol = append(*ol, lvl)
	}
	return nil
}

type beyondEntry struct {
	Type      string
	Base, Per float64
}
type orderedBeyond []beyondEntry

func (ob *orderedBeyond) UnmarshalJSON(b []byte) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return fmt.Errorf("levelsBeyond: expected object, got %v (%v)", t, err)
	}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return err
		}
		var pair []float64
		if err := dec.Decode(&pair); err != nil {
			return err
		}
		if len(pair) < 2 {
			return fmt.Errorf("levelsBeyond[%s]: want [base, per]", key)
		}
		*ob = append(*ob, beyondEntry{Type: key.(string), Base: pair[0], Per: pair[1]})
	}
	return nil
}

// LoadConstants parses the embedded copy.
func LoadConstants() (*Constants, error) {
	var k Constants
	if err := json.Unmarshal(constantsJSON, &k); err != nil {
		return nil, fmt.Errorf("constants.json: %w", err)
	}
	return &k, nil
}

// goalsForLevelOrdered is the Go twin of shared/constants.js#goalsForLevel,
// preserving key order: the authored table for early levels, then a generated
// escalation.
func (k *Constants) goalsForLevelOrdered(n int) []goalEntry {
	if n-1 < len(k.Levels) {
		return cloneGoals(k.Levels[n-1])
	}
	var out []goalEntry
	for _, be := range k.LevelsBeyond {
		v := int(be.Base + be.Per*float64(n)) // JS Math.floor on a non-negative sum
		if v > 0 {
			out = append(out, goalEntry{Type: be.Type, N: v})
		}
	}
	return out
}

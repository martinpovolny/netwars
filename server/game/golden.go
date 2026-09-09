package game

import (
	"encoding/json"
	"fmt"
	"os"
)

// Golden is the reference vector produced by tools/golden.html: stepWorld run
// for `Ticks` ticks off `Seed`, snapshotted every tick. game.StepWorld (M2.3)
// must reproduce every frame within 1e-4.

type Vec3 [3]float64
type Quat [4]float64

type GoldenShip struct {
	Pos      Vec3    `json:"pos"`
	Vel      Vec3    `json:"vel"`
	Quat     Quat    `json:"quat"`
	Hull     float64 `json:"hull"`
	Missiles int     `json:"missiles"`
	Alive    bool    `json:"alive"`
}

type GoldenEnemy struct {
	Type       string  `json:"type"`
	Behavior   string  `json:"behavior"`
	Pos        Vec3    `json:"pos"`
	Vel        Vec3    `json:"vel"`
	Quat       Quat    `json:"quat"`
	HP         float64 `json:"hp"`
	State      string  `json:"state"`
	StateT     float64 `json:"stateT"`
	FireCd     float64 `json:"fireCd"`
	StrafeSign int     `json:"strafeSign"`
}

type GoldenPod struct {
	Pos    Vec3    `json:"pos"`
	HP     float64 `json:"hp"`
	Dead   bool    `json:"dead"`
	Captor bool    `json:"captor"`
}

type GoldenBonus struct {
	Kind string  `json:"kind"`
	Pos  Vec3    `json:"pos"`
	Life float64 `json:"life"`
}

type GoldenProj struct {
	I    int     `json:"i"`
	Pos  Vec3    `json:"pos"`
	Vel  Vec3    `json:"vel"`
	Ttl  float64 `json:"ttl"`
	Age  float64 `json:"age"`
	Team string  `json:"team"`
	Kind string  `json:"kind"`
}

type GoldenFrame struct {
	T     int `json:"t"`
	Score int `json:"score"`
	Level int `json:"level"`
	FSM   struct {
		State string  `json:"state"`
		Timer float64 `json:"timer"`
	} `json:"fsm"`
	Ship    GoldenShip    `json:"ship"`
	Enemies []GoldenEnemy `json:"enemies"`
	Pods    []GoldenPod   `json:"pods"`
	Bonuses []GoldenBonus `json:"bonuses"`
	Proj    []GoldenProj  `json:"proj"`
}

type Golden struct {
	Note       string        `json:"_note"`
	Seed       string        `json:"seed"`
	Ticks      int           `json:"ticks"`
	DT         float64       `json:"dt"`
	StartLevel int           `json:"startLevel"`
	Frames     []GoldenFrame `json:"frames"`
}

func LoadGolden(path string) (*Golden, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var g Golden
	if err := json.Unmarshal(b, &g); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(g.Frames) != g.Ticks {
		return nil, fmt.Errorf("%s: %d frames, header says %d ticks", path, len(g.Frames), g.Ticks)
	}
	return &g, nil
}

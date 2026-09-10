package game

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/martinpovolny/netwars/server/proto"
)

// End-to-end: dial the ws handler, hello, and confirm the arena runs — welcome
// carries a populated snapshot and subsequent snapshots advance in tick with
// the enemy fleet moving.
func TestArenaEndToEnd(t *testing.T) {
	k, err := LoadConstants()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sessions := NewSessions(ctx, k)

	ts := httptest.NewServer(Handler(ctx, sessions))
	defer ts.Close()
	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.CloseNow()

	write := func(v any) {
		if err := c.Write(ctx, websocket.MessageText, proto.Marshal(v)); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	read := func() []byte {
		rctx, rc := context.WithTimeout(ctx, 3*time.Second)
		defer rc()
		_, b, err := c.Read(rctx)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		return b
	}

	write(proto.Hello{Type: proto.TypeHello, Session: "test-e2e", Mode: "coop"})

	// first frame back is welcome
	var wel proto.Welcome
	if b := read(); proto.PeekType(b) != proto.TypeWelcome {
		t.Fatalf("first frame %q, want welcome (%s)", proto.PeekType(b), b)
	} else {
		json.Unmarshal(b, &wel)
	}
	if wel.PlayerID == "" || wel.Session != "test-e2e" {
		t.Fatalf("welcome = %+v", wel)
	}
	if len(wel.Snapshot.Pods) == 0 {
		t.Fatalf("welcome snapshot has no pods: %+v", wel.Snapshot)
	}

	// drive a little input and collect a handful of snapshots
	var snaps []proto.Snapshot
	for i := 1; i <= 40 && len(snaps) < 8; i++ {
		write(proto.Input{Type: proto.TypeInput, Seq: i, Thrust: 1, FireGun: i%3 == 0})
		b := read()
		switch proto.PeekType(b) {
		case proto.TypeSnapshot:
			var s proto.Snapshot
			json.Unmarshal(b, &s)
			snaps = append(snaps, s)
		case proto.TypeEvent, proto.TypePong:
			// fine, keep reading
		default:
			t.Fatalf("unexpected frame %q", proto.PeekType(b))
		}
	}
	if len(snaps) < 3 {
		t.Fatalf("got only %d snapshots", len(snaps))
	}

	first, last := snaps[0], snaps[len(snaps)-1]
	if last.Tick <= first.Tick {
		t.Fatalf("tick not advancing: %d -> %d", first.Tick, last.Tick)
	}
	if last.AckSeq == 0 {
		t.Fatalf("server never acked an input (ackSeq still 0)")
	}
	if len(last.Enemies) == 0 {
		t.Fatalf("snapshot has no enemies")
	}
	// the fleet should be moving between snapshots
	moved := false
	if len(first.Enemies) > 0 && len(last.Enemies) > 0 {
		a, z := first.Enemies[0].Pos, last.Enemies[0].Pos
		if a != z {
			moved = true
		}
	}
	if !moved {
		t.Fatalf("enemy fleet not moving across snapshots")
	}

	// ping -> pong round-trip
	write(proto.Ping{Type: proto.TypePing, T: 12345})
	gotPong := false
	for i := 0; i < 20 && !gotPong; i++ {
		b := read()
		if proto.PeekType(b) == proto.TypePong {
			var pg proto.Pong
			json.Unmarshal(b, &pg)
			if pg.T != 12345 {
				t.Fatalf("pong echoed t=%v want 12345", pg.T)
			}
			gotPong = true
		}
	}
	if !gotPong {
		t.Fatal("no pong")
	}

	t.Logf("e2e ok: player=%s tick %d->%d ackSeq=%d enemies=%d pods=%d proj=%d",
		wel.PlayerID, first.Tick, last.Tick, last.AckSeq, len(last.Enemies), len(last.Pods), len(last.Proj))

	_ = http.StatusOK
}

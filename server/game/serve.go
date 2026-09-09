package game

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/martinpovolny/netwars/server/proto"
)

// HandleConn upgrades one HTTP request to a WebSocket, does the hello
// handshake, joins the session's arena, and pumps frames until the socket
// closes. One read goroutine (this one) + one write goroutine per connection.
func HandleConn(parent context.Context, w http.ResponseWriter, r *http.Request, s *Sessions) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // TODO(M2.7): pin to the Pages origin
	})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 16)

	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	_, raw, err := c.Read(ctx)
	if err != nil {
		return
	}
	if proto.PeekType(raw) != proto.TypeHello {
		_ = c.Write(ctx, websocket.MessageText, proto.Marshal(proto.Err{Type: proto.TypeError, Msg: "expected hello"}))
		return
	}
	var hello proto.Hello
	if err := json.Unmarshal(raw, &hello); err != nil || hello.Session == "" {
		_ = c.Write(ctx, websocket.MessageText, proto.Marshal(proto.Err{Type: proto.TypeError, Msg: "bad hello"}))
		return
	}
	mode := hello.Mode
	if mode == "" {
		mode = "coop"
	}

	arena := s.getOrCreate(hello.Session, mode)
	p := &Player{
		ID:   "p" + itoa(int(s.nextPID.Add(1))),
		Name: hello.Name,
		out:  make(chan []byte, outboxSize),
	}

	select {
	case arena.join <- p:
	case <-ctx.Done():
		return
	}
	defer func() {
		select {
		case arena.leave <- p:
		case <-time.After(time.Second):
		}
	}()

	// write pump
	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case b, ok := <-p.out:
				if !ok {
					return
				}
				wctx, wc := context.WithTimeout(ctx, 5*time.Second)
				err := c.Write(wctx, websocket.MessageText, b)
				wc()
				if err != nil {
					return
				}
			}
		}
	}()

	// read pump
	for {
		_, raw, err := c.Read(ctx)
		if err != nil {
			return
		}
		switch proto.PeekType(raw) {
		case proto.TypeInput:
			var in proto.Input
			if json.Unmarshal(raw, &in) == nil {
				select {
				case arena.in <- arenaInput{pid: p.ID, in: in}:
				default: // arena busy this tick — drop, the next input supersedes it
				}
			}
		case proto.TypePing:
			var pg proto.Ping
			_ = json.Unmarshal(raw, &pg)
			p.send(proto.Marshal(proto.Pong{Type: proto.TypePong, T: pg.T}))
		}
	}
}

// Handler returns an http.HandlerFunc bound to a session registry.
func Handler(ctx context.Context, s *Sessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		HandleConn(ctx, w, r, s)
	}
}

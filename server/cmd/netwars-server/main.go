// netwars-server — the authoritative co-op arena server (M2).
//
// M2.2: skeleton. Parses flags, loads the embedded tuning table, wires signal
// handling, and prints its config. The WebSocket transport + arena loop land
// in M2.4; the shared-sim port (game.StepWorld) in M2.3.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/martinpovolny/netwars/server/game"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address (plain ws; Caddy terminates TLS)")
	tickHz := flag.Int("tick", 60, "simulation ticks per second")
	snapHz := flag.Int("snap", 25, "snapshot broadcasts per second")
	flag.Parse()

	k, err := game.LoadConstants()
	if err != nil {
		log.Fatalf("load constants: %v", err)
	}

	log.Printf("netwars-server (skeleton)")
	log.Printf("  addr        %s", *addr)
	log.Printf("  tick        %d Hz  (dt %.5fs)", *tickHz, 1.0/float64(*tickHz))
	log.Printf("  snapshot    %d Hz", *snapHz)
	log.Printf("  constants   weapons=%d enemy=%d types=%d levels=%d  maxSpeed=%.0f",
		len(k.Weapons), len(k.Enemy), len(k.Types), len(k.Levels), k.Player.MaxSpeed)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// M2.4: ws listener + session registry + per-arena goroutine go here.
	log.Printf("  transport   not built yet (M2.4) — idling; Ctrl-C to exit")

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("shutting down: %v", ctx.Err())
			os.Exit(0)
		case <-ticker.C:
			log.Printf("  idle heartbeat")
		}
	}
}

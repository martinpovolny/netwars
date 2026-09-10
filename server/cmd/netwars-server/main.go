// netwars-server — the authoritative co-op arena server (M2). Serves the
// embedded game client on "/" and the arena WebSocket on "/ws".
//
// Plain ws:// / http:// on -addr; Caddy terminates TLS in front
// (netwars.hmpf.cz { reverse_proxy localhost:8080 }).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/martinpovolny/netwars/server/game"
	"github.com/martinpovolny/netwars/server/web"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address (plain ws; Caddy terminates TLS)")
	origins := flag.String("origins", strings.Join(game.AllowedOrigins, ","),
		"comma-separated host[:port] patterns allowed to open the arena WebSocket cross-origin (empty = same-origin only)")
	flag.Parse()
	game.AllowedOrigins = nil
	for _, o := range strings.Split(*origins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			game.AllowedOrigins = append(game.AllowedOrigins, o)
		}
	}

	k, err := game.LoadConstants()
	if err != nil {
		log.Fatalf("load constants: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	sessions := game.NewSessions(ctx, k)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", game.Handler(ctx, sessions))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "ok arenas=%d\n", sessions.Count())
	})
	// everything else -> the embedded game client ("/" -> index.html).
	// The client is unversioned ES modules; tell the browser to revalidate so
	// a redeploy takes effect on the next load instead of serving a stale mix.
	fs := http.FileServer(http.FS(web.FS))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		fs.ServeHTTP(w, r)
	}))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		log.Printf("shutting down…")
		sc, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sc)
	}()

	log.Printf("netwars-server listening on %s  (game /, arena /ws, /healthz)  — %d enemy types, %d authored levels",
		*addr, len(k.Types), len(k.Levels))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
	os.Exit(0)
}

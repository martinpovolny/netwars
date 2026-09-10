// Package web embeds the game client (index.html + client/ + shared/) so the
// single binary serves the whole game on "/" as well as the arena on "/ws".
//
// assets/ is a committed copy of the repo-root client tree, refreshed by
// `make web` (same pattern as game/constants.json). Change the client, run
// `make web`, rebuild.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:assets
var embedded embed.FS

// FS is the client asset tree rooted so "/" -> assets/index.html.
var FS fs.FS

func init() {
	sub, err := fs.Sub(embedded, "assets")
	if err != nil {
		panic(err) // build-time guarantee: assets/ exists
	}
	FS = sub
}

# Deploying netwars-server

Box: **ARM64 Linux, Oracle Cloud Ampere**, static public IP, **Caddy already
running** on `:80` / `:443`. Reached over VPN via the ssh alias **`vpn-ora-m`**
(that's the Makefile default; override with `make deploy SSH=user@host`).

TLS is Caddy's job; the Go binary speaks plain `ws://` on `127.0.0.1:8080`.
The client (GitHub Pages, `https://www.hmpf.cz/netwars/`) connects to
`wss://netwars.hmpf.cz/ws` via `#<session>?server_id=netwars.hmpf.cz&mode=coop`.

## One-time setup

### 1. DNS

Add `netwars.hmpf.cz` → the box's public IPv4 (`A`) — and its IPv6 (`AAAA`) if
it has one. Confirm:

```sh
dig +short netwars.hmpf.cz
```

### 2. Firewall — Oracle Cloud has two layers

- **OCI ingress rules** (VCN security list *or* the instance's NSG): allow
  TCP **80** and **443** from `0.0.0.0/0`. Caddy already works on this box, so
  these are probably already open — double-check.
- **OS firewall**: Oracle Linux images ship a restrictive `iptables`/`firewalld`;
  Ubuntu images usually don't. If 80/443 already serve Caddy traffic, nothing
  to do. Otherwise:
  `sudo firewall-cmd --permanent --add-service={http,https} && sudo firewall-cmd --reload`

The Go server's `:8080` stays on loopback — never exposed.

### 3. systemd unit + first start

```sh
make install-unit          # scp the unit, daemon-reload, enable --now
make deploy                # vet + test + build arm64 + upload + restart
ssh vpn-ora-m 'curl -s localhost:8080/healthz'    # -> ok arenas=0
```

The unit runs as a transient `DynamicUser`, loopback-only, no capabilities;
constants are embedded so there are no data files. The binary goes to
`/usr/local/bin/netwars-server` (always world-traversable — a `700`
`/opt/...` dir under a `077` root umask is what gives `DynamicUser` a
`203/EXEC`).

### 4. Caddy

Append `deploy/Caddyfile.snippet` to the box's `Caddyfile`
(`/etc/caddy/Caddyfile`), then:

```sh
make reload-caddy
```

Caddy fetches the Let's Encrypt cert on the first HTTPS request (needs `:80`
reachable for the ACME challenge — it is, since Caddy owns it).

### 5. Verify end to end

```sh
make healthz                                   # -> ok arenas=0  (via https://netwars.hmpf.cz)
```

Then a WebSocket smoke: connect to `wss://netwars.hmpf.cz/ws`, send
`{"type":"hello","session":"smoke","mode":"coop"}` — you should get a
`welcome` frame carrying a populated `snapshot` (6 pods, enemies spawning).
`server/game/serve_test.go` does exactly this against a local server.

## Updating

```sh
make deploy      # vet + test + build-arm64 + upload + restart + status
make logs        # journalctl -u netwars-server -f
make healthz
```

## Notes

- **Port**: change `-addr` in `deploy/netwars-server.service` if `8080` is
  taken; match it in `Caddyfile.snippet`.
- **CORS**: the ws handler accepts any `Origin` right now
  (`OriginPatterns: ["*"]`). Tighten to `https://www.hmpf.cz` before this is
  more than a hobby deploy.
- **Idle arenas** tear down the instant the last player disconnects. A
  reconnect grace window is M4.
- **Rollback**: previous binary isn't kept — `git checkout <older>` then
  `make deploy`.

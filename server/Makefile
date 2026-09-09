# netwars-server build + deploy helpers.
#
# The box is a Linux host (Oracle Cloud) reached over VPN via the ssh alias
# `vpn-ora-m`, with Caddy already terminating TLS on 80/443. The deploy target
# asks the box `uname -m` and cross-builds for whatever it actually is.
#
#   make deploy            # vet + test + build for the box + upload + restart
#   make logs              # tail journalctl on the box
#   make healthz           # curl the public URL
#
# First-time setup (systemd unit, Caddy block, DNS) is in deploy/README.md.

# ssh target: a ~/.ssh/config alias, or user@host  (override: make deploy SSH=...)
SSH ?= vpn-ora-m
REMOTE_BIN ?= /usr/local/bin/netwars-server
PUBLIC_URL ?= https://netwars.hmpf.cz
BIN := netwars-server

GO ?= go
BUILD := $(GO) build -trimpath -ldflags "-s -w"

.PHONY: all test vet build build-remote upload deploy install-unit reload-caddy restart logs healthz clean

all: vet test build

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

# native build, for local runs
build:
	$(BUILD) -o $(BIN) ./cmd/netwars-server

# cross-build for the box's actual architecture -> $(BIN)-linux-<goarch>,
# path recorded in .last-build for `upload`.
build-remote:
	@arch=$$(ssh $(SSH) 'uname -m'); \
	case "$$arch" in \
	  x86_64)  ga=amd64 ;; \
	  aarch64|arm64) ga=arm64 ;; \
	  armv7l|armv7) ga=arm ;; \
	  *) echo "unknown remote arch: $$arch" >&2; exit 1 ;; \
	esac; \
	out=$(BIN)-linux-$$ga; \
	echo "box is $$arch -> GOOS=linux GOARCH=$$ga"; \
	GOOS=linux GOARCH=$$ga CGO_ENABLED=0 $(BUILD) -o $$out ./cmd/netwars-server; \
	{ command -v shasum >/dev/null && shasum -a 256 $$out || sha256sum $$out; }; \
	echo $$out > .last-build

upload: build-remote
	@out=$$(cat .last-build); \
	scp $$out $(SSH):/tmp/$(BIN).new; \
	ssh $(SSH) 'sudo install -m 0755 -o root -g root /tmp/$(BIN).new $(REMOTE_BIN) && rm -f /tmp/$(BIN).new'

deploy: vet test upload restart
	@sleep 1
	ssh $(SSH) 'systemctl --no-pager --lines=10 status netwars-server || true'

restart:
	ssh $(SSH) 'sudo systemctl restart netwars-server'

# one-time: copy the unit and enable it
install-unit:
	scp deploy/netwars-server.service $(SSH):/tmp/netwars-server.service
	ssh $(SSH) 'sudo mv /tmp/netwars-server.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now netwars-server'

reload-caddy:
	ssh $(SSH) 'sudo systemctl reload caddy'

logs:
	ssh $(SSH) 'journalctl -u netwars-server -f -n 80'

healthz:
	curl -fsS $(PUBLIC_URL)/healthz

clean:
	rm -f $(BIN) $(BIN)-linux-* .last-build

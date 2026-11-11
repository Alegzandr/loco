# Common dev tasks. Targets are docker-first because Rust is not assumed to be
# installed on the host (Node is). Override RUST_IMAGE if you bump versions.

RUST_IMAGE      ?= rust:1.97-bookworm
SERVER_DIR      := $(CURDIR)/server
CLIENT_DIR      := $(CURDIR)/client
E2E_DIR         := $(CURDIR)/e2e

# protocolgen writes into client/ and reads tools/, so it needs the repo rather
# than server/. It also runs Node (tools/protocol/valibot.mjs turns the JSON
# Schema into Valibot), which the Rust image does not carry.
DOCKER_RUST_REPO = docker run --rm -v $(CURDIR):/repo -w /repo/server
# The server's own targets mount server/ alone, with the cargo registry in a
# named volume so a second run does not download the graph again.
DOCKER_RUST = docker run --rm -v $(SERVER_DIR):/app -v loco-cargo-registry:/usr/local/cargo/registry -w /app

PROTOCOLGEN = sh -c 'command -v node >/dev/null || { apt-get update -qq && apt-get install -y -qq --no-install-recommends nodejs >/dev/null; }; \
	node --test ../tools/protocol/valibot.test.mjs >/dev/null && cargo run -q -p protocolgen -- "$$@"' protocolgen

.PHONY: help dev down test test-server test-client test-e2e bench-server models models-check visual og rooms audio-verify csp lint lint-server lint-client build-server build-client protocol protocol-check

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?##"}{printf "  %-16s %s\n", $$1, $$2}'

dev: ## Start dev stack (server + client, hot reload) via docker compose
	docker compose -f docker-compose.dev.yml up --build

down: ## Stop dev stack
	docker compose -f docker-compose.dev.yml down

test: test-server test-client ## Run server + client unit tests

test-server: ## Run the server's tests in docker (cargo test --workspace)
	$(DOCKER_RUST) $(RUST_IMAGE) cargo test --workspace --locked

test-client: ## Run client unit tests (Vitest)
	cd $(CLIENT_DIR) && npm run test

test-e2e: ## Run Playwright suite (expects server + dev client running OR will start its own)
	cd $(E2E_DIR) && npm test

# Deliberately outside CI: a shared runner's numbers say more about the runner
# than about the code. This is what you run before claiming the event loop is
# or is not the ceiling.
bench-server: ## Time the hub's hot paths (not in CI) — see docs/notes/server.md
	$(DOCKER_RUST) $(RUST_IMAGE) cargo bench -p loco-hub $(ARGS)

protocol: ## Regenerate the client's protocol types + schemas from server/crates/loco-protocol
	$(DOCKER_RUST_REPO) $(RUST_IMAGE) $(PROTOCOLGEN)

protocol-check: ## Fail if the generated protocol files have drifted from the Rust source
	$(DOCKER_RUST_REPO) $(RUST_IMAGE) $(PROTOCOLGEN) --check

models: ## Pack the rooms' models from .assets-in/unpacked into client/public/models — commit the result
	node tools/models/pack.mjs $(ARGS)

models-check: ## Fail if a model the manifest names is missing from client/public/models
	node tools/models/pack.mjs --check

visual: ## Screenshot every showcase scene into .visual/ (no server needed)
	node tools/visual/shoot.mjs $(ARGS)

og: ## Regenerate the link preview (client/public/og.png, 1200x630) — commit the result
	node tools/og/shoot.mjs $(ARGS)

rooms: ## Re-shoot the six room stills the rooms page shows (client/src/assets/rooms) — commit the result
	node tools/rooms/shoot.mjs $(ARGS)

icons: ## Rasterise favicon.svg into the manifest icons + favicon.ico — commit the result
	node tools/icons/shoot.mjs $(ARGS)

cover: ## Regenerate the 600x800 game covers into brand/ (IGDB / Twitch box art) — commit the result
	node tools/cover/shoot.mjs $(ARGS)

audio-verify: ## Assert every synthesised voice actually produces signal (not in CI)
	node tools/audio/verify.mjs $(ARGS)

csp: ## Load the built client behind the real nginx and report CSP violations (not in CI)
	node tools/csp/check.mjs $(ARGS)

lint: lint-server lint-client ## Run all linters

lint-server: ## rustfmt --check, clippy -D warnings and cargo-deny on server (in docker)
	$(DOCKER_RUST) $(RUST_IMAGE) sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; 		cargo fmt --all -- --check && cargo clippy --workspace --all-targets --locked -- -D warnings && 		{ command -v cargo-deny >/dev/null || cargo install --locked cargo-deny; } && cargo deny check'

lint-client: ## ESLint on client
	cd $(CLIENT_DIR) && npm run lint

build-server: ## Build the server's release binary in docker (server/target/release/loco-server)
	$(DOCKER_RUST) $(RUST_IMAGE) cargo build --release --locked -p loco-server

build-client: ## Production client build
	cd $(CLIENT_DIR) && npm run build

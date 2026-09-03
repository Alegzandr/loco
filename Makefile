# Common dev tasks. Targets are docker-first because Go is not assumed to be
# installed on the host (Node is). Override IMAGE_* if you bump versions.

GO_IMAGE        ?= golang:1.26.5-alpine
GOLANGCI_IMAGE  ?= golangci/golangci-lint:v2.12-alpine
SERVER_DIR      := $(CURDIR)/server
CLIENT_DIR      := $(CURDIR)/client
E2E_DIR         := $(CURDIR)/e2e

DOCKER_GO = docker run --rm -v $(SERVER_DIR):/app -w /app
DOCKER_LINT = docker run --rm -v $(SERVER_DIR):/app -w /app
# protocolgen writes into client/, so it needs the repo rather than server/.
DOCKER_GO_REPO = docker run --rm -v $(CURDIR):/repo -w /repo/server

PROTOCOLGEN = go run ./cmd/protocolgen -src protocol -out ../client/src/types

.PHONY: help dev down test test-server test-client test-e2e bench-server visual og audio-verify csp lint lint-server lint-client build-server build-client protocol protocol-check

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?##"}{printf "  %-16s %s\n", $$1, $$2}'

dev: ## Start dev stack (server + client, hot reload) via docker compose
	docker compose -f docker-compose.dev.yml up --build

down: ## Stop dev stack
	docker compose -f docker-compose.dev.yml down

test: test-server test-client ## Run server + client unit tests

test-server: ## Run Go tests in docker
	$(DOCKER_GO) $(GO_IMAGE) go test ./...

test-client: ## Run client unit tests (Vitest)
	cd $(CLIENT_DIR) && npm run test

test-e2e: ## Run Playwright suite (expects server + dev client running OR will start its own)
	cd $(E2E_DIR) && npm test

# Deliberately outside CI: a shared runner's numbers say more about the runner
# than about the code. This is what you run before claiming the event loop is
# or is not the ceiling. 2>/dev/null makes the log benchmarks measure a reader
# that keeps up; without it they measure whatever your terminal does.
bench-server: ## Time one pass of the event loop (not in CI) — see docs/notes/server.md
	$(DOCKER_GO) $(GO_IMAGE) go test ./hub/ -run '^$$' -bench . -benchmem $(ARGS) 2>/dev/null

protocol: ## Regenerate the client's protocol types + schemas from server/protocol
	$(DOCKER_GO_REPO) $(GO_IMAGE) $(PROTOCOLGEN)

protocol-check: ## Fail if the generated protocol files have drifted from the Go source
	$(DOCKER_GO_REPO) $(GO_IMAGE) $(PROTOCOLGEN) -check

visual: ## Screenshot every showcase scene into .visual/ (no server needed)
	node tools/visual/shoot.mjs $(ARGS)

og: ## Regenerate the link preview (client/public/og.png, 1200x630) — commit the result
	node tools/og/shoot.mjs $(ARGS)

icons: ## Rasterise favicon.svg into the manifest icons + favicon.ico — commit the result
	node tools/icons/shoot.mjs $(ARGS)

cover: ## Regenerate the 600x800 game covers into brand/ (IGDB / Twitch box art) — commit the result
	node tools/cover/shoot.mjs $(ARGS)

audio-verify: ## Assert every synthesised voice actually produces signal (not in CI)
	node tools/audio/verify.mjs $(ARGS)

csp: ## Load the built client behind the real nginx and report CSP violations (not in CI)
	node tools/csp/check.mjs $(ARGS)

lint: lint-server lint-client ## Run all linters

lint-server: ## golangci-lint on server (in docker)
	$(DOCKER_LINT) $(GOLANGCI_IMAGE) golangci-lint run ./...

lint-client: ## ESLint on client
	cd $(CLIENT_DIR) && npm run lint

build-server: ## Build server binary in docker
	$(DOCKER_GO) $(GO_IMAGE) go build -o server-bin .

build-client: ## Production client build
	cd $(CLIENT_DIR) && npm run build

# Common dev tasks. Targets are docker-first because Go is not assumed to be
# installed on the host (Node is). Override IMAGE_* if you bump versions.

GO_IMAGE        ?= golang:1.24.7-alpine
GOLANGCI_IMAGE  ?= golangci/golangci-lint:v1.64-alpine
SERVER_DIR      := $(CURDIR)/server
CLIENT_DIR      := $(CURDIR)/client
E2E_DIR         := $(CURDIR)/e2e

DOCKER_GO = docker run --rm -v $(SERVER_DIR):/app -w /app
DOCKER_LINT = docker run --rm -v $(SERVER_DIR):/app -w /app

.PHONY: help dev down test test-server test-client test-e2e visual audio-verify lint lint-server lint-client build-server build-client

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

visual: ## Screenshot every showcase scene into .visual/ (no server needed)
	node tools/visual/shoot.mjs $(ARGS)

audio-verify: ## Assert every synthesised voice actually produces signal (not in CI)
	node tools/audio/verify.mjs $(ARGS)

lint: lint-server lint-client ## Run all linters

lint-server: ## golangci-lint on server (in docker)
	$(DOCKER_LINT) $(GOLANGCI_IMAGE) golangci-lint run ./...

lint-client: ## ESLint on client
	cd $(CLIENT_DIR) && npm run lint

build-server: ## Build server binary in docker
	$(DOCKER_GO) $(GO_IMAGE) go build -o server-bin .

build-client: ## Production client build
	cd $(CLIENT_DIR) && npm run build

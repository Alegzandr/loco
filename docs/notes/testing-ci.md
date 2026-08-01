# Testing, CI/CD and environments

The Playwright suite, the GitLab pipeline and the Docker stacks.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Playwright E2E
- Lives in `e2e/` (separate `package.json`). `@playwright/test` + Chromium + Pixel 5.
- Needs Go server `:8080`. Playwright starts isolated Vite on `:4173`.
  - Local: `docker compose -f docker-compose.dev.yml up --build` then `cd e2e && npm test`.
  - CI: `backend_test` builds `server-bin`; `e2e_test` runs it + Playwright.
- `window.__LOCO_E2E__` exposed in dev only (`import.meta.env.DEV`):
  - `send(msg)`, `getState()`, `playCard(card)` (animates + sends `play_card`), `getWsStatus()`, `forceCloseWs()`.
  - `startTurnRecorder()` / `getRecordedTurns()` — records distinct `currentTurn` transitions. **Use this instead of polling `currentTurn` whenever a bot seat is involved**: a bot holds the turn for only ~800ms, so sampling is inherently flaky, and the recorded sequence additionally proves a skipped seat never held the turn.
  - Tree-shaken from prod builds.
- Types: `e2e/types.d.ts`. Helpers: `e2e/helpers/game.ts`.
- **Every test must stay self-contained** — no `beforeAll`, no `describe.serial`, no state carried
  between tests; each one creates its own room. That is what lets CI shard the suite per *test*
  (`fullyParallel: true`) instead of per spec file, which is what makes four shards even instead of
  27/39/0/21. Sequential execution is `workers: 1`'s job, not `fullyParallel`'s.
- **A fixture must state everything the assertion rests on.** `debug_set_state` sets only what it is
  given, and anything left unsaid is whatever the deal and the bots produced. The pinned fields are
  `direction` (a Reverse mirrors any computed seat), `pendingDraw: 0` (a pending stack routes a tap
  to `counter_draw`), `currentTurn`, and the *colour* of a coloured card. A Swap in the wrong colour
  is not playable, so `handleCardClick` refuses to open its picker — a fixture using a
  `{ color: 'wild', kind: 'swap' }`, a card that exists in no deck, failed on every run once the
  legality check moved ahead of the prompt.
- `webServer` env vars go in `playwright.config.ts`'s `env` object, **not** a `VAR=x cmd` shell prefix — the prefix form is POSIX-only and breaks when the suite runs from Windows.
- Prefer `waitForFunction` + store state over DOM polling. Few high-value tests > many fragile.
- **Update E2E in same commit as gameplay/UI/protocol changes.**
- **Pin the direction with `debugSetState({ direction: 1 })` in any test that computes a seat.**
  `waitForMyTurn` lets the bots play first, and one Reverse among them mirrors the table: a
  3-player Skip then lands on `myIdx-2` instead of `myIdx+2`, and the run reads as a rules bug.
  This is what `debug_direction` exists for — the CI failure it fixes reproduced roughly one run in
  ten and pointed at the Skip rule, which was correct all along.
- The **interrupt window is only armed by a real play** — `debug_set_state` leaves it closed, so a
  successful-interrupt test must have somebody actually play first. Who interrupts no longer matters
  (self-interrupt and current-player interrupt are both legal), but keep bots out of the scenario:
  a bot's 800ms timer plays a card and re-arms the window under the interrupt in flight.
- Entrance animations race clicks: `clickContinue` waits for the round-summary card's animations to
  report `finished` before clicking, because `waitForRoundSummary` resolves on the store flag, which
  flips ~420ms before the card stops moving. Two details that made this flaky in CI, both worth not
  repeating elsewhere: **`getAnimations().every(...)` is vacuously true on an empty list**, and a CSS
  animation only starts on the frame *after* the node is inserted, so the guard has to require the
  animations to have started (`length > 0`) or it sails through and clicks into the spring. And
  **a helper waiting on a self-destructing element must wait on the state, not the gesture** — the
  summary auto-dismisses at 8s, after which the button is detached and never comes back (the caller
  is blocked in the helper, so no further round is forced), and Playwright retries into the test
  timeout while the app has done exactly what was asked. `clickContinue` therefore clicks with a
  short timeout, tolerates losing that race, and returns on `showRoundSummary === false`.
- **A `debug_set_state` fixture must set `pendingDraw: 0` whenever it expects a play to land.**
  `PlayCard` refuses every card while a stack is pending, so a bot that landed a +2 before our turn
  makes the test pass or fail on the deal. Same class as pinning `direction`: the fixture has to
  state everything the assertion depends on, not only the part it is about.
- **Do not leave the local seat on one card at the end of a bot test.** One card opens a catch
  window, a bot answers it about two thirds of the time, and the hand the assertion is reading grows
  under it. Emptying the hand is worse: the round ends and the next one is dealt, so the state being
  asserted lasts milliseconds.
- Two controls must never share an accessible name — the draw pile is `drawPile` ("Pioche"), not
  "Draw", precisely because a strict-mode locator caught the collision.
- Canvas not inspected; verify via DOM (ActionBar, RoundSummary, GameOver) + `__LOCO_E2E__.getState()`.

## CI/CD
Pipeline: `.gitlab-ci.yml`, stages `test → build → deploy`.
- `test` (every push):
  - `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` + builds `server-bin`,
    handed to `e2e_test` through the cache (see "This runner cannot upload artifacts").
  - `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
  - `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): runs `server-bin` + Playwright,
    `parallel: 4` (see "Keeping the pipeline fast"); `needs: [backend_test]` for that binary alone.
  - `backend_lint` (`golangci/golangci-lint:v1.64-alpine`): `cd server && golangci-lint run ./...`.
- `build` only on `develop` or `v*` tags, and **`needs` every test job**, lint and E2E included.
  Naming a subset is what actually gates a deploy: with `needs: [backend_test, frontend_test]` the
  build started the moment those two finished, so the lint and the entire Playwright suite were
  advisory — red on `develop` still shipped to dev, and a version tag still shipped to prod.
- Deploy: `devops` runner tag + GitLab registry. `deploy_dev` auto on `develop`; `deploy_prod` auto on `v*`; `stop_dev` manual.
- **GitLab (`origin`) is the only CI.** The `gh` remote is a plain mirror with no pipeline of its
  own: `.gitlab-ci.yml` is the single definition, so there is nothing to keep in sync. A push to the
  mirror is verified by whatever the same commit did on GitLab, not by GitHub.

### Keeping the pipeline fast
E2E dominates the wall clock, and the rule for every second cut out of it is the same: **spend dead
time, never coverage.** No test is skipped, no gate is loosened, and no reaction window is shortened.

- **`parallel: 4` + `--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL`.** The suite is stateful, so `workers`
  stays at 1 *within* a job and sharding is what parallelises it. `fullyParallel: true` is what makes
  the split even. Left false, Playwright shards whole **spec files** and 87 tests came out
  27/39/0/21, one job running empty. This is the only change here with a prerequisite outside the
  repo: **it needs a runner that accepts concurrent jobs** (`concurrent > 1` in its `config.toml`).
  At `concurrent = 1` the shards queue and pay four setups for one suite, which is slower than not
  sharding at all.
- **`server-bin` is built once by `backend_test`** and handed over through the cache. `e2e_test` used
  to download a 70 MB Go toolchain tarball and rebuild the same binary, on an image with no Go in it,
  once per shard.
- **No `playwright install`.** The image already ships the browsers, and it ships **only the ones its
  own Playwright needs**, so the image tag and `e2e/package-lock.json` are one decision. That step
  was not merely slow, it was *hiding* a drift: `^1.52.0` in `e2e/package.json` had long since
  resolved to **1.58.2** while the image stayed on `v1.52.0`, and the download silently fetched the
  missing browser on every push. Removing it turned a hidden cost into four red shards saying
  `Executable doesn't exist at /ms-playwright/chromium_headless_shell-…`, which names neither file
  that has to change. Two things keep it from recurring: the dependency is pinned **exactly** (no
  caret, because the runtime is a docker image and not a range), and `PLAYWRIGHT_VERSION` is declared once in
  `e2e_test`, interpolated into the image tag, and asserted against `npx playwright --version` before
  the suite runs. Bump the variable and the dependency together, and commit the lockfile.
- **Caches.** `GOPATH`/`GOMODCACHE`/`GOCACHE` and npm's cache are redirected under `$CI_PROJECT_DIR`
  because GitLab can only cache paths inside the project. Every cache key is per-job-family
  (`go`, `golangci`, `npm-client`, `npm-e2e-$CI_NODE_INDEX`): two jobs sharing one key race on the
  upload and the loser's entry is what the next pipeline restores, which is why the shards key on
  their index.
- **`e2e_test` needs `backend_test` only.** It consumes that job's binary and nothing of
  `frontend_test`, so naming it just parked the pipeline's longest job behind the second-longest.
  The `build` job still `needs` every test job, so nothing red can ship — that gate is what makes
  this reordering free.
- **`LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`** cut bot think time from 1.2–2.2 s to 0.25–0.45 s
  in CI (`hub.ApplyBotTimingEnv`). See "Bots" in `server.md`: the think delay is the only bot timing nothing races.
- **The E2E helpers wait on state, not on the clock.** `createRoom`/`joinRoom` wait for the socket to
  be open (`getWsStatus() === 'open'`), which is the actual precondition for the click they precede;
  `debugSetState` waits for the fixture it just sent to appear in the store, tolerating the loss of
  that race exactly as the flat delay did. A fixed delay is both too long on an idle machine and
  occasionally too short on a loaded runner, which is the worse half.

**Serving a static build to the E2E suite was measured and rejected.** A dev-server page load costs
~95 ms (median of 8, cold context), i.e. ~9 s across the whole suite, and `vite build --mode
development` still sets `import.meta.env.DEV` to false — `__LOCO_E2E__`, the turn recorder and the
showcase are all tree-shaken out of the bundle. Buying those 9 s means gating the debug helpers on a
build variable instead, trading a structural guarantee (they *cannot* exist in a production build)
for a configuration one. Not worth it; do not revisit without a new reason.

### This runner cannot upload artifacts
**Nothing in `.gitlab-ci.yml` may use `artifacts:`** until the runner is fixed, and the reason is not
in this repository. The helper container that performs the upload resolves the API host (GitLab's
own external URL, `http://gitlab`) against the LAN's DNS, which does not know that name:
`dial tcp: lookup gitlab on 192.168.1.254:53: no such host`, three retries, `FATAL`. An upload
failure **fails the job**, so a single `artifacts:` block turns a suite where all 87 tests passed
into a red pipeline. The fix is one line on the runner (`extra_hosts`, or joining GitLab's Docker
network, or registering it against the FQDN), not a line of YAML.

- The pipeline lived within that limit without knowing it: `e2e_test` rebuilt the Go binary itself,
  under a comment reading "no artifact transfer needed". The first commit to actually add an
  `artifacts:` block is what surfaced it.
- **`server-bin` therefore travels by cache**, which works because a cache is a tarball on the
  runner's own disk and needs no API call ("cache will not be downloaded from shared cache server").
  Keyed **per branch**, not per commit: a per-SHA key leaves one ~15 MB cache volume behind for every
  push and nothing ever collects them. Correctness comes from a `server-bin.sha` stamp instead:
  `e2e_test` rebuilds unless the cached binary was built from the commit it is testing, which also
  covers two pipelines racing on the same branch. Testing a binary from another commit is the one
  outcome this must not have: it reports on code nobody pushed.
- The cost is real and is **not** the binary: the JUnit report and Playwright's traces and
  screenshots cannot be collected. `e2e_test` keeps the `junit` reporter (the file is written, just
  never uploaded) and the block sits commented out in `.gitlab-ci.yml`, so restoring it is
  uncommenting seven lines once the runner can reach the API.

### Production request path
```
Browser (HTTPS) → Traefik (:443 websecure)
  → client nginx (:80, traefik+internal)
    → /ws     → Go server (:8080, internal only)  [WebSocket]
    → /health → Go server (:8080)
    → /       → nginx static SPA
```
- Go on `internal` network only; nginx bridges traefik↔internal.
- Port chain: Traefik → 80 → nginx → 8080 → Go.

### Production readiness
- Server healthcheck: `wget -qO- http://localhost:8080/health`, 10s/5s/3 retries/5s start.
- `client depends_on server: service_healthy`.
- `write_app_env` writes `PORT`, `DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE` to `app.env`.
- All `docker compose` calls use `--env-file paths.env --env-file app.env`.
- nginx `/ws`: `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`.
- nginx serves `robots.txt` `Disallow: /` on `*-d.<domain>`; prod allows indexing.
- nginx sends CSP / `nosniff` / `Referrer-Policy` / `Permissions-Policy` on every response (`always`).
  See "Anti-cheat" in `server.md` for what the CSP may and may not allow.
- **`connect-src` uses `$http_host`, never `$host`.** `$host` drops the port, and a CSP host source
  with no port means the scheme's *default* one. On :443 the two are identical, so the difference is
  invisible in production and blocks the socket everywhere else — a staging host on a non-default
  port, or anyone running the built image locally.
- **No test can prove the page loads under the CSP, and one pins it to the app anyway.**
  `client/src/test/csp.test.ts` reads `nginx.conf` next to `index.html` and the client sources, and
  couples each directive to whatever needs it: `script-src 'self'` beside the absence of any inline
  `<script>`, `'unsafe-inline'` in `style-src` beside the pre-hydration `<style>` block that forces
  it, `$http_host` (never `$host`) twice in `connect-src`, no remote origin in the policy *or* in
  the sources, and no `eval` / `new Function` / `new Worker` / `blob:` anywhere. Those are the
  regressions that would ship green and break only the served page: an added CDN font or an inline
  script fails here instead of in front of players. What it cannot do is answer "does the built app
  actually run behind this policy", so the manual check below is still owed after any change to
  `nginx.conf`.
- **`make csp` is that check** (`tools/csp/check.mjs`, deliberately outside CI): it brings the
  production-style stack up, loads the page in a real browser and creates a room, then tears the
  stack down. Console clean, fonts loaded and the waiting room reached is the whole verdict, because
  the waiting room only appears after a WebSocket round trip. It collects `securitypolicyviolation`
  events, console errors and failed requests on the way, and checks all four headers are on the
  response. Run it after touching `nginx.conf`. `--url=…` points it at a stack that is already up;
  `--keep` leaves the one it started running.
  - It waits on **the SPA answering, not on `docker compose up -d` returning**. The two are not the
    same on Docker Desktop for Windows, where the start phase can sit there for minutes after the
    page is already being served.

## Linting
- Client: ESLint v9 flat config (`eslint.config.js`). `npm run lint` / `lint:fix`.
- Rules: `@typescript-eslint/recommended`, `react-hooks`, `react-refresh`. `no-unused-vars: error` — prefix `_` to silence.
- CI: lint runs before tests.
- Server: `golangci-lint` (`server/.golangci.yml`) — errcheck, govet, ineffassign, staticcheck, unused, gosimple, misspell, unconvert, bodyclose. CI job `backend_lint` uses `golangci/golangci-lint:v1.64-alpine`. Run locally via `make lint-server` (docker, no host Go required).

## Dev Docker Compose
- `docker-compose.dev.yml` — hot-reload, no host Go/Node needed.
- Backend: `golang:1.24.7-alpine`, bind `./server:/app`, `go run .`, `:8080`.
- Frontend: `node:20-alpine`, bind `./client:/app`, `npm ci && npm run dev`, `:5173` (container 3000).
- **No Vite WS proxy** — browser connects directly to `ws://<host>:8080/ws` (Vite proxy unreliable under Docker).
- `VITE_WS_PORT=8080` env tells client which port (default 8080).
- `useWebSocket.ts`: dev → `ws://${hostname}:${VITE_WS_PORT}/ws`; prod → `ws://${host}/ws` (nginx-proxied).
- `vite.config.ts`: no proxy.
- Volumes: `go-mod-cache`, `client-node-modules` (named, persistent).
- Start: `docker compose -f docker-compose.dev.yml up --build`.


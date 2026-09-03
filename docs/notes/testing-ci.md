# Testing, CI/CD and environments

The Playwright suite, the GitLab pipeline and the Docker stacks.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## An untested path is where the bugs are

TDD, tests first for non-trivial behaviour, deterministic clocks for timing logic. **When a document
in this repository states an invariant, there must be a test that fails without it**, and the reason
that is written as a rule rather than as advice is that it has been broken three times, expensively:

- `DrawCard` mutated state before an all-or-nothing draw, and `applyCardPlayed` removed one card
  where the server had removed N. Both sat in the only paths with no test at all, and `CLAUDE.md`
  described both as already fixed — one of them naming a function that did not exist.
- A card-foil system (`.foil`, `.glint`, `holoOffsetMs`) was documented in detail and existed nowhere
  in the code. Found 2026-08-01. Prose is not compiled, which is what `docPaths.test.ts` now answers.

**Beware an assertion that only restates its fixture.** An E2E test once sent an interrupt, then
asserted the discard and the turn that `debug_set_state` had itself just configured. It passed for
months while the server rejected every interrupt with "interrupt window closed".

Keep tests fast, targeted, non-brittle, and cover game rules over UI details. Review layout, colour
and motion changes with `make visual` instead: reading four contact sheets catches what no assertion
was going to describe. Assertions own behaviour, screenshots own appearance.

Both browser harnesses (`make visual`, `make audio-verify`) launch the Chromium their `playwright`
package downloaded; on a machine that has a browser but not that one, `LOCO_CHROMIUM=/path/to/chrome`
points them at it instead of fetching another copy. The Playwright suite itself is pinned to its
image (`PLAYWRIGHT_VERSION`) and takes no such override.

### The three seams a component test goes through

None of these is optional plumbing. Each one exists because a whole class of test lied without it.

**`src/test/setup.ts`** is the file the runner loads before anything else, and it is the only place
the framework and the DOM are stitched together. It carries a WAAPI shim (jsdom has no
`element.animate`, and a Svelte transition *is* `element.animate`, so without it a transition throws
where it should play); an `eventWrapper` that flushes after every `fireEvent`, which is what lets
hundreds of assertions keep reading the DOM on the line after the click; a `fireEvent.change` that
also dispatches `input`, because a Svelte component listens for the real event a browser fires per
keystroke and wiring `onchange` in the components instead would have the lobby clear a server error
on blur; and one `resetI18n()` per test, since the language is a module that outlives the file.

**`src/test/storeFlush.svelte.ts`** paints a store write before the next assertion, and the guard in
it is the part worth reading. `flushSync()` drains batches until there are none left, so calling it
from inside a batch Svelte is already flushing takes that batch out from under it — the effect
mid-run finishes, Svelte goes to schedule the next one, and `current_batch` is null. What you see is
`Cannot read properties of null (reading 'schedule')` attributed to whatever component happened to
be mounted, naming neither the write nor the flush. The app does write the store from inside effects
(`handleSend` clears the last error before sending), so the subscriber skips the flush whenever
`$effect.tracking()` says Svelte is already painting. That rune is why the module is `.svelte.ts`
and not part of `setup.ts`.

**`src/test/render.ts`** is the only door to `@testing-library/svelte`. The library reads props and
mount options out of the same argument and tells them apart by name: `target`, `anchor`, `props`,
`events`, `context` and `intro` are options and everything else is a prop. Those are ordinary
English words and the game already uses one — `<Reconnecting target="waiting" />` distinguishes
coming back to a table from coming back to a match. The collision has two shapes and the quiet one
is why this is a wrapper instead of a note: a component with a colliding prop *and* an ordinary one
throws `UnknownSvelteOptionsError`, which points at the fix; a component whose **only** prop is a
reserved word mounts happily into the wrong node, and fails somewhere else or not at all. Everything
goes under `props`, so no test has to know the list and a component that gains a prop named
`context` next month breaks nothing. Alongside it, **`src/test/renderHook.ts`** gives a module that
is nothing but `$effect` a component to live in, and its `initialProps` is handed to the setup as an
*accessor* — the same `Live<T>` the hooks already take — so `rerender` reaches through to a hook
mid-flight rather than remounting it with a different argument.

### Required coverage

Room create/join. Nickname entry **and its validation** — the shapes refused, the disguises the
normalisation is supposed to see through, and the legitimate names that must keep playing, because a
filter is only as good as its false-positive list. Game start, turn progression, legal and illegal
moves, skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter and
catch windows, simultaneous resolution. **Contre-LOCO!'s three states and its price**: the threshold
that makes the button pressable (`catchAvailability.test.ts`), the arming that is a separate thing
from the pressing (`actionBar.test.ts`), the card a press that finds nobody costs, and — on both
sides of the wire, because either half alone is a rule that reads fine and plays badly — that it
costs exactly one per card played however often it is pressed.

Reconnect (60s, nickname + room code) **and session restore across a page reload**. Rematch: the ask
**everybody** at the table has to make, one ask dealing nothing, a departure retiring an ask and
completing what is left of the agreement, seat pruning, re-indexing.

Protocol validation and rejection. The two client mirrors of a server rule (the table code's alphabet
and length, the nickname's shape) held against the Go source rather than against a second copy of the
same belief (`serverMirrors.test.ts`). **That React is gone and cannot come back** through the
manifest, the build configuration, an import or a file extension (`noReact.test.ts`). **That a rune
appears only where one is compiled** (`runeScope.test.ts`): a `$state()` in a plain `.ts` is not a
build error, it survives the transform and becomes a call to a global that does not exist, thrown
whenever that line first runs — which in a branch reached mid-match is a table that dies on a card
nobody has played yet. That test strips comments before matching, so a module may explain in prose
why it holds no state, and it checks that the reactive half is still non-empty: a rename turning
every `.svelte.ts` into a plain module would otherwise read as compliance. **Every path the docs
name** (`docPaths.test.ts`) — and do not
add a phantom path to that test's allowlist to make it pass: the allowlist is for paths named in
order to say they are absent, and widening it to cover a claim about the structure is how the guard
stops guarding. The store completing its own derived state (`catchDerivation.test.ts`).

Streamer mode on both sides of the wire: that nothing uncovers a blurred code (no `:hover`, no
`:focus`, no state selector at all in `TableCode.svelte`, and the span out of the tab order), that the
host's switch reaches every seat and rides `room_joined` and the state snapshot, that a guest's own
preference is never overwritten by it, and the two asks the client must **not** send — a change of
seat, and anything at a hostless table (`preferences.test.ts`, `tableStreamerMode.test.ts`,
`hub/streamermode_test.go`, `e2e/tests/streamer-mode.spec.ts`).

The table link: what the code's button copies, the code coming off the address bar, the arrival a
remembered name seats and the one that is asked for a name first. Seat layout at every table size and
viewport. State-to-sound mapping. The host freeing a seat: the refusals, the re-based roster, the
bot's row, and the line the removed player is left holding. Score table.

Matchmaking: pairing, cancel, disconnect-out-of-queue, the host controls a matchmade room refuses,
the requeue an opponent's departure triggers, and every forfeit path (quit, disconnect, AFK).
Link-preview tags against the committed `og.png`. The map, hour and sky draw, the client's lists
pinned to the server's, the light rig, the loading gate. Batch play and batch interrupt, unit **and** E2E. A draw against exhausted piles.
`Origin` checking. The legal disclosures and the truncation of every logged address. Bots
interjecting.

The table's own bookkeeping (`server/hub/table_internal_test.go`): seating a client leaves no pointer
behind on the table it left, a removal shifts the members and the bots and the tokens and the
`playerID`s together, and a reset clears the map gate but not the roster. **That first one goes
through both goroutines now**, since the sweep of the old table is asked of that table rather than
reached into; reading either table's members from the test goroutine would be the very race the
hand-off exists to remove, so every read in it is posted too. The hardening in
`server/hub/hardening_test.go`: a gameplay message at a table that has not dealt, a handler that
panics on demand, every ceiling, the wrong-code budget **and** the mistyped code that must still get
in, the reclaim refusal that names nothing, the reclaim that rotates its token.

What a table owning its own goroutine is supposed to buy, and what it could have cost
(`server/hub/actor_test.go`, both through real sockets):

- **A table that panics answers the message and keeps playing.** On the old shared loop the question
  was whether the process survived. It is nastier now: a panic would take that table's goroutine, and
  a room whose goroutine is gone does not fail, it goes **quiet** — every message queued behind
  nothing, for ever, with no error to show the players.
- **One table held still inside a handler does not hold up another.** This is the whole change in one
  assertion, and it is worth knowing that it does not merely pass: put the handler back on the hub
  loop and it *hangs*, because the hub would be sitting in the first table's handler and would not
  read the second table's messages until it came back.

And the graceful shutdown: what a drain refuses, what it leaves alone, and a full restart where a
match is snapshotted, reloaded by a fresh hub and reclaimed by both players with their original
tokens. That last one has **no E2E counterpart on purpose** — see "The graceful shutdown is
deliberately not covered here" below.

## Playwright E2E
- Lives in `e2e/` (separate `package.json`). `@playwright/test` + Chromium + Pixel 5.
- Needs Go server `:8080`. Playwright starts an isolated dev server on `:4173`, with `--ignore-lock`
  because `astro dev` is a singleton: without it a second invocation prints "dev server already
  running", never binds 4173, and the suite times out because `make dev` happens to be up.
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
- **The 1v1 queue is the one thing a test cannot open its own of, so it is locked rather than
  hidden.** A room code is private: two tests hold two rooms on one server and never meet. There is
  exactly one matchmaking queue per process, it is a FIFO, and `tryPair` hands seat 0 to whoever is
  at the front — so a searcher belonging to another test, arriving between one test's two, is paired
  with one of them. The symptom is not a clean failure: a test waits out its timeout on a
  `match_found` that went to a stranger, and the *other* test fails too.
  `workers: 1` hid this and CI's four shards each start their own `server-bin`, so nothing was
  actually broken — but `fullyParallel: true` states the opposite promise two lines above that
  setting, and raising `workers` would have broken exactly six tests in a way that reads as flake.
  `e2e/helpers/matchmakingQueue.ts` is a cross-process mutex (an atomic `mkdir`, a pid the next
  claimant can check, a staleness backstop above the slowest holder) and every test in
  `matchmaking.spec.ts` claims it. **That is a lock on a shared resource, not shared state**: nothing
  crosses, no order is implied, and a failure does not abandon the rest, which is what
  `describe.serial` would have bought and why the rule above refuses it.
  Two details are the whole of why the first version of it did not work:
  - **The lock is not the whole guarantee; an empty queue is.** Closing a context tears the socket
    down, but the dequeue happens on the hub's goroutine a moment later, so the previous test's
    searcher can still be at the front when the next one enqueues. A fixed sleep is the wrong
    instrument — too short under load, wasted otherwise, silent either way. The claim polls
    `/metrics` for `matchmaking_queue == 0` instead. It is the only place in the suite that reads an
    operator surface, and it has to be: the queue's size is deliberately never on the wire, so there
    is no client-visible way to ask the question at all.
  - **Time spent queuing must not come out of the test's own budget, and it has to be borrowed
    before the wait.** Compensating afterwards cannot work: the clock is already running, so the test
    expires *inside* the polling loop and reports `Test timeout of 30000ms exceeded`, which reads as
    a slow app rather than as a queue. `borrowTime()` raises the budget before the first poll and
    trims it back to what the wait actually cost, which Playwright's "timeout counted from test
    start" makes honest in both directions.
- **Being dealt into a matchmade table is the expensive step, and the default 30s test budget is
  built for one of them.** `waitForMatchmadeGame` waits out the match-found countdown and then the
  map-loading gate, and the gate is the engine's chunk through the dev server into a browser
  context with a cold cache plus a WebGL render on SwiftShader: the single-deal tests in
  `matchmaking.spec.ts` land around 23s, and the
  same test can take 4s on a warm run and 24s on a cold one. The rematch test is dealt in **twice**
  and carries its own `test.setTimeout(90_000)` for that reason. The failure mode is worth knowing
  because it lies: the test times out in whatever line the `finally` is on, with a screenshot of a
  perfectly healthy board and every assertion having passed. Before treating one of these as a
  regression, re-run it with `--timeout=90000` — if it goes green it was the budget, and the fix is
  to say so on the test rather than to trim what it covers.
- **A fixture must state everything the assertion rests on.** `debug_set_state` sets only what it is
  given, and anything left unsaid is whatever the deal and the bots produced. The pinned fields are
  `direction` (a Reverse mirrors any computed seat), `pendingDraw: 0` (a pending stack routes a tap
  to `counter_draw`), `currentTurn`, and the *colour* of a coloured card. A Swap in the wrong colour
  is not playable, so `handleCardClick` refuses to open its picker — a fixture using a
  `{ color: 'wild', kind: 'swap' }`, a card that exists in no deck, failed on every run once the
  legality check moved ahead of the prompt.
- **`backend_test` runs `-race`, and gcc is installed for it.** This server is one event loop plus
  two goroutines per socket, so a data race is not a lint finding here: it is the hidden-state
  guarantee coming apart under load, on the one process that owns every hand at every table.

  It was added after finding a real one that had been in the suite for months. `Hub.Stop` closed
  `h.quit` and returned without waiting, so everything after it ran alongside a loop that was still
  dispatching — in production a process that could exit mid-handler, and in the tests fourteen
  simultaneous races, because every timing test narrows a package-level tunable (`BotThinkDelay` and
  a dozen others) and restores it in a `t.Cleanup` the loop was still reading. One `<-h.stopped` in
  `Stop` closed the whole class. Nothing about it was subtle; it was invisible because **nothing ever
  passed the flag**, which is the actual defect this line fixes.

  One run, not two. The instrumented binary is not the one that ships, but this suite is dominated by
  real sleeps and reaction windows rather than by CPU, so `-race` costs it about two seconds
  (17.5s → 19.4s) and keeping a second uninstrumented run would buy nothing this job can observe.
  `server-bin` is still built `CGO_ENABLED=0`, stated explicitly now that the test run turns cgo on.
  `hub/table_internal_test.go` pins `Stop`'s half of it deterministically, by parking the loop inside
  a handler whose reply nobody is reading yet; the flag is what covers the next one.
- **The graceful shutdown is deliberately not covered here.** A drain and a snapshot restore are
  properties of the *process*, and the suite runs against a server it does not own and cannot restart
  underneath itself. `server/hub/drain_test.go` and `server/hub/snapshot_test.go` are the coverage,
  and they earn it by going through real WebSockets rather than testing the marshalling: the restart
  test stands up one hub, plays a match on it, snapshots, stands up a *second* hub, and has both
  players reconnect with their original tokens and get their hands back card for card. If a way to
  restart the binary mid-suite ever appears, this is the first thing worth an E2E.
- `webServer` env vars go in `playwright.config.ts`'s `env` object, **not** a `VAR=x cmd` shell prefix — the prefix form is POSIX-only and breaks when the suite runs from Windows.
- Prefer `waitForFunction` + store state over DOM polling. Few high-value tests > many fragile.
- **Update E2E in same commit as gameplay/UI/protocol changes.**
- **The fixture's payload is one nested object on the wire** (`{"type":"debug_set_state","debug":{...}}`,
  `protocol.DebugStateDTO`), not seven `debug_*` fields on every message a client can send. No
  player's client ever fills it; `e2e/helpers/game.ts` is the only thing that builds it, and
  `protocol/messages_test.go` pins the bytes so a rename on one side cannot silently deal every
  Playwright table unconfigured.
- **Pin the direction with `debugSetState({ direction: 1 })` in any test that computes a seat.**
  `waitForMyTurn` lets the bots play first, and one Reverse among them mirrors the table: a
  3-player Skip then lands on `myIdx-2` instead of `myIdx+2`, and the run reads as a rules bug.
  This is what `debug.direction` exists for — the CI failure it fixes reproduced roughly one run in
  ten and pointed at the Skip rule, which was correct all along.
- **The interrupt window is open from the deal and `debug_set_state` never touches it either way**,
  so a test asserting a *refusal* has to close it with a real draw or pass — a fixture cannot leave
  it closed any more, and the test that assumed it did went on expecting an error the server had
  stopped sending. Who interrupts does not matter (self-interrupt and current-player interrupt are
  both legal), but keep bots out of the scenario: a bot's 800ms timer plays a card and re-arms the
  window under the interrupt in flight — and on the *opening* discard a bot cannot answer at all,
  which is what makes that window a two-human scenario.
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
  - `backend_test` (`golang:1.26.5-alpine`): `cd server && go test -race ./...` + builds `server-bin`,
    handed to `e2e_test` through the cache (see "This runner cannot upload artifacts").
  - `frontend_test` (`node:24-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
  - `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): runs `server-bin` + Playwright,
    `parallel: 4` (see "Keeping the pipeline fast"); `needs: [backend_test]` for that binary alone.
  - `backend_lint` (`golangci/golangci-lint:v2.12-alpine`): `cd server && golangci-lint run ./...`.
  - `protocol_check` (`golang:1.26.5-alpine`): regenerates the client's protocol types and schemas
    from `server/protocol/` and fails if the result differs from what is committed. Without it the
    generator is a suggestion, and the two files drift back into being hand-maintained copies the
    first time somebody edits one directly. No cache: the generator is stdlib-only and compiles in
    about a second, and a third job pushing a Go cache key would race the two that already do.
- `build` only on `develop` or `v*` tags, and **`needs` every test job**, lint and E2E included.
  Naming a subset is what actually gates a deploy: with `needs: [backend_test, frontend_test]` the
  build started the moment those two finished, so the lint and the entire Playwright suite were
  advisory — red on `develop` still shipped to dev, and a version tag still shipped to prod.
- Deploy: `devops` runner tag + GitLab registry. `deploy_dev` auto on `develop`; `deploy_prod` auto on `v*`; `stop_dev` manual.
- `DEPLOY_DEV` (default `"true"`) gates `deploy_dev` only, and turns it manual rather than removing it: `build` keeps pushing the images so the rollout stays one click away. Tested as `!= "true"` so a mistyped value stops the deploy instead of allowing it. See `docs/deployment.md`.
- **GitLab (`origin`) is the only CI.** The `gh` remote is a plain mirror with no pipeline of its
  own: `.gitlab-ci.yml` is the single definition, so there is nothing to keep in sync. A push to the
  mirror is verified by whatever the same commit did on GitLab, not by GitHub.

### Keeping the pipeline fast
E2E dominates the wall clock, and the rule for every second cut out of it is the same: **spend dead
time, never coverage.** No test is skipped, no gate is loosened, and no reaction window is shortened.

- **`parallel: 4` + `--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL`.** The suite is stateful, so `workers`
  stays at 1 *within* a job and sharding is what parallelises it. `fullyParallel: true` is what makes
  the split even. Left false, Playwright shards whole **spec files**, and the suite's files are
  wildly uneven — `rules-coverage.spec.ts` alone holds 23 of the 147 tests. Measured back at 87, that
  split came out 27/39/0/21: one job running empty while another carried 45% of the suite. This is the only change here with a prerequisite outside the
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
- **`JANUS_API_KEY=` on the `e2e_test` server launch line is load-bearing.** The gateway credentials
  are protected CI/CD variables, so protecting the `v*` tags — which is what makes `deploy_prod` see
  them at all — also injected them into every other job of a tag pipeline. The server binary inherits
  the job's environment, the live poller switched itself on, and `/live.json` (proxied to `:8080` by
  Vite, `astro.config.mjs`) started answering with whoever was streaming the game; `live.spec.ts`
  asserts the served paragraph stays put when nobody is, and it went red on a real channel being on
  air. **The fix belongs in the job, never in the spec**: a suite whose result depends on a stranger's
  stream is not a suite, and CI has no business calling a third party once a minute. Emptying the key
  is the documented off switch everywhere but production (`live.md`). Anything else this pipeline
  starts that reads a protected variable takes the same treatment.
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
failure **fails the job**, so a single `artifacts:` block turns a suite where all 147 tests passed
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
- nginx sends CSP / `nosniff` / `Referrer-Policy` / `Permissions-Policy` /
  `Strict-Transport-Security` on every response (`always`). See "Anti-cheat" in `server.md` for what
  the CSP may and may not allow. HSTS carries **no `includeSubDomains` and no `preload`**: both are
  promises about names this repository does not serve and cannot withdraw once a browser has cached
  them, and `csp.test.ts` fails on either reappearing.
- **The five headers live in `client/security-headers.conf`, and every `location` block that declares
  an `add_header` must `include` it.** This is the one nginx rule that fails silently in the
  direction that matters: `add_header` is inherited into an inner level *only while that level
  declares none of its own*, so it is not "these are added to what the server block set", it is
  "declare one here and you have replaced all of them". `location /_astro/` set `Cache-Control` and
  by doing so shipped the entire JavaScript bundle and every `<Image />`-optimised asset with **no
  CSP, no nosniff, no Referrer-Policy and no Permissions-Policy**.
  Nothing saw it, and the two checks that exist are why. `make csp` read headers off the
  `page.goto()` response — the document, which kept all four — and reported clean. `csp.test.ts`
  regexed `add_header` lines out of the config text and asserted their *values*, which were never
  wrong; the question was never what the headers said, it was which responses got them. A guard that
  reads a directive cannot see an inheritance rule.
  The exposure that makes it worth fixing rather than noting is `nosniff`: anything under `/_astro/`
  a browser can be talked into rendering as a document is a document **with no policy at all** on
  this origin, and Astro emits optimised images there, SVG included. Nothing user-controlled lands in
  that directory today, which is exactly the argument for closing it before something does.
  Both checks were fixed to see the shape rather than the values: `csp.test.ts` brace-matches every
  `location` block and fails on one that declares an `add_header` without the include, and
  `tools/csp/check.mjs` now asserts the five headers on an actual `/_astro/` sub-resource response —
  and reports a problem if the page pulled in no asset to check, so it cannot pass by finding
  nothing.
- **`connect-src` uses `$http_host`, never `$host`.** `$host` drops the port, and a CSP host source
  with no port means the scheme's *default* one. On :443 the two are identical, so the difference is
  invisible in production and blocks the socket everywhere else — a staging host on a non-default
  port, or anyone running the built image locally.
- **No test can prove the page loads under the CSP, and one pins it to the app anyway.**
  `client/src/test/csp.test.ts` reads `nginx.conf` next to the `.astro` markup and the client
  sources, and couples each directive to whatever needs it: `script-src 'self'` beside the absence
  of any `is:inline` script **and of any `client:*` island directive** (Astro's hydration runtime is
  inline by construction, so one island is a blank production page), `'unsafe-inline'` in
  `style-src` beside the inlined stylesheets and the per-card `style` attributes that force it,
  `$http_host` (never `$host`)
  twice in `connect-src`, no remote origin in the policy *or* in
  the sources, and no `eval` / `new Function` / `new Worker` / `blob:` anywhere. Those are the
  regressions that would ship green and break only the served page: an added CDN font or an inline
  script fails here instead of in front of players. What it cannot do is answer "does the built app
  actually run behind this policy", so the manual check below is still owed after any change to
  `nginx.conf`.
- **The redirect chain is the other untested-by-construction half of that file, and it is modelled
  rather than asserted.** `client/src/test/redirects.test.ts` reads the emitted page tree, then
  replays every public URL — both spellings of every path in `PAGES`, plus the invitation — through
  a model of nginx's own rules and of an edge that upgrades plaintext, failing if a chain revisits a
  URL, leaves https, or ends anywhere but a page that exists. A line-level assertion would have been
  half the file and none of the value: what shipped was a config with no `return` and no `rewrite`
  in it at all, whose one implicit redirect answered an https visitor with an `http://` URL. Only
  following the chain sees that. The cause, the measurements and the two alternatives rejected are
  in [`seo.md`](seo.md).
- **`make csp` is that check** (`tools/csp/check.mjs`, deliberately outside CI): it brings the
  production-style stack up, loads the page in a real browser and creates a room, then tears the
  stack down. Console clean, fonts loaded and the waiting room reached is the whole verdict, because
  the waiting room only appears after a WebSocket round trip. It collects `securitypolicyviolation`
  events, console errors and failed requests on the way, and checks all five headers are on the
  response. Run it after touching `nginx.conf`. `--url=…` points it at a stack that is already up;
  `--keep` leaves the one it started running.
  - It waits on **the SPA answering, not on `docker compose up -d` returning**. The two are not the
    same on Docker Desktop for Windows, where the start phase can sit there for minutes after the
    page is already being served.
- **`make bench-server` is the third**, `server/hub/loop_bench_test.go`, and it answers a question no
  assertion can: what one pass of the event loop costs. It is outside CI for the ordinary reason
  benchmarks are — a shared runner's numbers describe the runner — and it is not decoration. Every
  argument about sharding the hub, moving work off the loop or raising a ceiling starts here, and the
  one it has already settled (an actor per table, and the log line that turned out to cost more than
  a card play) is written up in [`server.md`](server.md).
  - It is an **internal** benchmark, package `hub`, because it calls `dispatch` directly: going
    through a socket would measure the kernel.
  - `2>/dev/null` is baked into the target on purpose. The log benchmarks measure a real write to
    stderr, so without it they measure whatever happens to be attached to your terminal, which is
    the exact variable they exist to expose. Run it both ways when that is the number you want.

## Linting
- Client: ESLint v10 flat config (`eslint.config.js`). `npm run lint` / `lint:fix`.
- Rules: `@typescript-eslint/recommended`, `react-hooks`, `react-refresh`. `no-unused-vars: error` — prefix `_` to silence.
- CI: lint runs before tests.
- Server: `golangci-lint` (`server/.golangci.yml`) — errcheck, govet, ineffassign, staticcheck, unused, misspell, unconvert, bodyclose. CI job `backend_lint` uses `golangci/golangci-lint:v2.12-alpine`. Run locally via `make lint-server` (docker, no host Go required).

### What the two major linter bumps changed, and what was pinned back
Both tools widened what they report by default, and in both cases the widening was a style
expansion rather than a correctness one. The configs say so explicitly rather than letting a
future reader mistake the exclusions for neglect.

- **`eslint-plugin-svelte`'s recommended set is kept whole**, and that is a deliberate change of
  posture from what stood here before. The React config it replaced had four rules switched off,
  because the React Compiler's static analysis flagged 27 sites that were this game's timing model —
  every hook publishing an external clock, the `Date.now()` a countdown is measured from, CardFall's
  per-card `Math.random()`. None of that is a conflict any more: a Svelte effect reading a clock
  and writing a `$state` is the ordinary way to write one. So nothing is disabled at the config
  level, and the two rules the game does argue with are argued with **in place, one line at a time,
  with the reason written next to them**:
  - `svelte/prefer-svelte-reactivity` on `GameView`'s `lastAction` map. It is the double-tap guard's
    timestamp book, written on every accepted tap and read by nothing that renders; a `SvelteMap`
    would make the hottest path on the board invalidate a subscriber that does not exist.
  - `svelte/no-unused-svelte-ignore` is what catches an ignore comment that has stopped applying —
    which is how `Deck.svelte` was found silencing the wrong a11y warning, its `role` having become
    conditional since the comment was written.
  A rule turned off in `eslint.config.js` is invisible; a rule turned off on one line is read by the
  next person to touch that line. Prefer the second.
- **golangci-lint 2 folded `gosimple`, `stylecheck` and `quickfix` into `staticcheck`**, and stopped
  applying v1's default exclusions unless asked. Straight off the `golangci-lint migrate` output the
  job reported 14 new issues, none of them a bug: capitalised error strings, "could use a tagged
  switch", and the deliberate zero-width characters in `nickname_test.go`'s fixtures — plus three
  unchecked `conn.Close()` calls that v1's built-in `EXC0001` had always excluded. So
  `server/.golangci.yml` names `SA*` and `S1*` under `linters.settings.staticcheck.checks` (v1's
  staticcheck plus gosimple, and nothing else) and re-enables the four exclusion presets that
  reproduce v1's defaults.

## Image hardening and reproducibility
- **`client/Dockerfile` copies `package-lock.json` and runs `npm ci`.** It used to copy
  `package.json` alone and run `npm install`, so the whole transitive tree was re-resolved on every
  build: two builds of the same commit were not the same image, and a dependency compromised between
  them would have shipped with nothing in the diff to show it. The lockfile is committed precisely so
  that cannot happen; it just was not being copied in.
- **`server/Dockerfile` runs as uid 10001.** The process binds a port above 1024, reads no system
  path and writes one file (the shutdown snapshot under `/data`), so it needs nothing it is not
  being given. `deploy/compose.yml` and `docker-compose.yml` add `no-new-privileges`,
  `cap_drop: ALL`, a read-only root filesystem and a tmpfs `/tmp`.
- **nginx gets `no-new-privileges` and nothing more.** The stock image starts as root to bind :80
  before dropping to the `nginx` user, and writes its caches and pid under `/var`, so `cap_drop: ALL`
  and `read_only` both stop it booting. Rewriting it rootless is a separate change with its own ways
  of going wrong, and this container serves static files and proxies a socket: the server behind it
  is where the state is.
- **`${DATA_DIR}/snapshots` is chowned to 10001 and chmodded 0700 by the deploy job.** A bind mount
  overrides whatever the image chowned, and a server that cannot write its snapshot loses exactly the
  matches the snapshot exists to save. 0700 because that file holds session tokens and hands.

## Dev Docker Compose
- `docker-compose.dev.yml` — hot-reload, no host Go/Node needed.
- Backend: `golang:1.26.5-alpine`, bind `./server:/app`, `go run .`, `:8080`.
- Frontend: `node:24-alpine` (Astro 7 declares `engines.node >= 22.12`), bind `./client:/app`,
  `npm ci && npm run dev`, `:5173` (container 3000).
- **No dev-server WS proxy** — browser connects directly to `ws://<host>:8080/ws` (the proxy is unreliable under Docker).
- `VITE_WS_PORT=8080` env tells client which port (default 8080).
- `hooks/webSocket.svelte.ts`: dev → `ws://${hostname}:${VITE_WS_PORT}/ws`; prod → `ws://${host}/ws` (nginx-proxied).
- `astro.config.mjs`: no proxy. `server.ws.clientPort` (not the deprecated `server.hmr.*`) carries
  `VITE_HMR_CLIENT_PORT` so HMR dials the published 5173 rather than the container's 3000.
- Volumes: `go-mod-cache`, `client-node-modules` (named, persistent).
- Start: `docker compose -f docker-compose.dev.yml up --build`.
- **The client command drops `.astro/dev.json` before it starts, and it has to.** Astro 7's dev
  server is a singleton holding that lock file, which lives on the bind mount and so outlives the
  container that wrote it. A stale lock is supposed to clear itself: `checkExistingServer` asks
  whether the recorded pid is alive. Across a container restart that question has no meaning — pids
  begin again at 1, and the pid the dead server recorded (43, npm's own child) is alive again on
  every boot, so the lock reads as held by a server that has not existed since the last Ctrl+C.
  `astro dev` refuses, `restart: unless-stopped` tries again, and the stack loops on that refusal
  forever. `--force` is the documented escape and is the wrong one here: it SIGKILLs that pid, which
  now belongs to something else in the new container. The lock is only ever this container's, so
  removing it is safe. **The capture harnesses answer the same singleton differently**
  (`tools/lib/devserver.mjs`, `--ignore-lock`): they run on the host, where a lock may genuinely
  belong to a dev server somebody is using.

### An ad-hoc `docker run` from Git Bash on Windows corrupts its own paths
Git Bash (MSYS) rewrites any argument that looks like a POSIX path list: the `:` separator becomes a
Windows `;`. So `-v /f/dev/loco/server:/app -w /app` reaches Docker as
`-v 'F:\dev\loco\server;C:/Program Files/Git/app' -w 'C:/Program Files/Git/app'`. The `-w` fails
loudly ("invalid, it needs to be an absolute path"), but the `-v` fails *silently first*: Docker
Desktop creates the missing bind source, so a stray empty `server;C` directory appears at the repo
root, invisible to `git status` because git does not track empty directories. One appeared that way
on 2026-07-30 and sat there unexplained for two days.

Three ways out, in order of preference: use `make` (it runs from PowerShell or from a container, so
no conversion happens); run the `docker run` through PowerShell with a Windows source
(`-v "F:\dev\loco\server:/app"`); or, if it must be Bash, prefix `MSYS_NO_PATHCONV=1`.


# Testing, CI/CD and environments

The Playwright suite, the GitLab pipeline and the Docker stacks.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## An untested path is where the bugs are

TDD, tests first for non-trivial behaviour, deterministic clocks for timing logic. **When a document
in this repository states an invariant, there must be a test that fails without it**, and the reason
that is written as a rule rather than as advice is that it has been broken three times, expensively:

- The Go server's `DrawCard` mutated state before an all-or-nothing draw (`Room::draw_card` now
  validates first and draws second, and a proptest holds it), and `applyCardPlayed` removed one card
  where the server had removed N. Both sat in the only paths with no test at all, and `CLAUDE.md`
  described both as already fixed — one of them naming a function that did not exist.
- A card-foil system (`.foil`, `.glint`, `holoOffsetMs`) was documented in detail and existed nowhere
  in the code. Found 2026-08-01. Prose is not compiled, which is what `docPaths.test.ts` now answers.

**Beware an assertion that only restates its fixture.** An E2E test once sent an interrupt, then
asserted the discard and the turn that `debug_set_state` had itself just configured. It passed for
months while the server rejected every interrupt with "interrupt window closed".

Keep tests fast, targeted, non-brittle, and cover game rules over UI details. Review layout, colour
and motion changes with `make visual` instead (it also shoots the content pages and the 404, which
share the game's shell since SvelteKit: `--pages=only` for those alone, `--pages=off` to skip them):
reading four contact sheets catches what no assertion
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
costs exactly one per offer however often it is pressed, nothing at all where nothing is offered,
that a press is answered on the instant it arrives (`server/crates/loco-hub/tests/catch_immediate.rs`),
and that the button is still live — and the press still charged — for `CATCH_GRACE_MS` after the
offer vanished, the half of the wager an interface can silently take away (`penalties.spec.ts`).
**Which of two presses arrives first is not an E2E assertion**: measured through Playwright, a 6ms
head start given to one page's `WebSocket.send` did not survive to the server, so that test decided
on the harness rather than on the rule and the ordering is pinned in the hub's own suite instead.

The domain's invariants over random play, not only over the cases somebody thought of
(`server/crates/loco-game/src/tests/proptests.rs`): the 112 cards conserved across hands, deck and
pile, `Wild` never the active colour, a draw the seat is owed never failing, a refusal leaving the
room exactly as it was, and the LOCO! gate on all four finishing paths. A shrunk failure is written
to `server/crates/loco-game/proptest-regressions/` and replayed first on every later run, so commit
it with the fix. One scripted round's event log is pinned with `insta`
(`server/crates/loco-game/src/tests/scripted_round.rs`, the snapshot under
`server/crates/loco-game/src/tests/snapshots/`): a change to it is a change to what a reconnecting
client replays, and has to be accepted on purpose.

The wire, byte for byte (`server/crates/loco-protocol/tests/parity.rs`): every server frame and
every client frame the Go server wrote or read (`server/crates/loco-protocol/tests/fixtures/`) reads
back unchanged, a zero behind an `Option` is still written, and the wire enums stay pinned to the
domain's (`server/crates/loco-protocol/tests/enums.rs`). And a match the Go server snapshotted is
reclaimed by both players on the Rust one (`server/crates/loco-hub/tests/go_snapshot.rs`), which is
what let the cutover deploy without ending the matches in flight.

Reconnect (60s, nickname + room code) **and session restore across a page reload**. Rematch: the ask
**everybody** at the table has to make, one ask dealing nothing, a departure retiring an ask and
completing what is left of the agreement, seat pruning, re-indexing.

Protocol validation and rejection. The two client mirrors of a server rule (the table code's alphabet
and length, the nickname's shape) held against the Rust source rather than against a second copy of the
same belief (`serverMirrors.test.ts`). **That React is gone and cannot come back** through the
manifest, the build configuration, an import or a file extension (`noReact.test.ts`). **That a rune
appears only where one is compiled** (`runeScope.test.ts`): a `$state()` in a plain `.ts` is not a
build error, it survives the transform and becomes a call to a global that does not exist, thrown
whenever that line first runs — which in a branch reached mid-match is a table that dies on a card
nobody has played yet. That test strips comments before matching, so a module may explain in prose
why it holds no state, and it checks that the reactive half is still non-empty: a rename turning
every `.svelte.ts` into a plain module would otherwise read as compliance. **That the Svelte
compiler has nothing to say about any component** (`svelteWarnings.test.ts`, compiled with
`dev: true`, which is what `make dev` compiles with): the boot printed thirty-three warnings and
every one of them was expected, which is a boot nobody reads — the point of the test is the
thirty-fourth, the one about a handler that will never fire, arriving alone instead of in the same
scroll. **Every path the docs
name** (`docPaths.test.ts`) — and do not
add a phantom path to that test's allowlist to make it pass: the allowlist is for paths named in
order to say they are absent, and widening it to cover a claim about the structure is how the guard
stops guarding. The store completing its own derived state (`catchDerivation.test.ts`).

Streamer mode on both sides of the wire: that nothing uncovers a blurred code (no `:hover`, no
`:focus`, no state selector at all in `TableCode.svelte`, and the span out of the tab order), that the
host's switch reaches every seat and rides `room_joined` and the state snapshot, that a guest's own
preference is never overwritten by it, and the two asks the client must **not** send — a change of
seat, and anything at a hostless table (`preferences.test.ts`, `tableStreamerMode.test.ts`,
`server/crates/loco-hub/tests/streamermode.rs`, `e2e/tests/streamer-mode.spec.ts`).

The table link: what the code's button copies, the code coming off the address bar, the arrival a
remembered name seats and the one that is asked for a name first. Seat layout at every table size and
viewport. State-to-sound mapping. The host freeing a seat: the refusals, the re-based roster, the
bot's row, and the line the removed player is left holding. Score table.

Matchmaking: pairing, cancel, disconnect-out-of-queue, the host controls a matchmade room refuses,
the requeue an opponent's departure triggers, and every forfeit path (quit, disconnect, AFK).
Link-preview tags against the committed `og.png`. The map, hour and sky draw, the client's lists
pinned to the server's, the light rig, the loading gate. Batch play and the interject's refusal of one, unit **and** E2E. A draw against exhausted piles.
`Origin` checking. The legal disclosures and the truncation of every logged address. Bots
interjecting.

The table's own bookkeeping (`server/crates/loco-hub/src/internal_tests/table_internal.rs`): seating
a client leaves no pointer behind on the table it left, a removal shifts the members and the bots and
the tokens and the seats together, a reset clears the map gate but not the roster, and `Hub::stop`
waits for the loop to leave the handler it is in. **The first one goes through both tables' tasks**,
since the sweep of the old table is asked of that table rather than reached into; every read in the
file is posted to the table that owns it (`on_table`), because a table's state is not reachable from
the test task any other way. The hardening in `server/crates/loco-hub/tests/hardening.rs`: a gameplay
message at a table that has not dealt, a handler that panics on demand, every ceiling, the wrong-code
budget **and** the mistyped code that must still get in, the reclaim refusal that names nothing, the
reclaim that rotates its token.

What a table owning its own task is supposed to buy, and what it could have cost
(`server/crates/loco-hub/tests/actor.rs`):

- **A table that panics answers the message and keeps playing.** On the old shared loop the question
  was whether the process survived. It is nastier now: a panic would take that table's task, and a
  room whose task is gone does not fail, it goes **quiet** — every message queued behind nothing, for
  ever, with no error to show the players. Every job is run inside `catch_unwind` (`actor.rs` on the
  table, `dispatch.rs` on the hub) and counted on `/metrics` as `handler_panics`.
- **One table held still inside a handler does not hold up another.** This is the whole change in one
  assertion, and it is worth knowing that it does not merely pass: put the handler back on the hub
  loop and it *hangs*, because the hub would be sitting in the first table's handler and would not
  read the second table's messages until it came back. It runs on a multi-threaded runtime on
  purpose: the held handler blocks its thread outright, and on a one-thread runtime that would stop
  every other table for a reason that has nothing to do with the hub.

And the graceful shutdown: what a drain refuses, what it leaves alone, and a full restart where a
match is snapshotted, reloaded by a fresh hub and reclaimed by both players with their original
tokens. That last one has **no E2E counterpart on purpose** — see "The graceful shutdown is
deliberately not covered here" below.

## Playwright E2E
- Lives in `e2e/` (separate `package.json`). `@playwright/test` + Chromium + Pixel 5.
- Needs the game server on `:8080`. Playwright starts an isolated Vite dev server on `:4173` with
  `--strictPort`, so a busy port fails loudly instead of moving the server one port over where the
  suite would never find it. Vite takes no lock, so it runs beside `make dev` (Astro's dev server was
  a singleton and needed `--ignore-lock`, plus clearing the agent-detection variables that made it
  background itself; both are gone).
  - Local: `docker compose -f docker-compose.dev.yml up --build` then `cd e2e && npm test`.
  - CI: `backend_test` builds `server-bin` (the static musl `loco-server`); `e2e_test` runs it +
    Playwright.
- `window.__LOCO_E2E__` exposed in dev only (`import.meta.env.DEV`):
  - `send(msg)`, `getState()`, `playCard(card)` (animates + sends `play_card`), `getWsStatus()`, `forceCloseWs()`.
  - `startTurnRecorder()` / `getRecordedTurns()` — records distinct `currentTurn` transitions. **Use this instead of polling `currentTurn` whenever a bot seat is involved**: a bot holds the turn for only ~800ms, so sampling is inherently flaky, and the recorded sequence additionally proves a skipped seat never held the turn.
  - Tree-shaken from prod builds.
- Types: `e2e/types.d.ts`. Helpers: `e2e/helpers/game.ts`.
- **Every test must stay self-contained** — no `beforeAll`, no `describe.serial`, no state carried
  between tests; each one creates its own room. That is what lets CI shard the suite per *test*
  (`fullyParallel: true`) instead of per spec file, which is what makes four shards even instead of
  27/39/0/21. It is also what lets `workers` be more than one off CI.
- **The 1v1 queue is the one thing a test cannot open its own of, so it is locked rather than
  hidden.** A room code is private: two tests hold two rooms on one server and never meet. There is
  exactly one matchmaking queue per process, it is a FIFO, and `try_pair` hands seat 0 to whoever is
  at the front — so a searcher belonging to another test, arriving between one test's two, is paired
  with one of them. The symptom is not a clean failure: a test waits out its timeout on a
  `match_found` that went to a stranger, and the *other* test fails too.
  A single worker hid this and CI's four shards each start their own `server-bin`, so nothing was
  actually broken — but `fullyParallel: true` states the opposite promise, and raising `workers`
  would have broken exactly six tests in a way that reads as flake.
  `e2e/helpers/matchmakingQueue.ts` is a cross-process mutex (an atomic `mkdir`, a pid the next
  claimant can check, a staleness backstop above the slowest holder) and every test in
  `matchmaking.spec.ts` claims it. **That is a lock on a shared resource, not shared state**: nothing
  crosses, no order is implied, and a failure does not abandon the rest, which is what
  `describe.serial` would have bought and why the rule above refuses it.
  Two details are the whole of why the first version of it did not work:
  - **The lock is not the whole guarantee; an empty queue is.** Closing a context tears the socket
    down, but the dequeue happens on the hub's loop a moment later, so the previous test's
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
- **A table task owns its state and nothing reads it off that task, and the compiler is what
  enforces it.** This server is one hub loop, one task per table and two per socket, so a data race
  is not a lint finding here: it is the hidden-state guarantee coming apart under load, on the one
  process that owns every hand at every table. The Go server needed `go test -race` in CI to catch
  one; there is no flag to pass now. A `Table` lives inside its task (`server/crates/loco-hub/src/actor.rs`),
  the hub reaches it only by posting a job, and anything that crosses between tasks has to be `Send`
  — a test that read a table's members from the test task would not compile, which is why
  `table_internal.rs` posts every read. The workspace forbids `unsafe_code` (`server/Cargo.toml`),
  so the guarantee cannot be opted out of one block at a time.

  What the flag found in Go is worth keeping as the reason the shape is what it is. `Hub.Stop` closed
  its quit channel and returned without waiting, so everything after it ran alongside a loop that
  was still dispatching — in production a process that could exit mid-handler, and in the tests
  fourteen simultaneous races, because every timing test narrowed a package-level tunable and
  restored it while the loop was still reading it. Both halves are structural now. The tunables are
  per hub (`HubConfig`, `Timings`, `BotTimings`, `server/crates/loco-hub/src/config.rs`), so a timing
  test narrows its own hub's copy and there is nothing shared to restore. And `Hub::stop` waits until
  the loop and every table's task are gone; `stop_waits_for_the_loop_to_leave_the_handler` pins it by
  parking the loop inside a handler whose reply nobody is reading yet. The compiler cannot see that
  one: a stop that returns early is not a data race, it is a lifetime.

  **Time is the other thing a test must own.** The domain takes `now` as an argument, so its suite
  needs no clock at all. In the hub, the unix milliseconds the domain and the wire read are derived
  from tokio's clock (`server/crates/loco-hub/src/clock.rs`), so a test that drives a `Table` or the
  actor directly runs under `tokio::time::pause` (`#[tokio::test(start_paused = true)]`) and the
  catch windows, the turn deadline and the bot delays all move together when it advances. The
  socket tests (`server/crates/loco-hub/src/testkit.rs`) run on real time on purpose: a paused clock
  auto-advances whenever the runtime is idle, and a test waiting on a socket is idle, so every
  deadline would fire before the reply it is waiting for.
- **The graceful shutdown is deliberately not covered here.** A drain and a snapshot restore are
  properties of the *process*, and the suite runs against a server it does not own and cannot restart
  underneath itself. `server/crates/loco-hub/tests/drain.rs` and
  `server/crates/loco-hub/tests/snapshot.rs` are the coverage,
  and they earn it by going through real WebSockets rather than testing the marshalling: the restart
  test stands up one hub, plays a match on it, snapshots, stands up a *second* hub, and has both
  players reconnect with their original tokens and get their hands back card for card. If a way to
  restart the binary mid-suite ever appears, this is the first thing worth an E2E.
- `webServer` env vars go in `playwright.config.ts`'s `env` object, **not** a `VAR=x cmd` shell prefix — the prefix form is POSIX-only and breaks when the suite runs from Windows.
- Prefer `waitForFunction` + store state over DOM polling. Few high-value tests > many fragile.
- **Update E2E in same commit as gameplay/UI/protocol changes.**
- **The fixture's payload is one nested object on the wire** (`{"type":"debug_set_state","debug":{...}}`,
  `DebugStateDTO` in `loco-protocol`), not seven `debug_*` fields on every message a client can
  send. No player's client ever fills it; `e2e/helpers/game.ts` is the only thing that builds it, and
  `server/crates/loco-protocol/tests/parity.rs` replays recorded `debug_set_state` frames through it
  so a rename on one side cannot silently deal every Playwright table unconfigured. The server reads
  it only with `LOCO_E2E=1`.
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
  `Room::play_card` refuses every card while a stack is pending, so a bot that landed a +2 before our turn
  makes the test pass or fail on the deal. Same class as pinning `direction`: the fixture has to
  state everything the assertion depends on, not only the part it is about.
- **Do not leave the local seat on one card at the end of a bot test.** One card opens a catch
  window, a bot answers it about two thirds of the time, and the hand the assertion is reading grows
  under it. Emptying the hand is worse: the round ends and the next one is dealt, so the state being
  asserted lasts milliseconds.
- Two controls must never share an accessible name — the draw pile is `drawPile` ("Pioche"), not
  "Draw", precisely because a strict-mode locator caught the collision.
- Canvas not inspected; verify via DOM (ActionBar, RoundSummary, GameOver) + `__LOCO_E2E__.getState()`.

### The suite that opens the most tables renders the fewest rooms

`VITE_E2E_NO_SCENE=1`, set by `playwright.config.ts` on the dev server it owns, read by
`sceneCache.prepareScene`.

Every test that reaches a board goes through the map-loading gate, and the gate waits for a
three.js render of the room. Measured against the dev server, per fresh context:

| | requests | transferred | render |
| --- | --- | --- | --- |
| the app's page alone | 217 | 0.4 MB | — |
| the same page with the room | 466 (220 of them models) | ~7 MB | +2.2 s |

The suite opens about 167 tables (95 `startGame`, 60 explicit `waitForTableOpen` on secondary
pages, 12 matchmade), so the room cost roughly six minutes of wall clock and 1.2 GB served on a
fast machine with a warm Vite cache — and considerably more on a CI runner or a cloud sandbox,
where the GPU is SwiftShader and the CPU is shared. **It bought no assertion**: nothing in `e2e/`
touches the scene, because appearance belongs to `make visual` and behaviour to this suite.

What the flag does is take the path a machine with no WebGL already takes: `prepareScene` keeps the
entry with a null bitmap, the board draws the sky gradient the rig describes, the gate is answered
and `map_ready` is still sent. The gate's own mechanism — the bar, `MAP_BAR_FULL_MS`, the timeout —
is exercised exactly as before, and so is every ordering the server enforces behind it.

Two decisions inside that are less obvious than they look:

- **It goes on the dev server, not in an init script.** A page reaches this suite four ways: the
  `page` fixture, a bare `browser.newContext()` (112 of those), a second tab, an invitation link.
  An `addInitScript` hung off `createRoom` covers the first and misses the rest, and what it misses
  is a room quietly rendered with nobody noticing the flag did not apply. The dev server is the one
  thing all four share.
- **`import.meta.env.DEV` is what keeps it out of production**, not the absence of the variable.
  Vite replaces `DEV` with `false` in a build, the constant folds, and the branch — with the lazy
  `import('./render')` inside it — is the only path that survives. A flag guarded only by its own
  environment variable is a production bundle one `docker build --build-arg` away from shipping a
  game with no rooms.

`sceneLoadingGate.test.ts` pins all four ends: the flag is off in Vitest, the name the config sets
is the name the cache reads, the `DEV` guard is present, and the engine import is still *inside* the
guard — which is where the saving actually is.

### A wait may not outlive the test that owns it

`helpers/game.ts: budget()`, plus `timeout: 60_000` in the config.

Several helpers were written with the length of the thing they wait for: `waitForGameOver` capped at
120s, `waitForUnoDeclared` at 90s, `waitForRoundSummary` at 60s. The test around them had
Playwright's default 30s. Two things fell out of that and both cost CI time.

The caps could never fire, so a genuinely hung wait was always reported as `Test timeout of 30000ms
exceeded` — the one message that says nothing about what was being waited for, which is precisely
what you need from a runner you cannot attach a debugger to. And a match that ran past 30s honestly,
which a BO1 against a bot on a loaded runner does, failed and was retried in full.

`budget(wantMs)` reads `test.info().timeout` and returns the smaller of what the wait is worth and
what the test has left it, less a margin for the assertion that follows. A test that genuinely needs
longer says so with `test.setTimeout` and the helpers follow it — `round-progression.spec.ts` asks
for 120s and gets it. Outside a test it takes the wait at its word, so the helpers stay reusable by
tooling.

Raising the global budget to 60s is the other half: it stops the suite relying on luck, and
`budget()` is what stops a hung test spending all of it in silence.

## CI/CD
Pipeline: `.gitlab-ci.yml`, stages `test → build → deploy`.
- `test` (every push). Every Rust job runs on `rust:1.97-bookworm` and passes `--locked`, so a
  `server/Cargo.lock` out of step with the manifests fails rather than being re-resolved:
  - `backend_test`: `cd server && cargo test --workspace --locked` (every crate, the domain, the
    protocol and the hub's socket suites among them); then `cargo build -p loco-game --target
    wasm32-unknown-unknown`, so the domain keeps building for the browser — a dependency that reaches
    for the OS (a clock, a file, an entropy source) fails here rather than the day somebody tries;
    then the release `loco-server` for `x86_64-unknown-linux-musl` (with `musl-tools`), copied to
    `server-bin` with `server-bin.sha` beside it and handed to `e2e_test` through the cache (see
    "This runner cannot upload artifacts"). Static because the Playwright image's glibc is older than
    the build image's, and because `server/Dockerfile` ships the same static build.
  - `frontend_test` (`node:24-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
  - `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): runs `server-bin` + Playwright,
    `parallel: 4` (see "Keeping the pipeline fast"); `needs: [backend_test]` for that binary alone.
    The server is started with `PORT=8080 LOCO_E2E=1 JANUS_API_KEY= LOCO_BOT_THINK_MS=250
    LOCO_BOT_JITTER_MS=200`, and the job waits up to 30s for `/health` before installing anything.
  - `backend_lint`: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked
    -- -D warnings`, then `cargo deny check` (see "Linting").
  - `protocol_check` (plus the distribution's `nodejs`): runs the converter's refusal tests
    (`node --test tools/protocol/valibot.test.mjs`), the `loco-protocol` tests (the Go parity
    fixtures and the enum pins among them), then `cargo run -p protocolgen -- --check`, which
    regenerates the client's protocol types and schemas from `server/crates/loco-protocol` and fails
    if the result differs from what is committed. Without it the generator is a suggestion, and the
    two files drift back into being hand-maintained copies the first time somebody edits one
    directly. `make protocol-check` is the same check locally.
- **The client tests that pin a copy to the server's source read it through
  `client/src/test/serverSource.ts`**, which knows where each crate's modules are and how a Rust
  constant is spelled. Constants are asked for by the names the client copies and the docs use
  (`catchGrace`), and `rustConstName` turns one into the crate's (`CATCH_GRACE_MS`). A reader that
  finds nothing fails its test by name rather than passing on an empty match.
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
  repo: **it needs a runner that accepts concurrent jobs** (`concurrent > 1` in its runner config.toml).
  At `concurrent = 1` the shards queue and pay four setups for one suite, which is slower than not
  sharding at all.
- **`server-bin` is built once by `backend_test`** and handed over through the cache. `e2e_test` used
  to download a whole toolchain and rebuild the same binary, on an image with none in it, once per
  shard. It still can, and only as the exception: a shard that finds no binary for its commit
  installs a minimal Rust 1.97 with the musl target and builds the same static `loco-server`.
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
- **Caches.** `CARGO_HOME` (`.cargo`), `CARGO_TARGET_DIR` (`server/target`) and npm's cache are
  redirected under `$CI_PROJECT_DIR` because GitLab can only cache paths inside the project. The
  Rust jobs cache the crate registry and the target directory, keyed on `server/Cargo.lock`; the lint
  job also keeps .cargo/bin, where `cargo-deny` is installed once rather than on every push. Every
  cache key is per-job-family (`cargo-test`, `cargo-lint`, `cargo-protocol`, `npm-client`,
  `npm-e2e-$CI_NODE_INDEX`): two jobs sharing one key race on the upload and the loser's entry is
  what the next pipeline restores, which is why the shards key on their index.
- **`e2e_test` needs `backend_test` only.** It consumes that job's binary and nothing of
  `frontend_test`, so naming it just parked the pipeline's longest job behind the second-longest.
  The `build` job still `needs` every test job, so nothing red can ship — that gate is what makes
  this reordering free.
- **`JANUS_API_KEY=` on the `e2e_test` server launch line is load-bearing.** The gateway credentials
  are protected CI/CD variables, so protecting the `v*` tags — which is what makes `deploy_prod` see
  them at all — also injected them into every other job of a tag pipeline. The server binary inherits
  the job's environment, the live poller switched itself on, and `/live.json` (proxied to `:8080` by
  Vite, `vite.config.ts`) started answering with whoever was streaming the game; `live.spec.ts`
  asserts the served paragraph stays put when nobody is, and it went red on a real channel being on
  air. **The fix belongs in the job, never in the spec**: a suite whose result depends on a stranger's
  stream is not a suite, and CI has no business calling a third party once a minute. Emptying the key
  is the documented off switch everywhere but production (`live.md`). Anything else this pipeline
  starts that reads a protected variable takes the same treatment.
- **`LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`** cut bot think time from 1.2–2.2 s to 0.25–0.45 s
  in CI (`BotTimings::apply_env`, read only under `LOCO_E2E=1`). See "Bots" in `server.md`: the think delay is the only bot timing nothing races.
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
  Keyed **per branch** (`server-bin-$CI_COMMIT_REF_SLUG`, pushed by `backend_test`, pulled by
  `e2e_test`), not per commit: a per-SHA key leaves one cache volume behind for every push and
  nothing ever collects them. Correctness comes from a `server-bin.sha` stamp instead:
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
    → /ws          → game server (:8080, internal only)  [WebSocket]
    → /live.json   → game server (:8080)
    → /live-thumb/ → game server (:8080)
    → /            → nginx static site
```
- The game server (`loco-server`) is on the `internal` network only; nginx bridges traefik↔internal.
- Port chain: Traefik → 80 → nginx → 8080 → `loco-server`.
- `/health` and `/metrics` are deliberately **not** proxied: they are operator surfaces
  (`client/nginx.conf` says why), read from inside the server's own container.

### Production readiness
- Server healthcheck: `loco-server healthcheck` (the image is distroless, so there is no `wget` to
  call; the subcommand asks `/health` on loopback and exits 0 or 1), 10s/5s/3 retries/5s start in
  `deploy/compose.yml`.
- `client depends_on server: service_healthy`.
- `write_app_env` writes `PORT`, `DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`,
  `LOCO_ALLOWED_ORIGINS`, the drain and snapshot settings, the socket's certificate label and (in
  production only) the gateway and Twitch keys to `app.env`, then makes it 0600.
- All `docker compose` calls use `--env-file paths.env --env-file app.env`.
- nginx `/ws` (`client/ws-proxy.conf`): `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`,
  `proxy_send_timeout 86400s`.
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
  "declare one here and you have replaced all of them". `location /_astro/` (the bundle's block under
  Astro; `/_app/immutable/` since SvelteKit) set `Cache-Control` and by doing so shipped the entire
  JavaScript bundle and every optimised image with **no
  CSP, no nosniff, no Referrer-Policy and no Permissions-Policy**.
  Nothing saw it, and the two checks that exist are why. `make csp` read headers off the
  `page.goto()` response — the document, which kept all four — and reported clean. `csp.test.ts`
  regexed `add_header` lines out of the config text and asserted their *values*, which were never
  wrong; the question was never what the headers said, it was which responses got them. A guard that
  reads a directive cannot see an inheritance rule.
  The exposure that makes it worth fixing rather than noting is `nosniff`: anything under the bundle's
  directory a browser can be talked into rendering as a document is a document **with no policy at
  all** on this origin, and the build emits optimised images there, SVG included. Nothing user-controlled lands in
  that directory today, which is exactly the argument for closing it before something does.
  Both checks were fixed to see the shape rather than the values: `csp.test.ts` brace-matches every
  `location` block and fails on one that declares an `add_header` without the include, and
  `tools/csp/check.mjs` now asserts the five headers on an actual `/_app/` sub-resource response —
  and reports a problem if the page pulled in no asset to check, so it cannot pass by finding
  nothing.
- **`connect-src` uses `$http_host`, never `$host`.** `$host` drops the port, and a CSP host source
  with no port means the scheme's *default* one. On :443 the two are identical, so the difference is
  invisible in production and blocks the socket everywhere else — a staging host on a non-default
  port, or anyone running the built image locally.
- **No test can prove the page loads under the CSP, and one pins it to the app anyway.**
  `client/src/test/csp.test.ts` reads `nginx.conf` next to the Svelte markup and the client
  sources, and couples each directive to whatever needs it: `script-src 'self' $loco_script_hashes`
  beside the absence of any hand-written inline script, the generated include ahead of the header,
  the hash reader (`scripts/csp-hashes.mjs`) run on a built-page fixture, the Dockerfile copying the
  hashes from the builder, and — when a `build/` is on disk — every bootstrap in it covered by
  `csp-hashes.conf` (SvelteKit's router starts from one inline script per page, so one page whose
  hash is missing is a blank production page), `'unsafe-inline'` in
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
- **`make bench-server` is the third** (`cargo bench -p loco-hub`, criterion,
  `server/crates/loco-hub/benches/hub.rs`), and it answers a question no assertion can: what one pass
  of the event loop costs. It is outside CI for the ordinary reason benchmarks are — a shared
  runner's numbers describe the runner — and it is not decoration. Every argument about sharding the
  hub, moving work off the loop or raising a ceiling starts here, and the one it has already settled
  (an actor per table, and the log line that turned out to cost more than a card play) is written up
  in [`server.md`](server.md).
  - It drives a `Table` in-process — a whole card play through the table's dispatch, the
    personalised fan-out after a Swap, the `card_played` broadcast alone, one recipient's state —
    rather than going through a socket, which would measure the kernel. Its cases mirror the Go
    benchmark one for one, and the file's header keeps the Go numbers to compare against.
  - The log benchmark writes through the asynchronous sink into `std::io::sink()`, so it measures
    the queue and not whatever terminal happens to be attached.

## Linting
- Client: ESLint v10 flat config (`eslint.config.js`): `typescript-eslint` plus
  `eslint-plugin-svelte`'s recommended set. `npm run lint` / `lint:fix`. `no-unused-vars: error` —
  prefix `_` to silence.
- CI: `frontend_test` lints before it tests.
- Server, three checks in `backend_lint` and in `make lint-server` (docker, no host Rust required):
  - `cargo fmt --all -- --check`, with rustfmt's defaults (there is no rustfmt.toml).
  - `cargo clippy --workspace --all-targets --locked -- -D warnings`. The workspace lints in
    `server/Cargo.toml` set `clippy::all` to warn and forbid `unsafe_code`; `-D warnings` is what
    makes a warning a red job, so nothing is waved through as "only a warning".
  - `cargo deny check` against `server/deny.toml`: licences from an allowlist (MIT, Apache-2.0, the
    BSDs, ISC, Zlib, Unicode-3.0, CDLA-Permissive-2.0, MPL-2.0), the RustSec advisories (one ignore,
    with its reason: an unmaintained crate reached only through `protocolgen`'s TypeScript
    formatter, which never ships in the server image), no wildcard versions, and crates.io as the
    only source.

### What is switched off, and where
The rule on both sides is the same: **a lint is argued with in place, one line at a time, with the
reason written next to it, never switched off in the config.**

- **Clippy is switched off in exactly one way**: `#![allow(clippy::field_reassign_with_default)]` at
  the top of the hub test files that narrow one knob of the default config (`HubConfig::default()`
  and then a single timing), each carrying that reason as a comment. Nothing outside a test carries
  a clippy `allow`.
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

## Image hardening and reproducibility
- **`client/Dockerfile` copies `package-lock.json` and runs `npm ci`.** It used to copy
  `package.json` alone and run `npm install`, so the whole transitive tree was re-resolved on every
  build: two builds of the same commit were not the same image, and a dependency compromised between
  them would have shipped with nothing in the diff to show it. The lockfile is committed precisely so
  that cannot happen; it just was not being copied in.
- **`server/Dockerfile` ships one static binary on distroless, as uid 65532.** The builder is
  `rust:1.97-alpine` and builds `loco-server` with `--locked` against musl, so the binary links
  nothing at run time; the image it lands in is `gcr.io/distroless/static:nonroot` — no shell, no
  package manager, no `wget` — running as distroless's `nonroot` user (65532), with `/data` created
  and owned by that user in the builder. The process binds a port above 1024, reads no system path
  and writes one file (the shutdown snapshot under `/data`), so it needs nothing it is not being
  given. With no shell to run a probe in, the healthcheck is the binary's own subcommand,
  `loco-server healthcheck`. `deploy/compose.yml` and `docker-compose.yml` add `no-new-privileges`,
  `cap_drop: ALL`, a read-only root filesystem and a tmpfs `/tmp`.
- **nginx gets `no-new-privileges` and nothing more.** The stock image starts as root to bind :80
  before dropping to the `nginx` user, and writes its caches and pid under `/var`, so `cap_drop: ALL`
  and `read_only` both stop it booting. Rewriting it rootless is a separate change with its own ways
  of going wrong, and this container serves static files and proxies a socket: the server behind it
  is where the state is.
- **Each environment has its own snapshot directory, `${DATA_DIR}/snapshots/${DEPLOY_ENV}`, mounted
  at `/data`, and the deploy job chowns it to 65532 and chmods it 0700** (`rollout` in
  `.gitlab-ci.yml`). A bind mount overrides whatever the image chowned, and a server that cannot
  write its snapshot loses exactly the matches the snapshot exists to save. 0700 because that file
  holds session tokens and hands. One directory per environment because dev and prod share
  `DATA_DIR`: with one file between them, a dev deploy could restore prod's matches into the dev
  server and delete the file as it did (`deploy/compose.yml`). **The order inside `rollout` is the
  point**: the old server is stopped first, so it writes its snapshot as its own user, and only then
  is the directory handed (recursively) to the new image's user; chowning first would lock the
  departing process out of a 0700 directory. The first deploy after the split moves a snapshot left
  at the top level into the environment's own directory before the new server starts. Details in
  [`deployment.md`](../deployment.md).

## Dev Docker Compose
- `docker-compose.dev.yml` — hot-reload, no host Rust/Node needed.
- Backend: `rust:1.97-bookworm`, bind `./server:/app`, `cargo watch -x 'run -p loco-server'`
  (installed on start), `:8080`, `LOCO_E2E=1`. The crate registry and the target directory live in named
  volumes outside the bind mount, so a second start neither downloads the graph nor rebuilds it, and
  a host's own `server/target` is not overwritten by Linux artefacts. The first build takes a few
  minutes, which is what the healthcheck's 60 retries (`target/debug/loco-server healthcheck`) wait
  for; the client waits on it.
- Frontend: `node:24-alpine` (Vite 8 and SvelteKit 3 declare `engines.node >= 22.12`), bind `./client:/app`,
  `npm ci && npm run dev`, `:5173` (container 3000).
- **No dev-server WS proxy** — browser connects directly to `ws://<host>:8080/ws` (the proxy is unreliable under Docker).
- `VITE_WS_PORT=8080` env tells client which port (default 8080).
- `state/webSocket.svelte.ts`: dev → `ws://${hostname}:${VITE_WS_PORT}/ws`; prod → `ws://${host}/ws` (nginx-proxied).
- `vite.config.ts`: no proxy for the socket; it proxies `/live.json` and `/live-thumb` to
  `LOCO_SERVER_ORIGIN` (the `server` service in compose), as nginx does in production.
  `server.ws.clientPort` (not the deprecated `server.hmr.*`) carries `VITE_HMR_CLIENT_PORT` so HMR
  dials the published 5173 rather than the container's 3000.
- Volumes: `cargo-registry`, `cargo-target`, `client-node-modules` (named, persistent).
- Start: `docker compose -f docker-compose.dev.yml up --build`.
- **The client command is `npm ci && npm run dev`, and nothing else.** Under Astro it first deleted
  `.astro/dev.json`, the dev server's singleton lock, which lived on the bind mount and read as held
  after every container restart (pids begin again at 1). Vite takes no lock, so the line went with
  Astro, and so did the capture harnesses' `--ignore-lock` (`tools/lib/devserver.mjs` passes
  `--strictPort` instead). `npm ci` runs the `prepare` script, `svelte-kit sync`, so the generated
  types exist before the server starts.

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


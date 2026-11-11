# Testing, CI/CD and environments

The tests, the Playwright suite, the GitLab pipeline and the Docker stacks. `CLAUDE.md` carries the
rules; this file carries the reasoning and the edge cases.

## An untested path is where the bugs are

TDD, tests first for non-trivial behaviour, deterministic clocks for timing logic. **When a document
in this repository states an invariant, there must be a test that fails without it.** It is a rule
rather than advice because it has been broken expensively three times:

- A draw that mutated state before an all-or-nothing check, and a client `applyCardPlayed` that
  removed one card where the server had removed N. Both sat in the only paths with no test, and the
  docs described both as already fixed — one naming a function that did not exist. `Room::draw_card`
  now validates first and draws second, and a proptest holds it.
- A card-foil system (`.foil`, `.glint`, `holoOffsetMs`) documented in detail and existing nowhere.
  Prose is not compiled; `docPaths.test.ts` is the answer.

**Beware an assertion that only restates its fixture.** An E2E test sent an interrupt, then asserted
the discard and turn that `debug_set_state` had itself configured. It passed for months while the
server refused every interrupt.

Keep tests fast, targeted, non-brittle; cover game rules over UI details. Review layout, colour and
motion with `make visual` (it also shoots the content pages and the 404: `--pages=only` for those
alone, `--pages=off` to skip them). Assertions own behaviour, screenshots own appearance.

Both browser harnesses (`make visual`, `make audio-verify`) launch the Chromium their `playwright`
package downloaded; `LOCO_CHROMIUM=/path/to/chrome` points them at another. The Playwright suite is
pinned to its image (`PLAYWRIGHT_VERSION`) and takes no such override.

### The three seams a component test goes through

Each exists because a class of test lied without it.

**`src/test/setup.ts`** is loaded before anything else and is the only place the framework and the
DOM are stitched together: a WAAPI shim (jsdom has no `element.animate`, and a Svelte transition *is*
`element.animate`); an `eventWrapper` that flushes after every `fireEvent`, so assertions read the DOM
on the line after the click; a `fireEvent.change` that also dispatches `input`, because components
listen for the per-keystroke event a browser fires; one `resetI18n()` per test, since the language is
a module that outlives the file.

**`src/test/storeFlush.svelte.ts`** paints a store write before the next assertion. `flushSync()`
called from inside a batch Svelte is already flushing takes that batch out from under it, and the
symptom is `Cannot read properties of null (reading 'schedule')` attributed to whatever component is
mounted. The app writes the store from inside effects (`handleSend` clears the last error), so the
subscriber skips the flush whenever `$effect.tracking()` says Svelte is already painting. That rune is
why the module is `.svelte.ts`.

**`src/test/render.ts`** is the only door to `@testing-library/svelte`. The library tells props from
mount options by name (`target`, `anchor`, `props`, `events`, `context`, `intro`), and the game uses
one — `<Reconnecting target="waiting" />`. A component with a colliding prop *and* an ordinary one
throws `UnknownSvelteOptionsError`; one whose **only** prop is a reserved word mounts silently into
the wrong node. The wrapper puts everything under `props`. **`src/test/renderHook.ts`** gives a module
that is nothing but `$effect` a component to live in; its `initialProps` is handed to the setup as an
accessor (the `Live<T>` the hooks take), so `rerender` reaches a hook mid-flight instead of remounting
it.

### Required coverage

Room create/join. Nickname entry **and its validation** — the shapes refused, the disguises the
normalisation sees through, and the legitimate names that must keep playing (a filter is only as good
as its false-positive list). Game start, turn progression, legal and illegal moves,
skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter and catch
windows, simultaneous resolution.

**Contre-LOCO!'s three states and its price**: the threshold that makes the button pressable
(`catchAvailability.test.ts`), the arming separate from the pressing (`actionBar.test.ts`), the card a
press that finds nobody costs, and — on both sides of the wire — exactly one per offer however often
pressed, nothing where nothing is offered, a press answered on the instant it arrives
(`server/crates/loco-hub/tests/catch_immediate.rs`), and the button still live and the press still
charged for `CATCH_GRACE_MS` after the offer vanished (`penalties.spec.ts`). **Which of two presses
arrives first is not an E2E assertion**: a 6ms head start given to one page's `WebSocket.send` did not
survive Playwright to the server, so the ordering is pinned in the hub's own suite.

The domain's invariants over random play (`server/crates/loco-game/src/tests/proptests.rs`): the 112
cards conserved across hands, deck and pile, `Wild` never the active colour, an owed draw never
failing, a refusal leaving the room exactly as it was, the LOCO! gate on all four finishing paths. A
shrunk failure is written to `server/crates/loco-game/proptest-regressions/` and replayed first on
every run: commit it with the fix. One scripted round's event log is pinned with `insta`
(`server/crates/loco-game/src/tests/scripted_round.rs`, snapshot under
`server/crates/loco-game/src/tests/snapshots/`): a change to it changes what a reconnecting client
replays, and is accepted on purpose.

The wire, byte for byte (`server/crates/loco-protocol/tests/parity.rs`): every golden frame in
`server/crates/loco-protocol/tests/fixtures/` (`server.jsonl`, `client.jsonl`) reads back unchanged —
those files are the wire contract — a zero behind an `Option` is still written, and the wire enums
stay pinned to the domain's (`server/crates/loco-protocol/tests/enums.rs`). A snapshot of a schema
the server no longer reads is dropped whole (`server/crates/loco-hub/tests/snapshot_v5.rs`, against
`fixtures/snapshot_v5.json`).

Reconnect (60s, nickname + room code) **and session restore across a page reload**. Rematch: the
ask, one ask dealing nothing, a departure retiring an ask and completing what is left of the
agreement, seat pruning, re-indexing.

Protocol validation and rejection. The two client mirrors of a server rule (table code alphabet and
length, nickname shape) held against the Rust source (`serverMirrors.test.ts`). **That React is
not used** of the manifest, the build configuration, every import and every file extension
(`noReact.test.ts`). **That a rune appears only where one is compiled** (`runeScope.test.ts`): a
`$state()` in a plain `.ts` is not a build error, it becomes a call to a missing global thrown when
that line first runs — mid-match, a table that dies on a card nobody has played yet. The test strips
comments before matching and checks the reactive half is non-empty, so a rename turning every
`.svelte.ts` plain cannot read as compliance. **That the Svelte compiler has nothing to say about any
component** (`svelteWarnings.test.ts`, compiled with `dev: true` as `make dev` does): a boot full of
expected warnings hides the one about a handler that will never fire. **Every path the docs name**
(`docPaths.test.ts`) — and never add a phantom path to its allowlist: the allowlist is for paths named
in order to say they are absent. The store completing its own derived state
(`catchDerivation.test.ts`).

Streamer mode on both sides of the wire: nothing uncovers a blurred code (no `:hover`, `:focus` or
state selector in `TableCode.svelte`, the span out of the tab order), the host's switch reaches every
seat and rides `room_joined` and the snapshot, a guest's own preference is never overwritten, and the
two sends the client must **not** make — a change of seat, anything at a hostless table
(`preferences.test.ts`, `tableStreamerMode.test.ts`, `server/crates/loco-hub/tests/streamermode.rs`,
`e2e/tests/streamer-mode.spec.ts`).

The table link: what the code's button copies, the code coming off the address bar, the arrival a
remembered name seats and the one asked for a name first. Seat layout at every table size and
viewport. State-to-sound mapping. The host freeing a seat: the refusals, the re-based roster, the
bot's row, the line the removed player is left holding. Score table.

Matchmaking: pairing, cancel, disconnect-out-of-queue, the host controls a matchmade room refuses, the
requeue an opponent's departure triggers, every forfeit path (quit, disconnect, AFK). Link-preview
tags against the committed `og.png`. The map, hour and sky draw, the client's lists pinned to the
server's, the light rig, the loading gate. Batch play and the interject's refusal of one, unit **and**
E2E. A draw against exhausted piles. `Origin` checking. The legal disclosures and the truncation of
every logged address. Bots interjecting.

The table's own bookkeeping (`server/crates/loco-hub/src/internal_tests/table_internal.rs`): seating a
client leaves no pointer behind on the table it left, a removal shifts members, bots, tokens and seats
together, a reset clears the map gate but not the roster, and `Hub::stop` waits for the loop to leave
the handler it is in. Every read in the file is posted to the table that owns it (`on_table`): a
table's state is not reachable from the test task any other way. The hardening
(`server/crates/loco-hub/tests/hardening.rs`): a gameplay message at a table that has not dealt, a
handler that panics on demand, every ceiling, the wrong-code budget **and** the mistyped code that
must still get in, the reclaim refusal that names nothing, the reclaim that rotates its token.

What a table owning its own task buys (`server/crates/loco-hub/tests/actor.rs`):

- **A table that panics answers the message and keeps playing.** A panic that took the task would
  leave a room that goes **quiet** — messages queued behind nothing, no error shown. Every job runs
  inside `catch_unwind` (`table/actor.rs` on the table, `router/dispatch.rs` on the hub), counted as
  `handler_panics`.
- **One table held still inside a handler does not hold up another.** Put the handler back on the
  hub loop and the test *hangs*. It runs on a multi-threaded runtime on purpose: the held handler
  blocks its thread outright.

And the graceful shutdown: what a drain refuses, what it leaves alone, and a full restart where a
match is snapshotted, reloaded by a fresh hub and reclaimed by both players with their original
tokens — **with no E2E counterpart on purpose** (below).

## Playwright E2E

- Lives in `e2e/` (own `package.json`). `@playwright/test` + Chromium + Pixel 5.
- Needs the game server on `:8080`. Playwright starts its own Vite dev server on `:4173` with
  `--strictPort`, so a busy port fails loudly rather than moving where the suite will not look. It
  runs beside `make dev`.
  - Local: start the server (`cd server && LOCO_E2E=1 cargo run -p loco-server`, or the dev compose
    stack), then `cd e2e && npm test`.
  - CI: `backend_test` builds `server-bin`; `e2e_test` runs it + Playwright.
- `window.__LOCO_E2E__`, dev only (`import.meta.env.DEV`), tree-shaken from prod:
  - `send(msg)`, `getState()`, `playCard(card)` (animates + sends `play_card`), `getWsStatus()`,
    `forceCloseWs()`.
  - `startTurnRecorder()` / `getRecordedTurns()` record distinct `currentTurn` transitions. **Use
    them whenever a bot seat is involved**: a bot holds the turn ~800ms, so sampling is flaky, and the
    sequence also proves a skipped seat never held the turn.
- Types: `e2e/types.d.ts`. Helpers: `e2e/helpers/game.ts`.
- **Every test is self-contained** — no `beforeAll`, no `describe.serial`, no state carried between
  tests; each creates its own room. That lets CI shard per *test* (`fullyParallel: true`), which keeps
  four shards even, and lets `workers` exceed one off CI.
- **The 1v1 queue is the one thing a test cannot open its own of, so it is locked.** There is one
  FIFO queue per process and `try_pair` hands seat 0 to whoever is at the front, so another test's
  searcher arriving between one test's two is paired with one of them — and both tests time out
  waiting on a `match_found` that went to a stranger. `e2e/helpers/matchmakingQueue.ts` is a
  cross-process mutex (atomic `mkdir`, a pid the next claimant checks, a staleness backstop) that
  every test in `matchmaking.spec.ts` claims. **A lock on a shared resource, not shared state.**
  - **The lock is not the whole guarantee; an empty queue is.** The previous test's searcher is
    dequeued on the hub's loop a moment after its context closes, so the claim polls `/metrics` for
    `matchmaking_queue == 0` — the only place the suite reads an operator surface, because the queue
    size is deliberately never on the wire.
  - **Queuing time is borrowed before the wait** (`borrowTime()`): compensating afterwards lets the
    test expire inside the polling loop as `Test timeout of 30000ms exceeded`. It raises the budget
    before the first poll and trims it back to what the wait cost.
- **Being dealt into a matchmade table is the expensive step.** `waitForMatchmadeGame` waits out the
  countdown and the map-loading gate; single-deal tests land around 23s cold and 4s warm. The rematch
  test is dealt in twice and sets `test.setTimeout(90_000)`. A budget overrun lies: it times out on
  whatever line the `finally` is on, with a healthy board in the screenshot. Re-run with
  `--timeout=90000` before calling it a regression; if green, say so on the test.
- **A fixture must state everything the assertion rests on.** `debug_set_state` sets only what it is
  given. Pin:
  - `direction` (`debugSetState({ direction: 1 })`) in any test that computes a seat: one bot Reverse
    mirrors the table and a 3-player Skip lands on `myIdx-2`, which reads as a rules bug.
  - `pendingDraw: 0` whenever a play must land: `Room::play_card` refuses every card while a stack is
    pending.
  - `currentTurn`, and the *colour* of a coloured card: a Swap in the wrong colour is not playable, so
    `handleCardClick` opens no picker.
- **The fixture's payload is one nested object** (`{"type":"debug_set_state","debug":{...}}`,
  `DebugStateDTO` in `loco-protocol`). Only `e2e/helpers/game.ts` builds it,
  `server/crates/loco-protocol/tests/parity.rs` replays recorded frames through it, and the server
  reads it only with `LOCO_E2E=1`.
- **The interrupt window is open from the deal and `debug_set_state` never touches it**, so a test
  asserting a refusal closes it with a real draw or pass. Keep bots out of interrupt scenarios: a
  bot's timer plays a card and re-arms the window under the interrupt in flight, and on the opening
  discard a bot cannot answer at all.
- **Do not leave the local seat on one card at the end of a bot test**: a bot answers the catch
  window about two thirds of the time and the hand grows under the assertion. Emptying it ends the
  round.
- **Wait on state, not on a gesture or the clock.** `clickContinue` waits for the round-summary
  card's animations to report `finished`, requiring `length > 0` (`getAnimations().every(...)` is
  vacuously true on an empty list, and a CSS animation starts the frame after insertion); it clicks
  with a short timeout, tolerates the summary's 8s auto-dismiss, and returns on
  `showRoundSummary === false`. `createRoom`/`joinRoom` wait for `getWsStatus() === 'open'`;
  `debugSetState` waits for its fixture to appear in the store. Prefer `waitForFunction` on store
  state over DOM polling. Few high-value tests over many fragile ones.
- **A table task owns its state and the compiler enforces it.** A data race here is the hidden-state
  guarantee coming apart. A `Table` lives inside its task (`server/crates/loco-hub/src/table/actor.rs`),
  the hub reaches it only by posting a job, anything crossing tasks is `Send`, and the workspace
  forbids `unsafe_code` (`server/Cargo.toml`). The tunables are per hub (`HubConfig`, `Timings`,
  `BotTimings`, `server/crates/loco-hub/src/ops/config.rs`), so a timing test narrows its own copy and
  there is nothing shared to restore. `Hub::stop` waits until the loop and every table task are gone;
  `stop_waits_for_the_loop_to_leave_the_handler` pins it — a stop that returns early is a lifetime
  bug the compiler cannot see.
- **Time is the other thing a test owns.** The domain takes `now` as an argument. In the hub the
  domain's milliseconds are derived from tokio's clock (`server/crates/loco-hub/src/ops/clock.rs`), so
  a test driving a `Table` runs under `tokio::time::pause` (`#[tokio::test(start_paused = true)]`) and
  catch windows, turn deadline and bot delays move together. The socket tests
  (`server/crates/loco-hub/src/testkit.rs`) run on real time on purpose: a paused clock auto-advances
  whenever the runtime is idle, and a test waiting on a socket is idle.
- **The graceful shutdown is not covered by E2E.** A drain and a restore are properties of the
  process, and the suite runs against a server it cannot restart. `server/crates/loco-hub/tests/drain.rs`
  and `server/crates/loco-hub/tests/snapshot.rs` cover it through real WebSockets: one hub plays a
  match and snapshots, a second hub restores it, and both players reconnect with their original
  tokens and get their hands back card for card.
- `webServer` env vars go in `playwright.config.ts`'s `env` object, never a `VAR=x cmd` prefix (POSIX
  only, breaks on Windows).
- **Update E2E in the same commit as gameplay/UI/protocol changes.**
- Two controls never share an accessible name — the draw pile is `drawPile` ("Pioche"), not "Draw".
- The canvas is not inspected; verify via DOM (ActionBar, RoundSummary, GameOver) and
  `__LOCO_E2E__.getState()`.

### The suite that opens the most tables renders the fewest rooms

`VITE_E2E_NO_SCENE=1`, set by `playwright.config.ts` on its own dev server, read by
`sceneCache.prepareScene`. Per fresh context against the dev server:

| | requests | transferred | render |
| --- | --- | --- | --- |
| the app's page alone | 217 | 0.4 MB | — |
| the same page with the room | 466 (220 of them models) | ~7 MB | +2.2 s |

The suite opens about 167 tables, so the room cost roughly six minutes and 1.2 GB on a fast machine,
more on a SwiftShader runner — **and bought no assertion**: appearance belongs to `make visual`. The
flag takes the path a machine with no WebGL takes: a null bitmap, the sky gradient, the gate answered
and `map_ready` sent. The gate's own mechanism (the bar, `MAP_BAR_FULL_MS`, the timeout) runs as
before.

- **On the dev server, not in an init script.** A page reaches the suite four ways (the `page`
  fixture, a bare `browser.newContext()`, a second tab, an invitation link); only the server is common
  to all four.
- **`import.meta.env.DEV` keeps it out of production**, not the absence of the variable: in a build
  the branch with the lazy `import('./render')` is the only one that survives.

`sceneLoadingGate.test.ts` pins all four ends: off in Vitest, the config's name is the cache's, the
`DEV` guard is present, the engine import is inside it.

### A wait may not outlive the test that owns it

`helpers/game.ts: budget()`, plus `timeout: 60_000` in the config. Helpers capped at 60–120s inside a
30s test could never fire, so every hung wait read as `Test timeout of 30000ms exceeded` with no word
about what it waited for, and an honest slow match was retried in full. `budget(wantMs)` returns the
smaller of what the wait is worth and what the test has left, less a margin. A test that needs longer
says so with `test.setTimeout` (`round-progression.spec.ts` asks for 120s); outside a test the helper
takes the wait at its word.

## CI/CD

Pipeline: `.gitlab-ci.yml`, stages `test → build → deploy`. Pipeline and deploy details are in
[`deployment.md`](../deployment.md).

- `test` (every push). Rust jobs run on `rust:1.99-bookworm` with `--locked`, so a `server/Cargo.lock`
  out of step with the manifests fails rather than being re-resolved:
  - `backend_test`: `cargo test --workspace --locked`; `cargo build -p loco-game --target
    wasm32-unknown-unknown` (a dependency reaching for the OS fails here); then the release
    `loco-server` for `x86_64-unknown-linux-musl`, copied to `server-bin` with `server-bin.sha` and
    handed to `e2e_test` through the cache. Static because the Playwright image's glibc is older than
    the build image's, and because `server/Dockerfile` ships the same build.
  - `frontend_test` (`node:24-alpine`): `npm ci && npm run lint && npm run test && npm run build`.
  - `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): `server-bin` +
    Playwright, `parallel: 4`, `needs: [backend_test]` only. The server starts with
    `PORT=8080 LOCO_E2E=1 JANUS_API_KEY= LOCO_BOT_THINK_MS=250 LOCO_BOT_JITTER_MS=200`, and the job
    waits up to 30s for `/health`.
  - `backend_lint`: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked
    -- -D warnings`, `cargo deny check`.
  - `protocol_check`: the converter's refusal tests (`node --test tools/protocol/valibot.test.mjs`),
    the `loco-protocol` tests (golden frames and enum pins), then `cargo run -p protocolgen -- --check`,
    which fails if the generated client types and schemas differ from what is committed. Without it
    the two files drift into hand-maintained copies. `make protocol-check` locally.
- **Client tests that pin a copy to the server's source read it through
  `client/src/test/serverSource.ts`.** `serverPath(pkg, stem)` finds a module by stem anywhere under
  the crate's `src/`, so a moved file is not a broken test; constants are asked for by their Rust
  names (`CATCH_GRACE_MS`). A reader that finds nothing fails by name rather than passing on an empty
  match.
- `build` runs only on `develop` or `v*` tags and **`needs` every test job**, lint and E2E included:
  naming a subset makes the rest advisory, and red ships.
- **GitLab (`origin`) is the only CI.** The `gh` remote is a plain mirror with no pipeline.

### Keeping the pipeline fast

**Spend dead time, never coverage**: no test skipped, no gate loosened, no reaction window shortened.

- **`parallel: 4` + `--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL`.** `workers` stays 1 within a job;
  `fullyParallel: true` makes the split even (sharded by spec file, the suite split 27/39/0/21). It
  needs a runner with `concurrent > 1`; at 1 the shards queue and pay four setups for one suite.
- **`server-bin` is built once** by `backend_test`. A shard that finds no binary for its commit
  installs Rust 1.99 with the musl target and builds it, as the exception.
- **No `playwright install`.** The image ships only the browsers its own Playwright needs, so the
  image tag and `e2e/package-lock.json` are one decision: the dependency is pinned **exactly**, and
  `PLAYWRIGHT_VERSION` is declared once in `e2e_test`, interpolated into the image tag and asserted
  against `npx playwright --version` before the suite runs. Bump both together and commit the lockfile;
  Renovate does (`renovate.json`: a regex manager reads `PLAYWRIGHT_VERSION` and the `playwright`
  group moves it with `@playwright/test`).
- **Caches.** `CARGO_HOME` (`.cargo`), `CARGO_TARGET_DIR` (`server/target`) and npm's cache live under
  `$CI_PROJECT_DIR` because GitLab caches only paths inside the project. Rust jobs key on
  `server/Cargo.lock`; the lint job also keeps `.cargo/bin` so `cargo-deny` is installed once. **Every
  key is per job family** (`cargo-test`, `cargo-lint`, `cargo-protocol`, `npm-client`,
  `npm-e2e-$CI_NODE_INDEX`): two jobs pushing one key race on the upload.
- **`JANUS_API_KEY=` on the `e2e_test` launch line is load-bearing.** The gateway credentials are
  protected variables, so a tag pipeline injects them into every job; the server would switch its live
  poller on and `live.spec.ts` would depend on a stranger's stream. The fix belongs in the job, never
  the spec; emptying the key is the off switch everywhere but production (`live.md`). Anything else
  this pipeline starts that reads a protected variable takes the same treatment.
- **`LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`** cut bot think time from 1.2–2.2 s to 0.25–0.45 s in
  CI (`BotTimings::apply_env`, read only under `LOCO_E2E=1`): the think delay is the only bot timing
  nothing races (`server.md`, "Bots").

**Serving a static build to the suite was measured and rejected.** A dev-server page load costs
~95 ms, ~9 s across the suite, and `vite build --mode development` still sets `import.meta.env.DEV` to
false, so `__LOCO_E2E__` would have to be gated on a build variable instead — a configuration
guarantee in place of a structural one. Do not revisit without a new reason.

### This runner cannot upload artifacts

**Nothing in `.gitlab-ci.yml` may use `artifacts:`** until the runner is fixed. Its upload helper
resolves GitLab's external URL (`http://gitlab`) against a LAN DNS that does not know it
(`dial tcp: lookup gitlab on 192.168.1.254:53: no such host`), and an upload failure **fails the
job**. The fix is on the runner (`extra_hosts`, joining GitLab's network, or the FQDN), not in YAML.

- **`server-bin` travels by cache** (a tarball on the runner's disk, no API call), keyed **per branch**
  (`server-bin-$CI_COMMIT_REF_SLUG`) so volumes do not pile up per commit. Correctness comes from the
  `server-bin.sha` stamp: `e2e_test` rebuilds unless the binary was built from the commit under test.
  Testing a binary from another commit reports on code nobody pushed.
- The cost is the JUnit report and Playwright's traces and screenshots. The `junit` reporter still
  writes its file and the upload block sits commented out in `.gitlab-ci.yml`, ready to restore.

### The production headers, and the checks that cannot be unit tests

The request path and the deploy are in [`deployment.md`](../deployment.md). What matters for testing:

- **The five security headers live in `client/security-headers.conf`, and every `location` block that
  declares an `add_header` must `include` it.** nginx inherits `add_header` into a level only while
  that level declares none, so one `Cache-Control` in the bundle's block shipped the whole JavaScript
  bundle with no CSP, nosniff, Referrer-Policy or Permissions-Policy, while the document kept all
  four. The exposure is `nosniff`: the build emits images (SVG included) into that directory. A guard
  that reads directive values cannot see an inheritance rule, so `csp.test.ts` brace-matches every
  `location` block and fails on one that declares without including, and `tools/csp/check.mjs` asserts
  the five headers on an actual `/_app/` sub-resource (and fails if the page pulled none). HSTS carries
  **no `includeSubDomains` and no `preload`**, and `csp.test.ts` fails on either.
- **`connect-src` uses `$http_host`, never `$host`.** `$host` drops the port, and a host source with no
  port means the scheme's default: invisible on :443, blocking the socket anywhere else.
- **`client/src/test/csp.test.ts` couples each directive to what needs it**: `script-src 'self'
  $loco_script_hashes` beside the absence of any hand-written inline script, the generated include
  ahead of the header, the hash reader (`scripts/csp-hashes.mjs`) on a built-page fixture, the
  Dockerfile copying the hashes, and — with a `build/` on disk — every bootstrap covered by
  `csp-hashes.conf` (one missing hash is a blank production page); `'unsafe-inline'` in `style-src`
  beside what forces it; `$http_host` twice in `connect-src`; no remote origin in the policy or the
  sources; no `eval` / `new Function` / `new Worker` / `blob:`. It cannot answer "does the built app
  run behind this policy", so `make csp` is still owed after any change to `nginx.conf`.
- **The redirect chain is modelled, not asserted.** `client/src/test/redirects.test.ts` replays every
  public URL — both spellings of every path in `PAGES`, plus the invitation — through a model of
  nginx's rules and an edge that upgrades plaintext, failing on a chain that loops, leaves https or
  ends anywhere but a page that exists. Only following the chain sees an implicit redirect answering
  https with `http://`. Reasoning in [`seo.md`](seo.md).
- **`make csp`** (`tools/csp/check.mjs`, outside CI) brings the production-style stack up, loads the
  page in a real browser, creates a room, and tears down. Console clean, fonts loaded and the waiting
  room reached (which needs a WebSocket round trip) is the verdict; it collects
  `securitypolicyviolation` events, console errors and failed requests, and checks the five headers.
  `--url=…` targets a running stack, `--keep` leaves its own up. It waits on **the SPA answering**,
  not on `docker compose up -d` returning, which on Docker Desktop for Windows can lag by minutes.
- **`make bench-server`** (`cargo bench -p loco-hub`, criterion, `server/crates/loco-hub/benches/hub.rs`,
  outside CI because a shared runner's numbers describe the runner) measures what one pass of the
  event loop costs: a whole card play through the table's dispatch, the personalised fan-out after a
  Swap, the `card_played` broadcast alone, one recipient's state, and a log line through the
  asynchronous sink into `std::io::sink()`. It drives a `Table` in-process rather than a socket, which
  would measure the kernel. Every argument about scaling starts here ([`server.md`](server.md)).

## Linting

- Client: ESLint flat config (`eslint.config.js`), `typescript-eslint` plus `eslint-plugin-svelte`'s
  recommended set. `npm run lint` / `lint:fix`. `no-unused-vars: error`; prefix `_` to silence.
  `frontend_test` lints before it tests.
- Server, in `backend_lint` and `make lint-server`:
  - `cargo fmt --all -- --check`, rustfmt defaults (no rustfmt.toml).
  - `cargo clippy --workspace --all-targets --locked -- -D warnings`. `server/Cargo.toml` sets
    `clippy::all` to warn and forbids `unsafe_code`; `-D warnings` makes a warning a red job.
  - `cargo deny check` against `server/deny.toml`: licences from an allowlist (MIT, Apache-2.0, the
    BSDs, ISC, Zlib, Unicode-3.0, CDLA-Permissive-2.0, MPL-2.0), RustSec advisories (one ignore, with
    its reason: an unmaintained crate reached only through `protocolgen`'s TypeScript formatter, never
    in the server image), no wildcard versions, crates.io only.

### What is switched off, and where

**A lint is argued with in place, one line at a time, with the reason next to it — never switched off
in the config.** A rule off in `eslint.config.js` is invisible; one off on a line is read by the next
person to touch it.

- **Clippy**: only `#![allow(clippy::field_reassign_with_default)]` at the top of the hub test files
  that narrow one knob of `HubConfig::default()`, each with that reason. Nothing outside a test carries
  a clippy `allow`.
- **`eslint-plugin-svelte`'s recommended set is kept whole.** The two rules argued with in place:
  - `svelte/prefer-svelte-reactivity` on `GameView`'s `lastAction` map: the double-tap guard's
    timestamp book, read by nothing that renders; a `SvelteMap` would invalidate a subscriber that
    does not exist on the hottest path on the board.
  - `svelte/no-unused-svelte-ignore` catches an ignore comment that has stopped applying.

## Image hardening and reproducibility

- **`client/Dockerfile` copies `package-lock.json` and runs `npm ci`**, so two builds of one commit
  are the same image and a dependency compromised between them cannot ship without a diff.
- **`server/Dockerfile` ships one static binary on distroless, as uid 65532.** Built on
  `rust:1.99-alpine` with `--locked` against musl; the image is `gcr.io/distroless/static:nonroot` (no
  shell, no package manager, no `wget`), with `/data` created and owned by that user. The process binds
  a port above 1024, reads no system path and writes one file (the shutdown snapshot), so the
  healthcheck is the binary's own `loco-server healthcheck`. `deploy/compose.yml` and
  `docker-compose.yml` add `no-new-privileges`, `cap_drop: ALL`, a read-only root filesystem and a
  tmpfs `/tmp`.
- **nginx gets `no-new-privileges` and nothing more.** The stock image starts as root to bind :80 and
  writes under `/var`, so `cap_drop: ALL` and `read_only` stop it booting; rootless nginx is a separate
  change, and this container holds no state.
- **The snapshot directory is per environment, owned by 65532 and 0700** — the order inside `rollout`
  and why are in [`deployment.md`](../deployment.md).

## Dev Docker Compose

- `docker-compose.dev.yml`: hot reload, no host Rust/Node needed. `docker compose -f
  docker-compose.dev.yml up --build`.
- Backend: `rust:1.99-bookworm`, bind `./server:/app`, `cargo watch -x 'run -p loco-server'`, `:8080`
  **on loopback only** (`127.0.0.1:8080:8080`: with `LOCO_E2E=1`, `debug_set_state` rewrites any hand,
  and a port on every interface hands that to the LAN). The crate registry and target directory are named volumes outside the bind mount, so a
  restart neither downloads nor rebuilds and the host's `server/target` is not overwritten by Linux
  artefacts. The first build takes minutes, which the healthcheck's 60 retries
  (`target/debug/loco-server healthcheck`) wait for; the client waits on it.
- Frontend: `node:24-alpine` (Vite 8 and SvelteKit 3 need Node ≥ 22.12), bind `./client:/app`, `npm ci
  && npm run dev` and nothing else (`npm ci` runs `prepare`, `svelte-kit sync`), `:5173` (container
  3000).
- **No dev-server WS proxy**: the browser connects directly to `ws://<host>:8080/ws` (the proxy is
  unreliable under Docker). `VITE_WS_PORT` names the port, and when set it wins over everything
  (`state/webSocketPolicy.ts`, `wsEndpoints`): `ws://${hostname}:${VITE_WS_PORT}/ws`.
- `vite.config.ts` proxies `/live.json` and `/live-thumb` to `LOCO_SERVER_ORIGIN`, as nginx does in
  production; `server.ws.clientPort` carries `VITE_HMR_CLIENT_PORT` so HMR dials the published 5173.
- Volumes: `cargo-registry`, `cargo-target`, `client-node-modules`.

### An ad-hoc `docker run` from Git Bash on Windows corrupts its own paths

MSYS rewrites an argument that looks like a POSIX path list, turning `:` into `;`: `-v
/f/dev/loco/server:/app -w /app` reaches Docker as `-v 'F:\dev\loco\server;C:/Program Files/Git/app'`.
The `-w` fails loudly, but the `-v` has already made Docker Desktop create an empty `server;C`
directory at the repo root, invisible to `git status`. Use `make`, run `docker run` from PowerShell
with a Windows source (`-v "F:\dev\loco\server:/app"`), or prefix `MSYS_NO_PATHCONV=1`.

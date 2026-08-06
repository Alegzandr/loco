# CLAUDE.md

## Mission
Premium real-time multiplayer UNO-style card game **built to be streamed**. Low-latency multiplayer,
nickname-only access, server-authoritative anti-cheat, polished visuals *and* audio, strong test
coverage (TDD), docs in sync, Dockerized.

Streamability is a product requirement, not decoration: every state must be readable at 720p by a
viewer who is not playing, and the game's big moments (interception, LOCO!, victory) must be legible
in a clipped highlight with the sound muted.

## Non-negotiables
- No login/signup/OAuth: nickname only.
- Server authority is mandatory; never trust the client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.

## How this file works
**This file is a list of rules and an index. It carries no reasoning.** `docs/notes/` carries the
reasoning: the bug behind each rule, the alternatives measured and rejected, and the edge cases a
one-line rule cannot express.

**Read the matching note before working on a subsystem.** Every rule below is stated as briefly as it
can be stated, and briefly is not the same as fully: the note is where you find out why a rule is
shaped the way it is and what breaks if you reshape it. Update both in the same change set.

| Note | Covers |
| --- | --- |
| [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md) | `server/game/`: deck, scoring, draw stacks, LOCO!/catch windows, interrupts, rematch, lobby |
| [`docs/notes/server.md`](docs/notes/server.md) | `server/hub/`: anti-cheat, bots, sessions, rate limiting, map-loading gate, metrics, logging |
| [`docs/notes/client.md`](docs/notes/client.md) | realtime path, transport, session restore, protocol validation, i18n, the voice |
| [`docs/notes/visual.md`](docs/notes/visual.md) | art direction, board geometry, seats, maps, card face, motion, streamable moments |
| [`docs/notes/audio.md`](docs/notes/audio.md) | synthesis engine, track format, arrangement ladder |
| [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md) | required coverage, Playwright, GitLab pipeline, linting, Docker stacks |
| [`docs/notes/seo.md`](docs/notes/seo.md) | indexable pages, the page registry, hreflang, robots/sitemap/404, build-time origin |
| [`docs/notes/legal.md`](docs/notes/legal.md) | what is processed and why, the no-banner position, address truncation, the trademark line |

Also: `docs/rules.md` is the authoritative game spec, `DESIGN.md` the written design system,
`PRODUCT.md` its audiences and anti-references, `docs/protocol.md`, `docs/features.md`,
`docs/deployment.md`.

**One subject, one file.** `README.md` is the stack and how to run it, `docs/features.md` the list of
what ships, `docs/deployment.md` the pipeline, the notes the reasoning. A section that restates
another file goes stale on its own schedule and then contradicts it, which is how the same feature
list ended up written twice with a link between the two copies. Write it once and link.

## Commands
`make help` lists every target. They are docker-first so a host Go install is not required; the
client and E2E targets do need Node.

| Task | Command |
| --- | --- |
| Dev stack, hot reload | `make dev` (client :5173, server :8080) then `make down` |
| All unit tests | `make test` (server + client) |
| Go tests | `make test-server`, or `cd server && go test ./...` (CI runs `-race`) |
| One Go test | `cd server && go test ./game/ -run TestRoom_ResetForRematch -v` |
| Client tests | `make test-client`, watch mode `cd client && npm run test:watch` |
| One client file / case | `cd client && npx vitest run src/test/matchmaking.test.ts -t "<title substring>"` |
| Full E2E | `make test-e2e` (needs the Go server on :8080; Playwright boots its own Vite on :4173) |
| One E2E file / case | `cd e2e && npx playwright test tests/matchmaking.spec.ts -g "<title substring>"` |
| Lint | `make lint` (golangci-lint in docker + ESLint) |
| Regenerate the protocol | `make protocol` after any change to `server/protocol/`; `make protocol-check` is what CI runs |
| Type-check | `make build-client` (`astro check && svelte-check && astro build`); no separate typecheck script |
| Visual review | `make visual ARGS="--scenes=... --viewports=wide,small,notch"` |
| Deliberately outside CI | `make audio-verify`, `make csp`, `make og`, `make icons`, `make maps ARGS="--src=<folder>"`, `make bench-server` |

## Done means
Code + tests + passing + docs + Docker still works + behavior matches docs. **Update `README.md` when
setup, commands, architecture, limits or env change, `docs/features.md` when a feature does, and
`CLAUDE.md` plus the matching note when a rule, a convention or the structure does — in the same
change set.**

Priorities when they conflict, in order: latency, server correctness, UX smoothness, determinism,
maintainability, testability, local DX. **Avoid persistence and services without product
justification** — collecting nothing is the compliance strategy, not an accident.

## Architecture
**Server owns**: room/player/hand/deck/discard state, turn order, legality, timing windows, counter
resolution, penalties, winner. **Client owns**: presentation, input, rendering, animation, sending
intents. Client visuals may be optimistic; the server is final, timestamps received events, defines
the window, and applies documented tie-breaks.

- **A refusal that can only mean the client's state has drifted carries the correction with it**:
  `hub.refuseAction` + `game.IsStateMismatch` answer with a fresh personalised snapshot, never with
  "no" alone. Lost races are excluded on purpose.
- **Reconnect**: 60s slot hold; rejoin via nickname + room code + session token restores the slot
  with a full snapshot. The identity is mirrored into `sessionStorage`, so a **page reload** reclaims
  the seat too, not only a dropped socket. **A reclaim spends its token and is answered with a fresh
  one, which the client stores** (`player_reconnected` → `setSessionToken`): keeping the spent one
  costs nothing on this reclaim and refuses the *next* one, so it is the second reload that breaks.

## Testing
Detail, and the full required-coverage list: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- TDD, with deterministic clocks for timing logic. The Playwright suite is a living regression.
- **An untested path is where the bugs are, and the doc is not a substitute for one. When a document
  here states an invariant, there must be a test that fails without it.** Three expensive cases are
  in the note.
- **Beware assertions that only restate the fixture.** A count of zero over a fixture that rendered
  nothing passes forever.
- **A component test goes through `src/test/render.ts`, never `@testing-library/svelte` directly.**
  The library reads props and mount options out of the same argument and tells them apart by name,
  and `target` — which `<Reconnecting />` uses to mean a table or a match — is one of the six it
  claims. The wrapper puts everything under `props` so the collision cannot happen; the failure it
  prevents is the silent one, a component whose *only* prop is a reserved word mounting into the
  wrong node. Same door for `src/test/renderHook.ts`, which is how a module that is nothing but
  `$effect` gets a component to live in.
- **The Go suite runs under `-race` in CI** (`backend_test`). This server is one event loop plus two
  goroutines per socket, so a race is the hidden-state guarantee coming apart rather than a style
  problem. Anything new that reads package state off the event loop has to be safe under it.
- Review layout/colour/motion changes with `make visual`. Assertions own behaviour; screenshots own
  appearance. Cover game rules over UI details.

## Repository structure
**`client/`** Astro site + Svelte game. `astro.config.mjs` holds integrations, the dev server, the dev
toolbar (off) and the `VITE_` env prefix. **At the root: no `vite.config.ts` and no `index.html`** —
Astro owns the pages; `vitest.config.ts` is the only Vite config, and it exists because the test run
needs jsdom and the `browser` resolve condition.
- `src/pages/` one `.astro` per URL · `src/layouts/` `Base.astro`, `GamePage.astro`, `ContentPage.astro`
- `src/App.svelte` the screen switch · `src/Root.svelte` the one above it, which mounts the app or
  the curtain saying another tab holds the game · `src/entry.ts` mounts *that* into `#root` via a
  bundled module script, never an island
- `src/homeSheet.ts` the home sheet's Esc, scrim-click and ✕ · `src/theme.ts` · `src/lang.ts` (storage
  key, the two home paths, `chooseLang`) — those two pull in no framework, so a content page can
  use them · `src/langSwap.ts` translates the served half of `/` in place and moves the address bar,
  app-only · `src/pinchGuard.ts` the seated half of "no accidental zoom", installed by `entry.ts`
- `src/seo/meta.ts` the page registry + link-preview tags, as data
- `src/content/` prose and data behind the content pages: `content.css`, `legal.ts`, `faq.ts`,
  `HomeProse.astro`, `CardsArticle.astro`, `navMenu.ts`, `theme-boot.ts`. **Never imported by the app**
- `src/components/` screens + shared: Lobby, WaitingRoom, GameView, GameOver, RulesModal +
  RulesButton + `cardCatalogue.ts`, Preferences + LanguageSwitcher, TableCode, AudioSettings, ActionBar, InterruptBanner,
  CatchBanner, RoundSummary, UnoTimer, Confetti, MapLoadingScreen, Reconnecting, TabTaken, ServerUpdating,
  ColorPicker, PlayerPicker, ScoreTable + `scoreTableModel.ts`, LocoLogo, `playerColors.ts`,
  `swapNoticeText.ts`, `interruptHelpers.ts`, `catchAvailability.ts`, the two server mirrors `nicknameRules.ts` +
  `tableCodeRules.ts`, and the queue's `Searching.svelte` + `searchStages.ts` / `MatchFound.svelte` /
  `OpponentAway.svelte`
- `src/components/cards/` the renderer: GameBoard, Hand, Card, CardBack, Deck, DiscardPile,
  PlayerSlot, TurnIndicator, DirectionRing, AnimationLayer; `layout.ts` pure pixel math;
  `CardArt.svelte` + `cardArtSpace.ts` + `locoMark.ts` the face; `CardGlyph.svelte` + `cardGlyphs.ts`
  the drawn rule glyphs; `SuitMark.svelte`; `maps.ts`; `cardTheme.ts`
- `src/audio/` `engine.ts`, `sfx.ts`, `music.ts`, `tracks/`, and `gameSounds.ts`, which **decides**
  the sounds and plays none of them
- `src/dev/` `scenes.ts` + `Showcase.svelte` + `CardSheet.svelte` + `OgCard.svelte` + `e2eBridge.svelte.ts` (the whole
  `window.__LOCO_E2E__` surface in one file), all behind `import.meta.env.DEV`
- `src/hooks/` splits in two, and the split is the point. **`.svelte.ts` is anything that owns
  reactive state or an effect** — a rune is only compiled in a `.svelte` or `.svelte.ts` file, so the
  extension is the declaration: `webSocket`,
  `gameStore` (the snapshot every component reads), `appEffects` (audio, session persistence, the
  host's streamer mode going out on the wire, the
  restore timeout), `viewEffects` (`heldKey`, `reconnectAnimation`, `turnCountdownSfx`, countdowns),
  `gamePlay` (card play, the WAAPI shakes, map preloading), `boardMetrics` (element size, safe-area
  insets), `drainBar`, `escapeKey`, `tabAlert`, `tabLock`, `prefs`, `uiPrefs`, and `live` (the one narrowing
  every effect above watches its own field through). **Everything else is
  framework-free on purpose** — the plain `.ts` files hold the store itself (`gameStore.ts` +
  `store/`: `createStore.ts`, `types.ts`, `initialState.ts`, `helpers.ts`,
  `deriveCatchMiddleware.ts`, and one module per family — `sessionActions` `tableActions`
  `locoActions` `matchActions` `queueActions`), `serverMessages.ts`, `sessionPersistence.ts`,
  `sessionRestore.ts`, `nicknameMemory.ts`, `tableInvite.ts`, `tabLock.ts`, `prefStore.ts`, and the preference
  and constant modules the reactive half wraps (`motionPref`, `colorAssist`, `streamerMode`,
  `webSocketPolicy`, `mapPreload`, `safeAreaInsets`). **The `use` prefix went with React**: none of
  these is a hook, they are constants, pure functions and plain stores, and **nothing in a plain
  `.ts` file here may reach for a rune** — it would not be compiled, and the failure is silent.
  `src/test/runeScope.test.ts` is the guard.
- `src/styles/tokens.css` design tokens · `src/i18n/` · `src/test/` (its three seams are in
  [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md)) · `public/`
- `src/types/` **generated from `server/protocol/` by `make protocol`**: `protocol.ts` (the types),
  `protocolSchemas.ts` (the Valibot schemas). Do not edit either by hand.

**`server/`** authoritative game server.
- `game/` pure domain: room, deck, hand, rules, bot, maps, event log, `nickname.go` + `wordlists/`
- `hub/` **one file per thing a message leads to**: `table.go` (**the** table, and the seat
  bookkeeping nothing else may do), `actor.go` (the table's goroutine, and the two ways work crosses
  between it and the hub), `hub.go` (the Hub, its tunables and ceilings, the loop),
  `serve.go`, `tokens.go`, `dispatch.go`, `rooms.go`, `rematch.go`, `gameplay.go`, `presence.go`,
  `bots.go`, `turntimer.go`, `broadcast.go`, `statedto.go`, `converter.go`, `metrics.go`, `debug.go`,
  `client.go`, `maploading.go`, `matchmaking.go`, `drain.go` + `snapshot.go`, `privacy.go`,
  `logsink.go` (the asynchronous log writer `main` installs)
- `protocol/` wire types, and **the single source the client's are generated from**: `messages.go`
  (the envelopes and DTOs) and `enums.go` (the wire enums, pinned to the domain by `enums_test.go`)
- `cmd/protocolgen/` the generator: reads `protocol/`, writes the client's two type files, and
  refuses anything it cannot spell honestly rather than guessing

**The rest.** `e2e/` Playwright suite (`tests/`, `helpers/game.ts`, `types.d.ts`,
`playwright.config.ts`) · `tools/` (`lib/devserver.mjs`, `visual/shoot.mjs`, `og/shoot.mjs`,
`maps/prepare.mjs`, `audio/verify.mjs`, `csp/check.mjs`) · `docs/` spec + `docs/notes/` ·
`LICENSE` (MIT) · `NOTICE.md` · `.gitlab-ci.yml` the only CI definition · root config / Docker / env.

---

# Rules by subsystem

Each rule below is the short form. The note named at the head of the section is where the reasoning
is, and it is not optional reading before a change.

## Game domain
Detail: [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md). Spec: `docs/rules.md`.

**LOCO deviations from SOLO** (`docs/rules.md` §14):
1. **GlobalSwitch is wild**: 4 copies, no colour, plays on anything, names the new active colour.
2. **The starting card is always a Number**: `dealRound` skips action and wild cards.
3. **Best-of-N match format** (BO1/3/5/7), not a 600-point threshold, and **rounds won take the
   match, not points**. It stops the moment the lead cannot be caught: one expression,
   `Room.decisiveLeader`, covers the early stop and the end of the format alike.
4. **Voluntary draw is allowed**, still one draw per turn.
5. **A forced draw does not cost the turn.** The victim takes the stack and then plays or passes;
   `hub.handleDrawCard` re-arms the turn timer on every draw.
6. **Nobody forgets LOCO! and wins** (`requireLocoToFinish`, `ErrMustDeclareLoco`): every play
   that empties a hand is refused without the call. A seat already on one card must have declared
   **before** this message — a late call is always accepted, so forgetting costs a press and the
   catch risk, never the round. A batch that empties two or more never passed through one card, so
   no window ever opened on it: that message **carries** the call (`declare_loco`) and the table
   hears `uno_declared` before `card_played`.
7. **A Contre-LOCO! that finds nobody costs the caller 1 card, at most once per card played**
   (`failedCatchPenalty`, `Room.PenalizeFailedCatch`, rationed by `GameState.PlayEpoch` +
   `CatchPenaltyEpoch`). The button is live from three cards out, so the press is a **read of the
   table** and not an answer to a cue: a call that lost a race and a call on a table where nobody
   owed anything are the same misread and cost the same card. **The second press against a board
   that has not moved costs nothing, changes nothing and is broadcast to nobody** — a per-press
   price would tax the reflex the mechanic asks for. A catch that *lands* does not spend the epoch.
   A seat number the table does not have is still refused rather than charged: that one is a forged
   message, not a wager.

- **Deck**: 112 cards, 8-card opening hands, opening discard must be a Number. **Swap is coloured**
  and follows ordinary matching; the three wilds are Wild, WildDrawFour, GlobalSwitch.
- **Every wild must name a real colour**, GlobalSwitch included, and every entry point rejects a
  colourless one. `Wild` must never reach `State.ActiveColor`.
- **A draw never fails.** `DrawCard` validates first, draws through `DrawUpTo`, and only *then*
  clears `PendingDraw` and sets `HasDrawn`: nothing above that line touches state, nothing below it
  can fail. Against exhausted piles the draw shrinks rather than erroring, and the seat keeps its
  turn. `Deck.DrawN` survives for dealing only.
- **Answering a draw stack is `counter_draw`, never `play_card`.** `PlayCard` refuses every card
  while `PendingDraw > 0`. A counter is the **same kind and the same colour**.
- **LOCO! tracking is per seat** (`LastCardDeclared []bool` + `LastCardAt []time.Time`). Receiving
  your last card owes a declaration exactly like playing down to it, so a Swap or GlobalSwitch opens
  catch windows on every seat left at one card. A declaration is a one-shot.
- **The four ways to empty a hand all go through the same gate**: `PlayCard`, `PlayCards`,
  `InterruptPlayCards` and `CounterDraw` each ask `requireLocoToFinish` before they mutate
  anything. Add a fifth win path and it asks too — a finish that skips the gate is a round taken
  in silence, which is the bug the rule exists for.
- **Who is on the hook is the server's to say and it rides `card_played`** (`catch_seats`, from
  `CatchableTargets` + `CatchWindowEnd`): the client renders that list and never re-derives it.
- **Interrupts have no deadline and exclude nobody.** Anyone may play N identical cards matching the
  top discard, wilds included; the player who just played and the current player may both take the
  lead back. Effects stack. Removing those freedoms is what would make the mechanic turn-based: do
  not reinstate them.
- **Scoring**: single-finisher round, `CardValue` per `docs/rules.md` §10, cumulative `Room.Scores`,
  tiebreakers **rounds won then score** then lost-hand total then sudden death. **The score measures
  the gap, it does not crown anybody** — and `biggestLoser` stays indexed on it on purpose, because
  rounds won is too coarse to say who opens the next round.
- **The table remembers its finished matches** (`table.matchHistory`, one record per match, indexed
  by seat). It **survives `resetForNextMatch`**, moves with `dropSeat` and `swapSeats` like every
  other seat-keyed structure, rides the drain snapshot and the personalised state, and is what the
  game-over screen's evening recap is drawn from. A rematch nils the scoreboard; this is the only
  thing that can say who won six matches on one code.

## Server
Detail: [`docs/notes/server.md`](docs/notes/server.md).

- **Client timestamps never decide an outcome.** Per-client token bucket at 10 msg/s, burst 20, with
  **one notice per burst** — answering every drop makes the limiter amplify what it exists to absorb.
- **One message must never be able to cost the server.** `hub.dispatch` opens with a `recover` **and**
  with a gate refusing every `isGameplayMsg` at a table not `StatusPlaying` or whose `State` is nil.
  Neither excuses a missing bounds check; `handler_panics` above zero is a bug by definition.
- **Nothing is unbounded.** `MaxClients` (5000) and `MaxConnsPerNet` (64) refused in `ServeWS`
  **before the upgrade**, against `admitConn`'s own counter, never `statClients`; `MaxRooms` (2000)
  in `handleCreateRoom`. Deliberately generous: **reaching one in production is a signal to read the
  logs, not a number to lower.**
- **A wrong table code costs something**: `MaxFailedJoins` (20) per network per minute, refused before
  the lookup, keyed by network rather than by socket.
- **Both of those are per network, and in production this server never sees one.** Behind
  Cloudflare → Traefik → nginx every socket arrives from the same container, so `r.RemoteAddr` turns a
  64-per-network ceiling into a 64-player server and a per-network join budget into a global one, in
  silence. The network is decided once by `hub.clientNet` and kept on `Client.netKey`, which admission,
  the join budget and `netPrefix` all answer with. It reads `ClientIPHeaders` in order
  (`CF-Connecting-IP`, then `X-Real-IP` — two paths, and one player can use both in a match) **only
  from a trusted peer** (`TrustedProxies`, default loopback + private, which is everything that can
  reach `:8080` on the `internal` network) and **refuses a multi-value one** — Cloudflare *sets* the
  first and *appends* to `X-Forwarded-For`, so the latter's leftmost entry is the client's to invent.
  **That order is a security property**: a client can put its own `X-Real-IP` on a proxied request.
  Anything unbelievable falls back to the peer, **an address no browser on the internet could have
  included** (`isRoutableClient`: loopback, private, link-local, multicast, unspecified) — a forged
  public one buys a bucket of its own, a forged private one is aimed at the bucket everybody else
  falls back into. Truncated on the way in like every other address.
- **Which of those headers a host may forward is the host's to declare, never the shared proxy
  block's** (`client/nginx.conf` `set $loco_cf_ip` / `$loco_real_ip`, read by `ws-proxy.conf`). The
  site's host vouches for `CF-Connecting-IP` because Cloudflare sets it there; **`ws.` is
  grey-clouded, so nothing sets or strips that header on it** and a client writes its own — which
  this server believes, because the peer is the same nginx either way. Forwarding both from both was
  one forged header per socket buying one network key per socket, and with it a private copy of every
  per-network ceiling. The other side is emptied, which makes nginx omit it. `csp.test.ts` pins it;
  the residual — reaching Traefik directly and bypassing the CDN — is closed by an allowlist on the
  host Traefik, not here.
- **`LOCO_ALLOWED_ORIGINS` is mandatory in production now.** The page and the socket are deliberately
  on two hostnames, so `originAllowed`'s default (Origin's hostname == request's Host) refuses every
  upgrade. It names the **page's** origin, never the socket's.
- **A refusal must not name the roster.** `join_room` at a table in progress answers `game already in
  progress` either way. Tokens compare with `subtle.ConstantTimeCompare`, and **a reclaim spends its
  token and is issued a fresh one**.
- **The upgrade checks `Origin`** (`hub.originAllowed`): hostnames must match, ports need not;
  `LOCO_ALLOWED_ORIGINS` overrides with an exact allowlist; a missing `Origin` is allowed.
- **A table is one object, it owns its own goroutine, and it is the only thing that may move a seat**
  (`hub/table.go` + `hub/actor.go`). Deleting is one `delete`, a rematch's reset is
  `resetForNextMatch()`, removing a seat is `dropSeat(id)`, which shifts members, surviving
  `playerID`s, bots and tokens **together**. Zero values mean something on purpose. Add per-table
  state as a field here, **never as a twelfth map and never as something another goroutine reads**.
- **The hub routes, the table decides.** `t.post(job)` runs work on a table, `h.postToRouter(fn)` runs
  work on the hub, and **both are non-blocking**: a blocking send either way deadlocks the moment the
  other end sends back. Overflow is dropped and counted; the drops that would leak something (a room
  nobody deletes, a seat nobody frees, a reveal that never deals) retry once. The hub keeps `tables`,
  the matchmaking queue, `clients`, the wrong-code budgets and the drain, and **nothing else may
  touch a table's fields**. `create_room` allocates on the hub; `join_room`, `find_match` and
  `leave_room` are split, and their halves are **ordered rather than raced**.
- **A table is started only once the hub has finished filling it in** (`t.start(h)`, never
  `newTable`), and it **stops existing and stops running at the same moment** (`deleteRoom` removes
  the map entry, then `stop()`s and waits, which is also what makes the read after it safe).
- **A panic is recovered on the table as well as on the hub** (`runJob`). It matters more there: a
  dead table goroutine does not fail, it goes quiet, and every message to that room queues behind
  nothing forever. `handler_panics` still covers both.
- **A socket holds one seat for its lifetime, and the seat is one atomic value** (`Client.seat`, a
  `seatRef` of code plus index — never two fields written in pairs). `table.seat` / `hub.seatClient`
  sweep the old index and the old table, `hub.alreadySeated` refuses on `create_room` and `join_room`,
  and **`dispatchAtTable` re-checks the seat against the table about to act on it**, because the
  routing and the handling no longer happen in the same instant. Reconnects are unaffected.
- **A seat that is empty must read as empty, and `awayAt` only answers half of that**: the entry is
  deleted when the hold ends, so `table.gone` (read through `hasLeft`) is what keeps a seat a running
  match cannot remove from being broadcast as connected. **A finished ordinary table holds its seats
  too** — the match is over, the rematch is not — so `join_room` reclaims a held seat at any table
  that is not a lobby, the reclaim carries **no `state`** when there is none, and the expiry there
  removes the seat for real. Matchmade tables are excluded on purpose.
- **Personalised sends index by slot, never by `member.playerID`.**
- **Room codes, session tokens and the room's own RNG all come from `crypto/rand`**, no fallback.
  `game.newRNG` seeds the source that picks the map, the starting seat and the shuffle: **the deal is
  hidden state, so a clock seed hands every hand to anyone who timed `create_room`**.
  `game/rng_test.go` runs that attack. **Every shuffle that decides a hand takes it, the mid-round
  `Deck.Replenish` included**: the pile going back into the deck has been seen by the whole table, so
  predicting its order is knowing the rest of the round. `math/rand` is for bot jitter and nothing else.
- **The nickname is validated in the domain and refused with one string.** `game.ValidateNickname`
  owns length **in runes**, an allowlist charset and the blocked-term check; all three reach the
  player as `nickname not allowed` and **never say which rule fired**. Words in
  `server/game/wordlists/` (LDNOOBW, CC BY 4.0, attributed in `NOTICE.md`), matched folded,
  whole-token first, **as a substring only from 6 characters up**, with `nicknameAllowSeed` for the
  collisions. **That threshold and that allowlist are the false-positive control: do not lower them
  without a test proving real names still pass.**
- **A refused action is not automatically suspicious.** `game.IsLostRace(err)` names what a correct
  client produces all match; handlers call `Client.noteRejection(err)`, not `noteSuspect`. Always
  `errors.Is`, never string comparison.
- **A refused message must never be cheaper than an accepted one.** Three rules fall out of it, and
  each closed a way a refusal paid better than a play:
  - **A refusal does not clear the AFK counter.** `dispatchAtTable` resets it *after* the handler and
    only when `Client.refusals` did not move; `sendError` is the single funnel that moves it. Reset
    before the handler, one refused `declare_uno` a turn bought permanent immunity.
  - **A refusal answers its sender and nobody else**, unless the rules say the table pays too. Same
    rule makes `rematch` idempotent: an ask already in the set republishes nothing. **A penalty that
    drew nothing is the same case**: against two dry piles a missed catch costs nothing, so it tells
    its caller and not the table — otherwise a call inside somebody's window was still a free
    broadcast. **A Contre-LOCO! already charged for this board is the same case again**: `PlayEpoch`
    makes the second press draw nothing, broadcast nothing and answer nobody, which is what keeps a
    button that is live most of the endgame from being a table-wide send ten times a second.
  - **A correction is throttled** (`resyncPeriod`, 1s per socket): one snapshot settles the drift,
    and everything sent in the millisecond after it was composed against the old board.
- **The gameplay gate also bounds the seat.** `dispatchAtTable` refuses a sender whose `playerID` is
  not an index into `State.Hands`, beside the `Status`/`State` check and for the same reason: four
  entry points index a hand before they validate anything.
- **Every path that grows a hand goes through `hub.sendHandGrowth`**: the affected player gets the
  cards, everyone else the count.
- **A zero is a value, not an absence.** `turn` and `drawn_count` carry no `omitempty`;
  `pending_draw`, `has_drawn`, `player_index` and `player_id` are pointers. Read seats with
  `ServerMsg.Seat()` / `ServerMsg.OwnSeat()` (-1 = no seat named).
- **Bots**: `game/bot.go` decides, `hub` schedules, through the same domain calls and broadcasts as
  humans. Only `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS` are tunable from the environment (gated on
  `LOCO_E2E=1`); **every other bot delay is a reaction window somebody is meant to be able to win.**
- **1v1 matchmaking is one FIFO queue** and its size is **never on the wire** — `matchmaking_queued`
  is an empty acknowledgement, the number lives only on `/metrics`. Nothing player-facing says
  "unranked".
- **`players_online` is the sockets, not the queue** (`hub/online.go`): every connection this process
  holds, sent on registration and then **only when the count moves**, and **only to sockets that are
  not at a table** — the home screen is the only place it is drawn, and this is the one message that
  would otherwise reach every socket at once on a timer. **What each socket was last told is kept per
  socket** (`Client.onlineSent`), because a hub-wide watermark skips the player who has just left a
  table and waits for a number that, on a quiet server, never moves again. The floor under which it
  is not shown is the **client's** (`components/playersOnline.ts`, two players): the number stays
  true, the screen decides whether it is worth drawing.
- **A table with no host is a shape, not a mode** (`table.hostless`, `refuseWithoutHost`). Two answer
  to it — a matchmade pair and a solo game — and `add_bot`, `start_game`, `set_match_format`,
  `set_max_players`, `kick_player` and `transfer_host` are refused at both.
- **`play_bot` is a 1v1 against the server, and it is the queue's shape without the queue**
  (`hub/solo.go`): a nickname, one press, a hand — no code, no waiting room, nothing to configure,
  BO1. **It touches nothing the queue owns** (no `h.queue`, no `matchmaking_queue`), which is a
  property the E2E suite depends on. Its `game_started` carries `room_code` / `player_id` /
  `session_token`, because it is the only message the mode sends and a reload still has to reclaim
  the seat. **`rematch` is the one room where it is refused** — there is nobody to ask; another press
  is another `play_bot`. Reconnect, drain and the snapshot treat it as an ordinary table: the
  matchmade timings exist because a stranger will not wait for you.
- **Three fixed emotes, on the game-over screen, and no free text anywhere in this game**
  (`hub/emotes.go`, `protocol.AllEmotes`). The set is **closed and server-side** — an identifier this
  server does not know is refused and counted, never relayed. **Nothing is kept, anywhere**: not in
  the event log, not on the `Room`, not in the snapshot, and not on the table either — `hub/emotes.go`
  holds no state at all. Refused anywhere but a finished match and **never to or from a bot**; **both
  refusals answer their sender and broadcast nothing.** **A seat changes its mind as often as it
  likes**: the 2s per-seat cooldown is gone, because the client *replaces* a seat's line instead of
  stacking it — so the screen never needed a cap, and the cap only ever refused somebody rewording.
  The per-client token bucket is the bound, as it is for every other message. Free text would be a
  moderation surface, and collecting nothing is the compliance strategy.
- **`set_streamer_mode` is the one setting a client's *presentation* preference is allowed to reach
  the server through** (`table.streamerMode`, `handleSetStreamerMode`). Host only, hostless never,
  **every status** — the format and the seat count are lobby controls, this one is not, because the
  thing being captured is the match. It carries a state and never a toggle, a repeat of the state the
  table is already in is **answered by nobody**, and the answer travels on `streamer_mode_changed`,
  on `room_joined` and in every `GameStateDTO`. It survives `resetForNextMatch` and rides the drain
  snapshot: the stream does not stop because the match ended or the server was deployed. **Nothing
  else about a player's presentation may follow it here.**
- **`kick_player` is the one host control that acts on a person, so it is the strictest**: host only,
  lobby only, matchmade never, **never seat 0**. The work is `releaseSeat`, so the table sees an
  ordinary `player_left` and the removed client gets `kicked` on its own socket; an unmanned seat goes
  through `removeUnmannedSeat`. **It is not a ban and must not become one.**
- **`transfer_host` hands the table over, and it is a seat swap** (`handleTransferHost`,
  `game.SwapLobbyPlayers` + `table.swapSeats`, mirrored seat for seat, **the token travelling with
  the player**). Host only, lobby only, matchmade never, **never seat 0 and never a bot**. `host_changed`
  is sent **per recipient**: two seats moved, so half the room's own `player_id` moved with them.
- **The host is seat 0, so a bot never sits there** (`hub.keepHostHuman`, called from
  `reindexLobbyDisconnect` **and** `joinAtTable`). A lobby removes a departed seat and re-bases the
  rest, so a bot slides into 0 and the table is handed to something that can never press start. Both
  call sites are needed: a host who reloads leaves nobody behind to promote, so the promotion is the
  arrival's.
- **`rematch` is an ask, not a decision, in every room** (deliberately *not* behind
  `refuseInMatchmade`). Every seat gets the same button, every ask is broadcast (`rematch_offered`,
  carrying the **whole** offer state and the quorum, never the increment), and the deal happens only
  once every connected human has asked (`rematchQuorum`; bots are not asked). **A departure retires
  that seat's ask and re-bases the rest**, completing the agreement on the spot when what is left has
  already asked. In a matchmade room the client requeues the survivor instead.
- **Nobody waits for somebody who is not there.** A matchmade room holds a dropped seat 15s and treats
  2 consecutive turn timeouts as away, and **both expiries forfeit the match**, as does `leave_room`.
  **The scoreboard is left alone.** Ordinary rooms keep 60s and 4, and every room allows `leave_room`
  in its waiting room behind one in-place confirmation, the only one in the game.
- **`leave_room` is refused nowhere, and the table decides what it does** (`leaveAtTable`, four
  branches in this order): a matchmade match **forfeits**; a solo game **or** a table nobody can come
  back to (`table.abandonedBy`: every other seat a human with no socket and **no hold left**) is
  **closed**, seat swept, no forfeit, because the only seat to award it to is empty or a bot; above
  the floor the round **carries on** without the seat; at or below it the match **ends and goes to
  the seat that stayed**, announced as a forfeit with the scoreboard untouched. **And a match nobody
  is at and nobody can return to ends where that becomes true** (`closeAbandonedMatch`, off the last
  expiry), rather than auto-drawing for empty seats until `EmptyRoomTimeout` and holding a deploy
  open for five minutes.
- **`WalkOutFloor` = 2 is what a match needs to keep being a match**, not a permission (`Hub.canWalkOut`,
  `Room.RetireSeat`). A player who has to go has one other exit — the turn clock auto-passing for an
  empty chair until the AFK threshold — so refusing only ever bought a closed tab. **Evaluated once,
  at the ask.** Above it the seat is *retired*, not removed: **the hand goes back to the deck**, the
  turn steps over it, its catch window shuts, it is dealt nothing thereafter — and **the scoreboard is
  left exactly as it stood**, because leaving is a departure and not a forfeit. `nextTurn`,
  `rotateSeats`, `biggestLoser` and the Swap target all know about it. **The control is a chip in the
  board's chrome row, never on the action bar**, and **the seats that stay are told who left, by
  name.**
- **A deploy does not end the matches on the server.** `SIGTERM` drains (`hub/drain.go`): nothing that
  would start a new match is accepted, the queue is emptied with an explanation, **every table is
  told once — every table, not only the ones playing: a waiting room, a game-over and a versus reveal
  are the three that otherwise learn about the deploy by being refused** — **everything already
  running is left completely alone**, and the refusal list is chosen so the drain terminates. The rest
  is written to `LOCO_SNAPSHOT_PATH` and read back by the next process (`hub/snapshot.go`). Only
  matches in flight travel, a snapshot is never replayed, and a foreign `SnapshotSchemaVersion` or an
  age past `SnapshotMaxAge` drops the file whole. **`stop_grace_period` in `deploy/compose.yml` must
  stay above `LOCO_DRAIN_TIMEOUT`**; one policy for every environment, so **a deploy never waits on
  the tables that are up**.
- **The map-loading gate refuses every gameplay message while open**, and the turn clock starts at
  `match_ready`, not `game_started`. Per match, not per round.
- Deferred async is `time.AfterFunc`. Critical channel sends retry once then `WARN`. Broadcasts
  marshal once. `Client.SendBytes` force-closes on a full send buffer. **The versus reveal's deal is
  armed twice** (`MatchmakingRevealBackstop`): every other dropped job is lossy, that one is
  unbounded — the table stays a matchmade lobby, so it publishes `phaseInFlight` for good and no
  later deploy can finish draining. Re-running it is free because it re-checks, like every deferred
  callback here.
- **What the server costs is measured, not assumed** (`make bench-server`, `hub/loop_bench_test.go`):
  8.6 µs for a whole card play, against a token bucket that admits at most 50 000 msg/s. One
  goroutine already absorbed that; the split above was bought for **isolation between tables, not
  throughput**. `/metrics` carries `loop_queue_depth` (the hub's routing queue), `loop_queue_peak`
  (the deepest one table's box has been) and `loop_slowest_us` (the longest one message has taken
  anywhere) beside `messages_dropped_busy`. Every counter lives on one `hubMetrics` struct
  (`hub/metrics.go`), and the high-water marks are raised by CAS, not load-then-store. **Argue about
  scaling with those numbers or not at all** — the note has the table and what it rules out.
- `/metrics` **and `/health`** are operator surfaces: only `docker-compose.dev.yml` publishes the Go
  server, and **nginx proxies `/ws` and nothing else**. `debug_mode_active` must be `false` in prod.
- **The server container has no privilege to lose**: uid 10001, `no-new-privileges`, `cap_drop: ALL`,
  read-only rootfs, tmpfs `/tmp`. `${DATA_DIR}/snapshots` is chowned 10001 and chmodded 0700 by
  `.gitlab-ci.yml`. **Treat that directory as a secret**: every session token and every hand of every
  interrupted match.
- Structured `key=value` logging, `conn=` on every connection-scoped line, never tokens or hands.
- **The log never touches the event loop.** `main` installs `hub.NewAsyncLog` as the standard
  logger's writer, so every `log.Printf` stays where it is and becomes a channel send: a line was the
  most expensive call in a handler and the only one a reader outside the process could stall. The
  queue is bounded, **overflow is dropped rather than waited on** (waiting is the failure being
  removed), and what is dropped is both counted on `/metrics` (`log_lines_dropped`) and admitted in
  the log itself. Never route that notice back through `log`. `main` closes the sink last, waits for
  the shutdown before returning, and does not call `log.Fatal`.

## Client
Detail: [`docs/notes/client.md`](docs/notes/client.md).

- **The game is never an Astro island.** A `client:*` directive emits inline scripts the CSP refuses,
  so the production page is blank. `entry.ts` is mounted by a bundled `<script>`; `csp.test.ts`
  fails on any `client:*` or `is:inline`. Same rule sends the fast-refresh preamble through
  `astro.config.mjs`.
- **A dependency can break the CSP without appearing in our sources**, so **`make csp` belongs after
  a dependency bump too**. Zod 4 JIT-compiled each schema with `Function()`, which `script-src 'self'`
  refuses; the validator is Valibot now, and `csp.test.ts` asserts the property rather than the old
  workaround's config flag: it runs a real validation with `Function` proxied and fails if anything
  reaches for it.
- **`astro.config.mjs` puts the `VITE_` env prefix back**, which Astro narrows away
  (`src/test/wsEnv.test.ts`).
- **`/` arrives in one piece, and the background is never part of the arrival.** Hold `#root > *`,
  `.homeIntroMain`, `.homeBurger` at `opacity: 0` — **never `#root` or `.homeIntro`**, which paint the
  canvas. Opacity only, never a transform. The four details that make it safe rather than a way to
  lose the page are in the note, and `contentPages.test.ts` pins each.
- **Derived state in the store is completed by the store, never by the actions**
  (`store/deriveCatchMiddleware.ts`, `catchDerivation.test.ts`).
- **An effect that watches one field of the store reads it through `live()`** (`hooks/live.svelte.ts`),
  or through a `$derived` when it is written in a component. `game.current` is **one** `$state.raw`
  replaced whole on every message, so a `$effect` reading `g.x` depends on the entire match and
  re-runs several times a second — which for these effects means clearing and re-arming the timer
  they own. React compared dependencies by value and this is what the crossing lost: a notice that
  never comes down, a reconnect curtain over a table that is already back, a drain bar snapping to
  full on every play, a colour picker closing itself under the player's thumb.
  `src/test/liveDeps.test.ts` moves a field nobody is watching and asserts nothing noticed.
- **A child gets no narrowing either: reading a prop is not depending on its value.** A sibling prop
  being re-evaluated re-runs the effect, and every component under `GameView` is handed a dozen props
  off the same snapshot. So **an effect that spawns an animation guards on its trigger's timestamp**
  (the board's `lastPlayAt` / `lastSwapAt` / `lastCatchAt`, `DiscardPile`'s `key` + `untrack`) and
  **an effect that holds a timer works to an absolute deadline** (`Hand`'s `dealUntil`, `drainBar`),
  never to "one timeout from whenever this last ran" — the cleanup takes the timer with it. And
  **an effect that starts work once per key abandons it on that same key, never in the effect's
  cleanup** (`mapPreload`): a re-run that the guard sends straight back cancelled a download nothing
  would restart, so `map_ready` never went out and every two-human table opened on the server's 20s
  backstop.
- **Nothing continuous goes through reactive state.** Countdown bars use `drainBar`, never a
  percentage: the element is handed a CSS animation whose duration is the window, so the drain costs
  zero updates. Svelte builds the board once and keeps it, which is a guarantee only until somebody
  puts a `{#key}` around it or keys a block on something that moves with the state
  (`appSubscription.test.ts` counts instantiations for exactly that reason).
- **Send first, animate second.** `onCardClick` returns whether the card left the hand; the flight
  spawns only on `true`. **A tap that is not a play animates nothing**, and the legality check runs
  *before* the prompts, so a refused card opens no picker.
- **The socket does not go through the CDN, and `webSocketPolicy.ts` is what decides that.** Measured
  Paris to Paris on an **established** connection: 389 ms median through the proxy, 8.5 ms direct, and
  an interrupt is decided by arrival order — so it is the mechanic, not the polish. Production dials
  `VITE_WS_ORIGIN` (baked in at build time, **tag only**), takes the **scheme from the page** so mixed
  content cannot fail as silence, and **falls back one-way** to the page's origin after
  `DIRECT_FAILURES_BEFORE_FALLBACK` sockets that never opened — because that hostname's certificate is
  the one thing here nothing renews and nothing can see expire, and a slow game beats a dead one. The
  CSP keeps **both** origins for that reason, `client/Dockerfile` substitutes `__WS_DIRECT_ORIGIN__`
  from the same build-arg as the bundle and **fails rather than shipping the placeholder**, and nginx
  answers `ws.*` with the socket and a 404 (`ws-proxy.conf`, included by both server blocks).
- **The socket never stops trying to come back, and three things retry it on the spot**: `online`,
  the tab returning, and the button on the reconnect curtain (`webSocket.reconnectNow`). A ceiling
  on attempts is a curtain that never comes down over a seat the server may still be holding.
- **The rejoin covers every screen a socket can drop on** (`reconnectMessageFor`): `searching` asks
  again, `matchfound` and `gameover` reclaim with the token, a matchmade `gameover` does not.
- **One tab holds the game and the others open no socket** (`hooks/tabLock.ts`, `Root.svelte`,
  `TabTaken.svelte`). A second tab used to be a second player: a second count in `players_online`,
  and a second entry in a queue that deduplicates by socket pointer, so it could be **paired against
  the first one**. The election is **one synchronous `localStorage` read before the first paint**,
  never a race on `BroadcastChannel` — a boot that waits either flashes a curtain over the owner or
  opens a socket "just in case", which is the thing being prevented. The record is a **heartbeat**
  (`BEAT_MS` / `STALE_MS`), because a tab that crashes sends no release and a flag would lock the
  game away for good. **In every doubt the tab owns the game**: no storage, no channel, storage that
  throws, JSON that will not parse. **It is not mounted inside `App.svelte`** — `webSocket()` is
  called at the top of that script, so not opening a socket means not mounting the app, which is the
  only reason `Root.svelte` exists. **Taking the game inherits nothing** (the other tab's token is in
  *its* `sessionStorage`), so the curtain says what the press costs *before* it is pressed, the way
  `leaveNote` does. **That curtain does not close on `Escape`** and is the documented exception to
  the rule below: it is the state of the tab, not a panel somebody opened, and there is nothing
  behind it to go back to. And it is a client mechanism: **two browsers or a private window bypass
  all of it**, the queue included.
- **The board's way out is a chip in the chrome row, at every table, and never on the action bar** —
  that bar is a fixed three-column grid a reaction is aimed at and must not grow a fourth control.
  It asks in place, and **the line under the question is the feature**: what the player cannot see
  from their own screen is what leaving costs everybody else, so `leaveNote` picks one of four
  strings (bot / matchmade opponent / a table that keeps playing / a table that stops), counted the
  way `Hub.canWalkOut` counts. **Nothing here is greyed out**: the server refuses none of it, and a
  disabled exit only ever produced a closed tab.
- **A seat leaving is told to the table, by name** (`departureNotice`, riding `noteSeatGone` so it is
  idempotent with the seat record). Held and gone are both `connected: false`, so a bubble going
  quiet cannot explain a turn order that just changed shape.
- **A board that has stopped still says so.** Every other seat's hold has expired, nothing will move
  again, and the curtain carries `leaveRoom`. It reads `goneSeats` — written only by the one
  `player_left` that names a seat — and waits behind the reconnect curtains: our own socket being
  down may be the whole reason the table looks empty.
- **There are no gameplay keyboard shortcuts and there must never be any.** No key plays, draws,
  passes, calls LOCO! or throws a Contre-LOCO!. Aiming at a button that lights up for a few
  seconds *is* the skill the game measures, and a shortcut deletes that gesture rather than
  assisting it; this and the fixed three-column action bar are the same decision seen from two
  sides — the controls hold their coordinates so they can be aimed at, and there is no way not to
  aim at them. **Global and focused are not the same thing**: a `window`/`document` listener fires
  on a press nobody aimed and is refused, while a focused control (a card and the draw pile on
  Enter/Space, the language listbox on arrows and Home/End) demands that you got there first and
  is the accessibility path — do not remove it in the name of this rule. Exactly three global key
  listeners are allowed: `heldKey` (score table on TAB), `escapeKey.svelte.ts`, and the audio
  unlock; everywhere else a global listener may read `Escape` and nothing else.
  `noKeyboardShortcuts.test.ts` is the guard.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, the catch key carrying its target).
- **Contre-LOCO! is pressable before the server has named anybody** (`components/catchAvailability.ts`,
  `CATCH_LIVE_MAX_HAND = 3`): any *other* seat holding 1–3 cards makes it live. A control that unlocks
  on the server's cue can be answered but never anticipated, and the window it answers is five
  seconds. The price is what keeps that honest — see the domain rule above. **A seat on one card the
  table heard call it stops counting** (`store.declaredSeats`): it cannot be caught until its hand
  changes, so the press is no longer a read that lost but a card paid for nothing — the one case the
  button greys out for. At two or three cards a declaration voids nothing, because an interrupt puts
  that seat on one before a thumb lands and it owes a fresh call when it gets there. **What the table
  heard, never an absent catch window**: a reloaded tab is told no windows at all, and greying out on
  that silence costs a reaction. `store.myDeclared` is the same record read at our own seat, derived
  by `deriveCatchMiddleware` rather than written by an action. **`store.catchSpent` is
  the client's copy of `PlayEpoch`**, set by every press and cleared by `applyCardPlayed`; it
  suppresses the *blind* send only, never a press that names a seat, and the case it exists for is
  the second tap of a double tap on a catch that landed — the server's own guard does not cover it,
  because a catch that lands spends no epoch.
- **Anything that opens over the board closes two ways: `Escape` and a pressable control.** Escape
  goes through `hooks/escapeKey.svelte.ts`, one hook for all of them. A dropdown anchored to its own
  opener is the one exception. `escapeClose.test.ts`.
- **A refused action never shows a wire string.** `i18n/serverErrors.ts` maps server prose by ordered
  regex, resolved at render. **Add the string there when you add a server error**
  (`serverErrors.test.ts`).
- **`src/types/protocol.ts` and `src/types/protocolSchemas.ts` are generated and must not be edited.**
  A new message type or field goes in `server/protocol/`, then `make protocol`. The wire used to be
  described three times with nothing checking the three agreed; `protocol_check` in CI regenerates
  and fails on any difference, so a hand edit is undone rather than merged. Details, and what the
  generator refuses to guess, in [`docs/notes/client.md`](docs/notes/client.md).
- **The copy is the game talking, not a website.** Players open a **table**, share a table code, take
  a seat: no "lobby", in any player-facing string. French is **tutoiement**. A button is
  the verb about to happen; a refusal says what to do next and never scolds; only the streamable
  moments shout. Full voice in the note; `docs/rules.md` stays the spec the modal must not contradict.
- **One word per thing: a table is the seats, a room is the place.** A **table** is the group of
  seats a code is shared for, always. A **room** — *décor* in French — is one of the four places a
  match is dealt in, always. `salle`, `salon` and `pièce` name neither and are banned outright:
  `vocabulary.test.ts` fails on any of the three in player copy. The internal naming (`maps`,
  `game/maps.go`, `mapPreload`, `cardTheme`) is untouched — this is a rule about copy. **The URLs
  and the `<title>`s keep "tables"**: they carry the search value, and a path is not copy.
- **The rules page opens on what is different, and the rules modal does not** (`content/contrasts.ts`,
  eight lines, **numbers taken from the server, never typed**). A visitor arrives holding a model of a
  card game of colours and symbols and is looking for the delta; the modal is a reference read
  standing up mid-round and is not the place for an argument. `contentPages.test.ts` pins both halves.
- **Under 46rem the burger is the only way to anything the footer row carried, prose included.**
  `#navAbout` is the drawer's first line, ships `hidden`, is revealed by `homeSheet.ts` and opens the
  same `<details>` sheet — same contract as `#navPrefs`. Without it a first visit on a phone was a
  logo, a tagline, two buttons and a burger, and nothing at all about the game.
- **The host's two controls over a row live behind one ⋯, never their own row, and both ask**
  (`WaitingRoom.svelte` + `RosterRowMenu.svelte`): hand the table over, remove from the table. A bot's
  row carries the second only — `is_bot` rides the roster because a nickname cannot say it. Right-click
  opens the same menu and is never the only way in. **The question takes the menu's place**, Escape
  backs out one step at a time, and **below 46rem the dropdown is a bottom sheet with a scrim**. The
  removed player is reset like `left_room` and *then* told why: `resetToHome` clears `errorMsg`.
- **Player preferences live behind one gear** (`Preferences.svelte`), on every screen: language, theme,
  streamer mode, colour shapes, reduced motion. Each on/off preference is a `createBooleanPref` module
  store (`localStorage`, presentation only). **Streamer mode is the one that also leaves the client**,
  and only from the host's — see below; every other one is local and must stay that way. Those icons
  are **drawn SVG, never a font character**.
- **The rules opener is a "How to play" pill before the deal and the "?" chip at the table**
  (`RulesButton`, `variant="text"` / `"icon"`): a glyph is faster mid-match, and a word is the only
  onboarding a first-time player gets on the screens where they are still deciding. The pill's
  visible label **is** its accessible name, so it carries no `aria-label`.
- **What it opens has two halves, and the deck drawn is one of them** (`RulesModal`, tabs "Rules" and
  "Cards", opening on the rules). A first-timer arrives holding a model of a card game of colours and
  symbols, and the two cards this one adds — Swap and Global Switch — are exactly the two that model
  has no slot for: a bullet naming one asks them to picture it, a face lets them recognise it in
  their hand. `components/cardCatalogue.ts` is the faces (one kind, one suit each, `<Card />`
  itself), `t.cardNames` the names and `t.cardBriefs` the one-liners; **nothing about a card is
  spelled out twice**. It stays eight lines: the copies, the points and the long form are the
  `/cards/` page, and **this modal still links nowhere** — a link mid-match is an invitation to leave
  the table. `rulesModal.test.ts` pins both halves. **Switching between them changes the contents and
  nothing else**: the card holds one height for both, the scroll reset is instant, and the arriving
  panel fades in on opacity alone — a card sized to its own contents resized under the tab row on
  every press, and took the control that had just been pressed with it.
- **Below 46rem that panel is a sheet, and only `Lobby` may pass `triggerBelowPhone={false}`.** The
  scrim **wraps** the panel, and its ✕ needs `position: relative`. **`AudioSettings` is the same
  sheet at the same width** — same row, same thumb — and **a sheet does not keep the dropdown's
  type**: labels 15px, hints 13px, switch rows 56px, slider thumbs 30px.
- **Both panels are one 292px dropdown above that width, and everything in them is sized to be
  pressed**: switch rows 50px, segmented options 38px, the language control 42px, a 14px slider track
  under a 26px thumb. **A section in either is grouped by space and a micro-caps heading, never by a
  rule drawn across the card** — an ink line inside an ink outline cuts the panel in half.
- **Anything that opens over a screen declares its own `text-align`** (`RulesModal`'s `.backdrop`,
  both panels' `.panel`): the property inherits and `position: fixed` does not stop it, so an
  overlay that sets nothing is set by whatever screen is underneath — the searching screen centres
  its column, and the rulebook opened from there came out centred. Pinned by source scan in
  `rulesModal.test.ts` and `preferences.test.ts`; jsdom applies no component styles.
- **That dropdown is ours, and it has to be**: a `<select>` is the closed control plus a list the OS
  paints, and `appearance: none` only ever reached the first, so the panel dropped a white system
  menu with a blue system highlight over a dark board. A button plus a `role="listbox"`, arrows and
  Enter and Home/End on the button, `aria-activedescendant` naming the row. **Escape there closes the
  list and nothing else** — the panel listens for the same key on `document`, and one press closes one
  thing.
- **The language is a dropdown and the pick applies itself, on every screen.** `setLang` swaps the
  game's strings and records the choice, `swapServedLang` takes the half Astro served and the address
  bar with it, and nothing reloads — so there is no Apply button and no sentence promising one.
  It had both at the entry screen while applying *cost the page*, because a control that costs the
  page must not fire on the press aiming for it: **that rule stands, so if a language ever reloads
  again the button comes back with it.**
- **A control drawn under 44px gets its target from `.hit-target`, which needs `position: relative`
  on the control** or the target silently stays 40px. Segmented options keep their own height.
- **Quiet is a hue, never an opacity**: `--color-muted`, never `--color-ink` at 0.34.
- **The host is told what they are choosing, on the control that chooses it.** The estimated length
  rides each format button and the seat-count advice sits under the field (`matchLengthModel.ts`,
  pure and tested). **It is a range, never a figure**: a match stops the moment the lead cannot be
  caught, so a BO7 is four rounds or seven, and the copy carries the `≈`.
- **The code plate says it copies a link before it is pressed** (`TableCode.svelte`, `link` prop): a
  **drawn** chain, never a font character, and **outside everything streamer mode blurs** — what has
  to stay off a stream is the six characters, not the fact that the plate copies a link.
- **Streamer mode blurs the table code, and `TableCode.svelte` is the only way a screen prints it.** CSS
  over the real text, so copy still copies. **Nothing uncovers it — there is no reveal at all**: not
  hover, not focus, not a click, not a tap. Every guard written for one input was answered by
  another, and each put the six characters back on the capture; the way to share a table with the
  mode on is the link the plate copies. `TableCode.svelte` holds no state selector and the blurred
  span is out of the tab order (`preferences.test.ts`).
- **The host's streamer mode is the table's, and it is the one preference that goes on the wire.** The
  code is one string shared by everybody who can see it, so blurring only the host's copy protects
  the one screen that was already being watched. `set_streamer_mode` is **host only, refused at a
  hostless table**, accepted at every status (a host streams the match, not the wait), and answered
  with `streamer_mode_changed` to the whole table; the answer also rides `room_joined` and every
  state snapshot, so an arrival and a reload are blurred without waiting for the switch to move
  again. The client ORs it with the local preference (`store.tableStreamer`, `TableCode.svelte`) and
  **never overwrites one with the other**. `hostStreamerSync` sends on exactly two moments — the
  preference moved, or we opened a table with it already on — and **a change of seat sends nothing**:
  `transfer_host` would otherwise uncover the code for a host still sitting there streaming.
  `tableStreamerMode.test.ts`, `hub/streamermode_test.go`.
- **Colour assist gives each suit a silhouette** (`SUIT_SHAPE`, drawn by `SuitMark.svelte`): on the card,
  every picker swatch and the active-colour chip. **Never a letter.** A wild stays unmarked. Anything
  new that means something by hue alone needs the mark.
- **Reduced motion is scoped to `:root[data-motion="reduce"]`, never a media query** — a media query
  cannot be overridden, and `full` has to be able to win over a system that asks for less.
  `initMotion()` writes the attribute from the system setting *and* the player's answer, and it is
  now the whole mechanism: Svelte transitions and the two WAAPI shakes ask `prefersReducedMotion()`
  themselves. `reducedMotionCss.test.ts` owns the rules, `motionPref.test.ts` the wiring.
- **The home menu is four buttons and they are all drawn alike** (`Lobby.svelte`): 1v1, the bot, new
  table, join a table, in that order. **Hierarchy is a hue, never a smaller kind of control** — the
  bot's is the one neutral fill, and it used to be a line of underlined text under the queue's
  button, which between two ledged buttons reads as a footnote and gets pressed like one.
- **The count of connected players is drawn from two up and absent below it**
  (`components/playersOnline.ts`, `Lobby.svelte`, opposite the chip row, `position: absolute` so it
  reserves nothing, and **at the foot of the screen, centred, below 46rem**, where that row is full
  and the footer is behind the burger). **Never rounded, never padded,
  never reworded**: what is on screen is exactly the number the server sent, and the floor decides
  only whether the plate is there at all — a count of one is the "close the tab" sentence the
  searching screen is already forbidden from writing. It says *connected* / *online*, never
  *searching*: it counts connections, it is not the queue. `setPlayersOnline` stays out of `resetToHome` — the count belongs to the socket, not to
  the seat.
- **The lobby answers a nickname as it is typed** (`nicknameRules.ts`, shape rules only, word list
  stays server-side) and **disables "Take a seat" until the code is whole** (`tableCodeRules.ts`,
  which drops everything outside the alphabet as it is typed or pasted). Both decide nothing, and
  both render the same line the server's refusal resolves to.
- **Every entry point is greyed out until the field holds a nickname of a usable shape**, and
  **greying out may only ever answer shape**: the rules behind it are the loosest a seat label
  survives, because a disabled button is the one refusal a player cannot argue with. **A blocked term
  is not one of them** — the list is server-side by design, so that refusal arrives after the ask and
  is answered by handing the field back, focused with its contents selected.
- **Both mirrors are pinned to the Go source** (`src/test/serverMirrors.test.ts`): a mirror drifts
  most quietly by going *stricter* than the server.
- **A table is shared as a link** (`hooks/tableInvite.ts`): `/i/?t=CODE`, **carrying no language**,
  and **spent on arrival** by `initTableInvite` before the first render, which lands on `/`. A link
  naming another table clears a stale reclaim record; one naming the same table leaves it alone. **A
  link carries a table, never a player**: join on its own only when `nicknameMemory` has a usable
  name. **The parameter is only read on `/i/`**: `/?t=CODE` is what the button handed out before the
  invite page existed and now means nothing on the home page, where it is left in the URL like any
  other parameter nobody here put there.
- **`/i/` is a page of its own because a link preview is served HTML.** An unfurler runs no script,
  so a link on the home page can only preview as the home page; `/i/` is `noindex`, **absent from
  `PAGES` and filtered out of the sitemap** (which walks emitted pages, not the registry), and
  carries the invitation's own title, description and art (`seo/meta.ts`: `INVITE`, `INVITE_OG`).
  Everything else about it is the home page — same mount, same bundle, `GamePage` with
  `chrome={false}`. **The code stays a query parameter**: `/i/CODE` is not a page the build emitted,
  so it would need a fallback, and `astro dev` cannot be given one (Astro 7 routes ahead of the
  connect stack) — it would 404 under `make dev` and the whole Playwright suite.
  `src/test/invitePage.test.ts` pins all of it.
- **The lobby remembers the last nickname** (`nicknameMemory`, `localStorage`, on submit). A prefill
  that authenticates nothing, which is why it is not the `loco_session` record.
- **The searching screen times its own wait, and no copy of it may imply the queue is empty**
  (`searchStage`, three stages). Entered optimistically; `endSearch` is guarded on the screen. **A
  forfeit never renders as a victory.** Same top bar as every other screen.
- **Being found has to reach a player who is not looking**: the `matchFound` cue plus `tabAlert`,
  which **arms only while the tab is hidden** and never re-arms after a return (`tabAlert.test.ts`).
- **The game-over screen asks, it does not command.** Three states (ask / waiting / they asked
  first), every seat, every table; never render it as though pressing it started anything. Past two
  seats it carries the count. A table nobody is left at keeps the button **in place and disabled**.
  A matchmade table requeues instead, without being asked (`rematchRequeue.test.ts`). **Relaunching
  the search is one message**: `find_match` gives the seat up before it enqueues, so no `leave_room`
  goes ahead of it — its `left_room` would reset the store out from under the search screen. **The way
  out is the quietest control on the card**, under both offers, and it is an ordinary `leave_room`.
- **The three things are one line per seat, and that card's height is the table's size**
  (`GameOver.svelte`, `.emoteSlot`): a slot is drawn for every player whether or not that seat has
  said anything, `applyEmote` **replaces** what a seat was saying instead of adding to it, and the
  row marks the one that is ours. A feed that grew pushed the two offers and the way out down the
  card once per thing anybody said, under the thumb already aiming for them.
- **The evening's recap pins the two columns that answer it** (`GameOver.svelte`, `.recapName` and
  `.recapTotal` sticky): who, and matches taken. The match columns scroll between them, so a long
  evening never carries the conclusion off the right edge of a phone. Heads are `M%n`, the score
  table's convention — a word set over a two-digit column sizes the grid on the label, and four
  matches ran off a 360px screen that way. **The seat that took a match is a gold pill**, the colour
  the scoreboard above it wins in: LOCO Red on that panel measures 2.9:1, and a recoloured digit is
  not something a spectator picks out of a grid at 720p.
- `initLang()` first, then `initTheme()`, `initMotion()`, `initI18n()`, `initPinchGuard()`,
  `initTableInvite()`, `initSessionRestore()` in `entry.ts` before the first render, **in that
  order**. Each has a reason to be where it is, written next to it.
- **A document is never in two languages at once, and `/` translates itself rather than navigating.**
  The served markup carries the other language in `data-alt` / `data-alt-href` / `data-alt-aria` and
  `data-alt-title`; `langSwap.ts` exchanges them and moves the address bar with
  `history.replaceState`, **carrying the query string and the fragment** (a parameter belongs to
  whoever put it there). **The copy stays in the markup**: importing `content/ui.ts` or `seo/meta.ts`
  to rebuild the footer would ship the whole site's copy to every player. **A link left behind is the
  failure that matters** — a content page mounts nothing and cannot correct itself — so
  `homeLangSwap.test.ts` counts `href={` against `data-alt-href={`. **`data-served-lang` is never
  rewritten**: it says what the page was built as, and `detectLang` reads it.
- **A stored choice wins everywhere; the browser's language wins only on `/`.** That URL is where
  somebody lands without saying anything, and `/fr/` is somebody having asked — a French link opened
  by an English browser stays French. **A detection is never persisted**: storing it would make it a
  choice, and a choice outranks the URL for good. `chooseLang` in `lang.ts` is the one definition,
  and `detectLang` reads it against the DOM. **An invitation is not a language**, so `/i/` is served
  with no `data-served-lang`, is left where it is, and carries no served copy to swap.
- i18n: `en.ts` is the source of truth and its `Translations` interface types `fr.ts`.
- **The client is Svelte 5, and React is gone — do not bring it back.** No `react`, no `react-dom`,
  no `@astrojs/react`, no framer-motion, no `.tsx`, no `.module.css`. `src/test/noReact.test.ts` is
  the guard and it checks four things: the manifest, the Astro and ESLint configs, every import, and
  every file extension. The bridge that mounted Svelte inside a React tree left with the last
  wrapper. **What survived the crossing is the shape, not the framework**: the language
  (`i18n/store.ts`) and the game state (`hooks/store/createStore.ts`) are still framework-free
  stores read through `createSubscriber`, because that is what let them keep their value while the
  screens around them were rewritten — and it is still what a content page needs in order to import
  `lang.ts` without pulling a framework in behind it.
- **A component's props are ordinary props and its events are lowercase DOM names.** `onclick`, not
  `onClick`. Svelte **silently ignores a prop it does not know**, so a stale camelCase name is a
  handler that never fires and a test that renders fine and asserts nothing.
- **The store is ours** (`hooks/store/createStore.ts`, ~40 lines, Zustand's semantics to the letter,
  pinned by `storeCore.test.ts`). `deriveCatchMiddleware` reassigns `store.setState` while the
  creator runs, so the store must publish the property the creator mutated, never a copy.
- **A component's CSS lives in its own `<style>` block, and Svelte prunes selectors it cannot see in
  the markup.** A class applied at runtime by JS is bound with `class:`, never `classList.add`.
  **No `:global()` without a written justification** — silencing that compiler is the failure, not
  the fix. `reducedMotionCss.test.ts` and `csp.test.ts` scan `.svelte` for this reason.
- **`astro check` does not type-check `.svelte`**: `make build-client` is `astro check &&
  svelte-check && astro build`, and dropping the middle one leaves every component untyped under a
  green build. **TypeScript stays on 6.x** — `astro check`'s language server, `svelte-check@4` and
  `@astrojs/svelte@9` each refuse 7.x independently.
- **A `<script lang="ts">` keeps its imports after the types are stripped**, so a type imported as a
  value reaches the bundler and asks a types-only module for something to run. `src/types/protocol.ts`
  is exactly that module. **Every type import is an `import type`.**
- **Reading a piece of state inside the effect that writes it is a loop**, and Svelte will say so at
  runtime rather than at build. `untrack` is the way out and `GameBoard.svelte` is the example.

## Findability
Detail: [`docs/notes/seo.md`](docs/notes/seo.md).

- **A content page restates what the game already knows, so it is pinned to the source**: the rules
  page maps `t.rules` rather than copying it, and the deck table is checked against
  `server/game/deck.go` and `server/game/card.go` by `contentPages.test.ts`.
- **A content page ships no JavaScript except `theme-boot.ts`.** No `client:` directive, so
  `<LocoLogo />` and every `<Card />` on `/cards/` are static markup. Anything interactive is a
  **native control**: the home sheet is `<details>`, the language chooser a `[popover]`.
- **`content.css` is loaded by `GamePage.astro` too, so every selector in it is scoped to a class.**
  A bare `table`/`th`/`td` rule there styles the score table and the evening recap alongside the
  rules page, and `thead th`'s ink fill did exactly that: an ink band behind two sets of column
  heads whose labels were coloured `--color-muted` on the assumption they sat on their own panel,
  at 2.2:1 in both themes. Every table on a content page is inside `.tableWrap`, so the scope costs
  the pages nothing; `contentPages.test.ts` fails on a bare element selector.
- **One `--shell`, one bar, no backdrop.** Header, column and footer share one width. The navigation
  is a **fixed footer bar**, the same five links in the same order as the home page's row. `body.doc`
  is flat canvas, `background-attachment: fixed` is gone, and text selection is put back.
- **The header is sticky and the bar is fixed, so both ways out are always on screen.**
- **Every in-page jump glides**, anchors and "back to top" alike: `scroll-behavior: smooth` behind
  `html[data-scroll="smooth"]`, which `theme-boot.ts` writes from the system preference — a media
  query is refused here and `data-motion` is the game's. **Anything that focuses an element after a
  smooth scroll passes `preventScroll: true`**, or the scroll-into-view cancels the animation before
  its first frame.
- **Under 46rem the bar is gone and one burger is the whole navigation**, on the content pages *and*
  on `/`, styled once in `content.css`. **Only the list differs** (the game's carries no `Play`); a
  `.navPop*` rule in `GamePage.astro` is a divergence by definition. Both drawers open on the
  wordmark and carry exactly one action (`.navPopCta`). **Read the note before touching any of it**:
  the drawer, the language popover and the sticky header have six documented failure modes between
  them, five of which fail silently and none of which a test reading the source can see.
- **The language chooser's two links are real `<a href>`s** with `hreflang`/`lang`, in the document
  open or shut, and the panel keeps its ✕ — the only dismissal a phone has.
- **The dark palette is in `tokens.css` twice, and that is the point**: `[data-theme]` for the choice,
  `@media (prefers-color-scheme: dark)` on `:root:not([data-theme='light'])` for the first frame.
  `themeFlash.test.ts` compares them declaration by declaration.
- **The content pages' theme switch is `theme-boot.ts` wiring one button**, `hidden` until that
  script reveals it, writing the same `loco_theme` key `src/theme.ts` reads — one definition of the
  theme for the app and for a page that mounts nothing.
- **`/` serves its own `<h1>`, in text, and it is never the wordmark**, and it stays the only one:
  app screens head themselves at `<h2>`, and `seo.test.ts` fails on an `<h1>` under `src/components/`.
- **A title is ≤ 60 characters and a description is 100-155**, both languages, pinned by
  `seo.test.ts`. French is **written to** the ceiling, not translated into it.
- **Structured data never asks a validator for something that does not exist**: free is
  `isAccessibleForFree` never an `Offer`, a content page is a `WebPage` never an `Article`. What
  renders is the breadcrumb and the FAQ's `FAQPage`; every node joins the one `#website` and `#game`.
- **`src/seo/meta.ts` is the single source**: one entry per page, path + title + description per
  language, read by the sitemap, the `hreflang` sets, the canonical and `seo.test.ts`. **A declared
  path with no source file behind it is a failure.**
- **The home page is exactly one viewport and never scrolls.** The indexable markup is a quiet footer
  row plus the prose in a **native `<details>` sheet** that must keep opening with **scripts
  disabled**. **A board that can be scrolled off-screen mid-match is a bug**, and so is a lobby that
  hides text under the fold. The footer vanishes on `data-seated`: it is markup Astro rendered, so it
  is never the app's to unmount and never a modal of ours.
- **Open, that sheet is `RulesModal` down to the measurements**, and the three things that let a
  native disclosure wear them are in the note: the card **is** the `<details>`, the `<summary>` is the
  footer button (`order`), the scrim is a **sibling** of the card, and the ✕ ships `hidden` for
  `homeSheet.ts` to reveal. `contentPages.test.ts` reads the card off `RulesModal.svelte`.
- **The FAQ is the `FAQPage` payload, rendered** from `src/content/faq.ts`. Its answers describe real
  server behaviour, so a change to those changes this file.
- **English at `/`, French under `/fr/`, every path slash-terminated.** Never redirect from the
  unslashed form: `/nope` has no directory either, so it loops forever. The canonical resolves it.
- **A French URL opens in French**, via `data-served-lang` on `<html>` — never `<html lang>`, which
  the i18n provider writes, so reading it makes the app detect its own last output.
- **The origin is decided at build time** (`VITE_PUBLIC_ORIGIN` → `site` + `ORIGIN`), passed as a
  Docker `ARG` by `.gitlab-ci.yml`. Crawlers do not run JS and never fetch a relative `og:image`.
- **Production is `ohloco.com`, dev is `loco-d.kisukesaama.com`, each declared once** (`PROD_HOST` /
  `DEV_HOST` in `.gitlab-ci.yml`). **`APP_SUBDOMAIN` names the stack, not the address** — compose
  project, Traefik router, network, deploy directory — so never derive one from the other. **The dev
  host keeps its `-d.` prefix**: `nginx.conf` keys `robots.txt` on that pattern and it is all that
  keeps dev out of the index.
- **The apex is canonical and `www.` only 301s to it, at the edge.** So `ORIGIN` carries no `www.`
  (`seo.test.ts`) and `compose.yml` carries one `Host()`. A canonical naming a redirect is reported
  as invalid by Google and looks fine to every human, because both URLs load.
- **nginx answers a missing page with a real 404**, never with the game. `robots.txt` advertises the
  sitemap on production hosts and nothing at all on `-d.`.
- `make og` and `make icons` **commit their output**: CI has no browser.
- **The viewport may never forbid zooming** (no `user-scalable=no`, no `maximum-scale`; the
  double-tap is answered by `touch-action: manipulation` on `body`). **The seat is what costs the
  pinch, never the tag**: under `[data-seated]` the reset drops to `touch-action: pan-x pan-y` and
  `pinchGuard.ts` refuses WebKit's `gesturestart` — a board already scaled to the viewport is only
  ever zoomed by accident, and everything a visitor *reads* (`/`, the prose sheet, every content
  page) keeps the gesture. Safari has ignored `user-scalable=no` since iOS 10, so the tag would have
  cost the audit and fixed nothing. **White on LOCO Red is 3.43:1**,
  so anything wearing it is 1.2rem or larger, never darkened. **A box that scrolls sideways takes
  `tabindex="0"`** and a `:focus-visible` ring. All four pinned by `client/src/test/a11y.test.ts`.
- **Two things keep a page fast**: `build.inlineStylesheets: 'always'` (`style-src` allows
  `'unsafe-inline'`, **scripts still may not**) and the tables page's art through `<Image />`.
- **Never fade in the element the browser measures the LCP against.** Chrome takes its candidate at
  the first paint and skips anything at `opacity: 0`, so a screen fading up from zero can produce
  **no candidate at all** — `NO_LCP`, which scores performance **0**. Fade a veil off the top instead.
- **A content page is a player-facing surface, so it never says UNO either** (`seo.test.ts` extends
  `legal.test.ts`'s guard over `PAGES`, `UI` and every `src/content/**` file).

## Visual
Detail: [`docs/notes/visual.md`](docs/notes/visual.md). Spec: `DESIGN.md`.

Art direction is **cartoon premium** (Nintendo x Gartic Phone). Three rules the whole UI obeys,
stated at the top of `styles/tokens.css`:
1. Every raised object has an ink outline **and** a hard bottom shadow. Soft blurs are ambience,
   never structure.
2. Nothing is pure white on pure white. The board always sits on colour.
3. Type is display-weight and large: a spectator reads it at 720p.

- **`tableRect()` is the single authority on board geometry**, and `seatLayout()` on seating. Maps
  change how the felt is *painted*, never where anything is. Three callers must agree exactly.
- **The board is a fixed coordinate space scaled by `<div .stage>`.** Fix scale problems in
  `boardScale`/`boardSpace`, never by bumping `CARD_W` or `SEAT_DIMS`. `boardSpace` takes the
  safe-area insets, so the coordinate space stops short of the notch and the home indicator while the
  element still runs edge to edge.
- **Animate transforms, never `left`/`top`.** A node's transform has exactly one owner. Layout math is
  radians, CSS `rotate()` is degrees (`radToDeg` at the render boundary, and nowhere else). Hand keys
  come from `handCardKeys(hand)`, never the index.
- **The wordmark is a logotype, and the markup has to say so.** `<LocoLogo />` carries `role="img"`
  and `aria-label="LOCO"` with the word `aria-hidden`. **In dark the word carries no stroke and a
  `::before` paints the outline over it**, declared twice like the dark palette; in light the stroke
  stays where it is 14.7:1. `a11y.test.ts` fails on a stroke returning to the dark word.
- **The card face does not follow the theme.** A card is a physical object. `LOCO_MARK_PATH` comes
  straight from the designer's source file: do not redraw, retrace or tidy it.
- **On a card the mark is a mask, never a `<path>`.** One shared mask image (`MARK_MASK_URL`,
  `MARK_MASK_BOLD_URL`), so the browser rasterises that geometry once and all ~50 faces composite the
  same bitmap. `card.test.ts` fails on a live path and on a second mask URL. Same rule for any new
  card art: one cached image, not geometry per instance.
- **The top-right chip row is absolute, so it reserves nothing**: a screen whose content can overflow
  clears it with `--space-base + --topbar-h + --space-sm + --safe-top` of top padding, never a
  spacing step that merely looks generous. `safe center` parks overflowing content against that
  padding, and 32px put the waiting room's heading under the gear.
- **Motion must degrade to a readable static state**, not to nothing: `.armed` becomes a static halo,
  a countdown bar keeps draining under reduced motion.
- **The theme crosses, it does not cut, and one mechanism does it for the game and the pages alike**:
  `setTheme` arms `data-theme-anim` on `<html>` for `THEME_FADE_MS` / `--theme-fade`, and the rule
  behind it transitions **colour only**, over the whole document, for exactly that long. The boot
  never arms it, the attribute must come back off, and reduced motion wins by specificity rather than
  by a branch in the script (`themeTransition.test.ts`).
- **The action bar never reflows, and it never empties either.** Fixed three-column grid, **Catch
  mounted in the centre column all match and nothing else ever in it**, enabled and armed in place. A
  reaction game cannot move its buttons mid-match. **All three columns hold their button the whole
  match and go dead rather than away**: draw and pass used to be rendered only on our turn, which
  left one lone pill in a wide trough and pinched the bar's outline to a point at each end of it —
  little teeth that came and went with the turn. The penalty draw is the one recolour left, and it is
  ours only. Three states: dead, pressable from three cards out and until every seat on one
  card has called it (`components/catchAvailability.ts`), armed while a seat owes the call. **LOCO! is a small chip
  centred above the bar**, out of the grid so it moves no column, **on screen the whole match** and
  dead unless we hold one uncalled card. Never a fourth column, never something that appears: a
  control found only in the two seconds it is worth pressing is a control nobody has ever aimed at.
  **`BOTTOM_RESERVE` covers the chip's band as well as the bar**, so the hand is dealt clear of it
  permanently and nothing shifts when it lights up. Drawn under 44px and quiet on purpose — forgetting
  the call is a turn of the game — so its target comes from `.hit-target`, only while it is live.
- **Add a scene to `src/dev/scenes.ts` in the same change set as any new screen or visual state**, and
  review with `make visual` (`--viewports=wide,small` after touching `layout.ts`, `notch` for safe
  areas, `--scenes=card-sheet` for anything on a card).

## Audio
Detail: [`docs/notes/audio.md`](docs/notes/audio.md).

- Everything is synthesised at runtime. **No audio files ship with the client.**
- **The board plays nothing; one subscription does.** `gameAudio()` in `hooks/appEffects.svelte.ts`
  is the only place a game sound is played, and what to play is decided by `soundsForTransition` in
  `audio/gameSounds.ts` — pure, snapshot-diffing and unit-tested. A component calling `playSfx`
  directly is only ever a UI tap (`uiTap`, `uiBack`), never a game event.
- **Mobile Safari loses the context three ways and all three fail as silence, not as an error**:
  `unlock()` resumes any state that is not `running`, it is `async` and callers must await it, and
  `visibilitychange`/`focus` reclaim the context. `navigator.audioSession.type = 'playback'` at
  creation.
- A track is **parts plus a form** (`audio/tracks/`), not a loop with layers. Add one by writing a
  `TrackDef` and listing it in the registry. The bass stays soft.
- Playback is a **shuffled playlist**, not a selection: no picker, one "next" button.
- `make audio-verify` is the only thing that catches a broken envelope or a mis-wired node, because
  those produce silence rather than an error. Run it after touching `sfx.ts`, `music.ts` or
  `engine.ts`. Deliberately outside CI.

## Legal and privacy
Detail: [`docs/notes/legal.md`](docs/notes/legal.md).

- **Collecting nothing is the compliance strategy.** No account, no cookie, no analytics, no tracker,
  no third-party request, nothing persisted but a match in flight across a deploy. **Anything that
  would break that is a legal change, not a technical one**: the first measurement cookie makes a
  consent banner mandatory and rewrites the policy.
- **No address is ever written in full.** `hub.truncateAddr` / `Client.netPrefix` and the `anonymised`
  `log_format` in `client/nginx.conf` cut every address to `/24` or `/48` **at the point of writing**.
  Log lines are correlated by `conn=`. **Never log `RemoteAddr()` directly**; `legal.test.ts` fails
  on any non-test file in `server/hub/` that does.
- **Privacy, terms and credits are a page, not a modal** (`/privacy/`, `/fr/confidentialite/`), linked
  from every footer, without typing a name. The copy is `src/content/legal.ts`, typed
  `Record<Lang, LegalDoc[]>` so a document cannot exist in one language only, read at build time and
  shipped in **no bundle**.
- **A line in that copy is a disclosure before it is prose.** `legal.test.ts` pins the legal basis,
  the retention period, the rights list, the CNIL, the EU statement, the storage disclosure, the
  no-banner explanation, the Mattel disclaimer and the governing law. Reword freely; keep it passing.
- **The game never says UNO to a player.** The documentation does, and the disclaimer names the mark
  in order to disclaim it; every other player-facing string in both languages is asserted clear of it.
  The whole trademark position rests on that.
- Fonts are OFL and self-hosted, so the licence ships with them as `client/public/licenses.txt`.
- **Publisher identity, host and contact address are deliberately absent.** An editorial decision,
  already taken: do not add them back and do not reopen it.

## Testing, CI and environments
Detail: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- **Every E2E test is self-contained**: no `beforeAll`, no `describe.serial`, no state carried between
  tests. That is what lets CI shard per test (`fullyParallel: true`).
- **The 1v1 queue is the one server-global the suite contends on**, so `matchmaking.spec.ts` claims
  it (`helpers/matchmakingQueue.ts`: a cross-process mutex, plus a wait on `/metrics` for
  `matchmaking_queue == 0`, plus a borrowed timeout so queuing does not spend the test's budget).
  A lock on a shared resource, not shared state. **Anything else added to that queue takes it too.**
- **A fixture must state everything the assertion rests on.** `debug_set_state` sets only what it is
  given: pin `direction`, `pendingDraw: 0`, `currentTurn`, and the *colour* of a coloured card.
- The **interrupt window is only armed by a real play**, so a successful-interrupt test must have
  somebody actually play first; keep bots out of that scenario.
- Prefer `waitForFunction` on store state over DOM polling. Use `startTurnRecorder()` whenever a bot
  seat is involved. `waitForTableOpen` on every secondary page in a multi-client test.
- **Update E2E in the same commit as gameplay/UI/protocol changes.**
- **`.gitlab-ci.yml` is the only CI definition**; the `gh` remote is a plain mirror. `build` must
  `needs` every test job, lint and E2E included, or red still ships.
- **Nothing may use `artifacts:`** until the runner is fixed: the upload fails and fails the job.
  `server-bin` travels by cache, keyed per branch with a `server-bin.sha` stamp.
- `PLAYWRIGHT_VERSION` and `e2e/package.json` are one decision: the dependency is pinned exactly and
  asserted against the image before the suite runs. There is no `playwright install` step.
- Run `make csp` after touching `nginx.conf` **or bumping a dependency**.

## Docker
Production path: Traefik to nginx (:80) to Go (:8080, internal only); **nginx proxies `/ws` and
nothing else** — `/health` and `/metrics` are operator surfaces and are deliberately unreachable from
the internet — serves the SPA, and sends CSP / `nosniff` / `Referrer-Policy` / `Permissions-Policy` /
`Strict-Transport-Security` on every response. **HSTS carries neither `includeSubDomains` nor
`preload`**: both are promises about names this repository does not serve and cannot withdraw once a
browser has cached them.

**The socket has a second hostname**, `ws.*`, DNS-only and outside the CDN, answered by the same
nginx with `ws-proxy.conf` and a 404 for everything else. Why, and what it costs operationally, is in
[`docs/deployment.md`](docs/deployment.md).

**Those five live in `client/security-headers.conf`, and every `location` block that declares an
`add_header` of its own must `include` it** — in `nginx.conf` *and* in `client/ws-proxy.conf`, which
`csp.test.ts` scans beside it. nginx inherits `add_header` only into a level that
declares none, so one `Cache-Control` in a block silently strips all five from everything that block
serves — which is how the whole `/_astro/` bundle shipped bare while the document response, the only
one `make csp` looked at, reported clean. `csp.test.ts` fails on a block that declares without
including.

**Run `docker run` through `make` or PowerShell, never raw from Git Bash on Windows.** MSYS rewrites
`-v src:/app` into `src;C:/Program Files/Git/app`; the `-w` errors out but the mount has already made
an empty `server;C` directory at the repo root that `git status` cannot see. `MSYS_NO_PATHCONV=1` if
Bash is unavoidable.

---

## Starting a session
Read this file, then `README.md`, then **the note in `docs/notes/` for the subsystem you are about to
touch** — this file states the rules, not the reasons, and changing a rule you only half understand
is how they get undone. Look for doc drift as you go: it is silent, and the pass of 2026-08-02 found
five passages describing code that no longer existed.

Never let `CLAUDE.md`, `README.md` or `docs/notes/` go stale.

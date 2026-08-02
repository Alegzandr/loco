# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mission
Premium real-time multiplayer UNO-style card game **built to be streamed**. Goals: low-latency
multiplayer, nickname-only access, server-authoritative anti-cheat, polished visuals *and* audio,
strong test coverage (TDD), docs in sync, Dockerized.

Streamability is a product requirement, not decoration: every state must be readable at 720p by a
viewer who is not playing, and the game's big moments (interception, LOCO!, victory) must be legible
in a clipped highlight with the sound muted.

## Non-negotiables
- No login/signup/OAuth: nickname only.
- Server authority is mandatory; never trust the client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.
- `README.md` and `CLAUDE.md` must stay in sync with the codebase.

## Where the detail lives
This file carries the **rules**. `docs/notes/` carries the **reasoning**: the bug behind each rule,
the alternatives measured and rejected, and the edge cases a one-line rule cannot express. Read the
matching note before working on a subsystem; do not restate its contents here.

| Note | Covers |
| --- | --- |
| [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md) | `server/game/`: deck, scoring, draw stacks, LOCO!/catch windows, interrupts, rematch, lobby |
| [`docs/notes/server.md`](docs/notes/server.md) | `server/hub/`: anti-cheat, bots, sessions, rate limiting, map-loading gate, metrics, logging |
| [`docs/notes/client.md`](docs/notes/client.md) | realtime path, transport, session restore, protocol validation, i18n |
| [`docs/notes/visual.md`](docs/notes/visual.md) | art direction, board geometry, seats, maps, card face, motion, streamable moments |
| [`docs/notes/audio.md`](docs/notes/audio.md) | synthesis engine, track format, arrangement ladder |
| [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md) | Playwright, GitLab pipeline, linting, Docker stacks |
| [`docs/notes/seo.md`](docs/notes/seo.md) | indexable pages, the page registry, hreflang, robots/sitemap/404, build-time origin |
| [`docs/notes/legal.md`](docs/notes/legal.md) | what is processed and why, the no-banner position, address truncation, the trademark line, what is still open |

Also: `docs/rules.md` is the authoritative game spec, `DESIGN.md` the written design system,
`docs/protocol.md`, `docs/features.md`, `docs/deployment.md`.

## Commands
`make help` lists every target. They are docker-first so a host Go install is not required; the
client and E2E targets do need Node.

| Task | Command |
| --- | --- |
| Dev stack, hot reload | `make dev` (client :5173, server :8080) then `make down` |
| All unit tests | `make test` (server + client) |
| Go tests | `make test-server`, or `cd server && go test ./...` |
| One Go test | `cd server && go test ./game/ -run TestRoom_ResetForRematch -v` |
| Client tests | `make test-client`, watch mode `cd client && npm run test:watch` |
| One client file / case | `cd client && npx vitest run src/test/matchmaking.test.tsx -t "<title substring>"` |
| Full E2E | `make test-e2e` (needs the Go server on :8080; Playwright boots its own Vite on :4173) |
| One E2E file / case | `cd e2e && npx playwright test tests/matchmaking.spec.ts -g "<title substring>"` |
| Lint | `make lint` (golangci-lint in docker + ESLint) |
| Type-check | `make build-client` (`astro check && astro build`); there is no separate typecheck script |
| Visual review | `make visual ARGS="--scenes=... --viewports=wide,small,notch"` |
| Deliberately outside CI | `make audio-verify`, `make csp`, `make og`, `make icons`, `make maps ARGS="--src=<folder>"` |

## Workflow loop
1. Understand behavior. 2. Tests first (non-trivial). 3. Smallest correct change. 4. Run tests.
5. Update `README.md` if setup/commands/architecture/features/limits/env/dev/test changed.
6. Update `CLAUDE.md` **and the matching note** if workflow/architecture/conventions/testing/DoD/
   structure changed.

Done = code + tests + passing + docs + Docker still works + behavior matches docs.

## Engineering priorities (in order)
latency, server correctness, UX smoothness, determinism, maintainability, testability, local DX.

## Architecture
**Server owns**: room/player/hand/deck/discard state, turn order, legality, timing windows, counter
resolution, penalties, winner.
**Client owns**: presentation, input, rendering, animation, sending intents.

Realtime: persistent low-latency bidirectional transport, event-driven state, server resolves
simultaneous/reaction interactions, explicit testable timing windows, deterministic resolution.
Client visuals may be optimistic; server is final.

A refusal that can only mean the client's state has drifted carries the correction with it: the
server answers it with a fresh personalised snapshot (`hub.refuseAction` + `game.IsStateMismatch`),
never with "no" alone. Otherwise the client keeps offering an action only the server knows is
illegal. Lost races are excluded on purpose. See `docs/notes/server.md`.

Reconnect: 60s slot hold; rejoin via nickname + room_code + session_token restores the slot with a
full snapshot. The identity is mirrored into `sessionStorage`, so a **page reload** reclaims the seat
too, not only a dropped socket.

Fairness: server timestamps received events, defines the window, deterministic documented tie-breaks.

## Style
Small cohesive modules, explicit domain types, pure domain logic, side effects at boundaries, strong
validation on incoming messages, concise comments only when useful.

## Testing
TDD. Tests-first for non-trivial behavior. Deterministic clocks for timing logic. Integration-test
critical multiplayer flows. Maintain the Playwright E2E suite as a living regression.

**An untested path is where the bugs are, and the doc is not a substitute for one.** Two critical
bugs (`DrawCard` mutating state before an all-or-nothing draw; `applyCardPlayed` removing one card
where the server removed N) both sat in the only paths with no test at all, and this file described
both as already fixed, one of them naming a function that did not exist. A third case was caught on
2026-08-01: a documented card-foil system (`.foil`, `.glint`, `holoOffsetMs`) that exists nowhere in
the code. **When this file states an invariant, there must be a test that fails without it.**

Beware assertions that only restate the fixture. An E2E test once sent an interrupt, then asserted
the discard and turn that `debug_set_state` had itself just configured: it passed for months while
the server rejected every interrupt with "interrupt window closed".

Required coverage: room create/join, nickname entry **and its validation** (the shapes refused, the
disguises the normalisation is supposed to see through, and the legitimate names that must keep
playing — a filter is only as good as its false-positive list), game start, turn progression, legal/illegal
moves, skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter/catch
windows, simultaneous resolution, reconnect (60s, nickname + room_code) **and session restore across a
page reload**, rematch (the ask **everybody** at the table has to make, one ask dealing nothing, a
departure retiring an ask and completing what is left of the agreement, seat pruning, re-indexing),
protocol validation/rejection, the table link (what the code's button copies, the code coming off the
address bar, the arrival a remembered name seats and the one that is asked for a name first), seat
layout at every table size and viewport, state-to-sound mapping, the host freeing a seat (the refusals,
the re-based roster, the bot's row, and the line the removed player is left holding), score table, matchmaking (pairing,
cancel, disconnect-out-of-queue, the host controls a matchmade room refuses, the requeue an
opponent's departure triggers, and every forfeit path: quit, disconnect and AFK), link-preview tags vs the
committed `og.png`, map draw + the loading gate and `tableImageRect` at every board size, batch play
and batch interrupt (unit *and* E2E), a draw against exhausted piles, `Origin` checking, the legal
disclosures and the truncation of every logged address, bots
interjecting, the hardening in `server/hub/hardening_test.go` (a gameplay message at a table that
has not dealt, a handler that panics on demand, every ceiling, the wrong-code budget **and** the
mistyped code that must still get in, the reclaim refusal that names nothing, the reclaim that
rotates its token), and the graceful shutdown: what a drain refuses, what it leaves alone, and a full
restart where a match is snapshotted, reloaded by a fresh hub and reclaimed by both players with
their original tokens. That last one has **no E2E counterpart on purpose**, because the Playwright
suite cannot restart the server underneath itself; the integration tests in `server/hub/` are the
coverage, and that is why they go through real sockets rather than the marshalling alone.

Review layout/colour/motion changes with `make visual`: reading four contact sheets catches what no
assertion was going to describe. Assertions own behaviour; screenshots own appearance.

Keep tests fast, targeted, non-brittle. Cover game rules over UI details.

## Repository structure
- `client/` Astro site + React game. `astro.config.mjs` (integrations, dev server, dev toolbar off,
  the React fast-refresh preamble); no `vite.config.ts`, no `index.html`, no `main.tsx`
  - `src/pages/` one `.astro` file per URL  ·  `src/layouts/` `Base.astro` (the shared `<head>`),
    `GamePage.astro` (the game at `/` and `/fr/`), `ContentPage.astro` (header, column, footer)
  - `src/entry.tsx` mounts React into `#root` through a bundled module script, **never an island**
  - `src/homeSheet.ts` Esc + scrim-click on the home page's `<details>` sheet, and the mobile
    drawer's close-on-widen, same bundling rule
  - `src/theme.ts` the theme, free of React, so a content page can apply it without mounting one
  - `src/lang.ts` the language, same rule and same reason: the storage key, the two home paths, and
    the boot-time redirect that keeps a document from being in two languages at once
  - `src/seo/meta.ts` the page registry plus the link-preview tags, as data rather than markup
  - `src/content/` the prose and data behind the content pages, plus `content.css`, `legal.ts` (the
    three legal documents), `HomeProse.astro` (what `/` says about the game, rendered by both the
    sheet and the mobile drawer), `navMenu.ts` (the drawer's close-on-widen, imported by the two
    page scripts) and `theme-boot.ts` (the pages' one script: the theme, the back-to-top button and
    that drawer call). **Never imported by the app**: it would grow the bundle every player downloads
  - `src/components/` UI screens + shared (RulesModal, Preferences + LanguageSwitcher, TableCode,
    AudioSettings, InterruptBanner, CatchBanner, Confetti, MapLoadingScreen, Reconnecting, ServerUpdating,
    `nicknameRules.ts` (the shape half of nickname validation, mirrored from the server),
    `tableCodeRules.ts` (the table code's alphabet and length, mirrored from the server),
    ScoreTable + `scoreTableModel.ts`, `playerColors.ts`, `LocoLogo.tsx`, and the 1v1 queue's three:
    `Searching.tsx`, `MatchFound.tsx`, `OpponentAway.tsx`)
  - `src/components/cards/` React + Framer Motion card renderer (GameBoard, Hand, Card, CardBack,
    Deck, DiscardPile, PlayerSlot, TurnIndicator, DirectionRing, AnimationLayer; `layout.ts` pure
    pixel math, `CardArt.tsx` + `cardArtSpace.ts` + `locoMark.ts` the card face, `maps.ts` the four
    rooms, `cardTheme.ts` shared constants)
  - `src/audio/` `engine.ts`, `sfx.ts`, `music.ts` (the bed engine), `tracks/` (the music as data),
    `useGameAudio.ts` (store-to-sound bridge)
  - `src/dev/` dev-only visual showcase (`scenes.ts` registry + `Showcase.tsx` + `CardSheet.tsx` +
    `OgCard.tsx`), tree-shaken from prod
  - `public/` `favicon.svg`, `apple-touch-icon.png`, `og.png`, `maps/<id>/{room,table}.webp`,
    `licenses.txt` (the OFL notice travelling with the self-hosted fonts)
  - `src/styles/tokens.css` design tokens, single source of truth for colour/type/shape/motion
  - `src/i18n/` i18n context, en/fr translations, `serverErrors.ts`
  - `src/hooks/` WebSocket + Zustand store + `useElementSize` + `useSafeAreaInsets` + `useTheme` +
    `useStreamerMode` + `useHeldKey` + `useDrainBar` + `useMapPreload` + `useCountdown` + `useReconnectAnimation` +
    `sessionPersistence` + `useSessionRestore` + `nicknameMemory` + `tableInvite` + `useTabAlert`
  - `src/types/` protocol types  ·  `src/test/` Vitest unit tests
- `server/` authoritative game server
  - `game/` pure domain (room, deck, hand, rules, bot, maps, event log, `nickname.go` +
    `wordlists/` the vendored LDNOOBW lists)
  - `hub/` WS connection mgmt, rate limiting, session tokens, bot scheduling, map-loading gate,
    `matchmaking.go` (the 1v1 queue, the pairing, the rematch-by-agreement and the forfeit path),
    `drain.go` + `snapshot.go` (the graceful shutdown: finish what is running, carry across the rest),
    `privacy.go` (address truncation, the only thing allowed to read a remote address)
  - `protocol/` wire types
- `e2e/` Playwright suite: `tests/` (game-flow, multi-client, mobile, penalties, round-progression,
  reconnect, rematch, rules-coverage, special-cards, batch-play, score-table, matchmaking,
  invite-link),
  `helpers/game.ts`,
  `types.d.ts`, `playwright.config.ts`
- `tools/` `lib/devserver.mjs` (shared dev-server boot), `visual/shoot.mjs`, `og/shoot.mjs`,
  `maps/prepare.mjs`, `audio/verify.mjs`, `csp/check.mjs`
- `shared/` protocol/types  ·  `docs/` spec + `docs/notes/` engineering notes
- `LICENSE` (MIT)  ·  `NOTICE.md` (trademark position + third-party licences)
- `.gitlab-ci.yml` the only CI definition  ·  root config / Docker / env

Update this section when structure changes.

---

# Rules by subsystem

## Game domain
Detail: [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md). Spec: `docs/rules.md`.

**LOCO deviations from SOLO** (`docs/rules.md` §14):
1. **GlobalSwitch is wild**: 4 copies, no colour, plays on anything, names the new active colour.
2. **The starting card is always a Number**: `dealRound` skips action/wild cards.
3. **Best-of-N match format** (BO1/3/5/7), not a 600-point threshold.
4. **Voluntary draw is allowed**, still one draw per turn.
5. **A forced draw does not cost the turn.** The victim takes the stack and then plays or passes.
   `hub.handleDrawCard` re-arms the turn timer on every draw.
6. **A missed Contre-LOCO! costs the caller 1 card** (`failedCatchPenalty`,
   `Room.PenalizeFailedCatch`).

**Deck**: 112 cards, 8-card opening hands, opening discard must be a Number. **Swap is coloured** and
follows ordinary matching; the three wilds are Wild, WildDrawFour, GlobalSwitch. **Every wild must
name a real colour**, GlobalSwitch included, and every entry point rejects a colourless one.
`Wild` must never reach `State.ActiveColor`.

**A draw never fails.** `DrawCard` validates first, draws through `DrawUpTo`, and only *then* clears
`PendingDraw` and sets `HasDrawn`: nothing above that line touches state, nothing below it can fail.
Against exhausted piles the draw shrinks rather than erroring, and the seat keeps its turn.
`Deck.DrawN` survives for dealing only.

**Answering a draw stack is `counter_draw`, never `play_card`.** `PlayCard` refuses every card while
`PendingDraw > 0`. A counter is the **same kind and the same colour**.

**LOCO! tracking is per seat** (`LastCardDeclared []bool` + `LastCardAt []time.Time`). Receiving your
last card owes a declaration exactly like playing down to it, so a Swap or GlobalSwitch opens catch
windows on every seat left at one card. A declaration is a one-shot.

**Interrupts have no deadline and exclude nobody.** Anyone may play N identical cards matching the
top discard, wilds included; the player who just played and the current player may both take the lead
back. Effects stack. Removing those freedoms is what would make the mechanic turn-based: do not
reinstate them.

**Scoring**: single-finisher round, `CardValue` per `docs/rules.md` §10, cumulative `Room.Scores`,
tiebreakers score then rounds won then lost-hand total then sudden death.

## Server
Detail: [`docs/notes/server.md`](docs/notes/server.md).

- **Validate every message**; reject illegal or out-of-turn; hidden state stays server-side; ignore
  client timestamps for outcomes; crypto-random session tokens; per-client token bucket (10 msg/s,
  burst 20) with **one notice per burst**.
- **One message must never be able to cost the server.** Every inbound message is handled on one
  goroutine, so `hub.dispatch` opens with a `recover` (one `WARN` with the stack, one `server error`
  to the sender, `handler_panics` on `/metrics`) **and** with a gate refusing every `isGameplayMsg`
  at a table whose `Status` is not `StatusPlaying` or whose `State` is nil. Both come from one bug:
  `handleDrawCard` and `handleCatchUno` sized a hand before checking the status, and `room.State` is
  nil in a lobby, so `create_room` then `draw_card` segfaulted the whole process, every match on it,
  the drain and the snapshot. The gate closes the class rather than those two handlers; the recover
  bounds whatever it does not anticipate. **Neither excuses a missing bounds check** (see
  `playerGameStateUsing`), and `handler_panics` above zero is a bug by definition.
- **Nothing is unbounded.** `MaxClients` (5000) and `MaxConnsPerNet` (64, keyed by the same
  truncated prefix the logs use) are refused in `ServeWS` **before the upgrade**, with a 429 and
  against `admitConn`'s own counter, never `statClients`: the window between the upgrade and the
  register is where a flood lives. `MaxRooms` (2000) is refused in `handleCreateRoom`, because that
  is the message allocating something that outlives its socket by `EmptyRoomTimeout`. All are
  exported vars, deliberately generous, and **reaching one in production is a signal to read the
  logs, not a number to lower**.
- **A wrong table code costs something.** `MaxFailedJoins` (20) per network per minute, refused
  before the lookup so a throttled sweep learns nothing from the answer either. Keyed by network,
  not by socket: a socket is free, and a per-connection counter would have measured a sweeper's
  patience. A player who mistypes theirs once is nowhere near it, and a test says so.
- **A refusal must not name the roster.** `join_room` at a table in progress answers `game already
  in progress` whether the nickname is seated there or not: the old pair of strings let anyone with
  a code test names against the table. Session tokens are compared with
  `subtle.ConstantTimeCompare`, and **a reclaim spends its token and is issued a fresh one**, since
  the old one has been on a dead socket, in `sessionStorage`, and possibly in a snapshot on disk.
- **The upgrade checks `Origin`** (`hub.originAllowed`). Default: hostnames must match, ports need
  not. `LOCO_ALLOWED_ORIGINS` overrides with an exact allowlist. A missing `Origin` is allowed.
- **A socket holds one seat for its lifetime.** `create_room` and `join_room` both refuse a client
  that is already seated (`hub.alreadySeated`). A seat lives in two places (`c.playerID` and the
  `*Client` pointer at that index in `roomMembers`) and re-entering moved only the first, leaving
  the pointer behind at the old index while personalised broadcasts were built from the new one:
  a player who rebound to seat 0 elsewhere was handed seat 0's **hand** in the room they had left.
  Reconnects are unaffected; they arrive on a fresh socket.
- **Personalised sends index by slot, never by `member.playerID`.** The slot is where the room filed
  the client; `playerID` is what the client's own record claims. Anything that builds a hand
  (`broadcastPersonalizedGameState`, the per-recipient `game_started`) reads the former.
- **Room codes and session tokens both come from `crypto/rand`** (`randIndex`,
  `generateSessionToken`), and neither has a `math/rand` fallback. The code is the only thing
  guarding a private lobby and the token the only proof behind a seat reclaim; a predictable
  sequence on either is the whole control. `math/rand` is for bot jitter and nothing else.
- **The nickname is validated in the domain, and refused with one string.**
  `game.ValidateNickname` (called by `hub.validateNickname` on `create_room`, `join_room` and
  `find_match`) owns length **in runes**, an allowlist charset (Latin/Greek/Cyrillic letters, digits,
  one space, `-_.'`, at most one combining mark per letter), and the blocked-term check. Length,
  charset and blocked term all wrap `ErrNicknameRejected` and reach the player as
  `nickname not allowed`: **never tell them which rule fired**, or the next attempt is the same
  nickname one character apart. The words are `server/game/wordlists/` (LDNOOBW, CC BY 4.0, 19
  languages, `go:embed`-ed, attributed in `NOTICE.md`), matched on a folded form (case, diacritics,
  leet, separators, repeats) whole-token first, as a substring only from 6 characters up, with
  `nicknameAllowSeed` for the Scunthorpe collisions. That threshold and that allowlist are the
  false-positive control and they are the reason Constance and Dominique can play: do not lower it
  without a test proving the names still pass. See `docs/notes/server.md`.
- **A refused action is not automatically suspicious.** `game.IsLostRace(err)` names the refusals a
  correct client produces all match long; gameplay handlers call `Client.noteRejection(err)`, not
  `noteSuspect`. Always `errors.Is`, never string comparison.
- **Every path that grows a hand goes through `hub.sendHandGrowth`**: the affected player gets the
  cards, everyone else gets the count. Telling a client the count but not the cards desyncs it
  silently and unrecoverably.
- **A zero is a value, not an absence.** `turn` and `drawn_count` carry no `omitempty`;
  `pending_draw`, `has_drawn`, `player_index` and `player_id` are pointers for the same reason.
  Read seats with `ServerMsg.Seat()` / `ServerMsg.OwnSeat()` (-1 = no seat named).
  `protocol/messages_test.go` pins seat 0 onto the wire.
- **Bots**: `game/bot.go` decides, `hub` schedules. They interject, catch and declare, always through
  the same domain calls and the same broadcasts as humans. Only `LOCO_BOT_THINK_MS` /
  `LOCO_BOT_JITTER_MS` are tunable from the environment (gated on `LOCO_E2E=1`); every other bot delay
  is a reaction window somebody is meant to be able to win.
- **1v1 matchmaking is one FIFO queue** (`hub/matchmaking.go`) and its size is **never on the wire**:
  `matchmaking_queued` is an empty acknowledgement, and the number lives only on `/metrics`. A client
  that could render it would render "1" at exactly the moment the queue is trying to fill, which
  reads as "close the tab". A matchmade room has no host: `add_bot`, `start_game`, `set_match_format`,
  `set_max_players` and `kick_player` are all refused by `refuseInMatchmade`. Nothing player-facing says
  "unranked"; a ranked ladder would be a second queue and would introduce itself.
- **`kick_player` is the one host control that acts on a person, so it is the strictest**
  (`hub.handleKickPlayer`): host only, lobby only, matchmade never, and **never seat 0** — giving up
  your own seat is `leave_room`, and a kick that could take the host's would hand the table to seat 1
  through a button that says nothing of the sort. The table sees the ordinary `player_left` because
  the work is `releaseSeat`, the same bookkeeping a quit and a lobby disconnect do; the removed client
  gets `kicked` on its own socket, since a table vanishing with no explanation reads as a bug. A seat
  with no socket behind it is a bot and goes through `removeUnmannedSeat`, which is the only way to
  take one back. **It is not a ban and must not become one**: the code is already in that player's
  hands, there is no identity here to refuse them by, and an address is the one handle
  `truncateAddr` exists to never keep. That is what makes a mistaken press cheap, and why the button
  asks nothing first.
- **`rematch` is an ask, not a decision, and that is true in every room** (`hub.handleRematch`,
  deliberately *not* behind `refuseInMatchmade`). It was the host's call and is nobody's now: the
  host owns the format, the size and the start, which are things about a table that has not dealt
  yet, and has no standing over whether the others want another twenty minutes. So every seat gets
  the same button, every ask is broadcast (`rematch_offered`, carrying the **whole** offer state and
  the quorum, never the increment), and the next match is dealt only once every connected human has
  asked (`rematchQuorum`; bots are not asked). The deal itself differs: `startRematchedMatch` deals a
  matchmade pair through the pairing path, `openRematchedLobby` returns an ordinary table to its
  waiting room. **A departure retires that seat's ask and re-bases the rest**
  (`hub.releaseRematchOffer`), and completes the agreement on the spot when what is left of the table
  has already asked: nobody is made to wait on somebody who is not there. In a matchmade room the
  survivor has nobody to agree with at all, so the client requeues them instead.
- **Nobody waits for somebody who is not there.** A matchmade room holds a dropped seat for 15s
  (`MatchmakingReconnectTimeout`) instead of 60 and treats 2 consecutive turn timeouts as away
  (`MatchmakingAFKThreshold`) instead of 4, and **both expiries forfeit the match** to whoever stayed
  (`game.Room.ForfeitTo` + `hub.forfeitMatch`), as does `leave_room`. The scoreboard is left alone: no
  points are invented for a round nobody finished. Ordinary rooms keep 60s and 4: those are people
  who came in together. `leave_room` is refused mid-match in one, and allowed in every waiting room:
  a table you opened or joined by mistake has a quit button (behind one in-place confirmation, the
  only one in the game), and the seat is freed on the spot rather than held the 60s a closed tab
  would cost the others.
- **A deploy does not end the matches on the server.** `SIGTERM` drains (`hub.BeginDrain`,
  `hub/drain.go`): nothing that would start a new match is accepted, the matchmaking queue is emptied
  with an explanation, and **everything already running is left completely alone**. The refusal list
  (`create_room`, `start_game`, `rematch`, `find_match`, `join_room` on an unknown table) is chosen so
  the drain terminates; joining an existing lobby stays allowed because a lobby cannot deal during
  one. Whatever the drain does not finish is written to `LOCO_SNAPSHOT_PATH` and read back by the next
  process (`hub/snapshot.go`), and the clients reconnect into it with the token they already hold.
  Only matches in flight travel, a snapshot is never replayed, and a foreign `SnapshotSchemaVersion`
  or an age over `SnapshotMaxAge` drops the file whole. **`stop_grace_period` in `deploy/compose.yml`
  must stay above `LOCO_DRAIN_TIMEOUT`**: at Docker's 10s default the `SIGKILL` lands in the middle
  and none of this exists. **And a deploy never waits on the tables that are up**: one policy for
  every environment (`deploy/app.env`, 90s drain / 150s grace), so how long a shutdown can block is a
  constant rather than a question about how long a match runs. Production waited 15 minutes for a
  best-of-7 until 2026-08-02; that made the length of a pipeline a function of the players and left
  the job's ceiling one raised value away from failing a deploy on a match instead of on a fault. The
  snapshot is what pays for the shorter wait, which makes the restore the ordinary path in production
  rather than the exceptional one. See `docs/notes/server.md`.
- **The map-loading gate refuses every gameplay message while open** and the turn clock starts at
  `match_ready`, not at `game_started`. Per match, not per round.
- Deferred async is `time.AfterFunc`. Critical channel sends retry once then `WARN`. Broadcasts
  marshal once. `Client.SendBytes` force-closes on a full send buffer.
- `/metrics` **and `/health`** are operator surfaces: no compose file publishes the Go server except
  `docker-compose.dev.yml`, and **nginx proxies `/ws` and nothing else**. `/health` used to be
  proxied and answers with the room count, the player count and `draining`, which sizes the server
  for anyone thinking of loading it and announces the window where tables are refused. Docker's
  healthcheck and the CI smoke test both read it from inside on `localhost:8080`.
  `debug_mode_active` must be `false` in prod.
- **The server container has no privilege to lose**: uid 10001, `no-new-privileges`, `cap_drop: ALL`,
  read-only rootfs, tmpfs `/tmp`. `${DATA_DIR}/snapshots` is chowned to 10001 and chmodded 0700 by
  `.gitlab-ci.yml` (a mount overrides the image's chown, and a container that cannot write its
  snapshot loses the matches it exists to save). **Treat that directory as a secret**: it holds every
  session token and every hand of every interrupted match.
- Structured `key=value` logging, `conn=` on every connection-scoped line, never tokens or hands.

## Client
Detail: [`docs/notes/client.md`](docs/notes/client.md).

- **The game is never an Astro island.** A `client:*` directive makes Astro emit its hydration
  runtime as two **inline** `<script>` blocks, and `nginx.conf` sends `script-src 'self'`: they are
  refused, nothing mounts, and the page is blank **in production only**. Astro's `security.csp`
  answers this with hashes in a `<meta>`, which does not help, because a meta policy and a header
  policy are both enforced and the header still blocks them. `src/entry.tsx` is mounted by an
  ordinary bundled `<script>` in `index.astro` instead, which is what the app already did under
  Vite. `csp.test.ts` fails on any `client:*` directive, and on any `is:inline` script.
  The same rule is why `@astrojs/react`'s fast-refresh preamble is injected as a page script from
  `astro.config.mjs`: the integration only injects it on pages that hydrate an island, so without it
  dev throws "can't detect preamble" and nothing renders.
- **A dependency can break the policy without appearing in our sources.** Zod 4 JIT-compiles each
  schema with `Function()` on first use; `script-src 'self'` refuses it, Zod interprets instead, and
  the only symptom is a `securitypolicyviolation` on every page load. `protocolSchemas.ts` sets
  `z.config({ jitless: true })` and `csp.test.ts` pins it. `csp.test.ts` greps *our* files, so
  **`make csp` belongs after a dependency bump too**, not only after an `nginx.conf` edit: it is the
  only check that meets the real policy with the real bundle.
- **Astro narrows Vite's `envPrefix` to `PUBLIC_`, so `astro.config.mjs` puts `VITE_` back.** Without
  it `import.meta.env.VITE_WS_PORT` survives the transform and reads `undefined` in the browser,
  nothing warns, and `useWebSocket` falls back to same-origin `/ws`: in dev that is the Vite server
  proxying nothing, so every table and every match request died on `ws://localhost:5173/ws`.
  `src/test/wsEnv.test.ts` fails on a prefix the hook reads and the config does not expose.
- **`/` arrives in one piece, and the background is never part of the arrival.** Half the page is
  markup Astro served (the footer row, the burger, the prose) and half is React mounted from a
  bundle, so it used to come up as a background with one control on it and then, a few hundred
  milliseconds later, the game. What holds at `opacity: 0` is therefore **what arrives** — `#root >
  *`, `.homeIntroMain`, `.homeBurger` — and never `#root` or `.homeIntro` themselves: both are filled
  with `--color-canvas`, and that flat fill is the only reason the body's candy gradient is never
  seen, so fading either of them flashed a gradient belonging to no screen in the game. The hold is
  inside `@media (scripting: enabled)` — with no script the served half must be visible at once,
  which is what `seo.spec.ts` reads — and the same animation carries a 3s delay while the attribute
  is missing, so a bundle that never lands reveals the page rather than leaving it blank.
  `entry.tsx` writes `data-booted="in"` two rAFs after `render()` and blanks the value once the fade
  is over: every screen is a fresh child of `#root`, so a reveal rule left standing would replay on
  every screen change all match. Opacity only: a transform would become the containing block for the
  fixed burger and every panel the app renders.
- **Nothing continuous goes through React state.** Countdown bars use `useDrainBar` (a CSS animation
  with a negative delay), never a percentage in state. `<GameBoard />` is `memo`'d and its props are
  kept referentially stable in `GameView`; `App` never subscribes to the whole store. One `setState`
  per frame re-renders the entire board.
- **Send first, animate second.** `onCardClick` returns "did the card leave the hand?" and the flight
  is spawned only on `true`. **A tap that is not a play animates nothing**, and a card the client
  refuses opens no picker either: the legality check runs *before* the prompts.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, the catch key carrying its
  target). One shared lockout ate draw-then-pass.
- **Anything that opens over the board closes two ways: `Escape` and a control that can be pressed.**
  Escape goes through `hooks/useEscapeKey.ts` — one hook, not one `useEffect` per panel, which is how
  the two pickers ended up with a scrim and a ✕ and nothing on the keyboard. The visible half is not
  optional either: a phone has no Escape key, and a scrim is not an obvious thing to tap. A dropdown
  anchored to its own opener (the gear, the mixer) is the one exception — the button that opened it
  shuts it, and nothing covers it. `escapeClose.test.tsx` owns the rule.
- **A refused action never shows a wire string.** `i18n/serverErrors.ts` maps server prose onto
  `Translations.errors` by ordered regex, resolved at render. **Add the string there when you add a
  server error**; `serverErrors.test.ts` asserts every reachable one resolves.
- New inbound message types go in `serverMsgTypeSchema` (`protocolSchemas.ts`) or `useWebSocket` drops
  them in dev; new outbound types go in `ClientMsgType`. The schemas are the single source of truth
  for inbound types.
- **The copy is the game talking, not a website.** Players open a **table**, share a table code and
  take a seat; there is no "room" and no "lobby" in any player-facing string. French is
  **tutoiement**. A button is the verb about to happen, a refusal says what to do next and never
  scolds, and only the streamable moments shout. The rules modal is written to be read once,
  standing up: one sentence per item, headings that promise something. `docs/notes/client.md` holds
  the full voice, and `docs/rules.md` stays the spec the modal must not contradict.
- **The host's kick is one icon button per roster row, never on their own row, and it asks nothing**
  (`WaitingRoom.tsx`). The quit link below it is the screen's one question and earns it: leaving is
  one-way and costs a guest the code. A kick costs nothing to undo, so a second confirmation would
  only teach people to click through both. A bot's row carries it too — nothing else takes a bot's
  seat back. The removed player is reset like `left_room` and then told why (`errors.kicked`), in
  that order, because `resetToHome` clears `errorMsg`.
- **Player preferences live behind one gear** (`Preferences.tsx`), on every screen including the
  board: language, theme, streamer mode, colour shapes, reduced motion. The theme used to be a bare
  chip; a top bar that also carries sound and rules does not grow a control per setting. Each
  on/off preference is a `createBooleanPref` module store (`hooks/prefStore.ts`, `localStorage`,
  presentation only, never on the wire) because they are read by screens with no common parent.
  Icons in that row are **drawn SVG, never a font character**: a `⚙` glyph is a different object on
  every platform, and long thin spokes read as a sun.
- **Below 46rem that panel is a sheet, and the lobby's gear stands down.** A 250px dropdown hanging
  off a 40px chip is a desktop object, and on `/` the chip is not even the way in at that width — the
  burger's `Preferences` row is, so `Lobby` alone passes `triggerBelowPhone={false}`. **Only the
  lobby may**: `data-seated` takes the drawer off the page, so from the waiting room onwards the gear
  is the sole entry at every width. The sheet's scrim **wraps** the panel rather than sitting beside
  it (the RulesModal pattern): as a sibling, "click outside" is a z-index argument. And its ✕ carries
  `position: relative`, without which `.hit-target` centres a 44px pseudo-element **on the scrim** —
  the panel opened in the middle of the screen and swallowed every press aimed at a setting.
- **The language pair is two real `<a href>`s at the entry screen, and a toggle once seated.** Half
  of `/` is markup Astro rendered per URL — the footer row, the drawer, the sheet of prose — so
  `setLang` alone left the game in French under a menu still reading "With friends". Following the
  link is what makes the whole document agree; `setLang` still runs so the choice outlives the
  navigation. Past a taken seat there is nothing to agree with and a navigation would drop the match,
  so it is the in-app toggle it has always been. `LanguageSwitcher.tsx` holds the only second copy of
  `/` and `/fr/`, because importing `seo/meta.ts` would put every page on the site in the bundle;
  `seo.test.ts` pins it against `HOME.path`.
- **A control drawn smaller than 44px gets its target from `.hit-target`, not from its own box.**
  The global utility in `tokens.css` grows the hit area with a pseudo-element, so the top-right
  cluster stays a row of 40px chips (which is what `DESIGN.md` sizes it at) while the thumb gets
  `--touch-target`. Segmented options are the exception and keep their own height: expanding them
  would have them stealing each other's taps. The same file's `.btn-chunky` and `.t-*` classes were
  deleted in the same pass — they claimed to be what every control extended and nothing had ever
  imported them.
- **Quiet is a hue, never an opacity.** `--color-muted` resolving to `--color-ink` on hover, not
  `--color-ink` at 0.34: an opacity dims the object *and* its contrast, which is how the lobby's
  legal link, the home footer and the content pages' navigation all ended up between 2:1 and 3:1.
- **Streamer mode blurs the table code** through `TableCode.tsx`, the single component every screen
  renders the code with. The blur is CSS over the real text: copy still copies the code, and
  hover/focus clears it so the owner can read it out. A new screen that prints the code must go
  through `TableCode` or the mode silently leaks it.
- **Colour is a rule, not decoration, so colour assist gives each suit a silhouette**
  (`SUIT_SHAPE` in `cardTheme.ts`, drawn by `suitMark.tsx`): triangle, circle, square, diamond, on
  the card under the value, on every picker swatch and on the active-colour chip. Never a letter:
  `R` and `V` name different colours in the two languages. A wild has no suit and stays unmarked.
  Anything new that means something by hue alone needs the mark too.
- **Reduced motion is a preference, not just a media query.** Every reduced-motion rule is scoped to
  `:root[data-motion="reduce"]`, which `useMotionPref` writes from the system setting *and* the
  player's answer, so the choice can win in both directions (`initMotion()` in `entry.tsx`, framer-
  motion through `<MotionGate>`, `prefersReducedMotion()` for the two WAAPI shakes). A new
  `@media (prefers-reduced-motion: reduce)` block would ignore the preference: `reducedMotionCss.test.ts`
  fails on one.
- **The lobby answers a nickname as it is typed, and says nothing the server would not have.**
  `components/nicknameRules.ts` mirrors the *shape* rules of `game.ValidateNickname` so a refusal is
  instant, and the word list stays server-side: it is 19 files, and a bundle carrying them would be
  downloading a few thousand slurs on every page load for a check the server repeats anyway. Both
  halves render `t.errors.nicknameRejected`, the same line `nickname not allowed` resolves to, so a
  player cannot tell which half refused them, nor read the rule off the message.
- **"Take a seat" is disabled until the table code is a whole one, in the server's alphabet.**
  `components/tableCodeRules.ts` mirrors `hub.roomCodeRe`: six characters of `A-Z2-9` minus `I`, `O`,
  `0` and `1`, which a code is never drawn from because it is read out loud off a stream. The field
  drops everything else as it is typed or pasted, so a stray space or a `0` typed for `O` never
  becomes a request whose only outcome is an error line under a form the player has not finished.
  It decides nothing: `join_room` is validated again server-side, and an unknown table still comes
  back as `room not found`.
- **A table is shared as a link, and the code is the button that copies it** (`hooks/tableInvite.ts`,
  pressed in `WaitingRoom`). It is `/?t=CODE`, never `/t/CODE`: every URL here is a page the build
  emitted and `nginx.conf` answers a miss with a real 404 on purpose, so there is no catch-all a path
  form could route through. **It carries no language**, whichever one it was copied from: a link is
  forwarded, and the sender does not get to decide what the reader opens in. The code stays on screen
  because that is what a stream reads out loud. **The invite is spent on arrival**: `initTableInvite`
  takes it back out of the address bar before the first render, so a reload reclaims a seat instead of
  re-joining, a code never sits in the address bar where `TableCode`'s blur cannot reach it, and a
  copied URL stops naming a closed table. A link naming another table clears a stale reclaim record;
  one naming the same table leaves it alone. **A link carries a table, never a player**: App joins on
  its own only when `nicknameMemory` already has a usable name, and otherwise opens the join form with
  the code filled and asks for the name, which is the one thing a link cannot carry.
- **The lobby remembers the last nickname** (`nicknameMemory`, `localStorage`, written on submit and
  read once at mount). It is a prefill that authenticates nothing, which is exactly why it is not the
  `sessionStorage` `loco_session` record: an emptied field still refuses to send.
- **The searching screen times its own wait, and none of its copy may imply the queue is empty.**
  The server sends no count, so `searchStage` (0-15s / 15-45s / 45s+) stages three honest sentences
  off elapsed time and the last one offers a private table instead. "Nobody is searching" is
  self-fulfilling: the player who leaves on it is the opponent the next one was about to get. The
  queue screen is entered optimistically (the acknowledgement carries nothing to wait for), and
  `endSearch` is guarded on the screen so a cancel that raced a pairing cannot unseat a matched
  player. **A forfeit never renders as a victory**: no confetti, no trophy, and the player who left is
  told they left. It is also the longest single screen in the game, so it carries the same top bar as
  every other one.
- **Being found has to reach a player who is not looking.** `soundsForTransition` plays `matchFound`
  on the way into `screen: 'matchfound'`, and `useTabAlert` alternates the browser tab's title with
  `t.matchFoundTab`. That second one is only acceptable under two rules, both pinned by
  `tabAlert.test.tsx`: it **arms only while the tab is hidden**, and coming back disarms it, restores
  the real title and never re-arms. A title blinking at somebody who is watching the board is an ad.
- **The game-over screen asks, it does not command.** The rematch button is an ask with three states
  (ask / waiting on the others / they asked first), on every screen and at every table, because the
  server deals only once everybody has asked. Never render it as though pressing it started anything.
  Past two seats the wait is on the table rather than on one named opponent and the button carries
  the count (`rematchProgress`), which at two would be noise. A table nobody is left at keeps the
  button **in place and disabled**: a reaction game does not reflow its buttons, and the answer may
  still be one reconnect away. The exception is a matchmade table, where there is nothing to wait
  for: App requeues that player without being asked (`rematchRequeue.test.tsx`), and cancelling the
  search is how they leave. Requeuing sits beside the ask as an equal choice, matchmade only.
- `initLangUrl()`, then `initTheme()`, `initTableInvite()` and `initSessionRestore()` run in
  `entry.tsx` before the first render, in that order: the language decides whether this document is
  the right one at all, and the invite decides whether the stored reclaim record still applies.
- **A document is never in two languages at once, and a language is changed by navigating.** Half of
  `/` is markup Astro built per URL, and a stored choice outranks the URL in `detectLang`, so `/`
  with French stored rendered the game in French under a footer reading "With friends", on an
  `<html lang="fr">` — a lie to a screen reader before it is a mess to look at. `initLangUrl()`
  (`src/lang.ts`) sends that document to `/fr/` instead, with `location.replace` so Back is not a
  trap, and carrying the query string so a `?t=CODE` invitation is still there to be spent on
  arrival. It acts **only on an explicit choice**: landing on a French page from a search result
  writes nothing. Both switches record one — the lobby's (which already navigates) and the content
  pages' globe, whose links stay real `<a href>`s and gain nothing but a `rememberLang` on the way
  out. Without that second half a reader could choose French, read the rules and press "Jouer" into
  an English game at a French address. `lang.ts` holds the storage key and the two home paths for
  the same reason `theme.ts` holds the theme: the content pages take part and mount no React.
- i18n: `en.ts` is the source of truth and its `Translations` interface types `fr.ts`, so a missing
  key is a TS error.
- **React 19 idiom: `ref` is an ordinary prop.** No `forwardRef` (`Card`, `CardBack` are plain
  functions), `JSX` is imported from `react` rather than assumed global, and a prop taking a
  `useRef(null)` is typed `RefObject<T | null>`. **TypeScript stays on 6.x**: `npm run build` is
  `astro check`, whose language server needs a programmatic API the 7.0 native compiler does not
  ship yet, so raising it removes the client's only type gate. Move the pin when that lands, not
  before. See `docs/notes/client.md`.

## Findability
Detail: [`docs/notes/seo.md`](docs/notes/seo.md).

- **A content page restates what the game already knows, so it is pinned to the source.** The rules
  page maps `t.rules`, the array `RulesModal` maps, rather than copying it; the deck table is checked
  against `server/game/deck.go` and `server/game/card.go` by `contentPages.test.ts`, because points
  and card counts are the server's to define and a page is free to drift from them in silence.
- **A content page ships no JavaScript except `theme-boot.ts`.** React components render with no
  `client:` directive, so `<LocoLogo />` and every `<Card />` on `/cards/` are static markup: the
  card on the page is the card in the hand, not a picture of it. The one script exists because `tokens.css`
  keys the dark palette on `[data-theme]`: without it a player who chose dark lands on a white page
  one tap later. It imports `src/theme.ts`, not the hook, or it would drag React onto the page.
  Anything interactive is therefore a **native control**: the home page's sheet is `<details>`, the
  language chooser is a `[popover]`, and both dismiss on Escape with nothing behind them.
- **One `--shell`, one bar, no backdrop.** Header, column and footer of a content page share a single
  width — three container widths made the logo, the title and the footer start at three different x
  and the page read as three strips. The **navigation is a fixed footer bar**, the same five links in
  the same order as the home page's row, with `Play` where its sheet button is: a player who came
  from `/` meets what they left. Nothing is pinned behind the text: `body.doc` is flat canvas and
  `background-attachment: fixed` is gone from `tokens.css`, because prose sliding over a stationary
  gradient is the one effect that dates a page instantly. `contentPages.test.ts` fails on its return.
  These pages also put **text selection back** (`body.doc`), which the board's reset takes away.
- **The header is pinned and the bar is fixed, so both ways out are always on screen.** `.headerBar`
  is a full-width `position: sticky` band and `.siteHeader` is the `--shell` row inside it, which is
  what keeps the logo on the `<h1>`'s x. It carries everything that leaves the document — the mark,
  the CTA, and under 46rem the burger that is the whole navigation — and scrolling it away sent a
  reader deep in the rules back to the top of a long page to reach any of it. Sticky, not fixed: it
  is the column's first child, so `--bar` stays the only room the page reserves. `scroll-padding-top`
  on `html:has(body.doc)` is not optional with it — without it the skip link and every in-page anchor
  land under the band.
- **Under 46rem the bar is gone and one burger is the whole navigation**, top left, on the content
  pages *and* on `/` (`.menuBtn` + `#navPop`, styled once in `content.css`). Ten items folded into
  two rows of 12px text with nothing on them taller than the type; the drawer's rows are 2.75rem.
  The items differ by page — the content pages' drawer is the bar entire (Play, the five, privacy,
  theme, globe), the game's carries the five and privacy, and **no Play**. **Only the list differs**:
  it carried the home page's prose under its links until 2026-08-02, which made the menu on `/` a
  taller, wordier object than the one a content page opens one tap later, and crossing between them
  read as two menus. `GamePage.astro` styles none of it, and a rule there is a divergence by
  definition.
- **Both drawers open on the wordmark and carry exactly one action.** The head is `<LocoLogo />`,
  not the word "Menu", which named a panel the reader was already looking at and left the one branded
  surface on the site with no brand on it. It is a **`<div class="navPopTitle">`, never a `<p>`**: the
  logo renders a `<div>`, the parser closes a paragraph before one, and the mark came out as a
  *sibling* — a three-item `space-between` row that centred it. It rendered perfectly and sat in the
  wrong place, which no test reading the source catches; `mobile.spec.ts` measures it instead. The
  action is `.navPopCta`, the drawer's colour: `Play` at the top on a content page, `Preferences` at
  the bottom on the game page, opposite ends because they mean opposite things. `#navPrefs` ships
  `hidden` and `homeSheet.ts` reveals it, then asks React for the panel over a `loco:preferences`
  event — the one seam between the markup Astro rendered and the app mounted beside it, and the
  reason a scriptless page is not offered a button that opens nothing. Five
  things break it, four of them silently: `display` belongs on `.navPop:popover-open` and nowhere
  else (an author `display` beats the UA's `[popover]:not(:popover-open)` by cascade **origin**, so
  the drawer stood open on every page); a popover is `height: fit-content` until told otherwise;
  hiding the bar is only allowed inside `@supports selector([popover])`, or a browser without the API
  gets a page with no navigation at all; **the bar is hidden with `display: contents`, never `none`**,
  because `#langPop` lives inside it and a popover under a `display: none` ancestor renders nowhere
  however it was opened, which left the phone's only language switch doing nothing at all; and
  **widening the window has to close it**
  (`content/navMenu.ts`, one `matchMedia` listener, imported by `theme-boot.ts` and `homeSheet.ts`,
  holding the second copy of the breakpoint `contentPages.test.ts` pins to the CSS).
- **The language chooser is a globe and a modal, and the links inside it are real.** Both languages
  are `<a href>`s with `hreflang`/`lang`, in the document open or shut, because the href is what makes
  an `hreflang` pair navigable and a crawler follows nothing else. `@supports not selector([popover])`
  degrades the panel to a plain row in the bar rather than losing the switch. It closes three ways,
  all native and all script-free: Escape, a click outside, and a ✕ that is
  `popovertargetaction="hide"` — the first two are invisible and neither exists on a phone. Write
  the attribute as `popover="auto"` in full: an invalid value falls back to the *manual* state,
  which has neither of the first two and fails as a panel that will not close.
- **The dark palette is in `tokens.css` twice, and that is the point.** `[data-theme]` is written by a
  script and a script cannot paint the first frame, so a dark system met one white flash per
  navigation. The same block sits behind `@media (prefers-color-scheme: dark)` on
  `:root:not([data-theme='light'])` — known at parse time, and still beaten by an explicit choice.
  `themeFlash.test.ts` compares the two declaration by declaration; they may not drift.
- **The theme switch on a content page is `theme-boot.ts` wiring one button**, beside the globe in the
  bar, and it is `hidden` in the markup until that script reveals it: a toggle that cannot store a
  choice is a dead control, and the reader who has no script already has their system's theme. It
  writes the key `useTheme` reads, so the choice crosses between the pages and the game.
- **`src/seo/meta.ts` is the single source.** A page appears once in `PAGES`, with its path, title
  and description **per language**; the sitemap, the `hreflang` sets, the canonical and
  `seo.test.ts` all read it. Every failure in this area is silent by nature (a page declared but
  never built, a `hreflang` set that does not point back, two pages sharing a title), so the test
  asserts the properties rather than the markup, and **a declared path with no source file behind it
  is a failure**: the sitemap would hand Google a URL that 404s.
- **The home page is exactly one viewport and never scrolls.** `body` is a flex column, `#root` takes
  what is left, and the indexable markup is a quiet footer row under it: the only links from `/` to
  the content pages, in the open, plus the prose one press away in a **native `<details>` sheet**.
  Nothing on this page is reached by scrolling, at the lobby or in a match — **a board that can be
  scrolled off-screen mid-match is a bug**, and so is a lobby that hides text under the fold. The
  footer vanishes on `data-seated`, which `App.tsx` writes for every screen but the lobby. Never make
  it React's to unmount, and never make the sheet a React modal: it is markup Astro rendered, which
  is what puts the prose in front of a crawler and keeps `src/content/` out of the bundle. It must
  keep opening with **scripts disabled** (`seo.spec.ts` clicks it that way); `src/homeSheet.ts` adds
  Esc and scrim-click and nothing the sheet depends on. Under 46rem that row is not on screen at all:
  the burger replaces it and the drawer carries the links, and **only** the links — the sheet is the
  prose's one control, and a menu is a list of destinations on both halves of the site or it is two
  menus. The prose stays in the served HTML at every width, which is the half a crawler reads.
- **The FAQ is the `FAQPage` payload, rendered.** It is the one structured-data type here that can
  put content straight into a result, so `src/content/faq.ts` is the data and the page is a view of
  it. Its answers describe real server behaviour (the 60s seat hold, 15s matchmade; the turn clock
  and its four-timeout limit), so a change to those changes this file too.
- **English at `/`, French under `/fr/`, every path slash-terminated.** `/` stays the game's URL
  because it is the address people paste. Never add a redirect from the unslashed form: `/nope` has
  no directory either, so redirecting on a `try_files` miss loops forever. The canonical resolves
  the duplicate.
- **A French URL opens in French**, whatever the browser asks for, via `data-served-lang` on
  `<html>`. Never read `<html lang>` for this: the i18n provider writes it, so detecting from it
  makes the app read its own last output.
- **The origin is decided at build time** (`VITE_PUBLIC_ORIGIN` → `site` + `ORIGIN`). Crawlers do not
  run JS, and a relative `og:image` is never fetched. `client/Dockerfile` takes it as an `ARG`,
  `.gitlab-ci.yml` passes `https://${APP_HOST}`.
- **nginx answers a missing page with a real 404**, never with the game: `try_files … /index.html`
  is a soft 404, which Google reports as an error and which hides broken links. `robots.txt`
  advertises the sitemap on production hosts and nothing at all on `-d.`.
- `make og` and `make icons` **commit their output**: CI has no browser.
- The ceiling here is real but bounded. What is not is off-site: a one-click table link, an IGDB
  entry so Twitch has a category at all, and browser-game directories. None of those is a meta tag.
- **A content page is a player-facing surface, so it never says UNO either.** Same rule as the game,
  for the same reason: the disclaimer that names the mark is only true while nothing else does. That
  costs the obvious keyword on purpose, and the pages are written to answer the *descriptive*
  queries instead. `seo.test.ts` extends `legal.test.tsx`'s guard over `PAGES`, `UI` and every
  `src/content/**` file.
- **An audit failure here is invisible by construction, so it is pinned in a test.** Lighthouse
  scored 86-89 on accessibility while every page looked exactly as designed, and three of the four
  causes were properties of a *file*: `client/src/test/a11y.test.ts` owns all four and
  `docs/notes/seo.md` carries the arithmetic. **The viewport may never forbid zooming** — no
  `user-scalable=no`, no `maximum-scale`; the double-tap is answered by `touch-action: manipulation`
  on `body`, which leaves the pinch alone. **White on LOCO Red is 3.43:1**, so anything wearing it
  is set at 1.2rem or larger (`.cta`, `.navPopCta`), never darkened. **A box that scrolls sideways
  takes `tabindex="0"`** and shows a `:focus-visible` ring: the deck table and the card rows hold
  nothing focusable, so without it what is past the right edge belongs to whoever can drag it.
- **Two things keep a page fast, and neither is page-specific**: `build.inlineStylesheets: 'always'`
  (the stylesheets are small and all three were render-blocking; `style-src` allows `'unsafe-inline'`
  and **scripts still may not**) and the tables page's art rendered through `<Image />`. That second
  one is the only place a page reads the map files by import rather than through `MAPS`: the board is
  handed a room at runtime and cannot, this page knows all four at build time, and eight full-size
  photographs in a 752px column were a 9.1s LCP.
- **Never fade in the element the browser measures the LCP against.** Chrome takes its candidate at
  the element's *first* paint and skips anything at `opacity: 0`, so a screen that arrives by fading
  from zero can produce **no candidate at all** — `NO_LCP`, which scores the page **0** on
  performance however fast it actually is. Both `<link rel="preload">` on the display face and the
  home page's boot fade have done exactly that, measured. Fade a covering veil off the top instead:
  the content is then painted opaque on the first frame and the arrival looks the same.
  `docs/notes/seo.md` carries the measurements.

## Visual
Detail: [`docs/notes/visual.md`](docs/notes/visual.md). Spec: `DESIGN.md`.

Art direction is **cartoon premium** (Nintendo x Gartic Phone). Three rules the whole UI obeys,
stated at the top of `styles/tokens.css`:
1. Every raised object has an ink outline **and** a hard bottom shadow. Soft blurs are ambience,
   never structure.
2. Nothing is pure white on pure white. The board always sits on colour.
3. Type is display-weight and large: a spectator reads it at 720p.

- **`tableRect()` is the single authority on board geometry**, and `seatLayout()` on seating. Maps
  change how the felt is *painted*, never where anything is. Three callers must agree exactly or
  animation trails fly to empty space.
- **The board is a fixed coordinate space scaled by `<div .stage>`.** Fix scale problems in
  `boardScale`/`boardSpace`, never by bumping `CARD_W` or `SEAT_DIMS`. `boardSpace` takes the safe-area
  insets, so the coordinate space stops short of the notch and the home indicator while the element
  still runs edge to edge.
- **Animate transforms, never `left`/`top`.** A node's transform has exactly one owner: if
  framer-motion animates it, CSS must not set it. Layout math is radians, framer-motion `rotate` is
  degrees (`radToDeg` at the render boundary). Hand keys come from `handCardKeys(hand)`, never the
  index.
- **The wordmark is a logotype, and the markup has to say so.** `<LocoLogo />` carries `role="img"`
  and `aria-label="LOCO"` with the word `aria-hidden`: it is a drawing, WCAG exempts it from the
  contrast rules, and a screen reader announcing "LOCO" twice was the other half. A checker cannot
  know that, and it reads `-webkit-text-stroke` as the colour of the text — the ink outline is
  1.07:1 on the dark canvas, where the red it wraps is 5.4:1. So **in dark the word carries no
  stroke and a `::before` paints the outline over it**, declared twice like the dark palette in
  `tokens.css`; in light the stroke stays where it is 14.7:1 and the red alone would be 2.2:1. The
  drawing is unchanged in both. `a11y.test.ts` fails on a stroke returning to the dark word.
- **The card face does not follow the theme.** A card is a physical object; the same card in two
  themes is two cards. `LOCO_MARK_PATH` comes straight from the designer's source file: do not
  redraw, retrace or tidy it.
- **On a card the mark is a mask, never a `<path>`.** The face is CSS gradients and the mark is one
  shared mask image (`MARK_MASK_URL`, `MARK_MASK_BOLD_URL`), so the browser rasterises that geometry
  once and all ~50 faces and backs on a busy table composite the same bitmap. As live paths under the
  scale animations they all sit inside, they cost 2.3-3.3x the frame rate wherever the compositing is
  done in software. `card.test.tsx` fails on a live path and on a second mask URL; nothing else can
  see it. Same rule for any new card art: one cached image, not geometry per instance.
- **Motion must degrade to a readable static state**, not to nothing: `.armed` becomes a static halo,
  a countdown bar keeps draining under `prefers-reduced-motion`.
- **The action bar never reflows.** Fixed three-column grid, Catch mounted-but-disabled all match in
  the centre column, enabled in place. A reaction game cannot move its buttons mid-match.
- **Add a scene to `src/dev/scenes.ts` in the same change set as any new screen or visual state**, and
  review with `make visual` (`--viewports=wide,small` after touching `layout.ts`, `notch` for safe
  areas, `--scenes=card-sheet` for anything on a card).

## Audio
Detail: [`docs/notes/audio.md`](docs/notes/audio.md).

- Everything is synthesised at runtime. **No audio files ship with the client.**
- **`useGameAudio.ts` is the only place that plays anything**, through one store subscription diffing
  snapshots (`soundsForTransition`, pure and unit-tested).
- **Mobile Safari loses the context three ways and all three fail as silence, not as an error**:
  `unlock()` resumes any state that is not `running` (WebKit parks it in `interrupted`), it is `async`
  and callers must await it, and `visibilitychange`/`focus` reclaim the context.
  `navigator.audioSession.type = 'playback'` at creation.
- A track is **parts plus a form** (`audio/tracks/`), not a loop with layers. Add one by writing a
  `TrackDef` and listing it in the registry. The bass stays soft: the reference sketch's resonant saw
  is exhausting across a twenty-minute match.
- Playback is a **shuffled playlist**, not a selection: no picker, one "next" button.
- `make audio-verify` is the only thing that catches a broken envelope or a mis-wired node, because
  those produce silence rather than an error. Run it after touching `sfx.ts`, `music.ts` or
  `engine.ts`. Deliberately outside CI.

## Legal and privacy
Detail: [`docs/notes/legal.md`](docs/notes/legal.md).

- **Collecting nothing is the compliance strategy.** No account, no cookie, no analytics, no tracker,
  no third-party request, nothing persisted but a match in flight across a deploy. Every obligation
  in the GDPR scales with what is held, so the cheapest way to keep satisfying them is to keep
  holding nothing. **Anything that would break that is a legal change, not a technical one**: the
  first measurement cookie makes a consent banner mandatory and rewrites the policy.
- **No address is ever written in full.** `hub.truncateAddr` / `Client.netPrefix` and the
  `anonymised` `log_format` in `client/nginx.conf` cut every address to `/24` or `/48` **at the point
  of writing**, so the full one is never stored rather than promised away. Log lines are correlated
  by `conn=`. **Never log `RemoteAddr()` directly**; `legal.test.tsx` fails on any non-test file in
  `server/hub/` that does.
- **Privacy, terms and credits are a page, not a modal** (`/privacy/`, `/fr/confidentialite/`),
  linked from every footer (last in the home page's row of links, at the right-hand end of the
  content pages' bar), without typing a name. A policy has to be linkable:
  the modal existed on one screen of one application, so there was no way to send somebody the terms
  and nothing for a crawler or a store listing to point at. The copy is `src/content/legal.ts`,
  typed `Record<Lang, LegalDoc[]>` so a document cannot exist in one language only, read at build
  time and shipped in **no bundle**: `src/i18n/en.ts` is downloaded by every player and these three
  documents are read by almost nobody.
- **A line in that copy is a disclosure before it is prose.** `legal.test.tsx` pins the legal basis,
  the retention period, the rights list, the CNIL, the EU statement, the storage disclosure, the
  no-banner explanation, the Mattel disclaimer and the governing law. Reword freely; keep it passing.
- **The game never says UNO to a player.** The documentation does, the disclaimer names the mark in
  order to disclaim it, and every other player-facing string in both languages is asserted clear of
  it. The whole trademark position rests on that.
- Fonts are OFL and self-hosted, so the licence ships with them as `client/public/licenses.txt`.
  Regenerate it if a font is bumped.
- **Publisher identity, host and contact address are deliberately absent from the modal.** An
  editorial decision, already taken: do not add them back and do not reopen it.

## Testing, CI and environments
Detail: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- **Every E2E test is self-contained**: no `beforeAll`, no `describe.serial`, no state carried
  between tests. That is what lets CI shard per test (`fullyParallel: true`).
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
- Run `make csp` after touching `nginx.conf` **or bumping a dependency**: no test can prove the page
  loads under the CSP, and a package can reach for `eval` without our sources ever naming it.

## Docker and the Makefile
Service Dockerfiles, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, documented in
`README.md` and kept current. Production path: Traefik to nginx (:80) to Go (:8080, internal only);
nginx proxies `/ws` and `/health`, serves the SPA, and sends CSP / `nosniff` / `Referrer-Policy` /
`Permissions-Policy` on every response.

**Run `docker run` through `make` or PowerShell, never raw from Git Bash on Windows.** MSYS rewrites
`-v src:/app` into `src;C:/Program Files/Git/app`; the `-w` errors out but the mount has already made
an empty `server;C` directory at the repo root that `git status` cannot see. `MSYS_NO_PATHCONV=1` if
Bash is unavoidable. See `docs/notes/testing-ci.md`.

Root `Makefile` is docker-first so Go is not needed on the host. `make help` lists everything:
`dev`, `down`, `test`, `test-server`, `test-client`, `test-e2e`, `visual`, `og`, `maps`,
`audio-verify`, `csp`, `lint`, `lint-server`, `lint-client`, `build-server`, `build-client`.
Pass flags with `ARGS="..."`.

## README must include
overview, goals, stack + rationale, local setup, Docker usage, env vars, test commands, architecture
summary, current features, known limitations, dev workflow.

## Performance
Optimize for low latency, smooth animation, minimal round trips, efficient state updates, predictable
concurrent behavior. Do not add abstractions that harm responsiveness without clear benefit.

## UX
Smooth animations, clear turn indicators, strong feedback on penalties/counters, clean lobby flow,
responsive layout, premium feel.

## Decision rules
Prefer realtime responsiveness, then simpler architecture, then maintainable performant tools. Avoid
persistence/services without product justification. Document significant choices in `README.md` and
in the matching note.

---

## Future Claude session checklist
1. Read this file. 2. Read `README.md`. 3. Read the note in `docs/notes/` for the subsystem you are
about to touch. 4. Inspect structure. 5. Identify doc drift. 6. TDD non-trivial work. 7. Update the
docs in the same change set.

Never let `CLAUDE.md`, `README.md` or `docs/notes/` go stale.

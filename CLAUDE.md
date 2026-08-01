# CLAUDE.md

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

Also: `docs/rules.md` is the authoritative game spec, `DESIGN.md` the written design system,
`docs/protocol.md`, `docs/features.md`, `docs/deployment.md`.

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

Required coverage: room create/join, nickname entry, game start, turn progression, legal/illegal
moves, skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter/catch
windows, simultaneous resolution, reconnect (60s, nickname + room_code) **and session restore across a
page reload**, rematch (host-only, seat pruning, re-indexing), protocol validation/rejection, seat
layout at every table size and viewport, state-to-sound mapping, score table, link-preview tags vs the
committed `og.png`, map draw + the loading gate and `tableImageRect` at every board size, batch play
and batch interrupt (unit *and* E2E), a draw against exhausted piles, `Origin` checking, bots
interjecting.

Review layout/colour/motion changes with `make visual`: reading four contact sheets catches what no
assertion was going to describe. Assertions own behaviour; screenshots own appearance.

Keep tests fast, targeted, non-brittle. Cover game rules over UI details.

## Repository structure
- `client/` frontend
  - `src/components/` UI screens + shared (RulesModal, LanguageSwitcher, AudioSettings,
    InterruptBanner, CatchBanner, Confetti, MapLoadingScreen, Reconnecting, ScoreTable +
    `scoreTableModel.ts`, `playerColors.ts`, `LocoLogo.tsx`)
  - `src/components/cards/` React + Framer Motion card renderer (GameBoard, Hand, Card, CardBack,
    Deck, DiscardPile, PlayerSlot, TurnIndicator, DirectionRing, AnimationLayer; `layout.ts` pure
    pixel math, `CardArt.tsx` + `cardArtSpace.ts` + `locoMark.ts` the card face, `maps.ts` the four
    rooms, `cardTheme.ts` shared constants)
  - `src/audio/` `engine.ts`, `sfx.ts`, `music.ts` (the bed engine), `tracks/` (the music as data),
    `useGameAudio.ts` (store-to-sound bridge)
  - `src/dev/` dev-only visual showcase (`scenes.ts` registry + `Showcase.tsx` + `CardSheet.tsx` +
    `OgCard.tsx`), tree-shaken from prod
  - `public/` `favicon.svg`, `apple-touch-icon.png`, `og.png`, `maps/<id>/{room,table}.webp`
  - `src/styles/tokens.css` design tokens, single source of truth for colour/type/shape/motion
  - `src/i18n/` i18n context, en/fr translations, `serverErrors.ts`
  - `src/hooks/` WebSocket + Zustand store + `useElementSize` + `useSafeAreaInsets` + `useTheme` +
    `useHeldKey` + `useDrainBar` + `useMapPreload` + `useCountdown` + `useReconnectAnimation` +
    `sessionPersistence` + `useSessionRestore`
  - `src/types/` protocol types  ·  `src/test/` Vitest unit tests
- `server/` authoritative game server
  - `game/` pure domain (room, deck, hand, rules, bot, maps, event log)
  - `hub/` WS connection mgmt, rate limiting, session tokens, bot scheduling, map-loading gate
  - `protocol/` wire types
- `e2e/` Playwright suite: `tests/` (game-flow, multi-client, mobile, penalties, round-progression,
  reconnect, rematch, rules-coverage, special-cards, batch-play, score-table), `helpers/game.ts`,
  `types.d.ts`, `playwright.config.ts`
- `tools/` `lib/vite.mjs` (shared dev-server boot), `visual/shoot.mjs`, `og/shoot.mjs`,
  `maps/prepare.mjs`, `audio/verify.mjs`, `csp/check.mjs`
- `shared/` protocol/types  ·  `docs/` spec + `docs/notes/` engineering notes
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
- **The upgrade checks `Origin`** (`hub.originAllowed`). Default: hostnames must match, ports need
  not. `LOCO_ALLOWED_ORIGINS` overrides with an exact allowlist. A missing `Origin` is allowed.
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
- **The map-loading gate refuses every gameplay message while open** and the turn clock starts at
  `match_ready`, not at `game_started`. Per match, not per round.
- Deferred async is `time.AfterFunc`. Critical channel sends retry once then `WARN`. Broadcasts
  marshal once. `Client.SendBytes` force-closes on a full send buffer.
- `/metrics` is an operator surface: no compose file publishes the Go server except
  `docker-compose.dev.yml`. `debug_mode_active` must be `false` in prod.
- Structured `key=value` logging, `conn=` on every connection-scoped line, never tokens or hands.

## Client
Detail: [`docs/notes/client.md`](docs/notes/client.md).

- **Nothing continuous goes through React state.** Countdown bars use `useDrainBar` (a CSS animation
  with a negative delay), never a percentage in state. `<GameBoard />` is `memo`'d and its props are
  kept referentially stable in `GameView`; `App` never subscribes to the whole store. One `setState`
  per frame re-renders the entire board.
- **Send first, animate second.** `onCardClick` returns "did the card leave the hand?" and the flight
  is spawned only on `true`. **A tap that is not a play animates nothing**, and a card the client
  refuses opens no picker either: the legality check runs *before* the prompts.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, the catch key carrying its
  target). One shared lockout ate draw-then-pass.
- **A refused action never shows a wire string.** `i18n/serverErrors.ts` maps server prose onto
  `Translations.errors` by ordered regex, resolved at render. **Add the string there when you add a
  server error**; `serverErrors.test.ts` asserts every reachable one resolves.
- New inbound message types go in `serverMsgTypeSchema` (`protocolSchemas.ts`) or `useWebSocket` drops
  them in dev; new outbound types go in `ClientMsgType`. The schemas are the single source of truth
  for inbound types.
- `initTheme()` and `initSessionRestore()` run in `main.tsx` before the first render.
- i18n: `en.ts` is the source of truth and its `Translations` interface types `fr.ts`, so a missing
  key is a TS error.

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
- **The card face does not follow the theme.** A card is a physical object; the same card in two
  themes is two cards. `LOCO_MARK_PATH` comes straight from the designer's source file: do not
  redraw, retrace or tidy it.
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
- Run `make csp` after touching `nginx.conf`: no test can prove the page loads under the CSP.

## Docker and the Makefile
Service Dockerfiles, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, documented in
`README.md` and kept current. Production path: Traefik to nginx (:80) to Go (:8080, internal only);
nginx proxies `/ws` and `/health`, serves the SPA, and sends CSP / `nosniff` / `Referrer-Policy` /
`Permissions-Policy` on every response.

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

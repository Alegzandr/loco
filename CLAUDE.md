# CLAUDE.md

## Mission
Premium real-time multiplayer UNO-style card game. Goals: low-latency multiplayer, nickname-only access, server-authoritative anti-cheat, polished visuals, strong test coverage (TDD), docs in sync, Dockerized.

## Non-negotiables
- No login/signup/OAuth — nickname only.
- Server authority is mandatory; never trust client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.
- `README.md` and `CLAUDE.md` must stay in sync with the codebase.

## LOCO deviations from original SOLO rules
Authoritative spec: `docs/rules.md` §14. Summary of intentional deviations:
1. **GlobalSwitch (Change Cards All Round) is wild** — 4 copies, no color, plays on anything. SOLO has it as colored 1-per-color. Implemented in `game/deck.go` (4 wild copies) and `game/card.go` `IsWild()`. Rationale: simpler, avoids dead cards.
2. **Starting card is always a Number** — `dealRound` skips action/wild cards until a Number is found (`game/room.go`). SOLO applies the starting action's effect to the first player. Rationale: avoids first-turn ambiguity (Take 4 with no context, Swap with empty game state).
3. **Best-of-N match format**, not 600-point threshold — BO1/BO3/BO5/BO7 (`game.MatchFormat`). Game ends when one player wins the majority of rounds. Rationale: predictable online game length.
4. **Voluntary draw is allowed** — current player may draw even with a playable card in hand (still 1 draw max per turn). `Room.DrawCard` only enforces `HasDrawn` to prevent a second draw. Rationale: strategic depth; matches UNO official rules.

## Workflow loop
1. Understand behavior → 2. Tests first (non-trivial) → 3. Smallest correct change → 4. Run tests → 5. Update `README.md` if setup/commands/architecture/features/limits/env/dev/test changed → 6. Update `CLAUDE.md` if workflow/architecture/conventions/testing/DoD/structure changed.

Done = code + tests + passing + docs + Docker still works + behavior matches docs.

## Engineering priorities (in order)
latency → server correctness → UX smoothness → determinism → maintainability → testability → local DX.

## Architecture
**Server owns**: room/player/hand/deck/discard state, turn order, legality, timing windows, counter resolution, penalties, winner.
**Client owns**: presentation, input, rendering, animation, sending intents.

Realtime: persistent low-latency bidirectional transport, event-driven state, server resolves simultaneous/reaction interactions, explicit testable timing windows, deterministic resolution. Client visuals may be optimistic; server is final.

Reconnect: 60s slot hold; rejoin via nickname+room_code+session_token restores slot with full snapshot.

Fairness: server timestamps received events, defines window, deterministic documented tie-breaks.

## Style
Small cohesive modules, explicit domain types, pure domain logic, side effects at boundaries, strong validation on incoming messages, concise comments only when useful.

## Testing
TDD. Tests-first for non-trivial behavior. Deterministic clocks for timing logic. Integration-test critical multiplayer flows. Maintain Playwright E2E suite as living regression.

Required coverage: room create/join, nickname entry, game start, turn progression, legal/illegal moves, skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter/catch windows, simultaneous resolution, reconnect (60s, nickname+room_code), rematch (host-only, seat pruning, re-indexing), protocol validation/rejection.

Keep tests fast, targeted, non-brittle. Cover game rules > UI details.

## README must include
overview, goals, stack + rationale, local setup, Docker usage, env vars, test commands, architecture summary, current features, known limitations, dev workflow.

## Docker
Service Dockerfiles, `docker-compose.yml`, `.env.example`. Documented in README, kept current.

## Anti-cheat
Defend: illegal cards, turn spoofing, hidden-state manipulation, replay, forged reactions/declarations, dup spam, tampered hand, client win claims.
Posture: validate every message, reject illegal/out-of-turn, server-side hidden state, ignore client timestamps for outcomes, server outcomes final, crypto-random session tokens (required for reconnect), per-client rate limit (token bucket 10 msg/s, burst 20).

## Performance
Optimize for low latency, smooth animation, minimal round trips, efficient state updates, predictable concurrent behavior. Don't add abstractions that harm responsiveness without clear benefit.

## UX
Smooth animations, clear turn indicators, strong feedback on penalties/counters, clean lobby flow, responsive layout, premium feel.

## Decision rules
Prefer realtime responsiveness, then simpler architecture, then maintainable performant tools. Avoid persistence/services without product justification. Document significant choices in README and here.

## Repository structure
- `client/` frontend
  - `src/components/` UI screens + shared (RulesModal, LanguageSwitcher)
  - `src/components/cards/` React + Framer Motion card renderer (GameBoard, Hand, Card, CardBack, Deck, DiscardPile, PlayerSlot, TurnIndicator, AnimationLayer; `layout.ts` for pure pixel math)
  - `src/i18n/` i18n context, en/fr translations
  - `src/hooks/` WebSocket + Zustand store + `useElementSize` (ResizeObserver)
  - `src/types/` protocol types
  - `src/test/` Vitest unit tests
- `server/` authoritative game server
  - `game/` pure domain (room, deck, hand, rules, bot, event log)
  - `hub/` WS connection mgmt, rate limiting, session tokens, bot scheduling
  - `protocol/` wire types
- `e2e/` Playwright suite
  - `tests/`: game-flow, multi-client, mobile (Pixel 5), penalties, round-progression, reconnect, rematch, rules-coverage, special-cards
  - `helpers/game.ts` shared helpers (createRoom, drawAndPass, takeTurn, participateInTurns, setMatchFormat, waitForPendingDraw, waitForUnoDeclared, waitForRoundNumber, clickContinue, clickRematch)
  - `types.d.ts` `Window.__LOCO_E2E__` type
  - `playwright.config.ts`
- `shared/` protocol/types
- `docs/` supplemental
- root config / Docker / env

Update this section when structure changes.

---

## Scoring & match system
- `CardValue(c Card) int` (`game/card.go`): Number=face; Reverse=10; Skip=20; DrawTwo=30; Swap=30; GlobalSwitch=40; WildCard=40; WildDrawFour=50. Matches `docs/rules.md` §10.
- **Single-finisher round**: ends when any player empties hand. Winner: `Room.Winner`, `Room.RoundsWon[winnerIdx]++`, scores sum of opponents' remaining values. Others score 0; their hand value adds to `Room.LostHandTotal[i]` (tiebreaker only). No in-round spectating, placements, `Finished[]`, or `Placements[]`.
- `Room.endRound(winnerIdx)` finalises scoring, sets `RoundEnded=true`. Does NOT deal next round — hub calls `Room.BeginNextRound()` AFTER broadcasting `card_played` and `round_end` (otherwise the round-winning `card_played` reads the new round's discard top).
- Scores accumulate in `Room.Scores []int`. `Room.MatchOver`/`MatchWinner` indicate completion (resolved in `endRound`).
- Round starter: round 1 = random (`Room.rng`); subsequent = current biggest loser (lowest cumulative score; tie → lowest playerID via `Room.biggestLoser()`).
- Formats: BO1/3/5/7 (`game.MatchFormat`).
- Tiebreakers: highest score → most rounds won → lowest lost-hand total → sudden-death extra round.
- `determineMatchWinner()` returning `""` triggers sudden-death.
- Hub flow on round end: broadcast `round_end` (scoreboard, `RoundNumber`=just-completed) → `BeginNextRound` → `game_started` per player. On match end: `match_end` (scoreboard + match_winner).
- `PlayerDTO`: `Index`, `Nickname`, `HandSize`, `Connected` only.

## AFK auto-kick
- `hub.AFKKickThreshold` (var, default 4) consecutive turn-timeouts without voluntary action → kick (~2 rounds in 2-player).
- Bots exempt. Voluntary inbound (play_card, draw_card, pass_turn, declare_uno, catch_uno, counter_draw, interrupt_play) calls `hub.resetAFK(code, playerID)`.
- Kick: send `{type:"error", error:"afk_kicked"}`, close. Standard reconnect window applies.
- Tests override threshold (e.g. `1<<30`).

## Interrupts & batch play
- **Identical-card interrupt** (`Room.InterruptPlayCards`, alias `InterruptPlay`): non-current player plays N identical cards exactly matching top discard within `game.InterruptWindow` (1500ms). Effect applies from interrupter's seat; they become turn leader. Wild/WildDrawFour/GlobalSwitch can't interrupt. Rejected if pending draw, or self-interrupt.
- **Batch interrupt**: send N copies via `play_cards: [...]`. Effects stack (N DrawTwo = `2*N` pending; N Skips skip N players; N Reverses parity-flip). Swap and GlobalSwitch can't batch.
- Window state on `GameState`: `LastPlayBy` (-1=closed), `LastPlayAt`, `InterruptDeadline`. Armed by `armInterruptWindow(actor)` after `PlayCard`/`PlayCards`/`InterruptPlayCards`. Closed by `closeInterruptWindow()` on `DrawCard`/`PassTurn`/round-winning play/round end. Opening discard does NOT arm.
- Resolution: fastest-server-received wins (single-goroutine event loop serializes).
- Wire: `interrupt_play` (legacy) + `interrupt_play_card` both accepted. Body: `{ card?, play_cards? }` — `play_cards` non-empty takes precedence. Server emits `interrupt_success { player_index, cards[] }` immediately before `card_played` for distinct lead-taking visuals.
- **Batch play** (`Room.PlayCards`): current player plays N identical via `play_cards` (precedence over `card`). Effects stack (DrawTwo `2*N`, WildDrawFour `4*N`, Skips skip N, Reverses parity). Swap/GlobalSwitch excluded.

## Deck
- 112 cards (`game/deck.go: NewDeck`). Per color (R/Y/G/B) 25: 1–9 ×2 (no 0), Skip ×2, Reverse ×2, DrawTwo ×2, **Swap ×1 (colored)**.
- Wilds (12): Wild ×4, WildDrawFour ×4, **GlobalSwitch ×4**.
- `Card.IsWild()` true only for Wild/WildDrawFour/GlobalSwitch. **Swap is colored** — normal matching.
- Initial hand: **8** (`initialHandSize` in `game/room.go`).
- Opening discard must be a Number (action/wild/Swap skipped during deal).
- GlobalSwitch passes hands to next seat in current game direction.

## Swap / GlobalSwitch notifications
- `card_played` includes `chosen_player` ONLY for `swap` (target's index). Omitted for everything else (incl. `global_switch`).
- `card_played` includes `direction` (1=cw, -1=ccw) — the post-effect play direction, populated on every play (not just Reverse). Lets clients update the direction indicator immediately without waiting for the next `game_state`. Client `applyCardPlayed` writes it to `direction` and uses it for the swap/global_switch notice arrow.
- Client `applyCardPlayed` derives `swapNotice` (`useGameStore.SwapNotice`) when `card.kind` is `swap`/`global_switch`. Carries `kind`, `actorIndex`, `targetIndex` (-1 for global_switch), `direction` (game direction at play, picks GS arrow), `at` (Date.now() — React render key).
- `GameView` shows via `styles.swapNotice` (purple-glow pill above action bar), auto-clears after `SWAP_NOTICE_MS=3500`. i18n keys: `swapNotice`, `swapNoticeYouActor`, `swapNoticeYouTarget`, `globalSwitchNoticeCw`, `globalSwitchNoticeCcw` (`%actor`/`%target`).
- `<GameBoard />` watches `swapNotice.at` and spawns Framer Motion mini card-back trails (actor↔target for swap, chained seat→next-seat for global_switch) via `<AnimationLayer />`.

## Rematch (end of match)
- `rematch` (host-only, client→server) reopens a finished room as a lobby. Server replies **per recipient** with `rematch_started { room_code, player_id, players, match_format, max_players }`.
- `Room.ResetForRematch()` (`game/room.go`): requires `StatusFinished`. Clears `State`, `Winner`, `RoundEnded`, `MatchOver`, `MatchWinner`, `RoundNumber`, and nils `Scores`/`RoundsWon`/`LostHandTotal` (so `Start()` reallocates them sized to the roster present at that moment). Keeps `Players`, `Format`, `MaxPlayers`.
- `hub.handleRematch` first calls `pruneAbsentPlayers` — drops every seat with a nil `roomMembers` entry that is not in `botSlots` (i.e. humans who never came back), high→low, re-indexing `roomMembers`, surviving `Client.playerID`, `botSlots`, `sessionTokens`. **This is why `rematch_started` is per-recipient: playerIDs can shift.** Then deletes `turnStartedAt`, `afkTimeouts`, `disconnectedAt`, `emptyRooms` for the code.
- **A finished room's roster is mutable, exactly like a lobby.** `RemoveLobbyPlayer` accepts `StatusFinished`, and `handleDisconnect` routes the finished-room case through `reindexLobbyDisconnect` (+ `player_left` broadcast). Without this a phantom player would be dealt a hand in the rematch.
- Client: `applyRematch(myIndex, players, format, maxPlayers)` wipes all match state → `screen:'waiting'`. **Keeps `sessionToken`** (same room, still valid for reconnect during the next match). `App` adopts the server's `player_id`.
- `store.setPlayers` re-resolves `myIndex` by matching our own nickname in the incoming roster. Server-side re-indexing (lobby or finished-room disconnect) otherwise leaves a stale index, so a promoted player would never get host controls — e.g. the host leaves the game-over screen and nobody can rematch. Nicknames are unique per room, so the match is unambiguous.
- `GameOver` takes `isHost` + `onSend`: host sees a Rematch button, others `rematchWaiting` text; both get `leaveRoom` (reloads). i18n keys: `rematch`, `rematchWaiting`, `leaveRoom`.
- Bots survive a rematch. `nextBotName` scans for the lowest free `BotN` rather than counting seats, so the first bot is `Bot1` and a surviving bot can't cause a duplicate-nickname `Join` failure.

## Lobby config
- Host messages: `set_match_format`, `set_max_players` (lobby only).
- Max players: `serverMinPlayers`(2) ≤ n ≤ `serverMaxPlayers`(10); cannot drop below current count.
- Any change → broadcast `lobby_config_changed` (match_format, max_players).
- `room_created`/`room_joined` include `match_format` + `max_players`.
- Defaults: BO1, 10 max.
- **Lobby disconnect re-indexes everything.** `Room.RemoveLobbyPlayer` removes + re-indexes `Player.Index`; hub re-indexes `roomMembers`, surviving `Client.playerID`, `botSlots[code]`, `sessionTokens[code]`. First remaining player is always playerID 0 (host).
- Lobby disconnect leaving no humans → schedule cleanup immediately.

## Room codes
- 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I/l).
- `generateCode()` retries on collision. ~1B combos.

## Mobile
- All action buttons: `min-height:44px`, `touch-action:manipulation`.
- 400ms debounce (`guardDoubleTap`) on action buttons.
- Wild picker: 64px+ touch targets in a row.
- HTML viewport: `user-scalable=no`, `maximum-scale=1.0`.
- CSS `@media (max-width:480px)` for small screens.

## Bots
- Host adds via `add_bot`. Named by `nextBotName(room)` — lowest free `Bot1`, `Bot2`, … (scans, does not count seats).
- AI: `game/bot.go` `BotThink(state, playerIdx) BotAction`.
- Scheduled via `botMove` channel with `botThinkDelay=800ms`.
- Auto-declare UNO when playing to 1 card.
- Tracked in `hub.botSlots[code][playerID]`.

## Game event log
- `GameState.EventLog []GameEvent` append-only.
- Recorded inside domain methods (`PlayCard`, `DrawCard`, `PassTurn`, `DeclareLastCard`, `CatchUndeclared`, `CounterDraw`, `Start`).
- `GameEventDTO` in `GameStateDTO`, delivered on reconnect.
- Timestamps UTC (`time.Now()`); wire = Unix ms.
- `playerGameState` caps export to last 50 (`maxEventLogExport=50`).

## Session tokens
- 32 hex chars (128-bit `crypto/rand`).
- Issued in `room_created`/`room_joined`. Client must include `session_token` in reconnect `join_room`.
- Invalid/missing → error, slot not reclaimed.
- `hub.sessionTokens` cleaned up on room delete.

## Rate limiting
- Token bucket per client: 10/s refill, burst 20.
- `hub/client.go` `rateLimiter` (thread-safe).
- Drops → `error` server message. Per-connection, not per-identity.

---

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
- `webServer` env vars go in `playwright.config.ts`'s `env` object, **not** a `VAR=x cmd` shell prefix — the prefix form is POSIX-only and breaks when the suite runs from Windows.
- Prefer `waitForFunction` + store state over DOM polling. Few high-value tests > many fragile.
- **Update E2E in same commit as gameplay/UI/protocol changes.**
- Canvas not inspected; verify via DOM (ActionBar, RoundSummary, GameOver) + `__LOCO_E2E__.getState()`.

---

## CI/CD
Pipeline: `.gitlab-ci.yml`, stages `test → build → deploy`.
- `test` (every push):
  - `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` + builds `server-bin`.
  - `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
  - `e2e_test` (`mcr.microsoft.com/playwright:v1.52.0-jammy`): runs server-bin + Playwright; `needs: [backend_test, frontend_test]`.
- `build` only on `develop` or `v*` tags, after tests pass.
- Deploy: `devops` runner tag + GitLab registry. `deploy_dev` auto on `develop`; `deploy_prod` auto on `v*`; `stop_dev` manual.

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

## Linting
- Client: ESLint v9 flat config (`eslint.config.js`). `npm run lint` / `lint:fix`.
- Rules: `@typescript-eslint/recommended`, `react-hooks`, `react-refresh`. `no-unused-vars: error` — prefix `_` to silence.
- CI: lint runs before tests.
- Server: `golangci-lint` (`server/.golangci.yml`) — errcheck, govet, ineffassign, staticcheck, unused, gosimple, misspell, unconvert, bodyclose. CI job `backend_lint` uses `golangci/golangci-lint:v1.64-alpine`. Run locally via `make lint-server` (docker, no host Go required).

## Protocol validation (client)
- `client/src/types/protocolSchemas.ts` defines Zod schemas for inbound `ServerMsg`. `client/src/types/protocol.ts` infers `CardDTO`/`PlayerDTO`/`GameStateDTO`/`ServerMsg`/etc. from the schemas — single source of truth.
- `useWebSocket` runs `serverMsgSchema.safeParse` on every WS payload. In dev: invalid → log + drop (surfaces Go↔TS drift in tests). In prod: log + pass through (forward-compat with new server fields).
- `ClientMsg` stays hand-typed (we control what we send).
- When you change `server/protocol/messages.go`: update `protocolSchemas.ts` for any inbound shape changes (inferred types follow). `client/src/test/protocolSchemas.test.ts` exercises the schema.

## Makefile
- Root `Makefile` has docker-first targets so Go isn't needed on host: `make dev`, `make down`, `make test`, `make test-server`, `make test-client`, `make test-e2e`, `make lint`, `make lint-server`, `make lint-client`, `make build-server`, `make build-client`. `make help` lists them.

## Player bubble (`<PlayerSlot />`)
- 172×66 pill positioned via `opponentBubblePositions(...)` (upper arc, clockwise from local seat).
- Active turn: blue background + 2px ring + dot above the pill, bold blue label.
- Disconnected: dark-grey bg, grey label, `"nickname ✗"`.
- Mini card-back fan inside the pill (max 9 visible, rotation ±14°/±8°/0° depending on count, "+N" overflow label).

## Card rendering layer (React + Framer Motion)
- `<GameBoard />` is the root; it tracks container size via `useElementSize` (ResizeObserver) and passes width/height to children that absolute-position in pixel coords.
- Layout helpers (`src/components/cards/layout.ts`): `clockwiseOpponents`, `opponentBubblePositions`, `calcHandSlots`, `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys` — all pure, reused by tests and animations.
- Animations live in `<AnimationLayer />`: an array of `Flier` items (flying card faces or backs) plus `EffectText` floats. Each entry self-cleans via `onAnimationComplete` → parent `removeFlier`/`removeEffect`.
- Animation triggers (inside `<GameBoard />`), in effect-declaration order:
  - **Opponent play**: keyed on `lastPlay.at`; flies the card from `seatPosition(actor)` to the discard with `arcHeight`. Skipped when the actor is the local player. Sets `suppressNextDiscardFx`.
  - **Card play (own)**: `handleCardClick` wraps the parent callback, computing the source slot from `calcHandSlots` and spawning an arced hand→discard flier before invoking parent. Sets `suppressNextDiscardFx`.
  - **Discard top change (any source)**: `suppressNextDiscardFx` suppresses **only the generic pile flier**, never the SKIP/REVERSE/+N callout — playing your own Skip must announce itself too. Callout text from `effectFor(card, pendingDraw)`.
  - **Hand grew by 1**: deck→last-slot card-back flier (draws).
  - **Swap / GlobalSwitch**: trails spawned on `swapNotice.at` change.
- Hover lift: CSS-only (`Hand.module.css`) — `.slot.hovered .card { transform: scale(1.08) translateY(-14px) }`.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`, `PlayerSlot .slot`) is pinned at `left:0;top:0` in CSS and positioned by framer-motion `x`/`y`. Animating `left`/`top` runs layout every frame and visibly stutters once several cards move at once.
- **A node's transform has exactly one owner.** If framer-motion animates a node's transform, its CSS must not set `transform` (and vice-versa). Where a static offset is also needed — centering the effect text, centering the turn indicator — use an outer anchor div for the CSS transform and an inner motion node for the animation (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card` for the same reason.
- **Layout math is radians; framer-motion `rotate` is degrees.** Convert at the render boundary with `radToDeg` (`cardTheme.ts`). Passing radians straight to `rotate` silently flattens every rotation.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (card flights), `SPRING_HAND` (fan reflow), `DEAL_STAGGER_MS`.
- **Hand keys come from `handCardKeys(hand)`**, not the array index — occurrence-numbered card identity. Index keys make React reuse the wrong node when a card leaves the middle of the fan, so the survivors snap instead of sliding into the gap.
- `Hand` staggers cards in only when the hand grows **from empty** (a deal). Any other growth is a draw, which already has its own deck→hand flier.
- `DiscardPile`: 2 static neutral under-layers for pile thickness (deliberately untinted — the active-colour ring owns the colour there) + top card keyed on `cardKey(card)` so each new top card remounts and replays a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` is set by `applyCardPlayed` and exists **only** for animation. Never read it for rules decisions.

### Reduced motion
- `<MotionConfig reducedMotion="user">` in `main.tsx` covers framer-motion; a `@media (prefers-reduced-motion: reduce)` block at the end of `styles/tokens.css` neutralises CSS transitions/animations globally.
- When adding motion, verify it degrades to a readable static state rather than disappearing.

## Reconnect visual recovery
- On `player_reconnected`: store `isReconnecting:true` before applying state.
- `useReconnectAnimation(isReconnecting, onComplete)` shows "Rebuilding table…" overlay for 600ms then calls onComplete (which clears `isReconnecting`).
- `<GameBoard />` hides its children while reconnecting; on the false→true→false transition it bumps an internal `rebuildKey`, replaying a 350ms board fade-in CSS keyframe.
- Visual only; server is authoritative.

## Client transport
- `useWebSocket.send(msg)` queues to `pendingRef: ClientMsg[]` when not OPEN; FIFO flush on `onopen`.
- Auto-reconnect: linear backoff `2s × min(attempts, 4)`, cap 10. `attemptsRef` resets on `onopen`.
- `getReconnectMsg`: `screen==='game'` → token-auth `join_room` reclaim; `screen==='waiting'` → plain nickname `join_room` (best-effort; may fail with "nickname already taken" → reload).
- `App.handleMessage` deps `[]`. Branches needing CURRENT store values use `useGameStore.getState()`. Stable Zustand actions safe.
- React renderer relies on Zustand selector equality; expensive re-renders are avoided via stable references in the store.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard)`.
- Computes per-player `round_points` as `newScore - prevScore` from pre-round scoreboard, stores `roundScores: RoundScoreEntry[]`, sets `showRoundSummary:true`.
- If `game_started` arrives while showing → buffer in `pendingGameState`.
- `GameView` shows: round n/total, winner, per-player breakdown sorted by placement, points (delta), cumulative score, wins, full match scoreboard (BO3+).
- "Continue (Ns)" → `dismissRoundSummary()` (applies buffered state, clears summary). Auto-dismiss at 8s.

## Metrics
`GET /metrics` returns JSON:
- Gameplay: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`.
- Health: `uptime_sec`, `goroutine_count` (low + stable).
- `messages_rate_limited` — sustained growth = abuse / too-tight burst.
- `messages_dropped_busy` — should be ~0; non-zero = hub overloaded.
- `slow_clients_closed` — per-client send buffer overflow → forced close (client into reconnect path). Sustained growth = broadcast rate too high or many bad connections.
- `channel_retries` — botMove/expire/cleanup channel-pressure retries; ~0 healthy.
- `suspected_cheats` — clients with ≥`suspectThreshold` rejections in 30s; one inc per burst. Investigate `WARN suspected cheat` log (`conn=`, `code=`).
- `reconnect_expirations` — disconnected players whose 60s window expired.
- `debug_mode_active` — reflects `LOCO_E2E=1`. MUST be `false` in prod; `main.go` logs startup `WARN` if set.

All counters atomic on `Hub`; `GetMetrics()` reads outside event loop. `statMatchesStarted` inc'd in `handleStartGame` (per `start_game`, not per round). `statMatchesFinished` inc'd in `handleRoundOrMatchEnd` when `MatchOver`. `statBotsActive` inc in `handleAddBot`, dec in `deleteRoom` by bot count.

## Client protocol coverage
- New inbound message types must be added to `serverMsgTypeSchema` in `protocolSchemas.ts` or `useWebSocket` drops them in dev. New outbound types go in `ClientMsgType` (`protocol.ts`).

## Room lifecycle cleanup
- `hub.EmptyRoomTimeout` (var, default 5min) — empty room retention.
- `hub.ReconnectTimeout` (var, default 60s) — disconnected-in-game slot hold.
- Both vars exported for test override; restore via `t.Cleanup`.
- Empty room (last lobby/finished member leaves, or all in-game slots nil) → `scheduleRoomCleanup(code)`.
- `scheduleRoomCleanup`: records `emptyRooms[code]=time.Now()`, `time.AfterFunc` fires `cleanupMsg` after timeout. Channel-full → retry once after 30s, then `WARN`.
- `handleCleanup`: deletes only if `emptyRooms[code]` still matches recorded time (race-safe).
- Rejoin/reconnect calls `delete(h.emptyRooms, code)`.
- `deleteRoom(code)`: single deletion point; cleans hub maps, adjusts `statRooms`/`statBotsActive`, structured log.

## Server stability
- Deferred async = `time.AfterFunc` (not `go func{Sleep;send}`).
- Critical channel sends (botMove/expire/cleanup) retry once on full, then `WARN`. Rationale:
  - `botMove` retry 1s — drop stalls game.
  - `expire` retry 5s — drop leaves slot in `disconnectedAt` forever.
  - `cleanup` retry 30s — drop leaks empty room.
- Non-critical sends (per-client `send`, `inbound`) = non-blocking drop + client notification.
- **`Client.SendBytes` force-closes WS when send buffer (cap 256) fills.** Silent drop would desync client; close → readPump exit → unregister → reconnect window → auto-reconnect → `handleReconnect` snapshot. Inc `slow_clients_closed`.
- **Broadcasts marshal once.** `broadcastToRoom` does `json.Marshal(msg)` once, fans `[]byte` via `Client.SendBytes`. Per-recipient personalised payloads (game_state/game_started/private card_drawn) precompute `pl := h.playerList(room)` and call `playerGameStateUsing(room, idx, pl)` so `playerList` built once per broadcast.
- `readPump` sends to `h.inbound` non-blocking; drops notify "server busy". Prevents readPump parking on full channel deadlocking `unregister` (cap 16).
- Every scheduled callback (`executeBotMove`, `handleExpireReconnect`, `handleCleanup`) re-checks current state, logs skip reason.
- `http.Server`: `ReadHeaderTimeout:10s`, `IdleTimeout:60s`.
- Goroutine stability tests in `hub/hub_test.go`: `TestGoroutineStability_RoomLifecycle`, `_BotGame`, `_FullLifecycle`.
- `playerGameState(room, playerIdx)` defensive: nil `room.State`, OOB `playerIdx`, empty discard → minimal `GameStateDTO` + `WARN` (not panic — would kill hub goroutine).

## Structured logging
- Stdlib `log` to stdout. `key=value` single line, e.g. `room created code=ABC123 host=Alice`.
- Every connection-scoped line: `conn=<8-hex>` (per-`Client` random ID via `generateConnID` in `newClient`). Room-scoped also: `code=<6-char>`.
- Events: connected (conn, addr), disconnected (conn, code, nickname, playerID), reconnected, reconnect window expired, room created/deleted, match started (count, format), match finished (winner), WS upgrade errors, callback skips with reason, channel-pressure (`WARN`), **suspected cheat (`WARN suspected cheat ... conn=<id> code=<code> player=<idx> last_reason=<msg>`)**, slow client (`WARN slow client ...`).
- `WARN debug mode enabled (LOCO_E2E=1) ...` once at startup if gate on. Prod must never see this.
- No sensitive data (tokens, hands) in logs.

## i18n
- `client/src/i18n/en.ts` (source of truth) + `fr.ts`. `Translations` interface in `en.ts` reused as type — missing keys = TS error.
- `I18nProvider` (`client/src/i18n/index.tsx`) wraps app in `main.tsx`. `useI18n()` → `{ lang, t, setLang }`.
- Detect order: `localStorage('loco_lang')` → `navigator.language` prefix (`fr` → French, else English).
- `setLang` persists to localStorage + syncs `document.documentElement.lang`.
- Add language: create `xx.ts` impl `Translations`, add to `translations` map in `index.tsx`, add `{code, label}` to `LANGS` in `LanguageSwitcher.tsx`.
- `rules`: `readonly RulesSection[]` rendered by `RulesModal`.
- Storage key: `'loco_lang'`.

## Rules modal
- `RulesModal` accessible from Lobby + WaitingRoom (top-right) and GameView (action bar "Rules").
- Close: ✕, footer Close, backdrop click, `Escape`.
- Mobile (`max-width:480px`): bottom sheet (bottom border-radius 0, max-height 92vh).
- `document.body.style.overflow='hidden'` while open; restored on unmount.
- Content lives in translations; component is content-agnostic.

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

---

## Future Claude session checklist
1. Read this file. 2. Read `README.md`. 3. Inspect structure. 4. Identify doc drift. 5. TDD non-trivial. 6. Update docs in same change set.

Never let `CLAUDE.md` / `README.md` go stale.

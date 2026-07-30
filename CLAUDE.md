# CLAUDE.md

## Mission
Premium real-time multiplayer UNO-style card game **built to be streamed**. Goals: low-latency
multiplayer, nickname-only access, server-authoritative anti-cheat, polished visuals *and* audio,
strong test coverage (TDD), docs in sync, Dockerized.

Streamability is a product requirement, not decoration: every state must be readable at 720p by a
viewer who is not playing, and the game's big moments (interception, UNO, victory) must be legible
in a clipped highlight with the sound muted.

## Non-negotiables
- No login/signup/OAuth — nickname only.
- Server authority is mandatory; never trust client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.
- `README.md` and `CLAUDE.md` must stay in sync with the codebase.

## LOCO deviations from original SOLO rules
Authoritative spec: `docs/rules.md` §14. Summary of intentional deviations:
1. **GlobalSwitch (Change Cards All Round) is wild** — 4 copies, no color, plays on anything, and names the new active colour like the other two wilds. SOLO has it as colored 1-per-color. Implemented in `game/deck.go` (4 wild copies) and `game/card.go` `IsWild()`. Rationale: simpler, avoids dead cards.
2. **Starting card is always a Number** — `dealRound` skips action/wild cards until a Number is found (`game/room.go`). SOLO applies the starting action's effect to the first player. Rationale: avoids first-turn ambiguity (Take 4 with no context, Swap with empty game state).
3. **Best-of-N match format**, not 600-point threshold — BO1/BO3/BO5/BO7 (`game.MatchFormat`). Game ends when one player wins the majority of rounds. Rationale: predictable online game length.
4. **Voluntary draw is allowed** — current player may draw even with a playable card in hand (still 1 draw max per turn). `Room.DrawCard` only enforces `HasDrawn` to prevent a second draw. Rationale: strategic depth; matches UNO official rules.
5. **A forced draw does not cost the turn** — the victim of a +2/+4 stack takes the whole accumulated amount and then plays normally (or passes). `Room.DrawCard` sets `HasDrawn` in both branches and never advances `CurrentTurn`; nothing but `PlayCard`/`PassTurn`/an effect moves the turn. **`hub.handleDrawCard` re-arms the turn timer on every draw** — the domain kept the turn but the clock was still the one armed when the +2 landed, so a victim who took a few seconds to decide against countering drew the stack and was auto-passed right after: the deviation held on paper and the seat still vanished. One draw per turn bounds the extension. Rationale: cards *and* turn for one played card is two punishments, and it reads as a bug — the hand jumps and the seat is gone before the player can act. Stacking (`CounterDraw`) is still how you avoid drawing at all.
6. **A missed Contre-LOCO! costs the caller 1 card** — the call only lands inside the target's 5s
   window and is refused *and* charged when the target's own LOCO! got there first, when its hand
   grew, or when the window had already closed. SOLO ignores an unfounded call. `failedCatchPenalty`
   + `Room.PenalizeFailedCatch`; see "LOCO! declaration & catch windows" and `docs/rules.md` §14.6.
   Rationale: an unpriced button is free to mash, so the reaction stops being one.

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

Required coverage: room create/join, nickname entry, game start, turn progression, legal/illegal moves, skip/reverse/draw/wild, draw penalties, win detection, last-card declaration, counter/catch windows, simultaneous resolution, reconnect (60s, nickname+room_code), rematch (host-only, seat pruning, re-indexing), protocol validation/rejection, seat layout at every table size and viewport, state→sound mapping, score table (round history, ping banding, TAB hold vs pinned), link-preview tags vs the committed `og.png`, map draw + the loading gate (refusal while shut, timeout, disconnect, rematch re-arm) and `tableImageRect` at every board size.

Keep tests fast, targeted, non-brittle. Cover game rules > UI details.

Review layout/colour/motion changes with `make visual` — reading four contact sheets catches what no
assertion was going to describe (a clipped heading, a theme that never applied, seats overlapping the
header). Assertions still own behaviour; screenshots own appearance.

Beware assertions that only restate the fixture. An E2E test once sent an interrupt, then asserted
the discard and turn that `debug_set_state` had itself just configured — it passed for months while
the server rejected every interrupt with "interrupt window closed".

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
  - `src/components/` UI screens + shared (RulesModal, LanguageSwitcher, AudioSettings, InterruptBanner, Confetti, ScoreTable + `scoreTableModel.ts`, `playerColors.ts`, `LocoLogo.tsx`)
  - `src/components/cards/` React + Framer Motion card renderer (GameBoard, Hand, Card, CardBack, Deck, DiscardPile, PlayerSlot, TurnIndicator, DirectionRing, AnimationLayer; `layout.ts` for pure pixel math, `CardArt.tsx` + `locoMark.ts` for the card face itself, `maps.ts` for the four rooms)
  - `src/audio/` `engine.ts` (context/buses/settings), `sfx.ts` (synthesised one-shots), `music.ts` (the bed *engine*), `tracks/` (the music itself, as data), `useGameAudio.ts` (store→sound bridge)
  - `src/dev/` dev-only visual showcase (`scenes.ts` registry + `Showcase.tsx` + `CardSheet.tsx`, the whole deck on one screen), tree-shaken from prod
  - `public/` `favicon.svg` + `apple-touch-icon.png` + `og.png` (the link preview, generated: see "Link preview"), all three from the LOCO mark; `maps/<id>/{room,table}.webp` (see "Maps")
  - `src/styles/tokens.css` design tokens — single source of truth for colour/type/shape/motion
  - `src/i18n/` i18n context, en/fr translations, `serverErrors.ts` (server prose → player voice)
  - `src/hooks/` WebSocket + Zustand store + `useElementSize` (ResizeObserver) + `useTheme` (`initTheme()` runs in `main.tsx`) + `useHeldKey` (hold-to-show) + `useDrainBar` (countdown bars, render-free) + `useMapPreload` (map art, decode-aware)
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
- `tools/lib/vite.mjs` shared dev-server boot for both capture harnesses
- `tools/visual/shoot.mjs` screenshot harness (boots Vite, walks the scene registry, writes `.visual/`)
- `tools/og/shoot.mjs` link-preview generator (renders the `og-card` scene → `client/public/og.png`)
- `tools/maps/prepare.mjs` map art cropper/encoder (→ `client/public/maps/`, see "Maps")
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
- **Identical-card interrupt** (`Room.InterruptPlayCards(playerIndex, cards, chosenColor, chosenPlayer)`, alias `InterruptPlay`): **anyone** plays N identical cards exactly matching top discard. Effect applies from interrupter's seat; they become turn leader.
- **There is no deadline and no excluded player.** The player who just played may take the lead back with a second copy, and so may the current player. Everything is a race decided by arrival order. Removing those two restrictions is what makes the mechanic feel realtime instead of turn-based — do not reinstate them.
- **Every kind can interrupt, wilds included**: Wild on Wild, WildDrawFour extends a +4 chain, GlobalSwitch rotates hands from the interjecter's seat. Wilds share `Color: Wild`, so plain equality still keeps a Wild off a WildDrawFour. **Every** wild interject must name a real colour (`chosenColor != Wild`), GlobalSwitch included.
- **Batch interrupt**: send N copies via `play_cards: [...]`. Effects stack (N DrawTwo = `2*N` pending; N Skips skip N players; N Reverses parity-flip). Swap and GlobalSwitch can't batch (which target? how many rotations?).
- During a draw chain (`PendingDraw > 0`) only DrawTwo/WildDrawFour may interject — implied by identical-to-top in a consistent state, kept explicit as a guard.
- Window state on `GameState`: `LastPlayBy` (-1=closed), `LastPlayAt` (informational). Armed by `armInterruptWindow(actor)` after `PlayCard`/`PlayCards`/`InterruptPlayCards`/`CounterDraw`. Closed by `closeInterruptWindow()` on `DrawCard`/`PassTurn`/round-winning play/round end. Opening discard does NOT arm.
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
- **GlobalSwitch names a colour like every other wild**: it opens the `<ColorPicker />` before the
  card leaves the hand, and `ApplyEffect` writes the choice. It used to be the one wild that chose
  nothing (the colour in play carried over): a card that rearranges the whole table and then leaves
  its most consequential outcome to whatever happened to be on the discard reads as an unfinished
  card, not as a rule. Every entry point rejects a colourless one: `PlayCard`, `PlayCards`,
  `CounterDraw`, `InterruptPlayCards` (`must choose a color for a wild card`) and `dtoToCard` at the
  wire boundary.
- `Wild` must never reach `State.ActiveColor`: it matches no coloured card, so the whole table is
  left holding wilds as its only legal plays and the discard's colour ring goes purple-for-nothing.
  `setActiveColor` still guards it as a last line of defence, and `applyCardPlayed` ignores an
  incoming `active_color:"wild"` client-side.
- **A card landing closes any open picker** (`GameView`, effect on `lastPlay.at`). The case that
  forced it: you tap a GlobalSwitch, the colour prompt is up, and somebody interjects a second one.
  The board under your prompt no longer exists (the lead, the discard and the colour are theirs), so
  a choice made against it would only earn a server rejection. Same for `<PlayerPicker />`.
- **A draw never fails.** `ensureDeck` reshuffles the discard, then `Deck.DrawUpTo` hands over
  whatever is left — possibly nothing, once every card sits in a hand. `DrawCard` sets `HasDrawn`
  either way and `hub.handleDrawCard` passes the turn when zero cards came out. Returning an error
  instead froze the round permanently: the drawer had no legal card, could not draw, and `PassTurn`
  requires `HasDrawn`, so no player had a legal action; the turn timer returns without re-arming on a
  failed auto-draw, and a bot in that seat re-scheduled itself every 800ms forever. The UNO-catch
  penalty shrinks the same way rather than voiding the catch.

## Answering a draw stack
`PlayCard` refuses every card while `PendingDraw > 0` ("must counter or draw pending penalty cards
first") — stacking a +2/+4 is a **separate message**, `counter_draw`. `GameView.handleCardClick`
routes the tap there whenever `pendingDraw > 0` (the wild picker carries a `counter` flag for +4).
Sending `play_card` looked legal client-side, flew the card, and bounced: the mechanic was
unreachable for humans while bots used the domain call directly. The E2E test now taps through
`handleCardClick` instead of sending `counter_draw` down the socket, which is why it stayed green.

**A counter is the same card — same kind *and* same colour** (`Room.CounterDraw`, mirrored by
`isCounterCard`). Every +4 is Wild-coloured, so the colour test is free on a +4 chain. An off-colour
+2 is not a dead card: the forced draw does not cost the turn (deviation 5), so its holder takes the
stack and then plays it as an ordinary kind-match on the very same discard. That two-step path is
what the rule buys, and it is E2E-tested — refusing the tap under the penalty *and* accepting it
after the draw.

`<TurnIndicator />` takes `canCounter` and only then says "or counter!" (`drawOrCounter`); otherwise
it asks for the draw alone (`drawPenalty`). Only the same card stacks — a +4 does not answer a +2,
and a blue +2 does not answer a red one — so most hands cannot counter, and announcing it
unconditionally sent players tapping cards that
were never going to leave. `canCounter` is `pendingDraw > 0 && hasPlayableCard`: while a penalty is
pending the only legal cards are the ones that stack it, so the two questions are the same one.

## LOCO! declaration & catch windows (per seat)
- **Receiving your last card owes the table a declaration, exactly like playing down to it**
  (`docs/rules.md` §8, §11.1). What the rule protects is the table's right to know somebody is one
  card from winning; a hand that arrived by rotation is one nobody has heard announced.
- **The tracking is per seat**: `GameState.LastCardDeclared []bool` + `LastCardAt []time.Time`,
  sized in `dealRound`. A single `LastCardPlayer` slot cannot express the board a Swap produces: it
  puts **two** players on one card in the same instant (the actor took the opponent's single card,
  the opponent took the actor's leftover), and a GlobalSwitch can put more. With one slot all but
  one walked free.
- `PlayCard` / `InterruptPlayCards` call `openCatchWindowsAfterRearrange()` after a Swap or a
  GlobalSwitch (every seat at 1 card, **including one that declared a beat earlier**, since the card
  it declared for is not the card it now holds) and `updateLastCardState(actor)` otherwise.
- `CatchUndeclared` is per target and refuses self-catching. `GameState.CatchableTargets(now)`
  returns the open windows oldest-first; `hub.maybeScheduleBotCatch` schedules one attempt per
  target, and `handleBotCatch`'s stale check compares `LastCardAt[target]`.
- Wire: `catch_uno` carries `target_index` (the catcher names the seat). Absent = the window closest
  to expiring, which is the catch about to be lost.
- **A Contre-LOCO! that misses costs its caller 1 card** (`docs/rules.md` §14.6,
  `failedCatchPenalty`). Without a price, mashing the button at every seat holding one card is free
  and therefore always correct, which turns the game's hardest reaction into a reflex nobody has to
  aim. The three misses are all timing (`game.IsMissedCatch`): the target declared first
  (`ErrAlreadyDeclared`), its hand grew (`ErrTargetNotSingleCard`), the window closed
  (`ErrCatchWindowExpired`). Those are **sentinels, not new strings** — the wire text is unchanged;
  what is new is that the hub can tell a lost race from an invalid target.
  - `Room.PenalizeFailedCatch(catcher)` draws the card and touches **nothing else** — not the turn,
    not `HasDrawn`, not the target. A failed call is a side bet on somebody else's obligation and its
    caller may not even be in turn. Like every draw it cannot fail: with every card in a hand the
    caller simply gets away with it (see "A draw never fails").
  - `hub.penalizeFailedCatch` broadcasts `catch_failed { player_index }` (the *caller's* seat) then
    `sendHandGrowth`. Both the human path (`handleCatchUno`) and the bot path (`handleBotCatch`) go
    through it — a bot that mistimes pays the same price, or the two are playing different games. A
    miss deliberately does **not** `noteSuspect` and sends no error toast: the button was armed when
    it was pressed, and the client shows the penalty itself.
- **The client spends the catch button on press, not on the reply** (`noteCatchAttempt` sets
  `CatchWindow.attempted`, which `deriveCatch` skips). The server answers a round trip later, and now
  that a miss costs a card, a window left armed in the meantime lets one impatient double tap pay
  twice for a single opinion. The 400ms `guardDoubleTap` is not that window. The window itself stays
  open — it is still somebody else's obligation, and another player can still take it.
- `store.catchFailed { seat, at }` (set by `applyCatchFailed`) drives a red pill in `<GameView />`,
  auto-cleared after `CATCH_FAIL_NOTICE_MS=2800`, plus the `penalty` sting in `soundsForTransition`.
  The penalty reads as an ordinary draw otherwise, which is exactly the wrong story: the card was a
  price paid, not a turn taken. i18n keys `catchFailedYou` / `catchFailedOther` (`%player`); scene
  `game-catch-failed`.
- **`ServerMsg.PlayerIndex` is a `*int`, for the same reason as `PendingDraw`/`HasDrawn`.** As a
  plain `int` with `omitempty` it dropped seat **0** — the host's seat — off the wire, and the client
  reads `player_index ?? -1` on `uno_declared`: the declaration closed the catch window of seat -1,
  so Contre-LOCO! stayed armed for the full 5s on a player who had already called it and the server
  refused every tap with "player already declared". The same message also drove the banner's name
  and `myDeclared`, so seat 0's own LOCO! button never went out either. Read it with
  `ServerMsg.Seat()` (-1 = the message names no seat); `protocol/messages_test.go` pins seat 0 onto
  the wire for every message type that carries one.
- Client mirrors it: `useGameStore.catchWindows: { seat, endsAt }[]`, with `catchTarget` /
  `unoTimerEnd` **derived** (`deriveCatch`: most urgent opponent window, never our own seat) so
  `<ActionBar />` and the timer bar stay single-target. `closeCatchWindow(seat)` on
  `uno_declared` / `uno_caught` retires one seat only; `pruneCatchWindows()` drops expired ones and
  promotes the next.
- **A hand that grows closes that seat's window** (`applyCardDrawn`). `CatchUndeclared` refuses any
  target that no longer holds exactly one card, so a window kept open past a draw is a Contre-LOCO!
  button armed on a tap that can only come back refused.
- **`applyGameState` filters catch windows, it does not wipe them.** Swap and GlobalSwitch are
  followed by a personalised `game_state`, so clearing there made the exact rule this exists for
  unreachable: the player handed their last card was catchable for a few milliseconds and then
  untouchable. A window survives only while unexpired *and* its seat still holds one card, so a
  fresh deal still clears everything.

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

## Action bar (`<ActionBar />`)
- **Fixed three-column grid, never a content-sized flex row**: draw left, the reaction button centre,
  pass right. Slots (`data-slot="left|center|right"`) keep their column empty or not, and the bar's
  own width is constant (`--slot-w` ×3 desktop, three `1fr` columns edge-to-edge under 480px), so
  every control sits on the same screen pixel all match long. LOCO is a reaction game — a player
  parks the cursor over the centre *before* the card that needs it lands, and a bar that reflows when
  the penalty draw appears moves the target out from under them.
- **The centre column is Catch's home; LOCO only borrows it at `handSize === 1`.** Catch is the
  hardest button in the game to hit — it opens on someone else's mistake and lives for seconds — so
  it sits there *disabled but mounted* the whole match and is only ever **enabled in place**. It is
  never mounted/unmounted by the window: a button that appears is a button you have to find first.
  LOCO borrows the column on one card because declaring is ours to lose and outranks an opportunity.
- **`.armed` is the same cue on both**, applied to Catch when `canCatch` and to LOCO whenever it is
  shown: a punch-in (`armPop`, with a brightness flash) plus a pulsing halo (`armGlow`, tinted per
  button by `--arm-glow`). Deliberately identical — the two are the same wager seen from opposite
  sides of the table, so the player about to be caught must not get a louder cue than the player who
  could catch them. Under `prefers-reduced-motion` it degrades to a **static halo**, not to nothing:
  "this just became clickable" is information.
- **Catch is `position:absolute`, out of the grid** (`data-slot="float"`) for the rare overlap only —
  we are on one card *and* somebody else is catchable: right of the bar on desktop, above its right
  end on mobile, shifting nothing. `actionBar.test.tsx` asserts the slot, the enabled state and the
  arming of every button across states.
- The penalty draw and the ordinary draw share the left slot; `--slot-w` (126px) is sized for the
  widest label either can hold ("Piocher +4").
- **A declaration is a one-shot, and the button is spent with it.** `Room.DeclareLastCard` refuses a
  second call on the same single card (`player already declared`, the string `CatchUndeclared`
  already uses), and the flag only clears when `openCatchWindow` opens a fresh obligation on that
  seat — i.e. a Swap or a GlobalSwitch handing it a card nobody has heard called. Client-side,
  `store.myDeclared` (set by `applyUnoDeclared` on the *server's* confirmation, never on the click)
  disables the button in place: it stays in the centre column as a dead object rather than
  disappearing, because nothing in this bar may move mid-match. Without either half, LOCO! could be
  spammed for as long as the card was held, replaying the banner and the sting each time.
  `hub.handleDeclareUno` deliberately does **not** `noteSuspect` that one rejection: a second call is
  a double tap or a message already in flight, not an attack.
- **The declaration button reads "LOCO!" / "LOCO !"**, not UNO — it is the game's own call. Only the
  visible strings changed: the wire types (`declare_uno`, `uno_declared`), the store fields and the
  E2E helper key stay `uno*`.
- **The catch is "Contre-LOCO !" in French and stays "Catch!" in English**, and that asymmetry is
  deliberate: French UNO players say *contre-UNO*, so the pair LOCO/Contre-LOCO is the vocabulary
  they already have. English has no equivalent term — players *call someone out* or *catch* them —
  so "Counter-LOCO" would be an invented word imposed on the one language that doesn't need it. The
  code keeps `catch*` everywhere (`catchBtn`, `catchWindow`, `catch_uno`, `canCatch`).
- `--slot-w-mid` (172px) is therefore sized for the **French** label; the columns must not resize
  when a player switches language mid-match.

## Mobile
- Seats resize and wrap automatically (see "Seat layout"); nothing about the table is hard-coded to
  desktop. Verify with `make visual ARGS="--viewports=mobile"`.
- All action buttons: `min-height:44px`, `touch-action:manipulation`.
- 400ms debounce (`guardDoubleTap`) on action buttons.
- Wild picker: 64px+ touch targets in a row.
- HTML viewport: `user-scalable=no`, `maximum-scale=1.0`.
- CSS `@media (max-width:480px)` for small screens.

## Bots
- Host adds via `add_bot`. Named by `nextBotName(room)` — lowest free `Bot1`, `Bot2`, … (scans, does not count seats).
- AI: `game/bot.go` `BotThink(state, playerIdx) BotAction`.
- Scheduled via `botMove` channel with `botThinkDelay=800ms`.
- Auto-declare UNO when playing to 1 card — **deferred, and the declaration itself is what waits**.
  `maybeAutoDeclareUNO` only schedules; `handleUnoAnnounce` calls `DeclareLastCard` when the timer
  fires and broadcasts only if it succeeded. Declaring on the spot and deferring the *broadcast*
  alone settled the seat server-side while every client was still showing the 5s catch window it had
  just opened on the same `card_played`: a bot's LOCO! was uncatchable by construction and every
  Contre-LOCO! tap came back `player already declared` ("Déjà annoncé."), which reads as a broken
  button rather than as a race lost.
  - `handleUnoAnnounce` re-checks like every other scheduled callback: room playing, seat still in
    range, `LastCardAt[seat]` unchanged (a Swap can open a *different* window for the same seat), and
    `DeclareLastCard` failing means the bot lost the race and simply never announces.
  - `BotUnoDelay`+`BotUnoJitterMax` = **1.6–2.8s** of the 5s window. It is a human reaction budget
    (spot the seat → move to the button → click), not a machine's: at the old 0.4–0.8s the mechanic
    would have been unwinnable even once the state bug was fixed.
- Tracked in `hub.botSlots[code][playerID]`.

## Game event log
- `GameState.EventLog []GameEvent` append-only.
- Recorded inside domain methods (`PlayCard`, `DrawCard`, `PassTurn`, `DeclareLastCard`, `CatchUndeclared`, `CounterDraw`, `Start`).
- Timestamps UTC (`time.Now()`); wire = Unix ms.
- **`GameEventDTO` rides the reconnect snapshot and nothing else.** `exportEventLog`
  (last 50, `maxEventLogExport`) is called by `playerGameState`, the single-recipient
  recovery send, and never by `playerGameStateUsing`, which is what every broadcast
  loop uses. The log is the one unbounded field in a payload that is built *and*
  marshalled once per recipient, so a GlobalSwitch at a ten-seat table used to
  serialise the same 50 events (each with a nested card) ten times over, at the exact
  moment the table is busiest. Nothing in the client reads it during play: it exists
  so a reconnecting player's history can be rebuilt, which is the one send that keeps it.

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
- The **interrupt window is only armed by a real play** — `debug_set_state` leaves it closed, so a
  successful-interrupt test must have somebody actually play first. Who interrupts no longer matters
  (self-interrupt and current-player interrupt are both legal), but keep bots out of the scenario:
  a bot's 800ms timer plays a card and re-arms the window under the interrupt in flight.
- Entrance animations race clicks: `clickContinue` waits for the round-summary card's animations to
  report `finished` before clicking, because `waitForRoundSummary` resolves on the store flag, which
  flips ~420ms before the card stops moving.
- Two controls must never share an accessible name — the draw pile is `drawPile` ("Pioche"), not
  "Draw", precisely because a strict-mode locator caught the collision.
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
- Root `Makefile` has docker-first targets so Go isn't needed on host: `make dev`, `make down`, `make test`, `make test-server`, `make test-client`, `make test-e2e`, `make visual`, `make og`, `make maps`, `make lint`, `make lint-server`, `make lint-client`, `make build-server`, `make build-client`. `make help` lists them. Pass flags through with `ARGS="…"` (used by `make visual` and `make maps`).

## Art direction — "cartoon premium"
Inspirations: **Nintendo × Gartic Phone**. Chunky rounded shapes, thick ink outlines, saturated
candy palette, solid offset shadows that make every control read as a physical object. The old
Airbnb-derived tokens are gone.

**`DESIGN.md` is the written spec for this system** — North Star, the four colour roles, the type
scale, the elevation vocabulary and the do's/don'ts, in the Stitch DESIGN.md format so tooling can
read it. `styles/tokens.css` remains the executable source of truth for the values; `DESIGN.md`
says what they mean and when to reach for them. Change one, change the other.

Three rules the whole UI obeys (stated at the top of `styles/tokens.css`):
1. Every raised object has an ink outline (`--stroke`) **and** a hard bottom shadow
   (`--shadow-hard`). Soft blurs are ambience, never structure.
2. Nothing is pure white on pure white. The board always sits on colour (`--bg-gradient`, painted
   once on `body`; screen containers stay `transparent`).
3. Type is display-weight and large — a spectator reads it at 720p, not a designer at arm's length.

- Fonts: **Fredoka Variable** (display) + **Nunito Variable** (body), self-hosted via
  `@fontsource-variable/*` and imported in `main.tsx`. No CDN — the CSP stays closed.
- Press feedback: `.btn-chunky` in `tokens.css` (hover lifts, active travels *into* the ledge).
  Components extend it rather than reinventing the six lines.
- Card faces: see "Card face" below. The deck has its own identity — full-bleed suit gradients and
  the LOCO mark — and it is the one part of the UI that does **not** follow the app's chunky-sticker
  language or its theme. A card is an object, not a control.
- `--ease-bounce` for anything that should feel physical; `--ease-out` for travel.
- **Theme is applied by `initTheme()` in `main.tsx`, before first render.** It used to be written
  only by `<ThemeToggle />`'s hook, so any screen without a toggle (game over, a reload straight
  into a match) silently rendered light.

## Board scale (`layout.ts: boardScale` / `boardSpace`)
The board is laid out in a **fixed coordinate space** and scaled to the element by `<div .stage>` in
`<GameBoard />` (`transform: translateY(offsetY) scale(s)`, `transform-origin: 0 0`). The scale is
driven by the **shorter** axis — an ultrawide but short window has no vertical room to spend, and
scaling on width alone pushes the hand under the action bar.

- **Desktop**: design 1240×790, `clamp(min(w/1240, h/790), 1, MAX_BOARD_SCALE=1.45)`.
- **Phone** (`w < 560`): reference 405×830, `clamp(min(w/405, h/830), MIN_BOARD_SCALE=0.78, 1)` — the
  board scales *down* on a screen smaller than the one the cards were drawn for. A 390×844 phone is
  the reference and sits at ≈0.96; an iPhone SE or a 360×640 Android would otherwise show the same
  objects too big for the screen rather than a table seen from above.
- Between the two (560px ≤ w < 1240px) the scale is 1 and the responsive behaviour takes over.

`boardSpace(pxW, pxH, s)` — **not** plain `px / s` — converts pixels to the virtual space. The board is
bracketed by two bands of **real chrome that do not scale with it**: `TOP_CHROME` (round badge,
theme/audio/rules cluster) and `BOTTOM_RESERVE` (action bar). Both must stay constant in *pixels*.
Scaling them along with the board shrinks them on a phone — seat pills slide under the top buttons,
the hand under the action bar — and inflates them on a monitor into two bands nothing may use.
`offsetY = TOP_CHROME * (1 - s)` pins the top band, and the height is solved so the bottom one lands
exactly on the action bar. Asserted in `layout.test.ts`.

- `GameBoard` passes only the virtual size down. Children, `layout.ts` and every animation coordinate
  stay in that one space — nothing else knows about the scale, which is why cards, seats, felt, type
  and fliers all grow together.
- This is the fix for both "1440p shows the same small table surrounded by background" and "the cards
  are too big on a small phone". Do **not** solve that class of problem by bumping `CARD_W` /
  `SEAT_DIMS` — those are design-space constants.
- Deck and discard derive their centre from `tableRect` (`pileTop`), so the pair sits in the middle
  of the felt. Both take `topReserve` and `<GameBoard />` passes `seats.blockHeight` to the piles,
  the fliers and `tableRect` from one variable — mismatched reserves drift the fliers off the pile.

## Seat layout (`layout.ts: seatLayout`)
One function owns opponent seating because three callers must agree exactly: `<GameBoard />`
(renders the pills), `seatPosition` (anchors swap/steal animations), and `tableRect` (must not
slide the felt under the seats). When they disagreed, trails flew to empty space.

- Picks the largest pill size that fits the whole table on one row: `full` (172×66, desktop only) →
  `compact` (124×56) → `mini` (82×46, name + count, no card fan). Sizes in `cardTheme.ts:SEAT_DIMS`.
- Wraps to extra rows when even mini pills don't fit one row (nine opponents on a phone).
- X is spread **linearly**, not by `cos(angle)`: evenly-spaced angles bunch their projections at the
  extremes and outer pills overlapped from six players up.
- Non-mini pills keep `SEAT_EDGE` (28px) clear of both screen edges, mini pills only `SEAT_GAP`
  (10px). A row of full pills that technically fits but runs edge to edge reads as a toolbar, not as
  players around a table; mini pills only appear when the table is crowded and every pixel counts.
- Reports `blockHeight`; `tableRect(width, height, topReserve)` places the felt underneath it,
  clamps to `width - 20`, and keeps an oval aspect (rounder on phones, where a wide oval leaves dead
  bands above and below). The felt takes 74% of the band it is given (capped 440) — at 62%/400 a
  third of the play area was bare background.
- Seats clear `TOP_CHROME` (58px) so they never sit under the round badge / theme / audio / rules
  cluster.

## Active colour (four readings, `<DiscardPile />` + `GameBoard`)
The colour in play is the single most-consulted piece of state on the board, and it was stated in
exactly one place — a ring around the discard. Players kept asking where it was. The ring is not
hard to see; it is hard to *know it means that*, and on a wild (black face, no colour of its own)
it was also the only thing saying anything at all. Four readings now, at four distances:

- **The pool** (`.pool`) — coloured light spilled on the felt around the discard, sized well past
  the card. What a viewer gets at 720p without looking for it. Deliberately low and blurred: the
  table stays near-black and card edges keep winning, which is the rule the felt exists for.
- **The ring** (`.ring`) — unchanged, the precise statement.
- **The chip** (`.chip`) — a solid token set into the ring's bottom-left, mirroring the `+N` badge's
  corner so the pile has two fixed places to look and this one is *always* occupied. It carries the
  suit's whole gradient (`SUIT_PAINT`), so it is literally the paint of the `<ColorPicker />`
  swatch that was tapped and of the cards it now lets you play — a flat sample would be a fourth
  colour to learn.
- **The callout** — `GameBoard` announces the colour by name over the pile (`fxTexts.colors`,
  `ACTIVE_RING` tint) **only when the top card is a wild**. Any other card carries its colour on its
  face, and announcing what the player can already read is noise. This is the one that teaches a new
  player that the other three mean anything, and it is what a muted highlight clip needs to show
  "he changed it to green". Delayed by `COLOR_CALLOUT_DELAY_MS` (420ms) past the `+N` callout a
  `wild_draw_four` also fires, so the two read as a sequence instead of stacking on the same pixels.

All three permanent cues are keyed on the colour, so a wild resolving replays them together.
Scene `game-wild-active-color`; `src/test/discardPile.test.tsx` covers the chip and both callout
branches.

## Maps (the room a match is played in)
A map is **three things and nothing else**: a backdrop, a table, and an accent colour. It changes no
rule, no card and no timing. Four ship: **Neon** (rooftop club), **Rune** (arcane tavern), **Velvet**
(art-deco lounge), **Orbit** (starship hangar).

- **The draw is server-side and per match.** `game/maps.go` (`MapID`, `MapIDs`, `Room.pickMap`);
  `Room.Start()` writes `Room.MapID`, `BeginNextRound` keeps it, `ResetForRematch` clears it so the
  next match gets a new room. Exported as `GameStateDTO.map_id` on **every** snapshot, not just
  `game_started`, so a reconnecting player rebuilds the same table as everybody else.
  - It has to be the server's even though the consequence is purely visual: two players in one room
    describing two different tables to a viewer is a table that does not exist, and a clip cut
    between two seats would jump between two rooms. Hashing the room code client-side would agree
    just as well but would freeze a room's map forever, and a rematch is meant to feel new.
- **`tableRect()` remains the single authority on the board's geometry.** A map replaces how the felt
  is *painted*, never where anything is: piles, seats, direction ring and every animation coordinate
  are identical with or without one. `maps.ts` names each table's `playfield`, the sub-box of
  `table.webp` holding the playing surface, four numbers measured off the art, and
  `layout.ts: tableImageRect()` solves for where to draw the picture so that box lands on the felt.
  The result deliberately overhangs the felt on every side: rim, base and cast shadow are most of
  what makes each table a different object, and cropping to the felt would cut them off.
- **The backdrop is blurred, the table is not.** `.board[data-map]::after` paints a second copy of
  `room.webp` (`background-image: inherit`, so one place still names the file) at `blur(0.55vmin)`
  behind everything, which is depth of field: the room is behind the table, and a photograph in
  focus competes with a card edge, the one contest a card must always win at 720p. The radius is in
  `vmin` because the board scales with the viewport, so a fixed one is a haze on a phone and a smudge
  on a 1440p monitor. Slight on purpose, and `<MapLoadingScreen />` keeps its backdrop **sharp**:
  that screen exists to show the room, this one to play on the table. The layer needs
  `isolation: isolate` on `.board`, since a negative z-index otherwise escapes to the nearest
  stacking context and lands behind the element's own background.
- **The accent is light, not chrome.** It tints the glow pooled under the table, the ambient wash,
  and the direction ring's chevrons (as an 85% white *wash*, never the raw accent). It deliberately
  does **not** reach `--color-primary`, the active seat's gold, or any card face: those are what a
  viewer reads game state off, and a state cue that changes colour with the scenery is a cue that has
  to be re-learned four times.
- `resolveMap()` returns **null** for an unknown or empty id, and null is a first-class answer: a
  lobby has no map, and a server shipping a new one before the client has its art must degrade to the
  built-in felt rather than to a blank table. Same reason `map_id` is a bare `z.string()` in
  `protocolSchemas.ts` and not an enum: an enum would drop the whole `game_state` in dev.
- Art lives in `client/public/maps/<id>/{room,table}.webp` (~1.75 MB total). `make maps
  ARGS="--src=<folder>"` (`tools/maps/prepare.mjs`) crops and re-encodes it. **Which source file is
  the table is read off the alpha channel, never the filename**, since the renders come out of the
  generator named after their timestamp, and an earlier pass that guessed by frame brightness got
  every map backwards. The table is cropped to its alpha bounding box, which is what makes the
  `playfield` fractions honest.
- Scenes `game-map-neon` / `-rune` / `-velvet` / `-orbit` / `game-map-loading`. **The playfield
  numbers are measured by eye off the art, so a drifted table shows up in `make visual` and nowhere
  else**, so review any change to the art or to `tableImageRect()` there.

## Synchronised map loading
The table stays **shut** between "hands dealt" and "clock running" while every client downloads the
map. `hub/maploading.go`.

- **Why it is not cosmetic**: a map is ~600 kB of backdrop and table. Dealt straight into a match,
  the first player's 30 seconds start ticking while somebody else's table is still a grey rectangle,
  and in a game decided by arrival order that is a head start, not a slow paint.
- Flow: `handleStartGame` broadcasts `game_started` (with **no** turn deadline) then
  `beginMapLoading` → `match_loading { players_ready }` → each client preloads and sends `map_ready`
  → `match_loading` again per arrival → once nobody is left, `openTable` arms the turn timer,
  broadcasts `match_ready { turn, turn_deadline }` and schedules the bots. **The clock starts at
  `match_ready`, not at `game_started`** (`TestTurnTimer_StartsAtMatchReadyNotGameStarted`).
- **Every gameplay message is refused while the gate is open** (`isGameplayMsg` + `isMapLoading` in
  `dispatch`, "waiting for every player to load the table"). Trusting the client's own loading screen
  would leave a client that skipped it as the only one able to act.
- Gate is **per match, not per round**: round two runs on a decoded map, and a second pause there
  would be a stall with no visible cause. A rematch re-arms it, because it draws a new map.
- Bots are marked ready at the start: they render nothing. A seat that **disconnects** during the
  gate stops being one the table waits on (`handleDisconnect`), and a seat that **reconnects** into an
  open gate is sent `match_loading` so its client knows to answer.
- `hub.MapLoadTimeout` (var, 20s) opens the table without the stragglers: one backgrounded tab must
  not hold nine people hostage. The client's own `MAP_PRELOAD_TIMEOUT_MS` (12s) is deliberately
  shorter: if they were equal, every slow connection would look like a dead one.
- Client: `store.mapLoading` / `applyMatchLoading` / `applyMatchReady`, `useMapPreload`
  (`img.decode()`, not the `load` event, because bytes arriving is not the same as being paintable), and
  `<MapLoadingScreen />`. **A failed or missing image still reports ready**: the board falls back to
  the felt, which is a worse-looking match, not a broken one; a client that never answers is the one
  outcome the gate cannot survive.
- **`map_ready` is sent once per gate, guarded by a ref**, not keyed on `mapLoading`: the store
  object gets a new identity on every progress broadcast, so a dependency would pay one `map_ready`
  per opponent.
- The screen is an **overlay over a mounted board**, not a screen instead of it: the board spends the
  wait laying itself out, so the table is finished the instant the overlay lifts.
- The reveal names the room and describes it in one line (`t.maps[id]`), and lists **who is still
  loading**, because a bar alone cannot tell a slow download from a hung game, which is the difference
  between waiting and reloading. The scrim is deliberately light: a scrim heavy enough to make type
  effortless turns the reveal back into the loading bar it replaced, so the name carries its own ink
  outline instead.
- **E2E**: `startGame()` now returns only once the table is genuinely open, and `waitForTableOpen`
  must be called on every *secondary* page in a multi-client test. Without it a test acts during the
  gate, gets refused, and then blocks reading a reply that never comes. Go tests go through
  `completeMapLoad(t, conns...)` for the same reason: the gate is exercised, never disabled.

## Streamable moments
- **Interception slam** (`<InterruptBanner />`): driven by the server's `interrupt_success`, which
  the client used to ignore entirely. Store field `interruptFlash { actorIndex, count, at }`, set by
  `applyInterrupt`, cleared by the banner after 1800ms. Colour comes from `seatColor(actorIndex)`.
  `<GameView />` also shakes the board via the **Web Animations API** (not a CSS class — a class
  toggle would need a remount to replay, tearing down the board).
- **UNO banner**: tilted sticker, punch-in, positioned *above* the pile so the play that triggered
  it stays visible.
- **Effect callouts** (`AnimationLayer`): SKIP / REVERSE / +N, outlined rather than shadowed so they
  survive landing on felt, on a card, or on the background. Text is localised (`fxSkip`,
  `fxReverse`); `<GameBoard />` takes them as a memoised `fxTexts` prop — a fresh object literal
  would replay the callout on every render.
- **Play direction ring** (`<DirectionRing />`, geometry in `layout.ts: directionMarkers`): chevrons
  around the felt saying which way play is moving. A Reverse otherwise only announces itself for the
  length of one callout, after which nothing on screen answers "who plays after me" — the question
  the card was about.
  - **`direction = +1` is clockwise *on screen*, and the ring must never contradict the seats.** The
    arc puts the next player at the **left** end of the top row, so a table flows 6 o'clock → 9 → 12
    → 3, which is clockwise. Same fact `clockwiseOpponents` is named after; an arrow pointing the
    wrong way is worse than no arrow.
  - The heading lives in the **geometry**, never in the motion: the chase is a second readout, so a
    frozen ring (`prefers-reduced-motion`, a paused clip, a screenshot) still reads. Same principle
    as `.armed` degrading to a static halo.
  - `<GameBoard />` keys it on the direction, so a Reverse remounts it and replays the flip. Nothing
    here goes through per-frame state — the chase is one CSS animation per chevron, staggered by
    index (markers come out of `directionMarkers` in flow order, so index order *is* flow order).
  - Drawn as a sibling of `.tableOval`, not a child: the felt clips its overflow and the chevrons'
    glow extends past the ellipse.
  - Scenes `game-my-turn` (cw) and `game-reversed` (ccw) cover both headings in the showcase.
- **Confetti** on the victory screen only. Losing screens do not celebrate.
- **Per-seat identity colours** (`components/playerColors.ts`): a player keeps one colour across
  lobby avatar, banner and scoreboard so a viewer can follow "the orange player" all match.
- Opponent pills show the **exact** card count (the fan only conveys few-vs-many, and caps out).

## Audio
Everything is synthesised at runtime. **No audio files ship with the client** — nothing to
download, nothing to licence, no cache-miss silence on a sound's first play.

- `audio/engine.ts` — lazy `AudioContext` (browsers refuse one outside a user gesture; every play
  before `unlock()` is a silent no-op), master → sfx/music buses, settings persisted under
  `loco_audio`, per-frame voice budget so a batch play can't stack a dozen voices.
- `audio/sfx.ts` — one-shots. Card handling is **noise** (paper has no pitch; a pitched click per
  card becomes a melody nobody wrote); rule outcomes are **pitched and interval-based** so the table
  learns them by ear.
- `audio/music.ts` — the bed **engine**. It contains no music: tracks are data in `audio/tracks/`,
  and this plays any of them (scheduling, synthesis, the arrangement ladder, the song form).
- `audio/tracks/` — the music. `types.ts` documents the schema; `index.ts` is the registry (add a
  track by writing a `TrackDef` and listing it — engine, picker, tests and harness all read that
  list). Three ship: **Neon Horizon** (uplifting trance 138, transcribed from the user's own Strudel
  sketch `F:/dev/strudel-test/neon-horizon.strudel`), **Pixel Rush** (electro house 128, plucks and
  offbeat stabs), **Voltage** (dark electro 145, wobbled bass, modulates to B major in the bridge).
  - **A track has parts and a form, and that is the whole point.** The first design was one four-bar
    loop whose only variation was layer count; the verdict was "it's just a chorus on repeat", and it
    was right — four bars at 138 BPM is 7 seconds. A track is now parts (`intro` / `verse` / `chorus`
    / `bridge` / `break`) plus a `form` ordering them, ~40 bars before anything returns.
  - **Two independent axes.** The form advances on its own (`nextFormIndex`); the game's intensity
    picks the *stack* (`sectionFor` → `LAYERS`) **and** biases which part comes next by role. Both are
    pure and unit-tested — "does the music go somewhere" is a claim about behaviour, not about taste.
  - `nextFormIndex` is a **single forward scan** for the first part whose role the section accepts,
    stopping one short of a full lap. Two bugs the tests caught, both worth not repeating: scanning a
    *full* lap let a section with one matching part return its own index and **stall**; ranking by
    role instead of taking the first match made a sustained groove **ping-pong between two verses**
    and never reach the bridge or the choruses. Technically moving, musically still a loop.
  - Anti-repetition beyond the form: a riser **and** a crash whenever the *next* part is a chorus, a
    drum fill in the last bar of every part, an octave lift on alternate chorus passes. The ear
    forgives a repeated phrase that arrives differently and never forgives one that arrives
    identically.
  - `Slot` encoding: `0` rest, `-1` **tie** (hold the previous note), `>0` MIDI. Without ties every
    note is exactly one slot long and the result is a sequencer pattern, not a melody. A row may never
    *open* with a tie — it would silently swallow the bar's first slot (tested).
  - `SECTION_AT`: 0 breakdown, 0.2 buildup, 0.3 groove, 0.58 drop. Sections a match visits:
    **breakdown** = round summary, **buildup** = lobby/waiting, **groove** = ordinary play (0.34),
    **drop** = someone on one card or a climbing draw stack. The lobby is a *build-up*, not a
    breakdown — that is the section with the tune and no drums. `intensityOf` returns **0.1 while
    `showRoundSummary`** specifically so the breakdown is reachable; without it the calmest section
    would be dead code.
  - **The lead plays in every section.** Sparse moments get their quietness from the *part* the form
    is on (a `break` part is written sparse), never from muting the melody: an earlier bed gated its
    theme above `intensity > 0.5` while an ordinary turn sits at 0.34, so nobody ever heard a tune.
  - **The bass is deliberately not the reference sketch's bass — the user asked for this by name.**
    The sketch uses `sawtooth` + `lpq(8)` + `shape(.3)` at `gain(.85)`: right for three minutes,
    exhausting across a twenty-minute match (resonant peak where the ear is most sensitive, waveshaper
    filling every gap the arp left). `bassNote` is always a sine sub for weight plus a filtered body,
    never a waveshaper; Neon Horizon keeps the sketch's rhythm exactly (`struct("[~ x x x]*4")`, which
    also keeps it off the kick).
  - Neon Horizon's `chorus` lead is the sketch's, **note for note**, pinned by a test so nobody
    "improves" it by accident. Its bars 3–4 keep **F natural over the C and G chords** — an 11th and a
    dominant colour, his sound, not a transcription slip. What was added around it is what the sketch
    lacked for a long match: a verse, a counter-melody, a Dm→E bridge (the first major V in the
    track) and a break.
  - Arp figures are built from **their own bar's chord** and play in their **written register**. Both
    are tested: a D natural over Voltage's B major was caught this way, and transposing figures `+12`
    once put them above the lead — a busy way to bury the one line the player should follow.
  - `synth()` divides level by unison count, so widening a voice never also makes it louder, and
    implements a real ADSR (attack → decay to sustain → release after the hold) because a
    hold/release approximation loses the pluck.
  - Reverb is **three lowpassed comb delays**, not a convolver: this runs beside card animations on a
    phone, and `latency → smooth animation` outranks "lush". Delay times are **bar fractions computed
    from the tempo** (3/8 lead, 3/16 arp), retuned on every track switch — typed in as seconds, dotted
    delays land between the beats and the groove dies.
  - The pump is stepped on every 16th onto a **pad-only bus** (per the sketch, which puts that gain
    pattern on the pad and leaves the arp flat), as one automated node rather than a gain per note —
    a chord that doesn't breathe together is not a pump.
  - **Output trim is a fixed `0.55` gain node after the duck**, and voice levels are tuned against it.
    Bare, the bed peaked at 0.73 with the music slider at 1 — clipping once effects play over it. A
    `DynamicsCompressor` is the obvious fix and the wrong one: **Chrome applies an internal makeup
    gain**, so the "limiter" came back *louder* (peak 0.81, RMS +45%).
  - **Intensity is slewed at `SLEW_PER_SEC` (per second, not per step).** Game events move it in
    jumps, and applied raw the arrangement would cut from breakdown to drop mid-bar. A per-*step* rate
    was worse than useless: a 16th at 138 BPM is 109ms, so the ramp depended on the tempo and took 14s
    to cross the range — longer than the moment it was reacting to.
  - The section is sampled **at the bar line**: a layer arriving on beat 3 sounds like a bug, the same
    layer on beat 1 sounds intended.
  - **Playback is a shuffled playlist, not a selection.** A track runs
    `form.length × PASSES_PER_TRACK` parts (~2 minutes) and hands over to the next id in a shuffle
    bag; the only human control is `nextTrack()`. `shuffledOrder` deals every track once per bag and
    never opens on the one that just played — pure `Math.random()` repeats about one handover in
    three, which people hear as broken rather than as random. The head swap on collision is a single
    deterministic swap, because re-rolling until the head differs never terminates on a one-track bag.
  - **Two switch timings, deliberately.** The automatic handover waits for a **part boundary** (it
    answers to nothing a person did, so it can land on a phrase); the button swaps on the next **bar
    line**, ≤1.7s, because a press has to feel like it did something. Both go through `dipThrough`: two
    tracks butt-joined still click, since the outgoing reverb, delay repeats and 1.2s pad release get
    cut mid-air. The manual swap is applied **before** `emitStep` reads the track — applying it later
    and returning early swallowed the new track's first sixteenth, which is where its kick, pad and
    first melody note all live.
  - `music.setPartsPerTrack(n)` is a **harness-only seam** (same convention as the server's
    `AFKKickThreshold`): a real track is two minutes, so without it the automatic handover would be
    the one behaviour nothing ever checks.
  - `music.duck(ms)` pulls the bed under the win/lose fanfares through the bed's own output stage,
    so it never touches the user's music volume. Two pieces of music fighting for the same moment
    makes both of them mush, and the fanfare is the one people clip.
- `audio/useGameAudio.ts` — **the only place that plays anything**. One store subscription diffs
  snapshots (`soundsForTransition`, pure and unit-tested) instead of audio calls scattered through
  components: every sound stays in one readable list and can't double-fire.
- `<AudioSettings />` sits in the top-right cluster on every screen: three sliders, a **now-playing
  line plus a ⏭ next button** (44px target), and mute. There is deliberately **no picker** — choosing
  from a list means reading three names to make a decision nobody opened the panel to make, whereas
  "not this one" is a judgement you can act on in one tap. Music defaults below effects — it is a bed,
  and a streamer talking over the game must stay louder than it. The current track id is written back
  to `loco_audio` on **every** handover, which is also what re-renders the now-playing line when a
  track ends by itself; `engine.ts` stores it as a **bare string** and never imports the registry,
  because the registry depends on the engine.
- `make audio-verify` (`tools/audio/verify.mjs`) is the only thing that can catch a broken envelope
  or a mis-wired node: those produce **silence**, not an error, so no unit test would ever go red.
  It plays every voice through a real AudioContext and measures peak amplitude on the bus, then
  checks the properties of the bed that are claims rather than code: **every registered track makes
  sound** (a track is pure data, so a typo in it is silence, not an error), that **the form moves on
  its own** at a fixed intensity (the direct test of "it's just a chorus on repeat" — ≥3 distinct
  parts in 26s, which no four-bar loop can clear), that **the next button changes track** without
  ever repeating back to back and covers the whole bag, that a finished track **hands over
  unattended**, calm-vs-tense energy (≥1.3×), that the sections
  actually move breakdown→drop (a bed can get louder without ever bringing the drums in), that the
  slew reaches its targets, that ducking attenuates, and the **frame cost** of the drop against idle
  (continuous 16th supersaws build a lot of nodes; last measured 16.7ms vs 16.7ms, i.e. free).
  - **Measure over a full loop.** `LOOP_MS` is deliberately several bars long; a shorter window
    samples a random slice of the progression, which is exactly how the first version of this check
    confidently reported ×1.05 for a bed that does change.
  - Deliberately outside CI: audio devices in CI containers are unreliable and a flaky sound
    assertion trains people to ignore red. Run it after touching `sfx.ts`, `music.ts` or `engine.ts`.
- **Strudel was evaluated and rejected**: `@strudel/*` and `superdough` are AGPL-3.0-or-later, and
  bundling them into a network-served client triggers §13 for the whole app. Revisit only if LOCO
  itself becomes AGPL.

## Visual showcase & screenshot harness
`client/src/dev/scenes.ts` registers every screen/state as pure data; `?showcase` renders the index,
`?showcase=<id>` renders one scene full-screen with no server, no WebSocket and no second player.
Gated behind `import.meta.env.DEV` (dynamic import in `main.tsx`), so Rollup drops the chunk in prod.

`tools/visual/shoot.mjs` (`make visual`) boots Vite, walks the registry and writes
`.visual/<scene>__<viewport>__<theme>.png` plus one contact sheet per viewport/theme.

- **Add a scene in the same change set as any new screen or visual state.**
- `card-sheet` is the odd one out: not a screen but the whole deck, every kind in every suit, laid
  out to fit the capture viewport. Cards are the component the game draws forty of at once and no
  gameplay scene shows more than a handful of kinds — review any card change against it.
- Flags: `--scenes=a,b`, `--viewports=desktop,mobile,wide,small`, `--themes=light,dark`, `--motion`
  (keep animations running), `--port`. Default runs `desktop` (1440×900) + `mobile` (390×844). The
  two ends of the board-scale range are where its regressions show up — check **both** after touching
  `layout.ts`: `wide` (1920×1080, scaled up) and `small` (360×640, scaled down).
- Viewport size goes under `viewport: {...}` in the Playwright context options — width/height at the
  top level are silently ignored and you get the 1280×720 default.
- Captures run with `reducedMotion: 'reduce'` by default so they are deterministic; `--motion` is how
  you check confetti, springs and callouts.

## Link preview (Discord / X)
The game is shared as a link, so the OG card is a product surface. `make og` (`tools/og/shoot.mjs`)
renders the `og-card` scene at 1200×630 into `client/public/og.png`.

- **Built from the real `<LocoLogo />` and the real `<Card />`** (`client/src/dev/OgCard.tsx`), not a
  redrawn copy: the duck on the preview is the duck on the cards is the duck in the tab, and a
  hand-authored twin would drift the first time either is touched. `OgCard` pins `--color-stroke` /
  `--color-primary` locally — a link preview is one picture and must not depend on which theme the
  machine that captured it was in.
- **Show, don't tell**: the duck, the wordmark and a five-card fan, one line of copy. Discord renders
  this at ~400px wide; a paragraph is unread there. The +4 sits mid-arc, where a crop or an avatar
  overlay can't take it.
- The PNG is **committed** — CI builds the client with `npm run build` and has no browser.
- **Absolute URLs are mandatory** (crawlers resolve `og:image` against nothing) and the tags must be
  in the served HTML, since neither Discord nor X runs JS. `index.html` carries a `%OG_ORIGIN%` token
  substituted at build time by the `loco-og-origin` plugin in `vite.config.ts` (default = prod
  origin, override with `VITE_PUBLIC_ORIGIN`).
- Both platforms **cache the image by URL** for days: bump the `?v=` on `og:image`/`twitter:image`
  after regenerating. `twitter:card` must stay `summary_large_image` or X shows a 120px thumbnail.
- No preview on the `-d.` host by design — nginx serves `robots.txt: Disallow: /` there and
  Twitterbot honours it.
- `client/src/test/ogCard.test.ts` is the only thing watching this: nothing else in the app renders
  those tags or that image, so a deleted PNG or a drifted dimension would fail silently in
  production.

## Player bubble (`<PlayerSlot />`)
- Chunky sticker pill positioned by `seatLayout(...)` (see "Seat layout"), clockwise from the local
  seat. Size is `full` / `compact` / `mini` — the component mirrors `SEAT_DIMS`, it does not choose.
- Active turn: gold gradient fill + glow ring + bobbing arrow above the pill, dark label. It is the
  brightest object on screen on purpose — a viewer must never hunt for whose turn it is.
- Card-count badge on the pill's right edge; it turns red and pulses at exactly 1 card.
- Disconnected: muted fill, faded, `"nickname ✗"`.
- Mini card-back fan inside `full`/`compact` pills (rotation ±14°/±8°/0° depending on count, "+N"
  overflow label). `mini` drops the fan — at that size it would be unreadable mush.

## Logo, favicon, table
- `<LocoLogo />` is the mark beside the wordmark. `size` sets one font-size; everything else is `em`
  of it. The mark **stands on its own** — it is a closed drawing and needs no frame to explain its
  edges. (It used to be held inside a little card, a device that existed only to make the previous
  mark's bleed read as a deliberate crop.)
- **Whole here, cropped on a card.** Logo, favicon and felt show the complete mark; card faces, the
  mini cards on a wild, and the deck back's watermark blow it past the edges and tilt it (see "Card
  face"). Same geometry, two framings, and they are not interchangeable.
- **Weight is a rendering parameter, not a second path.** `LOCO_MARK_BOLD_STROKE` (logo) and
  `LOCO_MARK_ICON_STROKE` (favicon) stroke the mark with its own paint, which thickens every bar and
  closes the facets by exactly the amount asked for. A dilated *copy* — which is what the previous
  mark shipped — is a second geometry to keep in sync with the designer's, and it drifts.
- The logo draws the mark **twice, widest first**: the ink outline every raised object in this UI
  carries, then the mark over it. `paint-order` does not substitute — the outline must be outside the
  shape only, and a centred stroke on an even-odd wireframe eats its own facets.
- **The favicon is the mark on a rounded near-black square** (`client/public/favicon.svg`), plus
  `apple-touch-icon.png` as its raster twin — iOS ignores SVG icons. `locoMark.ts` is the source of
  truth for the geometry; the two icon files are static copies (a `<link rel=icon>` cannot import a
  module), so a change to the mark means editing all three.
- **The felt watermark is bound by the oval's height, not its width**, even though the mark is
  landscape: the felt is roughly a 2.7:1 ellipse, so a mark sized off the width lands half outside
  the curve and `overflow:hidden` slices it into fragments. `aspect-ratio` is set explicitly — an
  absolutely-positioned `<svg>` with one axis `auto` does not reliably take its intrinsic ratio.
- **The table is near-black, in both themes.** It used to be green felt, which fought the deck: a
  `#00ff6d` card on a `#1fbf8f` table loses its edge, and a card losing its edge is the one thing
  that must not happen. Dark also makes the table the stage and the cards the only bright objects on
  it. The mark is branded into the felt at 7% — the piles sit on top of it, so anything more is a
  table you have to look past.
- A near-black card back on a near-black table is 1.3:1 and its ink outline is as dark as both, so
  `CardBack` carries a **light inner rim**. Without it the deck has no edge and an opponent's mini
  fan is one black bar.

## Card face (`CardArt.tsx`, `cardArtSpace.ts`, `locoMark.ts`, `cardTheme.ts`)
Reproduced from the brand's own card art. Review any change to it with
`make visual ARGS="--scenes=card-sheet"` — the whole deck on one screen, which no gameplay scene
shows.

- **One SVG paints the whole face.** Background rect, watermark, wild fan and rule glyphs all live in
  the same `1000x1500` user space (`preserveAspectRatio="none"`), so they scale as one object at any
  card size — hand, discard, a flier mid-flight, a 12px mini fan. A CSS gradient for the face plus a
  separate SVG for the mark drift apart the moment the element's aspect ratio is not the reference's.
- **The card box and the mark box are two different boxes** (`cardArtSpace.ts`). The card box has the
  card's proportions; the mark is landscape. Reusing the mark's viewBox as the card's — which the
  previous portrait mark got away with — stretches the drawing to the card and turns the duck into a
  goose. It lives in its own module so `CardArt.tsx` exports components only (same reason as
  `hasGlyph`).
- **On a card the mark is cropped and tilted; everywhere else it is whole.** `MARK_CROP_TRANSFORM`
  (`MARK_TILT_DEG` 22°, `MARK_S` 1.95) blows it past all four edges, the way the reference art does;
  `markFitTransform(frac)` is the whole-mark placement. The tilt is what keeps the zoom sane: a
  landscape drawing spanning a portrait card's full height needs ×2.6 square, ×1.95 at 22°. The
  angle's *sign* matters — the duck's head is at the left of its own box, so a clockwise tilt lifts
  it into frame and a counter-clockwise one drops it off the bottom corner. Below `MARK_S` 1.87 the
  crop silently stops being a crop and the dead bands come back.
  - A landscape mark sitting politely centred in a portrait card leaves two dead bands and reads as a
    placeholder. The crop is what makes a card look *printed*, with artwork running under the value.
- Because the mark is drawn inside a transform, its gradient axis is the **card's** axis mapped back
  through that transform (`MARK_AXIS`). Both gradients have to span the same line on the card or the
  reversal below stops being a reversal.
- **The watermark is the face gradient reversed.** `SUIT_PAINT[suit].mark` is `[to, from]`. That one
  trick is the entire art: the mark is brighter than the card where the card is dark and darker where
  it is light, so it never needs an outline, a tint or an opacity to stay legible. Run the two
  gradients the same way and the mark vanishes into the face at both ends.
- `LOCO_MARK_PATH` is the brand mark: a **geometric wireframe duck**, landscape (`712x576`), 15
  subpaths, **even-odd** — the facets between the bars are holes, which is what makes it read as a
  wire drawing rather than a solid animal. It comes **straight from the designer's source file**
  (`logo_canard_geometrique.svg`) and is unmodified. Do not redraw, retrace or tidy the numbers.
  Every brand surface derives from this one path — card watermark, deck back, felt, logo, favicon —
  so a change here lands on all five at once.
  - It replaced a low-poly flamingo that had been traced back out of the reference card art, with its
    eight bleeding side facets reconstructed by hand. That path was always a stand-in; the note that
    said "replace it wholesale if the original logo file ever turns up" is what was acted on.
- Suit gradients run along the card's bottom-left → top-right diagonal at `SUIT_ANGLE_DEG` (35°), and
  the values are measured off the reference, not eyeballed.
- **The colour-change card is named by its four suits, never by a letter** — players read the shape,
  and "W" is also a word in one of the two languages. The four-suit fan belongs to `wild` and
  `wild_draw_four` only; `global_switch` names a colour too but its subject is the rotation, not the
  colour, so it keeps the bare black face and its own glyph: three identical fans would make the
  three wilds one card at a glance.
- **Rule glyphs are drawn, not typed.** ⊘ ⇄ ⇋ ↻ are the obvious characters and the wrong tool:
  Fredoka carries none of them, so the font fallback chain would decide what a rule card looks like.
  `hasGlyph` (in `cardTheme.ts`, so `CardArt.tsx` exports components only) lists the kinds that get
  one. Swap and GlobalSwitch deliberately do not share a silhouette.
- **GlobalSwitch is three cards in a ring, each moving to the next seat** (`rotatingHands`), not the
  single circular arrow it started as. That arrow is the "refresh" pictogram: it says *something*
  turns without ever saying the cards do, and it was read as "redraw your hand". Both halves of each
  connector carry weight — the curved shaft is the only thing that says the three go *round*, and a
  bare arrowhead at this size reads as a wedge pointing at whatever is nearest. Three cards can also
  never be mistaken for Swap's two crossing arrows, which is the trade between exactly two seats.
- **A glyph may carry its own stroke widths** (`twoPassGlyphs`): the wild fan and the ring of hands
  both close up into solid bars at `GLYPH_STROKE`. Such a glyph has to be *drawn twice from scratch*
  rather than letting the ink pass re-render the same element wider, because a child `stroke-width`
  beats whatever the pass sets on its group.
- **Value top-left, monogram bottom-right — the reference's two marks in its two corners, swapped.**
  The reference is a hero shot of one card; in a hand the fan overlaps down to the left ~30% of each
  card, and branding that sliver leaves a player holding twelve cards that all say "L". The wild
  already reads value-first in the reference, so this is also what makes every card consistent.
- **Every glyph is ink-outlined, and that is accessibility rather than styling.** Off-white measures
  **1.18:1** on the green suit and 1.46:1 on yellow; no single flat ink fixes it either (dark ink is
  1.66:1 on blue). Outlined, the glyph is ~15:1 against its own ink and the ink ~14:1 against any
  face. Numerals get `-webkit-text-stroke` + `paint-order: stroke fill`; the SVG glyphs are stroked
  icons with no fill to outline, so they are **drawn twice**, a wider ink pass first. The suit
  colours are never darkened to buy contrast — they are the brand.
- The face does **not** follow the light/dark theme. A card is a physical object; the same card in
  two themes is two cards.
- `CardBack` is the wild card's face plus the **same cropped, tilted mark every face carries**, in
  all four suits at once — the one place the full palette appears. The paint is what makes it a back;
  the framing is a card's, like everything else in this space. It briefly also carried the whole mark
  on top and showed the duck twice at two different angles, which reads as a rendering bug. It drops
  the art below `ART_MIN_W` (26px) and carries an inner light rim, without which a mini fan of eight
  backs merges into a single black bar.

## Card rendering layer (React + Framer Motion)
- `<GameBoard />` is the root; it tracks container size via `useElementSize` (ResizeObserver) and passes width/height to children that absolute-position in pixel coords.
- Layout helpers (`src/components/cards/layout.ts`): `clockwiseOpponents`, `opponentBubblePositions`, `calcHandSlots`, `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys` — all pure, reused by tests and animations.
- Animations live in `<AnimationLayer />`: an array of `Flier` items (flying card faces or backs) plus `EffectText` floats. Each entry self-cleans via `onAnimationComplete` → parent `removeFlier`/`removeEffect`.
- Animation triggers (inside `<GameBoard />`), in effect-declaration order:
  - **Opponent play**: keyed on `lastPlay.at`; flies the card from `seatPosition(actor)` to the discard with `arcHeight`. Skipped when the actor is the local player. Sets `suppressNextDiscardFx`.
  - **Card play (own)**: `flyCardFromHand(card, idx)` computes the source slot from `calcHandSlots` and spawns the arced hand→discard flier. Sets `suppressNextDiscardFx`. **It only runs once the play is committed** — `props.onCardClick` returns a boolean ("did the card leave the hand?") and the flier is spawned only on `true`. A tap the client refuses (`clientMayPlay`/`clientMayInterrupt` say no) animates nothing: flying the card out and snapping it back reads as a bug, not as "illegal card". Plays confirmed later (wild colour, swap target) fire it through `flightRef` — a `GameBoardHandle` the `<ColorPicker />`/`<PlayerPicker />` callbacks in `GameView` call after `onSend`.
  - `GameView.handleCardClick` also refuses to open a picker for a card `clientMayPlay` rejects — prompting for a colour and then having the server reject the card is the same broken promise as the animation.
  - **Discard top change (any source)**: `suppressNextDiscardFx` suppresses **only the generic pile flier**, never the SKIP/REVERSE/+N callout — playing your own Skip must announce itself too. Callout text from `effectFor(card, pendingDraw)`.
  - **Hand grew by 1**: deck→last-slot card-back flier (draws).
  - **Swap / GlobalSwitch**: trails spawned on `swapNotice.at` change.
- Hover lift: CSS-only (`Hand.module.css`) — `.slot.hovered .card { transform: scale(1.08) translateY(-14px) }`.

### Nothing continuous goes through React state
A value that changes every frame must never be a `useState` in a component the board
hangs off. `<GameView />` owns the whole match screen, and it is not memoised against
its own store subscription, so one `setState` per frame re-renders the board with it:
seat layout, hand slots, pile positions and every card, re-derived sixty times a second.

- **Countdown bars use `useDrainBar`, not a percentage in state.** The bar is handed a
  CSS animation whose duration is the window and whose *negative* delay is the part
  already elapsed (`--drain-ms` / `--drain-delay`, keyframes `loco-drain` +
  `loco-drain-heat` in `tokens.css`). The browser then drains it on the compositor:
  zero JS per frame, zero React work, and the bar stays smooth while the main thread
  is dealing a hand. This replaced a `requestAnimationFrame` → `setState` loop that
  re-rendered the entire board for the whole 30-second turn *and* the 5-second catch
  window, i.e. exactly during the two moments the game asks for a fast reaction.
- It drains by `scaleX`, never `width`: width lays out the page every frame.
- The colour is a second readout of the same clock (`loco-heat`), so no timer or state
  is needed to change it. The 5s catch bar opts out: five seconds cannot show a trend.
- **A countdown bar survives `prefers-reduced-motion`.** The blanket 0.01ms rule at the
  end of `tokens.css` has an explicit exception for `.loco-draining`: the bar is the
  only place the remaining time is written down, and a player who asked for less motion
  still has to know their turn is about to be auto-passed. Same principle as `.armed`
  degrading to a static halo rather than to nothing.
- **`<GameBoard />` is `memo`'d and its props are kept referentially stable** in
  `GameView` (`turnTexts`, `fxTexts`, `cardIsPlayable`, `cardIsInteractive`,
  `handleCardClick`, `handleDraw`). An object literal or an arrow in that JSX defeats
  the memo entirely, which is what an inline `turnTexts={{…}}` and
  `onDraw={() => …}` were doing: a latency broadcast every 3s, an error toast or a
  catch window rebuilt the whole board.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`, `PlayerSlot .slot`) is pinned at `left:0;top:0` in CSS and positioned by framer-motion `x`/`y`. Animating `left`/`top` runs layout every frame and visibly stutters once several cards move at once.
- **A node's transform has exactly one owner.** If framer-motion animates a node's transform, its CSS must not set `transform` (and vice-versa). Where a static offset is also needed — centering the effect text, centering the turn indicator — use an outer anchor div for the CSS transform and an inner motion node for the animation (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card` for the same reason.
- **Layout math is radians; framer-motion `rotate` is degrees.** Convert at the render boundary with `radToDeg` (`cardTheme.ts`). Passing radians straight to `rotate` silently flattens every rotation.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (card flights), `SPRING_HAND` (fan reflow), `DEAL_STAGGER_MS`.
- **Hand keys come from `handCardKeys(hand)`**, not the array index — occurrence-numbered card identity. Index keys make React reuse the wrong node when a card leaves the middle of the fan, so the survivors snap instead of sliding into the gap.
- `Hand` staggers cards in only when the hand grows **from empty** (a deal). Any other growth is a draw, which already has its own deck→hand flier.
- `DiscardPile`: 2 static neutral under-layers for pile thickness (deliberately untinted — the active-colour ring owns the colour there) + top card keyed on `cardKey(card)` so each new top card remounts and replays a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` is set by `applyCardPlayed` and exists **only** for animation. Never read it for rules decisions.

### Card rarity & the throw (`cardTheme.ts`)
Presentation-only tiering, invented here and never consulted by `game/`. `cardRarity(card)` follows
scarcity in the deck: number = `common` (72 cards), coloured action = `rare` (28), any wild =
`legendary` (12). A number is two thirds of every hand — dressing up the routine play leaves nothing
to escalate to when a wild drops, which is the whole reason the tiers exist.

- **`flightFor(card)` is the single source of flight timing.** One pure function feeding all four
  callers — hand→pile, seat→pile, the generic pile refresh, and `DiscardPile`'s `revealDelayMs`. They
  must agree or the pile shows the answer while its own card is still crossing the table.
- `spin` is **whole turns in the card's own plane**, folded into the same `rotate` track as the
  landing tilt (a full turn is visually a no-op, so the card still settles on exactly `toRot`).
- **A flier shows one side, never two.** It was a barrel roll around Y — two faces in a `preserve-3d`
  node, `.layer` carrying the `perspective` — and the card's back was turned to the table once per
  turn: at two turns in 470ms a wild *blinked*, which reads as a loading spinner rather than as a
  throw. A card spinning flat is still thrown; a card that hides its face mid-flight also hides the
  thing the play is about. `kind` alone decides the side (`data-flier-face`), so a draw is a back for
  its whole flight and a play a face for its whole flight.
- `swell` is the mid-flight scale — the card passes nearer the camera. This is most of what separates
  a card being *thrown* from a sprite being moved.
- **The pile reveals on impact, not on the message.** `DiscardPile` holds its new top for
  `revealDelayMs`, except for the first card it ever shows (opening discard, or a board rebuilt after
  a reconnect) — nothing flew there, and waiting for that flight blanks the pile for half a second.
  Same reason the SKIP/REVERSE/+N callout takes a `delayMs`.
- `AnimationLayer.Impact` is the shockwave ring, tinted `ACTIVE_RING[card.color]`, fired by
  `GameBoard.landCard` for rare/legendary only. A legendary also kicks the board — via the **`translate`
  property, not `transform`**: `.stage`'s transform is the board scale, and a WAAPI transform
  animation would override it mid-kick and resize the whole table.
- Foil (`Card.module.css`): `.foil` is static iridescence **masked to the frame** — run across the
  whole face it desaturates the suit colour, and suit colour is what has to survive stream
  compression. `.glint` is the travelling highlight, desynchronised per card by `holoOffsetMs` so
  neighbours don't glint in lockstep. `.card.playable.legendary` is declared last on purpose:
  "you can play this" is information and outranks flavour.

### Reduced motion
- `<MotionConfig reducedMotion="user">` in `main.tsx` covers framer-motion; a `@media (prefers-reduced-motion: reduce)` block at the end of `styles/tokens.css` neutralises CSS transitions/animations globally.
- When adding motion, verify it degrades to a readable static state rather than disappearing.

## Reconnect visual recovery
- On `player_reconnected`: store `isReconnecting:true` before applying state.
- `useReconnectAnimation(isReconnecting, onComplete)` shows "Rebuilding table…" overlay for 600ms then calls onComplete (which clears `isReconnecting`).
- `<GameBoard />` hides its children while reconnecting; on the false→true→false transition it bumps an internal `rebuildKey`, replaying a 350ms board fade-in CSS keyframe.
- Visual only; server is authoritative.

## The realtime path (tap → wire → table)
Every hop between a player's finger and the other clients' boards is on the critical path of a
mechanic that is decided by arrival order. Treat a delay added here as a rules change, not as
polish.

- **nginx `/ws` sets `tcp_nodelay on` and `proxy_buffering off`.** Gameplay messages are a few
  hundred bytes each, which is exactly the shape Nagle holds back waiting for a fuller segment:
  up to 40ms of invisible delay on a card play, on the one hop nothing in the app can see. The
  buffering flags say the same thing for nginx's own buffers.
- **The upgrader keeps compression off** and sizes its write buffer (4096) so a personalised
  `game_state` goes out in one write. permessage-deflate would buy no bandwidth worth having on
  payloads this small and would put a deflate pass plus a flush on both ends of every play.
  `WriteBufferPool` is shared, so a ten-seat table does not hold ten per-connection buffers for the
  whole match.
- **The client sends first and animates second.** `GameBoard.handleCardClick` calls
  `props.onCardClick` and only spawns the hand→discard flight if it returns `true`. The flight is
  local rendering; the message is what the table is waiting on.
- **A tap that is not a play animates nothing.** `GameView.handleCardClick` returns `false` when the
  client refuses the card and when the tap only opens the colour/player prompt. It used to fly the
  card on every tap, so an illegal card and an unconfirmed wild both threw the card at the pile and
  had it reappear in the fan. Plays confirmed later go through `flightRef`
  (`GameBoardHandle.flyFromHand`), called by the picker callbacks straight after `onSend`.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, keyed `draw` / `pass` / `uno` /
  `catch:<seat>`). One shared 400ms lockout silently ate the most ordinary sequence in the game,
  draw then pass, along with LOCO-then-catch and catching a second seat after a Swap. A control that
  ignores a deliberate tap because a *different* control was used 300ms ago reads as a dead button.
  The catch key carries its target because two seats are two taps.
- `src/test/realtime.test.tsx` owns all of the above on the client side.

## Client transport
- `useWebSocket.send(msg)` queues to `pendingRef: ClientMsg[]` when not OPEN; FIFO flush on `onopen`.
- Auto-reconnect: `reconnectDelay(attempt)` walks `RECONNECT_DELAYS_MS`
  (250ms, 500ms, 1s, 2s, 4s, then held), max 10 attempts, `attemptsRef` resets on `onopen`.
  **The first retry is deliberately almost immediate.** Most drops are a single lost connection
  that comes straight back, and the flat 2s first retry it replaced cost the player an entire
  interrupt window of dead board every time one happened. The tail still backs off, so a server
  that is genuinely down is not hammered.
- `getReconnectMsg`: `screen==='game'` → token-auth `join_room` reclaim; `screen==='waiting'` → plain nickname `join_room` (best-effort; may fail with "nickname already taken" → reload).
- `App.handleMessage` deps `[]`. Branches needing CURRENT store values use `useGameStore.getState()`. Stable Zustand actions safe.
- React renderer relies on Zustand selector equality; expensive re-renders are avoided via stable references in the store.

## Score table (hold TAB)
`<ScoreTable />` is the in-match standings panel: seat colour + nickname, one column per finished
round, cumulative total, rounds won, ping. Pure merge/sort and the ping banding live in
`scoreTableModel.ts` (`buildScoreRows`, `pingTier`), unit-tested; the component only renders.

- **Opened by holding TAB** (`useHeldKey('Tab', enabled)`) **or pinned by the scores button** in the
  top-right cluster. Held and pinned are separate states: releasing TAB must not close a table
  somebody deliberately pinned, and a phone has no TAB key at all.
- **That button exists on touch layouts only** — `.scoresBtn` is `display:none` until
  `(max-width: 480px), (pointer: coarse)`. It is the fallback for the missing key, so on a machine
  that has the key it is a permanent control for something already one keypress away, spending room
  in a cluster of four. The coarse-pointer half of the query is what covers a tablet, which has no
  TAB either and is wider than 480px.
- **It is an icon** (a table glyph, drawn inline in `GameView` like every other rule glyph in this
  UI, never a font character), 40×40 like `<ThemeToggle />` beside it: at phone width the cluster
  has no room for a word, and the three buttons next to it are already square. `t.scoreTableBtn`
  survives as its `aria-label` + `title`, so the accessible name is unchanged and the E2E locator
  still finds it. `aria-pressed` tints it with `--color-primary` when pinned — the panel can be
  dismissed by tapping its backdrop, and nothing else would say the state changed.
- E2E: the desktop project therefore opens the table by **holding TAB** (`holdScores` in
  `score-table.spec.ts`); one test resizes to 390×844 to exercise the button and asserts it hidden
  before the resize.
- `useHeldKey` resets on `blur`. Alt-tabbing away swallows the keyup, and the overlay would stay
  stuck over the board with no way out. It `preventDefault`s TAB, so `enabled` is false while the
  rules modal, a picker or the round summary owns the screen: inside a dialog TAB is the dialog's.
- `.topRight` sits at **z-index 46, above the panel's 45**. The button that pins the table open is
  the button that closes it; a panel that swallows its own toggle is a trap on touch. Pickers (100)
  and the rules modal (1000) still cover the cluster.
- **Ping bands** (`pingTier`): <60 good, <120 ok, <220 poor, beyond that bad. Tighter than a
  turn-based game would need, because an interrupt is decided by arrival order at the server.
  `rtt_ms < 0` renders as "not measured", never as a flattering 0 ms; bots are labelled `BOT`.
- Rows are ordered by score, then rounds won, then seat, i.e. the match tiebreakers, so the panel can never
  contradict the final standings.
- Under 480px the **rounds-won column is dropped** and under 400px the "you" badge goes too. The
  ping must not be the thing pushed off the right edge of a phone: it is the one column that cannot
  be derived from anything else on screen (the gold row already says which seat is yours).
- Scenes `game-scores` and `game-scores-round-one` cover both states in the showcase.

## Per-round history (`Room.RoundHistory`)
- `RoundHistory[k][playerID]` = points scored in round k+1, appended by `endRound`. Only the
  finisher scores, so exactly one column per row is non-zero.
- Nil'd by `Start()` and `ResetForRematch()`.
- Exported in `GameStateDTO.round_history` (every snapshot, so a reconnect rebuilds the table) and
  in `round_end` (the next `game_state` is buffered behind the round summary, so without it the
  table would be a round stale for as long as the summary is up).
- Server-owned on purpose: cumulative `Scores` cannot be split back into rounds once a player wins
  twice, and a client-side accumulator would differ per client after a reconnect.

## Latency measurement
- `Client.latencyMs` / `pingSentAt` (atomics). `writePump` stamps every ping frame, the pong handler
  folds the round trip in at 0.6 old + 0.4 new (`notePong`), capped at `maxLatencyMs`.
- `PingPeriod` (var, 5s) is a **latency probe first, keepalive second**. `pongWait` (60s read
  deadline) is unchanged. Browsers answer ping frames in the WebSocket layer with no page code
  involved, which is why this is a real network RTT and not something a client could report about
  itself.
- `hub.broadcastLatencies()` runs off a ticker in `Run()` (`LatencyBroadcastPeriod`, var, 3s) and
  only for rooms with `StatusPlaying`. **A room where nothing has been measured yet is skipped**:
  a payload of `-1` says exactly what the client's own default already says, and the extra traffic
  showed up as flakiness in tests that read the next message of a given type.
- Both periods are exported vars so tests can shorten them; production never changes them.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard, roundHistory?)`.
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

## Hand synchronisation
**Every path that grows a hand goes through `hub.sendHandGrowth`** — it sends the affected player
the actual cards (`card_drawn.cards`) and everyone else only the count (`drawn_count`). Callers:
`handleDrawCard`, `autoDrawOnTimeout` (both the plain and the penalty branch), `handleCatchUno`,
`handleBotCatch`. Hands rearranged wholesale (Swap / GlobalSwitch) instead get a personalised
`game_state` per recipient.

Telling a client the count but not the cards desyncs it silently and unrecoverably: its local hand
stays short, the player empties the hand they can see, the server still holds cards for them, so the
round-end check never fires — the board freezes on "your turn" with no cards. That is exactly what
the UNO-catch penalty (+2) and the penalty branch of the turn timeout used to do.

**A `card_drawn` also carries the turn state, to everyone, always.** `pending_draw` and `has_drawn`
are `*int`/`*bool` on `ServerMsg` precisely so `omitempty` cannot swallow a `0`/`false`, and the
client applies them verbatim (absent = unchanged) instead of inferring anything from the fact that a
hand grew. **Not every hand growth is a turn action**: the LOCO-catch penalty gives +2 while the
draw-once flag is still false, and that message reaches the whole table. Defaulting the missing flag
to "has drawn" is what produced a seat that could neither draw (button disabled) nor pass (server:
`you must draw a card before passing`) until the turn timer auto-acted for it.

**Shrinking a hand has the mirror rule.** `applyCardPlayed` drops copies of the played card until the
local hand matches the `hand_size` the server sent in the same message, because one `card_played` can
represent several discards — a batch interrupt slams *every* identical copy the player holds. Removing
exactly one left the rest as phantom cards: they rendered, they could be tapped, and the server
refused each tap with "card not in hand".

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

### Refused actions never show a wire string
`i18n/serverErrors.ts` maps the server's error prose onto `Translations.errors` (`ErrorCopy` in
`en.ts`). The server's strings are written for the log — `illegal card play`, `not your turn`,
`nickname %q already taken` — and they used to render verbatim, so a French player tapping the
wrong card was refused in English by a UI that is otherwise entirely in their language.

- Matching is by **ordered regex, first match wins**, because several server messages interpolate
  values (`nickname %q already taken`, `room is full (max %d players)`, `hand has %d copies`).
  Narrower rules come first — the counter-card rule must beat the generic card rules.
- Unrecognised input resolves to `errors.generic`, never to the raw string. A new server message is
  a vaguer message, not a leak and not a crash.
- **Resolution happens at render**, in `Lobby` and `GameView`, not at `store.setError`. The store
  keeps the raw string so switching language re-renders the error in the new one.
- Deliberately **not** a protocol change: the wire keeps its human-readable string and the client
  owns how a refusal is phrased, the same way it owns all other copy.
- `src/test/serverErrors.test.ts` asserts every player-reachable server string resolves to something
  other than itself, in both languages. **Add the string there when you add a server error.**

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

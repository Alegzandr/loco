# Game rules and domain model

The pure domain (`server/game/`) and the rules the server enforces. For the transport layer and the
hub's own machinery, see `server.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

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
- **A draw never fails, and the order inside `DrawCard` is the rule.** `ensureDeck` reshuffles the
  discard, then `Deck.DrawUpTo` hands over whatever is left — possibly nothing, once every card sits
  in a hand. `DrawCard` validates first, then draws, and only *then* clears `PendingDraw` and sets
  `HasDrawn`: nothing above that line touches the state and nothing below it can fail.
  - It used to clear `PendingDraw` and set `HasDrawn` **before** calling the all-or-nothing `DrawN`,
    and return `"deck exhausted"` on an already-mutated state. A 16-card stack against 10 remaining
    cards evaporated with nobody drawing anything, and since the handler returns before any
    broadcast, the client kept `pending_draw: 16 / has_drawn: false`, the turn timer was never
    re-armed, and a bot in that seat re-scheduled itself forever (`botDraw` returns false on error →
    `maybeScheduleBot` → `BotThink` asks to draw again). `DrawUpTo` was documented here for months
    before it existed.
  - **The seat keeps the turn when nothing came out.** It still has `HasDrawn`, so it can play or
    pass; auto-passing for it would take away a card it might have been holding to play. `botDraw`
    already passes on its own when it cannot play.
  - The UNO-catch penalty (`CatchUndeclared`) shrinks the same way rather than voiding the catch —
    the same rule `PenalizeFailedCatch` next to it already followed.
- `Deck.DrawN` survives for **dealing only**, where a short hand is worth refusing before any card
  moves. Every in-play draw goes through `DrawUpTo`.

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

## Refusals that prove a stale client
`PlayCard` / `PlayCards` / `CounterDraw` / `DrawCard` / `PassTurn` / `InterruptPlayCards` return
**sentinels, not new strings**, for the four refusals a correct client cannot produce on a board it
shares with the server: `ErrNotYourTurn`, `ErrIllegalPlay`, `ErrCardNotInHand`,
`ErrMustAnswerPenalty` (plus the batch `hand has %d copies` variant). `game.IsStateMismatch` groups
them, `staleState` marks them without touching a character of their text, and the hub answers each
one with a fresh snapshot rather than a bare "no" (see `notes/server.md`). Same treatment, and same
reason, as `IsMissedCatch` and `IsLostRace`: a refusal has a *kind*, and the hub cannot read one off
a string it is free to reword.

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
- **A catch that lands is announced** (`applyUnoCaught` → `store.catchFlash` → `<CatchBanner />` +
  the penalty cards flying to the caught seat). See "Streamable moments" in `visual.md`: for a long time the *miss*
  had a notice and the *hit* had nothing at all, so the game's hardest reaction was also its most
  silent, and the only thing the table saw was two cards appearing in somebody's hand.
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

## Per-round history (`Room.RoundHistory`)
- `RoundHistory[k][playerID]` = points scored in round k+1, appended by `endRound`. Only the
  finisher scores, so exactly one column per row is non-zero.
- Nil'd by `Start()` and `ResetForRematch()`.
- Exported in `GameStateDTO.round_history` (every snapshot, so a reconnect rebuilds the table) and
  in `round_end` (the next `game_state` is buffered behind the round summary, so without it the
  table would be a round stale for as long as the summary is up).
- Server-owned on purpose: cumulative `Scores` cannot be split back into rounds once a player wins
  twice, and a client-side accumulator would differ per client after a reconnect.

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


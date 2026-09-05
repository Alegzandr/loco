# Game rules and domain model

The pure domain (`server/game/`) and the rules the server enforces. For the transport layer and the
hub's own machinery, see `server.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## LOCO deviations from original SOLO rules
Authoritative spec: `docs/rules.md` §14. Summary of intentional deviations:
1. **GlobalSwitch (Change Cards All Round) is wild** — 4 copies, no color, plays on anything, and names the new active colour like the other two wilds. SOLO has it as colored 1-per-color. Implemented in `game/deck.go` (4 wild copies) and `game/card.go` `IsWild()`. Rationale: simpler, avoids dead cards.
2. **Starting card is always a Number** — `dealRound` skips action/wild cards until a Number is found (`game/room.go`). SOLO applies the starting action's effect to the first player. Rationale: avoids first-turn ambiguity (Take 4 with no context, Swap with empty game state).
3. **Best-of-N match format**, not 600-point threshold — BO1/BO3/BO5/BO7 (`game.MatchFormat`), and **the match is taken by rounds won rather than by points**. See "Rounds won take the match" below for the whole rule and the bug it closed. Rationale: predictable online game length, and a format label that is true.
4. **Voluntary draw is allowed** — current player may draw even with a playable card in hand (still 1 draw max per turn). `Room.DrawCard` only enforces `HasDrawn` to prevent a second draw. Rationale: strategic depth; matches UNO official rules.
5. **A forced draw does not cost the turn** — the victim of a +2/+4 stack takes the whole accumulated amount and then plays normally (or passes). `Room.DrawCard` sets `HasDrawn` in both branches and never advances `CurrentTurn`; nothing but `PlayCard`/`PassTurn`/an effect moves the turn. **`hub.handleDrawCard` re-arms the turn timer on every draw** — the domain kept the turn but the clock was still the one armed when the +2 landed, so a victim who took a few seconds to decide against countering drew the stack and was auto-passed right after: the deviation held on paper and the seat still vanished. One draw per turn bounds the extension. Rationale: cards *and* turn for one played card is two punishments, and it reads as a bug — the hand jumps and the seat is gone before the player can act. Stacking (`CounterDraw`) is still how you avoid drawing at all.
6. **A Contre-LOCO! that finds nobody costs the caller 1 card, at most once per offer, and only
   while one is on the table** — the call only lands inside the target's 5s window, and a press that
   misses while somebody is one play from the finish is charged: the target's own LOCO! got there
   first, its hand grew, the window had already closed, or no seat owed the call at all. A press
   against a table where nobody is that close is not a wager and is answered by nobody. SOLO ignores
   an unfounded call. `failedCatchPenalty` + `Room.PenalizeFailedCatch` + `Room.CatchOffered`,
   rationed by `catchOfferKey`; see "LOCO! declaration & catch windows" and `docs/rules.md` §14.6.
   Rationale: the button is live from two cards out, so pressing it is a read of the table rather
   than an answer to a cue the server gave — an unpriced one is free to mash and the reaction stops
   being one, and a per-press price would bill the same misread ten times over. Two rather than
   three because the price is only a price while the card stays where it landed: see "The threshold
   is what keeps the price from being buyable" below. **And the seat that owes the call gets the
   first 1.5s of its own window** (`CatchHeadStart`): a press inside it is held by the hub and
   resolved when the head start ends, so nobody's LOCO! can be denied by a thumb that never lets go.
   See "The head start" below.

## Scoring & match system
- `CardValue(c Card) int` (`game/card.go`): Number=face; Reverse=10; Skip=20; DrawTwo=30; Swap=30; GlobalSwitch=40; WildCard=40; WildDrawFour=50. Matches `docs/rules.md` §10.
- **Single-finisher round**: ends when any player empties hand. Winner: `Room.Winner`, `Room.RoundsWon[winnerIdx]++`, scores sum of opponents' remaining values. Others score 0; their hand value adds to `Room.LostHandTotal[i]` (tiebreaker only). No in-round spectating, placements, `Finished[]`, or `Placements[]`.
- `Room.endRound(winnerIdx)` finalises scoring, sets `RoundEnded=true`. Does NOT deal next round — hub calls `Room.BeginNextRound()` AFTER broadcasting `card_played` and `round_end` (otherwise the round-winning `card_played` reads the new round's discard top).
- Scores accumulate in `Room.Scores []int`. `Room.MatchOver`/`MatchWinner` indicate completion (resolved in `endRound`).
- Round starter: round 1 = random (`Room.rng`); subsequent = current biggest loser (lowest cumulative score; tie → lowest playerID via `Room.biggestLoser()`).
- Formats: BO1/3/5/7 (`game.MatchFormat`).

### Rounds won take the match; the score measures the gap

**The bug it closed.** `determineMatchWinner` used to filter on `Scores` first, so a seat could take
three rounds of a BO5 and lose the match to somebody who took one expensive one — a Take 4 and a
Global Switch left in a full hand is 90 points off a single round. Nothing on screen could explain
that result, because "best of 5" does not read as "most points after 5", and the format labels
(`bestOf3`, "Meilleur des 3") were saying the opposite of what the server did.

- **Tiebreakers, in order**: most rounds won → highest score → lowest lost-hand total →
  sudden-death extra round. `determineMatchWinner()` returning `""` is what triggers the last one.
- **The score survives, and it is not decoration.** It breaks the tie above, it picks the seat that
  opens the next round, it is what the score table shows beside the rounds, and it is the number a
  rating or a skill-based queue would be built on later. What it stopped being is the answer to
  "who won".
- **The match stops as soon as the lead cannot be caught** (`Room.decisiveLeader`). A seat is
  decisive when `RoundsWon[i] > RoundsWon[j] + remaining` for every other `j`, with
  `remaining = max(0, Format - RoundNumber)`. **One expression covers both endings**: `remaining` is
  zero once the format is exhausted, so the same test that stops a BO7 at 4–0 is the one that says a
  BO1 ended on its only round. `endRound` asks it, and falls through to the tiebreak chain when the
  format has run out without it being satisfied.
- **"Strictly ahead of everyone" rather than "reached the majority"**, because the majority is only
  the right number at two seats. Six players sharing a BO7 never reach 4 and the match still has to
  end.
- **A decisive leader is by construction the unique maximum on rounds won**, so the first filter of
  the chain resolves them: `endRound` can ask one question ("can this stop?") and then another
  ("who took it?") without the two being able to disagree.
  `TestRoom_MatchStopsOnceTheLeadIsUncatchable` and `TestDetermineMatchWinner_RoundsWonBeatsScore`
  own the pair.
- **`biggestLoser` deliberately stays on points.** Rounds won is exactly the wrong signal for "who
  opens the next round": only one seat per round wins one, so past two players half the table sits
  on zero and the opener would be whichever of them holds the lowest index, every round, all match.
  The score being the fine-grained measure of how far behind somebody is — the whole reason it
  survived the rule change — is what makes it the right one here.
- **A forfeit is unaffected**: `ForfeitTo` awards the match without touching the scoreboard, which
  was already the right semantics and still is.

### The evening's recap (`table.matchHistory`)

One record per **match** this table has finished — each seat's rounds won and points, plus the
winning seat — kept on the hub's `table` rather than on the `Room`, because it has to outlive the
room's reset.

- `ResetForRematch` nils `Scores`/`RoundsWon`, so six matches on one code used to leave nobody able
  to say who won the evening. `resetForNextMatch` clears everything belonging to the match that just
  ended; this is the one field there that is *about* the matches before it, so it is not cleared.
- `recordFinishedMatch()` is called once per match, from both endings: the last round
  (`handleRoundOrMatchEnd`) and a forfeit (`forfeitMatch`). A walkover is a finished match as far as
  the evening is concerned, and the scoreboard it ended on is exactly what happened.
- It **copies** the room's arrays. Holding the live slices would make every record read as the next
  match the moment `Start()` reallocated them.
- It is indexed by seat, so it moves with the seats: `dropSeat` removes the column and re-bases the
  winner (a departed winner becomes `-1`, never the player who slid into the index), `swapSeats`
  exchanges both. No twelfth map — a slice of records on the struct.
- It rides `match_end` (the one message that opens the screen reading it) and every personalised
  `game_state` (so a reconnect mid-match still has the evening behind it), and it travels in the
  drain snapshot. Adding it to `roomSnapshot` is what bumped `SnapshotSchemaVersion` to 2 (it is at 3
  now: `GameState.InterruptOpen` changed the shape of `game.Room` in turn).
- **And it rides the `player_left` that re-bases the roster**, on all three paths that shrink it
  (`releaseSeat`, `handlePlayerDisconnect`, and the expiry branch that removes the seat for real).
  The screen reading it is already open by then: a seat going takes a column out of every row, and a
  client that keeps the version from before draws each player the *next* player's evening. The
  client cannot re-base it on its own — the column that went belongs to a seat that is in neither
  roster — so the message that moved the seats carries the moved recap. The other `player_left`, the
  mid-match expiry that names a seat, re-bases nothing and carries nothing.
- The client draws it only past one record: a single column is the standings immediately above it,
  said twice (`hasEveningToShow`).
- **Each record carries how long the match was played** (`matchRecord.DurationMs`, on the wire as
  `duration_ms`). Measured on the table between two stamps: `table.matchStartedAt`, written by
  `openTable` — `match_ready`, the moment the turn clock starts, and not the deal, because the
  map-loading gate is a wait and not the game — and the `now` handed to `recordFinishedMatch`. Handed
  in rather than read inside, so the internal test chooses both ends. **Zero means "cannot say" and
  is omitted from the wire**, so a match that opened is rounded *up* to at least one millisecond
  (`matchDurationMs`): the client draws nothing for zero, and a played match must never read as an
  untimed one. The two zero cases are real: a forfeit inside the loading gate (nothing was played),
  and a match restored from a snapshot written before `roomSnapshot.MatchStartedAt` existed. The
  stamp rides the drain snapshot for that reason — a deploy mid-match must not restart the clock —
  and `resetForNextMatch` clears it, because the next match is timed from its own open. The client's
  half is `components/matchDuration.ts`: the last record is the match that just ended (recorded
  before it is announced), worded in minutes and never seconds, under a minute said in words.

### Round and match plumbing
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
  - **`Deck.Replenish` appends the pile to what is left of the deck, it never replaces it.** The
    replenish runs when the deck is *short*, which is exactly when it is not empty: it used to
    `make` a fresh slice from the pile, so the unseen cards still in the deck were thrown away — a
    +6 against a two-card deck cost the round two cards for good, and hands + deck + pile no longer
    summed to 112. `TestEnsureDeck_KeepsTheCardsStillInTheDeck` counts them.
  - **A batch is never longer than the hand it comes from**, and `hub.parseCardsFromMsg` refuses one
    that is before it decodes a single card of it: a 4 KB message carries a hundred DTOs, and the
    domain would otherwise walk every one of them, at the rate limit, to reach the refusal it was
    always going to give.
- **Removing a seat re-bases everything the scoreboard is drawn from** (`RemoveLobbyPlayer`:
  `Scores`, `RoundsWon`, `LostHandTotal`, `Retired`, every row of `RoundHistory`), because a finished
  room keeps its scores for the game-over screen and re-basing the roster alone showed the leaver's
  column under the seat above it. The `player_left` that shrinks the roster carries the re-based
  `scoreboard` and `round_history` for the same reason it carries `match_history`.
- **A one-card interject off a one-card hand logs one declaration.** `requireLocoToFinish` has
  already established the seat called it before the message; `declareForFinish` runs for the batch
  finish alone, so the event log a reconnecting client replays no longer announces the call twice.
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
- **Identical-card interrupt** (`Room.InterruptPlayCards(playerIndex, cards, chosenColor, chosenPlayer, declareLoco)`, alias `InterruptPlay`, which passes `false` because a single card can only empty a hand that was already down to one): **anyone** plays N identical cards exactly matching top discard. Effect applies from interrupter's seat; they become turn leader.
- **There is no deadline and no excluded player.** The player who just played may take the lead back with a second copy, and so may the current player. Everything is a race decided by arrival order. Removing those two restrictions is what makes the mechanic feel realtime instead of turn-based — do not reinstate them.
- **Every kind can interrupt, wilds included**: Wild on Wild, WildDrawFour extends a +4 chain, GlobalSwitch rotates hands from the interjecter's seat. Wilds share `Color: Wild`, so plain equality still keeps a Wild off a WildDrawFour. **Every** wild interject must name a real colour (`chosenColor != Wild`), GlobalSwitch included.
- **Batch interrupt**: send N copies via `play_cards: [...]`. Effects stack (N DrawTwo = `2*N` pending; N Skips skip N players; N Reverses parity-flip). Swap and GlobalSwitch can't batch (which target? how many rotations?).
- **The batch is built client-side and nobody is asked how many copies to send** (`batchForSlam` in `client/src/hooks/gamePlay.svelte.ts`, mirrored by `game.BotInterrupt`), because an interject is a reaction and a second press is a second reaction. That is honest only while every extra copy *buys* something, which is exactly the list `stackBatchEffects` has a case for: DrawTwo, WildDrawFour, Skip, Reverse — plus a Number, which buys the shorter hand. **A plain Wild is on none of them**: N wilds name one colour, so the copies past the first leave the hand for nothing, and the hand they leave is the most flexible card in the game. A player who slammed one wild to take the lead back was charged all three of theirs for it. So a Wild batches for one reason only, **when the batch empties the hand and takes the round** — worth every wild it costs, and carrying the call like any other finishing batch. The domain still accepts a wild batch from any client: this is the tap's meaning, not a rule about legality.
- During a draw chain (`PendingDraw > 0`) only DrawTwo/WildDrawFour may interject — implied by identical-to-top in a consistent state, kept explicit as a guard.
- Window state on `GameState`: `InterruptOpen` (the window), `LastPlayBy` (-1 = nobody played the card on top), `LastPlayAt` (informational). Armed by `armInterruptWindow(actor)` after `PlayCard`/`PlayCards`/`InterruptPlayCards`/`CounterDraw`, and by `dealRound`. Closed by `closeInterruptWindow()` on `DrawCard`/`PassTurn`/round-winning play/round end.
- **The opening discard is interceptable, and that is why the window and its author are two fields.** They used to be one, and a dealt card has no author: a seat holding the twin of the card the round opened on was answered `interrupt window closed`, which the client renders as *"somebody was faster"* — on a table where nobody had played anything yet. `dealRound` now sets `InterruptOpen: true` with `LastPlayBy` still -1: the window is open and belongs to no seat, so every rule below (no deadline, nobody excluded, the current player included) applies to it unchanged. `TestRoom_InterruptPlay_OpeningDiscardIsInterceptable` reads it off a real deal rather than a fixture, because the bug was in what `dealRound` left behind.
- **Bots are the one exception, and it costs nothing to state twice**: `game.BotInterrupt` and `hub.maybeScheduleBotInterrupt` both gate on `LastPlayBy >= 0`, not on `InterruptOpen`, so they answer plays and not deals. A bot slamming the opening discard would take the round's first turn off the seat the deal handed it, before that player had touched anything — an interject is a reaction, and there is nothing there to react to. The hub half is belt and braces: it only schedules off a human's move anyway.
- Resolution: fastest-server-received wins (single-goroutine event loop serializes).
- Wire: `interrupt_play` (legacy) + `interrupt_play_card` both accepted. Body: `{ card?, play_cards?, declare_loco? }` — `play_cards` non-empty takes precedence, and `declare_loco` is only read when the batch empties the hand (see the gate above). Server emits `interrupt_success { player_index, cards[] }` immediately before `card_played` for distinct lead-taking visuals.
- **Batch play** (`Room.PlayCards`): current player plays N identical via `play_cards` (precedence over `card`). Effects stack (DrawTwo `2*N`, WildDrawFour `4*N`, Skips skip N, Reverses parity). Swap/GlobalSwitch excluded.

## Forgetting LOCO! and winning anyway (the gate)
`requireLocoToFinish(playerIndex, playing, declaring)` + `ErrMustDeclareLoco`, `docs/rules.md` §14.7.

**The hole it closed.** The declaration used to be enforced by the catch alone, which made it a 5 s
risk rather than an obligation: go down to one card, survive the window nobody was watching, win a
turn later having told the table nothing. And there was a second, louder version of the same hole —
a hand of **two identical cards played as one batch**. That hand goes 2 → 0. It never passes through
one card, so `updateLastCardState` never fires, no window ever opens, no `catch_seats` ever names
the seat, and the LOCO! button is never even offered. Sent as an *interject*, it takes the round out
of turn, instantly, off a hand nobody at the table saw drop to one. The game's loudest moment simply
did not happen, and a game built to be watched cannot have its ending arrive unannounced.

**Two branches, and the difference is who had the opportunity.**
- `playing == 1`: the seat has held that card since before this message, so the call was possible
  and a whole window existed to make it in. Only `LastCardDeclared[seat]` counts. A flag on the
  message would let the client fold the obligation into the winning tap, which is the same as not
  having the rule at all.
- `playing >= 2`: no declaration was ever possible, so none can be demanded of the past. The message
  carries it (`declare_loco`), the domain records it through `declareForFinish` — which sets the
  flag **and** logs `EventUnoDeclared`, because the log and the broadcast read the state, never the
  message — and `hub.announceFinishingLoco` puts `uno_declared` on the wire **before** `card_played`.
  That hub-side condition is read off the domain (`len(cards) >= 2 && hand is now empty`), not off
  `msg.DeclareLoco`: the domain has already refused the batch if the call was absent.

**Nobody is trapped by it.** `DeclareLastCard` accepts a late call at any point while the hand is one
card — the window being shut does not close the button. So forgetting costs the risk of being caught
and one extra press, never the round. `TestPlayCard_LastCardWithoutTheCallIsRefused` owns that
recovery, and it is the reason this is a gate rather than a penalty.

**All four win paths ask.** `PlayCard`, `PlayCards`, `InterruptPlayCards`, `CounterDraw` — the same
four `finishRoundWin` lists. The check sits **last in each validation block**, so an illegal card is
still refused as illegal and only an otherwise-good play is asked whether the table was warned; and
it sits **before any mutation**, so a refusal leaves the hand, the pile and the turn untouched.

**It is not a suspicious refusal.** `IsLostRace` covers it: a player forgetting is what the rule is
about, and counting it would make `suspected_cheats` a measure of how badly the table played. It is
deliberately **not** an `IsStateMismatch` either — the client's board is correct, so a resync would
answer a question nobody asked.

**Bots.** A bot's declaration is deferred on purpose (`BotUnoDelay`) so humans can win the race,
which leaves a window where a bot holds one undeclared card and its turn has already come round.
`hub.botDeclareBeforeFinish` makes the call first on the ordinary turn, the counter and the
single-card interject; a bot's finishing batch passes `declareLoco: true`. Without it the domain
refuses, `botPlay` logs and returns **without rescheduling**, and the seat stops playing for the rest
of the round — a bot that goes quiet does not fail, it just stops.

**A bot plays its identical copies together when a copy buys something** (`BotAction.Cards`,
`botBatchFor`), the way a human's tap does (`batchForSlam`) and the way it already did on an
interject: two +2s are a +4, two Skips step two seats, and a bot's last two identical cards take the
round with the call on the message (`DeclareLoco`, announced ahead of the cards by
`announceFinishingLoco` exactly as a human's is). Swap and GlobalSwitch never batch and a plain Wild
only when the batch empties the hand, for the reasons given under interrupts. Before this a bot
stacked +2 where a person stacks +4 and handed the table a catch window on a hand it could have
emptied, which is a visibly weaker game than the one it was sitting in.

**A bot's Swap goes to the smallest hand, and only when it pays** (`botSwapTarget`, `botSwapPays`).
A Swap exchanges the whole hand, so `BotThink` used to hand the bot the *fullest* hand at the table
on purpose — "put pressure on opponents" read the card as a penalty it deals rather than the trade it
is — and a bot on three cards swapping into nine was the seat everybody wanted at their table. It
now targets the fewest cards, skipping a retired seat (its hand went back to the deck, so it is the
smallest of all and the one target the domain refuses), and holds the card when no opponent is below
the hand it would keep: another legal card if it has one, one card off the deck if it does not, since
a draw costs one card and the exchange would have cost several. A Swap that empties the hand is the
exception and is always played — the round ends before any exchange (§13). `game.BotInterrupt`
applies the same test before slamming one, so the interject is not a faster way to make a bad trade.
`bot_test.go` and `bot_interrupt_test.go` pin all four cases.

**Fixtures.** Any test that drives a round to its end now makes the call: `declareLast` in the
domain suite, `declareBeforeWinning` over the wire in the hub suite. Three hub fixtures went the
other way and were given a **second card** instead (`drain_test`, `snapshot_test`,
`TestPlayCard_NonSwapOmitsChosenPlayer`): they assert that a play resolves, not that a round can be
won, and a one-card hand had made them finishes by accident.

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
- Wire: `catch_uno` carries `target_index` (the catcher names the seat) **when the client has one to
  name**. Absent means the press was made on a read rather than on a cue — the button is live from
  two cards out — and the hub still falls back to the window closest to expiring, which is the
  catch about to be lost and may be one the client had not been told about yet. No open window at
  all: charged (below).
- **A catch that lands is announced** (`applyUnoCaught` → `store.catchFlash` → `<CatchBanner />` +
  the penalty cards flying to the caught seat). See "Streamable moments" in `visual.md`: for a long time the *miss*
  had a notice and the *hit* had nothing at all, so the game's hardest reaction was also its most
  silent, and the only thing the table saw was two cards appearing in somebody's hand.
- **A Contre-LOCO! that finds nobody costs its caller 1 card** (`docs/rules.md` §14.6,
  `failedCatchPenalty`). Without a price, mashing the button at every seat holding one card is free
  and therefore always correct, which turns the game's hardest reaction into a reflex nobody has to
  aim. Three of the misses are timing (`game.IsMissedCatch`): the target declared first
  (`ErrAlreadyDeclared`), its hand grew (`ErrTargetNotSingleCard`), the window closed
  (`ErrCatchWindowExpired`). Those are **sentinels, not new strings** — the wire text is unchanged;
  what is new is that the hub can tell a lost race from an invalid target. The fourth is the press
  made on a read of the table that was simply wrong (`ErrNoCatchWindow`, or no seat named at all),
  and it is charged like the rest.
  - **It used to be free, and it was free because the button used to be a cue.** While Contre-LOCO!
    only lit up on the seats the server named in `catch_seats`, a call outside a window could only
    be a message no client of ours composed, so it was refused, charged nothing and told nobody. The
    button is now live from two cards out (`client/src/components/catchAvailability.ts`), because
    a control that unlocks on the server's permission can only ever *answer* a five-second window
    and never *anticipate* one. That makes the wrong press an ordinary part of playing, and the
    thing that keeps it honest is the price.
  - **The threshold is what keeps the price from being buyable, and that is why it is two and not
    three.** A card is a punishment only while it stays in the hand that drew it: a player holding a
    Swap or a Global Switch is about to hand their whole hand to somebody else, so a penalty they
    *chose* to take is ammunition, and the round's scoring pays them for it twice — the big hand
    leaves, and it lands on the seat that was about to win. The rationing (once per offer, and it
    used to be once per card played) bounds the *rate* of that but not its *direction*, and per card
    played the rate was worse the bigger the table: a full turn at four seats was three or four
    cards, a good deal faster than the voluntary draw (deviation 4) which is the legitimate way to
    fatten a hand at one card per turn of your own. Worse, the cards it hands over are what make the
    Swap likelier to be there in the first place, so the penalty finances its own profitability.
    - The fix is at the offer, not at the price. From **two** cards the window is one ordinary play
      away, so the miss is the thumb that had already committed when the seat drew instead of
      playing — a spasm, which is what a missed reaction is supposed to be. From **three** it needs
      an interject of two identical cards, which is rare, so the button would be live through a long
      stretch of round where pressing it can only ever miss. A long stretch of guaranteed misses is
      what turns the penalty into a menu item.
    - The criterion, if this is ever re-tuned: **a failed Contre-LOCO! must never be a faster source
      of cards than the voluntary draw**, and the wager must never be offered for longer than it can
      plausibly pay off.
  - **The price is per offer, not per press and not per card played** (`catchOfferKey`,
    `GameState.CatchPaidFor`). The offer is the near-finish picture the button is live for, as seen
    from the catcher's chair: every *other* seat on exactly two cards, and every other seat on its
    last card with the instant its window opened. A seat is charged once per key, and
    `PenalizeFailedCatch` returns `charged=false` for every press after that, which
    `hub.penalizeFailedCatch` answers with silence — no card, no broadcast, no notice. Two reasons
    as before: a game that billed each press would be taxing the reflex it spends the whole match
    asking for, and a table-wide `catch_failed` per press is the amplification `catchGrace` was
    written to stop. **It used to be per card played (`PlayEpoch`), and that was the farm**: a
    catcher pressed against a seat sitting on two, played a card of their own, and pressed again —
    two cards a turn off one opponent, faster than the voluntary draw, and every card of it stocked
    a hand for a Swap to hand on. The catcher's own play is deliberately not in the key, and neither
    is a card played from far out by anybody else; what moves the key is the near seat moving (down
    to one, which opens a window; back up, which ends the offer) or another seat arriving at two.
    A press that *lands* spends no key, so a Swap that puts two seats on one card can still be
    answered twice.
  - **And only while something is offered** (`Room.CatchOffered`, `catchNearHand`): a press against
    a table where no other seat is on two cards or on a last card inside `catchWindow + catchGrace`
    is not a wager. It is a board that moved under a thumb — the seat drew a moment before the
    press landed — or a client this game did not write, and neither is charged, answered or
    counted: `handleCatchUno` returns before it names anybody. Charged, it was the farm reopened by
    the back door to anybody forging the message; refused with a toast, it scolded a player whose
    button had been live a round trip earlier. The client's threshold (`CATCH_LIVE_MAX_HAND`) and
    this are the same shape on two sides of the wire, and `catchAvailability.test.ts` and
    `room_test.go`'s `PenalizeFailedCatch` cases pin each side.
  - **The head start** (`CatchHeadStart`, 1.5s, `ErrCatchTooEarly`, `hub.holdCatch` /
    `resolveHeldCatch`, `table.heldCatches`). A catch that would land inside the first 1.5s of the
    target's window is neither landed nor refused: the domain answers `ErrCatchTooEarly` *after*
    every check that could make the press a miss — a press that is early and wrong is charged now,
    not held and charged later — and the hub holds it, one per catcher per window (the key carries
    `LastCardAt`, so a window reopened underneath it drops the press rather than landing it on the
    next), and posts it back to the table at `CatchHeadStartEnd` through `resolveCatch`, the same
    road a live press takes. It lands if the seat is still silent, costs its card if the seat spoke,
    and several catchers resolve in arrival order because the table's box is FIFO. Before it, a
    catcher holding the button down landed on the millisecond the card touched the pile, before
    the seat's LOCO! could have crossed the wire: spamming Contre-LOCO! was the way to deny every
    declaration at the table. 1.5s is a thumb's trip from the card played to the LOCO! chip plus a
    round trip; the bots' `BotCatchDelay` sits at more than twice that and `scheduleBotCatch` clamps
    to the head start anyway, so a test that lowers the delay cannot make a bot the spammer.
    `catch_window_test.go` owns the domain half (`catchTime()` is how every test that catches on a
    window it just opened gets past the head start), `hub/catch_headstart_test.go` the hold.
  - `catchRaceRecent` still separates the two kinds of failure, and it still matters even though
    both now cost the same card: the target's window must have opened inside
    `catchWindow + catchGrace` (5s + 2s) for the call to count as a lost race, and outside that it
    is `ErrNoCatchWindow`. The grace is a network round trip plus the frame the button was drawn in.
    `server/game/catch_window_test.go` owns both sides of the line.
  - **A seat number the table does not have is still refused rather than charged**
    (`handleCatchUno`), with a `noteRejection`: no client of ours composes it, so it is a forged
    message and not a wager. A press naming *nobody* is the opposite — that is precisely what the
    live button produces — and it is charged.
  - `Room.PenalizeFailedCatch(catcher)` draws the card and touches **nothing else** — not the turn,
    not `HasDrawn`, not the target. A failed call is a side bet on somebody else's obligation and its
    caller may not even be in turn. Like every draw it cannot fail: with every card in a hand the
    caller simply gets away with it (see "A draw never fails") — and the epoch is spent all the
    same, so a dry deck refunds nothing.
  - `hub.penalizeFailedCatch` broadcasts `catch_failed { player_index }` (the *caller's* seat) then
    `sendHandGrowth`. Both the human path (`handleCatchUno`) and the bot path (`handleBotCatch`) go
    through it — a bot that mistimes pays the same price, or the two are playing different games. A
    miss deliberately does **not** `noteSuspect` and sends no error toast: the button was armed when
    it was pressed, and the client shows the penalty itself.
  - **A penalty that drew nothing is told to its caller and to nobody else.** `catchGrace` closed the
    call from *outside* a window; this is the one from inside it. Once both piles are dry the draw
    comes back empty, so the call costs nothing — and announcing it anyway made it the one gameplay
    message that was free to send *and* free to fan out, at ten a second for the whole seven seconds
    a target's window is open. There is also nothing to announce: the table would be rendering a
    penalty nobody paid. The caller still gets the frame, because their button did do something.
- **The client spends the wager on press, not on the reply** (`noteCatchAttempt` sets
  `CatchWindow.attempted`, which `deriveCatch` skips, **and** `store.catchSpent`). The server answers
  a round trip later, and since a miss costs a card, a target left armed in the meantime lets one
  impatient double tap pay twice for a single opinion. The 400ms `guardDoubleTap` is not that window.
  The window itself stays open — it is still somebody else's obligation, and another player can still
  take it — and **the button stays pressable**, because greying out under a thumb already on it is
  the one thing the action bar exists not to do.
- **`store.catchSpent` is the client's copy of the server's ration**, cleared by `applyCardPlayed`,
  the one event that can put a new offer on the table. It gates the *blind* press only: with a
  target named, the press always goes. Without it, the second tap of a double tap on a catch that
  landed would leave naming nobody, and the server would read it as a fresh wager against a window
  that had just shut — a card, charged in the same breath as the win. The server's guard would not
  have caught that one: a successful catch spends no offer.
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
- **Who is on the hook is the server's answer, and it rides `card_played`** as
  `catch_seats: [{player_index, ends_at}]` (`protocol.CatchSeatDTO`, filled by `hub.catchSeats` from
  `GameState.CatchableTargets` + `CatchWindowEnd`). The client used to work it out again from the
  roster and the card kind, which put "a Swap or a GlobalSwitch catches EVERY seat left on one card"
  in two languages with nothing checking they agreed. A drift there does not fail: it arms
  Contre-LOCO! on a tap the server refuses, or leaves it dark on a seat the player could have caught.
- Client holds it as `gameStore.catchWindows: { seat, endsAt, attempted? }[]`, and adds nothing to
  the server's list but its own memory of which button it has already pressed. `catchTarget` /
  `unoTimerEnd` are **derived** (`deriveCatch`: most urgent opponent window, never our own seat) so
  `<ActionBar />` and the timer bar stay single-target, and they are completed by the store itself
  (`store/deriveCatchMiddleware.ts`) rather than by each action: stored derived state fails by an
  action forgetting to recompute it, silently. `applyUnoCaught(seat)` on `uno_declared` /
  `uno_caught` retires one seat only; `pruneCatchWindows()` drops expired ones and promotes the next.
- **A hand that grows closes that seat's window** (`applyCardDrawn`). `CatchUndeclared` refuses any
  target that no longer holds exactly one card, so a window kept open past a draw is a Contre-LOCO!
  button armed on a tap that can only come back refused.
- **The client also keeps what the table *heard*: `gameStore.declaredSeats`, every seat whose current
  single card has been called.** A window is an obligation and it closes on its own; a declaration is
  a fact about a hand, and it is what says a seat is out of reach rather than merely not on the hook
  yet. Written by `applyUnoDeclared` from the server's confirmation, retired by `applyCardDrawn`
  (the hand grew), by `applyCardPlayed` (the roster says that seat is no longer on one card, or the
  server opened a fresh window on it) and by `applyGameState` (same question asked of a snapshot) —
  the shared filter is `store/helpers.ts: keepDeclarations`. **One** thing reads it:
  - **`myDeclared`**, our own seat, which spends the LOCO! chip. It is **derived** by
    `deriveCatchMiddleware` like `catchTarget`, for the same reason: an action that forgets to clear
    it leaves a dead button over an obligation the player still owes, and nothing fails.
  - **`isCatchLive` deliberately does not.** It reads hand sizes, our own seat and the clock, and a
    declaration the table has heard is not allowed to reach it. The button answers "is a seat near
    the finish", never "is somebody catchable", and the gap between the two questions is where the
    mechanic lives: a control that went dead the moment the last opponent called it would **report
    that call** to a player who was not listening for it, which is the listening the game is asking
    them to do, and it would refuse the press §14.6 exists to charge for — the thumb already on its
    way down when the seat shouted. That press is the spasm the wager is made of. So a declared seat
    stays offered until its window ends, and goes dark **when the window does** — a clock that runs
    the same whether the seat spoke or not, and so reports nothing.
    (`catchAvailability.test.ts` pins the seat on a declared single card as **live** inside its
    window and **dead** past it.)
  - **The clock is `store.onHookUntil`**, seat → the window end the server sent in `catch_seats`,
    written by `applyCardPlayed` and `applyGameState` (`updateOnHook`) and read against the roster.
    It is a separate structure from `catchWindows` on purpose: those are retired by `uno_declared`,
    `uno_caught` and a draw, because they drive the *armed* cue, and the clock must survive all
    three. A reloaded tab holds no clock, so a last card the snapshot does not name is dark there —
    the one reading a tab that was not listening can honestly give.
  - **Absence of a window is not a declaration either**, and it must reach the armed cue even less:
    catch seats ride `card_played` only, so a reloaded tab holds none of them.
- **And there is no latch any more** (`isCatchLive` + `catchLiveUntil`, derived by
  `deriveCatchMiddleware`; `GameView` arms one timer on `store.catchLiveUntil` and calls
  `rereadCatchLive`, which is a write naming `catchLive` and nothing else, enough to come back
  through the derivation). The button used to be held live from the moment it rose until the next
  card played, on the argument that a seat escaping — calling it, drawing, swallowing a stack of
  four — was the instant a betting thumb had already committed, and a control retracting there was
  the interface making the read for the player. The argument was right about the thumb and wrong
  about the price: held, the offer was **farmed**. Press against a seat on two, watch it draw to
  three, wait for anybody to play, press again — a card a play, collected on purpose, for a Swap to
  hand on. That is the abuse the latch's own bound was written against, arriving by the door the
  latch opened. So the button is a photograph again: it rises on the roster and the clock and falls
  on either, and the committed thumb is answered on the server by silence (`CatchOffered`), never by
  a card. `catchDerivation.test.ts` owns both halves; `penalties.spec.ts` plays the whole shape out
  against a real server, catch included.
- **`applyGameState` filters catch windows, it does not wipe them.** Swap and GlobalSwitch are
  followed by a personalised `game_state`, so clearing there made the exact rule this exists for
  unreachable: the player handed their last card was catchable for a few milliseconds and then
  untouchable. A window survives only while unexpired *and* its seat still holds one card, so a
  fresh deal still clears everything.

## Swap / GlobalSwitch notifications
- `card_played` includes `chosen_player` ONLY for `swap` (target's index). Omitted for everything else (incl. `global_switch`).
- `card_played` includes `direction` (1=cw, -1=ccw) — the post-effect play direction, populated on every play (not just Reverse). Lets clients update the direction indicator immediately without waiting for the next `game_state`. Client `applyCardPlayed` writes it to `direction` and uses it for the swap/global_switch notice arrow.
- Client `applyCardPlayed` derives `swapNotice` (`gameStore.SwapNotice`) when `card.kind` is `swap`/`global_switch`. Carries `kind`, `actorIndex`, `targetIndex` (-1 for global_switch), `direction` (game direction at play, picks GS arrow), `at` (Date.now() — the key that makes a second notice a second banner).
- `GameView` shows it as a purple-glow pill above the action bar (`.swapNotice`, keyed on `at` so a second notice replays the entrance), auto-clears after `SWAP_NOTICE_MS=3500`. i18n keys: `swapNotice`, `swapNoticeYouActor`, `swapNoticeYouTarget`, `globalSwitchNoticeCw`, `globalSwitchNoticeCcw` (`%actor`/`%target`).
- `<GameBoard />` watches `swapNotice.at` and spawns mini card-back trails (actor↔target for swap, chained seat→next-seat for global_switch) via `<AnimationLayer />`.

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
  in `round_end`, which is the message the round summary is drawn from and the only one that names
  the round that just finished.
- Server-owned on purpose: cumulative `Scores` cannot be split back into rounds once a player wins
  twice, and a client-side accumulator would differ per client after a reconnect.

## A seat that walks out of a match

`Room.RetireSeat`, and which of the two endings a departure gets is the hub’s (`notes/server.md`:
two seats able to play have to be left, or the match ends and goes to whoever stayed). Leaving itself
is never refused. This is what the domain does when the round carries on without the seat.

- **The seat stays and stops playing.** Hands, scores, rounds won and the turn order are indexed by
  it, so removing it mid-match would re-base every one of them under a running round. `Room.Retired`
  is match-level and survives every deal; `GameState.Retired` is the copy each round is dealt with.
- **The hand goes back into the deck, shuffled.** Those cards were hidden, so their new position
  tells nobody anything; left in a hand nobody holds they would shrink the deck for everybody else
  every time somebody left.
- **Everything that walks the table skips it**: `nextTurn` (which is also why `ApplyEffect` counts
  *active* seats, so a Reverse at three seats with one gone behaves as the Skip a duel makes it),
  `rotateSeats` for a Global Switch (the modular step it replaced handed a hand to a seat nobody can
  play from and the round stalled), `biggestLoser` for the next round’s opener, and the Swap target.
- **A pending draw aimed at it is cleared**, not passed on: the next player never earned it.
- **Its catch window is shut and its declaration marked spent**, so no client is left with
  Contre-LOCO! armed on a seat that is not there.
- **The scoreboard is untouched.** A departure is not a forfeit, and `ForfeitTo` is still the only
  thing that ends a match early. A seat that had already banked the rounds can therefore still take
  the match on the tiebreak chain: “neither wins nor loses by this act” is the rule, and excluding
  them would be losing by it.

## Rematch (end of match)
- **`rematch` is an ask every seat makes, not a host decision**, and the next match is dealt as soon
  as two asks are in — one offering, one accepting. The quorum, the broadcast (`rematch_offered`), what a
  departure does to a pending agreement and the two shapes the deal can take all live in
  `notes/server.md` ("A rematch by agreement"); what follows is the domain half alone.
- Reopening a finished room as a lobby replies **per recipient** with
  `rematch_started { room_code, player_id, players, match_format, max_players }`.
- `Room.ResetForRematch()` (`game/room.go`): requires `StatusFinished`. Clears `State`, `Winner`, `RoundEnded`, `MatchOver`, `MatchWinner`, `RoundNumber`, and nils `Scores`/`RoundsWon`/`LostHandTotal` (so `Start()` reallocates them sized to the roster present at that moment). Keeps `Players`, `Format`, `MaxPlayers`.
- `hub.handleRematch` first calls `pruneAbsentPlayers` — drops every seat with no socket behind it that is not a bot (i.e. humans who never came back), high→low, through `table.dropSeat`, which re-bases the members, the surviving `Client.playerID`, the bot set and the session tokens together. **This is why `rematch_started` is per-recipient: playerIDs can shift.** `promoteRematchHost` shifts two more when seat 0 is not one of the players who asked, and then `table.resetForNextMatch()` clears everything the finished match left, the map gate included.
- **A finished room's roster is mutable, exactly like a lobby.** `RemoveLobbyPlayer` accepts `StatusFinished`, and `handleDisconnect` routes the finished-room case through `reindexLobbyDisconnect` (+ `player_left` broadcast). Without this a phantom player would be dealt a hand in the rematch.
- Client: `applyRematch(myIndex, players, format, maxPlayers)` wipes all match state → `screen:'waiting'`, **the rematch asks included** (see `notes/client.md`: kept, they disable the button at the next game over). **Keeps `sessionToken`** (same room, still valid for reconnect during the next match). `App` adopts the server's `player_id`.
- `store.setPlayers` re-resolves `myIndex` by matching our own nickname in the incoming roster. Server-side re-indexing (lobby or finished-room disconnect) otherwise leaves a stale index, so a promoted player would never get host controls — e.g. the host leaves the game-over screen and nobody can rematch. Nicknames are unique per room, so the match is unambiguous.
- `GameOver` gives **every** seat the same button, in three states (ask / waiting / they asked
  first), driven by `rematchOffers` + `rematchNeeded` off `rematch_offered`. Past two seats it
  carries the count (`rematchWaitingTable`); at two it does not (`rematchWaitingOpponent`). **The
  size of the table is read off the roster, not off the quorum**, which stops at two whatever the
  size. See
  "The 1v1 queue on screen" in `notes/client.md`.
- Bots survive a rematch. `nextBotName` scans for the lowest free `BotN` rather than counting seats, so the first bot is `Bot1` and a surviving bot can't cause a duplicate-nickname `Join` failure.

## Lobby config
- Host messages: `set_match_format`, `set_max_players` (lobby only).
- Max players: `serverMinPlayers`(2) ≤ n ≤ `serverMaxPlayers`(10); cannot drop below current count.
- Any change → broadcast `lobby_config_changed` (match_format, max_players).
- `room_created`/`room_joined` include `match_format` + `max_players`.
- Defaults: BO1, 10 max.
- **Lobby disconnect re-indexes everything.** `Room.RemoveLobbyPlayer` removes + re-indexes `Player.Index`; `table.dropClient` re-bases the members, the surviving `Client.playerID`, the bot set and the session tokens in one move. First remaining player is always playerID 0 (host).
- Lobby disconnect leaving no humans → schedule cleanup immediately.

## Room codes
- 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I/l).
- `generateCode()` retries on collision. ~1B combos.


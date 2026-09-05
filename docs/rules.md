# LOCO! Card Game — Rules Specification

> Complete, unambiguous spec for implementation and verification. Based on the SOLO card game by AMIGO Spiel + Freizeit GmbH.

## 1. Overview

LOCO is a card-shedding game for **2–10 players**. Goal: be the first to discard all cards.

## 2. Deck (112 cards)

| Type | Cards | Details |
|------|-------|---------|
| Number cards | 72 | 4 colors (Red, Green, Blue, Yellow) × values 1–9 × 2 copies |
| Miss a Turn | 8 | 4 colors × 2 copies |
| Change Direction | 8 | 4 colors × 2 copies |
| Take 2 | 8 | 4 colors × 2 copies |
| Swap Cards with Another Player | 4 | 4 colors × 1 copy |
| Change Cards All Round | 4 | 4 colors × 1 copy |
| Choose a Colour | 4 | Black (no color) |
| Take 4 + Choose a Colour | 4 | Black (no color) |

## 3. Setup

1. Dealer shuffles and deals **8 cards** per player.
2. Remaining cards form the **draw pile** (face-down, center of table).
3. Flip the top card of the draw pile face-up beside it → **discard pile**.
4. If the starting card is an action card: apply its effect to the first player as if the dealer played it. If it's a black wild card, the dealer declares a color.

## 4. Turn Order

- First player: left of dealer. Direction: **clockwise** (until reversed).
- On your turn you **must** play a valid card if you have one. If you cannot, you **must** draw one card.

## 5. Playing Cards

### 5.1 Valid Play (matching)

A card is valid if it matches the top of the discard pile by **at least one** of: same **color**, same **number**, or same **action symbol**.

**Black/wild cards** (Choose a Colour, Take 4 + Choose a Colour) can be played on **any** card. After playing one, the player declares a color; the next player must match that color.

### 5.2 Drawing

- If you **cannot** play any card, draw **exactly 1 card** from the draw pile.
- If the drawn card is a valid play, you **may** play it immediately.
- If the drawn card cannot be played, keep it in hand and your turn ends.
- Exception: forced draws from Take 2 / Take 4 make you take the whole accumulated stack at once. That **counts as your draw for the turn** but does **not** end it — you may then play a card, or pass (see §14.5).

### 5.3 Draw Pile Exhaustion

When the draw pile is empty: take all cards from the discard pile **except the top card**, shuffle them, and place face-down as the new draw pile.

If there is nothing left to reshuffle either — every card is in somebody's hand — a draw simply
hands over fewer cards than it asked for, possibly none. It never fails. A player who draws nothing
still keeps the turn and may play or pass, a pending +2/+4 stack is considered settled by whatever
the piles could give, and a Contre-LOCO! penalty shrinks rather than cancelling the catch. The
alternative is a round nobody at the table has a legal action in.

## 6. Interjecting (Discarding Out of Turn / "Zwischenwerfen")

This is a **core mechanic** of LOCO.

### 6.1 Conditions

1. The card is **exactly identical** to the top of the discard pile (see 6.2).
2. The interject window is open — it opens on the deal and on every play, and
   closes on a draw, a pass, or the end of the round. **There is no time limit.**

The **card the round opens on counts**: a player dealt its twin may interject
before the first turn is taken. It is a card on the pile like any other, and the
window is about what is on top, not about whose hand it came from.

Anyone may interject, with **any** card kind: the player who just played (with a
second identical copy), the player whose turn it currently is, and every other
seat. This is deliberate — the interject is a race, and taking that race away
from the two players closest to the action is what made it feel like a turn.

### 6.2 "Exactly Identical" = same color AND same value

Both attributes must match. **AND, not OR.**

- ✅ Red 5 on Red 5 — allowed
- ❌ Blue 5 on Red 5 — rejected (different color)
- ❌ Red 3 on Red 5 — rejected (different number)
- ✅ Blue "Miss a Turn" on Blue "Miss a Turn" — allowed
- ❌ Red "Miss a Turn" on Blue "Miss a Turn" — rejected (different color)
- ✅ Black wild on black wild — allowed; wilds all share the "wild" colour, so the
  same equality test keeps a Choose-a-Colour off a Take-4. The interjecter names
  the new active colour just like on a normal wild play.
- ✅ Change Cards All Round on Change Cards All Round — allowed; hands rotate from
  the interjecter's seat.

Implementation: `card.color === topCard.color && card.type === topCard.type && card.value === topCard.value`. Using `||` instead of `&&` is a common bug.

### 6.3 Resolution After Interject

1. The interjected card becomes the new top of the discard pile.
2. **Set currentPlayerIndex to the interjecter's seat.**
3. Advance one step in the current play direction → that player goes next.
4. The player whose turn was pending loses it — no compensation.

**Example (clockwise A → B → C → D):** It's B's turn, top card is Red 7. D interjects with Red 7. Current player becomes D, next turn → A. B's turn is lost.

**Example (counter-clockwise):** It's B's turn, top card is Green 3. D interjects with Green 3. From D counter-clockwise → next turn is C.

### 6.4 Action Effects Still Apply

When an action card is interjected, its effect fires on the **next player after the interjecter** — it is not silently consumed. See Section 7 for each action's effect.

### 6.5 Interject During a Take 2 / Take 4 Chain

A player may interject with an identical Take 2 (or an identical Take 4) during an active chain. The chain continues from the interjecter's position with the accumulated total + 2 more. The next player after the interjecter must stack or draw the full amount.

### 6.6 LOCO! Call on Interject

The LOCO! rule (Section 8) applies to interjections. Going from 2 → 1 card via interject still requires calling "LOCO!" with the same penalty for forgetting.

Interjecting **every** card you hold — two identical cards played at once, taking the round out of turn — carries the call in the play itself (§14.7). That hand never passes through a single card, so no 5 s window ever opens on it and there is no earlier moment to announce it in: the tap that takes the round is the call.

### 6.7 Simultaneous Interjects

If multiple players could interject: **the first message the server dequeues wins.** The hub's single-goroutine event loop serialises them, so later attempts are evaluated against post-mutation state — usually still valid, since the same card is on top, and they simply take the lead in turn. Seat priority is deliberately not used: it would reward position over reaction, and this is a speed game.

## 7. Action Cards — Effects

All colored action cards follow standard matching rules (Section 5.1). Black cards can be played on anything.

**Miss a Turn** — Next player in play order skips entirely (no play, no draw).

**Change Direction** — Play direction reverses (clockwise ↔ counter-clockwise). Next player is determined by the new direction. In a 2-player game: acts like Miss a Turn (same player goes again).

**Take 2** — Next player draws 2 cards (then plays on normally — §14.5). **Stacking**: the next player may play a Take 2 **of the same color** instead of drawing; penalty accumulates (+2 each). Continues until someone cannot or does not stack → that player draws the full total. A Take 2 of another color is *not* a counter, but it is not wasted either: the forced draw keeps the turn (§14.5), so its holder takes the stack and may then play it as an ordinary card-type match.

**Choose a Colour** — Player declares a color (R/G/B/Y). Next player must match that color (or play a wild, or draw).

**Take 4 + Choose a Colour** — Player declares a color AND next player draws 4 (then plays on normally — §14.5). **Stacking**: next player may play another Take 4 + Choose a Colour to pass on the penalty (+4 each). **No cross-stacking**: Take 2 and Take 4 stack only with their own kind.

**Swap Cards with Another Player** — Player chooses any opponent; they swap entire hands immediately.

**Change Cards All Round** — Player declares a color (R/G/B/Y), AND all players simultaneously pass their entire hand to their neighbor in the current play direction. In a 2-player game: equivalent to a swap. Like every wild, it names the colour that becomes active (§14.1).

## 8. LOCO! Call

When playing your **second-to-last card** (going from 2 → 1 card in hand), you **must** call "LOCO!" before or at the moment of discarding. Penalty for forgetting: draw **2 cards**. This applies on normal turns AND on interjections.

It also applies when a **Swap** or a **Change Cards All Round** *hands* you a
single card: what the rule protects is the table's right to know somebody is one
card from winning, and a hand that arrived by rotation is one nobody has heard
announced. Every seat left on one card after a hand-rearranging play gets its
own 5 s window and is caught on its own (§11.1).

One card, one call: the declaration covers the single card it was made on, so it
cannot be repeated while that card is held. A rearranging play that hands you a
*different* last card is a new obligation, and the call comes back.

**Calling "Contre-LOCO!" is a wager** (§14.6). The button is live while anybody
else is down to exactly 2 cards, or has a window running on their last card, so
you press it on a read rather than on a cue. It is answered the instant it
arrives: the faster of the two presses wins and nothing waits for anybody. If
nobody owed the call — or that seat's own "LOCO!" got there first, or its hand
grew, or the window had just closed — the call misses and *you* draw **1 card**
for it. Once per offer, however many times you press.

**You cannot forget the call and still take the round** (§14.7). The play that
empties your hand is refused until the call has been made, whichever of the four
ways you empty it: a normal play, an interject, a counter, or a batch.

## 9. End of Round

First player to play their last card **wins the round**. The round ends immediately. If the last card is an action card, its effect is moot (no more turns).

## 10. Scoring

Remaining players sum the point values of cards still in hand:

| Card | Points |
|------|--------|
| Number cards 1–9 | Face value |
| Change Direction | 10 |
| Miss a Turn | 20 |
| Take 2 | 30 |
| Swap Cards with Another Player | 30 |
| Change Cards All Round | 40 |
| Choose a Colour | 40 |
| Take 4 + Choose a Colour | 50 |

**Scoring mode** (configurable, default = English edition): round winner accumulates all losers' points. First to **600 points** wins the game. Alternative: penalty mode (losers accumulate; first past 300 or 500 triggers game end; fewest points wins).

**LOCO does neither** (see §14.3): the match is taken by **rounds won**, and the score is the measure of the gap rather than the thing being raced to. It is still accumulated per round exactly as above, it is still what breaks a tie on rounds won, and it is still what picks the seat that opens the next round.

## 11. Edge Cases

1. **Swap with 1 card in hand**: Legal. Everyone left holding exactly 1 card once
   the hands have moved must call "LOCO!", because *receiving* your last card
   counts like playing down to it. A Swap can put two players on the hook at the
   same instant (the actor, who took the opponent's single card, and the
   opponent, who took the actor's leftover) and each is catchable on their own
   5 s window.
2. **Change Cards All Round with 1 card**: Legal. That player passes 1 card and receives neighbor's full hand. As with Swap, every seat holding a single card after the rotation owes the table a call, including one that declared a moment earlier, since the card it declared for is not the card it now holds.
3. **2-player specifics**: Change Direction = Miss a Turn (same player goes again). Change Cards All Round = mutual hand swap.
4. **Last card is an action card**: Round ends immediately; the action effect does not resolve.
5. **Interject during Take chain**: Chain continues from interjecter (see 6.5).

## 12. Implementation Checklist

- [ ] Deck: exactly 112 cards, correct distribution
- [ ] Setup: 8 cards per player, draw pile, discard pile from top card
- [ ] Starting action card: effect applied to first player
- [ ] Matching: color OR number OR symbol (at least one)
- [ ] Wild cards: playable on anything, player declares color
- [ ] Drawing: only when no valid play exists; exactly 1 card; may play immediately if valid
- [ ] Draw pile exhaustion: reshuffle discard pile (minus top card)
- [ ] Interjecting: exact identity check (color AND value, not OR)
- [ ] Interjecting: wild cards blocked
- [ ] Interjecting: currentPlayerIndex updated to interjecter, then advanced
- [ ] Interjecting: action effects fire on next player after interjecter
- [ ] Interjecting: LOCO! call enforced
- [ ] Interjecting: works correctly during Take 2/Take 4 chains
- [ ] Interjecting: simultaneous resolution by seat priority
- [ ] Miss a Turn: next player skips
- [ ] Change Direction: reverses play direction
- [ ] Take 2: draw 2, keep the turn (§14.5); stacking allowed (cumulative, same color only)
- [ ] Take 4 + Choose a Colour: draw 4 + declare color, victim keeps the turn (§14.5); stacking allowed; no cross-stacking with Take 2
- [ ] Choose a Colour: declares color for next player
- [ ] Swap Cards: full hand swap with chosen opponent
- [ ] Change Cards All Round: simultaneous hand rotation
- [ ] LOCO! call at 2→1 cards; penalty = draw 2 if forgotten
- [ ] A hand-emptying play is refused without the call (§14.7); a finishing batch carries it
- [ ] Contre-LOCO!: only inside the 5 s window; a missed call costs the caller 1 card
- [ ] Round ends on last card played
- [ ] Scoring: correct point values, configurable mode/threshold
- [ ] 2-player: Change Direction = Miss a Turn behavior

## 13. Swap / GlobalSwitch as Last Card

If the actor empties their hand by playing Swap or Change Cards All Round
(GlobalSwitch), the **round ends immediately** and the hand-rearranging
effect is **aborted** — the actor wins. Implementation must check for an
empty actor hand *before* performing the swap or rotation; otherwise the
actor receives the opponent's hand and the win is lost.

## 14. LOCO Deviations from Original SOLO Rules

LOCO is based on the SOLO card game but introduces the following intentional rule changes:

### 14.1 Change Cards All Round is a Wild Card
**SOLO rule**: "Change Cards All Round" is a colored card (one per color) and follows standard matching rules (must match by color or symbol).
**LOCO rule**: "Change Cards All Round" is a wild card (4 copies, no color). It can be played on any card at any time during your turn, like Choose a Colour.
**Rationale**: Simplifies gameplay. Avoids situations where the card is stuck in hand with no matching color.
**Colour choice**: like Choose a Colour and Take 4, it names the new active colour.
A wild that chose nothing would hand the table a rotation whose outcome nobody
picked, and the client must prompt for it before the card leaves the hand.

### 14.2 Starting Card is Always a Number
**SOLO rule**: The top card of the draw pile is flipped to start the discard pile, even if it's an action card. If it's an action card, its effect applies to the first player.
**LOCO rule**: Action and wild cards are skipped during setup. The starting discard card is always a number card.
**Rationale**: Avoids confusing edge cases on the very first turn (e.g., a Take 4 before anyone has played, or a Swap with no game context).

### 14.3 Best-of-N Format Instead of Point Threshold
**SOLO rule**: Points accumulate across rounds. The game ends when a player reaches 600 points (English edition). The player with the most points wins.
**LOCO rule**: The game uses a Best-of-N format (BO1, BO3, BO5, or BO7), and **the match is taken by rounds won, not by points**.

- **The match stops as soon as the lead cannot be caught.** A seat has taken it when its rounds won are strictly greater than every other seat's plus the rounds still to play (`remaining = max(0, Format - RoundNumber)`). So a BO3 ends at 2–0, a BO5 at 3–0 or 3–1, a BO7 at 4–0 through 4–3, and a BO1 always ends on its only round. Written as "strictly ahead of everyone" rather than "reached the majority" because the majority is only the right number at two seats: six players sharing a BO7 never reach 4, and the match still has to end.
- **Points measure the gap, they do not crown anybody.** They are computed, kept, shown and used as the first tiebreaker, and they are what a rating or a skill-based queue would later be built on.
- **Tiebreakers, in order**: most rounds won → highest total score → lowest lost-hand total → a sudden-death extra round.
- **The seat that opens the next round is still the one with the fewest points.** Rounds won is too coarse a signal there: only one seat per round wins one, so past two players half the table sits on zero.

**Rationale**: Better suited for online play — a predictable length and clear progress toward the finish. Deciding on points made "best of 5" a lie: a player could take three of the five rounds and lose the match to somebody who took one expensive one, with nothing on screen able to explain it.

### 14.4 Voluntary Draw is Allowed
**SOLO rule**: A player may only draw from the draw pile if they have no playable card in hand.
**LOCO rule**: A player may choose to draw one card from the draw pile even if they hold a playable card (still limited to one draw per turn).
**Rationale**: Adds strategic depth — players can sacrifice their turn to improve their hand. This also matches UNO official rules.

### 14.5 A Forced Draw Does Not Cost the Turn
**SOLO rule**: The victim of a Take 2 / Take 4 draws the penalty cards and their turn ends immediately.
**LOCO rule**: The victim takes the whole accumulated stack and then **keeps the turn**: they may play any legal card from the enlarged hand, or pass. The forced draw counts as the turn's single draw, so no second draw is possible. Drawing also **restarts the turn clock**, so the time spent deciding whether to counter is not taken out of the turn that follows the draw.
**Rationale**: Eating a +6 and then being skipped is two punishments for one card, and it reads as a bug to the player — the board sits on their seat, the hand jumps, and the turn is gone before they can act. Costing cards is punishment enough; being able to answer with the card you just drew is the part that makes a draw stack fun to watch. Stacking (§11) is still the way to avoid drawing at all.

### 14.6 A Missed Contre-LOCO! Costs a Card
**SOLO rule**: calling out a player who forgot to announce their last card has no
downside — an unfounded or late call is simply ignored.
**LOCO rule**: a Contre-LOCO! that does not land costs the caller **1 card**. It
lands only while the target's 5 s window is open and unanswered; it misses when
the target's own call arrives first, when the target's hand has grown, when the
window has expired — and when no seat owed the table a call at all.
The button does not wait for the server's permission: it is pressable while
**any other player is down to exactly 2 cards**, i.e. one ordinary play before
anybody is catchable, **or has a window running on their last card** — the 5 s
that card opened, and a short grace after it.
Pressing it is therefore a read of the table, and a wrong read is paid for like a
lost race. Past that grace, and past two cards, the button is dark:
nothing about that seat can be caught, so a press there is not a wager, and the
server answers it with nothing rather than with a card.
**A press is answered the instant it arrives.** Nothing is held back and nobody
is given a start: whoever gets there first wins, which is what makes this a
reaction and not a queue. Holding the button down is still one press, not a
hundred — the same misread is charged once however many times you make it, so
mashing buys nothing a single press did not.
**And it stays live long enough to be pressed too late.** A seat leaves the
button's reach without a card being played — it draws, it swallows a stack of
four, a Contre-LOCO! lands on it, its window simply runs out — and the button
stays live a moment longer: pressing there is a call that came too late, and it
costs the card that a call which came too early costs. Both halves of a wager
have to be losable, or it is not one.
**It stops one card short of that on purpose.** From three cards out only an
interject of two identical cards reaches the window, so arming the button there
would leave it live through a long stretch of the round where pressing it can
only miss — and a miss a player can schedule is a card drawn deliberately, which
a Swap or a Global Switch turns from a penalty into a hand handed to somebody
else. Missing a Contre-LOCO! is meant to be the thumb that had already committed
when the target drew instead of playing, not a move.
**One misread, one card.** The price is charged at most once per *offer* — the
picture of who is near the finish: the seat on two cards, or the seat on its last
card and the window it opened. The second, third and tenth press against the same
picture cost nothing, change nothing and are announced to nobody, and so does a
press after your own play, because your play changed nothing about that seat.
The near seat plays down to one, or its window runs out, or another seat comes
within two, and the button is a fresh wager again. Charged per card played, a
press before and a press after one's own play bought two cards a turn off one
opponent sitting on two — faster than the voluntary draw, and every card of it
was stocking a hand for a Swap to hand on.
**Rationale**: without a price, mashing the button at every seat holding one card
is free and therefore always correct, which turns a reaction into a reflex nobody
has to aim. One card is small enough that a genuine race stays worth entering and
large enough that a blind call is not. And a control that only unlocked once the
server had named a target could only ever be answered, never anticipated — which
is the opposite of a game decided on five-second windows. It is the same wager
seen from both sides of the table: the player who forgot risks 2 cards, the player
who calls too early risks 1. Bots pay it on the same terms as humans.

### 14.7 You Cannot Forget LOCO! and Win
**SOLO rule**: the announcement is enforced only by the other players catching
it. Survive the moment nobody noticed and the obligation evaporates — and a hand
of two identical cards played together never creates the moment at all, because
it goes from two cards to none without ever holding one.
**LOCO rule**: the play that empties your hand is **refused** unless the call has
been made. Two shapes, because they differ in who had the opportunity:
- **Down to one card already** — you have held that card since before this play,
  so you had the call to make and a whole window to make it in. Only a
  declaration that already happened counts. Forgetting is not fatal: the call can
  still be made, late, and the round taken immediately after. It costs the risk
  of being caught and one press, never the game.
- **Emptying two or more at once** — the hand never passed through a single card,
  so no window opened and no declaration was ever possible. The play carries the
  call itself, and the table hears "LOCO!" before it sees the round end.
**Rationale**: the announcement is the game's loudest moment and the table's only
warning that somebody is one card away. Enforced by the catch alone it was a 5 s
risk rather than an obligation, and the batch finish skipped even that — taking
the round out of turn, off a hand nobody saw drop to one, in total silence. A
game built to be watched cannot have its ending arrive unannounced.

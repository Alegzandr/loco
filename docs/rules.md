# LOCO Card Game — Rules Specification

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
- Exception: forced draws from Take 2 / Take 4 do not count as your "draw" action — you draw the penalty amount and lose your turn.

### 5.3 Draw Pile Exhaustion

When the draw pile is empty: take all cards from the discard pile **except the top card**, shuffle them, and place face-down as the new draw pile.

## 6. Interjecting (Discarding Out of Turn / "Zwischenwerfen")

This is a **core mechanic** of LOCO.

### 6.1 Conditions (ALL must be true)

1. It is **NOT** the player's turn.
2. The card is **exactly identical** to the top of the discard pile (see 6.2).
3. The card is **NOT** black/wild.

### 6.2 "Exactly Identical" = same color AND same value

Both attributes must match. **AND, not OR.**

- ✅ Red 5 on Red 5 — allowed
- ❌ Blue 5 on Red 5 — rejected (different color)
- ❌ Red 3 on Red 5 — rejected (different number)
- ✅ Blue "Miss a Turn" on Blue "Miss a Turn" — allowed
- ❌ Red "Miss a Turn" on Blue "Miss a Turn" — rejected (different color)
- ❌ Black wild on black wild — **always rejected** (wild cards cannot be interjected)

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

A player may interject with an identical Take 2 during an active chain. The chain continues from the interjecter's position with the accumulated total + 2 more. The next player after the interjecter must stack or draw the full amount.

### 6.6 LOCO! Call on Interject

The LOCO! rule (Section 8) applies to interjections. Going from 2 → 1 card via interject still requires calling "LOCO!" with the same penalty for forgetting.

### 6.7 Simultaneous Interjects

If multiple players could interject: resolve by **seat priority** — the eligible player closest to the current player in the current play direction wins. Alternatively, use a short reaction window then resolve ties by seat priority.

## 7. Action Cards — Effects

All colored action cards follow standard matching rules (Section 5.1). Black cards can be played on anything.

**Miss a Turn** — Next player in play order skips entirely (no play, no draw).

**Change Direction** — Play direction reverses (clockwise ↔ counter-clockwise). Next player is determined by the new direction. In a 2-player game: acts like Miss a Turn (same player goes again).

**Take 2** — Next player draws 2 cards and loses their turn. **Stacking**: the next player may play **any** Take 2 card (regardless of color) instead of drawing; penalty accumulates (+2 each). Continues until someone cannot or does not stack → that player draws the full total.

**Choose a Colour** — Player declares a color (R/G/B/Y). Next player must match that color (or play a wild, or draw).

**Take 4 + Choose a Colour** — Player declares a color AND next player draws 4 and loses their turn. **Stacking**: next player may play another Take 4 + Choose a Colour to pass on the penalty (+4 each). **No cross-stacking**: Take 2 and Take 4 stack only with their own kind.

**Swap Cards with Another Player** — Player chooses any opponent; they swap entire hands immediately.

**Change Cards All Round** — All players simultaneously pass their entire hand to their neighbor in the current play direction. In a 2-player game: equivalent to a swap.

## 8. LOCO! Call

When playing your **second-to-last card** (going from 2 → 1 card in hand), you **must** call "LOCO!" before or at the moment of discarding. Penalty for forgetting: draw **2 cards**. This applies on normal turns AND on interjections.

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

## 11. Edge Cases

1. **Swap with 1 card in hand**: Legal. The player who receives 1 card does NOT need to call "LOCO!" — only the player who *plays* a card to reach 1 must call.
2. **Change Cards All Round with 1 card**: Legal. That player passes 1 card and receives neighbor's full hand.
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
- [ ] Take 2: draw 2 + lose turn; stacking allowed (cumulative)
- [ ] Take 4 + Choose a Colour: draw 4 + lose turn + declare color; stacking allowed; no cross-stacking with Take 2
- [ ] Choose a Colour: declares color for next player
- [ ] Swap Cards: full hand swap with chosen opponent
- [ ] Change Cards All Round: simultaneous hand rotation
- [ ] LOCO! call at 2→1 cards; penalty = draw 2 if forgotten
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

### 14.2 Starting Card is Always a Number
**SOLO rule**: The top card of the draw pile is flipped to start the discard pile, even if it's an action card. If it's an action card, its effect applies to the first player.
**LOCO rule**: Action and wild cards are skipped during setup. The starting discard card is always a number card.
**Rationale**: Avoids confusing edge cases on the very first turn (e.g., a Take 4 before anyone has played, or a Swap with no game context).

### 14.3 Best-of-N Format Instead of Point Threshold
**SOLO rule**: Points accumulate across rounds. The game ends when a player reaches 600 points (English edition). The player with the most points wins.
**LOCO rule**: The game uses a Best-of-N format (BO1, BO3, BO5, or BO7). The first player to win the majority of rounds wins the game.
**Rationale**: Better suited for online play — provides a predictable game length and clear progress toward the finish.

### 14.4 Voluntary Draw is Allowed
**SOLO rule**: A player may only draw from the draw pile if they have no playable card in hand.
**LOCO rule**: A player may choose to draw one card from the draw pile even if they hold a playable card (still limited to one draw per turn).
**Rationale**: Adds strategic depth — players can sacrifice their turn to improve their hand. This also matches UNO official rules.

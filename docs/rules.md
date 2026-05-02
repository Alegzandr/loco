# LOCO Card Game — Complete Rules Specification

> **Purpose**: This document is a full, unambiguous specification of the LOCO card game rules (based on the SOLO card game by AMIGO Spiel + Freizeit GmbH). Use it to implement and verify every rule in the codebase.

---

## 1. Overview

LOCO is a card-shedding game (similar to UNO / Crazy Eights). The goal is to be the **first player to discard all cards**. The game supports **2–10 players**, ages 6+.

---

## 2. Deck Composition (112 cards total)

### 2.1 Number Cards (72 cards)
- **4 colors**: Red, Green, Blue, Yellow
- **Values 1–9**, two copies of each per color
- Total: 4 colors × 9 values × 2 copies = **72 cards**

### 2.2 Action Cards — Colored (24 cards)
Each of the following exists in **all 4 colors, 2 copies per color** (= 8 cards each):

| Card                  | Count | Colors          |
|-----------------------|-------|-----------------|
| **Miss a Turn**       | 8     | R, G, B, Y × 2 |
| **Change Direction**  | 8     | R, G, B, Y × 2 |
| **Take 2**            | 8     | R, G, B, Y × 2 |

### 2.3 Action Cards — Colored, Single Copy (8 cards)
Each of the following exists in **all 4 colors, 1 copy per color** (= 4 cards each):

| Card                                  | Count |
|---------------------------------------|-------|
| **Swap Cards with Another Player**    | 4     |
| **Change Cards All Round**            | 4     |

### 2.4 Action Cards — Black / Wild (8 cards)
These have **no color** (black). They can be played on **any** card.

| Card                         | Count |
|------------------------------|-------|
| **Choose a Colour**          | 4     |
| **Take 4 + Choose a Colour** | 4     |

**Total**: 72 + 8 + 8 + 8 + 4 + 4 + 4 + 4 = **112 cards**

---

## 3. Setup

1. Choose a dealer. The dealer shuffles and deals **8 cards** to each player.
2. Place the remaining cards **face-down** in the center as the **draw pile** (stock).
3. Flip the **top card** of the draw pile face-up next to it — this becomes the first card of the **discard pile**.
4. Players pick up their hand and sort by color or value.

### 3.1 Edge Case — Starting Card
> If the first flipped card is an action card, the rules do not explicitly address this. **Recommended implementation**: treat it as if the dealer played it, and apply its effect to the first player (player left of dealer). If it's a black wild card, the dealer chooses a color before play begins.

---

## 4. Turn Order

- The player to the **left of the dealer** goes first.
- Play proceeds **clockwise** (unless reversed by a Change Direction card).
- On your turn, you **must** do one of the following:
  1. **Discard** a valid card onto the discard pile, OR
  2. **Draw** one card from the draw pile.

---

## 5. Discarding Rules

### 5.1 Valid Discard (matching)
A card is **valid to play** if it matches the top card of the discard pile by **at least one** of:
- **Same color**
- **Same number** (for number cards)
- **Same action symbol** (for action cards, e.g., a red "Take 2" can be played on any red card, OR on a "Take 2" of any color)

### 5.2 Black (Wild) Cards
- **Choose a Colour** and **Take 4 + Choose a Colour** are black and can be played on **any** card, regardless of color or value.
- After playing a black card, the player **declares a color**. The next player must play a card of that declared color (or another valid play).

### 5.3 Drawing
- If the player **cannot** (or chooses not to) play a card, they must **draw exactly 1 card** from the draw pile.
- If the drawn card is a valid play, the player **may play it immediately** (but is not forced to).
- If the drawn card cannot be played (or the player chooses not to play it), their turn ends.
- A player draws **at most 1 card** per turn (unless forced by Take 2 / Take 4).

---

## 6. Discarding Out of Turn ("Zwischenwerfen" / Interjecting)

This is a **core mechanic** unique to SOLO:

- If a player holds a card that is **exactly identical** to the top card of the discard pile (same color **AND** same value/symbol), they may **immediately play it out of turn**.
- This applies **at any time**, even when it is not the player's turn.
- After the interjection, **the next player in the current play direction after the interjecter** takes the next turn (not the player who was originally next).

### 6.1 Interjecting with Action Cards
- When an action card is interjected, its effect **still applies** to the next player after the interjecter.
- Example: If someone interjects a blue "Miss a Turn", the player sitting next to the interjecter (in play direction) must miss their turn.

### 6.2 "Exactly Identical" Definition
- For **number cards**: same color AND same number (e.g., Red 5 on Red 5).
- For **colored action cards**: same color AND same symbol (e.g., Blue "Miss a Turn" on Blue "Miss a Turn").
- **Black cards cannot be interjected** (they have no color match requirement, and duplicates are not "identical" in the same sense since the active card has a declared color).

---

## 7. Action Cards — Detailed Effects

### 7.1 Miss a Turn (colored, matches by color)
- **Matching rule**: can be played if the top card shares the **same color** (or same symbol).
- **Effect**: the next player in play order **skips their turn entirely** — they cannot play a card and cannot draw. Play passes to the player after them.

### 7.2 Change Direction (colored, matches by color)
- **Matching rule**: can be played if the top card shares the **same color** (or same symbol).
- **Effect**: the **direction of play reverses**.
  - Clockwise → Counter-clockwise
  - Counter-clockwise → Clockwise
- The next player to play is the one in the **new direction** from the player who played the card.
- **In a 2-player game**: this effectively acts like a "Miss a Turn" (the same player goes again).

### 7.3 Take 2 (colored, matches by color)
- **Matching rule**: can be played if the top card shares the **same color** (or same symbol).
- **Effect**: the next player must **draw 2 cards** from the draw pile and **lose their turn**.
- **Stacking rule**: if the next player also holds a "Take 2" card, they may play it instead of drawing. The penalty then **accumulates** (+2 more = 4 total) and passes to the following player. This continues until a player cannot (or chooses not to) stack — that player draws **all accumulated cards**.

### 7.4 Choose a Colour (black/wild)
- **Matching rule**: can be played on **any** card at any time during your turn.
- **Effect**: the player **declares a color** (Red, Green, Blue, or Yellow). The next player must play a card of that color (or play another wild card, or draw).

### 7.5 Take 4 + Choose a Colour (black/wild)
- **Matching rule**: can be played on **any** card at any time during your turn.
- **Effect** (two effects combined):
  1. The player **declares a color**.
  2. The next player must **draw 4 cards** and **loses their turn**.
- **Stacking rule**: the next player may play another "Take 4 + Choose a Colour" to pass the penalty on (4 more = 8 total), and so on.

> **Cross-stacking**: The rules do not explicitly state whether "Take 2" and "Take 4" can be stacked on each other. **Recommended implementation**: they stack separately — a "Take 2" can only be stacked with another "Take 2", and a "Take 4" can only be stacked with another "Take 4".

### 7.6 Swap Cards with Another Player (colored)
- **Matching rule**: can be played if the top card shares the **same color** (or same symbol).
- **Effect**: the player who plays this card **chooses any one other player** and they **swap entire hands**. The chosen player gives all their cards to the player, and the player gives all their remaining cards to the chosen player.
- This swap happens **immediately** after the card is played.

### 7.7 Change Cards All Round (colored)
- **Matching rule**: can be played if the top card shares the **same color** (or same symbol).
- **Effect**: **every player simultaneously passes their entire hand** to their neighbor in the current direction of play.
  - If play direction is clockwise, each player gives their hand to the player on their left.
  - If play direction is counter-clockwise, each player gives their hand to the player on their right.
- This happens **simultaneously** (no player acts on new cards before everyone has passed).

---

## 8. LOCO! Call Rule

- When a player is about to play their **second-to-last card** (going from 2 cards to 1 card in hand), they **must** announce **"LOCO!"** clearly.
- This warns all other players that the player has only one card left.
- **Penalty for forgetting**: if a player fails to say "LOCO!" before/when playing their penultimate card, they must **draw 2 cards** from the draw pile as a penalty.
- **Timing**: the call must happen **before or at the moment of discarding** the penultimate card. Other players may challenge if the call was missed.

---

## 9. Winning a Round

- The first player to **play their last card** wins the round.
- The round ends immediately.
- **Important**: the last card played still takes effect if it is an action card (though the round ends, so its effect may be moot except for scoring).

---

## 10. Scoring

After a round ends, **all other players** count the point values of the cards remaining in their hand:

| Card                              | Point Value       |
|-----------------------------------|-------------------|
| Number cards (1–9)                | Face value (1–9)  |
| Change Direction                  | 10 points         |
| Miss a Turn                       | 20 points         |
| Take 2                            | 30 points         |
| Swap Cards with Another Player    | 30 points         |
| Change Cards All Round            | 40 points         |
| Choose a Colour                   | 40 points         |
| Take 4 + Choose a Colour          | 50 points         |

### 10.1 Scoring Variants (by language edition)

The rules differ slightly between editions on how to use the score:

- **German edition**: Points are recorded as **penalty points** (Minuspunkte) for each losing player. The game ends when any player exceeds **500 penalty points**. The player with the **fewest penalty points** wins.
- **English edition**: Points from all losers are credited **to the round winner**. The first player to reach **600 points** wins the overall game.
- **French/Italian edition**: Points are recorded as **penalty points**. The game ends when any player exceeds **300 penalty points**. The player with the **fewest penalty points** wins.
- **Dutch edition**: Same as English — points go to the winner, first to **600 points** wins.

> **Recommended implementation**: make the scoring mode and point threshold configurable. Default to the English edition (winner accumulates points, target = 600).

---

## 11. Draw Pile Exhaustion

When the draw pile runs out:
1. Take all cards from the discard pile **except the top card**.
2. Shuffle them.
3. Place them face-down as the new draw pile.
4. The top card of the discard pile remains in place.

---

## 12. Implementation Checklist

Use this checklist to verify every rule is correctly implemented:

### Deck & Setup
- [ ] Deck contains exactly 112 cards with the correct distribution
- [ ] Each player receives 8 cards at the start
- [ ] Top card of draw pile is flipped to start the discard pile
- [ ] First player is to the left of the dealer; play starts clockwise

### Core Turn Mechanics
- [ ] A player can play a card matching by color, number, or action symbol
- [ ] Black (wild) cards can be played on any card
- [ ] If no valid play, player draws exactly 1 card
- [ ] Drawn card can be played immediately if valid
- [ ] Turn ends after playing or drawing (if drawn card isn't played)

### Discarding Out of Turn (Interjecting)
- [ ] A player holding an exactly identical card (same color + same value/symbol) can play it immediately, even out of turn
- [ ] After interjecting, the next player in play direction after the interjecter takes the turn
- [ ] Interjected action cards still trigger their effects on the next player

### Action Card Effects
- [ ] **Miss a Turn**: next player skips entirely (no play, no draw)
- [ ] **Change Direction**: play direction reverses immediately
- [ ] **Take 2**: next player draws 2 and loses turn; stacking with additional "Take 2" cards is allowed (cumulative)
- [ ] **Choose a Colour**: player declares a color; next must match that color
- [ ] **Take 4 + Choose a Colour**: player declares a color; next draws 4 and loses turn; stacking allowed
- [ ] **Swap Cards with Another Player**: player swaps entire hand with a chosen opponent
- [ ] **Change Cards All Round**: all players pass entire hand to neighbor in play direction (simultaneously)

### LOCO! Call
- [ ] Player must call "LOCO!" when playing their second-to-last card (going to 1 card in hand)
- [ ] Failure to call = penalty of drawing 2 cards

### End of Round
- [ ] Round ends when a player plays their last card
- [ ] Remaining players' hands are scored according to the point table

### End of Game
- [ ] Game ends when score threshold is reached (configurable; default 600)
- [ ] Overall winner is determined by the configured scoring mode

### Draw Pile Exhaustion
- [ ] When draw pile is empty, reshuffle the discard pile (minus top card) to form a new draw pile

---

## 13. Edge Cases & Clarifications

1. **Starting with an action card face-up**: Apply its effect to the first player as if the dealer played it. For wild cards, dealer picks a color.
2. **Interjecting during a Take 2/Take 4 chain**: If a "Take 2" chain is active and a player interjects with an identical "Take 2", the chain continues from the interjecter. The next player after the interjecter must either stack or draw the accumulated total.
3. **Swap when a player has 1 card**: Legal. If the swapper has 1 card and swaps with someone who has 8, the swapper now has 8 and vice versa. The player who now has 1 card does NOT need to say "LOCO!" (only the player who *plays* a card to get to 1 must call it).
4. **Change Cards All Round when a player has 1 card**: Legal. That player passes their 1 card and receives their neighbor's hand.
5. **Playing last card as an action card**: The round ends, so the action effect is mostly irrelevant (no more turns), but score the remaining hands normally.
6. **2-player game specifics**: "Change Direction" acts like "Miss a Turn" (same player goes again). "Miss a Turn" also means the same player goes again. "Change Cards All Round" swaps both players' hands.
7. **Multiple interjects in rapid succession**: If two players could both interject, the first one to act takes priority. In a digital implementation, this requires a timing/priority system (e.g., clockwise priority from the last active player, or a short reaction window).
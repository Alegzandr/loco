# Rendering, layout and art direction

The art direction, the board's geometry, the cards, and the streamable moments.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

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
  `@fontsource-variable/*` and imported in `layouts/Base.astro`, not from the game's entry: the
  content pages mount no application at all and still have to be typeset. No CDN — the CSP stays closed.
- Press feedback (hover lifts, active travels *into* the ledge) is written per component. `tokens.css`
  used to carry a `.btn-chunky` for it, plus a family of `.t-*` type classes, both described as what
  every control extended; **nothing had ever imported either**, and both were deleted. Do not
  reintroduce a shared control class without a caller.
- Scrollbars: styled globally in `tokens.css` (`scrollbar-width`/`scrollbar-color` for Firefox, the
  `::-webkit-scrollbar*` pseudo-elements elsewhere). Thin, no track, thumb in `--color-border-strong`
  with a transparent border plus `background-clip: padding-box` so it never touches the panel edge.
  A default OS scrollbar is the only widget in the UI the browser draws, and it is grey chrome
  sitting on a candy panel in every stream capture. A panel that scrolls needs no scrollbar CSS of
  its own; do not re-declare it per component.
- Card faces: see "Card face" below. The deck has its own identity — full-bleed suit gradients and
  the LOCO mark — and it is the one part of the UI that does **not** follow the app's chunky-sticker
  language. A card is an object, not a control.
- `--ease-bounce` for anything that should feel physical; `--ease-out` for travel.
- **Reduced motion is applied by `initMotion()` in `entry.ts`, before first render**: every
  reduced-motion rule in the CSS hangs off `:root[data-motion="reduce"]` instead of a media query,
  so the attribute has to be on `<html>` before the first paint. See `docs/notes/client.md`.

#### Four families, and what each one means
LOCO Red acts, sunny yellow marks a win, electric indigo orients, signal mint confirms. That
separation *is* the palette — it is worth more than any individual hex, and the way it gets undone is
one colour at a time on grounds that have nothing to do with it. The two secondaries were once moved
to orchid and teal because the originals sat near a CSS framework's defaults: true, thin, and it cost
the palette its logic, because the new pair no longer said *win* and *orient* to anybody who had
played a round. **Judge a proposed colour on what it does to the other three, not on its
provenance**, and if it has to move, move it inside its own family.

Two things constrain `--color-tertiary` and both are measured rather than eyeballed: the focus ring
wears it and has to clear **3:1 on the dark card** (WCAG 1.4.11, currently 3.42), and `--color-link`
is the same hue pushed until it clears AA on each canvas separately. A colour written out by hand at
a call site is the bug — `ScoreTable`'s ping tiers held the mint as a literal, a copy nothing keeps
in step — and `playerColors.ts` moves with the token or a seat and the interface disagree about one
colour.

#### One palette
There used to be two — a candy-sky "day" and the indigo "night" — behind `[data-theme]` on `<html>`,
with the dark block duplicated under `@media (prefers-color-scheme: dark)` so the first frame of a
content page was right, a 260ms colour fade armed by `setTheme`, a switch in the preferences panel
and another in the content pages' bar. All of it went in one change, on a product decision: the
game is played in rendered rooms over a near-black table and is built to be captured, and a pale
canvas around that read as a website with a game embedded in it. What the second palette cost was
not only its code: every contrast in the product was measured twice, the wordmark needed two
outline rules, the content pages flashed white between navigations until the media query was
duplicated, and `make visual` shot everything twice.

So `tokens.css` declares the night palette on `:root`, once, with `color-scheme: dark` so the
browser's own widgets follow; the wordmark's outline is one `::before`; the content pages paint
the game's own canvas. `noLightTheme.test.ts` fails on `data-theme`, `prefers-color-scheme`,
`loco_theme` or `theme-boot` anywhere in the client, the E2E suite or the tools, and on a second
`--color-canvas` in the tokens. The card faces and the rooms are untouched by any of this: they never
followed a theme, and the reasoning that they are objects and places rather than surfaces is what
the interface has now been brought in line with.

### Colour assist (the suit silhouettes)
`SUIT_SHAPE` in `cardTheme.ts`, drawn by `SuitMark.svelte`, off by default and switched on from the
preferences panel. Triangle red, circle yellow, square green, diamond blue, sized at 15cqh under the
top-left value, plus the picker swatches and the active-colour chip.

- The card face is the brand and this writes on it, which is why it is a preference rather than the
  default. It is also the only accessibility setting in the game that decides whether somebody can
  play at all: legality is a colour match.
- Reviewed at **hand size**, not at hero size. At 72px wide the mark is ~13px and the square and the
  diamond start to converge, which is why 12cqh was raised to 15. Scene `card-sheet-assist`.
- Same two-pass ink as every other glyph: off-white alone is 1.18:1 on the green suit.

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
- **A phone on its side** (`isLandscape`: wider than tall and under `LANDSCAPE_MAX_H` = 560px tall):
  the phone reference turned, `clamp(min(w/830, h/405), MIN_BOARD_SCALE, 1)`. But the scale is the
  smaller half of the answer there — see "A phone on its side" under Mobile: the composition changes,
  and the mode is decided **from pixels, once**, because a short window at 0.78 is taller in virtual
  units than a desktop window at 1 and the virtual space cannot tell them apart.

`boardSpace(pxW, pxH, s, insets)` — **not** plain `px / s` — converts pixels to the virtual space. The board is
bracketed by two bands of **real chrome that do not scale with it**: `TOP_CHROME` (round badge,
theme/audio/rules cluster) and `BOTTOM_RESERVE` (the action bar, **plus the LOCO! chip's band above
it** — see "Action bar"). Both must stay constant in *pixels*.
Scaling them along with the board shrinks them on a phone — seat pills slide under the top buttons,
the hand under the action bar — and inflates them on a monitor into two bands nothing may use.
`offsetY = safeTop + TOP_CHROME * (1 - s)` pins the top band, and the height is solved so the bottom
one lands exactly on the action bar. The device's safe areas are part of that same arithmetic: the
element runs edge to edge so the room's picture can, and the coordinate space stops short of the
notch and the home indicator (see "Safe areas"). Asserted in `layout.test.ts`.

- `GameBoard` passes only the virtual size down. Children, `layout.ts` and every animation coordinate
  stay in that one space — nothing else knows about the scale, which is why cards, seats, felt, type
  and fliers all grow together.
- This is the fix for both "1440p shows the same small table surrounded by background" and "the cards
  are too big on a small phone". Do **not** solve that class of problem by bumping `CARD_W` /
  `SEAT_DIMS` — those are design-space constants.
- Deck and discard derive their centre from `tableRect` (`pileTop`), so the pair sits in the middle
  of the felt. Both take `topReserve` and `<GameBoard />` passes `seats.blockHeight` to the piles,
  the fliers and `tableRect` from one variable — mismatched reserves drift the fliers off the pile.
- **The pair sits close in around the middle** (`PILE_GAP`, 32): at 58 each pile stood off to one side
  and the middle of the felt was left empty. The floor is the colour chip, which reaches
  `PILE_CHIP_REACH` out of the discard towards the deck and must still clear it (`layout.test.ts`).
- **The piles lie on the felt, they do not stand facing us** (`layout.ts: pileTransform`, `onPile`,
  `PILE_SQUASH`). Each is tipped back `PILE_TILT_DEG` (32°, a hair less flat than the hands on the felt around it, never flatter) about its own card's centre and seen
  from `PILE_PERSPECTIVE` (600px), so its far edge is narrower than its near one, and its thickness
  is a band of card edges under the top card (layers offset straight down in the pile's own plane,
  which the tilt turns into the block's near side). What lies on the felt is laid with it — the
  deck's layers and glow, the discard's pool, ring and edges — on a node of its own (`.laid`), since
  the deck's own transform is the hover lift's. **The active-colour chip and the +N badge stay
  upright**: they are tokens read across the room, pinned to where `onPile` sees the card's
  corners. Every flier that lands on a pile, or leaves the deck, does so at `PILE_SQUASH`, the laid
  card's seen height over its real one. `onPile` is the CSS written as numbers, and
  `layout.test.ts` checks it against the spec's matrices: if the two disagree the chip floats off
  the card and a landing jumps.

## Seat layout (`layout.ts: seatLayout`)
One function owns opponent seating because three callers must agree exactly: `<GameBoard />`
(draws the seats), the fliers (`handSpots`, which land cards in them) and `tableRect` (must not
slide the felt under the seats). When they disagreed, trails flew to empty space.

### An opponent is a hand, face down, at a place on the table
A seat used to be a pill with a thumbnail fan of 17px backs in it: it said "few or many" and
nothing a spectator could follow, and a card drawn or played happened to the pill's centre. A seat is
now **the hand itself**, the real number of backs, and wherever the table can seat everybody
**it lies on the felt at that player's place on the rim**, tips towards the middle — put down, the
way a hand is left on a table — with their name plate on the table's edge where they sit.

How it got here, because every step was a real reading of the screen:
1. **Seen from above, tips at the felt** (turned by π), in rows above the table: every seat across
   read as a hand held upside down.
2. **Held up, facing us**, and the ones beside the felt leant in, then turned in 3D: right for the
   player across, wrong beside — a column of cards, then a stack sliding off the seat — and the
   whole composition changed shape with the number of players ("selon le nombre de joueurs ça fait
   bizarre").
3. **Laid on the felt, round the rim.** Tips at the middle is right after all once the cards are
   *on the table* (the player put them down), and a place on the rim is the same arithmetic for one
   opponent and for nine. Card games that seat many players do the same (the reference was a duel
   game's shared board, avatars at the edge, cards on the table in front of them).

- **One geometry, drawn and flown to** (`seatFan` under a `FanLay`, `seatBox`, `handSpots`).
  `<PlayerSlot />` draws each back at the seat's anchor plus `seatFan`; the board flies every card to
  `handSpots`, the same function in board coordinates. `seatLayout.test.ts` pins that the two agree,
  squash included: a draw that lands beside the hand it went into is the failure this replaces.
- **A `FanLay` is how a hand lies**: its tilt in the plane (`rotation`), the table's perspective
  (`squash`, a vertical flattening in screen space applied after the tilt — CSS
  `scale(1, k) rotate(r)`, and the fliers' keyframes do the same, so a card in the air is square to
  us and takes the felt's perspective as it comes down), and how wide it may spread (`span`). A hand
  held up is `facingUs(size)`.
- **The tips point at the centre of the table as it is, not as it is drawn**: the tilt is judged
  before the flattening (`atan2(dx, −dy / squash)`), so once flattened the hand still points at the
  middle. `squash` is the felt's own proportion, never under `MIN_SQUASH` (0.82) — flatter read as a
  smear.
- **Three sizes** (`cardTheme.ts: SEAT_SPECS`): `full` (backs 44×66, desktop — at 34×51 a hand read
  as a thumbnail), `compact` (32×48, never under 26px, `CardBack`'s `ART_MIN_W`, below which a back is
  painted flat), `mini` (the plate alone: a crowded phone, in rows). A fan draws at most `maxVisible`
  backs and never spreads wider than its lay's `span`; the count on the plate carries the rest. **The
  count is a size up from the name** (30px, 16px type; 24px and 13px on the smaller seats): it is the
  number a spectator follows the race by. **`SEAT_DIMS` is `seatBox` of a hand held up, rounded
  up**, and `seatLayout.test.ts` fails when the two part.
- **A card on its way is not yet in the hand** (`PlayerSlot`'s `FanHold`). The board launches the
  fliers and, in the same breath, tells the seat which backs to keep hidden and until when; the back
  is held by an opacity animation filled backwards, keyed on the hold's stamp so an unrelated
  re-render never hides a card that already landed.
- **Whose turn it is: the place lights up on the felt** (`.placeGlow`, a gold pool laid and flattened
  like the hand, breathing on its opacity), and the marker rides the plate. A hand held up in a row
  breathes instead (`scale`, 2.5% over 2.6s — at 7% every 1.6s it pulsed louder than the moments
  allowed to shout) and wears the marker over its top. The fan's `translate` is the knock of a
  Contre-LOCO! landing in it; each back's `transform` is its place (a transition, so the fan
  re-spreads); the last card's red burn is on an inner layer. Reduced motion stops the breath and the
  glow's pulse and holds the burn at full.

### Our own hand is the biggest thing on the board
`HAND_SCALE` (1.1) scales our hand's cards over the pile's: it is the one hand we read, aim at and
press all match. A scale on the slot, never a bigger `CARD_W`, which is the pile's, the deck's and
every flier's. **Everything that reserves room for the hand measures it with `handCard()`**
(`calcHandSlots`, `turnPillPlace` — the hover lift is drawn inside the scale and grows with it —
`seatPosition`, `handSpots`), and `Hand` offsets each slot by half the growth so
the scaled card lands on the box it was given. **Not on a phone on its side** (`handScale(true)` is
1): that screen is ~340px tall and a bigger hand pushed the turn pill into it.

### Where the seats go
- **A place on the rim** (`rimLayout`), tried first at `full` (≥ 720 wide) then `compact`. The places
  go over the top of the table from our left to our right — the next player first, since play runs
  clockwise on screen from our seat at the bottom — **spaced evenly along the rim, never by angle**
  (on a flat oval evenly spaced angles bunch at the ends). One opponent sits across, two at the
  shoulders. **The first place is where it would be if everybody at the table, us included, sat the
  same distance apart** (`firstRimAngle` from `evenFirstAngle`: the whole rim split in n + 1 from our
  place at the bottom), the last its mirror, and the rest evenly between. The arc used to stop where
  a hand would reach the piles *vertically*, which on a wide felt kept six opponents bunched over the
  top with an empty stretch of rim either side of us. Now it comes down towards our end as far as the
  place's whole box (plate and fullest fan) stays clear of the piles and the arrows round them, the
  turn pill, the screen's edges and **the line of our hand with a playable card standing up at rest**
  — our hand can run the whole width, so that line holds at every x. A card under the pointer rises
  over it; that is a moment, not a place. Where nothing below the old arc is clear, the old `reach`
  rule is the fallback, so a round phone felt still keeps its places on the upper arc. The plate sits on the table's edge, mostly outside the felt, clamped to the screen;
  the hand lies `inset` in from the rim, far enough that the plate never sits on it. **A hand spreads
  no wider than 55% of the gap to its neighbour**, which is what keeps two neighbours' cards from
  touching — `seatLayout.test.ts` checks it card against card as drawn (separating axes), because a
  tilted hand's bounding box is mostly air. Tried at a size, **abandoned when two plates would
  touch**: then the next size, then the rows.
- **Rows above the felt** (`rowLayout`): a crowded phone (six opponents and up on a 405-wide
  screen). `compact` wrapping onto up to `MAX_FAN_ROWS` (3) rows of hands held up while the felt keeps
  `MIN_FELT_BAND` (300) for the piles, then `mini`. X spread **linearly**, not by `cos(angle)`, and
  non-mini seats keep `SEAT_EDGE` (28px) clear of the screen edges.
- **A column down the left** in landscape (`seatColumn`, below).

- **The felt is where everybody sits, so it is big** (`tableRect`): 78% of the width (capped 1100,
  never more than 94% — a share, not a margin in board units, or a notch that scales the board down
  would make it *bigger*), and the whole band under the top reserve (capped 560), running on behind
  our own hand like the near edge of a real table. It took 62%/400, then 74%/440 of the band, and the
  places round its rim did not fit; 86%/1200/620 then read as too big, table and hand alike
  (2026-09-25). **The top reserve on the rim is only the plate across the top**
  (`TOP_CHROME + plateH / 2 + 4`); rows report their whole block, as before.
- **But it never starts above `FELT_TOP_MIN`** (24.5% of the board's height, on a board 560 wide or
  more), and it gives that height up from its top, never its near edge. With the seats on the rim
  nothing else held it down: it climbed to 11% of a 16:9 monitor, the horizon cannot stand below
  the felt's top edge (`scene/view.ts`), so the camera fell back to `horizonMin` and the room lost
  its sky and every sun and moon — which only CI's `sceneView` / `sceneVista` noticed (2026-09-26).
  The number is what leaves `LOOK.vista.camera.horizon` reachable inside the lens range;
  `sceneView.test.ts` pins it on five monitor sizes and every size of table. A phone upright is
  exempt: its narrow lens already leaves the horizon room.
- Seats clear `TOP_CHROME` (58px) so they never sit under the round badge / theme / audio / rules
  cluster.

### What moves between the hands
Every card the table moves is seen moving, from the place it leaves to the place it lands.

- **The deal goes round the table** (`GameBoard`'s deal effect, `dealStagger`): one card to each seat
  in turn, the next player first and us last, round after round, never longer than
  `DEAL_TABLE_MAX_MS` whatever the table's size. Our `Hand` reveals its cards on the same pace
  (`dealStep` / `dealOffset`), the others' fans hold theirs.
- **A draw flies into the last places of the fan** (`store.lastDraw`, set by `applyCardDrawn` for
  any seat). Ours turn over on the way (`Flier.flip`). Cards a Contre-LOCO! charged are marked
  `penalty` — `uno_caught` arrives first, so the store knows — and fly higher and slower, and the hand
  takes the knock; the `+N` callout is the catch effect's, over the plate.
- **A card played leaves the middle of the hand**, face down at the fan's size, and turns over on the
  way to the pile.
- **A hand passed crosses the table as a packet**, card for card from the place it held in the
  giver's hand to its place in the receiver's, at most `PASS_CARDS_MAX` (12) seen per hand, 22ms
  apart. Every path **bows sideways** (`Flier.curve`, perpendicular to the path) and both hands of a
  Swap bow to their own right, so they pass on opposite sides: `arcHeight` only lifts a card, which on
  a path running up or down the screen is a change of speed and not a curve, and the first version's
  two hands flew down one line through each other. A GlobalSwitch bows every hand the same way round,
  so the ring is seen turning. Between two other seats a hand travels face down. **Our own cards are
  face up in our hand and nowhere else**: ours going out turn face down on the way (a back flier
  carrying a `card`, with `flip`), and the cards coming to us turn face up on the way and land face
  up. Landing as backs and turning into faces once down read as the hand being dealt a second time.
  Their faces are the snapshot's, a message behind the play: the flight waits for it
  (`launchIncoming`, keyed on `myHand` changing from `givenHand`) and flies backs if it has not come
  in `INCOMING_WAIT_MS`. The deal lands our cards face up the same way.
- **Every hand that receives is held empty until its cards land — ours included, and card by card**
  (`Hand`'s `hold`, the same `FanHold` an opponent's fan takes). The server names our new hand in the
  snapshot right behind the play, so it was drawn in full while its cards were still in the air.
  **Each card comes up under its own flier, over the flight's last 90ms**: one deadline for the whole
  hand held every card until the *last* flier landed, so the first ones blinked out as their fliers
  retired and the hand popped back a beat later, which read as the hand loading. **The counts are the roster's, never `myHand`**, and
  **the hand we give away rides the notice** (`SwapNotice.givenHand`, taken by `applyCardPlayed`):
  that snapshot can land in the same frame as the play, and by the time the board animated, `myHand`
  was already the hand we had received — so the first version flew four backs where nine were coming,
  out of places our hand did not have.
- **A flier waiting out its delay is at its start, not at the layer's origin** (`fill: 'both'` in
  `AnimationLayer`'s `play`): the last cards of a ten-seat deal wait over a second, and filled forwards
  only they sat in the board's top-left corner until then.

## Action bar (`<ActionBar />`)
- **Fixed three-column grid, never a content-sized flex row**: draw left, the reaction button centre,
  pass right. Slots (`data-slot="left|center|right"`) keep their column empty or not, and the bar's
  own width is constant (`--slot-w` ×3 desktop, three `1fr` columns edge-to-edge under 480px), so
  every control sits on the same screen pixel all match long. LOCO is a reaction game — a player
  parks the cursor over the centre *before* the card that needs it lands, and a bar that reflows when
  the penalty draw appears moves the target out from under them.
- **Reserving the column was only half of it: every column holds its button all match and goes dead
  rather than away.** Draw and pass used to be rendered only on our turn, and the slot they left
  behind was empty — the grid held, so nothing moved, but on somebody else's turn the bar became one
  lone pill floating in a wide trough. That is not a neutral state: the bar's outline and the pill's
  outline pinch to a point where they pass each other, so a shape appears at each end of the button —
  little teeth that come and go with the turn, on the one surface that exists to be aimed at without
  being looked at. The silhouette must be the same object all match. It is also the same argument the
  centre column and the LOCO! chip are already written to: a control drawn only while it is pressable
  is one the player has never once looked at before the moment they need it. `game-opponent-turn-quiet`
  is the scene — the bar at its emptiest, every button absent or dead at once.
  - **The penalty draw is the one swap left, and it is ours only.** `Piocher +N` recolours and pulses
    in the left column because a live stack is the most urgent thing in a round; on somebody else's
    turn the stack is theirs to answer, so the column stays the ordinary draw, dead. The loudest
    object on the screen does not belong to a turn we are not taking.
  - **A dead draw wears the neutral fill** (`.btnDrawSecondary`), not the primary gradient and not a
    bare button: an unstyled disabled slot reads as a hole in the bar rather than as the same object,
    off.
- **The other half of that decision is that there is no keyboard shortcut for any of it**, and there
  never will be: the controls hold their coordinates so they can be aimed at, and aiming is the only
  way in. The reasoning, and the global-versus-focused line that keeps the accessibility path intact,
  is in [`client.md`](client.md) ("No gameplay keyboard shortcuts, ever").
- **The centre column is Catch's, all match, and nothing else may ever be in it.** Catch is the
  hardest button in the game to hit — it opens on someone else's mistake and lives for seconds — so
  it sits there mounted the whole match and is only ever **enabled and armed in place**. It is never
  mounted/unmounted: a button that appears is a button you have to find first.
- **Three readable states, not two.** *Dead* while every other hand is above
  `CATCH_LIVE_MAX_HAND` (2) — the opening of every round and most of its middle. *Awake and
  pressable* as soon as any other seat is at two cards or fewer
  (`components/catchAvailability.ts`), i.e. one ordinary play before the server can name anybody:
  a control that only unlocks on the server's cue can be answered but never anticipated, and five
  seconds is not long enough to find a button in. *Armed* for the seconds a seat actually owes the
  call. The middle state is what the price in §14.6 is for, and `game-catch-live` is its scene.
  - **It is looser than the server's window by exactly one play, and no more.** The looseness buys
    the anticipation; a wider one buys a stretch of round where the press can only miss, and a miss
    a player can plan is a card drawn on purpose — see `domain-rules.md`, "The threshold is what
    keeps the price from being buyable".
  - **A declaration the table has heard takes nothing away from it, and that is a rule.** Hand sizes
    decide the middle state; nothing else may. A seat on one card that just called it cannot be
    caught, so the press will miss and cost a card — and the button keeps offering it, because going
    dead there would **say the call happened** to a player who was not listening for it, and because
    that press is precisely the one §14.6 charges for: the thumb already committed when the seat
    shouted. Three states, and only the third one is a promise. What the declaration closes is the
    *armed* cue, which rides `catchTarget`.
  - **A fourth reading, and it is the only one that is about us rather than the table: the wager is
    spent** (`GameView`'s `catchSpent` — `store.catchSpent` *and* no `catchTarget` left). We have
    already called on this board, so the press the store would send is the blind one it suppresses,
    and the button was drawn live over an action that did nothing at all. That is the one lie a
    reaction bar cannot afford, so it is drawn dead — the same sunken slot as "nobody is close",
    because from the thumb's side the two mean the same thing. It costs no legitimate press: a
    window still ours to aim at names itself in `catchTarget`, which is the ordinary second catch
    after a Swap, and the next card played hands the wager back. `game-catch-failed` is its scene.
  - **And what ends the middle state is a clock, not the board** (`isCatchLive` + `catchLiveUntil`,
    `store.catchLive`). None of the four ways a seat leaves the armed cue touches it — it calls the
    thing, it draws, it swallows a stack of four, it takes two penalty cards from a Contre-LOCO!
    that landed on it — because each of those is the instant a betting thumb has already committed,
    and a button that greys out there is sparing the player a press the server charges a card for
    either way. What takes it down is the window running out, plus the one second of grace that
    makes being late a mistake you can make rather than one the interface refuses for you. It is not a latch: held to the next card played instead, the offer was farmed
    a card at a time (`domain-rules.md`).
- **`.armed` is the same cue on Catch and on LOCO**, applied to Catch when `catchArmed` and to LOCO
  whenever it is shown: a punch-in (`armPop`, with a brightness flash) plus a pulsing halo
  (`armGlow`, tinted per button by `--arm-glow`). Deliberately identical — the two are the same
  wager seen from opposite sides of the table, so the player about to be caught must not get a
  louder cue than the player who could catch them. Under `prefers-reduced-motion` it degrades to a
  **static halo**, not to nothing: "this just became clickable" is information.
- **LOCO! is a chip centred above the bar** (`.locoSlot`, `position:absolute`, `data-slot="loco"`),
  out of the grid so it moves no column, **mounted the whole match** and enabled only while
  `handSize === 1 && !hasDeclared`. It followed Catch here, and for Catch's reason: it was drawn only
  in the seconds it was owed, which meant every player met it for the first time inside the window it
  was for. It is dead the rest of the time and that is the whole state — nothing appears, nothing
  leaves, nothing moves. `actionBar.test.ts` asserts the slot, the enabled state and the arming of
  every button across states.
- **It is drawn small, quiet and under 44px, and that is a product decision.** Forgetting the call is
  one of this game's turns — the round where somebody notices too late is the round people talk
  about — so the chip may not read as a fourth action competing with the centre column. 30px tall,
  13px type, `opacity: 0.55` while dead, and its touch target comes from `.hit-target` **only while
  it is live**: a dead control does not need a 44px catcher, and a live one must not steal a tap from
  Catch, which is why the 10px gap above the bar is 3px more than the target overhangs.
- **The band it sits in is part of `BOTTOM_RESERVE`** (140px: 82 for the bar, 58 for the chip), so
  the hand is dealt above it permanently. A chip that fitted only when it lit up would appear inside
  the fan, over the card the player is about to play. Raising or lowering the chip means changing
  that constant in `cardTheme.ts` — never nudging the hand.
- The penalty draw and the ordinary draw share the left slot; `--slot-w` (126px) is sized for the
  widest label either can hold ("Piocher +4").
- **A declaration is a one-shot, and the button is spent with it.** `Room.DeclareLastCard` refuses a
  second call on the same single card (`player already declared`, the string `CatchUndeclared`
  already uses), and the flag only clears when `openCatchWindow` opens a fresh obligation on that
  seat — i.e. a Swap or a GlobalSwitch handing it a card nobody has heard called. Client-side,
  `store.myDeclared` — our own seat read off `store.declaredSeats`, which `applyUnoDeclared` writes
  from the *server's* confirmation and never from the click — disables the button in place: it goes dead in its own slot rather than disappearing, because
  nothing in this bar may move mid-match. Without either half, LOCO! could be
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

### The turn pill draws when it says "Draw" (`TurnIndicator.svelte`)

The pill above the hand is a label in every state but one. On our turn with a stack pending it
reads "Draw 2" (or "Draw 4", or "... or counter!"), in an orange gradient, with the ink outline and
the hard shadow every raised object wears, pulsing: by the game's own conventions — a button is the
verb about to happen, a raised object is a control — it *is* a button. A player pressed it and
nothing happened, which is the one lie a board cannot afford. So in that state it is rendered as a
`<button>` wired to the same `onDraw` as the action bar's penalty draw, acting on the press
(`pressToAct`), with `.hit-target` for the 44px floor; its pressed state flattens the shadow and
never touches the transform, which the fly transition owns. The alternative — take the outline and
shadow off so it reads as text — was rejected: it is the most urgent thing on the board for its
duration and has to stay the loudest object there. `turnIndicator.test.ts`.

Its throb is a `<span class="wash">` and not a pseudo-element, and both of those are taken. `::before`
is the turn's arrival burst; `::after`, once the pill became a button, is `.hit-target`'s, whose
global rule centres it with `top/left: 50%` and `translate(-50%, -50%)`. The wash used to be that
`::after`: its `inset: 0` overrode the placement and kept the translation, so the white pulse beat
half a pill up and to the left of "Draw 4", on the felt beside it. `hitTarget.test.ts` fails on any
component rule painting the `::after` of an element that wears `.hit-target`.

## Mobile
- Seats resize and wrap automatically (see "Seat layout"); nothing about the table is hard-coded to
  desktop. Verify with `make visual ARGS="--viewports=mobile"`.
- All action buttons: `min-height:44px`, `touch-action:manipulation`.
- 400ms debounce (`guardDoubleTap`) on action buttons.
- Wild picker: 64px+ touch targets in a row.
- HTML viewport: `width=device-width, initial-scale=1.0, viewport-fit=cover` and **nothing else**.
  It used to carry `user-scalable=no, maximum-scale=1.0` to stop a double-tap zooming the board
  mid-match, and that took pinch-zoom with it on every page of the site. The double-tap is answered
  by `touch-action: manipulation` on `body`, which leaves the pinch alone; a board can now be
  pinched during a match, deliberately. `a11y.test.ts` fails on either attribute returning.
- CSS `@media (max-width:480px)` for small screens — a **layout** breakpoint: a bar that has to run
  edge to edge, a table that has to drop a column. **A panel that changes shape does it at 46rem**,
  which is where the navigation becomes a burger and where all four sheets flip together; see
  "One sheet, four surfaces" in [`client.md`](client.md).

### A phone on its side (`layout.ts: isLandscape`, `ActionBar.svelte`'s landscape block)
Portrait stacks the table — seats, felt, hand, action bar — and the two chrome bands that do not
scale are 198 pixels of that stack. An iPhone 13 Pro sideways with Safari's bar showing is 340
pixels tall: at the scale that fits the stack a card is 25 pixels wide, so the report was right that
"horizontal does not work at all" — the board was laid out at scale 1 (the width was past the phone
threshold), the hand sat across the felt and the seats under the turn pill.

Landscape is therefore **another composition, not a smaller one**, and the whole of it is in
`layout.ts` behind one `landscape` flag every layout function takes:
- `isLandscape(w, h)`: wider than tall and under `LANDSCAPE_MAX_H` (560px). Decided in `GameBoard`
  from the element's pixel size and in `feltInViewport` from the viewport's, and handed down — the
  virtual space cannot re-derive it (see "Board scale"). A short desktop window gets it too, and it
  is the right answer there for the same reason.
- `boardSpace`: the chrome that does not scale is **up the right edge** — the action stack's band,
  `SIDE_RESERVE` = 160 pixels, the stack's 124px slot plus its padding, stroke, margin and a gap —
  and along the top, `TOP_CHROME_LANDSCAPE` = 44 for the round chip and the turn clock. Nothing is
  under the hand: it runs along the bottom safe edge itself, `HAND_MARGIN_LANDSCAPE` above it.
- `seatLayout` → `seatColumn`: the seats stand in a column down the left band
  (`SEAT_BAND_LANDSCAPE`, a compact seat and its margins), centred on the felt, **next player at the
  bottom** — play runs clockwise on screen, 6 → 9 → 12 → 3, so the ring is unchanged. Compact seats
  while the column holds them, mini when it needs the room; what the column cannot hold continues
  **along the top of the felt, left to right**, stopping short of the chip row (`CHIP_ROW_CLEAR`),
  and the felt drops under that row by `blockHeight` exactly as it does under a portrait row.
- `tableRect`: the felt takes the whole band between the top chrome and the hand and the whole
  width right of the seat band, flatter than portrait's oval, never taller than the band.
- The piles stand **high in the felt** (`pileTop`, `PILE_INSET_LANDSCAPE`) and the turn pill takes
  the band under them, centred on the felt (`turnPillPlace`, which also owns the portrait reserve
  above the hand): between a felt that ends a hair above the hand and a hand whose top edge carries
  every card's value, there was nowhere else to put it. A felt squeezed under a top row is shorter
  than the piles and the pill together; the pill then rides the bottom rim and stops short of the
  hand.
- The action bar is a **stack**: draw, Contre-LOCO!, pass, top to bottom, the reaction still in
  the middle, the LOCO! chip above it, at the right safe edge. The same three fixed slots that never
  reflow — only the axis turns, with the phone. `@media (orientation: landscape) and (max-height:
  559px)`, and every measurement the `max-width: 480px` block sets is set again, because a phone on
  its side is wider than that. The chip row stays top-right, above the stack.

`landscape.test.ts` runs the board's whole chain at 844×340 with the notch on one flank, and pins
the stack's CSS to `SIDE_RESERVE` and `LANDSCAPE_MAX_H`, since a stylesheet cannot import a constant.
Review with `make visual ARGS="--viewports=landscape"`, the only viewport the composition is visible
in; `game-seven-players` is the full table.

### The entry screen on its side (`Lobby.svelte`'s landscape block)
The board is not the only screen a phone can be held sideways at, and the entry screen was the one
that had never been laid out for it. Stacked — wordmark, tagline, four buttons — it needs about 430
pixels; the page is 340 minus the footer row, so at 844×340 three things went wrong at once, and all
three are the same failure. Every piece of chrome on this screen is **absolutely positioned so it
reserves nothing** (the chip row, the connected-player plate, the live strip — each for a good
reason, written where it is styled), and a column that overflows runs straight through all of it:
the wordmark stood up into the gear and the speaker, the live strip landed across the middle of the
1v1 button, and the three entry points below the first were under the footer, on a page that is
exactly one viewport and never scrolls. Nothing was unreachable *and* nothing said so.

So it takes the same answer the board takes, on the same height and with the same words: **another
composition, not a smaller one**, at `@media (orientation: landscape) and (max-height: 559px)` —
`LANDSCAPE_MAX_H - 1`, which `landscape.test.ts` pins here as it does on `ActionBar.svelte`.

- The column becomes **two**: the lockup (mark + tagline, wrapped as `.lockup` because it is one
  object) on one side, everything the player acts on (`.panel`: the refusal and whichever form is
  up) on the other. That is the whole reason those two wrappers exist; upright they are plain
  columns the container's own gap runs through, and every portrait, small, notch and desktop capture
  of this screen is pixel-identical to what it was.
- The four ways into the game become a **2×2 grid**, a third of the height of a stack of them.
  Hierarchy is a hue: the 1v1 button keeps its fill, its height and its first place in reading
  order, and nothing is demoted to a smaller kind of control. The forms take the same grid — one
  field to a row, except the join form, where the name and the code sit side by side over their two
  buttons. Their `<input>`s need `min-width: 0`: a grid track is `min-content` first, and an input
  asks for twenty characters, which solved the form wider than the screen.
- The container's padding is where the absolute chrome is finally accounted for: the chip row's band
  at the top (`--space-base + --topbar-h + --space-sm + --safe-top`, the same expression the waiting
  room and the table use, never a 40 written out again) and the live strip's at the foot. Under
  46rem — a split screen, a small window — the foot carries two plates rather than one, because the
  connected-player count has moved down there and the strip stacks above it, so that padding grows.
  `justify-content: safe center` was already right and was never the problem: it anchors overflowing
  content at the top, which is *under* a chip row that reserves nothing.
- The mark's type size is a token on the container (`--lobby-logo`) rather than a literal on
  `<LocoLogo />`: sideways it wants a smaller one, and a prop cannot be written twice.
- **Every row the same height and every label on one line**, and both are sized, not hoped for.
  `grid-auto-rows: 1fr`, because the 1v1 button carries a second line and a first row taller than
  the second read as a mistake rather than a hierarchy. The grid is half the viewport wide and the
  type steps down a size at the narrow end (under 46rem: an iPhone SE sideways gives a column 180px)
  so that "Jouer contre un bot" and "Rejoindre une table", nineteen characters each, never break —
  the one button that wraps beside three that do not is the one the eye reads as the odd one out.
  The tagline is set centred under the mark: a left-ragged pill under a centred logo was two objects.
  Checked at 667×375, 740×360, 844×340 and 932×430.

The queue's two screens took the same pass, because the defect was the same one:
- **`Searching.svelte`** carries the chip row as well — the wait is the longest a player ever spends
  on one screen, so turning the music down has to stay reachable — and the wordmark stood straight
  under it. Same two columns (`.stageSide`, `.panel`), same padding, and `align-items: safe center`
  beside `justify-content`: a *column* taller than the row it is in overflows both ways when it is
  centred, and the half that goes up goes under the very row the padding is clearing. The words are
  also given a wider measure sideways — a narrow column of five lines was most of why that side did
  not fit.
- **`MatchFound.svelte`** draws no chip row, so nothing overlapped; it simply ran the two cards off
  the bottom, on the one screen a player does nothing but look at for two and a half seconds. It is
  squeezed rather than recomposed — the meeting of the two cards *is* the composition.

The waiting room is deliberately untouched: it already clears the chip row, and its roster scrolls
by design at any size.

Review it with `make visual ARGS="--viewports=landscape --scenes=lobby-home,lobby-live,lobby-join,matchmaking-searching-long,matchmaking-found"`
— `lobby-live` is the one where the strip is drawn, and it was the worst of them all.

### Safe areas (the notch and the home indicator)
The page owns the whole screen and keeps the game off its edges. Both halves are needed: without
`viewport-fit=cover` iOS confines the page to the safe area and fills the notch and home-indicator
bands with the **root element's own colour**, which put two bright violet strips across a room lit
like a nightclub; with only the cover flag, the action bar would sit under the home indicator's
swipe bar and the round badge under the status bar.

- `--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left` in `tokens.css` wrap
  `env(safe-area-inset-*)`. Every piece of chrome anchored to an edge offsets itself by them
  (`.topRight`, `.roundIndicator`, `.turnTimerBar`, `.actionBar`, and the padding of every screen
  container). Zero on any device without a notch, which is why they are plain `calc()` and not a
  media query.
- **`layout.ts: boardSpace` takes the insets**, so `TOP_CHROME` and `BOTTOM_RESERVE` are measured
  from the *safe* edge and the whole coordinate space stops short of the bands. The board element
  still runs edge to edge: the room's picture uses the difference, the game does not. `offsetX` is
  the landscape half of the same rule (a phone on its side puts the notch on one flank).
- `safeAreaInsets` reads the numbers back through a hidden probe whose padding is the `--safe-*`
  tokens, and re-measures on `resize`/`orientationchange` only. An `env()` held in a custom property
  reads back as the unresolved token in several engines, so the resolved computed padding is the
  only reliable source. Reading the *tokens* rather than `env()` directly is also the seam the
  capture harness overrides.
- **A match in a map pins `<html>` to `--room-void`** (`<GameBoard />` sets `data-room` on the root
  and writes the scene's horizon, **taken well down towards the void**, into the variable).
  The browser paints anything the page does not own with the root's colour, so this is the only
  thing that can reach a band left over by a floating browser bar. A violet strip across a dark room
  reads as a broken layout; the same strip in the room's shadow reads as the room. **The horizon
  itself is not that shadow**: a noon sky is a near-white, so on a day map the variable was painting
  the brightest thing on the screen — the opposite of what it is for — and the loading screen, which
  wears the same value, went with it.
- Review it with `make visual ARGS="--viewports=notch"` — no desktop browser reports an inset, so
  that viewport is the only place this layout is visible at all. `layout.test.ts` owns the maths and
  `safeArea.test.ts` owns the wiring through to the stage's transform.

### The chip row takes no space, so the screen under it has to give some
The gear, the speaker and the "?" are one absolutely positioned row in the top-right corner of every
screen that has them. Absolute means they are out of the flow: the column below them has nothing
telling it they are there, and the container's **top padding is the only thing** holding the first
element off them. That padding used to be a spacing step chosen because it looked generous —
`--space-xl`, 32px — while the chips are 40px tall sitting at `--space-base`, so they reach 56px. The
24px of overlap cost nothing for as long as every screen's content was short enough to be centred.

The waiting room is the one that is not. Roster plus host panel plus two actions plus the leave link
overflows a phone, and `justify-content: safe center` then does exactly what it is there for: it
stops centring and parks the content against the top padding. That is the state in the bug report —
"The table" printed underneath the gear on a private table.

So the reserve names the chip instead of guessing: `--topbar-h` in `tokens.css` is that 40px in one
place, and the container's padding is `--space-base + --topbar-h + --space-sm + --safe-top`, which is
the row's own offset, its height, and a gap. Two tests in `waitingRoom.test.ts` read the rule off the
component's `<style>` block, because nothing renders here — jsdom applies no stylesheet and the
overlap only exists at a width and a content height a unit test does not have. A screen that grows
past its viewport gets the same padding; one whose content is always centred does not need it, which
is why the other five still carry a spacing step.

### The host is told what they are choosing, where they choose it

Two decisions were being made blind. How long a format takes and how many seats a table wants both
had advice written down — in the FAQ and in the rules page, which is to say nowhere near either
control — so a host who had never played a best-of-7 at six seats found out by playing one.

- **The length rides the format button itself** (`matchLengthModel.ts`), a second line under the
  label rather than a note beside the row: the whole promise is then the thing being pressed, the
  same shape the 1v1 button's own hint has.
- **It is a range and it carries an `≈`.** A match ends the moment the lead in rounds won cannot be
  caught, so a best-of-7 finishes anywhere between four rounds and seven. A single figure would be
  wrong at both ends, and wrong in the direction that costs the table: a host who reads "≈ 30 min"
  and gets an hour stops offering long formats. The model is pure and unit-tested for that reason —
  it is the part with arithmetic in it, and `fastestRounds` is the client's statement of the same
  rule `Room.decisiveLeader` enforces.
- **It reads the roster, not the seat cap.** The cap is what the table *could* hold; the question is
  how long the evening will be with the people who are actually here, and it moves as they arrive.
- **The seat advice is a hint under the field**, in `--color-muted` — quiet is a hue here as
  everywhere, never an opacity on the ink. Both are host-only: a guest is not making either choice,
  and advice about a control somebody cannot reach is noise.

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
Scene `game-wild-active-color`; `src/test/discardPile.test.ts` covers the chip and both callout
branches.

## Maps (the room a match is played in)
A map is **a scene, a table and an accent colour**. It changes no rule, no card and no timing. Six
ship: **Neon** (a rooftop terrace above a neon city), **Rune** (a village street with a wizard's
tower on its hill), **Velvet** (the terrace of an art-deco hotel on its boulevard), **Orbit** (a
landing pad on an airless moon, the Earth in its sky), **Sakura** (the veranda of a hot-spring inn
under cherry trees) and **Marina** (a card table at the end of a quay, the bay in front of it). Each
is dealt at one of **four hours** (dawn, day, dusk, night) under one of **six skies** (clear,
cloudy, rain, storm, snow, fog), and the room says which skies it allows: it does not snow on the
moon.

**Nothing about a map is a picture.** The first four were photographs — a generated room and a
generated table, cropped, placed by a rectangle measured off the art — and a photograph is one hour
under one sky forever. What replaced them is a place that is *built*: the room is a scene of
coloured blocks and a few drawn models rendered in the browser (`components/scene/`, three.js),
seen from the table, and the table is CSS drawn from the room's own materials. A match at midnight
in the rain and one at noon in the same room are two rooms, which is what "the maps dictate the
mood" asks for.

- **The draw is server-side and per match, and it is three ids.** `game/maps.go` (`MapID`,
  `TimeOfDay`, `Weather`, `MapWeathers`; `Room.pickMap` / `pickTime` / `pickWeather`); `Room.Start()`
  writes `MapID`, `MapTime` and `MapWeather`, `BeginNextRound` keeps all three (rain does not stop
  between two rounds), `ResetForRematch` clears them so the next match gets a new room. Exported as
  `GameStateDTO.map_id` / `time_of_day` / `weather` on **every** snapshot, not just `game_started`,
  so a reconnecting player rebuilds the same room as everybody else. All three are bare strings on
  the wire, for the reason `map_id` always was: a value this client does not know degrades to a
  default (`resolveScene`: an unknown hour is dealt in daylight, an unknown or unlisted sky is dealt
  clear) and never drops the whole `game_state`.
  - It has to be the server's even though the consequence is purely visual: two players in one room
    describing two different tables to a viewer is a table that does not exist, and a clip cut
    between two seats would jump between two rooms. Hashing the room code client-side would agree
    just as well but would freeze a room's map forever, and a rematch is meant to feel new.
  - **`maps.test.ts` pins the client's three lists and every per-map weather list to the Go source**,
    in order. A map, an hour or a sky on one side and not the other is a match dealt into a room this
    client cannot draw, and it fails as a plain felt, silently.
- **`tableRect()` remains the single authority on the board's geometry.** A scene replaces how the
  felt is *painted*, never where anything is: piles, seats, direction ring and every animation
  coordinate are identical with or without one. The felt *is* the rectangle, the CSS table is drawn
  on it directly, and the render is solved to it (below), never the other way round.

### The view (`scene/view.ts`, the pass of 2026-09-25)
**A room is seen from the table.** For its first year the room was photographed from above,
orthographic, at the angle a Habbo room is drawn at: every block the same size wherever it stood,
no sky, no horizon — and so no depth. Put beside the living worlds of the sister project Reverie,
it read as a board game's map laid round the table, not as a place the table stood in. What gives a
picture depth was named then and is now the brief for every room:

1. **Three grounds and a horizon.** A near that frames the picture at its two edges and is the only
   thing drawn at full weight; a middle that is most of what shows between the seat pills; a far of
   silhouettes laid one behind the other; the horizon, and the sky above it.
2. **The air between them** (aerial perspective): the farther a thing, the more it takes the colour
   of the sky low down, and the less of its own saturation it keeps (`post.ts: AirOptions`,
   `LOOK.vista.haze`).
3. **A light the viewer sees.** At dawn, dusk and night the sun or the moon is *in the frame*,
   low, with its halo, and it is what lights the room — from behind, so the long shadows come
   towards the table — and its road lies across the water (`dome.ts`, `mirror.ts`).
4. **A palette held.** Each room's light pulls the hour towards its own colours (`LOOK.rooms`), and
   each room draws with few, related colours rather than every colour its props came in.
5. **Air round the subject.** A few things, and ground between them: the quiet rule below still
   holds.

The camera is a perspective camera at eye height (a tile is a metre here: a person is 1.6), looking
towards `-z`, the table's centre at the world's origin. **The felt is fixed and the camera is solved
to it** (`solveView`, `sceneView.test.ts`). The board draws the table in CSS (`layout.ts:
feltInViewport`), a screen ellipse the render has no say over, and under a perspective camera a
table top is the ground-plane image of that ellipse through the lens — itself an ellipse, not
centred where the screen one is. So the top is the felt's own outline **cast back onto the table's
plane** (`View.tableOutline`) and extruded (`Kit.plate`), and the CSS table lands on it to the pixel
whatever the camera. What is left to choose is the camera, and two things decide it:

- **Where the horizon sits** (`LOOK.vista.camera.horizon`, 13% of the frame from the top): above
  the felt, so the sky and the far shore show between the seat pills and in the top corners.
- **What shape the table is on the ground** (`aspect`, 1.5 deep for 1 wide). The nearer the horizon
  comes down to the felt's top edge, the farther away that edge is on the ground: a horizon just
  over the felt is a table fifteen metres deep. So the shape is held, and the focal length is what
  gives — solved by bisection inside a range a lens can honestly have (`fov`, 58–84° across). Where
  the range cannot hold both (a phone on its side, where the felt is nearly the whole height) the
  lens takes its widest and the horizon goes where it must, the table deepening up to `aspectMax`
  to keep a strip of sky (`horizonMin`).

The principal point is put on the felt's centre across (a lens shift, invisible) and at the horizon
up, the camera turned down by a share of the angle to the table (`tilt`, 0.3) so verticals stay
nearly vertical: a skyline whose towers lean out is a wide-angle lens, not a view. `render.ts`
builds the three.js camera from the numbers (`cameraSpec`, `setViewOffset`), and a sprite is shot
by the same camera cropped to it. Measured on a 16:9 monitor, what shows round the felt is: the sky
and the far ground in the top band and the top corners, the middle ground along the top of the felt,
the near ground and the framing props in the two side bands, the floor in the bottom corners.
Composition is written for those bands (`maps/vista.ts`, each builder's header).

### The look (`scene/look.ts`, `src/dev/lookPanel.ts`)
Every visual number the render reads, in one file: the four hours (the sky, the sun and where it
stands, the body in the sky, the stars, the sky light, lamps, windows lit, how dark), the two global
knobs over the sun and the sky, the shadow (softness, biases), the material (roughness, the glow's
brightness, the halos', the foot shade), the outline, the occlusion (two radii, intensity, contrast,
samples, blur), the tone curve (the mapping, exposure, contrast, saturation, the split tones), the
finishing passes (bloom, fringe, vignette), the water, the mist, the lamps' pools, the view
(`LOOK.vista`: the camera, the air, the drawn sky, the ink's falloff with distance, the far blur)
and each room's own light (`LOOK.rooms`). **Framework-free and three-free**, so `sky.ts` (which a
content page imports) can read the hours out of it and a test can assert the whole thing. What it
replaced was the same numbers written at their call sites, where finding the one that made a dusk
read as night meant reading four files.

The dev panel is lil-gui over exactly this object: `?look=1` on any page in dev mounts it
(`entry.ts`, behind `import.meta.env.DEV`, so neither the panel nor lil-gui reaches a build), a
move edits `LOOK` in place and calls `bumpLook()` after 180 ms of quiet, the backdrop hears it
(`subscribeLook`) and asks for the room again — `lookVersion()` is part of the cache key
(`sceneCache.entryKey`) and of the entry (`PreparedScene.look`), so a frame rendered with the old
numbers never answers a request made with the new ones, and the new frame fades in over the old
like any re-render. "Copy JSON" puts the whole look on the clipboard to paste back into the file;
nothing is persisted, because the file is where the numbers live. `?lookPatch=<json>` on the
showcase applies a partial look before the first render, which is how a room is shot under a
number that is not committed yet (`tools/visual/shoot.mjs --gfx=…` for the tier, this for the
rest). `LOOK.debug` shows one pass alone (`ao`, `lit`, `depth`) and ships `off`, which
`sceneLighting.test.ts` pins. **`lit` is the one to reach for when something in the frame has no
geometry behind it**: the pale vertical bars that stood above the horizon in the first Marina were
the clouds of the dome, found that way in one shot (below).

### The light rig (`scene/sky.ts`)
The hour and the sky, as numbers, with no framework and no three.js in the file, so a content page
can read it and a test can assert it. `lightRig(time, weather, room)` takes the hour out of
`LOOK.hours`, lays the room's own light over it (`LOOK.rooms[id]`: its sky, its sun, its body, its
tints, its air) and returns the sky gradient, the sun (colour, intensity, elevation, azimuth, shadow
strength), the body in the sky with how much of it the weather leaves (`visibility`), the stars,
the cloud, the air's thickness (`haze`, the room's times the weather's), a planet for a room in
space, the hemisphere fill, and five things the kit and the board build from: `lampsOn`,
`windowsLit` (a share), `snow`, `wet` and `dark` (0 at noon, 1 on a stormy night). The weather is
applied *over* the hour — a storm at noon is still lit from above — and the overcast grey is the
hour's own horizon mixed down, which is what keeps twenty-four combinations from being six: a grey
dusk is warm and a grey dawn is pink. **The hour has to survive the weather**
(`sceneLighting.test.ts`): a storm keeps 40% of the sun and adds a quarter to `dark`; snow mixes the
sky and the ground light towards white by the hour's own light, taking the night's blue after dark.
**A fog closes the air** (`LOOK.vista.haze.weather`: 4.5 times a clear day's), rain and snow thicken
it, and a cloudy sky veils the body and takes the rain's and the storm's away. `rigCssVars` is the
same rig as custom properties (`--sky-top`, `--sky-horizon`, `--scene-tint`, `--scene-dark`,
`--sun-dx`, `--sun-dy`) for the board, the overlay and the rooms page.

**The sun's place is composition, not weather.** Azimuth 0 is `+z`, behind the camera; 180 is
straight ahead. At dawn (205°) and dusk (158°) the sun is low and ahead, a few degrees over the
horizon and inside the frame, and it lights the room from behind: the near props are rimmed and
their fronts in their own shade, and the shadows run long towards the table. At noon it is high and
to the side (130°, 48°), out of the frame: a noon lit from over the shoulder is a room with no
shadow anybody can see. At night the key light is the moon, high enough to throw a shadow (24°),
while its disc is drawn low in the frame. A room moves these for its own composition
(`LOOK.rooms[id].sun` / `.body`: orbit lights every hour low and white, and takes the moon out of the
moon's sky; neon's moon rises over the left of the city). `sceneLighting.test.ts` pins the rules
(ahead at the two ends of the day, to the side at noon, never under the horizon);
`sceneVista.test.ts` pins that **every body up in a clear sky lands in the frame between its top
edge and the horizon**, per room and hour, at 16:9 — neon's moon was above the edge when it was
written.

### The sky (`scene/dome.ts`)
A dome round the camera, drawn by one shader, in the scene. **A mesh rather than a pass**, because
the water has to reflect it — the sun's road across the bay is the dome, mirrored — and the bloom
has to see the sun's disc to spill it. It writes no depth and is drawn first, so the finishing
passes read the sky as "nothing here" (a depth of 1) and leave it out of the occlusion and the air.
What it draws, in order: the gradient (pale at the horizon, the hour's colour overhead, `curve`
setting how fast it climbs — a sky seen head-on needs a faster climb than one that was only ever a
wash of light behind a board, so the hours carry **the sky that is seen**, deeper and more
saturated than the old ones); the aureole on the light's side, widest at the horizon; the body's
halo, tight (`haloSize`, 2.5°) — a wide one washed the whole visible band of sky white; the stars,
thinned towards the horizon; the clouds, a layer overhead seen in perspective, lit on the side the
light is on with a bright edge towards it; and the body over the cloud's thin edge (a sun at
`bodyGlow` in linear light, a moon with a few seas and no glare). **The clouds' projection is
softened towards the horizon** (`d.xz / (up + 0.05)`): a hard floor on the divisor left the noise
varying with the azimuth alone in the last two degrees, and drew pale vertical bars standing on the
far hills. A room in space (`LOOK.rooms.orbit.space`) has a black sky with stars at every hour, no
cloud, and a planet: oceans, land and weather by noise, lit by **its own sun** (`planet.lit`) — lit
by the room's key light, the Earth showed its night side — with the blue of its air round the rim.

### The kit and the builders (`scene/kit.ts`, `scene/maps/*.ts`, `maps/vista.ts`)
A builder never touches three.js. It calls `box`, `cyl`, `sphere`, `cone`, `prism`, `disc`, `halo`,
`plate` (any convex outline, extruded) and the props composed from them (`window`, `door`, `lamp`,
`lantern`, `tree`, `bush`, `rock`, `stall`, `bench`, `fence`…), and `build()` merges every block into
five meshes — lit, glow, ink, shadow, halo — so a whole room is a handful of draw calls. What the
rooms share is `maps/vista.ts`: `vistaTable` (the table under the felt), `hills` (low wide mounds,
never peaks, one layer of the far ground), `skyline` (towers with a band of glass a floor and the
hour's share of panes lit, a neon edge on some, a few spires), `sailboat`, `deck`, `neonText`.
Each builder's header names its three grounds.
- **Every block carries an outline, in a darker note of its own colour** (`inkFor`), the rule every
  raised object in `tokens.css` obeys, with the one deliberate difference that a room of ten
  thousand objects is inked in each fill's own darker tone rather than in `INK`. An inverted hull
  per block, drawn back-face only. **Its thickness is a number of pixels where the block stands**
  (`KitOptions.outlineAt`, from `view.tileAt`): under a perspective camera a line of one pixel is a
  longer run of world the farther away it is, so the hull grows with the distance, and **thins to
  `inkFar` of itself by `inkFade` tiles** — ten thousand full-weight lines on the far shore read as a
  scribble, and the air draws that edge anyway. **And a wall darkens towards its foot**
  (`LOOK.material.footShade`), what an illustrator does to sit a building on the ground.
- **Colour is a vertex attribute, and the light is a light** (`scene/lighting.ts`, `scene/shade.ts`).
  The kit writes a block's colour into its vertices; the merged mesh is one rough, matte
  `MeshStandardMaterial` that casts and receives, and the sun, the sky and the shadow reach it
  through its normals like any rendered object.
- **The sun throws one PCF shadow map over the near ground** (`LOOK.shadow.reach`: 16 tiles either
  side, 42 back, 12 up, fitted in light space). The near ground is where a shadow can be seen, and
  a map over the whole bay was three centimetres a texel on planks the camera stands a metre from.
  **A room whose middle ground is planted reaches further** (`LOOK.rooms[id].shadowReach`, carried
  on the rig): velvet's promenade of palms and lamps runs 22 tiles either side and out to 160, and
  under the default not one of them cast a shadow — a row of trees standing on nothing. Velvet
  reaches 30 and 165. The texels are spread over the box, so reach only where a caster stands.
  `sceneShadowReach.test.ts` fails on a tree or a street lamp planted outside its room's reach,
  **and on one standing off the ground slab under it**: velvet's boulevard lay a fifth of a tile
  under the terrace, every model on it stood at the terrace's level, and the promenade floated.
  **PCF, not VSM**: three keeps the VSM moments in half floats, and over the depth a sun at
  `SUN_DIST` sees, the mean quantises in steps of a hand's width — a staircase along every shadow
  edge on the deck, which no blur radius touched. PCF compares against a 24-bit depth and softens
  by the same radius (`LOOK.shadow.radius`). **`normalBias` is 0.03**: a tile is a metre and a texel a
  centimetre or two, and the 0.3 the old view needed shifted a shadow a hand's width off its caster.
- **The weather is answered in the kit, once**: `snow` caps every flat top and whitens the ground and
  the foliage, `wet` darkens the ground the builder asks for, `lampsOn` decides whether a lamp's
  head, a window, a neon tube or a lantern goes into the unlit `glow` bucket or the lit one. A
  builder says "this is a lamp"; the kit says what a lamp looks like tonight.
- **Every decision is seeded** (`scene/rng.ts`, mulberry32 on the scene's key): which windows are
  lit, where a hill swells, how tall the third tower is. A place that rearranges itself on refresh
  is not a place, and every seat at the table has to see the same one.
- **The table is the felt cast down, and nothing wider** (`vistaTable`). In a room the render
  draws all of it ("The table", below): the cloth, the racetrack and the rail on top, the edge
  going down **swept in a profile** round the outline and never past it (a rim a hand wider made a
  dark drum round the table), a metal band round its face, a skirt set back under it, and a
  pedestal of the room's own. So the loading screen already shows the table the match will be
  dealt on.
- **The near ground frames; it does not fill.** Two things at most per side band, at the table's
  depth or a little behind it (a lamp post and a bollard, a stack of crates; a fluted column and a
  palm in its urn; the tavern's corner and a market stall), tall enough to cut the top of the frame
  where that frames the view — the eaves over Sakura's veranda, the cherry branches in its top
  corners. **Floors are laid across the frame** (`deck`): planks or cobbles running out towards the
  horizon fanned round the table on a wide lens and read as a whirlpool.
- **The far ground is layered, and nothing in the middle may hide it.** Hills are flat cones in
  runs (`hills`), each layer farther, lower and bluer; the air does the rest. Rune's meadow hills
  were forty metres high at five hundred and hid the woods and the tower behind them; they are
  eighteen now. **A landmark stands where the frame can hold it**: the wizard's tower is placed so
  its light, forty metres up, sits under the frame's top edge in the gap the street opens; neon's
  broadcast tower has its deck in the sky band on the right; the Earth hangs between the round
  badge and the seat pill. A seat pill covers the top centre of every frame, so nothing that matters
  is put there alone.
- **Unlit, a neon tube or a neon letter keeps its colour a shade down** (`neonText`), never grey: by
  day the grey version turned the neon district into any city and the brand's own sign into a blank.
- **A sign is glass tubes bent along the letter, on a dark panel, never a bitmap of blocks**
  (`neonText`, the stroke font `GLYPHS`): lit, each tube is its colour with a core near white laid
  in front of it, and the glow round the word is the bloom's — no halo sphere over it. The 5×3
  bitmap it replaced came out, at the hundred metres a sign is read from and under the bloom, a
  row of blobs (`L 0C0!`). **A sign is also kept clear of what stands between it and the table**:
  velvet plants no palm and no lamp on the line from the eye to its marquee (`acrossSign`).

### The render (`scene/render.ts`, `scene/sceneCache.ts`)
- **One frame, then the context is released.** A match is a hand of cards animating over the scene
  for twenty minutes, and the board's compositing budget belongs to the cards (`cardArtSpace` was
  bought at 3 → 10 fps on a full hand; a live viewport under it would spend that again). So the
  room is rendered **once**, the pixels are copied into a 2D canvas, the geometries and the WebGL
  context are disposed, and what the board draws from then on is a static bitmap, exactly as cheap
  as the photograph it replaced. Everything that moves — rain, snow, the fog's drift, the storm's
  flash, the cloud shadow — is a CSS transform animation on a **drawn tile** (`weatherTiles.ts`,
  `WeatherLayer.svelte`), one compositor layer each, and holds its first frame under reduced motion
  (the flash and the bolt are the one thing that goes away entirely: a full-frame flicker is what
  the preference exists to refuse). A tile is a seeded bitmap, drawn once per tab into a canvas and
  handed to the sheet as a data URL (`img-src` allows `data:`): sixty streaks of different lengths,
  weights and fades, soft flakes with a few big blurred ones close to the lens, haze and cloud
  shadow made of overlapping blobs. Every shape near an edge is drawn again one tile over, in both
  axes, so the tile wraps; the shapes are pure and seeded (`rainDrops`, `snowFlakes`, `fogBlobs`,
  `dustSpecks`) and are what `sceneWeather.test.ts` asserts, since jsdom has no canvas — a browser
  with none gets an empty URL and a dry room, never a throw.
  **Every sheet travels exactly one tile per cycle, and never a percentage of the frame**: the sheet
  wraps back to its start at the end of the cycle, so unless the distance it travelled is a whole
  tile the pattern lands somewhere else than it left. `tiled()` writes the tile as the sheet's
  background **and** as `--tile-w` / `--tile-h`, and the two keyframes (`fall`, `drift`) travel by
  those variables and by no literal. **The wind is a skew, never a diagonal travel**: a diagonal
  translation only wraps when both legs are whole tiles, which pins the angle to the tile's shape;
  `.wind` skews the sheets and the vertical wrap is untouched. The snow sways on an outer element and
  falls on an inner one. Nearer is faster and brighter (`FALL_S`, `DRIFT_S`, `SWAY`), and none of it
  faster than about 550 px/s, past which a spectator reads static. **A sheet covers the frame for
  the whole of its travel, at any size** (`sheetBox`): one tile of overhang the way it travels, the
  lean's reach in the frame's height (in `cqh`), never a percentage of the frame.
  `sceneWeather.test.ts` proves coverage from 320 to 3840 wide, 320 to 2160 tall. How many sheets
  is the graphics tier's: three of rain and of snow on `high`, two on `medium`, one on `light`; fog
  two, two and one. Lightning is a sheet flash plus the glow of the bolt off one top corner. A room
  that declares `dry` (Orbit) gets no rain in a storm: the flash and a drift of dust.
- **The frame is supersampled** (`QUALITY[tier].supersample` and `.glPixels` through
  `supersampleFor`): rendered up to twice its size on each side (three times on `high`; `light` does
  not supersample and multisamples instead — no tier does both), and **brought down in linear
  light** (`post.ts: RESOLVE_FRAG`): the composite is kept in a float target, unencoded, and every
  bitmap pixel gathers the texels under it through a Mitchell–Netravali kernel (B = C = ⅓, two
  bitmap pixels wide), the sRGB encoding applied once, after. So an ink line is one clean stroke at
  any angle rather than a stair. **It used to be `drawImage` at `imageSmoothingQuality: 'high'`**,
  which averaged encoded bytes — every lit window, neon tube and thread of sky between two roofs
  came out darker than it was rendered — with a filter each engine chose for itself. The plain
  path (`light`, a GPU with no float target, a failed chain) still takes `drawImage`. The budget is
  in pixels, so a phone gets the full factor and a large monitor gets what fits; the side is held
  under the tier's `maxSide` **and** the device's own limits (`MAX_TEXTURE_SIZE`,
  `MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`, asked of the context). **`high` goes to 8192 and
  16 Mpx**: behind the old 4096 side it reached ×2.13 at 1080p and ×1.6 at 1440p, below what the
  rung promised; it now reaches ×2.78 and ×2.08. `medium` and `light` stay at 4096, the texture a
  mobile GPU still accepts. The table's grain is filtered anisotropically at the tier's figure
  (16, 8, 4, `setGrainAnisotropy`), capped by the device — it is the one texture seen at a grazing
  look; everything else is vertex colour. Resolution is
  the viewport at `devicePixelRatio` capped at `MAX_DPR` (2) and `MAX_SIDE` (2800) on the long side
  (`renderSizeFor`), and **`renderSizeFor` reports the ratio the size was solved at**, because the
  felt is converted to device pixels by it before the camera is solved: handing back the ratio the
  *screen* asked for after cutting the size down built the table a fifth too large and eight
  percent to the side, on any display denser than 1× wider than 1600 CSS px, and never in CI.
- **And then the frame is photographed** (`scene/post.ts`, `scene/quality.ts`, `sceneQuality.test.ts`).
  The room is lit in the scene, and what the finishing passes add is, in this order: the
  **occlusion** (below), a last FXAA pass over the supersampling, the bloom (a bright pass at a
  quarter of the frame over the occluded frame, blurred twice, added back scaled by `rig.dark` and
  by `LOOK.vista.bloom` — a sun in the frame spills — plus a wide one at a sixteenth, and both
  added **after** the air: "A light is a light", below), a **lens focused on the table** (the far goes
  soft slowly, from twice the table's distance to forty times it, `LOOK.vista.dof`), the **mist**
  and the **air** (below), then the **tone curve** with the exposure (ACES by default), then the
  grade on the display range — the shade pulled towards a cool note and the light towards a warm
  one (the warm/cool split, kept through the curve), a touch of saturation and of contrast about
  mid-grey — a vignette elliptical with the frame, and a colour fringe out in the corners only.
  **No grain.** There was a fine static grain over the whole frame, and the player refused it on
  2026-09-25 along with every other fine noise on a surface of the game (the felt's nap went the
  same day): the pass, its `LOOK.post.grain` and its tier switch are gone, and
  `sceneQuality.test.ts` fails on a composite that noises the frame again. Every number is `LOOK`'s.
  - **The occlusion is screen-space, from the frame's own depth, and it is what the shadow map
    cannot see.** A doorway, the crease between two blocks, the foot of a wall. The scene target
    carries a float depth texture, and **a position is rebuilt through the camera's inverse
    projection** (`VIEW_PARS`: `uProjInv`, and back to a uv through `uProj`), which is exact under
    any camera; the sky (a depth of 1) is left unoccluded. The normal is the depth's own
    differences, the smaller of each pair so an edge does not smear it. Samples on a **uniform**
    hemisphere over two radii (1.8 tiles and 0.45), at a half of the frame, blurred depth-aware in
    linear depth — a tile of depth roughly halves the weight near the lens, a share of the distance
    far off, where a tile is less than a pixel — then **multiplied into the frame before the bloom
    and the focus copies are taken from it** (`litRT`). **An occluder more than the radius or so
    nearer than the sample is not a crease**: counted, a tree top over a paving stone drew a dark
    halo round every silhouette. The per-pixel rotation is interleaved gradient noise — the sine
    hash streaked diagonally at frame coordinates.
  - **The air** (`AirOptions`, `LOOK.vista.haze`): every pixel that is not sky takes, by its distance
    from the lens, up to `max` of the colour of the sky low down (`1 − exp(−d / distance)`), loses up
    to `desaturate` of its own saturation on the way, and **glows towards the light** (the light's
    colour by a power of the cosine to it, weighted by what the weather left of the body). The room's
    `haze` and the weather's scale it: the moon has almost none, so its far is as sharp as its near,
    which is what a place with no air looks like.
  - **Colour is the contract with the plain path.** The scene renders into a half-float target in
    linear, the passes work in linear, the tone curve is applied **once**, in the composite, with
    three's own functions, and the composite ends on `colorspace_fragment`, the same sRGB encoding
    `outputColorSpace` gives the direct render. When the renderer's curve is on, three prefixes its
    tone-mapping chunk to every shader drawn to the canvas; the composite includes the chunk only
    when it is not (`#ifndef`), because including it twice is a redefinition and a black room. The
    plain path (no finishing pass) gets three's own `Fog` in the air's colour instead of the air.
  - **It runs once, and everything it allocates is released with the context.** Every target is
    disposed in a `finally`, and a throw anywhere inside falls back to the plain render
    (`photographed`), never to no room. Every target is checked before anything is drawn into it
    (`assertComplete`, which throws on an incomplete framebuffer), and a GPU with no float render
    target (`floatTargets`) never starts the chain. A software GPU (headless Chromium) is handed
    the plain frame, unless tooling asked for the full one (`?gfx=force`), which is how `make rooms`
    and a `--gfx=force` visual review get it.
  - **Which passes run is the graphics tier's** (`QUALITY`): `high` supersamples up to 3× with a
    4096 shadow map and runs all of them; `medium` 2× with a 2048 map, the occlusion, FXAA, bloom,
    the mist and the vignette; `light` is the lit, shadowed (1024), multisampled frame with nothing
    over it. **Every tier is lit and shadowed**: the room is rendered once per match, so the light is
    never a frame budget. The tier is the player's (`hooks/graphicsPref.ts`, `autoTier` when it is
    `auto`), and **it is part of the cache key** so moving it mid-match renders the room again.
- **A room is built once per match, and it is built on the main thread, so what it costs is
  measured** (`render.ts` logs the view it solved and what the frame took, in DEV). A room is
  under a second of build and draw on a laptop; a skyline is what costs, which is why a far band
  draws fewer of its panes (`SkylineOptions.windows`) and none of its floors' glass (`ribbons`). **And
  it is built exactly once**, which took four separate guarantees:
  - **`viewportSize()` reads the window synchronously.** Solved from 0 × 0, the preload built a
    whole room round a felt with no size, which the real size then threw away — every match paid
    for its room twice, the second after the gate opened. `<SceneBackdrop />` refuses a felt with no
    size for the same reason.
  - **`safeAreaInsets()` reads them synchronously too**: the felt is solved from the viewport *and*
    the insets, and an inset filled in by an effect was a second render on every notched phone.
  - **A frame within four per cent of the size asked for is stretched, not re-rendered**
    (`sizeCloseEnough`, `sameFelt`). The gate, the screen it puts up and the board behind it each ask
    off their own element, and they agree to the pixel only when nothing sits between the element
    and the edge of the window.
  - **And a render in flight is joined, not repeated** (`prepareScene`, `sceneCache.test.ts`).

  `sceneLoadingGate.test.ts` owns the first three, `sceneCache.test.ts` the fourth.
- **`make visual` waits for the room.** The showcase's ready flag fires when the screen mounts, and
  the frame lands a build later; `tools/visual/shoot.mjs` waits for `.scene:not(.bare)`.
- **The engine is a lazy chunk.** `sceneCache.prepareScene` is the only importer of `render.ts`,
  through a dynamic `import()`, so three.js never reaches the home page, a waiting room or a content
  page; the map-loading gate is what absorbs the fetch (`sceneCache.PROGRESS`).
- **The loading bar is painted between the phases of the render, and that is what makes it a
  bar** (`scene/nextPaint.ts`, `sceneProgress.test.ts`). A report is followed by two animation
  frames, and `renderScene` is asynchronous in phases — build, merge, draw, then the sprites a few at
  a time — reporting `RENDER_STEPS` and yielding to a paint between each. A `setTimeout(0)` is not a
  paint: it fires inside the same frame, and the bar went from empty to full.
- **And it ends full.** Nothing under that bar ever reports one, so the settle puts it at one,
  paints it, holds it for `MAP_BAR_FULL_MS` past `.fill`'s own transition, and only then publishes
  `done`, which is what sends `map_ready`. Zero hold under reduced motion; 12s plus the hold stays
  far under the server's 20s `MapLoadTimeout`. `mapLoading.test.ts`.
- **A render that fails is a scene, not an error.** No WebGL, a lost context, a builder that
  throws, models that never arrive: the request resolves with a null bitmap, `<SceneBackdrop />`
  shows the rig's sky gradient, and the gate is answered. A failure is remembered for
  `FAILED_TTL_MS` (10s), never for the tab; a lost context is a failure, not a black room
  (`isContextLost()` and `OUT_OF_MEMORY` asked before and after the copy); the frame is copied out
  before the report's paint (no `preserveDrawingBuffer`); the models are given `MODELS_TIMEOUT_MS`.
- **Nothing pale is shown while the room is still being built** (`.scene.bare` mixes the hour's
  sky down over the void), **and nothing of the board is shown either: the curtain is opaque from
  its first frame** — the fade belongs to `.room`, never to `MapLoadingScreen`'s `.screen`.
  `sceneLoadingGate.test.ts`.
- **The board and the loading screen share the frame, and both draw it sharp**: the table is the
  render's table, and a blur between them would be the seam. The cache holds three frames, keyed on
  the scene, the device size **and the felt**, least recently used out first.
- **The backdrop isolates its own stack** (`.scene { isolation: isolate }`, `sceneBackdrop.test.ts`):
  its three z-indices would otherwise climb over `.stage` and paint the room over the cards.
- **A resize is a stretch, and then one render** (`RESIZE_SETTLE_MS`, 240 ms), **faded in over the
  frame it replaces, never swapped for it** (two stacked canvases, only the incoming one animated,
  `--scene-fade`). The camera is solved to the felt, so a felt that has moved needs a render whatever
  the width did.

### The models (`scene/models/`, `scene/placer.ts`, `tools/models/pack.mjs`)
A few props are drawn models — Kenney's kits and two Quaternius pieces, all **CC0**
(`client/public/models/CREDITS.txt`, `NOTICE.md`) — and the kit is what imports them. Seen from the
table most of a room is blocks: the models left are the marina's dinghy and bushes, the palms and
street lamps of the velvet boulevard, neon's planters (`maps/index.ts: KITS`).
- **The manifest is the allowlist** (`models/manifest.json`): per kit, the archive it comes from,
  the scale that turns its units into tiles, the palette colours that glow after dark, and the
  models used by name. `make models` copies exactly those into `client/public/models/<kit>/`; what
  is packed is committed. **Served from this origin, never a CDN**.
- **A model is baked into buffers, once per tab** (`models/lib.ts`, `bake.ts`): the palette sampled
  into vertex colours, the model scaled into tiles and stood on `y = 0`, smoothed normals kept for
  the outline hull. **And then it is a block**: `k.model` transforms the buffers, shades the foot,
  pushes the hull, and after dark sends the glow colours to the unlit bucket — a window kit per
  house by the hour's share (`spotChance`). `kitModels.test.ts` pins which way a drawn person faces
  (the townsfolk +z, the astronauts -z and `ASTRONAUT_MODEL_YAW`).
- **Nothing stands inside anything else** (`placer.ts`, `placer.test.ts`): every `k.model` claims its
  footprint and is refused when it is taken, **and a refused model leaves the spot empty**.
- **A room loads the kits it places and no others** (`KITS`, `roomModels.test.ts`, which builds each
  room through its camera and fails on a kit it loads and never places). Three rooms load none.

### What moves (`scene/life.ts`, `scene/LifeLayer.svelte`, `maps/vistaLife.ts`)
The room is rendered once and released, so nothing in it can move — and a room where nothing moves
is a photograph again. What moves is **a sprite over it**: a gull, a boat drifting across the bay, a
petal falling past the eaves, a puff of smoke from the tavern, an airship over the skyline, built
with the same kit under the same light, rendered to its own little bitmap **in the same pass as the
room**, and carried along a route by one Web Animations transform. The board's compositing budget
still belongs to the cards: an actor is one composited layer (`.actor`) under its route animation,
plus, only when it bobs, spins or puffs, an inner element under an animation of its own —
**one transform animation per element**, because two on one element do not add up. Reduced motion
holds every actor on its route's first point with nothing running, and **is followed live**.
- **A route is in the world, and the render projects it** (`Actor.world`, `render.ts:
  vistaSprites`). An actor is built standing at the world origin; the render builds it at the
  route's first point, **photographs it with the room's own camera cropped to its bounds**
  (`setViewOffset`), projects every point of the route into the frame (`Actor.path`, screen tiles)
  and writes the scale the change of distance asks at each (`Actor.scales`: the first point's depth
  over each point's). The keyframes carry the scale on the same transform as the translation
  (`routeKeyframes`), so a gull coming round towards the table grows as it comes and it is still
  one animation. A route that never enters the frame is dropped. The air is laid over a sprite as
  fog (`FogExp2` in the air's colour, at the air's density), so a boat on the far side of the bay
  is as grey as the water round it, and it goes through the room's tone curve and grade
  (`makeSpriteGrader`). A sprite casts no shadow and has no shadow map: nothing of the room is under
  it.
- **Keep a route clear of the near props.** A sprite is drawn over the whole frame, so a boat routed
  behind the lamp post passes in front of it (the marina's boat did, through the jetty's lamps). The
  routes are written in the sky and on open water, and across the far side of the bay; nothing
  walks the near ground. `sceneLifeOcclusion.test.ts` projects every route against every lamp post
  nearer than it, in four frames.
- **What hangs in the sky flies in front of everything that stands up into it, and is placed by
  the frame, never at a height in tiles** (`vistaLife.ts: skyAltitude`, `skyRoom`). Neon's blimp
  flew out past the spires at a fixed 70 tiles: drawn over towers nearer than itself and cut in
  half by the top edge of a wide frame, it read as **an unfinished building floating in the sky**.
  The band of sky is a sliver on an ultrawide (69px at 2560×1080) and a slab on a monitor, so an
  airship stands halfway down it and takes at most 0.6 of it (`airship`'s `maxTall`), in front of
  the first row of the skyline and clear of the palms, lamps and fountain that reach into the band.
  `sceneSkyActors.test.ts` checks every route slower than two minutes against every block nearer
  than it, and against the top edge, in four frames.
- **A `loop` either walks its closing leg or fades over it, and there is no third option**
  (`closesTheRing`, `sceneLife.test.ts`): a wrap the player can see is something teleporting home.
- **A boat sails bow first, one way, and never comes back** (`vistaLife.ts: driftingBoat`): it
  comes out of the haze and fades back into it (`BOAT_FADE` of the crossing at each end). It was a
  `bounce`, which sailed it home stern first across the whole bay after stopping dead; `turn` is no
  answer for a hull, which a `scaleX(-1)` flips on the spot. A boat too near to fade without
  reading as a ghost is **at anchor**: one point, and it only rocks.
- **A pass writes its opacity on every frame**, or it fades out across its whole crossing.
- **The layer is laid out in the frame's CSS pixels and scaled to the element**, one transform, at
  z-index 3, above both frames and under the weather (4): the rain falls on the boat.
- **A sprite is keyed on the actor's id within the room**, and its seed is the room's key plus that
  id, so the boat is the same for every seat and after a reload.

### The room is quiet (the pass of 2026-09-06, kept)
The rooms had been built to be *full*, and full was measured and found to be the wrong brief: the
verdict was that it was stressful, and that the mood the game wants at a card table is
**contemplation** — a place a spectator can rest their eyes on for twenty minutes, whose big moments
are the cards'. The view from the table was built to the same brief, and it is what gave it room to
breathe: a horizon and a sky are the quietest things a picture can hold.
- **A few things, slow, at the edges and in the sky.** Two framing props a side, one landmark a
  room, a couple of boats, two or three birds, never a crowd, and nothing crossing the table.
- **Windows are mostly dark after dark** (`WINDOWS_LIT_MAX`, a half, under every weather too), which
  is also what makes the lit ones read. The model houses answer the same share one at a time.
- **A round halo is a lamp head's, never a building's** (`HALO_SPHERE_MAX`, 0.8 tiles,
  `kitHalo.test.ts`): an additive sphere over a tower is a pale veil laid over it.
- **And it has no edge** (`fadeToRim`): bright where it faces the table, nothing at its rim, baked
  into its vertices since the frame is taken from one place. A flat translucent sphere was a pale
  disc pinned over each lantern, a frosted globe and not a glow. `sceneLights.test.ts`.

### A light is a light, not a coloured dot (`post.ts`, `kit.ts: lamp`, `sceneLights.test.ts`)
The pass of 2026-09-26 answered "the lights look like dots of colour", and four things each did it:
- **The air and the mist were laid over a lamp exactly as over a wall.** A light in the haze sank
  to a pale square the colour of the fog. The composite now reads how much of a pixel is a light
  (`LOOK.post.emitFrom` / `emitKnee`, a luminance, after dark only) and lets that much through the
  mist and the air (`pierce`).
- **The bloom was added before the air**, which took it away again. It goes on after: it is the
  light the air scatters towards the lens, so the air does not dim it.
- **The bloom was one tight width**: a rim round each light and nothing in the air round it. A
  second level at a sixteenth of the frame (`bloomWide`, `bloomWideSpread`) lays the wide glow,
  scaled by the hour's `dark` (the lamps' own) and thickened by the weather's air (`bloomWeather`):
  a lamp in the fog is a ball of light.
- **A drawn street lamp's bulb faces the ground under its arm**, so from the table the velvet
  boulevard was a row of unlit posts with a pool at each foot. `models/bake.ts: lampHead` finds the
  end of the arm and the kit hangs a bulb and a halo there, with the pool under the head.
- **The fog's veil is the colour of the light in it** (`WeatherLayer.svelte`'s `.veil`, the hour's
  horizon mixed in by `--scene-dark`), and the drawn banks thin after dark: a white veil at midnight
  made a milky noon and put out every lamp under it. Scene `game-map-velvet-night-fog`.

### Props that were the same mistake in every room (`scene/kit.ts`)
Each was one line of geometry standing in for something with a shape:
- **`awning`** — a canopy that starts *at* the wall and carries a valance, never a bare plate
  hovering off the façade.
- **`stall`** — four legs, thick enough to be seen, never a striped roof floating over a box.
- **`tree({ kind: 'palm' })`** — a frond in two segments, out and then steeply down.
- **A prism's `w` is its ridge**, so a roof rotated by `π/2` has to swap `w` and `d` with it.
- **The kit's crates and barrels are the pirate kit's where it is loaded** (green bottles in a red
  crate): a builder that wants a plain crate by the water draws its own boxes (Marina).

### The table (`GameBoard.svelte`'s `.tableOval` / `.tablePlinth` / `.tableGlow`, `TableTrack.svelte`)
A felt inside a rim, on exactly `tableRect()`, and **a table of its own in every room, made of a
noble material** (the pass of 2026-09-25): Neon a piano-black lacquer banded in chrome on a chrome
tulip foot, Rune quartersawn oak and bronze on two turned balusters, Velvet walnut burl and gold on
a stepped black marble column, Orbit brushed titanium on a tripod, Sakura vermilion urushi flecked
with gold on four lacquered legs, Marina varnished teak and brass on a capstan. `MapDef.table` in
`maps.ts` holds the colours (`felt`, `feltDeep`, `rim`, `rimLight`, `grain`, `base`, `inlay`,
`fleck`, `baseVein`) and names the rest (`rimKind`, `edge`, `pedestal`); `tableMaterials.test.ts`
refuses two rooms with the same table. Without a scene the variables fall back to the tokens'
near-black table.
- **The rim is its material, drawn** (`cards/tableSurface.ts`): an SVG whose only content is a filter
  — fractal noise shaped by a transfer curve into the material's own colours (growth rings, a
  burl's eyes, brushing, a lacquer's depth and its gold dust) — served as a `data:` URI, which
  `img-src 'self' data:` already allows. No canvas and no script, so the same string is the rim's
  background on the board, the racetrack's `<pattern>` and the rooms page's rim at build time;
  seeded, so every seat sees the same table. A glossy finish carries the room's lights in it
  (`rimGloss`: a sheen on the far side and a few streaks, tinted by the hour, weighted by
  `RIM_GLOSS`).
- **The felt carries no texture at all**, by the player's choice: its cloth is its colour and the
  light on it.
- **In a room the render is the table, and the CSS one is the fallback** (the pass of 2026-09-25,
  "the tables must be much more realistic"). The CSS table was a drawing laid over a lit room: its
  felt ignored the room's light, its rim was a flat band with a painted sheen, and it cast nothing
  on anything. The render now builds the top as well (`vistaTable`): the **cloth** (a
  `MeshPhysicalMaterial` with a sheen and nothing drawn on it, `LOOK.table.cloth`), a **metal
  filet** and a **racetrack** in the rail's material stained darker, and a **rail** with a rounded
  section rising `LOOK.table.rail.height` over the cloth and rolling over into the edge's face.
  The board then draws none of its own (`.tableOval.rendered`, no `TableTrack`), only the mark.
  - **The lines are still the concentric ellipses the player chose.** Each ring of the top is the
    felt's screen ellipse taken in by the same number of pixels on both axes and cast onto the
    table (`View.tableOutline(n, inset)`), and the rings are lofted into one surface
    (`Kit.loft`), point `i` of every ring at the same angle. Vertical faces stay vertical: a ring
    is cast onto the table's plane and then lifted.
  - **Widths are board pixels** (`FeltAnchor.unit`, carried into the view as frame pixels per
    board pixel), and the rail plus the track is exactly `layout.ts: CLOTH_INSET`, the line the
    opponents' hands are laid inside. The rooms page's still has no board, and takes a felt 1100
    board pixels wide.
  - **A table has a lamp over it** (`lighting.ts: makeTableLamp`, `LOOK.table.lamp`): a warm
    spot straight down from 3.4 m, fading from the middle out over its whole cone, stronger as the
    room darkens (`LightRig.dark`). Without it the cloth was **black** at dusk — lit only by a sun a
    few degrees up and a violet sky — and so had the old cloth plate been, under the CSS felt that
    hid it. No shadow: the sun's is the one map, and the corner where the rail meets the cloth is
    the occlusion's.
  - **A loft is wound the way its normals face, per triangle** (`loftGeometry`). A two-sided
    material lights a face wound against its normals from behind: the first cloth came out black
    under the lamp for exactly that. `tableMaterials.test.ts` checks every triangle. A ring drawn
    in to a point (the cloth's middle) takes the next ring's outward way, or its normal is zero and
    the middle of the table is a dark disc.
  - **The render is the table only while it lies under the felt** (`sceneCache.tableFits`,
    `SceneBackdrop`'s bindable `tableDrawn`): a frame stretched through a drag the felt follows in
    proportion still is; one the felt has left (a seat gone, a drag past the caps) is not, and the
    CSS table stands in until the next render lands. With no WebGL, or in the E2E suite, it is the
    CSS table throughout.
  - **Rain's rings do not land on the cloth** (`WeatherLayer`'s `clear`, a mask with the felt's
    ellipse cut out): laid over the table they read as a pattern printed on it. The streaks still
    fall in front of it.
  - **The hands lie on the cloth, never across the rail** (`rimLayout`): a hand is set in from the
    rim by `CLOTH_INSET` (unforeshortened, since the rail is as wide on every side) plus its own
    reach, and then drawn in towards the middle until every corner of the fullest fan it can show
    is inside the cloth's ellipse — a wide fan spreads along the rim while the rim curves away
    under it. Neighbours' spread is measured where the hands lie, not between the plates.
    `seatLayout.test.ts`.
- **Every line round the table is an ellipse concentric with the felt**: the rim is a uniform 11px
  border (its inner edge is the felt's ellipse taken in by 11px on both axes), and the racetrack
  (`TableTrack.svelte`, `tableTrackEllipse`) is the same construction a rim further in — a band of
  the rim's wood stained a shade darker between two metal filets, the way a card table carries one.
  Two other constructions were tried the same day and both read as a table bent out of shape: an
  **offset curve** (the same distance from the rim along the normal) is not an ellipse, and on a flat
  oval its ends come to points; and bands **drawn in the table's plane and foreshortened** had a gap
  between two lines that swelled at the sides and vanished at the near and far edges. What the
  player judged right was the concentric one, the way the rooms page had always drawn its rim.
  Foreshortening is kept for what lies *on* the cloth (the mark, `feltSquash`), which has no oval
  to disagree with.
- **The render's edge is swept, turned and finished, not blocked** (`scene/maps/vista.ts:
  vistaTable`, `kit.ts: Kit.sweep` / `Kit.lathe` / `Finish`). The edge is a profile (`EDGES`: a
  knife edge, a square slab, an ogee, a bullnose) swept round the outline, never past it; the
  pedestal is turned (`LatheGeometry`); each piece is a `MeshPhysicalMaterial` — a varnish or a
  lacquer as a clearcoat, metal as metal, marble polished — whose numbers are `LOOK.table` and whose
  grain is `scene/grain.ts`'s periodic noise, the counterpart of the CSS rim's for faces the CSS
  cannot reach. It is the one object in the room that is not a block in the matte vertex-coloured
  material, because it is the nearest thing to the camera and made of what a matte block cannot say.
  It takes no ink hull and no snow cap. **The reflections are held down** (`LOOK.table.envIntensity`
  0.3, a wood's clearcoat at half its gloss, a lacquer's at 0.18): at 0.8 the dusk sky turned a
  walnut edge into orange plastic, and a full clearcoat washed Sakura's vermilion urushi to grey.
- **The materials never follow the hour; the light does.** `--tbl-*` are constants per room; the rig
  hands the table `--scene-tint` (the sun's colour on the sheen) and `--scene-dark` (a dimming).
- **In a room the outline rule bends for the table as it does for every block**: the rim's edge is a
  darker note of its own material, never the interface's ink (`kit.ts: inkFor`). Without a room the
  CSS carries the whole object and the three rules as before: the ink line, the hard `0 16px 0`
  thickness, the soft shadow, and `.tablePlinth`.
- **In a room the render carries what is under the felt**, including its real shadow, so the CSS
  draws neither a thickness band nor a cast shadow over it: either hid the one thing the render
  adds.
- **The rooms page lays the same table over a photograph of the render** (`content/TablesArticle.astro`,
  `.roomTable` / `.roomGlow` in `content.css`, `src/dev/RoomStill.svelte`, `tools/rooms/shoot.mjs`,
  `roomsPage.test.ts`). `make rooms` opens the `room-still-<id>` scene for each room — the room alone
  at its signature hour under a clear sky, 16:9, at `?gfx=force` — with the table built under
  exactly the ellipse `.roomTable` draws (centred, 70% by 50%), and writes
  `src/assets/rooms/<id>.webp`. The hour is written twice — `SIGNATURE` on the page, the scene list
  in `scenes.ts` — and the test pins the two. Re-shoot after touching a builder, the kit, the rig or
  the passes.

### What shines and what reflects
- **A surface has a gloss, and a matte one is exactly what it was** (`BlockOptions.gloss`;
  `kit.ts: litMaterial`; `sceneGloss.test.ts`). The room's one lit material mixes its roughness
  towards `glossRoughness` by the vertex's gloss and mirrors the sky (`skyEnvironment`) — **the
  reflection only**, its irradiance dropped and its radiance weighted by the gloss, so a block at
  gloss 0 comes out pixel for pixel as it did. Glass, paint, and every slab under rain.
- **The water mirrors the room, and so does a wet street** (`scene/mirror.ts`, `BlockOptions.water`,
  `sceneGloss.test.ts`). The room rendered once more **flipped about the water's own level**
  (`scene.scale.y = -1`, `scene.position.y = 2 · level`) from the same camera *is* its reflection in
  that plane, pixel for pixel — the one plane a perspective reflection is exact for — and a surface
  reads it at its own `gl_FragCoord`. What lies under the water is clipped out of that pass. **Looked
  across, the water is a mirror at the horizon**: the reflection's weight climbs from `reflect`
  (0.12, looked straight into, where the sea is its own colour) to one at a grazing look (Schlick's
  Fresnel, `uFresnel`), and **the swell breaks a reflection into a column down the frame**
  (`LOOK.water.stretch`), which is the road of light under a low sun or the moon. The pass runs at
  half the frame, only where the tier says (not on `light`) and only where the room has water or a
  wet street (`Kit.reflective`). **In the mirror pass a face turned up is discarded** (the underside
  of a slab, flipped); **the halos sit it out**; the sky only tints the water (`LOOK.water.sky`).
  A wet street's reflection is **smeared down the frame and a little across, jittered per pixel**
  (`streak`), so a row of lit windows is a glow of their colour and not a second row of windows.
- **A lamp lights the ground; it does not paint a disc on it** (`scene/pools.ts`, `Kit.pool`,
  `scenePools.test.ts`). A lamp-sized flat halo is a pool splatted into a map of the ground seen from
  above, which the lit material multiplies into the fragment's own colour, full up to `lift` above
  the ground and fading above it. **A halo past `washFrom` stays the room's wash**, and a sprite
  keeps its disc (`lightPools` is a room kit's only). A pool is weighed by the hour's `dark`.
- **Mist lies out over the water and the fields at a dawn and in a fog, never on the lens**
  (`post.ts: mistFor`, the composite's `worldAt`, `LOOK.mist`, `sceneMist.test.ts`). The composite
  rebuilds each pixel's world position and lays the mist by its height over the ground
  (`exp(−y / height)`, five metres) in banks, **starting `near` (22) tiles from the lens and full
  four times as far**: the first cut laid it by the frame's height, as the old view's far streets
  were, and at eye height it put a milky veil over the deck the table stands on. A clear dawn has
  it, a cloudy dawn a little, a fog at every hour.
- **The weather leaves marks** (`sceneWeatherMarks.test.ts`). **Rain lands in rings** (`splashRings`),
  sheets that come and go in place, resting at nothing. **Snow banks against the foot of every
  wall** and caps every flat top.
- **Every room has a light of its own** (`LOOK.rooms`, `lightRig(time, weather, room)`): its sky,
  its sun and its body where the room's composition asks, the sun and the sky light pulled towards
  its own colours, the sky light scaled, the shadow hardened, its own split tones and saturation,
  its air. The moon has almost no air, a hard white light and the Earth; neon's night is violet
  with its own light low down; the hotel is brass; the harbour teal in the shade and sand in the
  light; the village a gold a little older than the day's; the cherry trees a pink in the
  highlights and a clear spring noon. **None of it may undo the warm/cool split**, which
  `sceneLighting.test.ts` runs per room as well as per hour.

### Reviewing a room
Scenes `game-map-<id>` (one per room at its signature hour) plus `game-map-<id>-<variant>` (the hour
or the sky that changes the room the most) and `game-map-loading`. **These are the only place a room
is reviewable without a server dealing a match, and what `make visual` shoots is exactly what a
match draws.** Review at `--viewports=wide,small,landscape` and a portrait phone: the camera is
solved per frame, so a phone is a different lens on the same room, and a phone on its side has the
horizon at the top edge. Check that the body is in the sky band and clear of the seat pills, that the
far ground is not hidden by the middle, and that nothing in the near ground crosses the felt. Judge
on the real GPU (`channel: 'chrome'` with `--enable-gpu --ignore-gpu-blocklist --use-angle=d3d11`)
or at `--gfx=force`: headless Chromium's software GPU is handed the plain frame otherwise. When
something in the frame has no geometry behind it, `?lookPatch={"debug":"lit"}` or `"depth"` says
which pass drew it.

## Card face (`CardArt.svelte`, `cardArtSpace.ts`, `locoMark.ts`, `cardTheme.ts`)
Reproduced from the brand's own card art. Review any change to it with
`make visual ARGS="--scenes=card-sheet"` — the whole deck on one screen, which no gameplay scene
shows.

- **The finish is the room's light on card stock, and it is the one thing on a face that moves with
  the room** (`Card.svelte`'s and `CardBack.svelte`'s `::after`, the pass of 2026-09-25, asked for
  as "the realistic look of a photographed card"). A gloss band struck across the face at the angle
  the light comes from (`--sun-dx`), in the light's own colour (`--scene-tint`), plus the stock's
  thickness as two hairlines — the top edge catching the light, the bottom one turned away. It
  weakens as the room darkens (`--scene-dark`) and **never dims the face**: the face follows neither
  the palette nor the hour, the light on it does. Off the board every variable falls back and the
  card is lit by plain white. **No blend mode, no filter, no opacity** — a blend mode promotes every
  card on the table to a layer of its own. `card.test.ts` reads the rule off both sources. Realism
  stops there on purpose: a photographed card (texture, soft shadows as structure, a second
  rendering of the face) is refused by the art direction, not by taste.
- **The piles cast a contact shadow on the felt** (`Deck`'s `.laid::before`, `DiscardPile`'s
  `.contact`), the way the room's sun casts the table's (`--sun-dx` / `--sun-dy`). Soft, and allowed
  to be: it is ambience grounding the pile, while the structure is still the ink outline and the band
  of edges.
- **The face is CSS; the mark is a shared mask image; only the rule glyphs are still SVG.** Face,
  watermark and wild fan are all laid out in the same `1000x1500` space, expressed as percentages of
  the card box, and the two are both 2:3, so the mapping is uniform and a CSS rotation lands where the
  SVG one did.
  - This used to be one `<svg>` per card, and it was **the board's single biggest rendering cost**. A
    busy table carries ~50 card faces and backs at once (hand, both piles, every opponent's mini fan)
    and most of them sit under a scale animation, so each one re-filled the mark's 130-odd even-odd
    segments under a gradient, every frame. Measured on the showcase, median of five runs: Firefox
    compositing in software went **3.0 → 9.8 fps** on a full hand and **4.7 → 14.9** on a map, i.e.
    2.3–3.3× depending on the scene. Chromium throttled 6× on CPU went 55 → 59 and sat on the vsync
    ceiling elsewhere, because that throttle constrains script far more than raster, which is why it barely
    registers a raster fix. The win is a cache: `MARK_MASK_URL` is **one string for the whole app**,
    so the browser rasterises the path once per used size and every card composites the same bitmap.
    Build it per card or per suit and the cost comes straight back.
  - `card.test.ts` guards both halves: no live `<path>` carrying `LOCO_MARK_PATH`, and one mask URL
    across every suit. Nothing else in the suite can see this regression happen.
  - **An `objectBoundingBox` gradient is `to top right`, never the angle of the diagonal.** The two
    differ on any non-square box: SVG lays the gradient out on the unit square and *then* stretches
    it onto the box, so its colour bands stay parallel to the other diagonal, which is exactly what
    CSS's corner keyword does. An explicit angle keeps its bands perpendicular to itself and swaps
    the two off-diagonal corners. This shipped wrong once and only `make visual` caught it.
- **The card box and the mark box are two different boxes** (`cardArtSpace.ts`). The card box has the
  card's proportions; the mark is landscape. Reusing the mark's viewBox as the card's — which the
  previous portrait mark got away with — stretches the drawing to the card and turns the duck into a
  goose. It lives in its own module so `CardArt.svelte` exports components only (same reason as
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
- The crop applies to the **shape alone**, because it lives inside the mask. The gradient underneath
  never leaves card space, so both gradients span the same line on the card by construction and the
  reversal below is simply the same angle with the stops swapped. (As a filled path it was not: the
  mark's gradient lived in the mark's own space and its axis had to be the card's axis mapped back
  through the crop, inverse rotation included.)
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
  **That argument does not stop at the card.** It was written here, tested on the card by
  `card.test.ts`, and then the rules copy went and named the same two cards `Échange (⇋)` and
  `Rotation (↻)` — the exact characters this line rejects, four bullets below five siblings that
  name their card in words alone. The parentheses are gone: Swap and Global Switch are the two cards
  a first-timer has no slot for, and the answer to that is the "Cards" tab beside the bullet, where
  the face is drawn. The rule is enforced across every surface now, by `drawnGlyphs.test.ts`.
- **The four ways a match ends are drawn too** (`components/OutcomeMark.svelte`, one component at two
  sizes). It was 🏆 / 😔 / 🏳️ / 🚪 in a nested ternary at the head of the game-over card, which is
  the one frame in this game most likely to be clipped for a stream and was the only part of it
  nobody here had drawn. An emoji is rendered by the reader's OS — `🏳️` carries a variation selector
  that Windows, Android and iOS resolve differently — so it arrives at a weight and a hue nothing
  chose and takes neither the ink outline nor the hard bottom shadow.

  The replacements are in the game's vocabulary, not a picture library's, and each one is the thing
  it is about rather than a symbol for it: **winning is the mark itself** in `--color-secondary`, the
  gold the scoreboard and the evening recap already win in; **losing is the cards still in your
  hand**, drawn at the trim as a held fan, which is literally what lost the round; **a forfeit is one
  card face-down**, filled rather than outlined because it is the one object on that screen
  deliberately opaque, with an arrow when the seat that walked is ours. No trophy, and **no face**: a
  sad face tells the player how to feel about a hand of cards, and it is the one drawing here that
  could not survive being read by somebody who just lost. `size="sm"` puts the same win drawing on
  the round summary's winner line — one event at two scales — and it holds still there, because a
  glyph that bobs inside a line of type takes the sentence with it.
  `hasGlyph` (in `cardTheme.ts`, so `CardArt.svelte` exports components only) lists the kinds that get
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
- The face does **not** follow the interface's palette. A card is a physical object.
- `CardBack` is the wild card's face plus the **same cropped, tilted mark every face carries**, in
  all four suits at once — the one place the full palette appears. The paint is what makes it a back;
  the framing is a card's, like everything else in this space. It briefly also carried the whole mark
  on top and showed the duck twice at two different angles, which reads as a rendering bug. It drops
  the art below `ART_MIN_W` (26px) and carries an inner light rim, without which a mini fan of eight
  backs merges into a single black bar.

## Card rendering layer

Svelte throughout, and the movement is the browser's: `Card.svelte`, `CardArt.svelte`,
`CardGlyph.svelte`, `CardBack.svelte`, `SuitMark.svelte` and the glyph geometry as data in
`cardGlyphs.ts` for the face; `Hand`, `DiscardPile`, `PlayerSlot`, `TurnIndicator`, `AnimationLayer`,
`GameBoard`, `GameView` for everything that moves them. There is no animation runtime any more —
flights are `element.animate` through the `use:play` action in `AnimationLayer.svelte`, and the fan's
reflow is a CSS transition. The bridge that mounted a Svelte face inside a JSX tree is gone with the
tree; `setNode` survived it, because handing the node back is still how the flight layer gets the
real element.

> **Two things bit during the port and will bite again.**
> **Svelte keeps a whitespace text node where JSX dropped one**, so a card laid out one element per
> line reads as `"     L"` instead of `"L"` and `card.test.ts` fails on the corner mark — the
> children of `Card.svelte` and `CardArt.svelte` therefore run together with no line breaks, on
> purpose. And **a `<script lang="ts">` keeps its imports after type-stripping**, so a type imported
> as a value reaches the bundler and `protocol.ts` (generated, types only) is asked for a runtime
> binding it does not have; every such import is `import type`.
- `<GameBoard />` is the root; it tracks container size via `elementSize` (ResizeObserver) and passes width/height to children that absolute-position in pixel coords.
- Layout helpers (`src/components/cards/layout.ts`): `clockwiseOpponents`, `opponentBubblePositions`, `calcHandSlots`, `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys` — all pure, reused by tests and animations.
- Animations live in `<AnimationLayer />`: an array of `Flier` items (flying card faces or backs) plus `EffectText` floats. Each entry self-cleans on its animation's `finish` → parent `removeFlier`/`removeEffect`.
- Animation triggers (inside `<GameBoard />`), in effect-declaration order:
  - **Opponent play**: keyed on `lastPlay.at`; flies the card from `seatPosition(actor)` to the discard with `arcHeight`. Skipped when the actor is the local player. Sets `suppressNextDiscardFx`.
  - **Card play (own)**: `flyCardFromHand(card, idx)` computes the source slot from `calcHandSlots` and spawns the arced hand→discard flier. Sets `suppressNextDiscardFx`. **It only runs once the play is committed** — `props.onCardClick` returns a boolean ("did the card leave the hand?") and the flier is spawned only on `true`. A tap the client refuses (`clientMayPlay`/`clientMayInterrupt` say no) animates nothing: flying the card out and snapping it back reads as a bug, not as "illegal card". Plays confirmed later (wild colour, swap target) fire it through `flightRef` — a `GameBoardHandle` the `<ColorPicker />`/`<PlayerPicker />` callbacks in `GameView` call after `onSend`.
  - `GameView.handleCardClick` also refuses to open a picker for a card `clientMayPlay` rejects — prompting for a colour and then having the server reject the card is the same broken promise as the animation. **The check runs before the prompts, not after**, and that order is the whole rule: the three wilds always match, so gating them changes nothing, but **Swap is a coloured card** and follows ordinary matching. Behind the prompts, an off-colour Swap was the one card in the deck that asked for a target, took the answer, and *then* came back refused with "illegal card play" — every other unplayable card ignores the tap in silence, so it read as the card behaving differently rather than as an illegal play. `realtime.test.ts` covers both branches (refused Swap opens nothing, playable Swap still prompts).
  - **Discard top change (any source)**: `suppressNextDiscardFx` suppresses **only the generic pile flier**, never the SKIP/REVERSE/+N callout — playing your own Skip must announce itself too. Callout text from `effectFor(card, pendingDraw)`.
  - **Hand grew by 1**: deck→last-slot card-back flier (draws).
  - **Swap / GlobalSwitch**: trails spawned on `swapNotice.at` change.
- Hover lift (`Hand.svelte`): a stiff spring per card on `.lift`, `scale(1.08) translateY(-14px)` under the pointer with the slot's tilt undone, the neighbours stepping aside (client.md, "The hand's hover").
  **The hover is a mouse's and nobody else's**: `.hovered` is set on `pointerenter` gated on
  `pointerType === 'mouse'`. It was `mouseenter`, which a touch screen synthesises on the tap and
  never follows with a `mouseleave` until the finger lands somewhere else, so a card tapped and
  refused stayed lifted and straightened over the fan for the rest of the turn — the "it puts a card
  forward and it stays like that" of the bug report. A finger gets the press (`.slot:active`) and
  nothing else, and the platform's grey tap wash is off the card (`-webkit-tap-highlight-color`).
  `handTouch.test.ts`; same rule as the deck's `@media (hover: hover)` below.
  **The turn pill's reserve is that transform written out** (`layout.ts: turnPillPlace`, `TURN_PILL_H +
  REST_LIFT + HOVER_LIFT + CLEARANCE`, where `HOVER_LIFT = 14 × 1.08 + 0.04 × CARD_H`). It was a
  flat 58px, which cleared the 9px rest lift and nothing else, so a card under the pointer put its
  top ~20px into the pill. Change the hover and the reserve follows; change the reserve by hand and
  it stops being true.
- **The card's transition is `transform` alone.** It also tweened `box-shadow`, and nothing the
  hover does moves the shadow — the one shadow change a card in hand ever sees is the playable
  glow, which flips for the whole fan at once on a turn change and was being tweened on every card.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`, `PlayerSlot .slot`) is pinned at `left:0;top:0` in CSS and positioned by a `translate()`. Animating `left`/`top` runs layout every frame and visibly stutters once several cards move at once.
- **A node's transform has exactly one owner.** A node whose transform a keyframe animates must not also have one set in CSS, and vice-versa. Where a static offset is also needed — centering the effect text, centering the turn indicator — use an outer anchor div for the CSS transform and an inner node for the animation (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card` for the same reason.
- **Layout math is radians; CSS `rotate()` is degrees.** Convert at the render boundary with `radToDeg` (`cardTheme.ts`). Passing radians straight through silently flattens every rotation.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (card flights, as control points because that is what `element.animate` takes) and `DEAL_STAGGER_MS`. The fan's reflow curve lives in `Hand.svelte` beside the rule that uses it.
- **Hand keys come from `handCardKeys(hand)`**, not the array index — occurrence-numbered card identity. Index keys make a keyed block reuse the wrong node when a card leaves the middle of the fan, so the survivors snap instead of sliding into the gap.
- `Hand` staggers cards in only when the hand grows **from empty** (a deal). Any other growth is a draw, which already has its own deck→hand flier.
- `DiscardPile`: 3 solid edge layers (the deck's depth) (`--card-edge`, the pile's near side once laid) + 2 static neutral under-layers for pile thickness (deliberately untinted — the active-colour ring owns the colour there) + top card keyed on `cardKey(card)` so each new top card remounts and replays a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` is set by `applyCardPlayed` and exists **only** for animation. Never read it for rules decisions.

### The turn clock (`GameView`'s `.turnTimerBar`, `tokens.css`'s `loco-slide`)
The only place the remaining time is written down, read from across the room and from the seat
opposite alike, so it stays a full-width strip flush with the safe top edge — the chip row and
the round badge start 12px lower, so the two never meet. It used to be a 6px band of raw colour
with a `currentColor` glow, emptied by a `scaleX` that squashed its rounded end into a sliver as
it went, and coloured by three hex values typed into the keyframes. Now:
- **The track is a slot, the way a dead action-bar button is**: `--color-surface-sunken`, a hard
  shadow inside its top edge, a hairline under it, so the bar sits *in* something rather than
  floating on the room.
- **The bar is drawn back out of it** (`loco-slide`: `translateX(0)` → `translateX(-100%)` on
  the whole fill, the track clipping) rather than scaled flat (`loco-drain`, which survives for
  anything that wants it). Same one compositor-side transform, same `--drain-ms` /
  `--drain-delay` written by `drainBar`, and the rounded leading edge stays round: a bar being
  drawn back reads as an object, a rectangle being flattened reads as a bug in the renderer.
- **It is a raised object at a size where an outline would be half of it**: a gloss along the
  top and a shade along the bottom in place of the ink line, and a bright cap on the leading edge
  (`::after`, a white gradient) so the eye has a tip to follow and the heat reads on the tip too.
- **The heat is the palette's** (`loco-drain-heat`): indigo while there is time, amber past
  halfway, LOCO Red in the last quarter — orient, warn, act — as `background-color` on the fill,
  which is what lets the gloss and the cap stay on top of it. A colour written out by hand at a
  call site is the bug, and the keyframes were three of them.
- The catch capsule's fill takes `loco-slide` and the gloss for the same reason, and keeps its own
  paint: five seconds is not long enough to report a trend.
- Reviewed with `--motion` at 2, 9, 15 and 19 seconds of a 21-second turn on `game-my-turn`, and on
  `mobile`, where the strip runs under the notch and above the badges exactly as before.

### Cues stay on the compositor
A cue that runs for as long as a state lasts — a catch window, a pending stack, the whole match —
may animate **opacity and transform only**, on a pseudo-element if the thing it decorates has to
keep its own paint. Anything else is a repaint per frame for the life of the state, and the audit
of 2026-09 found five of them, every one on the surfaces a reaction is aimed at:

- **The armed halo and the penalty pulse** (`ActionBar.svelte`) were `box-shadow` keyframes on the
  button, infinite — a shadow repainted every frame of every catch window, on the one control the
  game asks to be answered fastest. Each is a `::before` now with a *static* shadow or border,
  breathed on opacity and scale. `::before`, because `::after` is the 44px `.hit-target` on the LOCO!
  chip and the two are armed together; `z-index: -1` inside the button's own stacking context
  (`.armed` sets one, `.btnPenalty` takes `isolation: isolate`) puts the glow under the label and
  over the fill. **`.btn` no longer clips its overflow** — that `overflow: hidden` was cutting the
  LOCO! chip's 44px catcher back to its 34px paint, and it would have clipped the halos too.
- **The penalty throb** (`TurnIndicator.svelte`) was `filter: brightness()` keyframed on the pill.
  It is a white wash on `::after` at 0 → 0.18 opacity, same look, and the pill's transform stays the
  fly transition's alone.
- **The deck's glow** (`Deck.svelte`) was a transitioned `filter: drop-shadow()` on the pile, which
  re-rasterises four card backs per frame of the fade, twice a turn. A `::after` box shadow under the
  pile (on the laid node, whose transform makes the stacking context; `z-index: -1` on the glow), faded on opacity. **Hover is
  behind `@media (hover: hover)`**: a touch screen synthesises `:hover` on the tap and keeps it, so
  the pile stayed lifted and lit after the draw, a deck that looked pressable on a turn that was over.
- **The direction arrows** (`DirectionRing.svelte`) once were ten chevrons each carrying a
  `filter: drop-shadow()` under an infinite opacity chase — ten blurs a frame for the match. What
  replaced them turns as one element's `transform`, composited: never a repaint.
- **`will-change: transform` is kept where something moves every play and nowhere else.** The
  hand's slots keep it (they reflow on every card). `PlayerSlot` and `DiscardPile .top` lost it: a
  seat glides a handful of times a match and the top card settles once, and the browser promotes an
  animating element for its duration on its own — a permanent hint was a layer per pill and per
  pile held in memory for a movement that was not happening.
- **A scrim held over a live board is a colour, never a blur.** `RoundSummary`, `ScoreTable`'s
  `.overlay` and `GameView`'s `.reconnectOverlay` all ran `backdrop-filter: blur(5px)` over a table
  that keeps animating underneath — the summary for up to eight seconds *while the next round is
  dealt under it*. A backdrop filter re-rasterises the viewport on every frame anything behind it
  moves. They wear `--color-scrim-heavy` now, dense enough to own the screen without the filter.
  The pickers and the rules modal keep their blur: up for a decision, not held open over a read.

### Card rarity & the throw (`cardTheme.ts`)
Presentation-only tiering, invented here and never consulted by `game/`. `cardRarity(card)` follows
scarcity in the deck: number = `common` (72 cards), coloured action = `rare` (28), any wild =
`legendary` (12). A number is two thirds of every hand — dressing up the routine play leaves nothing
to escalate to when a wild drops, which is the whole reason the tiers exist.

- **`flightFor(card)` is the single source of flight timing.** One pure function feeding all four
  callers — hand→pile, seat→pile, the generic pile refresh, and `DiscardPile`'s reveal delay. They
  must agree or the pile shows the answer while its own card is still crossing the table. None of the
  four stores the delay: they each read `flightFor(card).duration` at the point they need it, which is
  what makes the agreement structural rather than a convention somebody has to remember.
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
  `flightFor(card).duration`, except for the first card it ever shows (opening discard, or a board rebuilt after
  a reconnect) — nothing flew there, and waiting for that flight blanks the pile for half a second.
  Same reason the SKIP/REVERSE/+N callout takes a `delayMs`.
- `AnimationLayer.Impact` is the shockwave ring, tinted `ACTIVE_RING[card.color]`, fired by
  `GameBoard.landCard` for rare/legendary only. A legendary also kicks the board — via the **`translate`
  property, not `transform`**: `.stage`'s transform is the board scale, and a WAAPI transform
  animation would override it mid-kick and resize the whole table.
- **Rarity is read in the flight and the impact, never on the face.** `Card.svelte` carries no
  per-rarity treatment at all: its only classes are `.card`, `.card.playable`, `.card.shadow`,
  `.interactive` and the corner variants. A shine or foil run across the face desaturates the suit
  colour, and suit colour is what has to survive stream compression, so `.card.playable` stays the
  one visual override a card in hand gets: "you can play this" is information and outranks flavour.
  - This paragraph used to describe a foil system (`.foil`, `.glint`, `holoOffsetMs`,
    `.card.playable.legendary`) of which **nothing exists in the code**. Checked 2026-08-01: none of
    those four identifiers appears anywhere under `client/src/`. It is exactly the failure mode the
    "Testing" section names, an invariant asserted with no test behind it.

### Reduced motion
- **The switch is `:root[data-motion="reduce"]`, never a media query.** `initMotion()` writes it
  before the first paint from the system setting *and* the player's answer, so the choice can win in
  both directions; `reducedMotionCss.test.ts` fails on any new
  `@media (prefers-reduced-motion: reduce)` block. There is no animation runtime to configure any
  more: the attribute drives the stylesheet, and the two WAAPI shakes and the transitions ask
  `prefersReducedMotion()` themselves. Full reasoning in `docs/notes/client.md`.
- When adding motion, verify it degrades to a readable static state rather than disappearing.
- **A callout collapsing to zero is a callout that never paints.** `AnimationLayer`'s `play()`
  answers reduced motion with a zero-length animation, which is right for a flight (the card is
  simply already there) and was wrong for SKIP / REVERSE / +N and the colour a wild named: they
  finished in the frame they started, invisible to exactly the player who had asked for a board they
  could read. A spec may carry a `still` — the frame to hold and for how long (`EFFECT_STILL_MS`,
  900) — played at the spec's own **delay**, so the colour callout still lands
  `COLOR_CALLOUT_DELAY_MS` after the card's under reduced motion too.

## Player bubble (`<PlayerSlot />`)
- Chunky sticker pill positioned by `seatLayout(...)` (see "Seat layout"), clockwise from the local
  seat. Size is `full` / `compact` / `mini` — the component mirrors `SEAT_DIMS`, it does not choose.
- Active turn: gold gradient fill + glow ring + bobbing arrow above the pill, dark label. It is the
  brightest object on screen on purpose — a viewer must never hunt for whose turn it is.
- Card-count badge on the pill's right edge; it turns red and pulses at exactly 1 card.
- Disconnected: muted fill and a softened outline, the drawn ✗ beside the name — and **the ink is
  not faded**. It was `opacity: 0.72` on the pill *and* `--color-muted-soft` on the label, which
  multiplied out to 2.31:1 on the seat whose absence is the news; the label is `--color-muted` now,
  4.5:1 on the dimmed fill. Quiet is a hue.
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
- **The table is near-black.** It used to be green felt, which fought the deck: a
  `#00ff6d` card on a `#1fbf8f` table loses its edge, and a card losing its edge is the one thing
  that must not happen. Dark also makes the table the stage and the cards the only bright objects on
  it. The mark is branded into the felt at 7% — the piles sit on top of it, so anything more is a
  table you have to look past.
- A near-black card back on a near-black table is 1.3:1 and its ink outline is as dark as both, so
  `CardBack` carries a **light inner rim**. Without it the deck has no edge and an opponent's mini
  fan is one black bar.

## Streamable moments
- **Interception slam** (`<InterruptBanner />`): driven by the server's `interrupt_success`, which
  the client used to ignore entirely. Store field `interruptFlash { actorIndex, count, at }`, set by
  `applyInterrupt`, cleared by the banner after 1800ms. Colour comes from `seatColor(actorIndex)`.
  `<GameView />` also shakes the board via the **Web Animations API** (not a CSS class — a class
  toggle would need a remount to replay, tearing down the board).
  - **The tilt and the sweep are two elements, and they have to be** (`.slashTilt` / `.slash`,
    `interruptHint.test.ts`). `skewY` moves a point vertically by its distance from the transform
    origin, so the band — skewed about its own left edge, a fifth of a screen off the left of the
    frame — arrived at the middle of the screen a hundred and forty pixels above where it was drawn:
    on a wide monitor the words came down on empty board with their band floating over them. The
    tilt now pivots about the centre, where the banner is; the sweep still starts at the left,
    because that is the gesture.
  - **The plate is a ribbon cut to the word, never a band across the frame.** It used to be a
    gradient fading out at both ends behind a dark rounded card with a glow: players read it as a
    dialog box, and it covered the very card that was slammed. A solid band across the whole frame
    replaced it and read as a screen transition rather than an object, so it was cut down: a
    ribbon a swallowtail wider than the title on each side, notched at both ends, in the actor's
    colour, an ink layer under the face (a `clip-path` takes a border with it) and the hard shadow
    as a `drop-shadow` on the pair. It lives **inside** `.banner`, so it takes the slam's tilt with
    the word and unfurls from the middle on a transform of its own. `interruptHint.test.ts`.
  - **Under reduced motion the ribbon stays** and only what travels goes (the unfurl, the speed
    lines, the punch): it is what the word is printed on. `interruptHint.test.ts`.
- **The three shouts share one relief and one tag, and differ by shape.** The word is white, a 5px
  ink outline, a stepped ink extrusion (`text-shadow` in hard steps, never a blur): legible on any
  seat's colour, since the interception's ribbon is in one. Who it is about rides a tag of the
  board's own chrome hanging off the bottom edge, **the name alone, ink on the plate**: a
  seat-colour dot beside it was tried and read as decoration. The shapes are the difference a
  muted clip reads: a **ribbon** (interception), a square-cornered **stamp** with the white rule
  inset inside its ink edge (Contre-LOCO!), a round-cornered **die-cut sticker** with a white
  margin between the red and the ink (LOCO!). None of the three carries a soft glow any more.
- **Where the three shouts land is computed, never a percentage** (`layout.ts: shoutLine`, published
  by `GameBoard` as `--shout-y` in screen pixels, read by `InterruptBanner`'s `.anchor`,
  `CatchBanner`'s `.anchor` and `GameView`'s `.unoBanner`). They sat at 24%, 30% and 50% of the
  screen, and on a table sat round its rim the first two came down on the hand of whoever faces us.
  The rule: from the seat block to the turn pill, the middle column (`SHOUT_HALF_W` either side of
  the piles) is taken by the piles and by every seat box that reaches into it, and the shout is
  centred in the **tallest gap left, the lower one on a tie**. On a rim table that is the band
  between the piles and our hand; with the seats held up in rows (a phone) it is the band above the
  piles. When no gap reaches `SHOUT_BAND_MIN` (a small screen, a phone on its side) the shout goes
  **over the piles, as low as the room under them allows**, never over anybody's hand: ours is the
  one an interception is answered from. `seatLayout.test.ts`.
- **Contre-LOCO! verdict** (`<CatchBanner />`): driven by `uno_caught`, which the client used to
  consume for its window bookkeeping and nothing else. A landed catch was the **quietest** event in
  the game — the caught seat's hand grew by two, which on a board where hands grow all match long is
  indistinguishable from an ordinary draw, and the player who won the race got no answer at all
  beyond a button going dark. It is the hardest reaction LOCO asks for and it rendered nothing.
  - `store.catchFlash { seat, at }`, set by `applyUnoCaught(seat)` — which also closes that seat's
    window, since settling the seat and announcing it are the same event. Cleared by the banner.
  - Three readings, because one banner cannot carry a moment this short: the **stamp** (who owes the
    call, what it cost), the **penalty cards** flying deck→caught seat with a `+2` callout over the
    pill (`<GameBoard />`, keyed on `catchFlash.at`), and the **`unoCaught` sting** — a voice that
    had been sitting in `sfx.ts` since the start with nothing ever playing it.
  - Deliberately **not** shaped like the interception slam: a red stamp punching *down* with a
    shockwave, against an actor-tinted banner growing out of a horizontal wipe, and a single
    vertical thump against a sideways rattle (`shakeScreen`). The two loudest moments in the game
    have to be told apart in a muted clip. The caught seat's colour appears on their name only.
  - The stamp lands on the shout line (above), never over the piles while a gap exists: the
    penalty cards leave the deck while it is still up, and a verdict covering the cards it is about
    explains nothing.
  - **The catcher is not on the wire** — `uno_caught` carries the caught seat only — so the banner
    names the seat that pays, not the one that called. That is the table's news; the caller already
    knows, they pressed the button. Naming them would be a protocol change for a line of copy.
  - `CATCH_PENALTY_CARDS` (2) is stated once in the store and read by both the banner and the
    flight. Against fully exhausted piles the server hands over fewer (a draw never fails, it
    shrinks), so what is approximate there is the announcement, never the hand — which always comes
    from the server. Scene `game-catch-caught`; `src/test/catchBanner.test.ts`.
- **UNO banner**: tilted sticker, punch-in, on the shout line so the play that triggered it stays
  visible. The word is alone on it and the caller rides the tag (`.unoWho`): "Pixel: LOCO!" was one
  line of mixed type in which the name took the size of the shout.
  - **Centred with `inset-inline: 0` + `margin-inline: auto` and `width: fit-content`, never
    `left: 50%`** — the notice pills' rule, and the same bug one size up: anchored at the midpoint
    the sticker was shrink-to-fit against the right half of the screen, and with `nowrap` on top of
    that a 20-character nickname ran it off both edges of a 360px phone. It wraps inside
    `calc(100% - 2 × --space-base)` now, `overflow-wrap: anywhere` for a nickname that is one word,
    the clamp's floor at 26px, and the punch keyframes carry `translateY(-50%)` only.
  - **z-index 45, with the other two shouts.** It sat at 10 — under the notice pills at 14 — so on a
    phone a Swap landing on the same beat printed its line across the shout. The three moments
    allowed to shout share one layer; see the score table's ledger below.
- **Contre-LOCO! verdict, the name line**: the name is ink on the tag hanging off the stamp and
  carries no seat colour at all. It used to *be* the seat's colour, and on the red stamp the ten
  seat colours measured between 1.05:1 and 2.3:1, the rose seat invisible outright; the coloured dot
  that replaced it read as decoration and is gone too. The name alone says who.
- **The interception banner takes the catch stamp's 480px block**: smaller padding, the ×N chip
  pulled in, and `.subtitle` allowed to wrap. It had no small-screen rule at all, and a subtitle that
  may not wrap took a 20-character nickname off both edges of a phone.
- **Effect callouts** (`AnimationLayer`): SKIP / REVERSE / +N, outlined rather than shadowed so they
  survive landing on felt, on a card, or on the background. Text is localised (`fxSkip`,
  `fxReverse`); `<GameBoard />` takes them as a memoised `fxTexts` prop — a fresh object literal
  would replay the callout on every render.
- **Play direction** (`<DirectionRing />`, geometry in `layout.ts: directionArrows`, `pileCentre`):
  two translucent arrows laid on the felt round the deck and the discard, one down the right of the
  piles and one up the left for a clockwise table. A Reverse otherwise only announces itself for the
  length of one callout, after which nothing on screen answers "who plays after me" — the question
  the card was about.
  - **Round the piles, not round the rim.** The ring of chevrons that ran round the felt, and then
    the chevrons inlaid in the racetrack, were both judged not good enough: round the rim they are
    far from where the eye is and half of them sit under a hand or a plate. The piles are where
    every eye already is.
  - **`direction = +1` is clockwise *on screen*, and the arrows must never contradict the seats.**
    The arc puts the next player at the **left** end of the top row, so a table flows 6 o'clock → 9
    → 12 → 3, which is clockwise. Same fact `clockwiseOpponents` is named after; an arrow pointing
    the wrong way is worse than no arrow.
  - **Laid down in perspective, with a thickness**: a flat SVG in a box tipped back
    (`perspective(900px) rotateX(62deg)`, steeper than a pile: at the piles' own tilt a circle this
    wide reached the seats and the pill), the same arrow a few pixels lower in shade under it.
    Translucent near-white washed with the room's accent: a saturated arrow would read as a suit.
  - The heading lives in the **arrowheads**, never in the motion: the slow turn with the play (60s a
    lap) is a second readout, so a frozen ring (reduced motion, a paused clip, a screenshot) still
    reads.
  - `<GameBoard />` keys it on the direction, so a Reverse remounts it and replays the half turn.
  - Scenes `game-my-turn` (cw) and `game-reversed` (ccw) cover both headings in the showcase.
- **The deck falls** on the victory screen only, and once (`CardFall.svelte`). Losing screens do not
  celebrate, and a walkover is not a victory. **What falls is the real components**, fourteen
  `<Card />` faces at 44-64px each backed by a real `<CardBack />`, both hiding their own backface
  inside a `preserve-3d` parent, so a card that turns over in the fall shows the deck's back the way
  a card does. It was confetti first and coloured 2:3 rectangles second, and the second is why the
  rule is stated this way: at 30px, with no value, no mark and no back, the only thing saying "card"
  was the aspect ratio, and nobody reads an aspect ratio.
  - **The fade and the turn are on two different elements, and that split is load-bearing.** A 3D
    context is flattened by anything that makes the browser composite the subtree as a group, and an
    animated `opacity` is one of those, `will-change: opacity` alone being enough. With both on one
    element `preserve-3d` was silently downgraded to `flat`: the back was never drawn and every
    half-turn showed the *front* in mirror image, which looks like a card turning until you read the
    number on it. So `.fall` owns the drift and the fade, `.tumble` owns the rotation and the depth,
    and neither may take the other's property. The perspective sits **per card** rather than on the
    layer, or the cards at the edges of a wide screen turn over more violently than the ones in the
    middle and the whole thing reads as a lens.
  - **The fall accelerates and the turn does not**, which is the pair of curves a tumbling object
    actually has. Linear on both reads as confetti descending at a set speed; a card that gains on
    itself and leaves the frame faster than it entered is the same animation with weight under it.
    The curve is not a pure ease-in either, which starts from a dead stop: these come off a throw, so
    it keeps a little speed at 0. **The fade-out moves with the curve** — at 90% of an accelerating
    fall the card is still a third of a screen from the bottom, so a figure written for a linear drop
    dissolves it in full view.
  - **Half-turns are weighted** (two fifths of the cards none, two fifths one, the rest two): a card
    turning at a constant rate spends as long edge-on as face-on, and edge-on it is a hairline.
    Enough never turn at all that the screen stays mostly colour, and the rest land on their back to
    say these are objects with two sides rather than printed shapes.
  - **One roll decides how near a card is** and size and speed both read off it, because a large card
    drifting down slowly behind a small one is the frame where the depth goes. Reduced motion drops
    the layer entirely.
- **Per-seat identity colours** (`components/playerColors.ts`): a player keeps one colour across
  lobby avatar, banner and scoreboard so a viewer can follow "the orange player" all match.
- Opponent pills show the **exact** card count (the fan only conveys few-vs-many, and caps out).

## Table news (the three notice pills)
Three things happen *around* the match rather than in it, and all three are told by one pill in
`<GameView />`: a Swap or a Global Switch (`swapNotice`), a Contre-LOCO! that arrived too late
(`catchFailed`), a seat gone for the rest of the match (`departureNotice`). They are the counterpart
of the streamable moments above — news, not moments — and the distinction is the whole design:
the LOCO! banner, the interception slam and the catch stamp are the three things allowed to shout,
so anything else wearing a saturated fill of its own competes with them for the same glance.

- **One class, three heights** (`.notice` + `.noticeSwap` / `.noticePenalty` / `.noticeDeparture`).
  The plate is the board's own chrome — `--color-surface-strong`, ink type, ink outline,
  `--shadow-hard` — and the only thing that changes between the three is the `--notice-top` each one
  sits at (13% / 20% / 29%, tightened on a phone), which is what lets a seat leaving on the same beat
  as a missed call read as two pieces of news instead of one covering the other.
  - They were three pills written one at a time before that: two saturated gradients and one plate,
    16px against 17px, a soft glow on two of the three, and white type over the top stop of
    `--gradient-error`, which measures **2.4:1**.
  - Nothing carries a colour of its own, not even a dot: what kind of news it is, is what the line
    says. A mark beside the text is one more object on a board that already has the discard, the
    seats, the ring and the action bar competing for the same two seconds.
- **In on a bounce, out on the beat the store drops it.** `noticeIn` (0.32s, `--ease-bounce`) then
  `noticeOut` (0.24s) delayed by `calc(var(--notice-life) - 240ms)`, where `--notice-life` is the
  component's own `SWAP_NOTICE_MS` / `CATCH_FAIL_NOTICE_MS` / `DEPARTURE_NOTICE_MS` passed inline —
  the three durations differ, so a delay written in the stylesheet would animate the shortest pill
  out over a slot `autoClear` had already emptied. The exit is `forwards`, **never `both`**: `both`
  back-fills its opening frame from time zero and swallows the entrance underneath it. Under
  `data-motion="reduce"` the pill simply is there for its whole life — the news is the line.
- **Centred with `inset-inline: 0` + `margin-inline: auto`, never `left: 50%`.** An absolutely
  positioned box anchored at the midpoint is shrink-to-fit against **the half of the screen to its
  right**, so the longest line in the set wrapped at 180px on a 360px phone and came out four lines
  tall over the seats, whatever `max-width` said. Anything else centred this way inherits the bug.
- **`text-wrap: balance`** keeps the two-line pills from ending on an orphan. It is safe here only
  because the width is now decided before the wrapping is.
- **No arrow glyph in any of them.** The Global Switch line named its heading with `→` / `←`, which
  says "that way" about a board every seat looks at from a different chair, and the two directions
  differ by one character in a pill that is up for a couple of seconds. It names the heading in the
  words the direction ring already uses (`clockwise` / `counter-clockwise`, `horaire` /
  `antihoraire`), so the board and the notice say the same thing the same way.
- **A line is read in passing or it is not read.** Every one of these fits on a single line at
  desktop width and wraps to two at 360px, and the Global Switch line — the only one that ever grew
  past that — names the event and the heading and stops: *"%actor lance la Rotation, sens horaire"*.
  Spelling out that the hands slide one seat put four lines over the seats on a phone to explain
  something the sliding hands and the card's own face are already showing.
- Scenes `game-swap-notice`, `game-global-switch-notice` (the longest line in the set, and the one
  that says whether the wrapping still holds), `game-catch-failed`, `game-departure-notice`.

## Score table (hold TAB)
`<ScoreTable />` is the in-match standings panel: seat colour + nickname, one column per finished
round, cumulative total, rounds won, ping. Pure merge/sort and the ping banding live in
`scoreTableModel.ts` (`buildScoreRows`, `pingTier`), unit-tested; the component only renders.

- **Opened by holding TAB** (`heldKey('Tab', enabled)`) **or pinned by the scores button** in the
  top-right cluster. Held and pinned are separate states: releasing TAB must not close a table
  somebody deliberately pinned, and a phone has no TAB key at all. The panel is up on the **press**,
  not after an arming delay, and the key moves no focus while it is down — the scoreboard key of
  every other game, and `client.md` has why it is not a keyboard trap.
- **That button exists on touch layouts only** — `.scoresBtn` is `display:none` until
  `(max-width: 480px), (pointer: coarse)`. It is the fallback for the missing key, so on a machine
  that has the key it is a permanent control for something already one keypress away, spending room
  in a cluster of four. The coarse-pointer half of the query is what covers a tablet, which has no
  TAB either and is wider than 480px.
- **It is an icon** (a table glyph, drawn inline in `GameView` like every other rule glyph in this
  UI, never a font character), 40×40 like the preferences gear beside it: at phone width the cluster
  has no room for a word, and the three buttons next to it are already square. `t.scoreTableBtn`
  survives as its `aria-label` + `title`, so the accessible name is unchanged and the E2E locator
  still finds it. `aria-pressed` tints it with `--color-primary` when pinned — the panel can be
  dismissed by tapping its backdrop, and nothing else would say the state changed.
- E2E: the desktop project therefore opens the table by **holding TAB** (`holdScores` in
  `score-table.spec.ts`); one test resizes to 390×844 to exercise the button and asserts it hidden
  before the resize.
- `heldKey` resets on `blur`. Alt-tabbing away swallows the keyup, and the overlay would stay
  stuck over the board with no way out. It `preventDefault`s TAB, so `enabled` is false while the
  rules modal, a picker or the round summary owns the screen: inside a dialog TAB is the dialog's,
  and `dialogFocus.ts` cycles it there. **Shift+TAB is never taken anywhere**, which is what keeps
  every board control reachable from the keyboard.
- **Nothing the board draws crosses it, and that is the point of the number.** The panel sits at
  **z-index 48**, above the whole transient band — notices 14, the error toast 30, the three shouts
  (interception slam, catch stamp, LOCO! banner) 45, `.topRight` and the leave question 46, the catch
  capsule and the round summary 47 — and below the three things that outrank a read: the reconnect
  curtain (50), which says the table is not there at all, the two pickers (100), which are a
  decision the player owes the table, and the rules modal (1000) and map gate (900), which own the
  screen outright.
  - **The capsule and the round summary share 47 because they are never up together.**
    `applyRoundEnd` empties every catch window, so the capsule is unmounted by the message that
    raises the summary, and nobody is on one card in the eight seconds after a deal. The summary
    sat at 40, under the banners, the chip row and the capsule, so an interception slam or a
    five-second countdown could be drawn across the scores. It cannot go higher without crossing
    this panel, and the capsule cannot go lower: the chip row is rendered *after* it in `GameView`,
    so at 46 the row would cover it again — the exact bug the capsule's own comment records.
  - It was at 45, which is the banners' own layer, and both banners are rendered *after* it. So the
    one surface in this game somebody opens **in order to read it** was the one surface anything could
    cross: six seats, five columns and a ping, with an interception banner across the middle, a
    five-second countdown capsule over its title and four chips on its corner. Every one of those is a
    cue about the board, and the board is exactly what the player has stopped looking at.
  - **The chip row going under it is the deliberate half.** It carried the button that pinned the
    panel and was kept at 46 for it — but a pinned table has had a ✕ in its own header since, and its
    scrim dismisses on a press anywhere outside the card, so the way out is *on* the panel rather than
    behind it. Held with TAB there was never anything to press. That ✕ is therefore the only control
    answering for the panel on a phone, which is why it is 40px with `.hit-target` rather than the
    32px it shared with the modal's.
  - `scoreTable.test.ts` reads the layers off the sources and asserts the floor per file rather than
    per selector, so a fifth banner added at 46 fails without anybody remembering this rule exists.
    `score-table.spec.ts` asserts the cover from the other end, with `elementFromPoint` over the chip
    the panel is drawn on top of.
- **Ping bands** (`pingTier`): <60 good, <120 ok, <220 poor, beyond that bad. Tighter than a
  turn-based game would need, because an interrupt is decided by arrival order at the server.
  `rtt_ms < 0` renders as "not measured", never as a flattering 0 ms; bots are labelled `BOT`.
- Rows are ordered by score, then rounds won, then seat, i.e. the match tiebreakers, so the panel can never
  contradict the final standings.
- Under 480px the **rounds-won column is dropped** and under 400px the "you" badge goes too. The
  ping must not be the thing pushed off the right edge of a phone: it is the one column that cannot
  be derived from anything else on screen (the gold row already says which seat is yours).
- **An offline row is quiet by hue** (`.rowOffline`): its fill drops back to the panel's own, its
  outline softens to `--color-border-strong`, and every cell reads `--color-muted`. It was
  `opacity: 0.55` on the cells, which put the nickname under 3:1 on the seat a spectator is most
  likely to be asking about. The ping tiers are tokens now too — the amber is `--color-amber`, the
  one step the scale needs that the brand did not carry, and "bad" turned out to be `--color-error`
  retyped.

## The round chip under 480px

The chrome row on the right is five chips wide on a phone (scores, gear, speaker, rules, leave):
5 × 40px plus the gaps and the margin is about 245px of a 360px screen, and "Round 2 · BO3" at 13px
uppercase needs 150. The chip ran under the scores button. Under 480px the chip switches to its short
spelling, `M2 · BO3` (`t.roundShort`, the score table's own `M%n` column head, so a name the player
has already read) and the decisive round keeps one word (`t.decisiveRoundShort`). Two spans, one
hidden per width, so the accessible name stays the long form. Not a scene: `game-uno` at `small`
is where it shows.

## Quiet states, measured
The rule at the top of this note — quiet is a hue, never an opacity — was written for one label and
broken on most of the screens a spectator reads. Each of these was measured, and each is now a
token:
- **Disabled action-bar buttons** were `opacity: 0.55`, held there "so a spectator can still read
  what the centre column is for", and at 0.55 the dead Catch label measured ~2:1 and a dead Draw or
  Pass ~3.4:1 — Catch is disabled through the opening of every round, so that was the state a
  viewer saw most. The fill swap that replaced it fixed the contrast and left the state itself
  ambiguous: the dead fill was `--color-surface-strong`, which is what a **live** Pass wears, so the
  two were told apart by a label colour and a missing ledge and half the bar read as pressable for
  the whole of somebody else's turn. A dead button is the **inverse of a raised object**, not a
  quieter one, so all three of the things that raise one are inverted:
  `--color-surface-sunken` (a fill below the bar rather than on it, desaturated as well as darker —
  the live Pass keeps the lilac), the hard ledge replaced by a **hard shadow inside the top edge**
  (`inset 0 2px 0`, the same zero-blur vocabulary read as a hollow), and the outline dropped to
  `--color-hairline`. Not the ink, and not `--color-border-strong` either: on a sunken fill that
  border drew a ringed ghost pill, which is a pressable shape everywhere else a player has been.
  The label is `--color-disabled-ink` — 5.1:1 in light, 6.1:1 in dark, both measured in
  `actionBar.test.ts` off `tokens.css`, because Catch sits
  dead through the opening of every round and a spectator reads it at 720p. Still no opacity
  anywhere. **`.btnDrawSecondary` is surface-strong too**: it was `--color-surface-card` on a bar of
  `--color-surface-card`, a white pill on a white bar in light.
- **The round summary's delta** was `--color-mint` on `--color-surface-strong`, 1.81:1 in light —
  the one number the card is opened for. `--color-mint-text` is the mint as *text on a panel*, the
  same hue as text, the way `--color-link` is the indigo as text; on this canvas the brand mint
  itself is 6:1, so the two land on one value. The winner row's two literals (`#7a4a00`,
  `#1f6b3c`) are `--color-on-secondary-muted` and `--color-on-secondary-mint`, fixed like the
  yellow they sit on; the green moved one step past the literal, which was 4.25:1 on the
  flat yellow.
- **The two text-field focus rings** (`Lobby` `.input`, `WaitingRoom` `.maxInput`) were the indigo at
  0.35 alpha, 1.5:1 on the card — and with `outline: none` on the field that shadow was the whole
  indicator. Both are the solid `--color-tertiary` at 3px, the ring `tokens.css` gives every
  `:focus-visible`.
- **The map-loading roster** set a name still loading at 50% white over the room, with no shadow.
  0.72 and the same shadow `.status` carries.
- **`.formatLen`** was 10px with `opacity: 0.75` on the active pill; **the round summary's heads,
  progress title and gap, the game-over gap and the recap heads** were 11px. **12px is the floor**
  for anything on a screen a spectator reads, and the opacity is gone.
- Scenes `game-scores` and `game-scores-round-one` cover both states in the showcase.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard, roundHistory?)`.
- Computes per-player `round_points` as `newScore - prevScore` from pre-round scoreboard, stores `roundScores: RoundScoreEntry[]`, sets `showRoundSummary:true`.
- `GameView` shows: round n/total, winner, per-player breakdown sorted by placement, points (delta), cumulative score, wins, full match scoreboard (BO3+). The round it names is `roundNumber_completed`, a field of its own, because `roundNumber` is already the round being dealt behind it.
- "Continue (Ns)" → `dismissRoundSummary()`, which takes the card down and puts no board back. Auto-dismiss at 8s.

### The card is an overlay, and the board behind it is live

The `game_started` that deals the next round arrives while the card is up, and is applied there. It
used to be buffered in `pendingGameState` and replayed on dismissal, so that the summary would not
vanish the instant the server dealt — and that was the bug:

- the server deals the moment it announces the round that ended, and **arms the turn clock with the
  deal**, so the table is already playing while the card is up;
- every `card_played` of the new round was applied to the store all along — nothing about the board
  was ever actually held back — so the buffer was a snapshot of the deal replayed over a board that
  had moved on for up to the full eight seconds;
- whoever read the scores had their table rolled back: the discard, the hand sizes, and
  `currentTurn`. **If the rolled-back turn was their own, nothing could heal it**: they were shown
  somebody else's turn, so they did not play; nobody else could play; and the table sat there until
  the server's turn timer expired and the `turn_changed` corrected them. A reload fixed it, which is
  how it reads as a server bug when it is not one.

So `applyGameState` settles the board and **does not touch the card** — neither `showRoundSummary`
nor `roundWinner` — and `dismissRoundSummary` only hides it. A snapshot is authoritative when it
arrives and never afterwards; anything held and replayed is a snapshot applied twice, the second
time against a table that has moved. The **match end** is still buffered (`pendingMatchEnd`), and
that one is safe for the reason this one was not: nothing follows a match end.

One consequence is deliberate: the `yourTurn` cue is held while the card is up and played when it
comes down on a turn that is already ours (`audio/gameSounds.ts`), because eight seconds of scores
is a board the player cannot act on.

## Visual showcase & screenshot harness
`client/src/dev/scenes.ts` registers every screen/state as pure data; `?showcase` renders the index,
`?showcase=<id>` renders one scene full-screen with no server, no WebSocket and no second player.
Gated behind `import.meta.env.DEV` (dynamic import in `entry.ts`), so Rollup drops the chunk in prod.

`tools/visual/shoot.mjs` (`make visual`) boots the dev server through
`tools/lib/devserver.mjs`, walks the registry and writes
`.visual/<scene>__<viewport>.png` plus one contact sheet per viewport.

- **A room takes three query overrides on top of its scene**: `?showcase=game-map-marina&time=day`,
  and the same for `weather` and `map`. Dev-only, applied over the scene patch in `Showcase.svelte`,
  and there so that fixing a diorama does not need a registry entry per hour and sky — six rooms by
  five hours by five skies is not a contact sheet anybody reads. The registry still owns what
  `make visual` captures.
- **Add a scene in the same change set as any new screen or visual state.**
- `card-sheet` is the odd one out: not a screen but the whole deck, every kind in every suit, laid
  out to fit the capture viewport. Cards are the component the game draws forty of at once and no
  gameplay scene shows more than a handful of kinds — review any card change against it.
- Flags: `--scenes=a,b`, `--viewports=desktop,mobile,wide,small,notch`, `--gfx=high|medium|light|force` (the tier a room is rendered at; `force` is the full tier on the harness's software GPU, which is otherwise handed the plain frame — the way the finishing passes are reviewed),
  `--motion` (keep animations running), `--port`. Default runs `desktop` (1440×900) + `mobile`
  (390×844). The two ends of the board-scale range are where its regressions show up — check
  **both** after touching `layout.ts`: `wide` (1920×1080, scaled up) and `small` (360×640, scaled
  down).
- **`notch` is a phone with safe areas** (390×844 plus a 59px notch and a 34px home indicator). A
  viewport entry may carry `insets`, which the init script writes over the `--safe-*` tokens the CSS
  offsets and `safeAreaInsets` both read. No desktop browser reports an inset on its own, so this
  is the only way to see the layout that has to dodge them (see "Safe areas").
- Viewport size goes under `viewport: {...}` in the Playwright context options — width/height at the
  top level are silently ignored and you get the 1280×720 default.
- Captures run with `reducedMotion: 'reduce'` by default so they are deterministic; `--motion` is how
  you check the fall, springs and callouts.
- **The harness asks for the home page of the language it is capturing** (`/fr/` by default, since
  `--lang` defaults to `fr`). `/` and `/fr/` are two builds, and a French screenshot has to be of
  the document a French player is served rather than of the English one translated into French.

  It used to be load-bearing for a harder reason, kept here because the failure is expensive to
  rediscover. While the language was answered by a *navigation*, seeding `loco_lang=fr` and asking
  for `/` made every scene load twice — and one page walks all 62 scenes, so the count is what broke:
  **Chromium stops honouring navigations on a long-lived page somewhere past a hundred of them.** The
  run died on scene 52 with a bare `page.goto` timeout and no error on the page; reversing the scene
  list moved the failure to a different scene at the *same position*, which is what identified it as
  a count rather than a scene. `/` translates itself in place now and never navigates, so nothing
  doubles whatever the harness asks for — but past ~100 scenes, recycle the page rather than hunting
  the scene it stops on.

## Link preview (Discord / X)
The game is shared as a link, so the OG card is a product surface. `make og` (`tools/og/shoot.mjs`)
renders the `og-card` scene at 1200×630 into `client/public/og.png`.

- **Built from the real `<LocoLogo />` and the real `<Card />`** (`client/src/dev/OgCard.svelte`), not a
  redrawn copy: the duck on the preview is the duck on the cards is the duck in the tab, and a
  hand-authored twin would drift the first time either is touched. `OgCard` pins `--color-stroke` /
  `--color-primary` locally — a link preview is one picture and must not depend on what the tokens
  say the day it is captured.
- **Show, don't tell**: the duck, the wordmark and a five-card fan, one line of copy. Discord renders
  this at ~400px wide; a paragraph is unread there. The +4 sits mid-arc, where a crop or an avatar
  overlay can't take it.
- **The tagline is typeset one sentence per line** (`.taglineLine`), because the shared string
  (`t.tagline`, the same one the lobby shows) is two sentences and the column broke it mid-clause:
  "Cards at speed. Nobody / waits their turn." reads as a text box that ran out of room. The line is
  a `block`, not `nowrap`, so a longer sentence in another language wraps inside its own line rather
  than running out of the frame.
- The PNG is **committed** — CI builds the client with `npm run build` and has no browser.
- **Absolute URLs are mandatory** (crawlers resolve `og:image` against nothing) and the tags must be
  in the served HTML, since neither Discord nor X runs JS. `src/seo/meta.ts` holds `ORIGIN` (default
  = prod, override with `VITE_PUBLIC_ORIGIN`) and builds every URL through `absolute()`;
  `layouts/Base.astro` renders the tags. The tags are data rather than markup so `ogCard.test.ts`
  can assert the values instead of running a regex over a template.
- Both platforms **cache the image by URL** for days: bump `OG_VERSION` in `src/seo/meta.ts` after
  regenerating. `twitter:card` must stay `summary_large_image` or X shows a 120px thumbnail.
- No preview on the `-d.` host by design — nginx serves `robots.txt: Disallow: /` there and
  Twitterbot honours it.
- `client/src/test/ogCard.test.ts` is the only thing watching this: nothing else in the app renders
  those tags or that image, so a deleted PNG or a drifted dimension would fail silently in
  production.



## The game cover

`src/dev/CoverCard.svelte`, three cuts, shot by `make cover` into `brand/` — committed, and
deliberately not under `client/public/`, because it is an **upload** rather than something this site
serves. IGDB takes it and Twitch draws it as the category's box art.

**It carries the wordmark and no other text.** IGDB's guidance asks that the title be the largest
text on the cover, and the way this art answers that is by being the *only* text — no tagline, no
"card game", no version. The same guidance refuses platform logos, age ratings and watermarks, and
none of those has a reason to be here either.

**It is judged at 40px.** That is the width a Twitch category is picked out of a sidebar at, and it
is the size that decides whether anybody clicks. A cover composed at 600×800 and admired at 600×800
is a cover nobody has actually looked at: at 40px the mark either reads as one shape or it is a
smudge, and every cut is chosen on that test rather than on how the full-size art feels.

**Built from the real `<LocoLogo />` and the real `<Card />`**, for the reason the link preview is:
the art leaves this repository, and nothing here can watch it go stale. A hand-drawn copy of the
wordmark would keep whatever proportions it had the day it was traced, on a surface that is by
definition out of reach the moment it is uploaded.

`coverCard.test.ts` pins the ratio, the 40px floor and the no-other-text rule.

## Ambience and celebration

The brief this pass answered was "everything that feels soulless". Four things, each small, each in
the same voice as the rest of the board.

- **No painted ambience.** A first pass put drifting colour lights and floating card silhouettes
  behind the entry screens, and it was taken out the same day: soft glowing blobs on a dark ground
  are the texture every generated interface wears now, and people read it as the absence of a
  decision. The canvas stays the designed gradient and the objects on it carry the life —
  entrances, presses, a hand dealt, numbers counted. If ambience ever comes back it is drawn from
  the game's own vocabulary (a real card, an ink outline, a hard shadow), never from a glow.
- **The home screen arrives in order** (`Lobby`'s `riseIn`): the mark, the line under it, then the
  four buttons one after another, 60 ms apart, once, under the boot fade. A screen that appears in
  one frame is a page loading.
- **A hand is dealt, not drawn** (`GameBoard`'s deal effect, `DEAL_FLIGHT_MS`): eight card backs fly
  off the deck one after another and each lands where the fan will hold it; the fan's own fade-in
  (`Hand`'s `handCardIn`) now waits for its card's flier, so a card never appears before it has
  arrived. Keyed on `roundNumber`, so every round's deal flies and a reload mid-round rebuilds the
  fan quietly. The deal sound already staggered at the same pace, which is why it reads as one thing.
- **Numbers are counted, not printed** (`components/countUp.ts`, on the round summary's points and
  totals and the game-over standings): a figure that pops into place is a spreadsheet cell. Rows on
  both cards arrive top place first and the winner's row catches the light once; the game-over
  heading wraps as a phrase (`text-wrap: balance`) rather than leaving `TOI !` alone on a line.
- **Every screen arrives** (`hooks/screenIn.ts`, on the wrapper `App.svelte` puts round each
  screen): a 240 ms rise and fade in, no departure — nothing pressable is ever behind a screen on
  its way out. `.screen` is `height: 100%` and owns nothing else, so every screen sizes itself to
  it exactly as it sized itself to `#root`.
- **Three small answers to a press**: a card gives under the thumb for the frame before it flies
  (`Hand`'s `:active` squash), the turn pill lands with a ring (`TurnIndicator`'s `turnBurst`, a
  pseudo-element so the pill's own transform stays the fly's), and the reveal's VS lands with one
  too (`MatchFound`'s `vsRing`).
  - **That last ring grows wider than the gap it sits in, so it passes behind the two cards**
    (`.side` carries `position: relative` and `z-index: 1`; `z-index: -1` on the pseudo-element only
    puts it behind `.vs`'s own text, and `.vs` is the positioned sibling, so it painted over both
    cards). Drawn on top, the stroke crossed an avatar and two nicknames at the exact second the
    screen exists to say who they are — a burst read as a stray line laid across the reveal. Behind
    them it is a burst again, and the two cards never overlap the badge itself, so nothing else in
    the collision changes.

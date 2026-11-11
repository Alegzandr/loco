# Rendering, layout and art direction

The art direction, the board's geometry, the cards, the rooms and the streamable moments.
`CLAUDE.md` states the rules; this note carries their reasons and edge cases.

## Art direction — "cartoon premium"
Nintendo × Gartic Phone: chunky rounded shapes, thick ink outlines, a saturated palette, solid offset
shadows that make every control read as a physical object.

**`DESIGN.md` is the written spec** (North Star, the four colour roles, type scale, elevation, do's
and don'ts, in the Stitch DESIGN.md format). `styles/tokens.css` is the executable source of the
values; `DESIGN.md` says what they mean. Change one, change the other.

Three rules the whole UI obeys (stated at the top of `styles/tokens.css`):
1. Every raised object has an ink outline (`--stroke`) **and** a hard bottom shadow
   (`--shadow-hard`). Soft blurs are ambience, never structure.
2. Nothing is pure white on pure white. The board always sits on colour (`--bg-gradient`, painted
   once on `body`; screen containers stay `transparent`).
3. Type is display-weight and large — a spectator reads it at 720p.

- Fonts: **Fredoka Variable** (display) + **Nunito Variable** (body), self-hosted via
  `@fontsource-variable/*` and imported by the root layout (`routes/+layout.svelte`), because the
  content pages mount no game and still have to be typeset. No CDN: the CSP stays closed.
- Press feedback (hover lifts, active travels *into* the ledge) is written per component. There is
  no shared control class; do not add one without a caller.
- Scrollbars are styled once, globally, in `tokens.css` (thin, no track, thumb in
  `--color-border-strong`, `background-clip: padding-box`). An OS scrollbar is grey chrome on a candy
  panel in every stream capture. Do not re-declare it per component.
- The card face does **not** follow the app's sticker language: a card is an object, not a control
  ("Card face" below).
- `--ease-bounce` for anything that should feel physical; `--ease-out` for travel.
- **Reduced motion hangs off `:root[data-motion="reduce"]`**, written by `initMotion()` in `boot.ts`
  before the first paint ([`client.md`](client.md)).

#### Four families, and what each one means
LOCO Red acts, sunny yellow marks a win, electric indigo orients, signal mint confirms. That
separation *is* the palette, and it comes undone one colour at a time on grounds unrelated to it
(e.g. "this hue is near a framework's default"). **Judge a proposed colour on what it does to the
other three, not on its provenance**, and move it only inside its own family.

`--color-tertiary` is constrained by measurement: the focus ring wears it and must clear **3:1 on the
dark card** (WCAG 1.4.11, currently 3.42), and `--color-link` is the same hue pushed until it clears
AA on each canvas. **A colour written out by hand at a call site is the bug**; `playerColors.ts`
moves with the token or a seat and the interface disagree.

#### One palette
`tokens.css` declares the night palette on `:root`, once, with `color-scheme: dark`. The game is
played in rendered rooms over a near-black table and is built to be captured; a pale canvas round it
reads as a website with a game embedded in it, and a second palette doubles every contrast
measurement and every `make visual` run. `noLightTheme.test.ts` fails on `data-theme`,
`prefers-color-scheme`, `loco_theme` or `theme-boot` anywhere in the client, the E2E suite or the
tools, and on a second `--color-canvas`. Card faces and rooms never followed a theme.

### Colour assist (the suit silhouettes)
`SUIT_SHAPE` in `cardTheme.ts`, drawn by `SuitMark.svelte`, off by default: triangle red, circle
yellow, square green, diamond blue, at 15cqh under the top-left value, plus the picker swatches and
the active-colour chip.
- It writes on the brand's face, so it is a preference — and the one accessibility setting that
  decides whether somebody can play at all, since legality is a colour match.
- Reviewed at **hand size**: at 72px wide the mark is ~13px, and below 15cqh the square and diamond
  converge. Scene `card-sheet-assist`.
- Same two-pass ink as every glyph: off-white alone is 1.18:1 on the green suit.

## Board scale (`layout.ts: boardScale` / `boardSpace`)
The board is laid out in a **fixed coordinate space** scaled by `<div .stage>` in `<GameBoard />`
(`transform: translateY(offsetY) scale(s)`, origin `0 0`), driven by the **shorter** axis: scaling on
width alone pushes the hand under the action bar on an ultrawide.

- **Desktop**: design 1240×790, `clamp(min(w/1240, h/790), 1, MAX_BOARD_SCALE=1.45)`.
- **Phone** (`w < 560`): reference 405×830, `clamp(min(w/405, h/830), MIN_BOARD_SCALE=0.78, 1)`, so
  the board scales *down* below the phone it was drawn for (390×844 sits at ≈0.96).
- Between the two the scale is 1 and the responsive layout takes over.
- **A phone on its side** (`isLandscape`): the phone reference turned,
  `clamp(min(w/830, h/405), MIN_BOARD_SCALE, 1)`; the composition changes too ("A phone on its
  side"), decided **from pixels, once**, because the virtual space cannot tell a short window at 0.78
  from a desktop at 1.

`boardSpace(pxW, pxH, s, insets)` — **not** `px / s` — converts pixels to the virtual space. Two bands
of chrome do not scale and stay constant in *pixels*: `TOP_CHROME` (58: round badge, chip row) and
`BOTTOM_RESERVE` (140: the action bar **plus the LOCO! chip's band**). Scaled with the board they
shrink on a phone (seats under the chips, hand under the bar) and swell on a monitor.
`offsetY = safeTop + TOP_CHROME * (1 - s)` pins the top band and the height is solved so the bottom
one lands on the bar. Safe areas are in the same arithmetic ("Safe areas"). `layout.test.ts`.

- `GameBoard` passes only the virtual size down; children, `layout.ts` and every animation coordinate
  stay in that one space, so cards, seats, felt, type and fliers grow together.
- **Fix scale problems here, never by bumping `CARD_W` / `SEAT_DIMS`** — design-space constants.
- The piles derive their centre from `tableRect` (`pileTop`). `<GameBoard />` passes
  `seats.blockHeight` to the piles, the fliers and `tableRect` from one variable — mismatched
  reserves drift the fliers off the pile.
- **The pair sits close round the middle** (`PILE_GAP`, 32). The floor is the colour chip, which
  reaches `PILE_CHIP_REACH` towards the deck and must clear it (`layout.test.ts`).
- **The piles lie on the felt** (`pileTransform`, `onPile`, `PILE_SQUASH`): each tipped back
  `PILE_TILT_DEG` (32°, never flatter than the hands round it) about its own centre, seen from
  `PILE_PERSPECTIVE` (600px), its thickness a band of card edges. What lies on the felt is laid with
  it on its own node (`.laid`), since the deck's own transform is the hover lift. **The active-colour
  chip and the +N badge stay upright**, pinned where `onPile` sees the card's corners. Every flier
  landing on or leaving a pile does so at `PILE_SQUASH`. `onPile` is the CSS written as numbers;
  `layout.test.ts` checks it against the spec's matrices, or the chip floats off and landings jump.

## Seat layout (`layout.ts: seatLayout`)
One function owns opponent seating because three callers must agree exactly: `<GameBoard />` (draws
the seats), the fliers (`handSpots`) and `tableRect` (must not slide the felt under the seats).

### An opponent is a hand, face down, at a place on the table
A seat is **the hand itself** — the real number of backs — and wherever the table can seat everybody
it **lies on the felt at that player's place on the rim**, tips towards the middle, the name plate on
the table's edge. One arithmetic serves one opponent and nine; a fan held up beside the felt read as
a column of cards and changed shape with the player count.

- **One geometry, drawn and flown to** (`seatFan` under a `FanLay`, `seatBox`, `handSpots`).
  `<PlayerSlot />` draws each back at the anchor plus `seatFan`; the board flies to `handSpots`, the
  same function in board coordinates. `seatLayout.test.ts` pins that they agree, squash included.
- **A `FanLay` is how a hand lies**: its tilt (`rotation`), the table's perspective (`squash`, a
  vertical flattening applied after the tilt — `scale(1, k) rotate(r)`, which the fliers' keyframes
  match, so a card in the air is square to us and takes the felt's perspective as it lands), and its
  maximum spread (`span`). A hand held up is `facingUs(size)`.
- **The tips point at the table's centre as it is, not as drawn**: the tilt is judged before the
  flattening (`atan2(dx, −dy / squash)`). `squash` is the felt's proportion, never under
  `MIN_SQUASH` (0.82) — flatter reads as a smear.
- **Three sizes** (`cardTheme.ts: SEAT_SPECS`): `full` (backs 44×66, desktop), `compact` (32×48,
  never under 26px, `CardBack`'s `ART_MIN_W`), `mini` (the plate alone: a crowded phone, in rows). A
  fan draws at most `maxVisible` backs within its lay's `span`; the count on the plate carries the
  rest. **The count is a size up from the name** (30px, 16px type; 24px and 13px on smaller seats):
  it is the number a spectator follows the race by. **`SEAT_DIMS` is `seatBox` of a hand held up,
  rounded up** (`seatLayout.test.ts`).
- **A card on its way is not yet in the hand** (`PlayerSlot`'s `FanHold`): the board launches the
  fliers and tells the seat which backs to hide until when — an opacity animation filled backwards,
  keyed on the hold's stamp so an unrelated re-render never hides a landed card.
- **Whose turn it is lights up the place on the felt** (`.placeGlow`, a gold pool laid like the hand,
  breathing on opacity); the marker rides the plate. A hand held up in a row breathes on `scale`
  (2.5% over 2.6s — louder than that competes with the moments allowed to shout). The fan's
  `translate` is the knock of a Contre-LOCO! landing; each back's `transform` is its place; the last
  card's red burn is an inner layer. Reduced motion stops the breath and the pulse and holds the
  burn at full.
- The plate's count turns red at exactly one card (`countDanger`). **A disconnected seat is quiet by
  hue**: muted fill, softened outline, the drawn ✗, label `--color-muted` (4.5:1) — never an opacity
  on the ink, since it is the seat whose absence is the news.

### Our own hand is the biggest thing on the board
`HAND_SCALE` (1.1) scales our hand's cards over the pile's: it is the hand we read and aim at all
match. A scale on the slot, never a bigger `CARD_W` (the pile's, the deck's and every flier's).
**Everything that reserves room for the hand measures it with `handCard()`** (`calcHandSlots`,
`turnPillPlace`, `seatPosition`, `handSpots`), and `Hand` offsets each slot by half the growth.
**Not on a phone on its side** (`handScale(true)` is 1): ~340px of height has no room for it.

### Where the seats go
- **A place on the rim** (`rimLayout`), tried at `full` (≥ 720 wide) then `compact`. Places run over
  the top from our left to our right, next player first (play runs clockwise on screen), **spaced
  evenly along the rim, never by angle** (even angles bunch at the ends of a flat oval). **The first
  place is where it would be if everybody, us included, sat the same distance apart**
  (`firstRimAngle` from `evenFirstAngle`), the last its mirror. The arc comes down towards our end as
  far as each place's whole box (plate and fullest fan) clears the piles and their arrows, the turn
  pill, the screen's edges and **the line of our hand with a playable card standing at rest**; where
  nothing below the upper arc is clear, the `reach` rule keeps places on it. The plate sits on the
  table's edge, clamped to the screen; the hand lies `inset` from the rim. **A hand spreads no wider
  than 55% of the gap to its neighbour**, checked card against card as drawn (separating axes,
  `seatLayout.test.ts`) because a tilted hand's bounding box is mostly air. A size is **abandoned
  when two plates would touch**: next size, then rows.
- **Rows above the felt** (`rowLayout`): a crowded phone (six opponents and up at 405 wide). `compact`
  wrapping onto up to `MAX_FAN_ROWS` (3) rows of hands held up while the felt keeps `MIN_FELT_BAND`
  (300) for the piles, then `mini`. X spread **linearly**; non-mini seats keep `SEAT_EDGE` (28px)
  from the screen edges.
- **A column down the left** in landscape (`seatColumn`, below).
- **The felt is where everybody sits, so it is big** (`tableRect`): 78% of the width (capped 1100,
  never more than 94% — a share, not a margin, or a notch that scales the board down would make it
  bigger), and the whole band under the top reserve (capped 560), running on behind our hand like
  a table's near edge. On the rim the top reserve is only the plate across the top
  (`TOP_CHROME + plateH / 2 + 4`); rows report their whole block.
- **It never starts above `FELT_TOP_MIN`** (24.5% of the board's height, on a board ≥ 560 wide), and
  it gives height up from its top, never its near edge. The horizon cannot stand below the felt's top
  (`scene/view.ts`); a felt higher than this leaves `LOOK.vista.camera.horizon` unreachable inside
  the lens range, and the room loses its sky, sun and moon. `sceneView.test.ts` pins it on five
  monitor sizes. A phone upright is exempt: its narrow lens leaves the horizon room.
- Seats clear `TOP_CHROME` (58px).

### What moves between the hands
Every card the table moves is seen moving, from where it leaves to where it lands.

- **The deal goes round the table** (`GameBoard`'s deal effect, `dealStagger`): one card a seat in
  turn, next player first and us last, never longer than `DEAL_TABLE_MAX_MS`. Our `Hand` reveals on
  the same pace (`dealStep` / `dealOffset`).
- **A draw flies into the last places of the fan** (`store.lastDraw`, set by `applyCardDrawn` for any
  seat); ours turn over on the way (`Flier.flip`). Cards a Contre-LOCO! charged are marked `penalty`
  (`uno_caught` arrives first) and fly higher and slower; the hand takes the knock.
- **A card played leaves the middle of the hand**, face down at the fan's size, turning over on the
  way to the pile.
- **A hand passed crosses as a packet**, card for card from its place in the giver's hand to its place
  in the receiver's, at most `PASS_CARDS_MAX` (12) per hand, 22ms apart. Every path **bows sideways**
  (`Flier.curve`, perpendicular to the path — `arcHeight` only lifts, which on a vertical path is a
  speed change, not a curve); both hands of a Swap bow to their own right so they pass on opposite
  sides, and a GlobalSwitch bows every hand the same way round so the ring is seen turning.
- **Our own cards are face up in our hand and nowhere else**: ours going out turn face down on the
  way; cards coming to us turn face up in the air and land face up (landing as backs read as a second
  deal). Their faces are the snapshot's, a message behind the play: the flight waits for it
  (`launchIncoming`, keyed on `myHand` changing from `givenHand`) and flies backs after
  `INCOMING_WAIT_MS`.
- **Every receiving hand is held empty until its cards land, ours included, card by card** (`Hand`'s
  `hold`, the same `FanHold`): each card comes up under its own flier over the flight's last 90ms —
  one deadline for the whole hand made the first cards blink out and back. **The counts are the
  roster's, never `myHand`**, and **the hand we give away rides the notice**
  (`SwapNotice.givenHand`, taken by `applyCardPlayed`): the snapshot can land in the same frame as the
  play, and by then `myHand` is already the hand we received.
- **A flier waiting out its delay sits at its start** (`fill: 'both'` in `AnimationLayer`'s `play`),
  not at the layer's origin.

## Action bar (`<ActionBar />`)
- **Fixed three-column grid, never a content-sized row**: draw left, the reaction button centre, pass
  right. Slots (`data-slot="left|center|right"`) and the bar's width are constant (`--slot-w` ×3 on
  desktop, three `1fr` columns edge to edge under 480px), so every control sits on the same pixel all
  match: a player parks the cursor over the centre *before* the card that needs it lands.
- **Every column holds its button all match and goes dead rather than away.** A missing button leaves
  a lone pill in a trough whose outline pinches at each end — teeth that come and go with the turn,
  on the one surface aimed at without looking — and a control drawn only while pressable is one the
  player first meets inside the moment they need it. Scene `game-opponent-turn-quiet`.
  - **The penalty draw is the one recolour left, and it is ours only**: `Piocher +N` recolours and
    pulses in the left column on our turn; on another's turn the column stays the ordinary draw,
    dead.
  - **A dead draw wears the neutral fill** (`.btnDrawSecondary`): an unstyled disabled slot reads as
    a hole.
- **No keyboard shortcut for any of it, ever**: the controls hold their coordinates so they can be
  aimed at, and aiming is the skill. The global-versus-focused line is in [`client.md`](client.md).
- **The centre column is Catch's, all match, and nothing else may be in it.** It is the hardest button
  in the game to hit, so it is mounted all match and only ever **enabled and armed in place**.
- **Three readable states.** *Dead* while no other seat is on exactly `CATCH_LIVE_MAX_HAND` (2) cards
  and no window is running — the opening of every round and most of its middle. *Awake and
  pressable* as soon as another seat is on two cards (`game/catchAvailability.ts`), one ordinary play
  before the server can name anybody: a control that unlocks only on the server's cue can be answered
  but never anticipated. *Armed* while a seat actually owes the call. The middle state is what the
  price in `docs/rules.md` §14.6 is for; scene `game-catch-live`.
  - **Looser than the server's window by exactly one play, and no more.** A wider offer is a stretch
    where the press can only miss, and a miss a player can plan is a card drawn on purpose
    ([`domain-rules.md`](domain-rules.md)).
  - **A declaration the table has heard takes nothing away from it.** Hand sizes decide the middle
    state and nothing else may: going dead on a call would **announce the call** to a player who was
    not listening, and that press is exactly the one §14.6 charges. The declaration closes only the
    *armed* cue, which rides `catchTarget`.
  - **A fourth reading, about us: the wager is spent** (`GameView`'s `catchSpent` — `store.catchSpent`
    *and* no `catchTarget`). The press would be the blind send the store suppresses, so the button is
    drawn dead, the same sunken slot. It costs no legitimate press: a window still ours names itself
    in `catchTarget`, and the next card played hands the wager back. Scene `game-catch-failed`.
  - **What ends the middle state is a clock, not the board** (`isCatchLive` + `catchLiveUntil`,
    `store.catchLive`). None of the ways a seat leaves the armed cue — calling, drawing, swallowing a
    stack, taking a catch's penalty — takes it down, because each is an instant a thumb has already
    committed. What takes it down is the window running out plus `CATCH_LATE_GRACE_MS` (2s), so being
    late is a mistake a player can make. It is not a latch: held to the next card played, the offer
    was farmed a card at a time ([`domain-rules.md`](domain-rules.md)).
- **`.armed` is the same cue on Catch and on LOCO!** (`armPop` punch-in with a brightness flash, plus
  `armGlow` halo tinted by `--arm-glow`): the same wager from opposite sides, so the player about to
  be caught gets no louder cue than the catcher. Under reduced motion it is a **static halo**, not
  nothing: "this just became clickable" is information.
- **LOCO! is a chip centred above the bar** (`.locoSlot`, absolute, `data-slot="loco"`), out of the
  grid, **mounted all match** and enabled only while `handSize === 1 && !hasDeclared` — for Catch's
  reason. `actionBar.test.ts` asserts the slot, the enabled state and the arming of every button.
- **It is small and quiet on purpose**: forgetting the call is one of this game's turns, so the chip
  must not read as a fourth action. 30px tall, 13px type, `opacity: 0.55` while dead; its `.hit-target`
  applies **only while live**, and the 10px gap above the bar is 3px more than the target overhangs,
  so it never steals a tap from Catch.
- **Its band is part of `BOTTOM_RESERVE`** (140: 82 bar + 58 chip), so the hand is dealt above it
  permanently. Move the chip by changing that constant in `cardTheme.ts`, never by nudging the hand.
- `--slot-w` (126px) fits the widest left label ("Piocher +4"); `--slot-w-mid` (172px) fits the
  **French** centre label, and columns must not resize on a language switch mid-match.
- **A declaration is a one-shot, and the button is spent with it.** `Room::declare_last_card` refuses
  a second call on the same card (`GameError::AlreadyDeclared`, `player already declared`), and the
  flag clears only when `open_catch_window` opens a fresh obligation on that seat (a Swap or
  GlobalSwitch handing it a card nobody heard called). Client-side `store.myDeclared` — our seat in
  `store.declaredSeats`, written by `applyUnoDeclared` from the *server's* confirmation, never the
  click — disables the chip in place. The refusal is `ErrorKind::MissedCatch`, which
  `ErrorKind::is_honest` keeps off the suspicion counter: a second call is a double tap.
- **Copy**: the declaration reads "LOCO!" / "LOCO !"; the catch is "Contre-LOCO !" in French (French
  players already say *contre-UNO*) and "Catch!" in English (which has no equivalent term). The wire,
  store and E2E keep `uno*` / `catch*` names.

### The turn pill draws when it says "Draw" (`TurnIndicator.svelte`)
On our turn with a stack pending the pill reads "Draw 2" / "Draw 4" / "... or counter!" in an orange
gradient with outline and hard shadow, pulsing — by the game's conventions a button. So in that state
it **is** a `<button>` wired to the action bar's `onDraw`, acting on the press (`pressToAct`), with
`.hit-target`; its pressed state flattens the shadow and never touches the transform, which the fly
transition owns. Taking the outline off instead was rejected: it is the most urgent thing on the board
for its duration. `turnIndicator.test.ts`.

Its throb is a `<span class="wash">`, not a pseudo-element: `::before` is the turn's arrival burst and
`::after` is `.hit-target`'s, whose global rule centres with `translate(-50%, -50%)` — a component
paint on it lands half a pill up and left. `hitTarget.test.ts` fails on any component rule painting
the `::after` of an element wearing `.hit-target`.

## Mobile
- Seats resize and wrap automatically ("Seat layout"). Verify with `make visual ARGS="--viewports=mobile"`.
- Action buttons: `min-height: 44px`, `touch-action: manipulation`, and a 400ms double-tap guard per
  control (`guardDoubleTap` in `GameView`).
- Wild picker: 64px+ touch targets in a row.
- Viewport meta: `width=device-width, initial-scale=1.0, viewport-fit=cover` and **nothing else**.
  The double-tap zoom is answered by `touch-action: manipulation` on `body`, which leaves the pinch
  alone. `a11y.test.ts` fails on `user-scalable=no` or `maximum-scale`.
- `@media (max-width: 480px)` is a **layout** breakpoint (a bar edge to edge, a dropped column). **A
  panel that changes shape does it at 46rem**, where the navigation becomes a burger and all four
  sheets flip together ([`client.md`](client.md)).

### A phone on its side (`layout.ts: isLandscape`, `ActionBar.svelte`'s landscape block)
Portrait stacks seats, felt, hand and bar, and the two unscaled chrome bands are 198px of that stack;
a phone sideways with Safari's bar is ~340px tall. Landscape is therefore **another composition, not
a smaller one**, all of it in `layout.ts` behind one `landscape` flag every layout function takes:
- `isLandscape(w, h)`: wider than tall and under `LANDSCAPE_MAX_H` (560px). Decided in `GameBoard`
  from the element's pixels and in `feltInViewport` from the viewport's, then handed down. A short
  desktop window gets it too, rightly.
- `boardSpace`: the unscaled chrome is **up the right edge** (`SIDE_RESERVE` = 160, the stack's 124px
  slot plus padding, stroke, margin and gap) and along the top (`TOP_CHROME_LANDSCAPE` = 44, round
  chip and turn clock). The hand runs along the bottom safe edge, `HAND_MARGIN_LANDSCAPE` above it.
- `seatColumn`: seats in a column down the left band (`SEAT_BAND_LANDSCAPE`), centred on the felt,
  **next player at the bottom** (the ring still runs clockwise on screen). Compact while the column
  holds them, then mini; overflow continues **along the top of the felt, left to right**, short of
  the chip row (`CHIP_ROW_CLEAR`), and the felt drops by `blockHeight` as under a portrait row.
- `tableRect`: the felt takes the band between the top chrome and the hand and the width right of the
  seat band, flatter than portrait.
- The piles stand **high** (`pileTop`, `PILE_INSET_LANDSCAPE`) and the turn pill takes the band under
  them (`turnPillPlace`, which also owns portrait's reserve above the hand). A felt squeezed under a
  top row puts the pill on the bottom rim, short of the hand.
- The action bar is a **stack** at the right safe edge: draw, Contre-LOCO!, pass, LOCO! chip above.
  Same fixed slots, only the axis turns. `@media (orientation: landscape) and (max-height: 559px)`
  re-sets every measurement the `max-width: 480px` block sets. The chip row stays top-right.

`landscape.test.ts` runs the board's chain at 844×340 with the notch on one flank and pins the stack's
CSS to `SIDE_RESERVE` and `LANDSCAPE_MAX_H`. Review with `make visual ARGS="--viewports=landscape"`
(`game-seven-players` is the full table).

### The entry screen on its side (`Lobby.svelte`'s landscape block)
Every piece of chrome on the entry screen is absolute and reserves nothing (chip row,
connected-players plate, live strip), so a stacked column (~430px) on a 340px page runs through all
of it on a screen that never scrolls. Same answer as the board, at
`@media (orientation: landscape) and (max-height: 559px)` (`LANDSCAPE_MAX_H - 1`, pinned by
`landscape.test.ts`):
- **Two columns**: the lockup (`.lockup`, mark + tagline) and what the player acts on (`.panel`).
  Upright both wrappers are plain columns and every portrait capture is unchanged.
- The four entry points become a **2×2 grid**. Hierarchy is a hue: the 1v1 keeps its fill, height
  and first place; nothing is demoted. Forms take the same grid (the join form puts name and code
  side by side); their `<input>`s need `min-width: 0` or a grid track asks for twenty characters.
- The container's padding clears the absolute chrome: the chip row at the top
  (`--space-base + --topbar-h + --space-sm + --safe-top`, never a literal) and the live strip at the
  foot, which grows under 46rem where the connected count joins it.
- The mark's size is a token on the container (`--lobby-logo`), since a prop cannot be written twice.
- **Every row the same height and every label on one line**: `grid-auto-rows: 1fr`, and type steps
  down under 46rem so "Jouer contre un bot" / "Rejoindre une table" never break. Checked at 667×375,
  740×360, 844×340, 932×430.

The queue's two screens take the same pass:
- **`Searching.svelte`** (carries the chip row — the wait is long and the music must stay reachable):
  two columns (`.stageSide`, `.panel`), same padding, and `align-items: safe center` beside
  `justify-content`, because a centred column taller than its row overflows upwards under the chips.
- **`MatchFound.svelte`** is squeezed, not recomposed: the meeting of the two cards is the composition.

The waiting room is untouched: it clears the chip row and its roster scrolls by design. Review with
`make visual ARGS="--viewports=landscape --scenes=lobby-home,lobby-live,lobby-join,matchmaking-searching-long,matchmaking-found"`.

### Safe areas (the notch and the home indicator)
The page owns the whole screen and keeps the game off its edges. Without `viewport-fit=cover`, iOS
fills the notch bands with the root's colour; with only the flag, the bar sits under the home
indicator.

- `--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left` in `tokens.css` wrap
  `env(safe-area-inset-*)`; every edge-anchored piece of chrome offsets by them (`.topRight`,
  `.roundIndicator`, `.turnTimerBar`, `.actionBar`, every screen container's padding).
- **`boardSpace` takes the insets**, so `TOP_CHROME` and `BOTTOM_RESERVE` are measured from the
  *safe* edge. The board element still runs edge to edge for the room's picture. `offsetX` is the
  landscape half (the notch on one flank).
- `safeAreaInsets` reads the numbers back through a hidden probe padded with the `--safe-*` tokens,
  re-measuring on `resize`/`orientationchange` only: an `env()` in a custom property reads back
  unresolved in several engines. Reading the tokens is also the seam the capture harness overrides.
- **A match pins `<html>` to `--room-void`** (`<GameBoard />` sets `data-room` and writes the scene's
  horizon **taken well down** into it): the browser paints any band the page does not own with the
  root's colour, and a band in the room's shadow reads as the room. Not the horizon itself — a noon
  horizon is near-white, and the loading screen wears the same value.
- Review with `make visual ARGS="--viewports=notch"` (no desktop browser reports an inset).
  `layout.test.ts` owns the maths, `safeArea.test.ts` the wiring to the stage's transform.

### The chip row takes no space, so the screen under it has to give some
The gear, speaker and "?" are one absolute row top-right, out of the flow; the container's **top
padding is the only thing** holding content off them. `--topbar-h` in `tokens.css` names the chip
height (40px), and a screen whose content can overflow pads
`--space-base + --topbar-h + --space-sm + --safe-top`; `justify-content: safe center` then parks
overflowing content against that padding. `waitingRoom.test.ts` reads the rule off the component's
`<style>` (jsdom applies no stylesheet). Screens whose content is always centred keep a spacing step.

### The host is told what they are choosing, where they choose it
- **The length rides the format button** (`matchLengthModel.ts`), a second line under its label.
- **It is a range carrying `≈`**: a match ends when the lead in rounds cannot be caught, so a best-of-7
  is four to seven rounds, and a single figure is wrong in the direction that stops hosts offering
  long formats. The model is pure and tested; `fastestRounds` is the client's statement of
  `Room::decisive_leader`.
- **It reads the roster, not the seat cap**: the question is how long the evening will be with who is
  here.
- **The seat advice is a hint under the field**, in `--color-muted`. Both are host-only.

## Active colour (four readings, `<DiscardPile />` + `GameBoard`)
The colour in play is the most-consulted state on the board, and a ring alone is hard to *know* the
meaning of — on a wild it is the only thing saying anything. Four readings at four distances:
- **The pool** (`.pool`): coloured light on the felt round the discard, low and blurred, what a viewer
  gets at 720p without looking. Card edges keep winning.
- **The ring** (`.ring`): the precise statement.
- **The chip** (`.chip`): a solid token in the ring's bottom-left, mirroring the `+N` badge's corner,
  always occupied, in the suit's whole gradient (`SUIT_PAINT`) — the paint of the `<ColorPicker />`
  swatch and of the cards it now allows.
- **The callout**: `GameBoard` names the colour over the pile (`fxTexts.colors`, `ACTIVE_RING` tint)
  **only when the top card is a wild** — any other card carries its colour on its face. It is what a
  muted clip needs to show "he changed it to green". Delayed `COLOR_CALLOUT_DELAY_MS` (420ms) past a
  +4's `+N` callout so the two read as a sequence.

The three permanent cues are keyed on the colour, so a wild resolving replays them together. Scene
`game-wild-active-color`; `discardPile.test.ts` covers the chip and both callout branches.

## Maps (the room a match is played in)
A map is **a scene, a table and an accent colour**; it changes no rule, card or timing. Six ship:
**Neon** (a rooftop terrace above a neon city), **Rune** (a village street under a wizard's tower),
**Velvet** (an art-deco hotel terrace on its boulevard), **Orbit** (a landing pad on an airless moon,
the Earth in its sky), **Sakura** (a hot-spring inn's veranda under cherry trees) and **Marina** (a
card table at the end of a quay). Each is dealt at one of **four hours** (dawn, day, dusk, night)
under one of **six skies** (clear, cloudy, rain, storm, snow, fog); each room lists the skies it
allows (no snow on the moon).

A room is **built, not photographed**: blocks and a few drawn models rendered in the browser
(`components/scene/`, three.js), seen from the table, with a painting over it ("A painted room") and
the table rendered under the felt. A match at midnight in the rain and one at noon are two rooms.

- **The draw is server-side, per match, three ids.** `loco-game/src/maps.rs` (`MapId`, `TimeOfDay`,
  `Weather`, `MAP_IDS`, `MAP_WEATHERS`; `pick_map` / `pick_time` / `pick_weather`). `Room::start`
  writes `map_id`, `map_time`, `map_weather`; `begin_next_round` keeps them; `reset_for_rematch`
  clears them so the next match gets a new room. Exported as `GameStateDTO.map_id` / `time_of_day` /
  `weather` on **every** snapshot so a reconnecting player rebuilds the same room. Bare strings on the
  wire: an unknown value degrades (`resolveScene`: unknown hour → daylight, unknown sky → clear) and
  never drops the `game_state`.
  - It is the server's although purely visual: two players describing two different tables to a
    viewer is a table that does not exist. A client-side hash of the code would freeze a room's map
    forever, and a rematch is meant to feel new.
  - **`maps.test.ts` pins the client's lists and every per-map weather list to `maps.rs`** (through
    `src/test/serverSource.ts`), in order. A mismatch is a room this client cannot draw, failing
    silently as a plain felt.
- **`tableRect()` remains the single authority on geometry.** A scene changes how the felt is
  *painted*, never where anything is; the render is solved to the felt, never the reverse.

### The view (`scene/view.ts`)
**A room is seen from the table**, and the brief for every room is what gives a picture depth:
1. **Three grounds and a horizon**: a near that frames the picture at its two edges, the only thing
   at full weight; a middle, most of what shows between the seat pills; a far of layered silhouettes;
   the horizon and the sky.
2. **The air between them** (aerial perspective, `post.ts: AirOptions`, `LOOK.vista.haze`).
3. **A light the viewer sees**: at dawn, dusk and night the sun or moon is *in the frame*, low, and
   lights the room from behind, so long shadows come towards the table and its road lies across the
   water (`dome.ts`, `mirror.ts`).
4. **A palette held**: each room's light pulls the hour towards its own colours (`LOOK.rooms`), with
   few related colours.
5. **Air round the subject**: few things, ground between them ("The room is quiet").

The camera is a perspective camera at eye height (a tile is a metre; a person is 1.6), looking
towards `-z`, the table's centre at the origin. **The felt is fixed and the camera is solved to it**
(`solveView`, `sceneView.test.ts`). The CSS table is a screen ellipse (`layout.ts: feltInViewport`);
under perspective a table top is that ellipse cast back onto the ground plane, so the top is **the
felt's outline cast onto the table's plane** (`View.tableOutline`) and extruded (`Kit.plate`), and
the CSS table lands on it to the pixel. Two things then decide the camera:
- **Where the horizon sits** (`LOOK.vista.camera.horizon`, 13% from the top): above the felt, so sky
  and far shore show between the seat pills and in the top corners.
- **The table's shape on the ground** (`aspect`, 1.5 deep for 1 wide). A horizon just over the felt is
  a table fifteen metres deep, so the shape is held and the focal length gives, solved by bisection
  within `fov` (58–84° across). Where both cannot hold (a phone on its side) the lens takes its widest
  and the horizon goes where it must, the table deepening up to `aspectMax` to keep a strip of sky
  (`horizonMin`).

The principal point is on the felt's centre across (an invisible lens shift) and at the horizon up;
the camera is turned down by `tilt` (0.3) of the angle to the table so verticals stay near vertical.
`render.ts` builds the three.js camera (`cameraSpec`, `setViewOffset`); a sprite is shot by the same
camera cropped to it. At 16:9: sky and far ground in the top band and corners, the middle ground
along the top of the felt, the near ground and framing props in the side bands, the floor in the
bottom corners. Each builder's header writes its composition to those bands (`maps/vista.ts`).

### The look (`scene/look.ts`, `src/dev/lookPanel.ts`)
Every visual number the render reads, in one file: the hours (sky, sun and its place, the body, stars,
sky light, lamps, windows lit, darkness), the global sun/sky knobs, the shadow, the material, the
outline, the occlusion, the tone curve and split tones, the finishing passes, the water, mist, pools,
the view (`LOOK.vista`), the table (`LOOK.table`), the plate (`LOOK.plate`) and each room's light
(`LOOK.rooms`). **Framework-free and three-free**, so `sky.ts` (which a content page imports) reads
it and a test can assert it.

The dev panel is lil-gui over this object: `?look=1` in dev (`boot.ts`, behind `import.meta.env.DEV`,
so neither reaches a build). A move edits `LOOK` in place and calls `bumpLook()` after 180ms of quiet;
the backdrop hears it (`subscribeLook`) and asks for the room again — **`lookVersion()` is part of the
cache key** (`sceneCache.entryKey`) and the entry (`PreparedScene.look`). "Copy JSON" exports the
look; nothing is persisted. `?lookPatch=<json>` on the showcase applies a partial look before the
first render. `LOOK.debug` shows one pass alone (`ao`, `lit`, `depth`) and ships `off`
(`sceneLighting.test.ts`); **`lit` and `depth` find a thing in the frame with no geometry behind it**.

### The light rig (`scene/sky.ts`)
`lightRig(time, weather, room)` takes the hour from `LOOK.hours`, lays the room's light over it
(`LOOK.rooms[id]`) and returns the sky gradient, the sun (colour, intensity, elevation, azimuth,
shadow strength), the body with its `visibility`, stars, cloud, `haze` (room × weather), a planet for
a room in space, the hemisphere fill, and `lampsOn`, `windowsLit`, `snow`, `wet` and `dark` (0 at
noon, 1 on a stormy night). The weather is applied *over* the hour; the overcast grey is the hour's
own horizon mixed down, so a grey dusk is warm and a grey dawn pink. **The hour survives the weather**
(`sceneLighting.test.ts`): a storm keeps 40% of the sun and adds a quarter to `dark`; snow mixes sky
and ground light towards white by the hour's own light, the night's blue after dark. **A fog closes
the air** (`LOOK.vista.haze.weather`, 4.5× a clear day); rain and snow thicken it; a cloudy sky veils
the body. `rigCssVars` exposes the rig as `--sky-top`, `--sky-horizon`, `--scene-tint`,
`--scene-dark`, `--sun-dx`, `--sun-dy` for the board, the overlay and the rooms page.

**The sun's place is composition.** Azimuth 0 is `+z`, behind the camera; 180 is straight ahead. At
dawn (205°) and dusk (158°) the sun is low, ahead and in the frame, lighting the room from behind. At
noon it is high and to the side (130°, 48°), out of frame: a noon lit over the shoulder has no
visible shadow. At night the key light is the moon, high enough to cast (24°), while its disc is
drawn low. A room moves these (`LOOK.rooms[id].sun` / `.body`, `null` takes one down: orbit takes the
moon out of the moon's sky). `sceneLighting.test.ts` pins the rules; `sceneVista.test.ts` pins that
**every body up in a clear sky lands between the frame's top edge and the horizon**, per room and
hour, at 16:9.

**The sky's fill is strong enough to read the shade by** (`LOOK.hours[h].ambient`): lit from behind,
every face turned to the table is in shade, and so is most of the near floor; under a front-lit fill
that shade was a navy silhouette. The warm sun stays warmer and stronger than the sky at every hour.

### The sky (`scene/dome.ts`)
A dome round the camera, one shader, **a mesh rather than a pass** because the water mirrors it and
the bloom must see the sun's disc. It writes no depth and is drawn first, so the passes read it as
"nothing" (depth 1) and leave it out of the occlusion and the air. In order: the gradient (`curve`
sets the climb — the hours carry the sky that is *seen*, deep and saturated); the aureole on the
light's side; the body's halo, tight (`haloSize`, 2.5° — wide washes the band white); the stars,
thinned to the horizon; a cloud layer overhead in perspective, lit towards the light; the body over
the cloud's thin edge. **The clouds' projection is softened at the horizon** (`d.xz / (up + 0.05)`):
a hard floor drew pale vertical bars on the far hills. A room in space (`LOOK.rooms.orbit.space`) has
a black sky, stars at every hour, no cloud, and a planet lit by **its own sun** (`planet.lit`) —
lit by the room's key light it showed its night side.

### The kit and the builders (`scene/kit.ts`, `scene/maps/*.ts`, `maps/vista.ts`)
A builder never touches three.js. It calls `box`, `cyl`, `sphere`, `cone`, `prism`, `disc`, `halo`,
`plate` and composed props (`window`, `door`, `lamp`, `lantern`, `tree`, `bush`, `rock`, `stall`,
`bench`, `fence`…); `build()` merges every block into five meshes (lit, glow, ink, shadow, halo).
`maps/vista.ts` holds what rooms share: `vistaTable`, `hills`, `skyline`, `sailboat`, `deck`,
`neonText`, `groundInlay`, the turned pieces. Each builder's header names its three grounds.
- **Every block is outlined in a darker note of its own colour** (`inkFor`) — the ink rule, bent for a
  room of ten thousand objects. An inverted back-face hull, **a fixed number of pixels where the block
  stands** (`KitOptions.outlineAt`, from `view.tileAt`), **thinning to `inkFar` by `inkFade` tiles**
  (full-weight lines on the far shore read as a scribble). A wall darkens towards its foot
  (`LOOK.material.footShade`).
- **Colour is a vertex attribute, and the light is a light** (`scene/lighting.ts`, `scene/shade.ts`):
  one rough, matte `MeshStandardMaterial` that casts and receives.
- **One PCF shadow map over the near ground** (`LOOK.shadow.reach`: 16 tiles either side, 42 back, 12
  up, fitted in light space) — where a shadow can be seen. **A room whose middle ground is planted
  reaches further** (`LOOK.rooms[id].shadowReach`; velvet 30 and 165). `sceneShadowReach.test.ts`
  fails on a tree or street lamp outside its room's reach **or floating off the slab under it**.
  **PCF, never VSM**: three keeps VSM moments in half floats, which quantise a shadow edge into a
  staircase at a metre a tile. **`normalBias` is 0.03**, sized for a metre a tile.
- **The weather is answered in the kit, once**: `snow` caps flat tops and whitens ground and foliage,
  `wet` darkens the ground the builder names, `lampsOn` decides whether a lamp head, window, neon tube
  or lantern goes in the unlit `glow` bucket. A builder says "this is a lamp"; the kit says how one
  looks tonight.
- **Every decision is seeded** (`scene/rng.ts`, mulberry32 on the scene's key): every seat sees the
  same place, and refresh does not rearrange it.
- **The near ground frames; it does not fill.** Two things at most per side band, at or a little
  behind the table's depth, tall enough to cut the top of the frame where that frames the view.
  **Floors are laid across the frame** (`deck`), never fanned round the table (a whirlpool on a wide
  lens).
- **The far ground is layered, and nothing in the middle may hide it.** Hills are flat cones in runs,
  each layer farther, lower and bluer. **A landmark stands where the frame holds it** ("The band at the
  top"); a seat pill covers the top centre of every frame, so nothing that matters is put there alone.
- **Unlit neon keeps its colour a shade down** (`neonText`), never grey.
- **A sign is glass tubes bent along the letter on a dark panel, never a bitmap of blocks**
  (`neonText`, stroke font `GLYPHS`): lit, each tube is its colour with a near-white core; the glow is
  the bloom's, no halo sphere. **Nothing is planted between a sign and the table** (velvet's
  `acrossSign`).

### Props that were the same mistake in every room (`scene/kit.ts`)
- **`awning`** starts *at* the wall and carries a valance, never a plate hovering off the façade.
- **`stall`** has four visible legs, never a striped roof floating over a box.
- **`tree({ kind: 'palm' })`**: a frond in two segments, out then steeply down.
- **A prism's `w` is its ridge**: a roof rotated by `π/2` swaps `w` and `d`.
- **The kit's crates and barrels are the pirate kit's where it is loaded**; a builder wanting a plain
  crate draws its own boxes (Marina).

### The render (`scene/render.ts`, `scene/sceneCache.ts`)
- **One frame, then the context is released.** The board's compositing budget belongs to the cards,
  so the room is rendered **once**, copied into a 2D canvas, and its geometries and WebGL context
  disposed. Everything that moves is a CSS transform layer.
- **The weather is drawn tiles** (`weatherTiles.ts`, `WeatherLayer.svelte`): rain, snow, fog drift,
  the storm's flash, the cloud shadow, each a transform animation on a seeded bitmap drawn once per
  tab into a canvas and handed over as a data URL (`img-src` allows `data:`). Shapes near an edge are
  drawn again one tile over so the tile wraps; the shapes are pure (`rainDrops`, `snowFlakes`,
  `fogBlobs`, `dustSpecks`) and are what `sceneWeather.test.ts` asserts. No canvas → empty URL, a dry
  room, never a throw. Under reduced motion every sheet holds its first frame and the flash and bolt
  go away entirely.
  - **Every sheet travels exactly one tile per cycle**: `tiled()` writes the tile as the background
    **and** as `--tile-w` / `--tile-h`, and the keyframes (`fall`, `drift`) travel by those variables,
    never a literal or a percentage, or the pattern lands elsewhere than it left. **The wind is a
    skew** (`.wind`), never a diagonal travel, which would only wrap at angles the tile's shape
    allows. Snow sways on an outer element and falls on an inner one. Nearer is faster and brighter
    (`FALL_S`, `DRIFT_S`, `SWAY`), never past ~550 px/s.
  - **A sheet covers the frame for its whole travel at any size** (`sheetBox`): a tile of overhang
    the way it travels, the lean's reach in the frame's height (`cqh`). Proven 320–3840 wide,
    320–2160 tall.
  - Rain and snow: three sheets on `high`, two on `medium`, one on `light`; fog two, two, one.
    Lightning is a sheet flash plus the bolt's glow off one top corner. A `dry` room (Orbit) gets dust
    and the flash in a storm, never rain.
- **The weather is shed** (`scene/weatherLoad.ts`, `weatherLoad.test.ts`). It is the one thing a match
  costs per frame: in software compositing at 1080p a clear board draws in 7 ms, a storm on `high`
  in 27 ms (about 5 ms a falling sheet, 3 for the splash sheets, 2 for the mist, 1 for the
  lightning); the rendered room itself is an opaque blit. Measure with Chrome `--disable-gpu`
  (`Display::DrawAndSwap` in a `viz` trace) — a real GPU hides fill rate entirely.
  - Under `auto` the cadence is sampled off `requestAnimationFrame` in bursts; a device under
    `LOAD_FLOOR_FPS` for `LOAD_BAD_WINDOWS` windows gives up one step of sheets (`weatherTier`), then
    the other.
  - **Only the sheets, never the graphics tier** (part of the room's cache key: moving it renders the
    room again). **A tier the player chose is never touched.**
  - **The statistic is the mean of every frame under `LOAD_HITCH` × the window's median.** Frames
    over time read a re-render as slowness; the median is fooled by a 60 Hz panel missing every other
    refresh (45 fps, median 60); trimming a share of slow frames flatters the same device.
  - **One-way, never stored, asleep between bursts** (`LOAD_RECHECK_MS`): a sheet given back blinks
    all match, a detection is not a choice, and a running rAF loop costs the main thread. It starts
    only once the room has landed (`settled`). Two governors can be alive (loading screen and board),
    so a step is given up *from the level it was measured at* (`shedWeatherFrom`). A browser capped at
    30 fps loses its extra sheets: it asked to spend less.
  - **A static layer covers only the band it is seen in** (`.mist`, `inset: 58% 0 0`), and **the frame
    a re-render replaced is given back** once the fade is over (`SceneBackdrop`'s `release`).
- **The frame is supersampled and brought down in linear light** (`QUALITY[tier].supersample` /
  `.glPixels` through `supersampleFor`; `post.ts: RESOLVE_FRAG`): up to 2× a side (3× on `high`;
  `light` multisamples instead — no tier does both), kept in a float target unencoded, and each bitmap
  pixel gathers its texels through a Mitchell–Netravali kernel (B = C = ⅓, two pixels wide), sRGB
  encoded once after. `drawImage` over encoded bytes darkens every thin bright line; the plain path
  (`light`, no float target, a failed chain) still uses it. The side is capped by the tier's `maxSide`
  **and** the device (`MAX_TEXTURE_SIZE`, `MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`); `high` goes
  to 8192 and 16 Mpx, `medium` and `light` 4096. The table's grain is filtered anisotropically at the
  tier's figure (16, 8, 4, `setGrainAnisotropy`). Resolution is the viewport at `devicePixelRatio`
  capped by `MAX_DPR` (2) and `MAX_SIDE` (2800) (`renderSizeFor`), and **`renderSizeFor` reports the
  ratio the size was solved at**: the felt is converted to device pixels by it before the camera is
  solved, and the screen's ratio after a cut builds the table too large and off to the side.
- **And then it is photographed** (`scene/post.ts`, `scene/quality.ts`, `sceneQuality.test.ts`), in
  order: the **occlusion**; FXAA; the **bloom** (a bright pass at a quarter of the frame, blurred
  twice, scaled by `rig.dark` and `LOOK.vista.bloom`, plus a wide one at a sixteenth, both added
  **after** the air — "A light is a light"); a **lens focused on the table** (soft from twice the
  table's distance to forty times, `LOOK.vista.dof`); the **mist** and the **air**; the **tone curve**
  with exposure (ACES); a grade (shade cool, light warm, a touch of saturation and contrast about
  mid-grey); a vignette; a colour fringe in the corners. **No grain**: the player refused fine noise
  over any surface, the frame included; `sceneQuality.test.ts` fails on a composite that noises the
  frame.
  - **The occlusion is screen-space from the frame's own depth**: creases the shadow map cannot see.
    Positions are **rebuilt through the inverse projection** (`VIEW_PARS`: `uProjInv`, back to uv
    through `uProj`), exact under any camera; the sky is left alone. Normals from depth differences
    (the smaller of each pair). Uniform hemisphere samples at two radii (1.8 and 0.45 tiles), at half
    resolution, blurred depth-aware, **multiplied in before the bloom and focus copies** (`litRT`). An
    occluder much nearer than the sample is not a crease (or every silhouette gets a dark halo). The
    per-pixel rotation is interleaved gradient noise (a sine hash streaks).
  - **The occlusion has a floor** (`LOOK.ao.floor`, a half): the floor under the table is the widest
    crease in every room and, unbounded, the bottom third of the frame was black.
  - **The air** (`AirOptions`, `LOOK.vista.haze`): every non-sky pixel takes up to `max` of the sky's
    low colour by distance (`1 − exp(−d / distance)`), loses up to `desaturate`, and **glows towards
    the light** (the light's colour by a power of the cosine to it, weighted by the body's
    visibility). The room's `haze` and the weather scale it; the moon has almost none.
  - **Colour is the contract with the plain path**: the scene renders into a half-float linear target,
    the passes work in linear, the tone curve is applied **once**, in the composite, with three's own
    functions, and the composite ends on `colorspace_fragment`. The composite includes the
    tone-mapping chunk only when three has not prefixed it (`#ifndef`) — twice is a redefinition and a
    black room. The plain path gets three's `Fog` in the air's colour.
  - **It runs once and releases everything with the context**: every target disposed in a `finally`,
    a throw anywhere falls back to the plain render (`photographed`), never to no room. **Every target
    is checked before it is drawn into** (`assertComplete` throws on an incomplete framebuffer), and
    a GPU with no float render target (`floatTargets`) never starts the chain. A software GPU gets the
    plain frame unless tooling asks for `?gfx=force`.
  - **Which passes run is the tier's** (`QUALITY`): `high` up to 3× with a 4096 shadow map and every
    pass; `medium` 2×, 2048, the occlusion, FXAA, bloom, mist and vignette; `light` the lit, shadowed
    (1024), multisampled frame alone. **Every tier is lit and shadowed** — the room renders once, so
    light is never a frame budget. The tier is the player's (`state/graphicsPref.ts`, `autoTier` under
    `auto`) and **part of the cache key**.
- **A room is built on the main thread, so its cost is measured** (`render.ts` logs the solved view
  and the frame time in DEV): under a second on a laptop; a skyline is what costs, so a far band draws
  fewer panes (`SkylineOptions.windows`) and no floor glass (`ribbons`).
- **The room is built exactly once per match**, and four things guarantee it:
  - **The felt is solved for the box the board fills** (`GameView`'s `frame`: the measured
    `.container`, else `viewportSize()`, read synchronously), and the gate renders at that same box
    (`mapPreload`'s `frame`), never `innerWidth × innerHeight`: on iOS the page is `100dvh` and
    Safari's `innerHeight` is a toolbar off it, which put the rendered table ~50px above the CSS felt.
    `<SceneBackdrop />` refuses a felt with no size.
  - **`safeAreaInsets()` reads synchronously too**: an inset filled by an effect is a second render on
    every notched phone.
  - **A frame within 4% of the size asked for is stretched, not re-rendered** (`sizeCloseEnough`,
    `sameFelt`).
  - **A render in flight for the same room, felt, tier and look is joined** (`prepareScene`).

  `sceneLoadingGate.test.ts` owns the first three, `sceneCache.test.ts` the fourth.
- **`make visual` waits for the room**: `tools/visual/shoot.mjs` waits for `.scene:not(.bare)`.
- **The engine is a lazy chunk.** `sceneCache.prepareScene` is the only importer of `render.ts`,
  through a dynamic `import()`, so three.js never reaches the home page, a waiting room or a content
  page; the map-loading gate absorbs the fetch (`sceneCache.PROGRESS`). Nothing else imports three.js.
- **The loading bar moves because the render yields to a paint between phases** (`scene/nextPaint.ts`,
  `sceneProgress.test.ts`): a report is followed by two animation frames, and `renderScene` reports
  `RENDER_STEPS` (build, merge, draw, then the sprites a few at a time). A `setTimeout(0)` is not a
  paint. Anything new and heavy goes between two reports, never inside one.
- **And it ends full**: the settle sets the bar to one, paints it, holds it `MAP_BAR_FULL_MS` past
  `.fill`'s transition, and only then publishes `done`, which sends `map_ready`. Zero hold under
  reduced motion; 12s plus the hold stays far under the server's 20s `map_load_timeout`.
  `mapLoading.test.ts`.
- **A render that fails is a scene, not an error.** No WebGL, a lost context, a throwing builder,
  models that never arrive: the request resolves with a null bitmap, `<SceneBackdrop />` shows the
  rig's sky gradient, the gate is answered. A failure is remembered `FAILED_TTL_MS` (10s), never for
  the tab; a lost context (`isContextLost()`, `OUT_OF_MEMORY`, asked before and after the copy) is a
  failure; the frame is copied out before the report's paint (no `preserveDrawingBuffer`); models
  get `MODELS_TIMEOUT_MS`.
- **Nothing pale is shown while the room builds** (`.scene.bare` mixes the hour's sky down over the
  void), **and nothing of the board: the curtain is opaque from its first frame** — the fade belongs
  to `.room`, never `MapLoadingScreen`'s `.screen`. `sceneLoadingGate.test.ts`.
- The board and the loading screen share the frame, sharp. The cache holds three frames, LRU, keyed
  on the scene, device size, **felt**, tier and look.
- **The backdrop isolates its own stack** (`.scene { isolation: isolate }`, `sceneBackdrop.test.ts`),
  or its z-indices climb over `.stage`.
- **A resize is a stretch, then one render** (`RESIZE_SETTLE_MS`, 240ms), **faded in over** the frame
  it replaces (two stacked canvases, only the incoming animated, `--scene-fade`). A moved felt needs a
  render whatever the width did.

### The models (`scene/models/`, `scene/placer.ts`, `tools/models/pack.mjs`)
A few props are drawn models — Kenney's kits and two Quaternius pieces, all **CC0**
(`client/public/models/CREDITS.txt`, `NOTICE.md`), imported only through the kit.
- **The manifest is the allowlist** (`models/manifest.json`): per kit, its archive, the scale into
  tiles, the palette colours that glow after dark, the models by name. `make models` copies exactly
  those under `client/public/models/`; the result is committed. **Served from this origin, never a
  CDN.**
- **A model is baked once per tab** (`models/lib.ts`, `bake.ts`): palette into vertex colours, scaled
  into tiles, stood on `y = 0`, smoothed normals kept for the hull. **Then it is a block**: `k.model`
  transforms it, shades the foot, pushes the hull, sends glow colours to the unlit bucket after dark,
  lighting a house's windows by the hour's share one house at a time (`spotChance`).
  `kitModels.test.ts` pins which way a drawn person faces (+z; the astronauts -z and
  `ASTRONAUT_MODEL_YAW`).
- **Nothing stands inside anything else** (`placer.ts`, `placer.test.ts`): every `k.model` claims its
  footprint, is refused when it is taken, **and a refused model leaves the spot empty**.
- **A room loads the kits it places and no others** (`maps/index.ts: KITS`, `roomModels.test.ts`).
  Three rooms load none.

### What moves (`scene/life.ts`, `scene/LifeLayer.svelte`, `maps/vistaLife.ts`)
A rendered-once room cannot move, so what moves is **a sprite over it** (a gull, a boat crossing the
bay, a falling petal, a puff of smoke, an airship), built with the same kit under the same light,
rendered to its own bitmap **in the same pass**, and carried along a route by one Web Animations
transform. **One transform animation per element**: the route on `.actor`, a bob on `.body`, a spin
or puff on `.face` — two on one element do not add up. Reduced motion holds every actor on its
route's first point and **is followed live**.
- **A route is in the world, and the render projects it** (`Actor.world`, `render.ts: vistaSprites`):
  the actor is built at the route's first point, **photographed with the room's camera cropped to
  it** (`setViewOffset`), every point projected into the frame (`Actor.path`), and the scale written
  at each (`Actor.scales`, first depth over each depth), **on the same transform as the translation**
  (`routeKeyframes`). A route that never enters the frame is dropped. The air is laid on a sprite as
  `FogExp2`, and it goes through the room's tone curve and grade (`makeSpriteGrader`) — never the
  vignette, fringe or focus. No shadow.
- **Keep a route clear of the near props.** A sprite is drawn over the whole frame, so a route behind a
  lamp post passes in front of it. Routes run in the sky, on open water and across the far bay;
  nothing walks the near ground. `sceneLifeOcclusion.test.ts` projects every route against every lamp
  post nearer than it, in four frames.
- **What hangs in the sky flies in front of everything that reaches into it, placed by the frame and
  never at a height in tiles** (`vistaLife.ts: skyAltitude`, `skyRoom`): the sky band is a sliver on
  an ultrawide and a slab on a monitor, so an airship stands halfway down it, takes at most 0.6 of it
  (`airship`'s `maxTall`), in front of the skyline's first row and clear of palms, lamps and fountain.
  Drawn over a nearer tower and cut by the top edge, it reads as an unfinished building in the sky.
  `sceneSkyActors.test.ts` checks every route slower than two minutes against every nearer block and
  the top edge, in four frames.
- **A `loop` either walks its closing leg or fades over it** (`closesTheRing`, `sceneLife.test.ts`): a
  visible wrap is something teleporting home.
- **A boat sails bow first, one way, and never comes back** (`driftingBoat`): out of the haze and back
  into it (`BOAT_FADE` at each end). A `bounce` sails it home stern first; `turn` flips a hull on the
  spot. A boat too near to fade is **at anchor**: one point, rocking.
- **A pass writes its opacity on every frame**, or it fades across its whole crossing.
- **The layer is laid out in the frame's CSS pixels and scaled to the element**, z-index 3, above both
  frames and under the weather (4).
- **A sprite is keyed on the actor's id within the room**, seeded on the room's key plus that id.

### The room is quiet
The mood at a card table is **contemplation**: a place a spectator rests their eyes on for twenty
minutes, whose big moments are the cards'. A full, busy room was tried and found stressful.
- **A few things, slow, at the edges and in the sky**: two framing props a side, one landmark a room,
  a couple of boats, two or three birds, never a crowd, nothing crossing the table.
- **Windows are mostly dark after dark** (`WINDOWS_LIT_MAX`, a half, under every weather), which is
  also what makes the lit ones read. Model houses take the same share one at a time.
- **A round halo is a lamp head's, never a building's** (`HALO_SPHERE_MAX`, 0.8 tiles,
  `kitHalo.test.ts`): an additive sphere over a tower is a veil the player sees through.
- **And it has no edge** (`fadeToRim`): bright facing the table, nothing at its rim, baked into its
  vertices; a flat translucent sphere is a frosted disc. `sceneLights.test.ts`.

### A light is a light, not a coloured dot (`post.ts`, `kit.ts: lamp`, `sceneLights.test.ts`)
- **A light shines through the mist and the air instead of sinking into them like a wall**: the
  composite reads how much of a pixel is a light (`LOOK.post.emitFrom` / `emitKnee`, after dark only)
  and lets that much through (`pierce`).
- **The bloom goes on after the air**: it is the light the air scatters towards the lens.
- **A second, wide bloom lays the glow round a light** (`bloomWide`, `bloomWideSpread`), scaled by the
  hour's `dark` and thickened by the weather's air (`bloomWeather`): a lamp in the fog is a ball of
  light.
- **A drawn street lamp's bulb is hung by the kit at the end of its arm** (`models/bake.ts:
  lampHead`), with the pool under the head: the model's own bulb faces the ground.
- **The fog's veil is the hour's colour, never a fixed white** (`WeatherLayer.svelte`'s `.veil`, the
  hour's horizon mixed in by `--scene-dark`), and the banks thin after dark. Scene
  `game-map-velvet-night-fog`.

### The table (`GameBoard.svelte`'s `.tableOval` / `.tablePlinth` / `.tableGlow`, `TableTrack.svelte`)
A felt inside a rim on exactly `tableRect()`, and **a table of its own in every room, in a noble
material**: Neon piano-black lacquer banded in chrome on a chrome tulip foot, Rune quartersawn oak and
bronze on two balusters, Velvet walnut burl and gold on a stepped black marble column, Orbit brushed
titanium on a tripod, Sakura vermilion urushi banded in gold on four lacquered legs, Marina varnished
teak and brass on a capstan. `MapDef.table` (`maps.ts`) holds the colours (`felt`, `feltDeep`, `rim`,
`rimLight`, `grain`, `base`, `inlay`, `fleck`, `baseVein`) and names the rest (`rimKind`, `edge`,
`pedestal`); `tableMaterials.test.ts` refuses two rooms with the same table. Without a scene the
variables fall back to the tokens' near-black table.

- **The CSS rim is its material, drawn** (`cards/tableSurface.ts`): an SVG whose only content is a
  filter (fractal noise shaped into the material's colours: rings, a burl's swirl, brushing, a
  lacquer's depth), served as a `data:` URI. No canvas and no script, so the same string is the
  board's rim, the racetrack's `<pattern>` and the rooms page's rim at build time; seeded, so every
  seat sees the same table. A glossy finish carries the room's light (`rimGloss`, `RIM_GLOSS`).
- **The felt carries no texture and no mark**: its cloth is its colour and the light on it. (A mark at
  7% showed only as the duck's wing tips either side of the piles, read as a rendering fault.)
- **In a room the render is the table, and the CSS one is the fallback.** `vistaTable` builds the
  **cloth** (a `MeshPhysicalMaterial` with a sheen, `LOOK.table.cloth`), a **metal filet**, a
  **racetrack** in the rail's material stained darker, and a **rail** rising
  `LOOK.table.rail.height` and rolling into the edge's face; the board then draws none of its own
  (`.tableOval.rendered`, no `TableTrack`).
  - **Every line round the table is an ellipse concentric with the felt**: each ring is the felt's
    screen ellipse taken in by the same pixels on both axes and cast onto the table
    (`View.tableOutline(n, inset)`), lofted into one surface (`Kit.loft`). The CSS rim is a uniform
    11px border and the racetrack (`tableTrackEllipse`) the same construction further in. An offset
    curve comes to points at the ends of a flat oval, and bands foreshortened in the table's plane
    read as a bent table. Foreshortening is kept for what lies *on* the cloth (`feltSquash`).
  - **Widths are board pixels** (`FeltAnchor.unit`): rail plus track is exactly `layout.ts:
    CLOTH_INSET`, the line the opponents' hands lie inside. The rooms page's still takes a felt 1100
    board pixels wide.
  - **A table has a lamp over it** (`lighting.ts: makeTableLamp`, `LOOK.table.lamp`): a warm spot
    straight down from 3.4 m, fading over its cone, stronger as the room darkens. Without it a table
    at dusk, lit by a sun a few degrees up, is black.
  - **The lamp is the table's alone, and it casts the table's shadow**: its own small shadow map
    (`lamp.shadowMap`), and the room's lit material takes no spot light (`kit.ts: LIGHTS_NO_LAMP`,
    the spot loop's guard replaced by `#if 0`). Either half alone lights the foot through the top or
    draws a hard dark disc on the floor. Only the finishes (`finishMaterial`) take the lamp.
    `tableMaterials.test.ts` pins the shadow and that three still writes the line the replace looks
    for (`SPOT_LOOP_GUARD`) — a reworded chunk would make it a silent no-op.
  - **A finish shows a share of its own colour whatever the light** (`FinishLook.glow`): the key light
    is ahead of the camera, so every face turned to the player is in shade, and the cloth's colour is
    the table's identity.
  - **A varnish never throws its whole highlight back** (`FinishLook.specular`; the lacquer has no
    clearcoat): at full strength the lamp and the low moon came off the rail as a white smear. Woods
    keep a quarter of their gloss as varnish (`vista.ts: COAT`). Reflections are held down
    (`LOOK.table.envIntensity` 0.3).
  - **The grain is rings and depth, never dots** (`scene/grain.ts`, `cards/tableSurface.ts`): pores,
    eyes and flecks read as scratched or dirty from the chair, and are fine noise, refused
    everywhere. `fleck` stays a field of `TableMaterials` and is drawn by nothing. Rings stay under
    half the way to their second colour (`tableMaterials.test.ts`), and the render brings that colour
    45% of the way to the rim's (`rimFinish`).
  - **A loft is wound the way its normals face, per triangle** (`loftGeometry`): a two-sided material
    lights a face wound against its normals from behind. A ring drawn in to a point takes the next
    ring's outward way, or its normal is zero. `tableMaterials.test.ts` checks every triangle.
  - **The render is the table only while it lies under the felt** (`sceneCache.tableFits`,
    `SceneBackdrop`'s bindable `tableDrawn`): a stretched frame the felt follows in proportion still
    is; one the felt has left is not, and the CSS table stands in until the next render. No WebGL, or
    the E2E suite: the CSS table throughout.
  - **Rain's rings stay off the cloth** (`WeatherLayer`'s `clear`, a mask with the felt cut out); the
    streaks still fall in front.
  - **The hands lie on the cloth, never across the rail** (`rimLayout`): set in from the rim by
    `CLOTH_INSET` plus their reach, then drawn in until every corner of the fullest fan is inside the
    cloth's ellipse. `seatLayout.test.ts`.
- **The render's edge is swept, turned and finished, not blocked** (`vistaTable`, `Kit.sweep` /
  `Kit.lathe` / `Finish`): a profile (`EDGES`: knife, square slab, ogee, bullnose) swept round the
  outline and never past it, a turned pedestal (`LatheGeometry`), each piece a `MeshPhysicalMaterial`
  whose numbers are `LOOK.table` and whose grain is `scene/grain.ts`. The one object in the room that
  is not a matte block, because it is nearest the camera; it takes no ink hull and no snow cap.
- **The materials never follow the hour; the light does.** `--tbl-*` are constants per room; the rig
  hands the table `--scene-tint` and `--scene-dark`.
- **In a room the rim's edge is a darker note of its own material** (`inkFor`). Without a room the CSS
  carries the whole object and the three rules: the ink line, the hard `0 16px 0` thickness, the soft
  shadow, `.tablePlinth`. In a room the CSS draws neither thickness nor cast shadow: the render
  carries both.
- **The rooms page shows a photograph of the render, and nothing over it** (`content/TablesArticle.svelte`,
  `src/dev/RoomStill.svelte`, `tools/rooms/shoot.mjs`, `roomsPage.test.ts`). `make rooms` opens the
  `room-still-<id>` scene for each room (alone, its signature hour, clear sky, 16:9, `?gfx=force`)
  and writes its still under `src/assets/rooms/`. The hour is written twice — `SIGNATURE` on the page,
  the scene list in `scenes.ts` — and the test pins the two. The CSS table (`.roomTable` /
  `.roomGlow` in `content.css`) only stands in for a still not yet shot, on the ellipse the render
  builds its table under (centred, 70% by 50%). Re-shoot after touching a builder, the kit, the rig
  or the passes.

### The floor, the near ground and the table's top
With the felt at 78% of the width, the "background" a player sees for a whole match is mostly **the
floor round the table and the few things standing on it**, so those carry the room.
- **The floor is drawn round the table** (`vista.ts: groundInlay`): bands on the table's plan grown
  outwards, in the room's materials (brass and cream marble on velvet's black floor, two rings of
  light on neon's deck, a rush mat bound in black and gold at sakura, a painted berth on the quay, a
  ring of dressed stone at rune, the pad's marking on the moon). `y` is the floor's level (orbit's
  plates and rune's cobbles stand proud of 0). **None under snow.**
- **The table's shade lies on the floor at every hour** (`Kit.shade`, `pools.ts: Shade`,
  `LOOK.table.shade`): the lamp lights the table alone, so nothing else stands it on the ground. An
  ellipse in the alpha of the pools' map, multiplied in on the ground before the pools' light, so the
  map is made by day too.
- **A floor is polished only where the mirror's plane is the floor's** (`Kit.polished`; the larger of
  it and the rain's `wetMirror` wins). Velvet's marble, neon's deck, sakura's boards and orbit's plates
  ask for it. **Marina must not**: its mirror plane is the water, 1.3 tiles under the deck. Never
  under snow.
- **What stands within reach of the table is turned, in a finish** (`Kit.lathe` in a `Finish`: `pot`,
  `cask`, `bollard`, `brazier`, velvet's `standardLamp`, balustrade and column): no ink hull, a
  material that takes a highlight — an urn, not a box with a bush on it. **A finished piece takes no
  snow cap**; where one matters the builder lays it. Light near the table is a pool on the floor
  (`k.pool`); a string of bulbs is `festoon`.
- **Rune is lit by fire** (`brazier`): a round body under two tongues in deep orange — the bloom is
  what makes it pale.
- **The top is a cabinetmaker's** (`vistaTable`, `LOOK.table.rail`): the rail's crown, a filet at its
  foot and another at the cloth's edge, and `marks` lozenges of the same metal let into the racetrack
  (`Kit.patch`). **A room with its own electricity draws those lines in light**
  (`TableMaterials.glow`, `Finish.lit`: neon, orbit), weaker with the lamps off; the CSS table keeps
  `inlay`.

`sceneGround.test.ts` pins the shade, the inlay and its absence under snow, where a floor may be
polished, the lozenges and the lines of light.

### A painted room (`scene/plates.ts`, `scene/plate.ts`, `tools/plates`)
All six rooms are **one painting each**, at the hour the rooms page shows them (neon night, rune dusk,
velvet dusk, orbit night, sakura day, marina dawn). The block builder stays: the painting is made from
it, and it is what is shown when the painting cannot be had.

**How it is made.** The guide is the block room itself (`?bare=1`: no table and no inlay, both of
which follow the felt), shot at 16:9 where the camera's lens is widest (84°). An image-edit model run
locally (FLUX.2 Klein 4B in ComfyUI) repaints it **in two passes** (`tools/plates/paint.py`): the
strip above the floor alone, which keeps every object where the guide has it, then the whole frame
with that strip declared finished, so the floor comes out under it in the guide's perspective. Asked
for the whole frame at once, the model moves the camera (raises the horizon to 25–40%), which puts
the room off the top of the screen. Prompts ask for few, large features and no fine pattern (marble
"almost without veins"); a floor's prompt names what stands on it (sakura's cushion and tea table);
`paint.py floor --dim` darkens a guide floor that would come back too bright (neon); no prompt asks
for lettering except velvet's marquee. Strips are chosen by eye among three; `plates.ts` records the
seeds. Neon's guide uses its own clear-sky scene (`game-map-neon-clear`).

**How it is shown: laid by its lens, never by its edges.** A floor seen from the same height through
another focal length is the same picture scaled about the horizon, so each frame reads the plate by
`plateUv`: **the two horizons laid on each other, scaled by the ratio of the focal lengths**. A plate
entry carries the lens it was painted through, and **those numbers are `solveView`'s for the frame its
guide was shot at** (`scenePlates.test.ts` compares them). Past the painting the sky stretches up, the
sides and foot are mirrored, and the floor under the foot fades into its darkest note (a phone looks
much further down than a monitor).

**In the render.** The plate is a sheet on the far plane, drawn first, writing no depth: the passes
take it for sky.
- **It leaves through the tone curve backwards** (`plate.ts: untone`: three's ACES fit, matrices and
  rational curve inverted), so the frame's curve gives back the painting.
- **No lens blur**, and **no mist pass**: the plate carries the weather's air itself as a veil in the
  sky's low colour, thickest at the horizon (`LOOK.plate.veil`, scaled by the weather).
- **A share of the bloom** (`AirOptions.bloomScale`, 0.3): a painted lamp already has its halo.
- The table's shade is its own sheet on the ground (`makePlateShade`). The block room's sprites do
  not move over a painting: over a painting they are stickers.

**What a painted room gives up**: its hour (`plateHour`, `resolveScene`: the painting's, whatever is
dealt) and the weather's marks on the room. Rain still falls and fog still veils it. **A plate that
will not load is the block room.**

#### The table beside a painting (`TableMaterials.paint`, `Kit.band`, `tools/plates/trim.py`)
The table cannot be painted — it is the felt cast back onto its plane, a different shape in every
frame — but what it is made of can. The render dresses it in two strips, each a moulding painted
square on, four times as long as tall:
- `rail`: the top of the rim from its outer edge over the crown and across the racetrack to the cloth.
- `side`: a straight apron under the edge (`LOOK.table.apron`, 22 cm); a moulding painted flat wants
  a flat face.

`Kit.band` lays a strip `repeats` times round, mirrored end to end, so `repeats` is even and the strip
need not tile (`trim.py --ship` finds the moulding's rows and trims its turned ends). **Both strips or
neither**: one that will not load leaves the table its plain materials, lozenges and all.
**A strip's ornaments are large and few** (about eight a strip, smooth wood, drawn out along the table
by `LOOK.table.stretch`, 1.7 for the rail): the rail is forty pixels across, and dense ornament is a
row of teeth. No strip asks for anything that could be read. The `painted` finish shows 0.72 of its
own colour whatever the light, or the near side is a dark band. **The cloth is never painted**: it is
what the cards are read against, and it keeps its inlay. Lines of light stay over the painting.
`sceneTableTrim.test.ts`.

### The band at the top: a landmark has to be large enough to be one
The far ground is a strip some 270px tall at 1080p, half of it sky. With the focal length near 1250px
at 16:9, a thing `H` tiles tall at `D` tiles is `1250 * H / D` pixels, inside the 140 of sky, and the
air has taken 0.75 of its colour by a few hundred tiles. So a landmark is large enough, near enough to
keep a colour, and stands where the frame holds it: sakura's mountain is 440 tiles tall at 4300 under
a white cap, its pagoda in the gap between the two cherries at 450; marina's lighthouse on a rock
behind the breakwater at 430, beside the low sun; rune's peaks are faint snow-capped cones at 3500,
deep blue. `sceneLandmarks.test.ts` projects the mountain and the lighthouse at three frames.

**A skyline's tower is piers, panes taller than wide, and a crown** (`vista.ts: skyline`, `crowns`):
piers a shade lighter than the wall, setbacks, a mast with its red light, a band of light under the
cornice. **The crown is drawn from the tower's place** (`spotChance(x, z)`), never the room's
sequence, or every palm and lamp planted after it would move (the test compares the sequence with and
without crowns).

### The cloth's inlay (`FeltInlay.svelte`, `layout.ts: feltInlay`)
The cloth carries no mark and no texture and is still a board, by light and line:
- the lamp's pool in the room's tint, the cloth going into shade towards the rail;
- a double thread of the rim's metal (`--tbl-inlay`), **concentric with the felt**;
- a medallion under the piles, a shade deeper and ringed in the thread, drawn as **an ellipse of the
  cloth's own proportions**;
- two studs on the thread, only where it is clear of the medallion (`INLAY_STUD_CLEAR`): they stand
  down on a small table.

One SVG over the rendered table and the CSS one alike; its lines pass under the opponents' hands.
`layout.test.ts`.

### The play direction (`DirectionRing.svelte`, `layout.ts: directionArrows`, `pileCentre`)
Two strokes of light laid on the felt round the piles, one down the right and one up the left for a
clockwise table — round the piles because that is where every eye already is; round the rim, half of
them sit under a hand.
- **`direction = +1` is clockwise *on screen*, and the arrows must never contradict the seats**: the
  next player is at the left end of the top, so the table flows 6 → 9 → 12 → 3 (`clockwiseOpponents`).
- **Laid in perspective** (`perspective(900px) rotateX(62deg)`, steeper than a pile, so it clears the
  seats and the pill), near-white washed with the room's accent: a saturated arrow reads as a suit.
- **Each head is clear of the piles** (`ARROW_SWEEP`, 84°; `layout.test.ts` checks the tip against the
  pair's width): laid flat, the circle passes behind the piles above and below, and a head there is
  the heading hidden. **Lit at the head, nothing at the tail.**
- The heading lives in the arrowheads, never the motion: the arrows run a few degrees with the play,
  lit as they set off and gone before they snap back (`dirFlow`, 3.6s), never a full turn, so a
  frozen ring still reads. `<GameBoard />` keys it on the direction, so a Reverse remounts it. Scenes
  `game-my-turn` (cw) and `game-reversed` (ccw).

### What shines and what reflects
- **A surface has a gloss, and a matte one is exactly what it was** (`BlockOptions.gloss`, `kit.ts:
  litMaterial`, `sceneGloss.test.ts`): roughness mixed towards `glossRoughness` by the vertex's gloss,
  the sky (`skyEnvironment`) as an environment for **reflection only**, so gloss 0 renders pixel for
  pixel as matte. Glass, paint, and every slab under rain (`Kit.wetGloss()`).
- **The water and a wet street mirror the room** (`scene/mirror.ts`, `BlockOptions.water`): the room
  rendered once more **flipped about the water's level** (`scene.scale.y = -1`,
  `scene.position.y = 2 · level`) from the same camera — exact for that plane — read at each
  fragment's `gl_FragCoord`; what lies under the water is clipped. **Looked across, the water is a
  mirror at the horizon** (Schlick's Fresnel from `reflect`, 0.12, to one, `uFresnel`), and **the
  swell breaks a reflection into a column down the frame** (`LOOK.water.stretch`): the road of light.
  In the mirror pass up-facing faces are discarded and halos sit out; the sky only tints the water
  (`LOOK.water.sky`). A wet street's reflection is **smeared down and jittered per pixel** (`streak`).
  Half resolution, not on `light`, only where `Kit.reflective`.
- **A lamp lights the ground's own colour, never paints a disc on it** (`scene/pools.ts`, `Kit.pool`,
  `scenePools.test.ts`): a lamp-sized flat halo is a pool in a ground light map the lit material
  multiplies in, full up to `lift` and fading above. **A halo past `washFrom` stays the room's wash**;
  a sprite keeps its disc. Pools are weighed by the hour's `dark`.
- **Mist lies out over the water and fields at dawn and in a fog, never on the lens** (`post.ts:
  mistFor`, the composite's `worldAt`, `LOOK.mist`, `sceneMist.test.ts`): laid by world height
  (`exp(−y / height)`, five metres) in banks, **starting `near` (22) tiles out**, full at four times
  that. A clear dawn has it, a cloudy dawn a little, a fog every hour.
- **The weather leaves marks** (`sceneWeatherMarks.test.ts`): **rain lands in rings** (`splashRings`,
  sheets that come and go in place, resting at nothing); **snow banks against walls** (`Kit.box`
  drifts, from its own seeded sequence, so a mark the weather leaves never moves a house) and caps
  flat tops.
- **Every room has a light of its own** (`LOOK.rooms`, `lightRig`'s third argument): its sky, sun and
  body where its composition asks, sun and sky light pulled towards its colours, its split tones,
  saturation and air. The moon: almost no air, hard white light, the Earth; neon: violet night;
  velvet: brass; marina: teal shade, sand light; rune: an older gold; sakura: pink highlights.
  **None of it may undo the warm/cool split** — `sceneLighting.test.ts` runs it per room and per
  hour.

### Reviewing a room
Scenes `game-map-<id>` (each room at its signature hour), `game-map-<id>-<variant>` (the hour or sky
that changes it most) and `game-map-loading` are the only place a room is reviewable without a server.
The showcase also takes `?time=`, `?weather=` and `?map=` over a scene (dev only). Review at
`--viewports=wide,small,landscape` plus a portrait phone: the camera is solved per frame. Check the
body is in the sky band clear of the seat pills, the far ground is not hidden by the middle, and
nothing near crosses the felt. Judge on the real GPU (`channel: 'chrome'` with `--enable-gpu
--ignore-gpu-blocklist --use-angle=d3d11`) or at `--gfx=force`; otherwise headless Chromium gets the
plain frame. `?lookPatch={"debug":"lit"}` or `"depth"` names the pass that drew something with no
geometry.

## Card face (`CardArt.svelte`, `cardArtSpace.ts`, `locoMark.ts`, `cardTheme.ts`)
Reproduced from the brand's card art. Review any change with `make visual ARGS="--scenes=card-sheet"`
(the whole deck on one screen).

- **The light on a card follows the room; the face never does** (`Card.svelte`'s and
  `CardBack.svelte`'s `::after`): a gloss band at the light's angle (`--sun-dx`) in its colour
  (`--scene-tint`), the stock's edge as two hairlines, weaker as the room darkens (`--scene-dark`),
  **never a dimming**. Off the board the variables fall back to plain white. **No blend mode, filter
  or opacity** — a blend mode promotes every card on the table to its own layer. `card.test.ts` reads
  the rule off both sources. **Realism stops there**: texture, soft shadows as structure or a second
  rendering of the face are refused by the art direction.
- **The piles cast a soft contact shadow** (`Deck`'s `.laid::before`, `DiscardPile`'s `.contact`) the
  way the sun casts the table's (`--sun-dx` / `--sun-dy`) — ambience; the structure is still the ink
  and the band of edges.
- **The face is CSS; the mark is a shared mask image; only the rule glyphs are SVG.** Face, watermark
  and wild fan share the `1000x1500` space as percentages of the card box (both 2:3, so a CSS
  rotation lands where an SVG one would).
  - **The mark is a mask, never a `<path>`**: `MARK_MASK_URL` (and `MARK_MASK_BOLD_URL`) is **one
    string for the whole app**, so the browser rasterises the 130-odd even-odd segments once per size
    and ~50 faces composite one bitmap. One `<svg>` per card cost 2.3–3.3× the frame rate under
    software compositing. Build it per card or per suit and the cost returns. `card.test.ts` fails on
    a live `<path>` carrying `LOCO_MARK_PATH` and on a second mask URL. **Same rule for any new card
    art.**
  - **An `objectBoundingBox` gradient is `to top right`, never the diagonal's angle**: SVG lays the
    gradient on the unit square then stretches it, like CSS's corner keyword; an explicit angle swaps
    the off-diagonal corners on a non-square box.
- **The card box and the mark box are two boxes** (`cardArtSpace.ts`): the card is portrait, the mark
  landscape; reusing the mark's viewBox stretches the duck. Its own module so `CardArt.svelte`
  exports components only (same reason `hasGlyph` lives in `cardTheme.ts`).
- **On a card the mark is cropped and tilted; everywhere else it is whole.** `MARK_CROP_TRANSFORM`
  (`MARK_TILT_DEG` 22°, `MARK_S` 1.95) blows it past all four edges, as the reference art does — a
  centred landscape mark leaves two dead bands and reads as a placeholder. The tilt keeps the zoom
  sane (×2.6 square, ×1.95 at 22°); its sign lifts the duck's head into frame. Below `MARK_S` 1.87
  the dead bands return. `markFitTransform(frac)` is the whole-mark placement. The crop is inside the
  mask, so the gradient never leaves card space.
- **The watermark is the face gradient reversed** (`SUIT_PAINT[suit].mark` is `[to, from]`): brighter
  than the card where it is dark and darker where it is light, so it needs no outline, tint or
  opacity.
- `LOCO_MARK_PATH` is the brand mark: a **geometric wireframe duck**, landscape (`712x576`), 15
  subpaths, **even-odd** (the facets are holes). It comes **straight from the designer's source file**
  (`logo_canard_geometrique.svg`). Do not redraw, retrace or tidy it. Every brand surface (card
  watermark, deck back, logo, favicon) derives from it.
- Suit gradients run bottom-left → top-right at `SUIT_ANGLE_DEG` (35°), values measured off the
  reference.
- **The colour-change card is named by its four suits, never a letter.** The four-suit fan belongs to
  `wild` and `wild_draw_four`; `global_switch` keeps the bare black face and its own glyph, or the
  three wilds are one card at a glance.
- **Rule glyphs are drawn, not typed.** Fredoka carries none of ⊘ ⇄ ⇋ ↻, so the font fallback would
  decide what a rule card looks like — and that holds on every surface, the rules copy included.
  `drawnGlyphs.test.ts` enforces it across every `.svelte`, `app.html` and both copy files.
- **The four ways a match ends are drawn** (`components/OutcomeMark.svelte`). The game-over card is the
  frame most likely to be clipped, and an emoji arrives at a weight and hue the reader's OS chose,
  with neither ink nor shadow. Each mark is the thing itself: **winning is the mark** in
  `--color-secondary`; **losing is the cards still in your hand**, a held fan; **a forfeit is one card
  face down**, with an arrow when the seat that walked is ours. **No trophy, and no face**: a face
  tells a player who just lost how to feel. `size="sm"` puts the win on the round summary's winner
  line, held still inside the type.
- **GlobalSwitch is three cards in a ring, each moving to the next seat** (`rotatingHands`): a single
  circular arrow is the "refresh" pictogram and read as "redraw your hand". Three cards never read as
  Swap's two crossing arrows.
- **A glyph may carry its own stroke widths** (`twoPass` in `cardGlyphs.ts`: the wild fan, the ring of
  hands): such a glyph is drawn twice from scratch, because a child `stroke-width` beats the ink
  pass's.
- **Value top-left, monogram bottom-right**: in a hand the fan overlaps the left ~30% of each card,
  and branding that sliver leaves twelve cards that all say "L".
- **Every glyph is ink-outlined, as accessibility**: off-white is **1.18:1** on green and 1.46:1 on
  yellow, and no single flat ink fixes every suit. Numerals use `-webkit-text-stroke` +
  `paint-order: stroke fill`; SVG glyphs are **drawn twice**, a wider ink pass first. Suit colours are
  never darkened to buy contrast.
- `CardBack` is the wild's face plus the same cropped, tilted mark, in all four suits at once. It drops
  the art below `ART_MIN_W` (26px) and carries a **light inner rim**: a near-black back on a near-black
  table is 1.3:1, and without the rim a fan of backs is one black bar.

## Card rendering layer
Svelte throughout; movement is the browser's. Faces: `Card.svelte`, `CardArt.svelte`,
`CardGlyph.svelte`, `CardBack.svelte`, `SuitMark.svelte`, glyph geometry as data in `cardGlyphs.ts`.
Movers: `Hand`, `DiscardPile`, `PlayerSlot`, `TurnIndicator`, `AnimationLayer`, `GameBoard`,
`GameView`. Flights are `element.animate` through the `use:play` action in `AnimationLayer.svelte`; the
fan's reflow is a CSS transition; the flight layer animates the wrapper `<div>` round each card.

- **Svelte keeps whitespace text nodes**: the children of `Card.svelte` and `CardArt.svelte` run
  together with no line breaks, or the corner mark reads `"     L"` and `card.test.ts` fails.
- `<GameBoard />` tracks its size via `elementSize` (ResizeObserver) and passes width/height down.
- Layout helpers in `src/components/cards/layout.ts` (`clockwiseOpponents`, `calcHandSlots`,
  `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys`…) are pure, shared by tests and
  animations.
- `<AnimationLayer />` holds `Flier` items and `EffectText` floats; each self-cleans on its animation's
  `finish` (`removeFlier` / `removeEffect`).
- Animation triggers inside `<GameBoard />`:
  - **Opponent play**: keyed on `lastPlay.at`, from the seat to the discard; skipped for the local
    player. Sets `suppressNextDiscardFx`.
  - **Own play**: `flyFromHand(card, idx)` from the slot `calcHandSlots` gives. **Only once the play is
    committed**: `onCardClick` returns whether the card left the hand, and the flier spawns only on
    `true` — flying a refused card out and back reads as a bug. Plays confirmed later (wild colour,
    swap target) fire it through the flight handle `GameView`'s pickers call after sending.
  - `GameView.handleCardClick` runs legality **before** the prompts, so a refused card opens no picker.
    It matters for **Swap, a coloured card**: an off-colour Swap must not ask for a target and then be
    refused. `realtime.test.ts`.
  - **Discard top change**: `suppressNextDiscardFx` suppresses only the generic pile flier, never the
    SKIP/REVERSE/+N callout (`effectFor(card, pendingDraw)`).
  - **Draws** fly from `store.lastDraw`; **Swap / GlobalSwitch** trails spawn on `swapNotice.at`.
- **Hover lift** (`Hand.svelte`): a stiff spring per card on `.lift`, `scale(1.08) translateY(-14px)`
  with the slot's tilt undone, neighbours stepping aside. **The hover is a mouse's and nobody else's**
  (`pointerenter` gated on `pointerType === 'mouse'`): a touch screen synthesises `mouseenter` on the
  tap and leaves the card lifted. A finger gets the press (`.slot:active`) and no tap wash
  (`-webkit-tap-highlight-color`). `handTouch.test.ts`.
- **The turn pill's reserve is the hover transform written out** (`turnPillPlace`,
  `TURN_PILL_H + REST_LIFT + HOVER_LIFT + CLEARANCE`, `HOVER_LIFT = 14 × 1.08 + 0.04 × CARD_H`). Change
  the hover and the reserve follows.
- **The card's transition is `transform` alone**: nothing the hover does moves the shadow.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`,
  `PlayerSlot .slot`) is pinned at `left:0;top:0` and positioned by `translate()`.
- **A node's transform has exactly one owner.** A keyframed transform and a CSS one never share a
  node: use an outer anchor for the static offset and an inner node for the animation
  (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card`.
- **Layout math is radians; CSS `rotate()` is degrees**, converted at the render boundary with
  `radToDeg` (`cardTheme.ts`) and nowhere else.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (control points, as `element.animate`
  takes them) and `DEAL_STAGGER_MS`. The fan's reflow curve lives in `Hand.svelte`.
- **Hand keys come from `handCardKeys(hand)`**, never the index, or a card leaving the middle of the
  fan makes the survivors snap.
- `Hand` staggers cards in only when it grows **from empty** (a deal).
- `DiscardPile`: 3 edge layers (`--card-edge`) + 2 untinted under-layers (the ring owns the colour) +
  the top card keyed on `cardKey(card)`, remounting with a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` exists **only** for animation; never read it for rules.

### The turn clock (`GameView`'s `.turnTimerBar`, `tokens.css`'s `loco-slide`)
The only place remaining time is written, read from across the room, so a full-width strip flush with
the safe top edge; the chip row and round badge start 12px lower.
- **The track is a sunken slot**: `--color-surface-sunken`, a hard shadow inside its top edge, a
  hairline under it.
- **The bar is drawn back out of it, never scaled flat** (`loco-slide`: `translateX(0)` →
  `translateX(-100%)` on the whole fill, the track clipping), driven by `--drain-ms` /
  `--drain-delay` from `drainBar`. A `scaleX` squashes the rounded tip.
- **A raised object too small for an outline**: gloss on top, shade below, a bright cap on the leading
  edge (`::after`).
- **The heat is the palette's** (`loco-drain-heat`): indigo, amber past halfway, LOCO Red in the last
  quarter, as `background-color` — never a hex in the keyframes.
- The catch capsule's fill takes `loco-slide` and the gloss and keeps its own paint.
- Review with `--motion` at several points of a turn on `game-my-turn`, and on `mobile`.

### Cues stay on the compositor
A cue that runs as long as a state lasts may animate **opacity and transform only**, on a
pseudo-element if its host must keep its own paint; anything else repaints every frame on the
surfaces a reaction is aimed at.
- **The armed halo and the penalty pulse** (`ActionBar.svelte`) are a `::before` with a static shadow,
  breathed on opacity and scale — `::before` because `::after` is the LOCO! chip's `.hit-target`.
  `z-index: -1` inside the button's stacking context (`.armed` sets one, `.btnPenalty` takes
  `isolation: isolate`) puts the glow between fill and label. **`.btn` does not clip its overflow**,
  or the 44px catcher and the halos are cut.
- **The penalty throb** (`TurnIndicator.svelte`) is a white wash at 0 → 0.18 opacity, never
  `filter: brightness()`.
- **The deck's glow** (`Deck.svelte`) is a `::after` box shadow under the laid node, faded on opacity,
  never a `drop-shadow` filter. **Hover is behind `@media (hover: hover)`**: a touch screen keeps
  `:hover` after the tap.
- **The direction arrows** are one element's composited `transform`.
- **`will-change: transform` only where something moves every play** (the hand's slots); the browser
  promotes an animating element by itself.
- **A scrim held over a live board is a colour, never a blur** (`RoundSummary`, `ScoreTable`'s
  `.overlay`, `GameView`'s `.reconnectOverlay` wear `--color-scrim-heavy`): a backdrop filter
  re-rasterises the viewport every frame something behind it moves. The pickers and the rules modal,
  up for a decision rather than a read, keep their blur.

### Card rarity & the throw (`cardTheme.ts`)
Presentation-only tiering, never consulted by `loco-game`. `cardRarity(card)` follows scarcity:
number `common` (72), coloured action `rare` (28), wild `legendary` (12). Numbers are two thirds of a
hand, so dressing them up leaves nothing to escalate to.
- **`flightFor(card)` is the single source of flight timing**, read (never stored) by hand→pile,
  seat→pile, the generic pile refresh and `DiscardPile`'s reveal delay, or the pile shows the answer
  while its card is still crossing.
- `spin` is whole turns in the card's own plane, folded into the landing tilt's `rotate`.
- **A flier shows one side, never two**: `kind` alone decides the side (`data-flier-face`). A barrel
  roll blinks the face and reads as a loading spinner.
- `swell` is the mid-flight scale: the card passes nearer the camera, which is what makes it *thrown*.
- **The pile reveals on impact, not on the message**: `DiscardPile` holds its new top for
  `flightFor(card).duration`, except the first card it shows (the opening discard or a rebuilt board).
  Same reason the callout takes a `delayMs`.
- `AnimationLayer.Impact` is the shockwave ring tinted `ACTIVE_RING[card.color]`, fired by
  `GameBoard.landCard` for rare and legendary. A legendary kicks the board via the **`translate`
  property, never `transform`**, which is `.stage`'s board scale.
- **Rarity is read in the flight and the impact, never on the face.** `Card.svelte`'s only classes are
  `.card`, `.card.playable`, `.card.shadow`, `.interactive` and the corner variants: a shine across
  the face desaturates the suit colour, which has to survive stream compression. No foil exists.

### Reduced motion
- **The switch is `:root[data-motion="reduce"]`, never a media query**, so the player's choice wins in
  both directions; `reducedMotionCss.test.ts` fails on a `@media (prefers-reduced-motion: reduce)`
  block. The WAAPI shakes and transitions ask `prefersReducedMotion()` ([`client.md`](client.md)).
- **Motion degrades to a readable static state, never to nothing.**
- **A callout is never collapsed to zero**: `AnimationLayer`'s `play()` answers reduced motion with a
  zero-length animation, right for a flight; a callout spec carries a `still` (`EFFECT_STILL_MS`, 900)
  played at the spec's own **delay**, so SKIP / REVERSE / +N and the wild's colour still show.

## Surfaces are lit, not filled (`tokens.css`)
`--surface-lit` is the surface hue as a gradient from a lighter top to a deeper foot, `--lip` a
hairline of light on the upper edge and shade on the lower, `--trim` a thread of gold inside the ink,
`--gloss` the band a saturated control wears over its own gradient. The seat plates, the action bar
and its quiet buttons wear it. **Dressing only**: outline, hard shadow, sizes and states are
untouched, and a dead button stays the sunken slot (`actionBar.test.ts`).

## Logo and favicon
- `<LocoLogo />`: `size` sets one font-size, everything else is `em`. The mark stands on its own.
- **Whole here, cropped on a card**: logo and favicon show the complete mark; card faces, the wild's
  mini cards and the deck back crop and tilt it.
- **Weight is a rendering parameter, not a second path**: `LOCO_MARK_BOLD_STROKE` (logo) and
  `LOCO_MARK_ICON_STROKE` (favicon) stroke the mark with its own paint. A dilated copy is a second
  geometry that drifts.
- The logo draws the mark **twice, widest first** (ink, then the mark): `paint-order` cannot do an
  outside-only stroke, and a centred stroke on an even-odd wireframe eats its facets.
- **The favicon is the mark on a rounded near-black square** (`client/public/favicon.svg`) plus
  `apple-touch-icon.png` (iOS ignores SVG icons). `locoMark.ts` is the geometry's source; the icons are
  static copies, so a mark change edits all three.
- **The table is near-black without a room**: a saturated card on a green table loses its edge, and
  dark makes the cards the only bright objects.

## Streamable moments
- **Interception slam** (`<InterruptBanner />`): driven by `interrupt_success`. Store field
  `interruptFlash { actorIndex, count, at }`, set by `applyInterrupt`, cleared by the banner after
  1800ms, coloured by `seatColor(actorIndex)`. The board shakes via the **Web Animations API**
  (`state/gamePlay.svelte.ts`), never a class toggle, which would need a remount to replay.
  - **The tilt and the sweep are two elements** (`.slashTilt` / `.slash`, `interruptHint.test.ts`):
    `skewY` about the band's left edge displaced the words ~140px from their band; the tilt pivots
    about the centre, the sweep still starts at the left.
  - **The plate is a ribbon cut to the word, never a band across the frame**: a ribbon a swallowtail
    wider than the title each side, notched, in the actor's colour, an ink layer under the face (a
    `clip-path` takes the border with it), the hard shadow as a `drop-shadow` on the pair. It lives
    inside `.banner`, takes the slam's tilt and unfurls from the middle. A dark card read as a dialog
    and covered the slammed card; a full-width band read as a screen transition.
  - **Under reduced motion the ribbon stays**; only what travels goes.
  - It takes the catch stamp's 480px small-screen block, and `.subtitle` wraps.
- **The three shouts share one relief and one tag, and differ by shape.** White word, 5px ink outline,
  stepped ink extrusion (hard `text-shadow` steps, never a blur). Who it is about rides a tag of board
  chrome under it, **the name alone, ink on the plate — no seat-colour dot** (read as decoration; and
  coloured names measured 1.05–2.3:1 on the red stamp). Shapes are what a muted clip reads: a
  **ribbon** (interception), a square-cornered **stamp** with an inset white rule (Contre-LOCO!), a
  round-cornered **die-cut sticker** with a white margin (LOCO!). No soft glow on any.
- **Where the shouts land is computed, never a percentage** (`layout.ts: shoutLine` → `--shout-y`,
  read by `InterruptBanner`'s `.anchor`, `CatchBanner`'s `.anchor`, `GameView`'s `.unoBanner`): from
  the seat block to the turn pill, the middle column (`SHOUT_HALF_W` either side of the piles) minus
  the piles and every seat box reaching into it; the shout is centred in the **tallest gap, the lower
  on a tie**. Below `SHOUT_BAND_MIN` it goes **over the piles, as low as the room under them allows**,
  never over anybody's hand. `seatLayout.test.ts`.
- **Contre-LOCO! verdict** (`<CatchBanner />`), driven by `uno_caught`: a landed catch is the hardest
  reaction the game asks for, and a hand growing by two is otherwise indistinguishable from a draw.
  - `store.catchFlash { seat, at }`, set by `applyUnoCaught(seat)` (which also closes that seat's
    window), cleared by the banner.
  - Three readings: the **stamp**, the **penalty cards** flying deck → caught seat with a `+2`
    callout (`<GameBoard />`, keyed on `catchFlash.at`), and the **`unoCaught` sting**.
  - **Not shaped like the slam**: a red stamp punching *down* with one vertical thump, against a
    sideways wipe and rattle. The two loudest moments must be told apart in a muted clip.
  - **The catcher is not on the wire** (`uno_caught` carries the caught seat only): the banner names
    who pays — the table's news; the caller knows.
  - `CATCH_PENALTY_CARDS` (2) is stated once in the store for the banner and the flight; the hand
    itself always comes from the server (a draw never fails, it shrinks). Scene `game-catch-caught`;
    `catchBanner.test.ts`.
- **LOCO! banner**: a tilted sticker, punch-in, on the shout line. **A moment, not a state**: it
  leaves after `UNO_BANNER_MS` (2.2s), keyed on `unoDeclaredAt`, with a 240ms fade on the same beat
  (the delay survives reduced motion) — never the `unoDeclared` latch, which outlives several turns
  over the piles. The latch stays up for the sounds and music. The word is alone; the caller rides
  the tag (`.unoWho`). `gameView.test.ts`.
  - **Centred with `inset-inline: 0` + `margin-inline: auto` and `width: fit-content`, never
    `left: 50%`** (shrink-to-fit against the right half); wraps inside
    `calc(100% - 2 × --space-base)` with `overflow-wrap: anywhere`, clamp floor 26px; the punch
    keyframes carry `translateY(-50%)` only.
  - **z-index 45, with the other two shouts** ("Score table" has the ledger).
- **Effect callouts** (`AnimationLayer`): SKIP / REVERSE / +N, outlined rather than shadowed so they
  survive on felt, card or background. Localised (`fxSkip`, `fxReverse`); `<GameBoard />` takes them
  as a memoised `fxTexts` prop — a fresh object literal replays the callout every render.
- **The deck falls** on the victory screen only, once (`CardFall.svelte`); losing does not celebrate
  and a walkover is not a victory. **What falls is the real components**: fourteen `<Card />` faces
  at 44–64px, each backed by a real `<CardBack />`, both hiding their backface in a `preserve-3d`
  parent — at 30px with no value or mark, nothing says "card".
  - **The fade and the turn are on two elements**: an animated `opacity` (or `will-change: opacity`)
    flattens a 3D context, which drew every half-turn as the mirrored front. `.fall` owns drift and
    fade, `.tumble` rotation and depth. Perspective is **per card**, or edge cards turn more violently.
  - **The fall accelerates and the turn does not**, from a little initial speed (they come off a
    throw); **the fade-out moves with the curve**.
  - **Half-turns are weighted** (two fifths none, two fifths one, the rest two): edge-on a card is a
    hairline.
  - **One roll decides how near a card is**, and size and speed both read off it. Reduced motion drops
    the layer.
- **Per-seat identity colours** (`game/playerColors.ts`): a player keeps one colour across avatar,
  banner and scoreboard, so a viewer follows "the orange player".
- Opponent plates show the **exact** card count.

## Table news (the three notice pills)
A Swap or GlobalSwitch (`swapNotice`), a Contre-LOCO! that found nobody (`catchFailed`), a seat gone
for the match (`departureNotice`): news, not moments. The LOCO! banner, the slam and the stamp are the
three allowed to shout; anything else with a saturated fill competes for the same glance.
- **One class, three heights** (`.notice` + `.noticeSwap` / `.noticePenalty` / `.noticeDeparture`):
  board chrome (`--color-surface-strong`, ink type, outline, `--shadow-hard`), differing only by
  `--notice-top` (13% / 20% / 29%, tighter on a phone), so two pieces of news on one beat do not
  cover each other. No colour of its own, not even a dot.
- **In on a bounce, out on the beat the store drops it**: `noticeIn` (0.32s) then `noticeOut` (0.24s)
  delayed `calc(var(--notice-life) - 240ms)`, `--notice-life` being the component's
  `SWAP_NOTICE_MS` / `CATCH_FAIL_NOTICE_MS` / `DEPARTURE_NOTICE_MS` passed inline. The exit is
  `forwards`, **never `both`**, which back-fills and swallows the entrance. Under reduced motion the
  pill just is there.
- **Centred with `inset-inline: 0` + `margin-inline: auto`, never `left: 50%`**: anchored at the
  midpoint a box is shrink-to-fit against the right half of the screen (a 360px phone wrapped at 180).
- **`text-wrap: balance`**, safe because the width is decided first.
- **No arrow glyph**: a heading is named in the ring's own words (`clockwise` / `counter-clockwise`,
  `horaire` / `antihoraire`) — `→` means a different way from every chair.
- **A line is read in passing or not at all**: one line on desktop, two at 360px; the GlobalSwitch line
  names the event and heading and stops.
- Scenes `game-swap-notice`, `game-global-switch-notice` (the longest line), `game-catch-failed`,
  `game-departure-notice`.

## Score table (hold TAB)
`<ScoreTable />`: seat colour + nickname, a column per finished round, total, rounds won, ping. The
merge, sort and ping bands are pure in `scoreTableModel.ts` (`buildScoreRows`, `pingTier`).
- **Opened by holding TAB** (`heldKey('Tab', enabled)`) **or pinned by the scores button**. Held and
  pinned are separate states: releasing TAB must not close a pinned table. Up on the **press**; TAB
  moves no focus ([`client.md`](client.md)).
- **The button exists on touch layouts only** (`.scoresBtn` shown under
  `(max-width: 480px), (pointer: coarse)`, which covers tablets), as a drawn 40×40 icon;
  `t.scoreTableBtn` is its `aria-label` + `title`, and `aria-pressed` tints it when pinned.
- E2E: desktop opens it by **holding TAB** (`holdScores` in `score-table.spec.ts`); one test resizes to
  390×844 for the button.
- `heldKey` resets on `blur` (alt-tab swallows the keyup). It `preventDefault`s TAB, so `enabled` is
  false while the rules modal, a picker or the round summary owns the screen; inside a dialog TAB is
  the dialog's (`dialogFocus.ts`). **Shift+TAB is never taken.**
- **Nothing the board draws crosses it**: **z-index 48**, above the transient band (notices 14, error
  toast 30, the three shouts 45, `.topRight` and the leave question 46, the catch capsule and round
  summary 47) and below the reconnect curtain (50), the pickers (100), the map gate (900) and the
  rules modal (1000).
  - **The capsule and the summary share 47 because they are never up together**: `applyRoundEnd`
    empties every catch window. The capsule cannot go lower, because the chip row is rendered after
    it in `GameView`.
  - **The chip row going under it is deliberate**: a pinned table has a ✕ in its own header (40px,
    `.hit-target`) and its scrim dismisses on a press outside the card.
  - `scoreTable.test.ts` asserts the floor **per file**, so a new banner at 46 fails;
    `score-table.spec.ts` asserts the cover with `elementFromPoint`.
- **Ping bands** (`pingTier`): < 60 good, < 120 ok, < 220 poor, beyond bad — tight because an
  interrupt is decided by arrival order. `rtt_ms < 0` is "not measured", never 0 ms; bots read `BOT`.
- **Rows sort by rounds won, then score, then seat** — the match's order, so the panel never
  contradicts the final standings.
- Under 480px the rounds-won column drops; under 400px the "you" badge too. The ping is the one column
  nothing else on screen derives.
- **An offline row is quiet by hue** (`.rowOffline`: the panel's fill, `--color-border-strong`
  outline, `--color-muted` cells). Ping tiers are tokens (`--color-amber`, `--color-error`).

## The round chip under 480px
Five 40px chips take ~245px of a 360px screen, so under 480px the round chip uses its short spelling,
`M2 · BO3` (`t.roundShort`, the score table's `M%n` head), and the decisive round one word
(`t.decisiveRoundShort`). Two spans, one hidden per width, so the accessible name stays long. Shows on
`game-uno` at `small`.

## Quiet states, measured
**Quiet is a hue, never an opacity.**
- **A dead action-bar button is the inverse of a raised object**: `--color-surface-sunken` (below the
  bar, desaturated), a **hard shadow inside the top edge** (`inset 0 2px 0`), the outline down to
  `--color-hairline` (`--color-border-strong` on a sunken fill draws a ghost pill). Label
  `--color-disabled-ink`, 6.1:1, measured by `actionBar.test.ts` off `tokens.css`: Catch sits dead
  through the opening of every round. No opacity anywhere. `.btnDrawSecondary` is surface-strong.
- **The round summary's delta** is `--color-mint-text` (the mint as text on a panel, as `--color-link`
  is the indigo). The winner row uses `--color-on-secondary-muted` and `--color-on-secondary-mint` on
  the yellow.
- **Text-field focus** (`Lobby` `.input`, `WaitingRoom` `.maxInput`) is the solid `--color-tertiary`
  at 3px, the ring every `:focus-visible` gets; a translucent indigo was 1.5:1 and the only indicator.
- **The map-loading roster** sets a still-loading name at 0.72 with `.status`'s shadow.
- **12px is the floor** for any text on a screen a spectator reads.
- Scenes `game-scores` and `game-scores-round-one`.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard, roundHistory?)`: per-player
  `round_points` = new − previous score, stored as `roundScores`, `showRoundSummary: true`.
- `GameView` shows the round, winner, per-player breakdown by placement, the delta, cumulative score,
  wins and the match scoreboard (BO3+). The round it names is `roundNumber_completed`, since
  `roundNumber` is already the round dealt behind it.
- "Continue (Ns)" → `dismissRoundSummary()`, which only hides the card. Auto-dismiss at 8s.

### The card is an overlay, and the board behind it is live
The server deals the next round as it announces the one that ended and **arms the turn clock with the
deal**, so the table is playing while the card is up. `applyGameState` settles the board and **does
not touch the card** (neither `showRoundSummary` nor `roundWinner`). **A snapshot is authoritative
when it arrives and never afterwards**: a buffered deal replayed on dismissal rolls back the discard,
the hand sizes and `currentTurn`, and if the rolled-back turn was the reader's own, the table stalls
until the server's turn timer. The **match end** is the one buffer (`pendingMatchEnd`): nothing
follows a match end. The `yourTurn` cue is held while the card is up and played when it comes down on
a turn already ours (`audio/gameSounds.ts`).

## Visual showcase & screenshot harness
`client/src/dev/scenes.ts` registers every screen and state as data; `?showcase` renders the index,
`?showcase=<id>` one scene full-screen with no server. Behind `import.meta.env.DEV` (dynamic import in
`boot.ts`), so the chunk never ships.

`tools/visual/shoot.mjs` (`make visual`) boots the dev server through `tools/lib/devserver.mjs`, walks
the registry, and writes one PNG per scene and viewport under `.visual` plus a contact sheet per
viewport.
- **Add a scene in the same change set as any new screen or visual state.**
- `card-sheet` is the whole deck, every kind in every suit; review any card change against it.
- Flags: `--scenes=a,b`, `--viewports=desktop,mobile,wide,small,notch,landscape`,
  `--gfx=high|medium|light|force` (`force` is the full tier on the harness's software GPU),
  `--motion`, `--port`. Default `desktop` (1440×900) + `mobile` (390×844). After touching `layout.ts`
  check **both** ends of the scale: `wide` (1920×1080) and `small` (360×640).
- **`notch`** is 390×844 with a 59px notch and a 34px home indicator; a viewport's `insets` are written
  over the `--safe-*` tokens.
- Viewport size goes under `viewport: {...}` in the Playwright context options; top-level width/height
  are silently ignored.
- Captures run with `reducedMotion: 'reduce'` for determinism; `--motion` checks the fall, springs
  and callouts.
- **The harness asks for the home page of the language it captures** (`/fr/` by default), since `/`
  and `/fr/` are two documents. **Chromium stops honouring navigations on a long-lived page past
  ~100 of them**: if a run dies on a bare `page.goto` timeout at a fixed position, recycle the page
  rather than hunting the scene.

## Link preview (Discord / X)
The game is shared as a link, so the OG card is a product surface. `make og` (`tools/og/shoot.mjs`)
renders the `og-card` scene at 1200×630 into `client/public/og.png`.
- **Built from the real `<LocoLogo />` and `<Card />`** (`client/src/dev/OgCard.svelte`), never a
  redrawn copy; `OgCard` pins `--color-stroke` / `--color-primary` locally.
- **Show, don't tell**: duck, wordmark, a five-card fan, one line. Discord renders ~400px wide. The +4
  sits mid-arc, clear of crops and avatars.
- **The tagline is one sentence per line** (`.taglineLine`, `block`, not `nowrap`).
- The PNG is **committed**: CI has no browser.
- **Absolute URLs are mandatory**, in the served HTML (neither crawler runs JS). `src/seo/meta.ts`
  holds `ORIGIN` (`VITE_PUBLIC_ORIGIN`, default prod) and builds every URL through `absolute()`;
  `layouts/Head.svelte` renders the tags.
- Both platforms cache the image by URL: bump `OG_VERSION` in `src/seo/meta.ts` after regenerating.
  `twitter:card` stays `summary_large_image`.
- No preview on the `-d.` host by design (`robots.txt: Disallow: /`).
- `ogCard.test.ts` is the only thing watching this.

## The game cover
`src/dev/CoverCard.svelte`, three cuts, shot by `make cover` into `brand/` — committed and deliberately
not under `client/public/`, because it is an **upload**: IGDB takes it, Twitch draws it as the
category's box art.
- **The wordmark and no other text**: IGDB asks that the title be the largest text, and this answers
  by making it the only text. No platform logos, age ratings or watermarks.
- **Judged at 40px**, the width a Twitch category is picked out of a sidebar at.
- **Built from the real `<LocoLogo />` and `<Card />`**: the art leaves the repository, out of reach of
  every test once uploaded.

`coverCard.test.ts` pins the ratio, the 40px floor and the no-other-text rule.

## The entry screen's two hands (`HomeHands.svelte`)
Two fans of the real `<Card />` rise out of the bottom corners of the entry screen, each turning round
a point under the fold, at a size no table shows — objects carrying the life on a flat canvas. They
rise once, card by card, then hold. Decoration, so `aria-hidden`, `pointer-events: none`, no tab stop,
clipped by their own `overflow: hidden` layer (a card under the fold would give the one-viewport
screen a scrollbar). Drawn only from 75rem wide and 40rem tall. `lobby.test.ts`.

## Ambience and celebration
- **No painted ambience**: no glowing blobs, no floating silhouettes behind a screen — that texture
  reads as the absence of a decision. Refused; do not add. The canvas is the designed gradient and the
  objects on it carry the life; any ambience is drawn from the game's vocabulary (a real card, an ink
  outline, a hard shadow).
- **The home screen arrives in order** (`Lobby`'s `riseIn`): mark, tagline, then the four buttons 60ms
  apart, once.
- **A hand is dealt, not drawn** (`GameBoard`'s deal effect, `DEAL_FLIGHT_MS`): backs fly off the
  deck one by one to their places; the fan's fade-in (`Hand`'s `handCardIn`) waits for its flier.
  Keyed on `roundNumber`, so a reload mid-round rebuilds the fan quietly.
- **Numbers are counted** (`components/countUp.ts`) on the round summary and the game-over standings;
  rows arrive top place first, and the game-over heading wraps as a phrase (`text-wrap: balance`).
- **Every screen arrives** (`state/screenIn.ts`, on the wrapper `App.svelte` puts round each screen): a
  240ms rise and fade, in only — nothing pressable is ever behind a departing screen. `.screen` is
  `height: 100%` and owns nothing else.
- **Three small answers to a press**: a card gives under the thumb (`Hand`'s `:active` squash), the
  turn pill lands with a ring (`TurnIndicator`'s `turnBurst`, a pseudo-element), and the reveal's VS
  lands with one (`MatchFound`'s `vsRing`). That ring grows wider than its gap, so it passes **behind**
  the two cards (`.side` carries `position: relative; z-index: 1`) — over them it crosses the names at
  the second the screen exists to show them.

---
name: LOCO!
description: A streamable real-time multiplayer card game dressed as a physical toy — chunky ink-outlined objects on a candy sky, dealt onto a near-black table where the cards are the only bright things in the room.
colors:
  loco-red: "#ff3d68"
  loco-red-deep: "#de1f4a"
  loco-red-pale: "#ffb3c4"
  sunny-yellow: "#ffc93c"
  sunny-yellow-deep: "#eaa900"
  electric-indigo: "#6c5cff"
  signal-mint: "#12c48f"
  alarm-red: "#e5304b"
  ink: "#241546"
  body-violet: "#4a3a75"
  muted-violet: "#6f5f95"
  muted-violet-soft: "#9587b6"
  canvas-lilac: "#f4ecff"
  surface-card: "#ffffff"
  surface-strong: "#ece2ff"
  hairline-lilac: "#ded2f5"
  night-canvas: "#150c2e"
  night-surface: "#271a4f"
  night-ink: "#f6f1ff"
  night-hairline: "#3d2b6e"
  table-felt: "#262b3a"
  table-felt-deep: "#12151f"
  table-rim: "#0a0c14"
  suit-red-hot: "#ff002a"
  suit-red-cool: "#8f0098"
  suit-yellow-hot: "#ffbd00"
  suit-yellow-cool: "#ff4852"
  suit-green-hot: "#00ff6d"
  suit-green-cool: "#00668e"
  suit-blue-hot: "#15d4ff"
  suit-blue-cool: "#5918a7"
  card-wild-black: "#141414"
  card-glyph: "#efefef"
  card-glyph-ink: "#120b24"
typography:
  display:
    fontFamily: "Fredoka Variable, Fredoka, Baloo 2, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "Fredoka Variable, Fredoka, Baloo 2, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Fredoka Variable, Fredoka, Baloo 2, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.2px"
  body:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Fredoka Variable, Fredoka, Baloo 2, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.4px"
rounded:
  card-face: "5px"
  xs: "6px"
  sm: "12px"
  md: "18px"
  lg: "26px"
  xl: "36px"
  full: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.loco-red}"
    textColor: "#ffffff"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: "14px 24px"
    height: "54px"
  button-primary-hover:
    backgroundColor: "{colors.loco-red}"
    textColor: "#ffffff"
  button-primary-disabled:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.muted-violet}"
  button-alt:
    backgroundColor: "{colors.sunny-yellow}"
    textColor: "#4a2c00"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: "14px 24px"
    height: "54px"
  button-secondary:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "12px 24px"
    height: "48px"
  input-text:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 18px"
    height: "56px"
  seat-pill:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    width: "172px"
    height: "66px"
  seat-pill-active:
    backgroundColor: "{colors.sunny-yellow}"
    textColor: "{colors.ink}"
  card-face:
    backgroundColor: "{colors.suit-red-hot}"
    textColor: "{colors.card-glyph}"
    rounded: "{rounded.card-face}"
    width: "72px"
    height: "108px"
  alert-toast:
    backgroundColor: "{colors.alarm-red}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "11px 22px"
---

# Design System: LOCO

## 1. Overview

**Creative North Star: "The Toy on the Table"**

LOCO is not an interface that depicts a card game; it is a set of objects. Every pressable
thing in this UI is a physical body with a thick ink outline and a solid ledge of shadow
beneath it, and pressing it travels *into* that ledge. Nothing floats on a blur. The
reference points are Nintendo's first-party menus and Gartic Phone: chunky rounded shapes,
saturated candy colour, display type set far larger than a productivity app would dare.

The system splits cleanly in two, and the split is the whole architecture. The **room** —
lobby, waiting room, score panels, modals — is a bright candy sky in light theme and a deep
indigo den in dark, painted once on `body` so screen containers stay transparent. The
**table** is near-black in both themes and does not follow the theme at all, because a table
is an object like the cards, not a surface that answers to a preference. Against that
near-black felt, the forty-odd cards are the only saturated bright objects in the frame.
That is deliberate: a spectator watching a stream at 720p must be able to find the play
without being told where to look.

Streamability is the constraint that settles every argument here. Type is display-weight and
large because it is read over someone's shoulder, not at arm's length. Contrast is bought
with ink outlines rather than by darkening the brand colours. The game's big moments —
interception, LOCO, victory — are built to survive a muted clip. What this system explicitly
rejects: the flat pastel SaaS dashboard, the neon-on-black crypto casino, glassmorphism,
and every soft-shadow card grid that reads as a settings page with a deck of cards in it.

**Key Characteristics:**
- Ink outline (3px) plus a hard bottom shadow on every raised object; soft blur is ambience, never structure
- Candy-saturated room, near-black table, brand voltage carried by `#ff3d68`
- Fredoka display over Nunito body, both self-hosted; no CDN, the CSP stays closed
- Two colour systems that never mix: UI brand palette and card-suit gameplay palette
- Press feedback is physical travel, not a colour change
- Readable at 720p by someone who is not playing

## 2. Colors

A saturated candy palette on a violet-tinted neutral spine, with a second, hotter palette
reserved exclusively for the cards.

### Primary
- **LOCO Red** (`#ff3d68`): The brand voltage. Wordmark, every primary CTA, the "your turn"
  pill, seat 0's identity colour, the one-card danger badge. It is the colour that means
  *act now*, so it is never spent on decoration. **Deep LOCO Red** (`#de1f4a`) is its pressed
  state only.

### Secondary
- **Sunny Yellow** (`#ffc93c`): The second entry point and the colour of winning. The join
  CTA, the active-turn seat pill, victory framing. Paired with a dark brown text
  (`#4a2c00`) rather than white — yellow will not carry white type at this saturation.

### Tertiary
- **Electric Indigo** (`#6c5cff`): Information and orientation, never action. Direction
  indicator, focus rings, count badges, swap notices. **Signal Mint** (`#12c48f`) is its
  narrow counterpart: confirmations and the playable-card glow.
- **Alarm Red** (`#e5304b`): Refusals and failures only. Distinct from LOCO Red on purpose —
  the brand red invites, this one stops.

### Neutral
- **Ink** (`#241546`): Not black. Every outline, every heading, every piece of body copy in
  light theme. A violet-tinted near-black keeps the outlines from reading as engineering.
- **Body Violet** (`#4a3a75`) and **Muted Violet** (`#6f5f95`): secondary and tertiary copy.
- **Canvas Lilac** (`#f4ecff`) / **Surface Card** (`#ffffff`) / **Surface Strong** (`#ece2ff`):
  the room's three tiers in light theme. The canvas is never the card colour.
- **Night Canvas** (`#150c2e`) / **Night Surface** (`#271a4f`) / **Night Ink** (`#f6f1ff`):
  the same three tiers after dark. Dark theme changes the room, never the rules.

### Table
- **Table Felt** (`#262b3a` → `#12151f`) with a **Table Rim** (`#0a0c14`): identical in both
  themes. The rim must stay several steps darker than the felt or it stops reading as an
  object edge and becomes a shade.

### Card Suits
Four two-stop gradients, measured off the reference art and never eyeballed: red
(`#ff002a` → `#8f0098`), yellow (`#ffbd00` → `#ff4852`), green (`#00ff6d` → `#00668e`),
blue (`#15d4ff` → `#5918a7`). Wilds take near-black (`#141414`). Glyphs are off-white
(`#efefef`) outlined in `#120b24`.

### Named Rules

**The Two Palettes Rule.** The UI palette and the suit palette are separate systems and must
never be substituted for one another. A button is never suit-green; a card is never LOCO Red.
The suits encode gameplay, the brand colours encode intent, and a player who learns one must
not have to unlearn it in the other.

**The One Recipe Rule.** A pressable object's fill is a token, never a literal. Every raised object
is the same vertical gradient — a lighter stop falling into the flat brand colour — and it was
written out by hand at 21 call sites across 13 files, so "the colour of a primary button" had
nowhere to be changed. It is `--gradient-primary` / `-secondary` / `-tertiary` / `-error` now, over
`--color-*-lift` for the top stop. The text on those fills is the same three answers every time:
`--color-on-primary` and `--color-on-dark` for white, `--color-on-secondary` (a dark brown) for the
yellow, `--color-on-mint` for the mint. **White never goes on the yellow**: it measures ~1.7:1, and
the interception banner's ×N chip shipped that way while its twin on the catch banner read the ink.

**The Outline Rule.** Contrast is bought with ink, never by darkening a colour. Off-white on
the green suit measures 1.18:1 and on yellow 1.46:1; no single flat ink fixes it either. Every
glyph is therefore drawn twice, a wider ink pass first, giving ~15:1 glyph-against-ink and
~14:1 ink-against-any-face. **The suit colours are the brand and are never dimmed for
contrast.**

**The Dark Table Rule.** The felt is near-black in both themes. It was green once, and a
`#00ff6d` card on a `#1fbf8f` table loses its edge — the one thing a card must never do.

## 3. Typography

**Display Font:** Fredoka Variable (fallback Fredoka, Baloo 2, system-ui)
**Body Font:** Nunito Variable (fallback Nunito, system-ui)

Both are self-hosted through `@fontsource-variable`. There is no webfont CDN and there must
not be one.

**Character:** Fredoka is a rounded geometric with almost no contrast — it reads as moulded
plastic rather than as type, which is exactly the register a toy needs. Nunito carries the
prose underneath it with enough warmth to match and enough neutrality to be read in
paragraphs. The pairing is friendly without being childish, and it survives video
compression because neither face has thin strokes to lose.

### Hierarchy
- **Display** (700, 40px, 1.1, −0.5px): The wordmark's neighbours and match-defining moments —
  victory, interception. One per screen at most.
- **Headline** (600, 30px, 1.15, −0.3px): Screen titles, round summary headings.
- **Title** (600, 24px / 20px / 17px, 1.2–1.3): Panel headings, button labels, seat names.
  The three steps sit at a ≥1.15 ratio and are used strictly by nesting depth.
- **Body** (500, 16px, 1.5): Rules prose, explanatory copy. Capped at 65–75ch; the rules
  modal is the only long-form surface in the product and it holds that measure.
- **Label** (700, 11px, 1.2, +0.4px, uppercase): Badges, the tagline, table column heads.
  Uppercase is reserved for this step only.

### Named Rules

**The 720p Rule.** Every size in this scale is one to two steps larger than a productivity app
would choose, and that is not an accident to be optimised away. If a value cannot be read in a
1280×720 re-encode of a stream, it is too small, regardless of how it measures on the
designer's monitor.

**The Uppercase Budget Rule.** Uppercase belongs to the Label step and nowhere else. A chunky
rounded display face set uppercase at size loses its whole character and reads as a banner ad.

## 4. Elevation

This system does not use elevation in the Material sense. Depth is **constructed**, not
suggested: every raised object is a physical body defined by a hard outline and a solid,
un-blurred ledge of colour beneath it, and it *travels* on press. Soft blurred shadows exist
only as ambience layered underneath the hard ledge on large floating panels, never as the
thing that communicates height.

### Shadow Vocabulary
- **Hard ledge** (`0 4px 0 rgba(36,21,70,0.22)`): The default. Every button, pill, badge, seat.
- **Hard ledge, raised** (`0 6px 0`): The hover state of the above. Hovering lifts the object
  off the page by 2px and the ledge grows to match.
- **Pressed** (`0 1px 0`): The object travels 3px down into its own ledge. Press is
  displacement, never a tint.
- **Pop** (`0 6px 0` + `0 14px 30px rgba(28,14,56,0.22)`): Raised panels — modals, the round
  summary, the score table. The solid ledge still does the structural work; the blur is
  atmosphere.
There is no fifth step. A "Float" (`0 4px 0` + `0 10px 24px`) was documented here for cards in
flight and the top-right cluster, and nothing in the client ever drew it: cards in flight carry the
hard ledge and the cluster's chips carry their own 3px one. A vocabulary entry no surface uses is a
rule the next person writes against, so it is gone rather than retrofitted.

### Named Rules

**The Ledge Rule.** No interactive object may be drawn without both an ink outline and a solid
bottom shadow. An object with a blur and no ledge is a web component; an object with both is a
toy. If you can't press it *into* something, it isn't finished.

**The No-Glass Rule.** Backdrop blur is forbidden as a surface treatment. The action bar broke this
for a while — the one always-on control surface in the game was an 82%-opaque panel over a 10px
blur, which also put whatever card sat behind it into the contrast of its own labels. It is opaque
now. Blur is used in exactly
one place — the scrim behind a modal — and never as the material of a panel.

## 5. Components

### Buttons
- **Shape:** Fully pill (`999px`, never `50%`, which would make an ellipse of anything that is
  not square). There is no square button anywhere in this product.
- **Primary:** Vertical gradient from a lighter tint down into LOCO Red, white label with a
  dark red text-shadow to keep it off the light stop, 3px ink outline, 5px ledge,
  `14px 24px` padding, 54px tall.
- **Hover / Focus:** Lifts 2–3px on `cubic-bezier(0.34,1.56,0.64,1)` with the ledge growing
  and a 1.05 brightness bump. Focus is a 3px Electric Indigo outline at 2px offset, applied
  globally via `:focus-visible` — it is never removed and never restyled per component.
- **Active:** Travels 3px down, ledge collapses to 1px.
- **Alt (equal-weight second entry point):** Same geometry in Sunny Yellow with brown type.
  Reserved for the case where two actions are genuinely equal; it is not a "secondary".
- **Secondary / back:** Card-surface fill, ink label, 4px ledge, 48px tall. Deliberately quiet.
- **Disabled:** Surface Strong fill, muted label, ledge removed entirely. A disabled object
  is flat on the page — it has stopped being a body.

### Cards / Containers
- **Corner Style:** Panels `26px`, inputs and small surfaces `18px`, pills full. Playing
  cards are the exception at `5px` — a card is printed stock, not a UI surface.
- **Background:** Surface Card over the transparent screen container; the room's gradient is
  painted once on `body` and never repeated.
- **Shadow Strategy:** Pop for modals and summaries; Hard ledge for everything smaller.
- **Border:** 3px ink, always. 2px on objects under ~40px tall.
- **Internal Padding:** `24px` for panels, `16px` for dense surfaces.

### Inputs / Fields
- **Style:** Card-surface fill, 3px ink outline, `18px` radius, 56px tall, with an inset top
  shadow that makes the field read as *carved into* the page rather than raised off it — the
  inverse of the button, which is the point.
- **Focus:** 4px Electric Indigo glow ring outside the outline, inset preserved.
- **Error:** Never recolours the field. The error is announced by a separate alert.

### Navigation
There is no persistent nav. Orientation is carried by a top-right utility cluster —
language, theme, audio, rules, scores — present on every screen at the same coordinates, each
a pill with the standard ledge and a 40px minimum height. On the game screen it sits above
the board's overlays so the control that opens a panel is always the control that closes it.

### Alerts
- **Style:** A pill in Alarm Red with the standard ink outline and ledge, entering with a
  short horizontal shake. It carries `role="alert"` and is dismissible.
- **Voice:** Player language, never system language. An alert says what the player should do
  next, in their own language, and never surfaces a raw string from the wire.
- **Placement:** Never over the hand or the discard pile. An error that hides the cards it is
  complaining about is worse than no error.

### Playing Card (signature component)
The one part of the UI that does not follow the chunky-sticker language and does not follow
the theme. A single SVG paints the whole face in one `1000×1500` space — background, cropped
watermark, wild fan and rule glyphs scale as one object from a 12px mini fan to a card in
flight. The suit gradient runs along the bottom-left → top-right diagonal at 35°, and the
LOCO mark behind it is **that same gradient reversed**, which is why the watermark stays
legible at both ends without a tint, an outline or an opacity. Value sits top-left, monogram
bottom-right. Radius `5px`, 72×108 at design scale.

### Seat Pill (signature component)
Three sizes chosen by available width, never by preference: full (172×66), compact (124×56),
mini (82×46, no card fan). The active seat is gold-filled with a glow ring and a bobbing
arrow, and it is the brightest object on screen by design — a viewer must never hunt for
whose turn it is. The card count is exact, badged on the right edge, and turns Alarm Red and
pulses at exactly one card.

## 6. Do's and Don'ts

### Do:
- **Do** give every raised object both a 3px ink outline and a solid un-blurred bottom shadow.
- **Do** make press a physical displacement: 3px down, ledge collapsed to 1px.
- **Do** paint the room's gradient exactly once, on `body`. Screen containers stay
  `background: transparent`.
- **Do** buy glyph contrast with an ink outline drawn underneath, never by darkening a suit.
- **Do** keep the felt near-black in both themes.
- **Do** size type for a 720p stream, then check it there before shrinking it. 11px is the floor,
  including for the Label step: the score table's column heads and its "you" badge sat at 10px and
  9px, which is not a size a spectator reads a standing off.
- **Do** carry "quiet" with the hue and the size, never with an opacity. An opacity dims the whole
  object at once and takes the contrast with it: the lobby's legal link, the home footer's links,
  the content pages' navigation and the score table's column heads all sat between 2:1 and 3:1 that
  way. `--color-muted` is what quiet looks like, and it resolves to `--color-ink` on hover.
- **Do** give a control drawn smaller than `--touch-target` (44px) its target back with
  `.hit-target`, which grows the hit area from a pseudo-element and moves nothing. The top-right
  cluster's chips are 40px on purpose; the thumb still gets 44.
- **Do** ease with `cubic-bezier(0.16,1,0.3,1)` for travel and `cubic-bezier(0.34,1.56,0.64,1)`
  for anything that should feel physical.
- **Do** animate transforms only. A moving node is pinned at `left:0;top:0` and positioned by
  `x`/`y`.
- **Do** give each node's transform exactly one owner — a CSS transition, a Svelte transition or one
  `element.animate` call, never two of them on the same node.
- **Do** degrade motion to a readable static state under `prefers-reduced-motion`; "this just
  became clickable" is information and must survive as a static halo.

### Don't:
- **Don't** use `#000` or `#fff` as a structural colour. Ink is `#241546`; outlines are ink.
- **Don't** put a blurred shadow on an object without a ledge under it. If it looks like a
  2014 Material card, it is wrong for this product.
- **Don't** use backdrop blur as a panel material. Glassmorphism is banned outside the modal
  scrim.
- **Don't** apply a gradient to text via `background-clip: text`, anywhere, for any reason.
- **Don't** use a coloured `border-left`/`border-right` over 1px as an accent stripe.
- **Don't** build identical card grids of icon + heading + text. This product has a table, not
  a dashboard.
- **Don't** mix the UI palette with the suit palette in either direction.
- **Don't** let the table follow the theme, and don't let a card face follow it either.
- **Don't** set the chunky display face uppercase above the 11px Label step.
- **Don't** reach for a modal first. The score table is held open with a key and pinned with a
  button precisely because it refused to become one.
- **Don't** animate `left`/`top`, or animate layout properties of any kind.
- **Don't** show a player a raw string that came off the wire. Server prose is developer
  prose; it is translated into player voice before it reaches the screen.

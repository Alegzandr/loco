# Product

Who this is for, why it exists and what it refuses. The system that executes it is
[`DESIGN.md`](DESIGN.md); the rules that hold it in place are [`CLAUDE.md`](CLAUDE.md).

## Register

brand

LOCO is a game, so the design is not in service of a task the player wants over with: it is the
thing being bought. The board, the type and the colour are the product's face, and a spectator who
never presses a button still has to be sold by them. The dense panels that do behave like a tool
(score table, preferences, the rules modal) borrow the product register's discipline locally, but
they never set the default.

## Users

Three audiences watch the same screen and only one of them is playing.

- **The player**, on a laptop or a phone, in a session of ten to forty minutes with two to six
  people. They arrive from a pasted table code or from the 1v1 queue, type a nickname, and are
  dealt in. No account, no install, nothing to configure. Their job is to read the table in under a
  second and react: the game's mechanics are reaction windows, so anything they have to hunt for is
  a lost interception.
- **The streamer**, playing the same game with an audience attached. They need the table code
  hidden on demand, a board that never scrolls out of frame, and moments worth clipping.
- **The spectator**, who is not playing at all: a Twitch viewer at 720p, or somebody watching a
  muted highlight in a feed. They have no state in their head and no controls. Every state must be
  legible to them, and the big moments (interception, LOCO, victory) must land with the sound off.

Streamability is a product requirement, not decoration. When the three audiences disagree, the
spectator's legibility settles it, because the player already knows what they did.

## Product Purpose

A premium real-time multiplayer card game, playable in a browser in seconds, built to be watched.

The category is full of free card games that look like a settings page with a deck of cards in it.
LOCO's whole proposition is that it is a physical toy on a table: chunky ink-outlined objects,
saturated colour, display type, press feedback you can feel. It exists because the rules
themselves (interception with no deadline, catch windows, batch plays) produce moments worth
watching, and because nothing in the category renders them as moments.

Success is a match that reads on a stream without commentary, a table code that gets pasted into a
group chat, and a rematch that gets asked for.

## Brand Personality

**Toylike. Loud on purpose. Fair.**

The voice is the game talking, not a website. Emotionally: the lobby should feel like picking up a
controller, a reaction window should feel like a held breath, and a loss should not feel like a
system error.

What that means string by string — table rather than room, tutoiement, a button that is the verb
about to happen, a refusal that says what to do next and never scolds — is a rule rather than a
mood, and it lives in `CLAUDE.md` with the note behind it in
[`docs/notes/client.md`](docs/notes/client.md).

## Anti-references

- **The flat pastel SaaS dashboard.** Soft shadows, identical card grids of icon plus heading plus
  text, a hero metric with a gradient accent. This product has a table, not a dashboard.
- **The neon-on-black crypto casino.** Saturation without objects. LOCO's colour sits on bodies with
  outlines, not on glow.
- **Glassmorphism.** Backdrop blur is banned as a panel material; it survives only as the modal
  scrim.
- **The editorial-typographic lane.** Display serif, ruled columns, tiny tracked uppercase labels
  over every section. It is the current default for anything trying to look designed, and it is the
  opposite of a toy.
- **Gradient text**, side-stripe accent borders, and a modal reached for first. All three are
  refused outright.
- **The real UNO's interface, and its name.** The game never says UNO to a player, in any language.
  The trademark position rests entirely on that, so the copy has to describe the game in its own
  words instead of borrowing the famous one.

## Design Principles

The six that settle arguments. How each is executed — the ledge, the two palettes, the tokens — is
`DESIGN.md`'s half.

1. **Readable at 720p by someone who is not playing.** Every size, contrast and state decision is
   settled at stream resolution, not on the designer's monitor. If a value cannot survive a
   re-encode, it is too small regardless of how it measures locally.
2. **Objects, not surfaces.** Everything pressable is a body you press *into*. Depth is constructed,
   never suggested by a blur. If you cannot press it into something, it is not finished.
3. **Colour is a rule, not decoration.** The brand palette encodes intent and the suit palette
   encodes gameplay, and the two never substitute for one another. Anything that means something by
   hue alone also carries a shape.
4. **The server is the truth and the client is the performance.** Optimism is allowed in the
   animation and nowhere else. A refusal is translated into the player's voice before it is shown,
   and a state the server corrects is corrected silently.
5. **Collect nothing.** No account, no cookie, no analytics, no tracker. It is the compliance
   strategy and it is also the product promise: a nickname is the whole cost of entry.
6. **A reaction game does not move its buttons.** Controls hold their coordinates for the whole
   match, disabled in place rather than unmounted, because a layout that reflows mid-window steals
   the window.

## Accessibility & Inclusion

**Target: WCAG AA on every player-facing surface**, and the product decision underneath it is that
access is bought with ink and shape rather than by dimming the game. Contrast comes from outlines,
never from darkened brand colours. Every suit carries a silhouette as well as a hue, and never a
letter — R and V name different colours in French and English. Reduced motion is a preference rather
than only a media query, so the player's answer can win over the system's in both directions, and
motion degrades to a readable static state rather than to nothing: "this just became playable" is
information. Both languages are first class, and a French URL opens in French whatever the browser
asks for.

The measurements, the tokens and the tests that hold each of those: `CLAUDE.md` and
[`docs/notes/visual.md`](docs/notes/visual.md).

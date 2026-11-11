/**
 * Whether the mounted game is on screen, or parked behind a content page.
 *
 * The router keeps the game alive across a navigation (routes/+layout.svelte): the
 * socket stays open, the music keeps playing, the seat stays taken. What must
 * not survive the trip is anything the game does *to the document* — the
 * `data-seated` attribute that costs a page its pinch and its text selection,
 * and the TAB key the scoreboard holds. A content page read while a match runs
 * in the background is a page to read, and both of those would take it away.
 *
 * One reactive flag, written by the root layout as the router moves on and off a game page,
 * read by the two effects that act on the document.
 */
export const gameShown = $state({ current: true })

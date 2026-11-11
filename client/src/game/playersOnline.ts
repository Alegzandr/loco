/**
 * Whether the home screen draws its count of connected players.
 *
 * The number itself is honest — it is every socket the server is holding — but
 * a low one is not information, it is a reason to close the tab. The same
 * reasoning keeps the matchmaking queue's size off the wire entirely
 * (`SMsgMatchmakingQueued`); here the number has a use above the floor, so the
 * chip is drawn from two up and simply absent below it rather than rounded,
 * padded or reworded. Nothing on screen ever says a number that is not the one
 * the server sent.
 *
 * Two, counting yourself: one is "you are alone", which is the reading being
 * spared. It lives here rather than in the component so a test can state the
 * rule without mounting a screen.
 */
export const PLAYERS_ONLINE_MIN = 2

/** True when the count is worth drawing. */
export function showPlayersOnline(count: number): boolean {
  return count >= PLAYERS_ONLINE_MIN
}

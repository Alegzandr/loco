/**
 * Server prose → player voice.
 *
 * The server's error strings are written for whoever is reading the logs:
 * "illegal card play", "you must draw a card before passing", `nickname %q
 * already taken`. They are English, they are imperative in the developer sense
 * rather than the player sense, and they used to reach the screen verbatim — so
 * a French player tapping the wrong card was told "not your turn" in a UI that
 * is otherwise entirely in their language.
 *
 * This maps the strings a player can actually provoke onto localised copy that
 * says what to do next. It matches on patterns rather than equality because
 * several server messages interpolate values (`nickname %q already taken`,
 * `room is full (max %d players)`).
 *
 * Deliberately NOT a protocol change. The wire keeps its human-readable string;
 * the client owns how a refusal is phrased to the person who caused it, the
 * same way it owns every other piece of copy. Anything unrecognised falls back
 * to a localised generic — a player never sees a raw wire string, but a new
 * server message is not a crash either.
 */
import type { ErrorCopy } from './en'

/**
 * Ordered rules. First match wins, so narrower patterns come before broader
 * ones (`counter card must match …` before the bare `card` rules).
 */
const RULES: ReadonlyArray<readonly [RegExp, keyof ErrorCopy]> = [
  // ── Joining ──────────────────────────────────────────────────────────────
  // `.*` rather than ` .* ` on purpose: the server interpolates the nickname
  // (`nickname %q already taken`), but the bare form exists too and must not
  // fall through to the generic message.
  [/nickname\b.*already taken/i, 'nicknameTaken'],
  // One rule for every way a nickname can be refused (length, charset, blocked
  // term): the server sends one string for all three, deliberately, so that a
  // player cannot read the rule off the refusal and step around it. See
  // server/game/nickname.go.
  [/nickname not allowed/i, 'nicknameRejected'],
  [/room not found|invalid room code/i, 'roomNotFound'],
  [/room is full/i, 'roomFull'],
  [/game already (in progress|started)/i, 'gameInProgress'],
  // Kept for a client talking to a server from before the reclaim refusal was
  // made uniform (a rolling deploy is exactly that window). Current servers
  // answer a stale token with `game already in progress` instead, on purpose:
  // the old pair of strings told anyone with a table code which nicknames were
  // seated at it. See server/hub/hub.go, handleJoinRoom.
  [/invalid session token/i, 'sessionInvalid'],
  // Before `not in a room`: the two differ by one word and the broader rule
  // would otherwise have to be trusted not to drift into matching both.
  [/already in a room/i, 'alreadyInRoom'],
  [/not in a room/i, 'notInRoom'],

  // ── Turn legality ────────────────────────────────────────────────────────
  [/not your turn/i, 'notYourTurn'],
  [/must counter or draw pending/i, 'mustAnswerPenalty'],
  [/already drawn this turn/i, 'alreadyDrew'],
  [/must draw a card before passing/i, 'mustDrawFirst'],
  [/must choose a color/i, 'needColor'],
  [/card not in hand|hand has \d+ copies/i, 'cardNotInHand'],
  [/illegal card play/i, 'illegalCard'],

  // ── Draw stack ───────────────────────────────────────────────────────────
  [/counter card must match/i, 'counterMismatch'],
  [/no pending draw to counter/i, 'noPendingDraw'],

  // ── Interrupts & batches ─────────────────────────────────────────────────
  [/interrupt window closed/i, 'interruptClosed'],
  [/cannot interrupt active draw chain/i, 'interruptDrawChain'],
  [/interrupt card must exactly match/i, 'interruptMismatch'],
  [/cannot be batch-(played|interrupted)/i, 'batchNotAllowed'],
  [/batch cards must be identical/i, 'batchMismatch'],

  // ── LOCO declaration & catch ─────────────────────────────────────────────
  // The one refusal here that answers a tap on a perfectly legal card: the seat
  // is about to take the round without ever having called. The copy has to send
  // the player to the button rather than explain a rule, because the button is
  // on screen and the round is one press away. See game.ErrMustDeclareLoco.
  [/must call LOCO! before/i, 'mustDeclareBeforeWinning'],
  [/can only declare with exactly 1 card/i, 'declareTooEarly'],
  [/player already declared/i, 'alreadyDeclared'],
  [/catch window expired/i, 'catchExpired'],
  [/target (does not have exactly 1 card|did not just play)/i, 'catchTargetSafe'],

  // ── Swap ─────────────────────────────────────────────────────────────────
  [/cannot swap with yourself/i, 'swapSelf'],
  // `invalid player index` is the same answer for the same reason: a seat the
  // server will not act on. Only a client that made its own message can see it
  // — the kick button never offers an unseated row.
  [/invalid chosen_player|invalid player index/i, 'swapTargetInvalid'],

  // ── Lobby & host ─────────────────────────────────────────────────────────
  [/only the (host|room owner)/i, 'hostOnly'],
  // Not a refusal: the one line here that answers a message the player did not
  // send. `kicked` carries it so the seat disappearing has a reason attached.
  [/removed by the host/i, 'kicked'],
  [/need at least \d+ players/i, 'notEnoughPlayers'],
  [/can only (add bots|remove players) in the lobby|cannot change (format|max players) after/i, 'lobbyOnly'],
  [/max players cannot|cannot set max players/i, 'maxPlayersInvalid'],
  [/rematch is only available/i, 'rematchTooEarly'],

  // ── Matchmaking ──────────────────────────────────────────────────────────
  [/already searching for an opponent/i, 'alreadySearching'],
  [/not available in a matchmade game/i, 'matchmadeUnavailable'],
  [/cannot leave a match in progress/i, 'cannotLeaveMatch'],
  [/opponent has left the table/i, 'opponentGone'],
  // Two sentinels rather than prose: the server sends these as machine strings
  // (afk_forfeit, afk_kicked) precisely because they are read after the fact,
  // on a game-over screen, by somebody who was not looking.
  [/afk_forfeit/i, 'afkForfeit'],
  [/afk_kicked/i, 'afkKicked'],

  // ── Transport ────────────────────────────────────────────────────────────
  [/rate limit exceeded/i, 'rateLimited'],
  [/server busy/i, 'serverBusy'],
  // The admission ceilings and the recovered-panic answer. All three are
  // refusals a player can be handed without having done anything, so the copy
  // says what to do (wait, retry) rather than what happened. See the caps in
  // server/hub/hub.go.
  [/server is full/i, 'serverFull'],
  [/too many attempts/i, 'tooManyAttempts'],
  [/^server error$/i, 'serverError'],
  // A gameplay message at a table that has not dealt, answered by dispatch
  // itself. Ordinary rather than suspicious: a reconnect crossing a round end
  // on the wire produces it. Safe this far down because `game already in
  // progress` above needs the word "already" and cannot swallow it.
  [/game not in progress/i, 'gameNotInProgress'],
  // A deploy in progress. Above nothing in particular, but it must never fall
  // through to the generic: the whole point of the string is that the player
  // learns their table code was fine and the wait is short. See
  // server/hub/drain.go.
  [/server updating/i, 'serverUpdating'],
  // The one entry here the server never sends: a seat reclaim that timed out is
  // decided client-side (useRestoreTimeout), and it lands in the same errorMsg
  // slot as every refusal, so it resolves through the same table rather than
  // reaching the screen as the developer string it is.
  [/reconnect (failed|cancell?ed)/i, 'reconnectFailed'],
  // There is deliberately no rule for an exhausted deck: a draw cannot fail any
  // more (Deck.DrawUpTo), so no server path can produce that refusal. A rule
  // kept for a message nobody sends is a rule nobody maintains.
]

/**
 * Resolve a raw server error string to localised player-facing copy.
 * Returns the generic message for anything unrecognised — never the raw string.
 */
export function resolveServerError(raw: string, errors: ErrorCopy): string {
  if (!raw) return ''
  for (const [pattern, key] of RULES) {
    if (pattern.test(raw)) return errors[key]
  }
  return errors.generic
}

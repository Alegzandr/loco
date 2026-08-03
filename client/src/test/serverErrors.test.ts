import { describe, it, expect } from 'vitest'
import { resolveServerError } from '../i18n/serverErrors'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'

describe('resolveServerError', () => {
  it('never returns the raw server string', () => {
    // Every error the server can send a player, verbatim from
    // server/game/*.go and server/hub/*.go.
    const raw = [
      'nickname "Alice" already taken',
      'nickname already taken',
      'nickname not allowed',
      'room not found',
      'invalid room code',
      'room is full (max 10 players)',
      'game already in progress',
      'game already started',
      'invalid session token for reconnect',
      'not in a room',
      'already in a room',
      'not your turn',
      'must counter or draw pending penalty cards first',
      'you have already drawn this turn',
      'you must draw a card before passing',
      'must choose a color for a wild card',
      'card not in hand',
      'hand has 2 copies, need 3',
      'illegal card play',
      'counter card must match color of draw card',
      'counter card must match kind of draw card',
      'no pending draw to counter',
      'interrupt window closed',
      'cannot interrupt active draw chain except with an identical draw card',
      'interrupt card must exactly match the top discard card',
      'Swap and GlobalSwitch cannot be batch-played',
      'Swap and GlobalSwitch cannot be batch-interrupted',
      'batch cards must be identical',
      'can only declare with exactly 1 card in hand',
      'player already declared',
      'catch window expired',
      'target does not have exactly 1 card',
      'target did not just play to 1 card',
      // A Contre-LOCO! on a seat that has not been catchable at all. It reads
      // the same way to the player as a window that shut a moment ago — the
      // difference is what it costs, and that is the server's business.
      'target did not just play their last card',
      'cannot swap with yourself',
      'invalid chosen_player 3 for swap',
      'only the host can start a rematch',
      'only the room owner can start the game',
      'need at least 2 players to start',
      'can only add bots in the lobby',
      'cannot change format after game starts',
      'max players cannot exceed 10',
      'rematch is only available once the match is over',
      'rate limit exceeded',
      'server busy, please retry',
      // Matchmaking. The two sentinels are machine strings on purpose: they are
      // read after the fact, on a game-over screen, so they must resolve like
      // any other refusal rather than reach the player as an identifier.
      'already searching for an opponent',
      'not available in a matchmade game',
      'you cannot leave a match in progress',
      'your opponent has left the table',
      'afk_forfeit',
      'afk_kicked',
      // A deploy in progress. Every action that would start a new match answers
      // with this while the server drains; see server/hub/drain.go.
      'server updating, try again in a moment',
      // The admission ceilings, the wrong-code throttle and the answer a
      // recovered handler panic sends. All four are refusals the player did not
      // earn, and none of them may reach the screen as the wire string it is.
      // See the caps in server/hub/hub.go.
      'the server is full, try again in a moment',
      'too many attempts, wait a moment',
      'server error',
      // Sent by dispatch for any gameplay message at a table that has not dealt.
      // It used to fall through to the generic copy.
      'game not in progress',
      // Client-authored, but it lands in the same errorMsg slot and is rendered
      // through the same table, so it belongs to the same guarantee.
      'reconnect failed',
      'reconnect cancelled',
    ]

    for (const message of raw) {
      for (const t of [en, fr]) {
        const resolved = resolveServerError(message, t.errors)
        expect(resolved).not.toBe(message)
        expect(resolved.length).toBeGreaterThan(0)
      }
    }
  })

  it('maps the errors a player hits most to their own copy, not the generic', () => {
    expect(resolveServerError('not your turn', en.errors)).toBe(en.errors.notYourTurn)
    expect(resolveServerError('not your turn', fr.errors)).toBe(fr.errors.notYourTurn)
    expect(resolveServerError('illegal card play', fr.errors)).toBe(fr.errors.illegalCard)
    expect(resolveServerError('nickname "Bob" already taken', fr.errors))
      .toBe(fr.errors.nicknameTaken)
    // The bare form, without an interpolated nickname, must map too.
    expect(resolveServerError('nickname already taken', fr.errors))
      .toBe(fr.errors.nicknameTaken)
    // Every nickname refusal is one server string and one line of copy: the
    // player must not be able to read the rule that fired off the message and
    // walk around it. See server/game/nickname.go.
    expect(resolveServerError('nickname not allowed', fr.errors))
      .toBe(fr.errors.nicknameRejected)
    expect(resolveServerError('nickname not allowed', en.errors))
      .toBe(en.errors.nicknameRejected)
    expect(resolveServerError('interrupt window closed', fr.errors))
      .toBe(fr.errors.interruptClosed)
    // A refusal during a deploy must never read as "no table with that code":
    // the code the player typed was real, the server just cannot open it yet.
    expect(resolveServerError('server updating, try again in a moment', fr.errors))
      .toBe(fr.errors.serverUpdating)
    expect(resolveServerError('server updating, try again in a moment', en.errors))
      .not.toBe(en.errors.roomNotFound)
  })

  it('prefers the narrower rule when two could match', () => {
    // Both mention a card; the counter rule must win over the generic card ones.
    expect(resolveServerError('counter card must match color of draw card', en.errors))
      .toBe(en.errors.counterMismatch)
    // "hand has N copies" is a batch-play shortfall, i.e. cards you do not hold.
    expect(resolveServerError('hand has 2 copies, need 3', en.errors))
      .toBe(en.errors.cardNotInHand)
    // One word apart, opposite meanings: a socket refused a second seat versus a
    // socket that holds none. Neither may resolve to the other's copy.
    expect(resolveServerError('already in a room', en.errors)).toBe(en.errors.alreadyInRoom)
    expect(resolveServerError('not in a room', en.errors)).toBe(en.errors.notInRoom)
    // Same shape, one word apart: a table that has already dealt versus one that
    // has not dealt at all. The first is a refusal to join, the second a refusal
    // to play, and swapping them would tell a player the opposite of what
    // happened.
    expect(resolveServerError('game already in progress', en.errors)).toBe(en.errors.gameInProgress)
    expect(resolveServerError('game not in progress', en.errors)).toBe(en.errors.gameNotInProgress)
  })

  it('falls back to a localised generic for anything unrecognised', () => {
    expect(resolveServerError('some future server message', en.errors)).toBe(en.errors.generic)
    expect(resolveServerError('some future server message', fr.errors)).toBe(fr.errors.generic)
  })

  it('returns an empty string for no error, so callers can render nothing', () => {
    expect(resolveServerError('', en.errors)).toBe('')
  })
})

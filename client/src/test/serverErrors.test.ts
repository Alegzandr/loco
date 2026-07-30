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
      'nickname must be 1–20 characters',
      'room not found',
      'invalid room code',
      'room is full (max 10 players)',
      'game already in progress',
      'game already started',
      'invalid session token for reconnect',
      'not in a room',
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
      'deck exhausted',
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
    expect(resolveServerError('interrupt window closed', fr.errors))
      .toBe(fr.errors.interruptClosed)
  })

  it('prefers the narrower rule when two could match', () => {
    // Both mention a card; the counter rule must win over the generic card ones.
    expect(resolveServerError('counter card must match color of draw card', en.errors))
      .toBe(en.errors.counterMismatch)
    // "hand has N copies" is a batch-play shortfall, i.e. cards you do not hold.
    expect(resolveServerError('hand has 2 copies, need 3', en.errors))
      .toBe(en.errors.cardNotInHand)
  })

  it('falls back to a localised generic for anything unrecognised', () => {
    expect(resolveServerError('some future server message', en.errors)).toBe(en.errors.generic)
    expect(resolveServerError('some future server message', fr.errors)).toBe(fr.errors.generic)
  })

  it('returns an empty string for no error, so callers can render nothing', () => {
    expect(resolveServerError('', en.errors)).toBe('')
  })
})

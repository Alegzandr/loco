/**
 * Two files in `src/components/` describe rules the server owns:
 * `tableCodeRules.ts` mirrors the table code's alphabet and length,
 * `nicknameRules.ts` mirrors the shape half of `game.ValidateNickname`. Both
 * exist so the lobby can refuse something impossible without a round trip, and
 * both are documented as mirrors, which is worth exactly as much as whatever
 * checks they still match.
 *
 * Nothing did. A mirror drifts in the direction that hurts most quietly: the
 * client goes *stricter* than the server and refuses a code or a name the
 * server would have seated, with no error anywhere, because from the player's
 * side a disabled button is indistinguishable from a button they have not
 * earned yet. The looser direction is caught by the server and costs a round
 * trip; the stricter one is not caught by anything.
 *
 * So each test below pins the copy to the source, the same way
 * `contentPages.test.ts` pins the deck table to `server/game/deck.go`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { TABLE_CODE_CHARS, TABLE_CODE_LENGTH, isTableCodeValid } from '../components/tableCodeRules'
import { NICKNAME_MAX_CHARS, isNicknameShapeValid } from '../components/nicknameRules'

const REPO = path.resolve(__dirname, '..', '..', '..')
const read = (...p: string[]) => readFileSync(path.join(REPO, 'server', ...p), 'utf8')

describe('the table code, against the server', () => {
  // hub.roomCodeRe is what join_room is validated against.
  const rooms = read('hub', 'rooms.go')
  const re = rooms.match(/roomCodeRe = regexp\.MustCompile\(`\^\[([^\]]+)\]\{(\d+)\}\$`\)/)

  it('is refused by the same regex the server holds', () => {
    expect(re, 'roomCodeRe not found in server/hub/rooms.go').toBeTruthy()
    expect(re![1]).toBe(TABLE_CODE_CHARS)
    expect(Number(re![2])).toBe(TABLE_CODE_LENGTH)
  })

  // hub.generateCode is what a code is actually drawn from. It is a second copy
  // of the same alphabet server-side, so it is pinned here too: a code the
  // server can produce and its own regex would refuse is a table nobody joins.
  it('is drawn from that same alphabet', () => {
    const tokens = read('hub', 'tokens.go')
    // Scoped to generateCode's own body: the session token in the same file
    // draws its own bytes, and matching that one would pin the code's length to
    // a number that has nothing to do with it.
    const body = tokens.slice(tokens.indexOf('func (h *Hub) generateCode()'))
    expect(body, 'generateCode not found in server/hub/tokens.go').toBeTruthy()
    const chars = body.match(/const chars = "([^"]+)"/)
    const size = body.match(/make\(\[\]byte, (\d+)\)/)
    expect(chars, 'the code alphabet was not found in generateCode').toBeTruthy()
    expect(chars![1]).toBe(TABLE_CODE_CHARS)
    expect(Number(size![1])).toBe(TABLE_CODE_LENGTH)
  })

  // The four characters are dropped because a code is read out loud off a
  // stream. Asserted as behaviour and not only as a string, so a well-meant
  // "completion" of the alphabet fails here rather than on air.
  it('drops the four characters a listener cannot tell apart', () => {
    for (const ch of ['I', 'O', '0', '1']) {
      expect(TABLE_CODE_CHARS.includes(ch), `${ch} must stay out of the alphabet`).toBe(false)
    }
    expect(isTableCodeValid('ABCDE0')).toBe(false)
    expect(isTableCodeValid('ABCDEF')).toBe(true)
  })
})

describe('the nickname, against the server', () => {
  const nickname = read('game', 'nickname.go')

  it('is capped at the same number of characters', () => {
    const max = nickname.match(/NicknameMaxRunes = (\d+)/)
    expect(max, 'NicknameMaxRunes not found in server/game/nickname.go').toBeTruthy()
    expect(Number(max![1])).toBe(NICKNAME_MAX_CHARS)
  })

  // The client is allowed to be looser than the server (the word list is not
  // shipped, and a blocked term comes back as an ordinary refusal). It is never
  // allowed to be stricter: these are the names the server seats, and a lobby
  // that greys out "Take a seat" for one of them is a wall with no message on
  // it. Scunthorpe cases belong here the day the server gains a rule for them.
  it('lets through every name the server would seat', () => {
    const seated = [
      'Alexandre',
      'Constance',
      'Dominique',
      "O'Brien",
      'Anne-Marie',
      'Mr. Bean',
      'Étienne',
      'Ζωή',
      'Иван',
      'P1',
      'a',
      'A'.repeat(NICKNAME_MAX_CHARS),
    ]
    for (const name of seated) {
      expect(isNicknameShapeValid(name), `${name} must keep playing`).toBe(true)
    }
  })

  it('refuses the shapes the server refuses', () => {
    const refused = [
      '',
      ' ',
      'A'.repeat(NICKNAME_MAX_CHARS + 1),
      '---',
      'a​b', // zero width space
      'a‮b', // bidi override
      'é́́', // a stack of combining marks
      '́a', // a mark with nothing to modify
      '🎉',
      '<b>',
    ]
    for (const name of refused) {
      expect(isNicknameShapeValid(name), `${JSON.stringify(name)} must be refused`).toBe(false)
    }
  })
})

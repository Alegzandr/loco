import { describe, it, expect } from 'vitest'
import {
  canonicalNickname,
  isNicknameShapeValid,
  NICKNAME_MAX_CHARS,
} from '../components/nicknameRules'

/**
 * The client half of nickname validation. It mirrors the *shape* rules of
 * server/game/nickname.go so the refusal is instant; the word list and the
 * verdict stay on the server. Every case here has a counterpart in
 * server/game/nickname_test.go, and they must not drift apart.
 */
describe('canonicalNickname', () => {
  it('trims and squeezes runs of spaces', () => {
    expect(canonicalNickname('  Alice  ')).toBe('Alice')
    expect(canonicalNickname('Jean   Luc')).toBe('Jean Luc')
  })
})

describe('isNicknameShapeValid', () => {
  it('accepts the names people are actually called', () => {
    for (const n of [
      'Alice',
      'Étienne',
      'Chloé',
      "O'Brien",
      'Anne-Marie',
      'Mr. Bean',
      'joueur_42',
      'Дима',
      'Ω-player',
      'Á', // one combining mark on a base letter
    ]) {
      expect(isNicknameShapeValid(n), n).toBe(true)
    }
  })

  it('refuses on length, counting characters and not bytes', () => {
    expect(isNicknameShapeValid('')).toBe(false)
    expect(isNicknameShapeValid('   ')).toBe(false)
    expect(isNicknameShapeValid('a'.repeat(NICKNAME_MAX_CHARS + 1))).toBe(false)
    // 20 accented characters are 40 bytes and are still 20 characters.
    expect(isNicknameShapeValid('é'.repeat(NICKNAME_MAX_CHARS))).toBe(true)
  })

  it('refuses the characters that hide, reverse or overflow a seat label', () => {
    const cases: Record<string, string> = {
      'zero-width space': 'Ali​ce',
      'zero-width joiner': 'Ali‍ce',
      'byte order mark': 'Ali﻿ce',
      'soft hyphen': 'Ali­ce',
      'RTL override': 'Ali‮ce',
      'bidi isolate': '⁦Alice⁩',
      'non-breaking space': 'Ali ce',
      newline: 'Ali\nce',
      emoji: 'Alice\u{1f525}',
      'stacked diacritics': 'Á́́lice',
      'leading combining mark': '́Alice',
      'mathematical bold': '\u{1d41f}\u{1d42e}\u{1d41c}\u{1d424}',
      markup: '<script>',
      'no letter or digit': '---',
    }
    for (const [name, value] of Object.entries(cases)) {
      expect(isNicknameShapeValid(value), name).toBe(false)
    }
  })

  it('leaves the blocked-word verdict to the server', () => {
    // The shape is fine, so the client sends it and the server refuses it with
    // the same one line the client would have used. The list is not shipped.
    expect(isNicknameShapeValid('fuck')).toBe(true)
  })
})

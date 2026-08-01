import { describe, it, expect, beforeEach } from 'vitest'
import {
  NICKNAME_KEY,
  NICKNAME_MAX,
  readNickname,
  rememberNickname,
} from '../hooks/nicknameMemory'

describe('nicknameMemory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an empty string when nothing was ever stored', () => {
    expect(readNickname()).toBe('')
  })

  it('reads back what was remembered', () => {
    rememberNickname('Alice')
    expect(readNickname()).toBe('Alice')
  })

  it('survives a fresh module read, i.e. a new visit', () => {
    localStorage.setItem(NICKNAME_KEY, 'Bob')
    expect(readNickname()).toBe('Bob')
  })

  it('trims on the way in', () => {
    rememberNickname('  Carol  ')
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('Carol')
  })

  it('forgets rather than storing a blank name', () => {
    rememberNickname('Dave')
    rememberNickname('   ')
    expect(readNickname()).toBe('')
  })

  it('never returns more than the input accepts', () => {
    localStorage.setItem(NICKNAME_KEY, 'x'.repeat(NICKNAME_MAX + 10))
    expect(readNickname()).toHaveLength(NICKNAME_MAX)
  })

  it('truncates on the way in too', () => {
    rememberNickname('y'.repeat(NICKNAME_MAX + 5))
    expect(localStorage.getItem(NICKNAME_KEY)).toHaveLength(NICKNAME_MAX)
  })
})

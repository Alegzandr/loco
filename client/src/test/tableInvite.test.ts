import { describe, it, expect, beforeEach } from 'vitest'
import {
  INVITE_PARAM,
  initTableInvite,
  peekTableInvite,
  takeTableInvite,
  tableInviteUrl,
} from '../hooks/tableInvite'
import { SESSION_KEY, writeSession } from '../hooks/sessionPersistence'

function visit(url: string) {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  sessionStorage.clear()
  visit('/')
  takeTableInvite()
})

describe('the link a table is shared with', () => {
  // The game's address and a code. No language on it: a link is forwarded, and
  // the sender does not get to decide what the reader's browser opens in.
  it('is the game’s own URL and the code, and nothing else', () => {
    expect(tableInviteUrl('ABC234', 'https://loco.test')).toBe(
      `https://loco.test/?${INVITE_PARAM}=ABC234`,
    )
  })
})

describe('arriving on a link', () => {
  it('picks the code up, whatever case it was pasted in', () => {
    visit('/?t=abc234')
    initTableInvite()
    expect(peekTableInvite()).toBe('ABC234')
  })

  it('takes the code out of the address bar', () => {
    visit('/?t=abc234&showcase')
    initTableInvite()
    expect(window.location.search).toBe('?showcase')
  })

  it('ignores something that could not be a table', () => {
    visit('/?t=nope')
    initTableInvite()
    expect(peekTableInvite()).toBe('')
    expect(window.location.search).toBe('')
  })

  it('is spent once: a re-read never re-joins', () => {
    visit('/?t=abc234')
    initTableInvite()
    expect(takeTableInvite()).toBe('ABC234')
    expect(takeTableInvite()).toBe('')
    expect(peekTableInvite()).toBe('')
  })
})

describe('a link that arrives on a tab holding a seat', () => {
  it('wins over a record naming another table', () => {
    writeSession({ roomCode: 'ZZZ999', nickname: 'Alice', sessionToken: 'tok', target: 'game' })
    visit('/?t=abc234')
    initTableInvite()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('leaves the reclaim alone when it names the same table', () => {
    writeSession({ roomCode: 'ABC234', nickname: 'Alice', sessionToken: 'tok', target: 'game' })
    visit('/?t=abc234')
    initTableInvite()
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull()
  })
})

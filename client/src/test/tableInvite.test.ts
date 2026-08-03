import { describe, it, expect, beforeEach } from 'vitest'
import {
  INVITE_PARAM,
  INVITE_PATH,
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
  // A page and a code. No language on it: a link is forwarded, and the sender
  // does not get to decide what the reader's browser opens in.
  it('is the invite page and the code, and nothing else', () => {
    expect(tableInviteUrl('ABC234', 'https://loco.test')).toBe(
      `https://loco.test${INVITE_PATH}?${INVITE_PARAM}=ABC234`,
    )
  })
})

describe('arriving on a link', () => {
  it('picks the code up, whatever case it was pasted in', () => {
    visit('/i/?t=abc234')
    initTableInvite()
    expect(peekTableInvite()).toBe('ABC234')
  })

  it('takes the code out of the address bar, and lands somewhere real', () => {
    // Not `/i/`, which is a door with nothing behind it: a reload has to arrive
    // at a page, and the home page is the one this document already is.
    visit('/i/?t=abc234&showcase')
    initTableInvite()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?showcase')
  })

  it('ignores something that could not be a table', () => {
    visit('/i/?t=nope')
    initTableInvite()
    expect(peekTableInvite()).toBe('')
    expect(window.location.pathname).toBe('/')
  })

  it('is spent once: a re-read never re-joins', () => {
    visit('/i/?t=abc234')
    initTableInvite()
    expect(takeTableInvite()).toBe('ABC234')
    expect(takeTableInvite()).toBe('')
    expect(peekTableInvite()).toBe('')
  })
})

// One URL is an invitation. `?t=` used to be read on every page, because it is
// what the button handed out before the invite page existed; it is not any more,
// and this runs on every page load, so the difference is whether a query string
// somebody else put on the home page can seat a player.
describe('the parameter anywhere but the invite page', () => {
  it('is not a table', () => {
    visit('/?t=abc234')
    initTableInvite()
    expect(peekTableInvite()).toBe('')
  })

  it('is left exactly where it is', () => {
    // Not ours to take out of the address bar either. The same rule that keeps
    // `?showcase` intact keeps this intact.
    visit('/?t=abc234&showcase')
    initTableInvite()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?t=abc234&showcase')
  })

  it('is not a table under a language prefix either', () => {
    visit('/fr/?t=abc234')
    initTableInvite()
    expect(peekTableInvite()).toBe('')
    expect(window.location.pathname).toBe('/fr/')
  })
})

describe('an invite link that lost its trailing slash', () => {
  // nginx resolves `/i` through `try_files $uri/`, so this document is served
  // and the code on it is still an invitation.
  it('is read all the same', () => {
    visit('/i?t=abc234')
    initTableInvite()
    expect(peekTableInvite()).toBe('ABC234')
    expect(window.location.pathname).toBe('/')
  })
})

describe('a link that arrives on a tab holding a seat', () => {
  it('wins over a record naming another table', () => {
    writeSession({ roomCode: 'ZZZ999', nickname: 'Alice', sessionToken: 'tok', target: 'game' })
    visit('/i/?t=abc234')
    initTableInvite()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('leaves the reclaim alone when it names the same table', () => {
    writeSession({ roomCode: 'ABC234', nickname: 'Alice', sessionToken: 'tok', target: 'game' })
    visit('/i/?t=abc234')
    initTableInvite()
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull()
  })
})

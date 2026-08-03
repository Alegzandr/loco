import { describe, it, expect, beforeEach } from 'vitest'
import * as v from 'valibot'
import { render, screen } from './render'
import { en } from '../i18n/en'
import { gameStore } from '../hooks/gameStore'
import ServerUpdating from '../components/ServerUpdating.svelte'
import { serverMsgTypeSchema } from '../types/protocolSchemas'

describe('the deploy notice', () => {
  beforeEach(() => {
    gameStore.setState({ serverUpdating: false })
  })

  it('is a message type the client accepts', () => {
    // webSocket drops anything the schema does not name, so a server_updating
    // that is not in here reaches nobody and the banner never appears.
    expect(v.safeParse(serverMsgTypeSchema, 'server_updating').success).toBe(true)
  })

  it('promises the match finishes, and asks for nothing', () => {
    render(ServerUpdating)
    expect(screen.getByText(en.serverUpdatingBanner)).toBeInTheDocument()
    // No button, no input: a player who ignores this loses nothing, and the
    // copy has to be the only thing it puts on the board.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // A waiting room and a game-over screen have no match to promise anything
  // about: what a deploy costs them is the button they are looking at, and
  // saying so before it is pressed is the point of putting the notice there at
  // all. Those two used to hear nothing and find out by being refused.
  it('says something else on a screen where no match is running', () => {
    render(ServerUpdating, { variant: 'card' })
    expect(screen.getByText(en.serverUpdatingWaiting)).toBeInTheDocument()
    expect(screen.queryByText(en.serverUpdatingBanner)).not.toBeInTheDocument()
  })

  it('never takes a tap away from the board', () => {
    // It lives in the top chrome row and is pointer-events: none, because a
    // notice that can swallow a click on a reaction game's board is a bug.
    const { container } = render(ServerUpdating)
    const banner = container.firstElementChild as HTMLElement
    expect(banner.className).toContain('banner')
    expect(banner.getAttribute('role')).toBe('status')
  })
})

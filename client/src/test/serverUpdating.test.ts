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

  it('never takes a tap away from the board', () => {
    // It lives in the top chrome row and is pointer-events: none, because a
    // notice that can swallow a click on a reaction game's board is a bug.
    const { container } = render(ServerUpdating)
    const banner = container.firstElementChild as HTMLElement
    expect(banner.className).toContain('banner')
    expect(banner.getAttribute('role')).toBe('status')
  })
})

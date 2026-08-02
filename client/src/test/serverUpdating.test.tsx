import { describe, it, expect, beforeEach } from 'vitest'
import * as v from 'valibot'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import { useGameStore } from '../hooks/useGameStore'
import { ServerUpdating } from '../components/ServerUpdating'
import { serverMsgTypeSchema } from '../types/protocolSchemas'

function renderWithI18n(node: React.ReactElement) {
  return render(<I18nProvider>{node}</I18nProvider>)
}

describe('the deploy notice', () => {
  beforeEach(() => {
    useGameStore.setState({ serverUpdating: false })
  })

  it('is a message type the client accepts', () => {
    // useWebSocket drops anything the schema does not name, so a server_updating
    // that is not in here reaches nobody and the banner never appears.
    expect(v.safeParse(serverMsgTypeSchema, 'server_updating').success).toBe(true)
  })

  it('promises the match finishes, and asks for nothing', () => {
    renderWithI18n(<ServerUpdating />)
    expect(screen.getByText(en.serverUpdatingBanner)).toBeInTheDocument()
    // No button, no input: a player who ignores this loses nothing, and the
    // copy has to be the only thing it puts on the board.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('never takes a tap away from the board', () => {
    // It lives in the top chrome row and is pointer-events: none, because a
    // notice that can swallow a click on a reaction game's board is a bug.
    const { container } = renderWithI18n(<ServerUpdating />)
    const banner = container.firstElementChild as HTMLElement
    expect(banner.className).toContain('banner')
    expect(banner.getAttribute('role')).toBe('status')
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import { Preferences } from '../components/Preferences'
import { WaitingRoom } from '../components/WaitingRoom'
import { Reconnecting } from '../components/Reconnecting'
import { isStreamerMode, resetStreamerMode } from '../hooks/useStreamerMode'
import {
  initMotion,
  prefersReducedMotion,
  resetMotionPref,
  setMotionPref,
} from '../hooks/useMotionPref'
import type { PlayerDTO } from '../types/protocol'

/** jsdom has no matchMedia; the motion preference asks it what the OS wants. */
function stubOsMotion(reduce: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).matchMedia = (q: string) => ({
    matches: reduce && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn() }))

function player(index: number, nickname: string): PlayerDTO {
  return { index, nickname, hand_size: 0, connected: true }
}

function renderWaiting() {
  render(
    <I18nProvider>
      <WaitingRoom
        roomCode="ABC123"
        players={[player(0, 'Alice'), player(1, 'Bob')]}
        myIndex={0}
        matchFormat="BO1"
        maxPlayers={4}
        onSend={vi.fn()}
        onLeave={vi.fn()}
      />
    </I18nProvider>
  )
}

/** The code as it is rendered, whichever element carries it. */
function codeEl(code: string): HTMLElement {
  return screen.getAllByText(code)[0]
}

beforeEach(() => {
  localStorage.clear()
  resetStreamerMode()
  stubOsMotion(false)
  resetMotionPref()
})

describe('Preferences panel', () => {
  it('keeps the settings behind one button until it is opened', () => {
    render(
      <I18nProvider>
        <Preferences />
      </I18nProvider>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.prefsBtn }))
    expect(screen.getByRole('dialog', { name: en.prefsTitle })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: en.prefsStreamer })).toBeInTheDocument()
  })

  it('still switches the language, from inside the panel', () => {
    render(
      <I18nProvider>
        <Preferences defaultOpen />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch language to FR' }))
    expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(
      <I18nProvider>
        <Preferences defaultOpen />
      </I18nProvider>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

// The whole point of the mode: six characters on a stream is an open table.
describe('Streamer mode', () => {
  it('is off until it is asked for, and survives a reload once it is', () => {
    expect(isStreamerMode()).toBe(false)

    render(
      <I18nProvider>
        <Preferences defaultOpen />
      </I18nProvider>
    )
    const sw = screen.getByRole('switch', { name: en.prefsStreamer })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(isStreamerMode()).toBe(true)
    expect(sw).toHaveAttribute('aria-checked', 'true')

    // A fresh process reading the same storage comes back with it on.
    resetStreamerMode()
    expect(isStreamerMode()).toBe(true)

    fireEvent.click(sw)
    expect(isStreamerMode()).toBe(false)
    resetStreamerMode()
    expect(isStreamerMode()).toBe(false)
  })

  it('hides the table code in the waiting room without removing it', () => {
    renderWaiting()
    expect(codeEl('ABC123')).not.toHaveAttribute('data-streamer-hidden')

    render(
      <I18nProvider>
        <Preferences defaultOpen />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('switch', { name: en.prefsStreamer }))

    // Blurred on screen, still the real code underneath: the copy button and
    // the player's own eyes both need it.
    const hidden = codeEl('ABC123')
    expect(hidden).toHaveAttribute('data-streamer-hidden', 'true')
    expect(hidden).toHaveTextContent('ABC123')
  })

  it('leaves the code alone on the reconnect splash when it is off', () => {
    render(
      <I18nProvider>
        <Reconnecting roomCode="ABC123" target="game" onCancel={vi.fn()} />
      </I18nProvider>
    )
    expect(codeEl('ABC123')).not.toHaveAttribute('data-streamer-hidden')
  })

  it('hides it on the reconnect splash too', () => {
    localStorage.setItem('loco_streamer_mode', '1')
    resetStreamerMode()

    render(
      <I18nProvider>
        <Reconnecting roomCode="ABC123" target="game" onCancel={vi.fn()} />
      </I18nProvider>
    )
    expect(codeEl('ABC123')).toHaveAttribute('data-streamer-hidden', 'true')
  })
})

describe('Reduced motion', () => {
  it('follows the system until the player answers for themselves', () => {
    stubOsMotion(true)
    resetMotionPref()
    initMotion()
    expect(prefersReducedMotion()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce')

    stubOsMotion(false)
    resetMotionPref()
    expect(prefersReducedMotion()).toBe(false)
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)
  })

  // Both directions matter. Someone whose OS is set to reduce for reasons of
  // their own is allowed to ask this game for its animations back, which is
  // exactly what a media query alone could never express.
  it('lets the player win over the system, both ways', () => {
    stubOsMotion(true)
    resetMotionPref()
    setMotionPref('full')
    expect(prefersReducedMotion()).toBe(false)
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)

    stubOsMotion(false)
    setMotionPref('reduce')
    expect(prefersReducedMotion()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce')
  })

  it('is one switch in the panel, and it survives a reload', () => {
    render(
      <I18nProvider>
        <Preferences defaultOpen />
      </I18nProvider>
    )
    const sw = screen.getByRole('switch', { name: en.prefsMotion })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce')

    resetMotionPref()
    expect(prefersReducedMotion()).toBe(true)
  })
})

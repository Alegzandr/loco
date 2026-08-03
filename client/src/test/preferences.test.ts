import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from './render'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import Preferences from '../components/Preferences.svelte'
import WaitingRoom from '../components/WaitingRoom.svelte'
import Reconnecting from '../components/Reconnecting.svelte'
import { isStreamerMode, resetStreamerMode } from '../hooks/streamerMode'
import {
  initMotion,
  prefersReducedMotion,
  resetMotionPref,
  setMotionPref,
} from '../hooks/motionPref'
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
  render(WaitingRoom, { roomCode: "ABC123", players: [player(0, 'Alice'), player(1, 'Bob')], myIndex: 0, matchFormat: "BO1", maxPlayers: 4, onSend: vi.fn(), onLeave: vi.fn() })
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
    render(Preferences)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.prefsBtn }))
    expect(screen.getByRole('dialog', { name: en.prefsTitle })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: en.prefsStreamer })).toBeInTheDocument()
  })

  /**
   * At the entry screen applying a language is a real link to the game in the
   * other language, because half of that page is markup Astro rendered per URL —
   * the footer, the drawer, the sheet of prose — and `setLang` alone left the
   * game in French under a menu still reading English. Following the link is what
   * makes the whole document agree; `setLang` runs on the way out so the choice
   * survives it. jsdom does not navigate, which is exactly what lets this assert
   * the second half.
   */
  it('switches the language, and takes the page with it at the entry screen', () => {
    render(Preferences, { defaultOpen: true })
    fireEvent.change(screen.getByRole('combobox', { name: en.prefsLanguage }), {
      target: { value: 'fr' },
    })

    const apply = screen.getByRole('link', { name: en.prefsApply })
    expect(apply).toHaveAttribute('href', '/fr/')
    expect(apply).toHaveAttribute('hreflang', 'fr')

    fireEvent.click(apply)
    expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
  })

  /**
   * The only reason the dropdown has a button at all: at the entry screen this
   * control reloads the page, so picking must not be what fires it. Until a
   * different language is chosen the button is off, and pressing it navigates
   * nowhere.
   */
  it('does nothing until a different language is picked', () => {
    render(Preferences, { defaultOpen: true })
    const apply = screen.getByRole('link', { name: en.prefsApply })
    expect(apply).toHaveAttribute('aria-disabled', 'true')

    // The href still points at the language on screen, so even a press that
    // slipped past the guard is a no-op rather than a wrong navigation.
    expect(apply).toHaveAttribute('href', '/')
    fireEvent.click(apply)
    expect(screen.getByRole('dialog', { name: en.prefsTitle })).toBeInTheDocument()
  })

  /**
   * Past a taken seat there is nothing to agree with — `data-seated` has taken
   * the footer and the drawer off the page — and following a link would drop the
   * match. `setLang` swaps the strings where they stand, so the pick *is* the
   * application: no navigation, no button, and no sentence promising a reload
   * that never comes. A step asked for nothing is the thing being removed here,
   * so the assertion is that neither is rendered.
   */
  it('applies on the pick once a seat is taken, with nothing to press', () => {
    document.documentElement.setAttribute('data-seated', '')
    try {
      render(Preferences, { defaultOpen: true })
      expect(screen.queryByRole('link', { name: en.prefsApply })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: en.prefsApply })).not.toBeInTheDocument()
      expect(screen.queryByText(en.prefsLanguageHint)).not.toBeInTheDocument()

      fireEvent.change(screen.getByRole('combobox', { name: en.prefsLanguage }), {
        target: { value: 'fr' },
      })
      expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
    } finally {
      document.documentElement.removeAttribute('data-seated')
    }
  })

  it('closes on Escape', () => {
    render(Preferences, { defaultOpen: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /**
   * On a phone the home page's burger carries a Preferences row, and the gear it
   * would otherwise duplicate is hidden. That drawer is markup Astro rendered,
   * outside `#root`, so it asks for this panel by event — the one seam between
   * the two halves of that page, and the reason the row is not a dead control.
   */
  it('opens when the home page drawer asks for it', () => {
    render(Preferences)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent(window, new CustomEvent('loco:preferences'))
    expect(screen.getByRole('dialog', { name: en.prefsTitle })).toBeInTheDocument()
  })

  /**
   * The gear shuts the dropdown it opened, which is why this surface is allowed
   * no visible control at desktop widths. Opened from the drawer there is no gear
   * on screen at all, so the ✕ is the whole way out for a thumb — CSS reveals it
   * at the same width, and it must exist in the markup for CSS to have anything
   * to reveal.
   */
  it('carries its own way out, for the width where nothing else closes it', () => {
    render(Preferences, { defaultOpen: true })
    fireEvent.click(screen.getByRole('button', { name: en.prefsClose }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

// The whole point of the mode: six characters on a stream is an open table.
describe('Streamer mode', () => {
  it('is off until it is asked for, and survives a reload once it is', () => {
    expect(isStreamerMode()).toBe(false)

    render(Preferences, { defaultOpen: true })
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

    render(Preferences, { defaultOpen: true })
    fireEvent.click(screen.getByRole('switch', { name: en.prefsStreamer }))

    // Blurred on screen, still the real code underneath: the copy button and
    // the player's own eyes both need it.
    const hidden = codeEl('ABC123')
    expect(hidden).toHaveAttribute('data-streamer-hidden', 'true')
    expect(hidden).toHaveTextContent('ABC123')
  })

  it('leaves the code alone on the reconnect splash when it is off', () => {
    render(Reconnecting, { roomCode: "ABC123", target: "game", onCancel: vi.fn() })
    expect(codeEl('ABC123')).not.toHaveAttribute('data-streamer-hidden')
  })

  it('hides it on the reconnect splash too', () => {
    localStorage.setItem('loco_streamer_mode', '1')
    resetStreamerMode()

    render(Reconnecting, { roomCode: "ABC123", target: "game", onCancel: vi.fn() })
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
    render(Preferences, { defaultOpen: true })
    const sw = screen.getByRole('switch', { name: en.prefsMotion })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce')

    resetMotionPref()
    expect(prefersReducedMotion()).toBe(true)
  })
})

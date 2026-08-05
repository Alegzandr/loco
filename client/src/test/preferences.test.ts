import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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

/** The language control, whichever language it is currently labelled in. */
function langButton(): HTMLElement {
  return screen.getByRole('combobox', { name: new RegExp(`^(${en.prefsLanguage}|${fr.prefsLanguage})$`) })
}

/** Open the list and take a language by its autonym, the way a pointer does. */
function pickLang(autonym: string) {
  fireEvent.click(langButton())
  fireEvent.click(screen.getByRole('option', { name: autonym }))
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
   * The pick *is* the application, at the entry screen as at the table.
   *
   * It used to be two steps here, because half of `/` is markup Astro rendered
   * per URL — the footer, the drawer, the sheet of prose — and `setLang` alone
   * left the game in French under a menu still reading English. Applying was
   * therefore a real link to the other language's page, and it needed a button
   * because following it reloaded the document. The served markup carries both
   * languages now (`langSwap.ts`), so nothing reloads and there is nothing left
   * for a second press to protect.
   */
  it('switches the language on the pick, with nothing left to press', () => {
    render(Preferences, { defaultOpen: true })
    pickLang('Français')

    expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  /** Same control, same behaviour, once a seat is taken. */
  it('applies on the pick once a seat is taken too', () => {
    document.documentElement.setAttribute('data-seated', '')
    try {
      render(Preferences, { defaultOpen: true })
      pickLang('Français')
      expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
    } finally {
      document.documentElement.removeAttribute('data-seated')
    }
  })

  /**
   * The half of the page the app does not own. A language picked at the entry
   * screen has to reach the footer, the drawer and the prose Astro served, or
   * the document goes back to being half English — and the address bar has to
   * name the URL a reload would need.
   */
  it('takes the served markup and the address bar with it', () => {
    document.documentElement.dataset.servedLang = 'en'
    const footer = document.createElement('a')
    footer.href = '/rules/'
    footer.textContent = 'Rules'
    footer.dataset.altHref = '/fr/regles/'
    footer.dataset.alt = 'Règles'
    document.body.appendChild(footer)

    try {
      render(Preferences, { defaultOpen: true })
      pickLang('Français')

      expect(footer.textContent).toBe('Règles')
      expect(footer.getAttribute('href')).toBe('/fr/regles/')
      expect(window.location.pathname).toBe('/fr/')

      // And back. The document was *built* as English and is now showing
      // French, so those two disagree: a URL computed against `data-served-lang`
      // would decide there was nothing to do and leave the address bar at
      // `/fr/` over an English page, which a shared link would then hand over
      // as the French one.
      pickLang('English')
      expect(footer.textContent).toBe('Rules')
      expect(footer.getAttribute('href')).toBe('/rules/')
      expect(window.location.pathname).toBe('/')
    } finally {
      footer.remove()
      delete document.documentElement.dataset.servedLang
      history.replaceState(history.state, '', '/')
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

/**
 * The list used to be a `<select>`, which is two objects: the closed control,
 * ours to draw, and the open list, painted by the OS. `appearance: none` only
 * ever reached the first — so the panel dropped a white system menu with a blue
 * system highlight over a dark board. These pin the replacement: it is our
 * markup, and it keeps the keyboard contract a select had for free.
 */
describe('The language list', () => {
  it('is ours to draw, not the platform\'s', () => {
    const { container } = render(Preferences, { defaultOpen: true })
    expect(container.querySelector('select')).toBeNull()

    // Shut, it is one control and no options: a listbox that is always in the
    // document is a menu hanging under the panel.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(langButton())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'English' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Français' })).toHaveAttribute('aria-selected', 'false')

    // The button that opened it shuts it, which is what lets this surface get
    // away with no ✕ of its own.
    fireEvent.click(langButton())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('answers the keyboard the way the select did', () => {
    render(Preferences, { defaultOpen: true })
    const button = langButton()

    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const list = screen.getByRole('listbox')
    expect(list).toBeInTheDocument()

    // Arrowing moves the keyboard, and picks nothing until Enter: that is the
    // whole reason a language may be arrowed past at all.
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(button).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Français' }).id,
    )
    expect(screen.getByRole('option', { name: 'English' })).toHaveAttribute('aria-selected', 'true')

    // Enter is the pick, and the pick is the application: the list closes, the
    // control names the language now showing, and the panel around it is in it.
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(button).toHaveTextContent('Français')
    expect(screen.getByRole('dialog', { name: fr.prefsTitle })).toBeInTheDocument()
  })

  /**
   * One press closes one thing. The panel listens for Escape on `document`, so
   * without the list stopping that key the first press would take the whole
   * panel away and the list with it — a player backing out of a menu they
   * opened by mistake would lose every other setting on screen.
   */
  it('takes Escape for itself, and leaves the panel where it is', () => {
    render(Preferences, { defaultOpen: true })
    const button = langButton()
    fireEvent.click(button)

    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: en.prefsTitle })).toBeInTheDocument()

    // Shut, the key belongs to the panel again.
    fireEvent.keyDown(document, { key: 'Escape' })
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

  /**
   * The reveal is read off the source rather than off the DOM: jsdom applies no
   * component styles, so an assertion on a computed filter here would pass over
   * any rule at all. The two ways a click uncovers the code are both a selector,
   * and a selector is exactly what a source scan can hold.
   */
  describe('the reveal never answers a click', () => {
    // Selectors only. The comments beside them name `:focus` and `:hover` in
    // order to say why neither is used, and a scan that reads those matches the
    // explanation instead of the rule.
    const css = readFileSync('src/components/TableCode.svelte', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )

    it('reveals on :focus-visible and not on :focus', () => {
      expect(css).toContain(':focus-visible')
      // `:focus` on its own matches the mouse click that copies the code and
      // holds the reveal after the pointer has gone. The negative lookahead is
      // what tells the two apart.
      expect(css).not.toMatch(/:focus(?!-visible)/)
    })

    it('puts hover behind a real pointer', () => {
      // A touch screen emulates hover on tap and leaves it stuck there, so an
      // unguarded :hover uncovers the code on the copy gesture and keeps it
      // uncovered.
      expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/)
      const outsideQuery = css.slice(0, css.indexOf('@media (hover: hover)'))
      expect(outsideQuery).not.toContain(':hover')
    })
  })
})

describe('The panels behind the top-right row', () => {
  // Both open over whichever screen is showing, and `text-align` inherits into
  // an absolutely positioned child: the searching screen centres its column, so
  // a panel that sets nothing is set differently there than everywhere else.
  // Read off the source, because jsdom applies no component styles.
  it.each([
    ['Preferences', 'src/components/Preferences.svelte'],
    ['AudioSettings', 'src/components/AudioSettings.svelte'],
  ])('%s sets its own alignment', (_name, file) => {
    const panel = /\.panel\s*\{[^}]*\}/.exec(readFileSync(file, 'utf8'))?.[0] ?? ''
    expect(panel).toMatch(/text-align:\s*left/)
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from './render'
import { setLang } from '../i18n/store'
import FullscreenButton from '../components/FullscreenButton.svelte'

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn(), playVolumeAudition: vi.fn() }))

const COMPONENTS = join(__dirname, '..', 'components')

/**
 * jsdom implements none of the Fullscreen API, which is the first case the
 * component has to survive: no property, no chip. Everything else is stubbed
 * onto the document per test and taken off again.
 */
function stubFullscreen(enabled: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { value: enabled, configurable: true })
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    configurable: true,
    writable: true,
  })
  const request = vi.fn(() => Promise.resolve())
  const exit = vi.fn(() => Promise.resolve())
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: request,
    configurable: true,
  })
  Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
  return { request, exit }
}

function unstub() {
  for (const k of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen'] as const) {
    delete (document as unknown as Record<string, unknown>)[k]
  }
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
}

describe('FullscreenButton', () => {
  beforeEach(() => setLang('en'))
  afterEach(unstub)

  it('is absent where the document cannot go fullscreen', () => {
    // jsdom's default: the property does not exist. A WebView, an iframe without
    // allowfullscreen and iOS Safari answer the same way, and a chip that throws
    // on press is worse than no chip.
    render(FullscreenButton, {})
    expect(screen.queryByTestId('fullscreen-toggle')).toBeNull()
  })

  it('asks the document for the whole screen, and says so before it is pressed', async () => {
    const { request } = stubFullscreen(true)
    render(FullscreenButton, {})
    const btn = screen.getByRole('button', { name: 'Full screen' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveClass('hit-target')
    await fireEvent.click(btn)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('follows the document rather than its own last press', async () => {
    // Escape leaves fullscreen without going through this button, so the icon
    // and the name are read off `fullscreenchange`, never remembered.
    const { exit } = stubFullscreen(true)
    render(FullscreenButton, {})
    ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement =
      document.documentElement
    document.dispatchEvent(new Event('fullscreenchange'))
    const btn = await screen.findByRole('button', { name: 'Leave full screen' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await fireEvent.click(btn)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('is named in French too', () => {
    stubFullscreen(true)
    setLang('fr')
    render(FullscreenButton, {})
    expect(screen.getByRole('button', { name: 'Plein écran' })).toBeInTheDocument()
  })

  // The chip is a desktop control: below 46rem the row it sits in has already
  // handed the screen to the burger, and a phone is the whole screen already.
  it('stands down below 46rem', () => {
    const src = readFileSync(join(COMPONENTS, 'FullscreenButton.svelte'), 'utf8')
    expect(src).toMatch(/@media \(max-width: 46rem\)\s*\{\s*\.toggle\s*\{\s*display: none;/)
  })

  // "Everywhere": every screen that draws the top-right row draws this chip in
  // it. The row is the same six files that mount the gear.
  it('sits in every row the gear sits in', () => {
    const files = readdirSync(COMPONENTS).filter((f) => f.endsWith('.svelte'))
    const withGear = files.filter((f) => {
      if (f === 'FullscreenButton.svelte') return false
      return /<Preferences\b/.test(readFileSync(join(COMPONENTS, f), 'utf8'))
    })
    expect(withGear.length).toBeGreaterThanOrEqual(6)
    for (const f of withGear) {
      expect(readFileSync(join(COMPONENTS, f), 'utf8'), f).toMatch(/<FullscreenButton \/>/)
    }
  })

  // A drawn glyph, two drawings: the brackets point out to enter and in to
  // leave. Neither is a font character.
  it('draws its own glyph', () => {
    const src = readFileSync(join(COMPONENTS, 'FullscreenButton.svelte'), 'utf8')
    expect(src).toMatch(/<svg viewBox="0 0 24 24"/)
    expect(src).not.toMatch(/⛶|⤢|⛝/)
  })
})

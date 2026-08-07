import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from './render'
import { en } from '../i18n/en'
import Card from '../components/cards/Card.svelte'
import ColorPicker from '../components/ColorPicker.svelte'
import Preferences from '../components/Preferences.svelte'
import { SUIT_SHAPE } from '../components/cards/cardTheme'
import { isColorAssist, resetColorAssist, setColorAssist } from '../hooks/colorAssist'
import type { CardDTO } from '../types/protocol'

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn(), playVolumeAudition: vi.fn() }))

const red7: CardDTO = { color: 'red', kind: 'number', value: 7 }
const wild: CardDTO = { color: 'wild', kind: 'wild' }

function marks(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-suit-mark]')].map(
    (el) => el.getAttribute('data-suit-mark') ?? '',
  )
}

beforeEach(() => {
  localStorage.clear()
  resetColorAssist()
})

describe('Colour assist', () => {
  it('is off by default and leaves the card face alone', () => {
    expect(isColorAssist()).toBe(false)
    const { container } = render(Card, { card: red7 })
    expect(marks(container)).toEqual([])
  })

  it('marks a coloured card with its suit shape', () => {
    setColorAssist(true)
    const { container } = render(Card, { card: red7 })
    expect(marks(container)).toEqual(['red'])
  })

  // A wild belongs to no suit; inventing a fifth shape for it would say the
  // opposite of what the card does.
  it('leaves a wild unmarked', () => {
    setColorAssist(true)
    const { container } = render(Card, { card: wild })
    expect(marks(container)).toEqual([])
  })

  // Four swatches that differ only in hue is the one control a colour-blind
  // player cannot use at all.
  it('marks every swatch of the colour picker', () => {
    setColorAssist(true)
    const { container } = render(
      ColorPicker, { label: "Pick", cancelLabel: "Close", onChoose: vi.fn(), onCancel: vi.fn() }
    )
    expect(marks(container)).toEqual(['red', 'yellow', 'green', 'blue'])
  })

  it('gives the four suits four different silhouettes', () => {
    const shapes = Object.values(SUIT_SHAPE)
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  it('is one switch in the panel, and it survives a reload', () => {
    render(Preferences, { defaultOpen: true })
    const panel = screen.getByRole('dialog')
    const sw = within(panel).getByRole('switch', { name: en.prefsColorAssist })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(isColorAssist()).toBe(true)
    expect(sw).toHaveAttribute('aria-checked', 'true')

    resetColorAssist()
    expect(isColorAssist()).toBe(true)
  })
})

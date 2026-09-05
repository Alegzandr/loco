import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from './render'
import Hand from '../components/cards/Hand.svelte'
import type { CardDTO } from '../types/protocol'

// A touch screen synthesises `mouseenter` on the tap and never follows it with
// a `mouseleave` until the finger lands somewhere else, so a hover written on
// mouse events left a refused card lifted over the fan for the rest of the
// turn. The lift is a mouse's and nobody else's: pointer events say what the
// pointer is.
describe('<Hand /> under a finger', () => {
  const hand: CardDTO[] = [
    { color: 'red', kind: 'number', value: 3 },
    { color: 'blue', kind: 'number', value: 7 },
  ]

  function mount() {
    render(Hand, {
      hand,
      width: 800,
      height: 600,
      isPlayable: () => false,
      isInteractive: () => true,
      onCardClick: vi.fn(),
    })
    return Array.from(document.querySelectorAll<HTMLElement>('.slot'))
  }

  const enter = (el: HTMLElement, pointerType: string) =>
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType, bubbles: false }))

  it('lifts nothing when the pointer is a finger', async () => {
    const [slot] = mount()
    enter(slot, 'touch')
    await Promise.resolve()
    expect(slot.classList.contains('hovered')).toBe(false)
  })

  it('still lifts under a mouse, and drops it when the mouse leaves', async () => {
    const [slot] = mount()
    enter(slot, 'mouse')
    await Promise.resolve()
    expect(slot.classList.contains('hovered')).toBe(true)
    slot.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    await Promise.resolve()
    expect(slot.classList.contains('hovered')).toBe(false)
  })

  it('answers the press with the card itself, never the platform highlight', () => {
    const read = (f: string) => readFileSync(path.resolve(__dirname, '../components/cards', f), 'utf8')
    expect(read('Card.svelte')).toMatch(/\.interactive\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/s)
    expect(read('Hand.svelte')).not.toMatch(/onmouseenter|onmouseleave/)
  })
})

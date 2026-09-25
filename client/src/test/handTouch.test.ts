import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from './render'
import Hand from '../components/cards/Hand.svelte'
import type { CardDTO } from '../types/protocol'
import { calcHandSlots } from '../components/cards/layout'

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

  const leave = (el: HTMLElement) =>
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))

  it('still lifts under a mouse, and drops it once the mouse has left the hand', async () => {
    vi.useFakeTimers()
    try {
      const [slot] = mount()
      enter(slot, 'mouse')
      await Promise.resolve()
      expect(slot.classList.contains('hovered')).toBe(true)
      leave(slot)
      await vi.advanceTimersByTimeAsync(400)
      expect(slot.classList.contains('hovered')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // A fan leaves felt between its tilted cards: a sweep crosses it between
  // every pair, and the lift must not fall in the gap.
  it('keeps the lift across the gap between two cards', async () => {
    vi.useFakeTimers()
    try {
      const [a, b] = mount()
      enter(a, 'mouse')
      leave(a)
      await vi.advanceTimersByTimeAsync(40)
      expect(a.classList.contains('hovered')).toBe(true)
      enter(b, 'mouse')
      await vi.advanceTimersByTimeAsync(400)
      expect(a.classList.contains('hovered')).toBe(false)
      expect(b.classList.contains('hovered')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // The card under the mouse is read off the pointer against the fan at rest,
  // never off the element hit: a lifted card is drawn over its neighbour, so
  // the hit target lagged the pointer by up to a card in a sweep.
  it('lifts the card whose strip the pointer is over, whichever element it hit', async () => {
    const five: CardDTO[] = [1, 2, 3, 4, 5].map((value) => ({ color: 'red', kind: 'number', value }))
    render(Hand, {
      hand: five,
      width: 800,
      height: 600,
      isPlayable: () => false,
      isInteractive: () => true,
      onCardClick: vi.fn(),
    })
    const handEl = document.querySelector<HTMLElement>('.hand')!
    Object.defineProperty(handEl, 'offsetWidth', { value: 400 })
    handEl.getBoundingClientRect = () => ({ left: 100, width: 800 }) as DOMRect
    const slots = Array.from(document.querySelectorAll<HTMLElement>('.slot'))
    const rest = calcHandSlots(5, 800, 600)
    const step = rest[1].x - rest[0].x
    // Mid-strip of the fourth card, in client pixels (the board drawn at 2×).
    const clientX = 100 + (rest[3].x + step / 2) * 2
    slots[2].dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX, bubbles: true }))
    await Promise.resolve()
    expect(slots.map((s) => s.classList.contains('hovered'))).toEqual([false, false, false, true, false])
  })

  it('answers the press with the card itself, never the platform highlight', () => {
    const read = (f: string) => readFileSync(path.resolve(__dirname, '../components/cards', f), 'utf8')
    expect(read('Card.svelte')).toMatch(/\.interactive\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/s)
    expect(read('Hand.svelte')).not.toMatch(/onmouseenter|onmouseleave/)
  })
})

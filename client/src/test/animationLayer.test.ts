import { describe, it, expect, vi } from 'vitest'
import { render } from './render'
import AnimationLayer, { type Flier, type Impact } from '../components/cards/AnimationLayer.svelte'
import { CardDTO } from '../types/protocol'

const noop = () => {}

const flier = (over: Partial<Flier> = {}): Flier => ({
  id: 'f1',
  kind: 'face',
  card: { color: 'red', kind: 'number', value: 5 } as CardDTO,
  from: { x: 0, y: 0 },
  to: { x: 100, y: 100 },
  ...over,
})

describe('<AnimationLayer /> spinning fliers', () => {
  it('never shows a back behind a spinning card', () => {
    // The spin is in the card's own plane, so the face is up for the whole
    // flight. A barrel roll around Y turned the back to the table twice in
    // 470ms, which reads as a blinking loading indicator rather than a throw.
    const { container } = render(
      AnimationLayer, { fliers: [flier({ spin: 2 })], effectTexts: [], onFlierDone: noop, onEffectDone: noop },
    )
    expect(container.querySelector('[data-flier-face="back"]')).toBeNull()
  })

  it('shows one side only, whichever side the flier is', () => {
    // A back stays a back for the whole flight, a face a face. The one flier
    // that carries both is asked for by name (`flip`), and turns over once.
    const { container } = render(
      AnimationLayer, { fliers: [flier({ kind: 'back', spin: 1 })], effectTexts: [], onFlierDone: noop, onEffectDone: noop },
    )
    expect(container.querySelector('[data-flier-face="back"]')).toBeInTheDocument()
    expect(container.querySelector('[data-flier-face="face"]')).toBeNull()
  })
})

describe('<AnimationLayer /> turning a card over', () => {
  it('draws both sides of a flipping card, and only of a flipping one', () => {
    const { container } = render(
      AnimationLayer, { fliers: [flier({ flip: true })], effectTexts: [], onFlierDone: noop, onEffectDone: noop },
    )
    expect(container.querySelectorAll('.flip .side')).toHaveLength(2)
  })
})

describe('<AnimationLayer /> waiting cards', () => {
  it('holds a delayed flier at its start, never at the corner of the board', () => {
    // A flier sits at the layer's origin and is placed by its animation. The
    // last cards of a ten-seat deal wait over a second before they leave, and
    // an animation filled forwards only left them in the top-left corner until
    // then.
    const spy = vi.spyOn(Element.prototype, 'animate')
    try {
      render(AnimationLayer, {
        fliers: [flier({ delayMs: 900 })],
        effectTexts: [],
        onFlierDone: noop,
        onEffectDone: noop,
      })
      const opts = spy.mock.calls.map((c) => c[1] as KeyframeAnimationOptions)
      expect(opts.length).toBeGreaterThan(0)
      for (const o of opts) expect(o.fill).toBe('both')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('<AnimationLayer /> impacts', () => {
  const impact = (over: Partial<Impact> = {}): Impact => ({
    id: 'i1', x: 50, y: 60, color: '#9b7bff', ...over,
  })

  it('sizes the ring from the caller — a legendary lands wider than a rare', () => {
    const { container } = render(
      AnimationLayer, { fliers: [], effectTexts: [], impacts: [impact({ id: 'a', size: 260 })], onFlierDone: noop, onEffectDone: noop },
    )
    const ring = container.querySelector('[style*="width"]') as HTMLElement
    expect(ring.style.width).toBe('260px')
    expect(ring.style.height).toBe('260px')
  })

  it('tints the ring with the caller-supplied colour', () => {
    const { container } = render(
      AnimationLayer, { fliers: [], effectTexts: [], impacts: [impact({ color: 'rgb(255, 0, 0)' })], onFlierDone: noop, onEffectDone: noop },
    )
    const ring = container.querySelector('[style*="color"]') as HTMLElement
    expect(ring.style.color).toBe('rgb(255, 0, 0)')
  })

  it('adds no ring node when nothing landed', () => {
    const { container: withImpact } = render(
      AnimationLayer, { fliers: [], effectTexts: [], impacts: [impact()], onFlierDone: noop, onEffectDone: noop },
    )
    const { container: without } = render(
      AnimationLayer, { fliers: [], effectTexts: [], onFlierDone: noop, onEffectDone: noop },
    )
    expect(withImpact.querySelectorAll('div').length)
      .toBeGreaterThan(without.querySelectorAll('div').length)
  })
})

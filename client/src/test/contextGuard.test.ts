/**
 * The browser's own menu stops at the seat.
 *
 * A right-click over the board is about the document — copy image address, save
 * image as, reload — and it lands over cards, seats and a five-second window.
 * The pages somebody *reads* are the opposite case, so the refusal hangs off
 * `data-seated`, exactly like the pinch. Read at event time, because a table is
 * left and taken again all evening.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { initContextGuard } from '../contextGuard'

const rightClick = () => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.body.dispatchEvent(e)
  return e
}

describe('the context menu is refused at a taken seat and nowhere else', () => {
  beforeAll(() => initContextGuard())
  afterEach(() => document.documentElement.removeAttribute('data-seated'))

  it('leaves the menu alone before a seat is taken', () => {
    expect(rightClick().defaultPrevented).toBe(false)
  })

  it('refuses it under [data-seated]', () => {
    document.documentElement.setAttribute('data-seated', '1')
    expect(rightClick().defaultPrevented).toBe(true)
  })

  it('gives it back the frame the seat is left', () => {
    document.documentElement.setAttribute('data-seated', '1')
    rightClick()
    document.documentElement.removeAttribute('data-seated')
    expect(rightClick().defaultPrevented).toBe(false)
  })

  it('is installed at boot, beside the pinch guard', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const entry = readFileSync(path.resolve(__dirname, '..', 'entry.ts'), 'utf8')
    expect(entry).toMatch(/initContextGuard\(\)/)
  })
})

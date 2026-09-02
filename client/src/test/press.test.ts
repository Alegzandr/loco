import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pressToAct } from '../components/press'

// A press acts on pointerdown and the click the same press produces adds
// nothing; a click no press preceded (the keyboard) still acts; a disabled
// control fires on neither path.
describe('pressToAct', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function mount(disabled = false) {
    const btn = document.createElement('button')
    btn.disabled = disabled
    document.body.appendChild(btn)
    const handler = vi.fn()
    const action = pressToAct(btn, handler)
    return { btn, handler, action }
  }

  const press = (el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    vi.runAllTimers()
  }

  it('acts once per press, on the press', () => {
    const { btn, handler } = mount()
    btn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    btn.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }))
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    press(btn)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('still acts on a click no press preceded', () => {
    const { btn, handler } = mount()
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores a secondary button', () => {
    const { btn, handler } = mount()
    btn.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('fires nothing while disabled, on either path', () => {
    const { btn, handler } = mount(true)
    press(btn)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('follows the handler it is given and stops on destroy', () => {
    const { btn, handler, action } = mount()
    const next = vi.fn()
    action.update(next)
    press(btn)
    expect(handler).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    action.destroy()
    press(btn)
    expect(next).toHaveBeenCalledTimes(1)
  })
})

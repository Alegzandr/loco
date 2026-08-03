import { NO_INSETS, type SafeAreaInsets } from '../components/cards/layout'
import { readInsets } from './safeAreaInsets'

/**
 * The element's current pixel size, via ResizeObserver. `{0, 0}` until the first
 * measurement lands, which is what the board reads as "not ready yet".
 *
 * The node arrives as a getter rather than a value: this is called once, during
 * component setup, and `bind:this` fills the variable in afterwards.
 */
export function elementSize(node: () => HTMLElement | null): { readonly current: { width: number; height: number } } {
  let size = $state({ width: 0, height: 0 })

  $effect(() => {
    const el = node()
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (size.width !== r.width || size.height !== r.height) size = { width: r.width, height: r.height }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  })

  return {
    get current() {
      return size
    },
  }
}

/**
 * Current safe-area insets, re-measured when the device is rotated or the window
 * resized (landscape moves the notch from the top to one side).
 *
 * Deliberately not measured per frame: this is a device property, it changes on
 * rotation and nowhere else, and each read forces a style resolution. Same rule
 * as "nothing continuous goes through framework state".
 */
export function safeAreaInsets(): { readonly current: SafeAreaInsets } {
  let insets = $state<SafeAreaInsets>(NO_INSETS)

  $effect(() => {
    const update = () => {
      const next = readInsets()
      const p = insets
      if (p.top !== next.top || p.right !== next.right || p.bottom !== next.bottom || p.left !== next.left) {
        insets = next
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  })

  return {
    get current() {
      return insets
    },
  }
}

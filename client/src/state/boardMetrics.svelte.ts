import type { SafeAreaInsets } from '../components/cards/layout'
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
 * The viewport's CSS-pixel size, re-measured on resize. What the felt's place
 * on screen is solved from before the board has measured anything
 * (`layout.ts: feltInViewport`), so the room can be rendered behind the
 * loading screen with the podium already under the table.
 */
export function viewportSize(): { readonly current: { width: number; height: number } } {
  // Read synchronously, not in the effect below: the map preload asks for the
  // felt's anchor on its first run, before any effect has measured anything,
  // and a viewport of 0 × 0 solves to a felt with no size. That first render
  // — a whole room built around a point — was thrown away the moment the real
  // size landed, so every match paid for its room twice.
  let size = $state(typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight })

  $effect(() => {
    const update = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      if (size.width !== w || size.height !== h) size = { width: w, height: h }
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
  // Read synchronously, for the reason `viewportSize` is — and this was the
  // other half of the same bug. The map preload solves the felt's anchor on its
  // first run, before any effect has measured anything, and on a notched phone
  // an anchor solved with no insets is twenty pixels up the screen from the one
  // the board settles on: the room was built around a table that was about to
  // move, thrown away, and built again, on the main thread, while the loading
  // screen was up. Twice per match, and only on the devices least able to
  // afford it.
  let insets = $state<SafeAreaInsets>(readInsets())

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

import { NO_INSETS, SafeAreaInsets } from '../components/cards/layout'

/*
 * The device's unusable edges, read back as numbers so the board's coordinate
 * space can stop short of them (see layout.ts: boardSpace).
 *
 * The values themselves only exist in CSS, and a custom property holding an
 * `env()` reads back as the unresolved token in several engines. The reliable
 * way to get the number is to let the engine resolve it: a hidden probe whose
 * padding is the four values, then read its computed padding, which is always
 * in pixels. Everything without a notch computes to 0px, and jsdom (no `env()`
 * support at all) computes to an empty string, which parses to the same zero.
 *
 * The probe reads the `--safe-*` tokens rather than `env()` itself, so the CSS
 * that offsets the chrome and the maths that lays out the board are quoting one
 * source. It is also the seam that lets a capture harness pretend to be a
 * notched phone, which no desktop browser will do on its own.
 */
export function readInsets(): SafeAreaInsets {
  if (typeof document === 'undefined' || !document.body) return NO_INSETS
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:var(--safe-top,0px) var(--safe-right,0px) ' +
    'var(--safe-bottom,0px) var(--safe-left,0px)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const px = (value: string) => {
    const n = parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }
  const insets: SafeAreaInsets = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  }
  probe.remove()
  return insets
}


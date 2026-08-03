/**
 * Changing the theme is a fade, and the fade is the same one on both halves of
 * the site.
 *
 * The content pages appeared to have one already and the game did not: nothing
 * animated the theme anywhere: `body` carries a `transition: background-color`,
 * and on a page of prose `body` is a flat colour, so that one property was the
 * whole effect. In the game `#root` paints the canvas over it, and every panel,
 * card outline and label under it swapped between two palettes in a single
 * frame — a hard cut across the whole screen.
 *
 * So the fade is a short-lived attribute on `<html>` rather than a permanent
 * transition on anything: `data-theme-anim` is on for the length of the fade and
 * off the rest of the match, which is what keeps a blanket `*` rule from sitting
 * over a live board.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { THEME_FADE_MS, THEME_STORAGE_KEY } from '../theme'

/**
 * A fresh copy of the module per case.
 *
 * `theme.ts` holds the current theme itself — that is the point of it, one
 * answer for the panel and for a content page's own button — so a case that
 * switched to dark leaves the next one's `setTheme('dark')` a no-op. Re-importing
 * is the seam: the module reads the stored choice again on the way in.
 */
async function loadTheme(stored: 'light' | 'dark') {
  localStorage.setItem(THEME_STORAGE_KEY, stored)
  vi.resetModules()
  return import('../theme')
}

const CSS = readFileSync(path.resolve(__dirname, '..', 'styles', 'tokens.css'), 'utf8')

/** The fade rule, as it is written in the stylesheet. */
const rule = /html\[data-theme-anim\][^{]*\{([^}]*)\}/.exec(CSS)

describe('the theme fade — the stylesheet', () => {
  it('exists, and reaches the whole document rather than one element', () => {
    expect(rule, 'no html[data-theme-anim] rule — the theme cuts again').toBeTruthy()
    // `#root` is the game's canvas and every panel on top of it has its own
    // background: a rule that only dressed `body` would fade the one surface
    // the player cannot see.
    const selector = rule![0].split('{')[0]
    expect(selector, 'the fade must cover descendants, not just <html>').toContain('*')
  })

  it('fades colour and nothing that moves', () => {
    const body = rule![1]
    expect(body).toContain('background-color')
    expect(body).toContain('color')
    // A transform or an opacity in here would run over card flights, the
    // reconnect curtain and every open panel for the length of the fade.
    expect(body).not.toMatch(/\btransform\b|\bopacity\b/)
  })

  it('stays under the reduced-motion blanket rule', () => {
    // Both declarations are `!important`, so specificity decides:
    // `:root[data-motion="reduce"] *` is (0,2,0) and `html[data-theme-anim] *`
    // is (0,1,1). A player who asked for less motion gets the cut back, and
    // that is the whole mechanism — there is no media query and no JS branch.
    expect(CSS).toContain(':root[data-motion="reduce"] *')
    expect(rule![1]).toContain('!important')
  })
})

describe('the theme fade — the switch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme-anim')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not armed by the boot, which has nothing to fade from', async () => {
    const { initTheme, applyTheme } = await loadTheme('dark')
    initTheme()
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(false)
    applyTheme('light')
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(false)
  })

  it('arms the attribute on a change and takes it back off', async () => {
    const { initTheme, setTheme } = await loadTheme('light')
    initTheme()

    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(true)

    vi.advanceTimersByTime(THEME_FADE_MS + 50)
    expect(
      document.documentElement.hasAttribute('data-theme-anim'),
      'the blanket rule must not outlive the fade',
    ).toBe(false)
  })

  it('restarts the window rather than stacking two of them', async () => {
    const { initTheme, setTheme } = await loadTheme('light')
    initTheme()

    setTheme('dark')
    vi.advanceTimersByTime(THEME_FADE_MS - 20)
    setTheme('light')
    // The first timer would have fired here and stripped the attribute mid-fade
    // on the second press.
    vi.advanceTimersByTime(30)
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(true)

    vi.advanceTimersByTime(THEME_FADE_MS)
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(false)
  })

  it('does nothing at all when the theme is not actually changing', async () => {
    const { initTheme, setTheme } = await loadTheme('dark')
    initTheme()
    setTheme('dark')
    expect(document.documentElement.hasAttribute('data-theme-anim')).toBe(false)
  })
})

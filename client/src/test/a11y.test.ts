/**
 * The four rules an accessibility audit failed this site on, pinned.
 *
 * None of them is visible: every one was a page that looked exactly right and
 * scored 86-89 out of 100, and three of the four are properties of a *file*
 * rather than of a rendered screen. They are asserted here, against the source,
 * for the same reason `csp.test.ts` greps for `client:` directives — a checker
 * runs on a deployed URL, and by then the change that broke it is weeks old.
 *
 * What is checked here is the *shape*. That the built pages actually come out
 * clean is a separate matter: `docs/notes/seo.md` records how to re-run the
 * audit, and the contrast arithmetic behind two of these is written out there.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CLIENT = path.resolve(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(path.join(CLIENT, 'src', ...p), 'utf8')

const base = read('layouts', 'Base.astro')
const logoTsx = read('components', 'LocoLogo.tsx')
const logoCss = read('components', 'LocoLogo.module.css')
const contentCss = read('content', 'content.css')

describe('the viewport lets a phone zoom', () => {
  it('names neither user-scalable=no nor a maximum-scale', () => {
    // Both were here to stop a double-tap zooming the board mid-match, and both
    // take pinch-zoom with them — which is somebody's only way to read this game
    // on a phone, and which every page of the site was failing an audit on.
    const viewport = base.match(/<meta\s+name="viewport"[^>]*content="([^"]*)"/)?.[1]
    expect(viewport, 'Base.astro must declare a viewport').toBeTruthy()
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/)
    expect(viewport).not.toMatch(/maximum-scale/)
    // The half that was worth keeping, and the reason the tag can lose the rest.
    expect(viewport, 'the notch still needs covering').toMatch(/viewport-fit=cover/)
  })

  it('kills the double-tap in the reset instead', () => {
    expect(base).toMatch(/body\s*\{[^}]*touch-action:\s*manipulation/s)
  })
})

describe('the wordmark is a logotype, not prose', () => {
  it('names itself once, as an image', () => {
    // WCAG exempts a logo from the contrast rules; a checker cannot tell a logo
    // from a heading unless the markup says so. It also stops a screen reader
    // reading "LOCO" twice — once for the mark, once for the word.
    expect(logoTsx).toMatch(/role="img"/)
    expect(logoTsx).toMatch(/aria-label="LOCO"/)
    expect(logoTsx).toMatch(/aria-hidden="true"/)
  })

  it('drops the ink outline in dark, where it is what fails the check', () => {
    // A checker reads `-webkit-text-stroke` as the colour of the text. Against
    // the dark canvas that outline is 1.07:1 and the red it wraps is 5.4:1, so
    // in dark the word carries no stroke and a ::before paints the outline over
    // it. Light keeps the stroke: there, the near-black edge is 14.7:1 and the
    // red alone would be 2.2:1.
    for (const selector of [
      /:root\[data-theme='dark'\] \.word \{[^}]*-webkit-text-stroke:\s*0/s,
      /:root:not\(\[data-theme='light'\]\) \.word \{[^}]*-webkit-text-stroke:\s*0/s,
    ]) {
      expect(logoCss, `${selector} must drop the stroke`).toMatch(selector)
    }
    // Declared twice for the reason tokens.css declares the dark palette twice:
    // a scripted attribute cannot paint the first frame, and a media query
    // cannot be overridden by a choice. Both must carry the outline back.
    const outlines = logoCss.match(/\.word::before \{[^}]*\}/gs) ?? []
    expect(outlines, 'both dark blocks must repaint the outline').toHaveLength(2)
    for (const block of outlines) {
      expect(block).toMatch(/-webkit-text-stroke:\s*0\.07em var\(--color-stroke\)/)
      // An empty alt: the logo is named by `role="img"`, and generated content
      // is announced by Chrome.
      expect(block).toMatch(/content:\s*'LOCO'\s*\/\s*''/)
    }
  })
})

describe('white on LOCO Red clears the bar it can clear', () => {
  // 3.43:1 — a pass for large text, a fail for anything under 14pt bold. The
  // alternative was darkening the brand red on the two controls that are most
  // obviously the brand, so the type grew instead. 1.2rem is 19.2px.
  it.each(['.cta', '.navPop .navPopCta'])('%s is set above 18.66px', (selector) => {
    const rule = contentCss.match(
      new RegExp(`\\n${selector.replace(/[.\\]/g, '\\$&')} \\{([^}]*)\\}`, 's'),
    )?.[1]
    expect(rule, `${selector} must exist in content.css`).toBeTruthy()
    const size = rule?.match(/font-size:\s*([\d.]+)rem/)?.[1]
    expect(Number(size), `${selector} font-size`).toBeGreaterThanOrEqual(1.2)
  })
})

describe('a box that scrolls can be reached by a keyboard', () => {
  // Neither holds anything focusable — one is a table of numbers, the other a
  // row of pictures — so on a phone, where both are wider than the column, the
  // part past the right edge belonged to whoever could drag it into view.
  it.each([
    ['content/RulesArticle.astro', 'tableWrap'],
    ['content/CardsArticle.astro', 'cardRow'],
  ])('%s makes every .%s focusable', (file, cls) => {
    const src = read(...file.split('/'))
    const boxes = src.match(new RegExp(`<div class="${cls}"[^>]*>`, 'g')) ?? []
    expect(boxes.length, `${file} must render at least one .${cls}`).toBeGreaterThan(0)
    for (const box of boxes) expect(box, box).toMatch(/tabindex="0"/)
  })

  it('shows that focus', () => {
    expect(contentCss).toMatch(/\.tableWrap:focus-visible[\s\S]{0,80}outline:/)
    expect(contentCss).toMatch(/\.cardRow:focus-visible[\s\S]{0,80}outline:/)
  })
})

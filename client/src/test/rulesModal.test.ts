import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import RulesModal from '../components/RulesModal.svelte'
import { CARD_CATALOGUE } from '../components/cardCatalogue'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { CardKind } from '../types/protocol'

function renderModal(onClose = vi.fn()) {
  return render(RulesModal, { onClose: onClose })
}

/** Rendered text, in document order, for the elements a selector picks out. */
function texts(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((e) => e.textContent?.trim() ?? '')
}

describe('RulesModal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the rules title', () => {
    renderModal()
    expect(screen.getByText(en.rulesTitle)).toBeInTheDocument()
  })

  it('renders all rules section headings', () => {
    renderModal()
    en.rules.forEach((section) => {
      expect(screen.getByText(section.heading)).toBeInTheDocument()
    })
  })

  it('renders the close button', () => {
    renderModal()
    expect(screen.getByLabelText(en.rulesClose)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.click(screen.getByLabelText(en.rulesClose))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.click(screen.getByText(en.rulesTitle))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows footer close button with translated text', () => {
    renderModal()
    // There are two close elements: the ✕ button (aria-label) and the footer button (text)
    const footerBtns = screen.getAllByText(en.rulesClose)
    expect(footerBtns.length).toBeGreaterThanOrEqual(1)
  })

  it('renders rules in French when lang is fr', () => {
    localStorage.setItem('loco_lang', 'fr')
    render(RulesModal, { onClose: vi.fn() })
    expect(screen.getByText(fr.rulesTitle)).toBeInTheDocument()
    // Check one French section heading
    expect(screen.getByText(fr.rules[0].heading)).toBeInTheDocument()
  })

  it('opens on the rules, not on the deck', () => {
    // The tab a player lands on is the one they asked for from a table: the
    // cards are the first-time read, the rules are the one they come back to.
    renderModal()
    expect(screen.getByRole('tab', { name: en.rulesTabRules })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: en.rulesTabCards })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(screen.getByText(en.rules[0].heading)).toBeInTheDocument()
    expect(screen.queryByText(en.rulesCardsLede)).not.toBeInTheDocument()
  })

  it('draws every card of the deck once the cards tab is picked', () => {
    // The point of the tab. A player who has played a card game of colours and
    // symbols has no slot for Swap or Global Switch, and a bullet naming one
    // asks them to picture it — so each kind is here with its face, its name
    // and one line.
    //
    // Read off the DOM rather than through getByText, for two reasons the
    // queries hide: "+2" is a card *name* and also the glyph printed on that
    // card's face, and a matcher string is compared against text the library
    // has collapsed, so a non-breaking space in the French copy never matches.
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: en.rulesTabCards }))

    expect(texts('.lede')).toEqual([en.rulesCardsLede])
    // Eight faces, one per kind, and they are the game's own <Card />.
    expect(document.querySelectorAll('.deck .face').length).toBe(CARD_CATALOGUE.length)
    expect(texts('.cardName')).toEqual(CARD_CATALOGUE.map((c) => en.cardNames[c.kind]))
    expect(texts('.cardBrief')).toEqual(CARD_CATALOGUE.map((c) => en.cardBriefs[c.kind]))
  })

  it('shows one panel at a time', () => {
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: en.rulesTabCards }))
    expect(screen.queryByText(en.rules[0].heading)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: en.rulesTabRules }))
    expect(screen.getByText(en.rules[0].heading)).toBeInTheDocument()
    expect(screen.queryByText(en.rulesCardsLede)).not.toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys, once the row has focus', () => {
    // A focused control, not a global listener: the accessibility path the
    // no-shortcuts rule keeps open.
    renderModal()
    const rules = screen.getByRole('tab', { name: en.rulesTabRules })
    fireEvent.keyDown(rules, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: en.rulesTabCards })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText(en.rulesCardsLede)).toBeInTheDocument()
  })

  it('catalogues every kind the deck holds, in French too', () => {
    // The catalogue is a list, so a kind dropped from it would render seven
    // cards and fail nothing: it is pinned to `cardNames`, which the compiler
    // already keeps exhaustive over `CardKind`.
    expect(new Set(CARD_CATALOGUE.map((c) => c.kind))).toEqual(
      new Set(Object.keys(en.cardNames) as CardKind[]),
    )

    localStorage.setItem('loco_lang', 'fr')
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: fr.rulesTabCards }))
    expect(texts('.cardBrief')).toEqual(CARD_CATALOGUE.map((c) => fr.cardBriefs[c.kind]))
  })

  /*
   * Switching tabs changes the contents and nothing else. jsdom lays nothing
   * out, so what a rendering test can see here is the wrapper; the three
   * declarations that stop the card moving are read off the source, which is
   * where they would silently be undone. All three were the same report: the
   * switch felt brutal because the card resized, the scroller animated and the
   * new panel cut in, all on one press.
   */
  describe('the switch is a change of contents', () => {
    const src = readFileSync(
      path.resolve(__dirname, '..', 'components', 'RulesModal.svelte'),
      'utf8',
    )
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(
        src,
      )?.[0] ?? ''

    it('gives the card a height rather than a ceiling', () => {
      // The two panels are nothing like the same length. Sized to its contents,
      // the modal resized under the tab row on every press and carried the
      // header, the tabs and the footer with it.
      expect(rule('.modal'), 'the modal must hold one height').toMatch(/\bheight:\s*min\(/)
    })

    it('resets the scroll instantly', () => {
      // `scroll-behavior: smooth` turns the reset into a second movement: the
      // outgoing panel scrolling up the card while the new one arrives.
      expect(rule('.body')).not.toMatch(/scroll-behavior/)
    })

    it('fades the arriving panel in, on opacity alone', () => {
      // Anything that slides moves copy towards somebody who is reading it.
      const panel = rule('.panel')
      expect(panel, 'each panel is wrapped and animated').toMatch(/animation:\s*panelIn/)
      expect(src).toMatch(/@keyframes panelIn\s*\{[^@]*?\}\s*\}/)
      const frames = /@keyframes panelIn\s*\{([\s\S]*?)\n {2}\}/.exec(src)?.[1] ?? ''
      expect(frames, 'opacity and nothing else').toMatch(/opacity/)
      expect(frames).not.toMatch(/transform|translate|scale/)
      // Reduced motion drops it like every other animation in this file.
      expect(src).toMatch(/data-motion="reduce"\][^{]*\.panel/)
    })
  })

  it('reads the same from every screen it opens over', () => {
    // `text-align` inherits straight through a fixed child, so the screen
    // underneath decides how the rulebook is set unless the overlay says
    // otherwise: the searching screen centres its column, and the modal opened
    // from there arrived with every heading, every bullet and the lede centred.
    // jsdom lays nothing out, so the declaration is read off the source.
    const src = readFileSync(
      path.resolve(__dirname, '..', 'components', 'RulesModal.svelte'),
      'utf8',
    )
    const backdrop = /\.backdrop\s*\{[^}]*\}/.exec(src)?.[0] ?? ''
    expect(backdrop, 'the overlay sets its own alignment').toMatch(/text-align:\s*left/)
  })

  it('offers no link out of the game', () => {
    // This modal opens mid-match. Anything navigable here is an invitation to
    // leave the table, new tab or not; the one thing to press is Close.
    renderModal()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  /**
   * One sheet, four surfaces.
   *
   * Below 46rem `Preferences.svelte` and `AudioSettings.svelte` stop being
   * dropdowns and become a sheet up from the bottom edge; the home page's prose
   * sheet is the same object again. This modal was the odd one: it flipped at
   * 480px instead, so between 480px and 46rem it arrived as a centred desktop
   * card over a screen whose navigation had already gone to a burger — and once
   * it did flip, it wore an 18px title over a 32px ✕ where the panel it shares a
   * chip row with wears 20 over 40.
   *
   * Read off the sources, because jsdom applies no component styles and a media
   * query has no layout to fail in. `Preferences.svelte` is the reference: the
   * numbers are asserted equal to it rather than typed here, so a sheet
   * re-measured once moves all of them or fails.
   */
  describe('below 46rem it is the game\'s sheet, not this modal\'s own', () => {
    const read = (file: string) =>
      readFileSync(path.resolve(__dirname, '..', 'components', file), 'utf8')
    const modal = read('RulesModal.svelte')
    const prefs = read('Preferences.svelte')
    /** Every block a selector opens — a sheet declares the same one twice. */
    const rules = (src: string, selector: string) => [
      ...src.matchAll(
        new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g'),
      ),
    ].map((m) => m[0])
    /** The one of those blocks that turns the panel into a sheet. */
    const sheet = (src: string, selector: string) =>
      rules(src, selector).find((r) => /border-radius:[^;]*0 0/.test(r)) ?? ''

    it('flips at the width the rest of the game flips at', () => {
      expect(modal, 'the sheet breakpoint is the drawer\'s').toMatch(/@media \(max-width: 46rem\)/)
      expect(prefs).toMatch(/@media \(max-width: 46rem\)/)
      // 480px is the breakpoint for a table that has to lose a column, not for a
      // panel that has to change shape.
      expect(modal, 'no second sheet breakpoint').not.toMatch(/@media \(max-width: 480px\)/)
    })

    it('is the same card: bottom sheet, four-pixel outline, top corners only', () => {
      const here = sheet(modal, '.modal')
      const there = sheet(prefs, '.panel')
      expect(here, 'the modal must become a sheet').toBeTruthy()
      expect(there, 'read off the reference, not invented here').toBeTruthy()
      const radius = /border-radius:\s*([^;]+);/
      expect(radius.exec(here)?.[1]).toBe(radius.exec(there)?.[1])
      expect(here).toMatch(/height:\s*92vh/)
      expect(there).toMatch(/max-height:\s*92vh/)
      expect(modal).toMatch(/border:\s*4px solid var\(--color-stroke\)/)
      expect(there).toMatch(/border:\s*4px solid var\(--color-stroke\)/)
    })

    it('arrives from the edge it is anchored to, on the same curve', () => {
      // A dropdown punches in from a scale because it hangs off the control that
      // opened it. A sheet has an edge to come from, and scaling one is a card
      // that grows out of the bottom of the screen.
      const frames = (src: string, name: string) =>
        new RegExp(`@keyframes ${name}\\s*\\{[\\s\\S]*?\\n {4}\\}`).exec(src)?.[0] ?? ''
      expect(sheet(modal, '.modal')).toMatch(/animation:\s*rulesSheetIn 0\.26s var\(--ease-bounce\)/)
      expect(sheet(prefs, '.panel')).toMatch(/animation:\s*prefsSheetIn 0\.26s var\(--ease-bounce\)/)
      expect(frames(modal, 'rulesSheetIn')).toMatch(/translateY\(24px\)/)
      expect(frames(modal, 'rulesSheetIn'), 'nothing scales').not.toMatch(/scale\(/)
    })

    it('sizes the title and the ✕ for a thumb, at the reference\'s numbers', () => {
      const mobile = modal.slice(modal.indexOf('@media (max-width: 46rem)'))
      const ref = prefs.slice(prefs.indexOf('@media (max-width: 46rem)'))
      expect(/\.title\s*\{[^}]*font-size:\s*20px/.test(mobile)).toBe(true)
      expect(/\.title\s*\{[^}]*font:\s*700 20px/.test(ref)).toBe(true)
      expect(/\.closeBtn\s*\{[^}]*width:\s*40px/.test(mobile)).toBe(true)
      expect(/\.close\s*\{[^}]*width:\s*40px/.test(ref)).toBe(true)
      expect(/\.closeBtn svg\s*\{[^}]*width:\s*20px/.test(mobile)).toBe(true)
    })

    it('keeps its last control clear of the home indicator', () => {
      // A sheet anchored to the bottom edge is the one surface in the game whose
      // footer sits in that band: the modal's is a button, the settings sheets'
      // is the foot of their scroller, and both reserve the inset.
      const mobile = modal.slice(modal.indexOf('@media (max-width: 46rem)'))
      expect(/\.footer\s*\{[^}]*--safe-bottom/.test(mobile)).toBe(true)
      const ref = prefs.slice(prefs.indexOf('@media (max-width: 46rem)'))
      expect(/\.body\s*\{[^}]*--safe-bottom/.test(ref)).toBe(true)
    })

    it('draws its ✕ rather than typing one', () => {
      // Same rule as every other icon in this UI: a font character is a drawing
      // the font fallback chain gets to choose. The three panels that open over a
      // screen carry the same path.
      expect(modal).toMatch(/M6 6l12 12M18 6L6 18/)
      expect(prefs).toMatch(/M6 6l12 12M18 6L6 18/)
    })
  })

})

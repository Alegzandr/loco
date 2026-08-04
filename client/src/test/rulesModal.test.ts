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
})

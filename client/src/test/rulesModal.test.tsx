import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { RulesModal } from '../components/RulesModal'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import { RULES } from '../seo/meta'

function renderModal(onClose = vi.fn()) {
  return render(
    <I18nProvider>
      <RulesModal onClose={onClose} />
    </I18nProvider>
  )
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
    render(
      <I18nProvider>
        <RulesModal onClose={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByText(fr.rulesTitle)).toBeInTheDocument()
    // Check one French section heading
    expect(screen.getByText(fr.rules[0].heading)).toBeInTheDocument()
  })

  describe('the way out to the full rules page', () => {
    it('opens in a new tab, because this modal opens mid-match', () => {
      // Following it in place would unload the page, drop the socket and cost
      // the seat. The target is the whole point of the link, not decoration.
      renderModal()
      const link = screen.getByRole('link', { name: en.rulesFullPage })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    })

    it('points at the page in the language on screen', () => {
      renderModal()
      expect(screen.getByRole('link', { name: en.rulesFullPage })).toHaveAttribute(
        'href',
        RULES.path.en,
      )

      localStorage.setItem('loco_lang', 'fr')
      render(
        <I18nProvider>
          <RulesModal onClose={vi.fn()} />
        </I18nProvider>
      )
      expect(screen.getByRole('link', { name: fr.rulesFullPage })).toHaveAttribute(
        'href',
        RULES.path.fr,
      )
    })
  })
})

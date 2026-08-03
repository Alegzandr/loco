import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import RulesModal from '../components/RulesModal.svelte'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'

function renderModal(onClose = vi.fn()) {
  return render(RulesModal, { onClose: onClose })
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

  it('offers no link out of the game', () => {
    // This modal opens mid-match. Anything navigable here is an invitation to
    // leave the table, new tab or not; the one thing to press is Close.
    renderModal()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

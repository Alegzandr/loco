import { useEffect, useCallback } from 'react'
import { useI18n } from '../i18n'
import { RULES } from '../seo/meta'
import styles from './RulesModal.module.css'

interface Props {
  onClose: () => void
}

export function RulesModal({ onClose }: Props) {
  const { t, lang } = useI18n()

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    // Prevent background scroll while modal is open
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label={t.rulesTitle}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t.rulesTitle}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t.rulesClose}>
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {t.rules.map((section) => (
            <section key={section.heading} className={styles.section}>
              <h3 className={styles.sectionHeading}>{section.heading}</h3>
              <ul className={styles.list}>
                {section.items.map((item, i) => (
                  <li key={i} className={styles.listItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className={styles.footer}>
          {/*
            The deck table has no room in a modal, so it lives on the page. New
            tab, and that is not a preference: this modal opens mid-match, and
            navigating away would drop the socket and the seat with it. The path
            comes from the page registry so the two cannot disagree about the URL.
          */}
          <a
            className={styles.footerLink}
            href={RULES.path[lang]}
            target="_blank"
            rel="noopener"
          >
            {t.rulesFullPage}
          </a>
          <button className={styles.footerClose} onClick={onClose}>
            {t.rulesClose}
          </button>
        </div>
      </div>
    </div>
  )
}

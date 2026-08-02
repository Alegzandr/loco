import { useEffect, useCallback } from 'react'
import { useI18n } from '../i18n'
import styles from './RulesModal.module.css'

interface Props {
  onClose: () => void
}

export function RulesModal({ onClose }: Props) {
  const { t } = useI18n()

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
            No way out to the deck page from here. This modal opens mid-match and
            a link, even in a new tab, is an invitation to leave the table: the
            one thing to press here is Close.
          */}
          <button className={styles.footerClose} onClick={onClose}>
            {t.rulesClose}
          </button>
        </div>
      </div>
    </div>
  )
}

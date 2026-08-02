import styles from './RulesButton.module.css'

/** The rules opener, shared by the lobby, the waiting room and the table.
 *  Icon-only: the button sits in a cluster of round chips, and a question mark
 *  is read faster than a word at 720p. `t.rulesBtn` still names it for screen
 *  readers and for the tooltip. */
export function RulesButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className={`${styles.button} hit-target`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 8.8a3.1 3.1 0 1 1 4.3 2.85c-.85.42-1.3 1.1-1.3 2.05v.6" />
          <path d="M12 18h.01" />
        </g>
      </svg>
    </button>
  )
}

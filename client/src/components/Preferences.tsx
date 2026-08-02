import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { playSfx } from '../audio/sfx'
import { useStreamerMode, setStreamerMode } from '../hooks/useStreamerMode'
import { useReducedMotion, setMotionPref } from '../hooks/useMotionPref'
import { useColorAssist, setColorAssist } from '../hooks/useColorAssist'
import { useTheme } from '../hooks/useTheme'
import type { Theme } from '../hooks/useTheme'
import { LanguageSwitcher } from './LanguageSwitcher'
import styles from './Preferences.module.css'

/** One labelled switch plus the sentence that says what it does. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className={styles.group}>
      <button
        className={styles.switchRow}
        onClick={() => {
          onChange(!checked)
          playSfx('uiTap')
        }}
        role="switch"
        aria-checked={checked}
      >
        <span className={styles.label}>{label}</span>
        <span className={`${styles.track} ${checked ? styles.trackOn : ''}`} aria-hidden>
          <span className={styles.knob} />
        </span>
      </button>
      <p className={styles.hint}>{hint}</p>
    </div>
  )
}

interface Props {
  /** Showcase only: mounts with the panel open, which is otherwise
   *  component-local state no scene could reach. */
  defaultOpen?: boolean
  /**
   * Hides the gear below 46rem, where the burger's drawer offers these settings
   * as a row and two entry points to one panel would be one too many.
   *
   * Only the lobby passes it, and only the lobby may: the drawer lives in the
   * footer `data-seated` hides, so from the waiting room onwards this button is
   * the sole way in at every width. The component still mounts — it is what
   * listens for the drawer's event and renders the panel.
   */
  triggerBelowPhone?: boolean
}

/**
 * Gear button opening the player's own settings.
 *
 * The language pair used to sit bare in the top bar, and so did the theme,
 * which worked exactly as long as there were one or two preferences. They share
 * a panel now, next to the settings that have no business being a chip: the
 * streamer's blurred table code and the motion setting.
 */
export function Preferences({ defaultOpen = false, triggerBelowPhone = true }: Props) {
  const { t } = useI18n()
  const streamer = useStreamerMode()
  const { theme, setTheme } = useTheme()
  const reducedMotion = useReducedMotion()
  const colorAssist = useColorAssist()
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLDivElement>(null)
  // Where the focus goes on the way out. The gear normally, but the panel can
  // be opened from the home page's drawer, whose button is not in this tree and
  // is not on screen either by the time we render.
  const opener = useRef<HTMLElement | null>(null)

  // The drawer in `layouts/GamePage.astro` is markup Astro rendered, outside
  // `#root`, so it asks for this panel by event rather than by calling into it.
  // Only one screen is mounted at a time, so only one listener ever answers.
  useEffect(() => {
    const onAsk = () => {
      opener.current = document.activeElement as HTMLElement | null
      setOpen(true)
    }
    window.addEventListener('loco:preferences', onAsk)
    return () => window.removeEventListener('loco:preferences', onAsk)
  }, [])

  const close = () => {
    setOpen(false)
    opener.current?.focus()
    opener.current = null
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // `close` reads nothing but refs and a stable setter, so the effect tracks
    // the state it actually gates on and nothing else.
  }, [open])

  return (
    <div className={`${styles.wrap} ${triggerBelowPhone ? '' : styles.wrapNoTrigger}`} ref={ref}>
      <button
        className={`${styles.toggle} hit-target`}
        onClick={() => setOpen((v) => !v)}
        aria-label={t.prefsBtn}
        title={t.prefsBtn}
        aria-expanded={open}
      >
        {/* A gear, not a sun: the teeth are short thick stubs sitting right on
            the ring. Long thin spokes off a small circle read as a sun at 20px,
            which in a row that also toggles the theme is the wrong word
            entirely. Drawn, never a font character: same rule as RulesButton. */}
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4.6" strokeWidth="2.2" />
            <circle cx="12" cy="12" r="1.5" strokeWidth="1.6" />
            <path
              strokeWidth="3"
              d="M17.6 12L19.4 12M16 16L17.2 17.2M12 17.6L12 19.4M8 16L6.8 17.2M6.4 12L4.6 12M8 8L6.8 6.8M12 6.4L12 4.6M16 8L17.2 6.8"
            />
          </g>
        </svg>
      </button>

      {/* Below 46rem the panel is a sheet over the whole screen rather than a
          dropdown hanging off the gear, so it gets what any such surface gets:
          something behind it, and a control on it. Above that width the scrim is
          `display: contents` and the panel is the dropdown it always was.

          The scrim *wraps* the panel rather than sitting beside it, which is what
          RulesModal does and for the reason it does: as a sibling, "click
          outside" is a z-index argument, and the first version of this lost it —
          every press inside the sheet reached the scrim underneath and shut the
          panel, so not one setting could be changed on a phone. Nested, the panel
          is not the scrim, and `target === currentTarget` is a fact about the DOM
          rather than about stacking. */}
      {open && (
        <div
          className={styles.scrim}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div className={styles.panel} role="dialog" aria-label={t.prefsTitle}>
            <div className={styles.head}>
              <div className={styles.title}>{t.prefsTitle}</div>
              <button
                className={`${styles.close} hit-target`}
                onClick={close}
                aria-label={t.prefsClose}
                title={t.prefsClose}
              >
                <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Its own scroller, so the title and the way out stay put while the
                settings move under them. As a dropdown it never fills the screen
                and this is simply the group that holds them. */}
            <div className={styles.body}>
              <div className={styles.group}>
                <span className={styles.label}>{t.prefsLanguage}</span>
                <LanguageSwitcher />
              </div>

              {/* The theme was a bare chip in the top bar, which is right for one
                  preference and wrong for four. It is the same kind of choice as
                  the language, so it gets the same segmented control. */}
              <div className={styles.group}>
                <span className={styles.label}>{t.prefsTheme}</span>
                <div className={styles.seg} role="group" aria-label={t.prefsTheme}>
                  {(
                    [
                      ['light', t.prefsThemeLight],
                      ['dark', t.prefsThemeDark],
                    ] as [Theme, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={`${styles.segBtn} ${theme === value ? styles.segBtnActive : ''}`}
                      onClick={() => setTheme(value)}
                      aria-pressed={theme === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* The one preference that changes what is drawn on another screen.
                  Stated as what it does to the code, not as a mode name a player
                  would have to guess the effect of. */}
              <Toggle
                label={t.prefsStreamer}
                hint={t.prefsStreamerHint}
                checked={streamer}
                onChange={setStreamerMode}
              />

              {/* The only preference here that changes whether somebody can play
                  at all, so it is stated as the game rule it serves. */}
              <Toggle
                label={t.prefsColorAssist}
                hint={t.prefsColorAssistHint}
                checked={colorAssist}
                onChange={setColorAssist}
              />

              {/* Reachable in-game on purpose: the players who need this are not
                  always the ones who thought to look for it before the deal. */}
              <Toggle
                label={t.prefsMotion}
                hint={t.prefsMotionHint}
                checked={reducedMotion}
                // An explicit answer, in both directions: from here on the
                // player's choice wins over the system setting rather than
                // tracking it.
                onChange={(v) => setMotionPref(v ? 'reduce' : 'full')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

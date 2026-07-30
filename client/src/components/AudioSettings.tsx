import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { audio, AudioSettings as Settings } from '../audio/engine'
import { playSfx } from '../audio/sfx'
import { useI18n } from '../i18n'
import styles from './AudioSettings.module.css'

/** Live view of the engine's settings, without duplicating them into React state. */
function useAudioSettings(): Settings {
  return useSyncExternalStore(
    (cb) => audio.subscribe(cb),
    () => audio.getSettings(),
    () => audio.getSettings(),
  )
}

/**
 * Speaker button that opens a small mixer.
 *
 * A game that makes noise must let people turn it off in one click, from every
 * screen — so this sits in the same top-right cluster as the theme toggle, and
 * the button itself mutes on click while the caret opens the sliders.
 */
export function AudioSettings() {
  const { t } = useI18n()
  const settings = useAudioSettings()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const slider = (key: 'master' | 'sfx' | 'music', label: string) => (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        value={Math.round(settings[key] * 100)}
        onChange={(e) => {
          audio.setSettings({ [key]: Number(e.target.value) / 100 })
          // Audition the change on the bus being moved; the music bed is
          // already audible, so only the effects bus needs a sample.
          if (key !== 'music') playSfx('uiTap')
        }}
        aria-label={label}
      />
      <span className={styles.value}>{Math.round(settings[key] * 100)}</span>
    </label>
  )

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.toggle}
        onClick={() => {
          audio.unlock()
          setOpen((v) => !v)
        }}
        aria-label={t.audioTitle}
        aria-expanded={open}
      >
        {settings.muted ? '🔇' : '🔊'}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label={t.audioTitle}>
          <div className={styles.title}>{t.audioTitle}</div>
          {slider('master', t.audioMaster)}
          {slider('sfx', t.audioSfx)}
          {slider('music', t.audioMusic)}
          <button
            className={styles.muteBtn}
            onClick={() => {
              audio.unlock()
              audio.toggleMute()
            }}
          >
            {settings.muted ? t.audioUnmute : t.audioMute}
          </button>
        </div>
      )}
    </div>
  )
}

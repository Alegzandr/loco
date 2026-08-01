import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { audio, AudioSettings as Settings } from '../audio/engine'
import { getTrack, music } from '../audio/music'
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
  const { t, lang } = useI18n()
  const settings = useAudioSettings()
  // `settings.track` is written by the bed itself on every handover, so this
  // re-renders when a track ends on its own, not only when the button is pressed.
  const current = getTrack(settings.track)
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
          void audio.unlock()
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

          {/* No picker: tracks shuffle and hand over on their own, and the only
              control is "not this one". Choosing from a list would mean reading
              three names to make a decision nobody opened this panel to make. */}
          <div className={styles.tracks}>
            <div className={styles.label}>{t.audioTrack}</div>
            <div className={styles.nowPlaying}>
              <span className={styles.trackName}>{current.title}</span>
              <span className={styles.trackBlurb}>
                {lang === 'fr' ? current.blurb.fr : current.blurb.en}
              </span>
            </div>
            <button
              className={styles.nextBtn}
              onClick={() => {
                void audio.unlock()
                music.nextTrack()
                playSfx('uiTap')
              }}
            >
              ⏭ {t.audioNextTrack}
            </button>
          </div>

          <button
            className={styles.muteBtn}
            onClick={() => {
              void audio.unlock()
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

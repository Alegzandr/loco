import { PlayerDTO } from '../types/protocol'
import { Translations } from '../i18n/en'
import { MapDef } from './cards/maps'
import { seatColor } from './playerColors'
import styles from './MapLoadingScreen.module.css'

interface Props {
  map: MapDef
  /** Seats whose client has the map decoded, straight from the server. */
  ready: number[]
  players: PlayerDTO[]
  myIndex: number
  /** 0–1 across our own two files. Ours only; the roster shows everyone else's. */
  progress: number
  t: Translations
}

/**
 * The moment between "hands dealt" and "clock running".
 *
 * It exists because the wait is real (a map is roughly a megabyte of backdrop
 * and table) and the honest place to spend it is here rather than in the first
 * turn. Since the wait has to happen anyway, it may as well introduce the room:
 * the name and one line about it are what turn a progress bar into a reveal.
 *
 * The roster is the other half. A player staring at a bar cannot tell a slow
 * download from a hung game, and "we are waiting on Kiwi" is the difference
 * between patience and a reload. It is also where the map's own art earns its
 * keep: the backdrop is already on screen, so by the time the screen lifts the
 * table underneath is fully painted.
 */
export function MapLoadingScreen({ map, ready, players, myIndex, progress, t }: Props) {
  const copy = t.maps[map.id]
  const readySet = new Set(ready)
  const meReady = readySet.has(myIndex)
  const ordered = [...players].sort((a, b) => a.index - b.index)

  return (
    <div
      className={styles.screen}
      style={{
        // The room is the loading screen's background, so the download shows
        // itself finishing: the backdrop resolves in behind the copy.
        backgroundImage: `url(${map.room})`,
        ['--map-accent' as string]: map.accent,
      }}
      role="status"
      aria-live="polite"
      data-testid="map-loading"
      data-map={map.id}
    >
      <div className={styles.scrim} />

      <div className={styles.body}>
        <div className={styles.kicker}>{t.mapLoadingTitle}</div>
        <h1 className={styles.name}>{copy.name}</h1>
        <p className={styles.tagline}>{copy.tagline}</p>

        {/* Our own two files. Deliberately separate from the roster below: this
            bar is the only thing on screen the player's own machine controls. */}
        <div className={styles.track}>
          <div className={styles.fill} style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className={styles.status}>
          {meReady ? t.mapLoadingReady : t.mapLoadingWaiting}
        </div>

        <ul className={styles.roster}>
          {ordered.map((p) => {
            const isReady = readySet.has(p.index)
            return (
              <li
                key={p.index}
                className={`${styles.seat} ${isReady ? styles.seatReady : ''}`}
                data-ready={isReady}
              >
                <span
                  className={styles.dot}
                  style={{ background: isReady ? seatColor(p.index) : 'transparent' }}
                />
                <span className={styles.seatName}>{p.nickname}</span>
              </li>
            )
          })}
        </ul>

        <div className={styles.count}>
          {t.mapLoadingCount
            .replace('%ready', String(readySet.size))
            .replace('%total', String(players.length))}
        </div>
      </div>
    </div>
  )
}

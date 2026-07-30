import { memo } from 'react'
import { directionMarkers, DIRECTION_MARKER_COUNT } from './layout'
import styles from './DirectionRing.module.css'

interface Props {
  /** The felt's box, in board space — the ring is drawn just inside its rim. */
  rect: { left: number; top: number; width: number; height: number }
  /** +1 = clockwise on screen, -1 = counter-clockwise (see directionMarkers). */
  direction: number
  /** Localised "play order: clockwise/counter-clockwise". */
  label: string
}

/** One lap of the chase, ms. Slow: this is ambience, not a countdown. */
const CHASE_MS = 3200

/**
 * The ring of chevrons running around the felt that says which way play is
 * moving.
 *
 * It is drawn *on the table* rather than as a badge in a corner because the
 * question it answers is "who plays after me", and the answer is a direction
 * around the seats. A viewer with no controls has to be able to read it from a
 * clip, so the chevrons carry their heading statically: the chase animation is
 * the second readout of the same fact, never the only one.
 *
 * Keyed on `direction` by its parent, so a Reverse remounts it and replays the
 * flip-in — the moment the whole card exists for.
 */
export const DirectionRing = memo(function DirectionRing({ rect, direction, label }: Props) {
  const marks = directionMarkers(rect.width, rect.height, direction)
  return (
    <svg
      className={styles.ring}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      viewBox={`0 0 ${rect.width} ${rect.height}`}
      role="img"
      aria-label={label}
      data-direction={direction >= 0 ? 'cw' : 'ccw'}
      data-testid="direction-ring"
    >
      {marks.map((m, i) => (
        <g
          key={i}
          className={styles.chevron}
          transform={`translate(${m.x} ${m.y}) rotate(${m.angle})`}
          // Staggered along the flow: markers come out of directionMarkers in
          // travel order, so a plain index stagger chases the right way round.
          style={{ animationDelay: `${(i * CHASE_MS) / DIRECTION_MARKER_COUNT}ms` }}
        >
          <path d="M -11 -13 L 4 0 L -11 13" />
        </g>
      ))}
    </svg>
  )
})

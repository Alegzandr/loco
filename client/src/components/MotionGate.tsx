import type { ReactNode } from 'react'
import { MotionConfig } from 'framer-motion'
import { useReducedMotion } from '../hooks/useMotionPref'

/**
 * framer-motion's half of the motion preference.
 *
 * The CSS half hangs off `data-motion` on <html>, which `useMotionPref` writes
 * from the OS setting *and* the player's answer. framer-motion has to be told
 * the same thing, and `<MotionConfig reducedMotion="user">` is not that: "user"
 * reads `prefers-reduced-motion` directly, so it is the OS setting alone. A
 * player whose system says nothing and who asked this game for less motion kept
 * every card flight; a player whose system says reduce and who asked for the
 * animations back never got them. The switch moved the CSS and left the board.
 *
 * So the answer comes from the same store the rest of the client reads, and is
 * handed over as the two explicit values. Subscribing here rather than in
 * `entry.tsx` keeps the re-render to this boundary: the preference changes on a
 * press, not on a frame.
 */
export function MotionGate({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  return <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>
}

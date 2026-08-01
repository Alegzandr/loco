import { useEffect, useState } from 'react'

/**
 * Alternates the browser tab's title while something is waiting for a player who
 * is looking at another tab.
 *
 * The mechanic has a bad reputation because it is usually used to pull somebody
 * back to a page they left on purpose. Two rules keep it honest here, and both
 * are asserted in `tabAlert.test.tsx`:
 *
 *  - It only ever arms while the tab is **hidden**. A title blinking under the
 *    player's eyes tells them nothing they cannot already see on screen.
 *  - Coming back disarms it on the spot and puts the real title back. It never
 *    re-arms afterwards: they have seen it, the match is under way, and a second
 *    round of blinking would be at somebody already watching the board.
 *
 * There is no sound in here on purpose — that is `soundsForTransition`'s job —
 * but the two are a pair. A backgrounded tab is exactly where a mobile browser
 * has parked the AudioContext, so the sound is the cue that works when the
 * player is on the page and this is the one that works when they are not.
 */

/** How long each half of the alternation is shown. */
export const TAB_ALERT_PERIOD_MS = 1200

/**
 * @param message what to show instead of the page's own title
 * @param trigger the rising edge that arms the alert
 */
export function useTabAlert(message: string, trigger: boolean): void {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (trigger && document.visibilityState === 'hidden') setArmed(true)
  }, [trigger])

  useEffect(() => {
    if (!armed) return

    // Captured at arming time rather than at mount: nothing else in the app
    // writes the title, so whatever is there now is the page's own.
    const original = document.title
    let showing = true
    document.title = message

    const id = setInterval(() => {
      showing = !showing
      document.title = showing ? message : original
    }, TAB_ALERT_PERIOD_MS)

    const onVisible = () => {
      if (document.visibilityState !== 'hidden') setArmed(false)
    }
    document.addEventListener('visibilitychange', onVisible)

    // Restoring in the cleanup covers all three ways this ends: the player came
    // back, the component went away, or the message changed under it.
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      document.title = original
    }
  }, [armed, message])
}

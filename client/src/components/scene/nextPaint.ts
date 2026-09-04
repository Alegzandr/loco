/**
 * Resolves once the browser has painted what the DOM holds right now.
 *
 * The room is built and drawn on the main thread, in one stretch of a second
 * or more, and the loading screen's bar is a `transform` on a node the same
 * thread has to paint. A `setTimeout(0)` before the stretch was meant to let
 * that paint happen and did not: a macrotask fires a few milliseconds later,
 * well inside the frame, so the thread was taken with the bar still drawn at
 * zero and the next paint anybody saw was the one after the render, with the
 * bar at one. Two animation frames are the guarantee — the first callback runs
 * before its frame is painted, the second after — and the timeout is for a
 * hidden tab, where no frame ever comes and the render still has to happen.
 */
export function nextPaint(fallbackMs = 120): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(finish))
    }
    setTimeout(finish, fallbackMs)
  })
}

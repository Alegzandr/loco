/**
 * The page's frame rate, counted off `requestAnimationFrame` and reported a
 * couple of times a second, for the figure beside the graphics row.
 *
 * Framework-free and deliberately outside reactive state: a count that moves
 * every frame is continuous, and the caller writes the reading straight into
 * one text node. It only runs while somebody is looking at it.
 */
export const FPS_SAMPLE_MS = 500

export function startFpsMeter(onSample: (fps: number) => void, raf: (cb: FrameRequestCallback) => number = requestAnimationFrame, caf: (id: number) => void = cancelAnimationFrame): () => void {
  let from = -1
  let frames = 0
  let id = 0
  const tick = (now: number) => {
    if (from < 0) from = now
    else frames++
    const span = now - from
    if (span >= FPS_SAMPLE_MS) {
      onSample(Math.round((frames * 1000) / span))
      from = now
      frames = 0
    }
    id = raf(tick)
  }
  id = raf(tick)
  return () => caf(id)
}

import { createSubscriber } from 'svelte/reactivity'
import { prefersReducedMotion, subscribeMotion } from './motionPref'
import { getGraphicsPref, resolveGraphics, setGraphicsPref, subscribeGraphics, type GraphicsPref, type GraphicsTier } from './graphicsPref'

const motionSub = createSubscriber((update) => subscribeMotion(update))
const graphicsSub = createSubscriber((update) => subscribeGraphics(update))

/**
 * The preferences that are not simple on/off stores, read the way a rune is
 * read. `watchPref` covers the booleans; these have their own modules because
 * one folds an OS setting in and the other is a ladder of named values.
 */
export const reducedMotion: { readonly current: boolean } = {
  get current() {
    motionSub()
    return prefersReducedMotion()
  },
}

export const graphicsPref: {
  readonly current: GraphicsPref
  /** What the preference resolves to on this device. */
  readonly tier: GraphicsTier
  set: (p: GraphicsPref) => void
} = {
  get current() {
    graphicsSub()
    return getGraphicsPref()
  },
  get tier() {
    graphicsSub()
    return resolveGraphics()
  },
  set: setGraphicsPref,
}

import { createSubscriber } from 'svelte/reactivity'
import { prefersReducedMotion, subscribeMotion } from './motionPref'
import { getGraphicsPref, resolveGraphics, setGraphicsPref, subscribeGraphics, type GraphicsPref, type GraphicsTier } from './graphicsPref'
import { getWeatherShed, subscribeWeatherShed } from '../components/scene/weatherLoad'

const motionSub = createSubscriber((update) => subscribeMotion(update))
const graphicsSub = createSubscriber((update) => subscribeGraphics(update))
const shedSub = createSubscriber((update) => subscribeWeatherShed(update))

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

/**
 * How many steps of weather this device has given up because it was not
 * holding its frame rate (`scene/weatherLoad.ts`). Measured, never chosen and
 * never stored: the graphics preference above is the player's, this is the
 * device's.
 */
export const weatherShed: { readonly steps: number } = {
  get steps() {
    shedSub()
    return getWeatherShed()
  },
}

import { createBooleanPref } from './prefStore'

/**
 * Whether every coloured object also carries the shape of its suit.
 *
 * Colour is not decoration in this game, it is the rule: a card is legal
 * because it matches the colour of the pile. Red-green is the most common
 * colour-vision deficiency there is, and the two suits sit at different
 * lightness precisely so the deck survives it, but "survives" is not "reads",
 * and a player should not have to work at it. With this on, each suit gets a
 * silhouette (triangle, circle, square, diamond) on the card, on the picker
 * and on the active-colour chip, so the four are told apart without hue.
 *
 * Off by default: the card face is the brand, and this adds a mark to it.
 */
const pref = createBooleanPref('loco_color_assist')

/** The store itself, for the Svelte side (`hooks/prefs.svelte.ts`). */
export const colorAssistPref = pref

export const isColorAssist = pref.get
export const setColorAssist = pref.set
export const resetColorAssist = pref.reset

import { createBooleanPref } from './prefStore'

/**
 * Whether the table code is hidden from anything pointed at the screen.
 *
 * Six characters read off a stream is an open table, and the waiting room,
 * the one screen a streamer is guaranteed to sit on while friends join, prints
 * them at display size. The code itself is untouched: `TableCode.tsx` blurs it
 * in CSS, so copy still copies and hover still reads.
 */
const pref = createBooleanPref('loco_streamer_mode')

/** The store itself, for the Svelte side (`hooks/prefs.svelte.ts`). */
export const streamerModePref = pref

export const isStreamerMode = pref.get
export const setStreamerMode = pref.set
export const resetStreamerMode = pref.reset

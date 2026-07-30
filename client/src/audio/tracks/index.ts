/**
 * The track registry.
 *
 * Adding a track is: write a `TrackDef`, import it, put it in `TRACKS`. The
 * engine, the picker, the tests and the audio harness all read this list, so
 * nothing else needs touching.
 */
import type { TrackDef } from './types'
import { neonHorizon } from './neonHorizon'
import { pixelRush } from './pixelRush'
import { voltage } from './voltage'

export const TRACKS: TrackDef[] = [neonHorizon, pixelRush, voltage]

export const DEFAULT_TRACK_ID = neonHorizon.id

/** Falls back to the default rather than going silent on an unknown id. */
export function getTrack(id: string | undefined): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0]
}

export type { TrackDef } from './types'

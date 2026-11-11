import { music } from '../audio/music'

/**
 * The music steps behind a door while `open()` holds: something is being read
 * over it — the rules, the preferences — and the bed goes on, muffled, as if
 * from the next room, rather than stopping or competing with the reading.
 *
 * A `.svelte.ts` because it is nothing but an effect. It plays nothing, so it
 * is not a sound a component makes (`gameAudio()` owns those): it moves the
 * bed's own low-pass (`music.setMuffled`), which is counted, so two panels open
 * at once do not open the door when the first one shuts. The audio panel does
 * not use it — somebody setting the music's volume is listening to the music.
 */
export function muffleBedWhile(open: () => boolean): void {
  $effect(() => {
    if (!open()) return
    music.setMuffled(true)
    return () => music.setMuffled(false)
  })
}

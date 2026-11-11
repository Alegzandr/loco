/**
 * The order the three things are offered in.
 *
 * The *set* is the server's (`protocol.AllEmotes`) and so is the identifier that
 * travels; this is only the row's reading order, and it is a decision rather
 * than an accident: "GG" is what somebody reaches for after a close match, so it
 * is first and closest to the thumb.
 *
 * Typed against `Emote`, so a fourth one added on the server is a compile error
 * here rather than a button nobody drew — and a fourth one invented here does
 * not compile at all, which is the same rule the server enforces on the wire.
 */
import type { Emote } from '../types/protocol'

export const EMOTE_ORDER: readonly Emote[] = ['gg', 'close', 'lucky']

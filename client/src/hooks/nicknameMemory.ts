/**
 * The last nickname this browser played under.
 *
 * Deliberately localStorage, and deliberately NOT part of `sessionPersistence`:
 * that record is a live claim on a seat (per tab, token-bearing, TTL'd), while
 * this is a keyboard shortcut. Nothing here authenticates anything, so sharing
 * it across tabs and outliving the tab is exactly what is wanted: a player who
 * comes back tomorrow, or opens a second tab, should find their name already in
 * the field instead of typing it again on every visit.
 *
 * It is a prefill, never a submission: the field stays editable and an empty
 * value still refuses to send.
 */

export const NICKNAME_KEY = 'loco_nickname'

/** Same bound as the input's maxLength and the server's validation. */
export const NICKNAME_MAX = 20

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Private modes and embedded webviews can throw on access alone.
    return null
  }
}

/** The remembered nickname, or '' when there is none or it is unusable. */
export function readNickname(): string {
  const s = storage()
  if (!s) return ''
  try {
    const raw = s.getItem(NICKNAME_KEY)
    if (typeof raw !== 'string') return ''
    // A stored value that outgrew the current bound is truncated rather than
    // dropped: the player still recognises their name, and the server would
    // have refused the full one.
    return raw.trim().slice(0, NICKNAME_MAX)
  } catch {
    return ''
  }
}

/**
 * Records a nickname that was actually used to enter a room. Called on submit,
 * not on every keystroke: half-typed names are not what anyone wants back.
 */
export function rememberNickname(nickname: string): void {
  const value = nickname.trim().slice(0, NICKNAME_MAX)
  const s = storage()
  if (!s) return
  try {
    if (!value) s.removeItem(NICKNAME_KEY)
    else s.setItem(NICKNAME_KEY, value)
  } catch {
    // A full or disabled quota is not worth taking the app down for.
  }
}

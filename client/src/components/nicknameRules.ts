/**
 * The shape half of nickname validation, mirrored from
 * `server/game/nickname.go` so a refusal is instant instead of a round trip.
 *
 * Two things this file deliberately does not do.
 *
 * It does not decide anything. The server validates every nickname again on
 * `create_room`, `join_room` and `find_match`, and its answer is the one that
 * seats a player. This is feedback, not authority: a client that skipped it
 * would be refused a fraction of a second later.
 *
 * It does not carry the word list. That list is 19 embedded files on the
 * server, and shipping it here would mean downloading a few thousand slurs on
 * every page load, in a bundle anyone can read, for a check the server has to
 * repeat anyway. A blocked term therefore comes back from the server as the
 * same generic refusal every other rule produces, which is the point: the
 * player is never told *which* rule they hit, because the next attempt would
 * be the same nickname one character apart.
 */

/** Same bound as the input's maxLength and the server's NicknameMaxRunes. */
export const NICKNAME_MAX_CHARS = 20

/** Letters, in the alphabets the server accepts: Latin, Greek, Cyrillic. */
// The two holes in the Latin-1 range are × and ÷, which are maths, not letters.
const LETTER = /[A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿ]/u
/** The punctuation a name legitimately contains: O'Brien, Anne-Marie, Mr. Bean. */
const PUNCT = "-_.'"
/** Combining marks. One on a base letter is "Á"; a stack of them is Zalgo. */
const MARK = /\p{Mn}/u

/**
 * Canonical form: trimmed, with runs of spaces squeezed. Only U+0020 is
 * squeezed. Every other space character is not whitespace to be tidied, it is a
 * character a nickname may not contain, and the check below says so.
 */
export function canonicalNickname(raw: string): string {
  return raw.replace(/ +/g, ' ').trim()
}

/**
 * Whether the nickname passes the rules the client can check on its own.
 * A `true` here is not an acceptance: the server still owns the verdict.
 */
export function isNicknameShapeValid(raw: string): boolean {
  const n = canonicalNickname(raw)
  const chars = Array.from(n)
  if (chars.length === 0 || chars.length > NICKNAME_MAX_CHARS) return false

  let hasAlnum = false
  let marks = 0
  let prevBase = false
  for (const ch of chars) {
    if (MARK.test(ch)) {
      // A mark modifies the letter before it, so it can neither open a
      // nickname nor pile up on one.
      if (!prevBase || marks >= 1) return false
      marks++
      continue
    }
    if (/[0-9]/.test(ch) || LETTER.test(ch)) {
      hasAlnum = true
      prevBase = true
      marks = 0
      continue
    }
    if (ch === ' ' || PUNCT.includes(ch)) {
      prevBase = false
      marks = 0
      continue
    }
    // Everything else: emoji, markup, the zero-width characters, the bidi
    // overrides, an alphabet the seat label cannot render.
    return false
  }
  // "---" is inside the charset and is not a name. A seat needs something a
  // viewer can read back.
  return hasAlnum
}

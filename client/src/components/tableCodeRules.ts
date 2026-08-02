/**
 * The table code's shape, mirrored from `server/hub/converter.go`
 * (`roomCodeRe`) and `server/hub/hub.go` (the alphabet codes are drawn from),
 * so the lobby can refuse an impossible code without a round trip.
 *
 * Like `nicknameRules.ts`, this decides nothing: the server still owns the
 * verdict on `join_room`. It exists so "Take a seat" is never live on something
 * that cannot be a table, which is the difference between a button that does
 * nothing and a button that says so.
 */

/** Same bound as the input's maxLength and the server's generated codes. */
export const TABLE_CODE_LENGTH = 6

/**
 * The alphabet the server draws a code from: A-Z and 2-9 minus I, O, 0 and 1.
 * Those four are dropped because a code is read out loud and typed back from a
 * stream, where I/1 and O/0 are the same character.
 */
export const TABLE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const OUTSIDE_ALPHABET = new RegExp(`[^${TABLE_CODE_CHARS}]`, 'g')

/**
 * What the field keeps of what was typed: uppercased, with everything outside
 * the alphabet dropped and the length capped. Dropping rather than refusing is
 * deliberate: a pasted code carrying a stray space or a trailing newline is the
 * right code, and a player typing `0` for `O` gets nothing rather than a
 * character the server will reject six keystrokes later.
 */
export function sanitizeTableCode(raw: string): string {
  return raw.toUpperCase().replace(OUTSIDE_ALPHABET, '').slice(0, TABLE_CODE_LENGTH)
}

/** Whether the code is a shape the server could seat. Not an acceptance. */
export function isTableCodeValid(raw: string): boolean {
  return sanitizeTableCode(raw).length === TABLE_CODE_LENGTH
}

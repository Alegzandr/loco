/**
 * One tab holds the game; the others say so and open no socket.
 *
 * Every tab used to be a session of its own, deliberately: `sessionPersistence.ts`
 * keeps the seat record in `sessionStorage` precisely so two seats opened from one
 * browser cannot overwrite each other's token, and `hub.alreadySeated` only ever
 * looks at its own socket. What that left is a second tab that looks like a fresh
 * game, counts a second time in `players_online`, and — with the 1v1 queue
 * deduplicating by socket pointer — can be paired against the first one. A player
 * against their own reflection is the game lying to them.
 *
 * So a tab elects itself owner or it does not, and only the owner mounts the app.
 * Not the socket being closed after the fact: `webSocket()` is called at the top
 * of `App.svelte`'s script, so the only way not to open one is not to mount `App`,
 * which is what `Root.svelte` is for.
 *
 * Three things about the shape, each of which is the fix to something the obvious
 * version gets wrong:
 *
 * **The election is synchronous, and it is `localStorage` rather than a race on
 * `BroadcastChannel`.** Asking the other tabs "is anyone there?" and waiting for a
 * reply means a window with no answer yet, and a boot that waits is a boot that
 * either flashes a curtain over a tab that turns out to be the owner or opens a
 * socket "just in case" — which is the whole thing being prevented. One read
 * decides it, before the first paint.
 *
 * **The record is a heartbeat, not a flag.** A tab that crashes, or that the OS
 * kills, sends no `release`, and a plain flag would lock every future tab out of
 * the game for good. `at` is refreshed every `BEAT_MS` and anything older than
 * `STALE_MS` is nobody's.
 *
 * **When in doubt, own it.** No `localStorage`, no `BroadcastChannel`, storage
 * that throws, JSON that will not parse — every one of those ends with this tab
 * being the owner. A player wrongly shut out of the game is worse than two tabs,
 * and it is the failure they cannot argue with.
 *
 * What this does not cover, and what nothing on the client can: a second browser,
 * a private window, another machine. The storage is per origin *and* per profile,
 * so the queue can still, in principle, pair somebody against themselves. Closing
 * that would be a server rule, and the obvious one (refuse to pair two sockets on
 * one `netKey`) refuses two friends on one wifi — and, behind a proxy whose
 * forwarded header is not trusted, refuses everybody.
 */

/** Where the owner is written. Shared across tabs, unlike the seat record. */
const TAB_KEY = 'loco_tab'

/** Named the same on purpose: one subject, one name. */
const CHANNEL_NAME = 'loco_tab'

/** How often the owner says it is still there. */
export const BEAT_MS = 2000

/**
 * How long a record outlives its last beat. Two and a half beats: one missed
 * timer on a throttled background tab must not hand the game away, and a tab
 * that really died must not hold it for longer than somebody will sit staring
 * at the curtain.
 */
export const STALE_MS = 5000

interface TabRecord {
  id: string
  at: number
  /** Whether the owner is at a table. It is what the curtain's copy turns on. */
  seated: boolean
}

interface ChannelMsg {
  /** `claim` takes the game, `release` gives it up, `beat` is proof of life. */
  k: 'claim' | 'release' | 'beat'
  id: string
  seated: boolean
}

let id = ''
let active = true
let seated = false
let otherSeated = false
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let channel: BroadcastChannel | null = null

const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Not a security boundary — it only has to be different from the tab next
    // door — so anything unique enough will do where randomUUID is missing.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * Presence of the object is not enough: Safari's private mode has thrown on
 * write while still exposing it, and a storage that cannot be written is a lock
 * nobody can ever release. So the probe writes.
 */
function storageWorks(): boolean {
  try {
    localStorage.setItem(`${TAB_KEY}_probe`, '1')
    localStorage.removeItem(`${TAB_KEY}_probe`)
    return true
  } catch {
    return false
  }
}

function readRecord(): TabRecord | null {
  try {
    const raw = localStorage.getItem(TAB_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const r = parsed as Partial<TabRecord>
    if (typeof r.id !== 'string' || typeof r.at !== 'number') return null
    return { id: r.id, at: r.at, seated: r.seated === true }
  } catch {
    return null
  }
}

function writeRecord(): void {
  try {
    const record: TabRecord = { id, at: Date.now(), seated }
    localStorage.setItem(TAB_KEY, JSON.stringify(record))
  } catch {
    // Storage refused. This tab keeps playing and simply stops advertising
    // itself; the tab next door will take the game when its record goes stale,
    // which is the same outcome as a crash and is preferable to shutting this
    // player out over a browser setting.
  }
}

/**
 * A record nobody is behind. A timestamp in the future counts too: a clock that
 * moved backwards would otherwise leave a record that never expires, and the
 * game would be unplayable in every tab until storage was cleared by hand.
 */
function isStale(record: TabRecord | null, now: number): boolean {
  if (!record) return true
  return record.at <= now - STALE_MS || record.at > now + STALE_MS
}

function post(k: ChannelMsg['k']): void {
  try {
    channel?.postMessage({ k, id, seated } satisfies ChannelMsg)
  } catch {
    // A closed or unavailable channel only costs the instant handover; the
    // heartbeat below still resolves it within STALE_MS.
  }
}

function becomeOwner(): void {
  const was = active
  active = true
  otherSeated = false
  writeRecord()
  if (!was) notify()
}

function standAside(theirSeat: boolean): void {
  const changed = active || otherSeated !== theirSeat
  active = false
  otherSeated = theirSeat
  if (changed) notify()
}

/**
 * One timer for both states, because both are the same question asked from two
 * sides: the owner says it is still there, and a tab that is not the owner asks
 * whether anyone still is.
 */
function tick(): void {
  const record = readRecord()
  const now = Date.now()
  if (active) {
    // Two tabs opened in the same millisecond both wrote, and the last write
    // won. This is where the loser finds out. The window is a few microseconds
    // wide and self-correcting; making it impossible would need a lock the web
    // does not offer everywhere.
    if (record && record.id !== id && !isStale(record, now)) {
      standAside(record.seated)
      return
    }
    writeRecord()
    post('beat')
    return
  }
  if (isStale(record, now)) {
    becomeOwner()
    return
  }
  if (record && record.seated !== otherSeated) {
    otherSeated = record.seated
    notify()
  }
}

function onChannel(ev: MessageEvent): void {
  const msg = ev.data as Partial<ChannelMsg> | null
  if (!msg || typeof msg.id !== 'string' || msg.id === id) return
  const theirSeat = msg.seated === true
  if (msg.k === 'claim') {
    // Somebody pressed the button on the curtain. The owner yields without
    // arguing: the tab that asked is the one with a player in front of it, and
    // it has already been told what this costs.
    if (active) standAside(theirSeat)
    return
  }
  if (msg.k === 'release') {
    if (!active) becomeOwner()
    return
  }
  if (msg.k === 'beat' && !active && theirSeat !== otherSeated) {
    otherSeated = theirSeat
    notify()
  }
}

/**
 * The net under the channel: a tab that never received a message still sees the
 * key change. It is the first `storage` listener in this client — everything
 * else in `localStorage` here (the nickname, the preferences, the language, the
 * theme) is read at boot and deliberately does not follow another tab, because
 * changing the language under somebody mid-match is not a courtesy.
 */
function onStorage(ev: StorageEvent): void {
  if (ev.key !== null && ev.key !== TAB_KEY) return
  tick()
}

function onLeave(): void {
  if (!active) return
  post('release')
  try {
    localStorage.removeItem(TAB_KEY)
  } catch {
    // The record goes stale on its own; this only makes the handover instant.
  }
}

/**
 * Decides, before the first render, whether this tab is the one holding the
 * game. Called from `entry.ts` ahead of `initSessionRestore()`: a tab that is
 * not the owner must not seed the restoring screen or line up a `join_room`
 * either.
 */
export function initTabLock(): boolean {
  if (started) return active
  started = true

  if (typeof window === 'undefined') return active

  // No storage, no election. This tab owns the game, as every other tab will,
  // and the situation is exactly the one that shipped before this file existed.
  if (!storageWorks()) return active

  id = newId()

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = onChannel
    }
  } catch {
    channel = null
  }

  const record = readRecord()
  if (isStale(record, Date.now())) becomeOwner()
  else standAside(record?.seated === true)

  timer = setInterval(tick, BEAT_MS)
  window.addEventListener('storage', onStorage)
  // `pagehide` rather than `beforeunload`: the latter is not fired on iOS and
  // disqualifies the page from the back/forward cache where it is.
  window.addEventListener('pagehide', onLeave)

  return active
}

export function isTabActive(): boolean {
  return active
}

/** Whether the tab holding the game is at a table. Only meaningful when blocked. */
export function otherTabSeated(): boolean {
  return otherSeated
}

/**
 * Take the game from whichever tab is holding it.
 *
 * It inherits nothing. The other tab's seat record lives in *its* `sessionStorage`
 * and cannot be read from here, so this tab starts at the menu — which is why the
 * curtain says what pressing it costs before it is pressed, rather than after.
 */
export function takeOverTab(): void {
  if (active) return
  post('claim')
  becomeOwner()
}

/**
 * Whether this tab is at a table, mirrored into the record so a blocked tab can
 * tell a menu from a match. Written by `App.svelte` beside `data-seated`.
 */
export function setTabSeated(next: boolean): void {
  if (next === seated) return
  seated = next
  if (!active) return
  writeRecord()
  post('beat')
}

export function subscribeTabLock(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test/showcase seam: forget everything and let the next `initTabLock` decide again. */
export function resetTabLock(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
  try {
    channel?.close()
  } catch {
    // Already closed.
  }
  channel = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pagehide', onLeave)
  }
  id = ''
  active = true
  seated = false
  otherSeated = false
  started = false
  listeners.clear()
}

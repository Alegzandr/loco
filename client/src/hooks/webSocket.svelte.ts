import * as v from 'valibot'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { serverMsgSchema } from '../types/protocolSchemas'
import { reconnectDelay, type WsStatus } from './webSocketPolicy'

export type { WsStatus }
export { reconnectDelay }

type MessageHandler = (msg: ServerMsg) => void
/** Returns the message to send on reconnect, or null if not in an active session. */
type GetReconnectMsg = () => ClientMsg | null

const MAX_RECONNECT_ATTEMPTS = 10

/**
 * The socket the whole game runs on. The same machine the React hook ran, with
 * the refs turned back into plain variables — they were only refs because React
 * had no other way to keep a value across renders. The pure half (`WsStatus`,
 * `reconnectDelay`) stays in `webSocketPolicy.ts`, where a test can reach it
 * without a component.
 */
export function webSocket(onMessage: MessageHandler, getReconnectMsg?: GetReconnectMsg) {
  let ws: WebSocket | null = null
  // Holds messages queued while the socket was not OPEN; flushed in FIFO order on
  // the next successful onopen so a user can rapidly tap multiple actions (draw +
  // play) during a brief reconnect without losing any of them.
  let pending: string[] = []
  let attempts = 0
  let unmounted = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let status = $state<WsStatus>('connecting')

  function connect() {
    if (unmounted) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    // VITE_WS_PORT is set in docker-compose.dev.yml to the Go server's port
    // (8080). When present, connect directly to that port, bypassing the Vite dev
    // server entirely (Vite's WS proxy is unreliable under Docker networking). In
    // production VITE_WS_PORT is unset, so we fall back to same-origin /ws
    // (served by nginx, which proxies to the Go backend).
    const wsPort = import.meta.env.VITE_WS_PORT
    const wsUrl = wsPort
      ? `${proto}://${window.location.hostname}:${wsPort}/ws`
      : `${proto}://${window.location.host}/ws`
    if (import.meta.env.DEV) console.debug('[ws] connecting to', wsUrl)

    const socket = new WebSocket(wsUrl)
    ws = socket
    status = 'connecting'

    socket.onopen = () => {
      attempts = 0
      status = 'open'
      // If reconnecting into an active game (or lobby), re-authenticate first.
      const reconnectMsg = getReconnectMsg?.()
      if (reconnectMsg) socket.send(JSON.stringify(reconnectMsg))
      // Flush every queued message in order. Without this, a rapid double-tap
      // during a reconnect window would lose all but the last action.
      if (pending.length > 0) {
        for (const data of pending) socket.send(data)
        pending = []
      }
    }

    socket.onmessage = (e) => {
      let raw: unknown
      try {
        raw = JSON.parse(e.data)
      } catch {
        console.error('Failed to parse server message JSON', e.data)
        return
      }
      const result = v.safeParse(serverMsgSchema, raw)
      if (!result.success) {
        // In dev this surfaces protocol drift between Go and TS immediately; in
        // prod we still pass the raw payload through so a single new field does
        // not take the client offline (forward-compat).
        console.error('Server message failed schema validation', result.issues, raw)
        if (import.meta.env.DEV) return
        onMessage(raw as ServerMsg)
        return
      }
      onMessage(result.output)
    }

    socket.onerror = (e) => console.error('WebSocket error', e)

    socket.onclose = () => {
      // Guard: if this socket is no longer the current one (replaced by a
      // remount), do not trigger a reconnect from the stale close event.
      if (ws !== socket) return
      if (unmounted) return
      status = 'closed'
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket: max reconnect attempts reached')
        return
      }
      const delay = reconnectDelay(attempts)
      attempts++
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  $effect(() => {
    unmounted = false
    connect()
    return () => {
      unmounted = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const socket = ws
      if (socket) {
        // Null out onclose + onerror before closing so that forcibly closing a
        // CONNECTING socket does not log a spurious "WebSocket error" or schedule
        // a reconnect. Real errors during active use are still reported because
        // these handlers are only cleared here, at intentional teardown time.
        socket.onclose = null
        socket.onerror = null
        socket.close()
        ws = null
      }
    }
  })

  return {
    send(msg: ClientMsg) {
      const data = JSON.stringify(msg)
      if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      // Buffer in order; flushed on the next successful onopen.
      else pending.push(data)
    },
    get wsStatus() {
      return status
    },
    forceClose() {
      ws?.close()
    },
  }
}

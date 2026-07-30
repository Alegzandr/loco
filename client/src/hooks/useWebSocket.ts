import { useEffect, useRef, useCallback, useState } from 'react'
import { ClientMsg, ServerMsg } from '../types/protocol'
import { serverMsgSchema } from '../types/protocolSchemas'

type MessageHandler = (msg: ServerMsg) => void
// Returns the message to send on reconnect, or null if not in an active session.
type GetReconnectMsg = () => ClientMsg | null

export type WsStatus = 'connecting' | 'open' | 'closed'

// Backoff schedule, in milliseconds, indexed by attempt. The first retry is
// deliberately almost immediate: most drops in practice are a single lost
// connection (a wifi hiccup, a proxy recycling), and they come back at once.
// A flat two-second first retry meant that every one of those cost the player
// two seconds of a dead board (an entire interrupt window, a third of a catch
// window) for a socket that would have reopened in a quarter of a second.
// The tail still backs off, so a server that is genuinely down is not hammered.
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000]
const MAX_RECONNECT_ATTEMPTS = 10

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

export function useWebSocket(onMessage: MessageHandler, getReconnectMsg?: GetReconnectMsg) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const getReconnectMsgRef = useRef(getReconnectMsg)
  getReconnectMsgRef.current = getReconnectMsg

  // Holds messages queued while the socket was not OPEN; flushed in FIFO order
  // on the next successful onopen so a user can rapidly tap multiple actions
  // (e.g. draw + play) during a brief reconnect without losing any of them.
  const pendingRef = useRef<string[]>([])
  const attemptsRef = useRef(0)
  const unmountedRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')

  const connect = useCallback(() => {
    if (unmountedRef.current) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    // VITE_WS_PORT is set in docker-compose.dev.yml to the Go server's port (8080).
    // When present, connect directly to that port, bypassing the Vite dev server
    // entirely (Vite's WS proxy is unreliable under Docker networking).
    // In production VITE_WS_PORT is unset, so we fall back to same-origin /ws
    // (served by nginx which proxies to the Go backend).
    const wsPort = import.meta.env.VITE_WS_PORT
    const wsUrl = wsPort
      ? `${proto}://${window.location.hostname}:${wsPort}/ws`
      : `${proto}://${window.location.host}/ws`
    if (import.meta.env.DEV) {
      console.debug('[ws] connecting to', wsUrl)
    }
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    setWsStatus('connecting')

    ws.onopen = () => {
      attemptsRef.current = 0
      setWsStatus('open')
      // If reconnecting into an active game (or lobby), re-authenticate first.
      const reconnectMsg = getReconnectMsgRef.current?.()
      if (reconnectMsg) {
        ws.send(JSON.stringify(reconnectMsg))
      }
      // Flush every queued message in order. Without this, a rapid double-tap
      // during a reconnect window would lose all but the last action.
      if (pendingRef.current.length > 0) {
        for (const data of pendingRef.current) {
          ws.send(data)
        }
        pendingRef.current = []
      }
    }

    ws.onmessage = (e) => {
      let raw: unknown
      try {
        raw = JSON.parse(e.data)
      } catch {
        console.error('Failed to parse server message JSON', e.data)
        return
      }
      const result = serverMsgSchema.safeParse(raw)
      if (!result.success) {
        // In dev this surfaces protocol drift between Go and TS immediately;
        // in prod we still pass the raw payload through so a single new field
        // doesn't take the client offline (forward-compat).
        console.error('Server message failed schema validation', result.error.issues, raw)
        if (import.meta.env.DEV) return
        onMessageRef.current(raw as ServerMsg)
        return
      }
      onMessageRef.current(result.data)
    }

    ws.onerror = (e) => console.error('WebSocket error', e)

    ws.onclose = () => {
      // Guard: if this socket is no longer the current one (e.g. replaced by a
      // re-mount), don't trigger a reconnect from the stale close event.
      if (wsRef.current !== ws) return
      if (unmountedRef.current) return
      setWsStatus('closed')
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket: max reconnect attempts reached')
        return
      }
      const delay = reconnectDelay(attemptsRef.current)
      attemptsRef.current++
      reconnectTimerRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      // Cancel any pending reconnect timer.
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      if (ws) {
        // Null out onclose + onerror before closing so that forcibly closing a
        // CONNECTING socket (React StrictMode double-invoke) doesn't log a
        // spurious "WebSocket error" or schedule a reconnect. Real errors
        // during active use are still reported because these handlers are only
        // cleared here, at intentional teardown time.
        ws.onclose = null
        ws.onerror = null
        ws.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((msg: ClientMsg) => {
    const data = JSON.stringify(msg)
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data)
    } else {
      // Buffer in order; flushed on the next successful onopen.
      pendingRef.current.push(data)
    }
  }, [])

  const forceClose = useCallback(() => {
    const ws = wsRef.current
    if (!ws) return
    ws.close()
  }, [])

  return { send, wsStatus, forceClose }
}

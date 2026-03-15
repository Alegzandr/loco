import { useEffect, useRef, useCallback } from 'react'
import { ClientMsg, ServerMsg } from '../types/protocol'

type MessageHandler = (msg: ServerMsg) => void
// Returns the message to send on reconnect, or null if not in an active session.
type GetReconnectMsg = () => ClientMsg | null

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 10

export function useWebSocket(onMessage: MessageHandler, getReconnectMsg?: GetReconnectMsg) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const getReconnectMsgRef = useRef(getReconnectMsg)
  getReconnectMsgRef.current = getReconnectMsg

  // Holds the pending message to send after reconnect, if any.
  const pendingRef = useRef<string | null>(null)
  const attemptsRef = useRef(0)
  const unmountedRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (unmountedRef.current) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    // In dev mode, connect directly to the Go backend to bypass Vite's WS proxy,
    // which is unreliable for WebSocket upgrades under Docker networking.
    // VITE_WS_PORT defaults to 8080 (the Go server port).
    const wsUrl = import.meta.env.DEV
      ? `${proto}://${window.location.hostname}:${import.meta.env.VITE_WS_PORT ?? '8080'}/ws`
      : `${proto}://${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      attemptsRef.current = 0
      // If reconnecting into an active game, re-authenticate first.
      const reconnectMsg = getReconnectMsgRef.current?.()
      if (reconnectMsg) {
        ws.send(JSON.stringify(reconnectMsg))
      }
      if (pendingRef.current !== null) {
        ws.send(pendingRef.current)
        pendingRef.current = null
      }
    }

    ws.onmessage = (e) => {
      try {
        const msg: ServerMsg = JSON.parse(e.data)
        onMessageRef.current(msg)
      } catch {
        console.error('Failed to parse server message', e.data)
      }
    }

    ws.onerror = (e) => console.error('WebSocket error', e)

    ws.onclose = () => {
      // Guard: if this socket is no longer the current one (e.g. replaced by a
      // re-mount), don't trigger a reconnect from the stale close event.
      if (wsRef.current !== ws) return
      if (unmountedRef.current) return
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket: max reconnect attempts reached')
        return
      }
      attemptsRef.current++
      const delay = RECONNECT_DELAY_MS * Math.min(attemptsRef.current, 4)
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
        // Null out onclose before closing so the close event doesn't schedule
        // a spurious reconnect (important in React StrictMode double-invoke).
        ws.onclose = null
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
      // Buffer the message; it will be flushed on reconnect open.
      pendingRef.current = data
    }
  }, [])

  return { send }
}

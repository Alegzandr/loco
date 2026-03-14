import { useEffect, useRef, useCallback } from 'react'
import { ClientMsg, ServerMsg } from '../types/protocol'

type MessageHandler = (msg: ServerMsg) => void

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 10

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  // Holds the pending message to send after reconnect, if any.
  const pendingRef = useRef<string | null>(null)
  const attemptsRef = useRef(0)
  const unmountedRef = useRef(false)

  const connect = useCallback(() => {
    if (unmountedRef.current) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host
    const ws = new WebSocket(`${proto}://${host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      attemptsRef.current = 0
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
      if (unmountedRef.current) return
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket: max reconnect attempts reached')
        return
      }
      attemptsRef.current++
      const delay = RECONNECT_DELAY_MS * Math.min(attemptsRef.current, 4)
      setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      wsRef.current?.close()
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

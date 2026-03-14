import { useEffect, useRef, useCallback } from 'react'
import { ClientMsg, ServerMsg } from '../types/protocol'

type MessageHandler = (msg: ServerMsg) => void

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host
    const ws = new WebSocket(`${protocol}://${host}/ws`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg: ServerMsg = JSON.parse(e.data)
        onMessageRef.current(msg)
      } catch {
        console.error('Failed to parse server message', e.data)
      }
    }

    ws.onerror = (e) => console.error('WebSocket error', e)

    return () => {
      ws.close()
    }
  }, [])

  const send = useCallback((msg: ClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}

<script lang="ts">
  import type { ClientMsg } from '../types/protocol'
  import type { WsStatus } from '../hooks/webSocket.svelte'
  import { gameViewStub } from './gameViewStub'

  /**
   * Stands in for the match screen in the two tests that are about App rather
   * than about the board: the subscription contract and the reload path. Both
   * only ever need to know that the board is on screen, and mounting the real
   * one drags in the whole renderer.
   */
  type Props = {
    onSend: (msg: ClientMsg) => void
    wsStatus?: WsStatus
  }

  let { onSend }: Props = $props()

  // The script body: once per instantiation, which is the whole point.
  gameViewStub.instances++
  gameViewStub.onSend = onSend
</script>

<div data-testid="game"></div>

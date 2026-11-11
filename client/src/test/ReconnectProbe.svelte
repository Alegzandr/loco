<script lang="ts">
  import { reconnectAnimation } from '../state/viewEffects.svelte'

  type Props = { reconnecting: boolean; onDone: () => void }
  let { reconnecting, onDone }: Props = $props()

  const overlay = reconnectAnimation(
    () => reconnecting,
    () => onDone(),
  )
</script>

<div data-testid="state">{overlay.current ? 'overlay' : 'board'}</div>

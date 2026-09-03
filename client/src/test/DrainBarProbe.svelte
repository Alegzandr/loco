<script lang="ts">
  import { untrack } from 'svelte'
  import { drainBar } from '../hooks/drainBar.svelte'

  type Props = { deadline: number | null; total?: number | 'auto' }
  let { deadline, total = 'auto' }: Props = $props()

  let fill = $state<HTMLDivElement | null>(null)
  let track = $state<HTMLDivElement | null>(null)

  drainBar(
    () => fill,
    () => deadline,
    untrack(() => total),
    () => track,
    'urgent',
  )
</script>

<div bind:this={track} data-testid="track">
  <div bind:this={fill} data-testid="fill"></div>
</div>

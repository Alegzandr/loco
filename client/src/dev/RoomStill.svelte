<script lang="ts">
  import SceneBackdrop from '../components/scene/SceneBackdrop.svelte'
  import { resolveScene } from '../components/cards/maps'
  import { elementSize } from '../hooks/boardMetrics.svelte'

  /**
   * A room on its own, for the rooms page.
   *
   * A content page ships no script, so it cannot render the diorama; what it
   * can show is a photograph of one. `make rooms` opens this scene for each
   * room at 16:9, waits for the render and shoots it into
   * `client/src/assets/rooms/`, and the page lays its CSS table over the
   * still — so the podium here is built under exactly the ellipse
   * `.roomTable` in content.css draws: centred, 70% wide, 50% tall.
   *
   * No cards, no seats, no chrome: the still is the place, and the page adds
   * the table the way the board does.
   */
  type Props = {
    mapId: string
    time: string
    weather: string
  }
  let { mapId, time, weather }: Props = $props()

  const scene = $derived(resolveScene(mapId, time, weather))
  let host = $state<HTMLDivElement | null>(null)
  const size = elementSize(() => host)
  const anchor = $derived({
    cx: size.current.width * 0.5,
    cy: size.current.height * 0.5,
    rx: size.current.width * 0.35,
    ry: size.current.height * 0.25,
  })
</script>

<div class="still" bind:this={host} data-testid="room-still">
  {#if scene}
    <SceneBackdrop {scene} {anchor} />
  {/if}
</div>

<style>
  .still {
    position: fixed;
    inset: 0;
    background: var(--room-void);
  }
</style>

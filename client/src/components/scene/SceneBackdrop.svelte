<script lang="ts">
  import { untrack } from 'svelte'
  import type { SceneSpec } from '../cards/maps'
  import { sceneKey } from '../cards/maps'
  import { lightRig, rigCssVars } from './sky'
  import { peekScene, prepareScene, renderSizeFor } from './sceneCache'
  import { elementSize } from '../../hooks/boardMetrics.svelte'
  import WeatherLayer from './WeatherLayer.svelte'

  /**
   * A rendered room, filling whatever element it is put in.
   *
   * Three layers, back to front: the sky gradient from the rig (on screen from
   * the first frame, and all there is when a render fails), the rendered frame
   * drawn into this element's own canvas, and the weather. `blur` is the depth
   * of field the board asks for and the loading screen does not: the room is
   * behind the table, and a scene in focus competes with a card edge.
   *
   * The frame comes from `sceneCache`, so the board and the loading screen
   * share the render the gate waited for. A resize asks for a new one at the
   * new size and keeps drawing the old one, stretched, until it lands: a
   * stretched bitmap for a second beats a bare gradient.
   */
  type Props = {
    scene: SceneSpec
    blur?: boolean
  }
  let { scene, blur = false }: Props = $props()

  let host = $state<HTMLDivElement | null>(null)
  let canvas = $state<HTMLCanvasElement | null>(null)
  const size = elementSize(() => host)

  const rig = $derived(lightRig(scene.time, scene.weather))
  const key = $derived(sceneKey(scene))
  // Re-render on a size change only past a step: a browser bar sliding in and
  // out moves the viewport by a few dozen pixels several times a minute.
  const bucket = $derived(`${Math.round(size.current.width / 96)}x${Math.round(size.current.height / 96)}`)

  let drawn = $state<string | null>(null)

  function paint(frame: HTMLCanvasElement | null) {
    const c = canvas
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (!frame) {
      drawn = null
      c.width = 1
      c.height = 1
      ctx.clearRect(0, 0, 1, 1)
      return
    }
    if (c.width !== frame.width || c.height !== frame.height) {
      c.width = frame.width
      c.height = frame.height
    }
    ctx.drawImage(frame, 0, 0)
    drawn = `${key}@${frame.width}x${frame.height}`
  }

  $effect(() => {
    const k = key
    const w = size.current.width
    const h = size.current.height
    void bucket
    if (w <= 0 || h <= 0) return
    const target = renderSizeFor(w, h)
    const have = untrack(() => peekScene(scene, target))
    if (have) paint(have.canvas)
    if (have && have.size.width === target.width && have.size.height === target.height) return
    let live = true
    // `prepareScene` never rejects by contract; the catch is for a stub or a
    // future that forgets, because an unhandled rejection here would be logged
    // over a board that is otherwise fine.
    prepareScene(scene, target)
      .then((entry) => {
        if (!live || entry.key !== k) return
        paint(entry.canvas)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  })
</script>

<div
  bind:this={host}
  class="scene"
  class:blur
  class:bare={drawn === null}
  style={rigCssVars(rig)}
  data-scene={key}
  aria-hidden="true"
>
  <canvas bind:this={canvas} class="frame"></canvas>
  <WeatherLayer weather={scene.weather} dry={scene.map.dry ?? false} />
</div>

<style>
  .scene {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* The sky, painted first and kept: it is the room's colour before the
       render lands, and the whole room when it never does. */
    background: linear-gradient(180deg, var(--sky-top) 0%, var(--sky-horizon) 100%);
    pointer-events: none;
  }

  .frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .bare .frame {
    visibility: hidden;
  }

  /* Depth of field for the board: slight, in vmin because the board scales
     with the viewport, and scaled up to hide the transparent rim a blur pulls
     in at the edges. */
  .blur .frame {
    filter: blur(0.3vmin);
    transform: scale(1.03);
  }
</style>

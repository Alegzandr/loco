<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { SceneSpec } from '../cards/maps'
  import type { FeltAnchor } from '../cards/layout'
  import { sceneKey } from '../cards/maps'
  import { lightRig, rigCssVars } from './sky'
  import { peekScene, prepareScene, renderSizeFor, sameFelt, sizeCloseEnough, type PreparedScene } from './sceneCache'
  import { elementSize } from '../../hooks/boardMetrics.svelte'
  import { graphicsPref } from '../../hooks/uiPrefs.svelte'
  import { lookVersion, subscribeLook } from './look'
  import WeatherLayer from './WeatherLayer.svelte'
  import LifeLayer from './LifeLayer.svelte'

  /**
   * A rendered room, filling whatever element it is put in.
   *
   * Three layers, back to front: the sky gradient from the rig (on screen from
   * the first frame, and all there is when a render fails), the rendered frame
   * drawn into this element's own canvas, and the weather. Sharp, on the board
   * as on the loading screen: the table stands on a podium the render carries
   * under exactly the felt (`anchor`), so the two halves are one object and a
   * blur between them would be the seam.
   *
   * The frame comes from `sceneCache`, so the board and the loading screen
   * share the render the gate waited for.
   *
   * **A resize is a stretch, and then one render.** The room is a three.js build
   * whose street is composed in screen space around the felt, so two sizes are
   * two different cities — and a window being dragged is hundreds of sizes.
   * Asked for per resize event, the room rebuilt itself under the table dozens
   * of times a second, each rebuild a frame of main thread and a visibly
   * different street: that is what a resize used to look like. So the frame
   * already up is stretched for free while the drag lasts, exactly one render is
   * asked for once the viewport has held still for `RESIZE_SETTLE_MS`, and when
   * it lands it is faded in over the stretched one rather than swapped for it.
   */
  type Props = {
    scene: SceneSpec
    /** Where the felt is on screen: the podium is rendered under it. */
    anchor: FeltAnchor
  }
  let { scene, anchor }: Props = $props()

  /**
   * How long the viewport has to hold still before the room is rendered again.
   *
   * Long enough that a drag is one render and not a hundred, short enough that
   * letting go of the window edge and reading the room are the same moment.
   */
  const RESIZE_SETTLE_MS = 240

  /** How long the new frame takes to come up over the one it replaces. */
  const FADE_MS = 260

  let host = $state<HTMLDivElement | null>(null)
  let canvasA = $state<HTMLCanvasElement | null>(null)
  let canvasB = $state<HTMLCanvasElement | null>(null)
  const size = elementSize(() => host)

  /** The look's edition: moved by the dev panel and by nothing else, and a move is a re-render. */
  let look = $state(lookVersion())
  $effect(() => subscribeLook(() => (look = lookVersion())))
  // Re-read on a look edition too: the panel moves the hours' skies.
  const rig = $derived.by(() => {
    void look
    return lightRig(scene.time, scene.weather)
  })
  const key = $derived(sceneKey(scene))

  /** Which of the two canvases is on top — the one the room is read off. */
  let topIsA = $state(true)
  /** The incoming frame, held at zero for one flush so the fade has a start. */
  let entering = $state(false)
  /** True once a bitmap is on screen; until then the sky gradient is the room. */
  let drawn = $state(false)
  /** The cache entry the canvas is showing, whatever size it was rendered at. */
  let shown: PreparedScene | null = null
  /** The same entry, for the life layer: what moves belongs to the frame on screen. */
  let alive = $state<PreparedScene | null>(null)

  function paint(entry: PreparedScene) {
    const frame = entry.canvas
    if (!frame) {
      // A render that failed is a scene, not an error: the sky gradient the rig
      // already describes is the room now.
      shown = entry
      alive = null
      drawn = false
      return
    }
    // The frame already up stays exactly where it is, and the new one is drawn
    // on the other canvas and brought up over it. Cross-fading the two — one
    // down while the other comes up — lets the sky through at half opacity in
    // the middle, and on a room that has barely changed that reads as a flash.
    const first = !drawn
    // The first frame goes on whichever canvas is already on top, so it fades
    // up out of the sky gradient. Every one after it goes on the other canvas
    // and takes the top on the way in.
    const c = (first ? topIsA : !topIsA) ? canvasA : canvasB
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (c.width !== frame.width || c.height !== frame.height) {
      c.width = frame.width
      c.height = frame.height
    }
    ctx.drawImage(frame, 0, 0)
    shown = entry
    alive = entry
    if (!first) topIsA = !topIsA
    entering = true
    drawn = true
    void tick().then(() => {
      if (!c.isConnected) return
      // Read a layout property so the browser commits `opacity: 0` before it is
      // taken away again: without it the two writes coalesce and there is no
      // transition left to run.
      void c.offsetWidth
      entering = false
    })
  }

  $effect(() => {
    // This does re-run on every pixel of a drag, and that is what re-arms the
    // timer below: the run itself is a cache peek and a `setTimeout`, and the
    // render it might ask for is the only expensive thing here. Quantising the
    // size instead would buy nothing — the podium is built under the felt, so a
    // felt that has moved needs a render whatever the width did.
    const k = key
    const w = size.current.width
    const h = size.current.height
    // The graphics tier is part of what a frame is: a player moving the
    // preference mid-match gets the room again at the new one, faded in over
    // the old like any other re-render.
    const tier = graphicsPref.tier
    // Read for the dependency: the cache key carries the edition itself.
    void look
    if (w <= 0 || h <= 0) return

    const target = renderSizeFor(w, h)
    const felt = anchor
    // A felt with no size is a viewport that has not been measured yet, and a
    // room built around it is a room nobody will see: the real anchor is one
    // effect away and re-runs this.
    if (felt.rx <= 0 || felt.ry <= 0) return
    const have = untrack(() => peekScene(scene, target, felt, tier))
    // Stretched, and only when it is not already the frame on screen: redrawing
    // an identical bitmap on every resize tick is an upload for no pixels.
    if (have && have !== shown) untrack(() => paint(have))
    // Close enough is done: see `sizeCloseEnough`. The felt is compared by
    // value through the cache key rather than by identity here, because the
    // anchor is a derived object and a new one with the same numbers is the
    // same podium.
    if (have && have.canvas && have.tier === tier && sizeCloseEnough(have.size, target) && sameFelt(have.felt, felt) && have.look === look) return

    let live = true
    // `prepareScene` never rejects by contract; the catch is for a stub or a
    // future that forgets, because an unhandled rejection here would be logged
    // over a board that is otherwise fine.
    const request = () => {
      prepareScene(scene, target, felt, undefined, tier)
        .then((entry) => {
          if (!live || entry.key !== k) return
          paint(entry)
        })
        .catch(() => {})
    }

    // Nothing of this room is on screen to stand in for the render — a first
    // mount, a new map, a render that failed — so it is asked for now: this is
    // the path the map-loading gate waits on, and a debounce there would be a
    // quarter of a second added to every match. Otherwise there is a frame to
    // stretch and this is a window being dragged, so it waits for the drag.
    if (!shown || shown.key !== k || !shown.canvas) {
      request()
      return () => {
        live = false
      }
    }
    const settle = setTimeout(request, RESIZE_SETTLE_MS)
    return () => {
      live = false
      clearTimeout(settle)
    }
  })
</script>

<div
  bind:this={host}
  class="scene"
  class:bare={!drawn}
  style="{rigCssVars(rig)}; --scene-fade: {FADE_MS}ms"
  data-scene={key}
  aria-hidden="true"
>
  <canvas bind:this={canvasA} class="frame" class:top={topIsA} class:entering={topIsA && entering}></canvas>
  <canvas bind:this={canvasB} class="frame" class:top={!topIsA} class:entering={!topIsA && entering}></canvas>
  <LifeLayer scene={alive} width={size.current.width} height={size.current.height} />
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
    /* The two frames and the weather stack inside this element, and `position`
       alone does not contain a z-index: without this they climb into the
       board's own stacking context, where the backdrop outranks the stage and
       the room is painted over the cards. `GameBoard`'s `.board` isolates for
       the same reason, one level up. */
    isolation: isolate;
  }

  .frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    /* Two opaque layers, stacked. The one going out is left at full opacity
       underneath; only the one coming in is animated. */
    opacity: 1;
    transition: opacity var(--scene-fade) linear;
    z-index: 1;
  }

  .frame.top {
    z-index: 2;
  }

  /* One flush at zero with no transition, so it is removing the class that
     starts the fade and not the paint that preceded it. */
  .frame.entering {
    opacity: 0;
    transition: none;
  }

  .bare .frame {
    visibility: hidden;
  }

  /* Before the frame lands, the sky is the whole room — and a noon sky is a
     near-white. A full screen of pale blue is what the loading gate put up on
     every day map, under white type, on a game whose every other surface is
     dark: the reveal read as a page that had failed to load rather than as a
     room about to open. Darkened to a little over a third, it is still the
     hour's own sky (a dawn is pink, a dusk amber, a night blue), and the
     screen's type keeps its contrast. The frame is opaque, so this is only ever
     seen while there is nothing to see. */
  .bare {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--sky-top) 38%, #07060f) 0%,
      color-mix(in srgb, var(--sky-horizon) 38%, #07060f) 100%
    );
  }

  :root[data-motion="reduce"] .frame {
    transition: none;
  }
</style>

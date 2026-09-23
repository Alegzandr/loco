<script lang="ts">
  import type { PreparedScene } from './sceneCache'
  import { routeKeyframes, cycleMs, tilePx, type Sprite } from './life'
  import { reducedMotion } from '../../hooks/uiPrefs.svelte'

  /**
   * What moves in a rendered room: one element per sprite, carried along its
   * route by a Web Animations transform. Nothing here goes through reactive
   * state and nothing draws per frame. An actor is one composited layer
   * (`.actor`) under its route animation, and what it does on the spot runs on
   * the elements inside it, **one transform animation per element and never
   * two**: a bob on `.body`, a spin or a puff on `.face`. Two animations
   * writing one element's `transform` do not add up — the later one wins, so
   * a bobbing thing that also spun did not bob.
   *
   * The sprites were rendered at the frame's device size, so the layer is laid
   * out in the frame's CSS pixels and then **scaled to the element** with one
   * transform: while a window is being dragged the room's frame is stretched
   * for free, and this layer stretches with it, so the boat stays on the water
   * until the next render lands with sprites of its own.
   *
   * Under reduced motion every actor holds the first frame of its route and
   * nothing on it moves: the boat is still a boat, moored, which is the
   * readable static state motion is required to degrade to. **The preference
   * is followed live** (`reducedMotion`, handed to the action as a parameter):
   * turning it on in the middle of a match stops every walker where it stands
   * on its route's first point, and turning it off sets them going again,
   * without a new render.
   *
   * An actor with something in front of its route is wrapped in a **veil**: a
   * frame-sized element wearing the mask the render cut for it
   * (`Sprite.mask`, from the depth map), so the walker goes behind the lamp
   * post and the parked car instead of over them. The veil does not move; the
   * actor moves inside it. One that has nothing in front of it wears none.
   */
  type Props = {
    scene: PreparedScene | null
    /** The element's CSS size. */
    width: number
    height: number
  }
  let { scene, width, height }: Props = $props()

  /** The frame's own CSS size: the sprites' coordinate space. */
  const frameW = $derived(scene ? scene.size.width / scene.size.pixelRatio : 0)
  const frameH = $derived(scene ? scene.size.height / scene.size.pixelRatio : 0)
  const fit = $derived(frameW > 0 && frameH > 0 ? `scale(${(width / frameW).toFixed(5)}, ${(height / frameH).toFixed(5)})` : 'none')
  const still = $derived(reducedMotion.current)

  type Params = { sprite: Sprite; w: number; h: number; pr: number; still: boolean }

  /** Draws the sprite into its own canvas and starts its animations. */
  function live(node: HTMLDivElement, p: Params) {
    let anims: Animation[] = []
    const canvas = node.querySelector('canvas')
    const body = node.querySelector<HTMLDivElement>('.body')
    const face = node.querySelector<HTMLDivElement>('.face')
    let drawn: { sprite: Sprite; pr: number } | null = null

    /** The bitmap, once per sprite and ratio: a motion change redraws nothing. */
    const draw = ({ sprite, pr }: Params) => {
      if (!canvas || (drawn && drawn.sprite === sprite && drawn.pr === pr)) return
      drawn = { sprite, pr }
      const { canvas: src, ox, oy } = sprite
      canvas.width = src.width
      canvas.height = src.height
      canvas.style.width = `${src.width / pr}px`
      canvas.style.height = `${src.height / pr}px`
      // The route carries the world origin (the ground under the thing);
      // the bitmap hangs off it by where that point landed in the render.
      canvas.style.marginLeft = `${-ox / pr}px`
      canvas.style.marginTop = `${-oy / pr}px`
      canvas.getContext('2d')?.drawImage(src, 0, 0)
    }

    const apply = (params: Params) => {
      for (const a of anims) a.cancel()
      anims = []
      draw(params)
      const { sprite, w, h, still } = params
      const { actor } = sprite
      const ppu = tilePx(w, h)
      const frames = routeKeyframes(actor, w, h, ppu)
      if (still) {
        node.style.transform = frames[0].transform
        node.style.opacity = '1'
        return
      }
      const seed = actor.delay ?? 0
      // A thing that stays put still bobs, turns or puffs where it stands.
      if (frames.length === 1) {
        node.style.transform = frames[0].transform
        node.style.opacity = ''
      } else {
        node.style.transform = ''
        node.style.opacity = ''
        anims.push(
          node.animate(
            frames.map((f) => ({ offset: f.offset, transform: f.transform, ...(f.opacity !== undefined ? { opacity: f.opacity } : {}) })),
            { duration: cycleMs(actor), iterations: Infinity, easing: 'linear', delay: -seed },
          ),
        )
      }
      if (body && actor.bob) {
        const amp = actor.bob.amp * ppu
        anims.push(
          body.animate(
            [{ transform: `translateY(${amp.toFixed(1)}px)` }, { transform: `translateY(${(-amp).toFixed(1)}px)` }, { transform: `translateY(${amp.toFixed(1)}px)` }],
            { duration: actor.bob.period, iterations: Infinity, easing: 'ease-in-out', delay: -seed },
          ),
        )
      }
      if (face && (actor.spin || actor.puff)) {
        // One animation on `.face` whatever it does: a thing that both spins
        // and puffs turns as it grows, in one set of keyframes.
        const turn = (deg: number) => (actor.spin ? ` rotate(${deg}deg)` : '')
        const keyframes: Keyframe[] = actor.puff
          ? [
              { transform: `scale(0.4)${turn(0)}`, opacity: 0 },
              { transform: `scale(0.8)${turn(90)}`, opacity: 0.9, offset: 0.25 },
              { transform: `scale(1.25)${turn(360)}`, opacity: 0 },
            ]
          : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }]
        anims.push(face.animate(keyframes, { duration: actor.duration, iterations: Infinity, easing: actor.puff ? 'ease-out' : 'linear', delay: -seed }))
      }
    }
    apply(p)
    return {
      update: apply,
      destroy() {
        for (const a of anims) a.cancel()
      },
    }
  }
</script>

{#snippet actor(sprite: Sprite, pr: number)}
  <div class="actor" data-id={sprite.actor.id} use:live={{ sprite, w: frameW, h: frameH, pr, still }}>
    <div class="body">
      <div class="face">
        <canvas></canvas>
      </div>
    </div>
  </div>
{/snippet}

<div class="life" aria-hidden="true" style="width: {frameW}px; height: {frameH}px; transform: {fit}">
  {#if scene}
    {#each scene.sprites as sprite (sprite.actor.id)}
      {#if sprite.mask}
        <div class="veil" style="width: {frameW}px; height: {frameH}px; --veil: url('{sprite.mask}')">
          {@render actor(sprite, scene.size.pixelRatio)}
        </div>
      {:else}
        {@render actor(sprite, scene.size.pixelRatio)}
      {/if}
    {/each}
  {/if}
</div>

<style>
  .life {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
    overflow: visible;
    /* Above both of the backdrop's frames (1 and 2), under the weather (4):
       the rain falls on the boat. */
    z-index: 3;
  }

  /* The mask is the frame's size and stretched to it; the actor is laid out
     at the same origin inside, so the two agree about where a pixel is. */
  .veil {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    -webkit-mask-image: var(--veil);
    mask-image: var(--veil);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }

  .actor {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
  }

  /* The bob, and inside it the spin or the puff: one transform each. Neither
     asks for a layer of its own; a running animation is promoted anyway, and
     a thing that does neither should not cost one. */
  .body,
  .face {
    position: absolute;
    left: 0;
    top: 0;
    /* A spin turns around the ground point, which is where the canvas hangs. */
    transform-origin: 0 0;
  }

  :root[data-motion="reduce"] .actor {
    will-change: auto;
  }

  canvas {
    display: block;
  }
</style>

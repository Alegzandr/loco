<script lang="ts">
  import type { Weather } from './sky'
  import { graphicsPref } from '../../hooks/uiPrefs.svelte'
  import { DRIFT_S, FALL_S, LEAN_DEG, SPLASH_S, SWAY, TILES, sheetStyle, tileUrl, type TileKind } from './weatherTiles'

  /**
   * What falls, drifts or flashes over a rendered room. Every layer is one
   * drawn tile (`weatherTiles.ts`) under one transform animation, so the
   * weather costs the board nothing per frame: the rain is three sheets of
   * streaks sliding down at three speeds behind a skew that leans them into
   * the wind, the snow three sheets of soft flakes falling and swaying, the fog
   * two sheets of haze drifting against each other under a vertical veil, the
   * storm the rain plus a sheet flash and a bolt's glow every few seconds.
   * Nothing here goes through reactive state and nothing is a particle system.
   *
   * **A layer travels exactly one tile per cycle.** The tile is what the layer
   * is painted with, so a cycle that is not a whole tile lands the pattern
   * somewhere else than it left and the weather jumps once a cycle. Both are
   * one number here: `tiled()` writes the tile as the background and as
   * `--tile-w` / `--tile-h`, and the keyframes below travel by those.
   *
   * **The wind is a skew, never a diagonal travel.** A streak leaning ten
   * degrees has to fall along its own lean or it reads as a drawn line sliding
   * down the screen; but a diagonal translation only wraps when both legs are
   * whole tiles, which pins the angle to the tile's shape. Skewing the sheet
   * instead maps a vertical travel inside it onto the lean outside it, and
   * the tile keeps wrapping vertically as before.
   *
   * **A sheet covers the frame for the whole of its travel, at any size.** Its
   * box is `sheetBox` (`weatherTiles.ts`), written inline by `tiled()`: one
   * tile of overhang in the direction it travels, the lean's reach in the
   * frame's *height* on the left of the rain, the sway's either side of the
   * snow. A percentage of the frame is never enough, because a tile is not one.
   *
   * How many sheets there are is the graphics tier's to say: rain and snow
   * three on `high`, two on `medium`, one on `light`; fog two, two and one. Under reduced motion every layer holds
   * its first frame: the rain is still rain, drawn as streaks that do not
   * move, which is the readable static state motion is required to degrade
   * to.
   */
  type Props = {
    weather: Weather
    /** No precipitation: a storm is the flash and a drift of dust. */
    dry?: boolean
    /**
     * Where the drops do not land: a CSS mask over the splash rings, the felt
     * cut out of it (`SceneBackdrop`). The rings are the ground's; laid over
     * the table they read as a pattern printed on the cloth.
     */
    clear?: string
  }
  let { weather, dry = false, clear = '' }: Props = $props()

  const tier = $derived(graphicsPref.tier)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? Math.min(2, devicePixelRatio) : 1

  const rainKinds = $derived<TileKind[]>(
    tier === 'high' ? ['rainFar', 'rainMid', 'rainNear'] : tier === 'medium' ? ['rainFar', 'rainMid'] : ['rainMid'],
  )
  const snowKinds = $derived<TileKind[]>(
    tier === 'high' ? ['snowFar', 'snowMid', 'snowNear'] : tier === 'medium' ? ['snowFar', 'snowMid'] : ['snowMid'],
  )
  const fogKinds = $derived<TileKind[]>(tier === 'light' ? ['fogA'] : ['fogB', 'fogA'])
  /** Where the drops land: two sheets of rings on `high`, one on `medium`, none on `light`. */
  const splashKinds = $derived<TileKind[]>(tier === 'high' ? ['splashA', 'splashB'] : tier === 'medium' ? ['splashA'] : [])

  /**
   * The inline style of a tiled layer: its tile as the background and as the
   * distance one cycle travels, and the seconds the cycle takes.
   */
  function tiled(kind: TileKind, leanDeg = 0): string {
    const t = TILES[kind]
    const cycle = FALL_S[kind] ?? DRIFT_S[kind] ?? SPLASH_S[kind] ?? 1
    const sway = SWAY[kind]
    return [
      `background-image: url("${tileUrl(kind, dpr)}")`,
      `--tile-w: ${t.w}px`,
      `--tile-h: ${t.h}px`,
      `--cycle: ${cycle}s`,
      sheetStyle(kind, leanDeg),
      sway ? `--sway-px: ${sway.px}px; --sway-s: ${sway.s}s` : '',
    ]
      .filter(Boolean)
      .join('; ')
  }

  /** The far layers start part-way through their cycle, so three sheets never line up. */
  const phase = (i: number) => `animation-delay: ${(-0.37 * (i + 1)).toFixed(2)}s`

  const lean = $derived(weather === 'storm' ? LEAN_DEG.storm : LEAN_DEG.rain)
</script>

<div class="weather" data-weather={weather} data-tier={tier} aria-hidden="true">
  {#if weather === 'rain' || (weather === 'storm' && !dry)}
    <!-- The sheets lean into the wind together, a little more in a storm. -->
    <div class="wind" style="--lean: {lean}deg">
      {#each rainKinds as kind, i (kind)}
        <div class="sheet fall {kind}" style="{tiled(kind, lean)}; {phase(i)}"></div>
      {/each}
    </div>
    <!-- Rain in the air: a faint haze thickening towards the ground, where the
         streaks bounce. Static, so it costs one layer and no animation. -->
    <div class="mist"></div>
    <!-- Where the drops land: rings on the ground, coming and going in place.
         They rest at nothing, so reduced motion keeps the rain and loses them. -->
    {#each splashKinds as kind, i (kind)}
      <div class="sheet splash {kind}" style="{tiled(kind)}; {phase(i)}{clear ? `; mask-image: ${clear}; -webkit-mask-image: ${clear}` : ''}"></div>
    {/each}
  {/if}
  {#if weather === 'storm' && dry}
    <div class="sheet drift dust" style={tiled('dust')}></div>
  {/if}
  {#if weather === 'storm'}
    <div class="bolt"></div>
    <div class="flash"></div>
  {/if}
  {#if weather === 'snow'}
    {#each snowKinds as kind, i (kind)}
      <!-- Two transforms on two elements: the outer sways, the inner falls.
           One element could not carry both without the fall's keyframes
           owning the sway too. -->
      <div class="sway" style="--sway-px: {SWAY[kind]?.px ?? 0}px; --sway-s: {SWAY[kind]?.s ?? 1}s; {phase(i)}">
        <div class="sheet fall {kind}" style="{tiled(kind)}; {phase(i)}"></div>
      </div>
    {/each}
  {/if}
  {#if weather === 'fog'}
    <!-- The veil: heavier towards the top of the frame, the far side of the
         room. The render already carries distance fog; this is its breath. -->
    <div class="veil"></div>
    {#each fogKinds as kind, i (kind)}
      <div class="sheet drift {kind}" class:driftBack={i === 0 && fogKinds.length > 1} style={tiled(kind)}></div>
    {/each}
  {/if}
  {#if weather === 'cloudy'}
    <div class="sheet drift cloud" style={tiled('cloud')}></div>
  {/if}
</div>

<style>
  .weather {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    /* Above both of the backdrop's frames, which stack at 1 and 2 so a new
       render can be brought up over the one it replaces, and above the life
       layer at 3: the rain falls on the boat, not under it. */
    z-index: 4;
    /* The frame's size is what a sheet's overhang is measured in (`cqh` in
       `sheetBox`): the lean's reach is a share of the height, whatever the
       width. */
    container-type: size;
  }

  /* A sheet is laid out by `sheetBox`, written inline by `tiled()`: larger
     than the frame by exactly what its travel, its lean and its sway need, so
     no edge ever shows at any size. `will-change` pins it to its own
     compositor layer, which is the whole point while it moves. */
  .sheet {
    position: absolute;
    background-repeat: repeat;
    /* The tile, as written by `tiled()`: the one size the keyframes travel. */
    background-size: var(--tile-w) var(--tile-h);
    will-change: transform;
  }

  .fall {
    animation: fall var(--cycle) linear infinite;
  }

  .drift {
    animation: drift var(--cycle) linear infinite;
  }

  .driftBack {
    animation-direction: reverse;
  }

  @keyframes fall {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(0, var(--tile-h), 0);
    }
  }

  .splash {
    opacity: 0;
    will-change: opacity;
    animation: splash var(--cycle) linear infinite;
  }

  @keyframes splash {
    0% {
      opacity: 0;
    }
    12% {
      opacity: 0.9;
    }
    55%,
    100% {
      opacity: 0;
    }
  }

  @keyframes drift {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(calc(-1 * var(--tile-w)), 0, 0);
    }
  }

  /* ─── Rain ─────────────────────────────────────────────────────────────── */

  /* The lean, around the bottom edge: the top slides right by H × tan(lean),
     and each sheet's left overhang (`sheetBox`) is that much, so the top-left
     corner is still under rain on a portrait phone. `--lean` is `LEAN_DEG`. */
  .wind {
    position: absolute;
    inset: 0;
    transform: skewX(calc(-1 * var(--lean)));
    transform-origin: 50% 100%;
  }

  .rainNear {
    opacity: 0.85;
  }
  .rainMid {
    opacity: 0.8;
  }
  .rainFar {
    opacity: 0.7;
  }

  .mist {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(200, 214, 236, 0) 0%, rgba(200, 214, 236, 0) 58%, rgba(200, 214, 236, 0.1) 84%, rgba(210, 222, 240, 0.18) 100%);
  }

  /* ─── Snow ─────────────────────────────────────────────────────────────── */

  .sway {
    position: absolute;
    inset: 0;
    will-change: transform;
    animation: sway var(--sway-s) ease-in-out infinite alternate;
  }

  @keyframes sway {
    from {
      transform: translate3d(calc(-1 * var(--sway-px)), 0, 0);
    }
    to {
      transform: translate3d(var(--sway-px), 0, 0);
    }
  }

  .snowFar {
    opacity: 0.75;
  }

  /* ─── Fog ──────────────────────────────────────────────────────────────── */

  /* A fog is the colour of the light in it: pale by day, the sky's own blue
     after dark. A white veil at midnight turned the night into a milky noon
     and put out every lamp under it. */
  .veil {
    --fog: color-mix(in srgb, var(--sky-horizon, #ebf0f6) calc(var(--scene-dark, 0) * 75%), rgb(235, 240, 246));
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--fog) 32%, transparent) 0%,
      color-mix(in srgb, var(--fog) 14%, transparent) 40%,
      color-mix(in srgb, var(--fog) 5%, transparent) 75%,
      color-mix(in srgb, var(--fog) 2%, transparent) 100%
    );
  }

  /* The banks are drawn white: after dark they thin rather than glow. */
  .fogA {
    opacity: calc(1 - 0.5 * var(--scene-dark, 0));
  }

  .fogB {
    opacity: calc(0.7 * (1 - 0.5 * var(--scene-dark, 0)));
  }

  /* ─── Storm ────────────────────────────────────────────────────────────── */

  /* Dust on the wind: specks drifting sideways, for a storm on a world with
     nothing to rain. */
  .dust {
    opacity: 0.5;
  }

  /* Lightning is two things: a sheet that lights the whole frame for a frame
     or two, and the glow of the bolt itself, off one top corner, that lingers
     a little longer. Two flashes close together, then a lone one, every
     seventeen seconds, which is how lightning actually reads; and never
     brighter than a third on the sheet, because the cards on top still have
     to win. */
  .flash {
    position: absolute;
    inset: 0;
    background: rgba(236, 240, 255, 1);
    opacity: 0;
    animation: lightning 17s linear infinite;
  }

  .bolt {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(38% 46% at 18% -6%, rgba(220, 228, 255, 0.9) 0%, rgba(220, 228, 255, 0.3) 40%, rgba(220, 228, 255, 0) 100%),
      radial-gradient(30% 40% at 78% -4%, rgba(220, 228, 255, 0.6) 0%, rgba(220, 228, 255, 0) 100%);
    opacity: 0;
    animation: bolt 17s linear infinite;
  }

  @keyframes lightning {
    0%,
    30.4%,
    31.6%,
    32.2%,
    33.4%,
    73.6%,
    74.8%,
    100% {
      opacity: 0;
    }
    30.8% {
      opacity: 0.3;
    }
    31.2% {
      opacity: 0.08;
    }
    32.8% {
      opacity: 0.24;
    }
    74.2% {
      opacity: 0.2;
    }
  }

  @keyframes bolt {
    0%,
    30.4%,
    35%,
    73.6%,
    77%,
    100% {
      opacity: 0;
    }
    30.8% {
      opacity: 0.9;
    }
    31.4% {
      opacity: 0.35;
    }
    32.8% {
      opacity: 0.7;
    }
    74.2% {
      opacity: 0.6;
    }
  }

  /* ─── Overcast ─────────────────────────────────────────────────────────── */

  .cloud {
    opacity: 0.9;
  }

  /* ─── Reduced motion ───────────────────────────────────────────────────── */

  :root[data-motion="reduce"] .sheet,
  :root[data-motion="reduce"] .sway {
    animation: none;
    /* A layer that never moves is a layer the compositor keeps for nothing. */
    will-change: auto;
  }

  /* No flash at all under reduced motion: a full-frame flicker is the one
     thing the preference exists to refuse. */
  :root[data-motion="reduce"] .flash,
  :root[data-motion="reduce"] .bolt {
    display: none;
  }
</style>

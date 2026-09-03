<script lang="ts">
  import type { Weather } from './sky'
  import { graphicsPref } from '../../hooks/uiPrefs.svelte'
  import { DRIFT_S, FALL_S, SWAY, TILES, tileUrl, type TileKind } from './weatherTiles'

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
   * How many sheets there are is the graphics tier's to say: three on `high`,
   * two on `medium`, one on `light`. Under reduced motion every layer holds
   * its first frame: the rain is still rain, drawn as streaks that do not
   * move, which is the readable static state motion is required to degrade
   * to.
   */
  type Props = {
    weather: Weather
    /** No precipitation: a storm is the flash and a drift of dust. */
    dry?: boolean
  }
  let { weather, dry = false }: Props = $props()

  const tier = $derived(graphicsPref.tier)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? Math.min(2, devicePixelRatio) : 1

  const rainKinds = $derived<TileKind[]>(
    tier === 'high' ? ['rainFar', 'rainMid', 'rainNear'] : tier === 'medium' ? ['rainFar', 'rainMid'] : ['rainMid'],
  )
  const snowKinds = $derived<TileKind[]>(
    tier === 'high' ? ['snowFar', 'snowMid', 'snowNear'] : tier === 'medium' ? ['snowFar', 'snowMid'] : ['snowMid'],
  )
  const fogKinds = $derived<TileKind[]>(tier === 'light' ? ['fogA'] : ['fogB', 'fogA'])

  /**
   * The inline style of a tiled layer: its tile as the background and as the
   * distance one cycle travels, and the seconds the cycle takes.
   */
  function tiled(kind: TileKind): string {
    const t = TILES[kind]
    const cycle = FALL_S[kind] ?? DRIFT_S[kind] ?? 1
    const sway = SWAY[kind]
    return [
      `background-image: url("${tileUrl(kind, dpr)}")`,
      `--tile-w: ${t.w}px`,
      `--tile-h: ${t.h}px`,
      `--cycle: ${cycle}s`,
      sway ? `--sway-px: ${sway.px}px; --sway-s: ${sway.s}s` : '',
    ]
      .filter(Boolean)
      .join('; ')
  }

  /** The far layers start part-way through their cycle, so three sheets never line up. */
  const phase = (i: number) => `animation-delay: ${(-0.37 * (i + 1)).toFixed(2)}s`
</script>

<div class="weather" data-weather={weather} data-tier={tier} aria-hidden="true">
  {#if weather === 'rain' || (weather === 'storm' && !dry)}
    <!-- The sheets lean into the wind together, a little more in a storm. -->
    <div class="wind" class:windStorm={weather === 'storm'}>
      {#each rainKinds as kind, i (kind)}
        <div class="sheet fall {kind}" style="{tiled(kind)}; {phase(i)}"></div>
      {/each}
    </div>
    <!-- Rain in the air: a faint haze thickening towards the ground, where the
         streaks bounce. Static, so it costs one layer and no animation. -->
    <div class="mist"></div>
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
  }

  /* A sheet is drawn taller and wider than the frame and slid so its travel —
     one tile down or one tile across — never shows an edge. `will-change` pins
     it to its own compositor layer, which is the whole point. */
  .sheet {
    position: absolute;
    left: -25%;
    top: -100%;
    width: 150%;
    height: 200%;
    background-repeat: repeat;
    /* The tile, as written by `tiled()`: the one size the keyframes travel. */
    background-size: var(--tile-w) var(--tile-h);
    will-change: transform;
  }

  .fall {
    animation: fall var(--cycle) linear infinite;
  }

  .drift {
    left: -100%;
    top: -10%;
    width: 300%;
    height: 120%;
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

  @keyframes drift {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(calc(-1 * var(--tile-w)), 0, 0);
    }
  }

  /* ─── Rain ─────────────────────────────────────────────────────────────── */

  /* The lean. Wider than the frame by the skew's reach so the top corners are
     still under rain. */
  .wind {
    position: absolute;
    inset: 0;
    transform: skewX(-9deg);
    transform-origin: 50% 100%;
  }

  .windStorm {
    transform: skewX(-15deg);
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

  .veil {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(235, 240, 246, 0.32) 0%, rgba(235, 240, 246, 0.14) 40%, rgba(235, 240, 246, 0.05) 75%, rgba(235, 240, 246, 0.02) 100%);
  }

  .fogB {
    opacity: 0.7;
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
  }

  /* No flash at all under reduced motion: a full-frame flicker is the one
     thing the preference exists to refuse. */
  :root[data-motion="reduce"] .flash,
  :root[data-motion="reduce"] .bolt {
    display: none;
  }
</style>

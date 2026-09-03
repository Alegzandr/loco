<script lang="ts">
  import type { Weather } from './sky'

  /**
   * What falls, drifts or flashes over a rendered room. Pure CSS, every layer
   * a transform animation on a tiled gradient, so the weather costs the board
   * nothing per frame: the rain is one composited layer sliding down, the snow
   * three at three speeds, the fog a wide gradient drifting sideways, the storm
   * the rain plus a flash every few seconds. Nothing here goes through
   * reactive state and nothing is a particle system.
   *
   * Under reduced motion every layer holds its first frame: the rain is still
   * rain, drawn as streaks that do not move, which is the readable static
   * state motion is required to degrade to.
   */
  type Props = {
    weather: Weather
    /** No precipitation: a storm is the flash and a drift of dust. */
    dry?: boolean
  }
  let { weather, dry = false }: Props = $props()
</script>

<div class="weather" data-weather={weather} aria-hidden="true">
  {#if weather === 'rain' || (weather === 'storm' && !dry)}
    <div class="rain"></div>
    <div class="rain rainFar"></div>
  {/if}
  {#if weather === 'storm' && dry}
    <div class="fog fogBack dust"></div>
  {/if}
  {#if weather === 'storm'}
    <div class="flash"></div>
  {/if}
  {#if weather === 'snow'}
    <div class="snow"></div>
    <div class="snow snowMid"></div>
    <div class="snow snowFar"></div>
  {/if}
  {#if weather === 'fog'}
    <div class="fog"></div>
    <div class="fog fogBack"></div>
  {/if}
  {#if weather === 'cloudy'}
    <div class="cloudShade"></div>
  {/if}
</div>

<style>
  .weather {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Each falling layer is drawn twice as tall as the frame and slid up by half
     its height, so the tile repeats seamlessly. `will-change` pins it to its own
     compositor layer, which is the whole point. */
  .rain,
  .snow,
  .fog {
    position: absolute;
    left: -10%;
    top: -100%;
    width: 120%;
    height: 200%;
    will-change: transform;
  }

  .rain {
    background-image: repeating-linear-gradient(
      100deg,
      rgba(255, 255, 255, 0) 0 22px,
      rgba(220, 235, 255, 0.28) 22px 23px,
      rgba(255, 255, 255, 0) 23px 30px,
      rgba(220, 235, 255, 0.16) 30px 31px,
      rgba(255, 255, 255, 0) 31px 47px
    );
    background-size: 100% 240px;
    animation: rainFall 0.55s linear infinite;
    opacity: 0.85;
  }

  .rainFar {
    background-image: repeating-linear-gradient(
      98deg,
      rgba(255, 255, 255, 0) 0 35px,
      rgba(220, 235, 255, 0.14) 35px 36px,
      rgba(255, 255, 255, 0) 36px 61px
    );
    background-size: 100% 160px;
    animation-duration: 0.9s;
    opacity: 0.6;
  }

  @keyframes rainFall {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(-1.5%, 50%, 0);
    }
  }

  .snow {
    background-image:
      radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.95) 0 2.2px, transparent 3px),
      radial-gradient(circle at 44% 62%, rgba(255, 255, 255, 0.9) 0 2px, transparent 3px),
      radial-gradient(circle at 78% 30%, rgba(255, 255, 255, 0.95) 0 2.4px, transparent 3.4px),
      radial-gradient(circle at 63% 86%, rgba(255, 255, 255, 0.85) 0 1.8px, transparent 3px),
      radial-gradient(circle at 28% 92%, rgba(255, 255, 255, 0.9) 0 2px, transparent 3px),
      radial-gradient(circle at 90% 74%, rgba(255, 255, 255, 0.9) 0 2px, transparent 3px);
    background-size: 180px 180px;
    animation: snowFall 9s linear infinite;
  }

  .snowMid {
    background-size: 260px 260px;
    animation-duration: 14s;
    animation-delay: -4s;
    opacity: 0.8;
  }

  .snowFar {
    background-size: 340px 340px;
    animation-duration: 21s;
    animation-delay: -9s;
    opacity: 0.55;
  }

  @keyframes snowFall {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(4%, 50%, 0);
    }
  }

  /* The fog is a sheet of horizontal haze, heavier towards the top of the frame
     (the far side of the room), drifting sideways. The render already carries
     distance fog; this is the part of it that moves. */
  .fog {
    top: -20%;
    height: 140%;
    width: 200%;
    background:
      linear-gradient(180deg, rgba(235, 240, 246, 0.42) 0%, rgba(235, 240, 246, 0.14) 45%, rgba(235, 240, 246, 0.05) 100%),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0) 0 180px, rgba(255, 255, 255, 0.12) 180px 420px, rgba(255, 255, 255, 0) 420px 640px);
    animation: fogDrift 38s linear infinite;
  }

  .fogBack {
    animation-duration: 61s;
    animation-direction: reverse;
    opacity: 0.6;
  }

  /* Dust on the wind: the fog sheet, thinner and faster, for a storm on a
     world with nothing to rain. */
  .dust {
    opacity: 0.35;
    animation-duration: 18s;
  }

  @keyframes fogDrift {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(-50%, 0, 0);
    }
  }

  /* A storm's lightning: a white sheet, off nearly all the time. Two flashes
     close together every ten seconds, which is how lightning actually reads,
     and never brighter than a third: the cards on top still have to win. */
  .flash {
    position: absolute;
    inset: 0;
    background: rgba(236, 240, 255, 1);
    opacity: 0;
    animation: lightning 11s linear infinite;
  }

  @keyframes lightning {
    0%,
    62%,
    63.6%,
    64.4%,
    66%,
    100% {
      opacity: 0;
    }
    62.6% {
      opacity: 0.32;
    }
    63.2% {
      opacity: 0.08;
    }
    65% {
      opacity: 0.24;
    }
  }

  /* Overcast: a slow-moving cloud shadow across the ground. */
  .cloudShade {
    position: absolute;
    left: -50%;
    top: -20%;
    width: 200%;
    height: 140%;
    background: repeating-linear-gradient(
      75deg,
      rgba(0, 0, 0, 0) 0 300px,
      rgba(10, 14, 30, 0.14) 300px 620px,
      rgba(0, 0, 0, 0) 620px 900px
    );
    will-change: transform;
    animation: cloudDrift 52s linear infinite;
  }

  @keyframes cloudDrift {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(25%, 0, 0);
    }
  }

  :root[data-motion="reduce"] .rain,
  :root[data-motion="reduce"] .snow,
  :root[data-motion="reduce"] .fog,
  :root[data-motion="reduce"] .cloudShade {
    animation: none;
  }

  /* No flash at all under reduced motion: a full-frame flicker is the one
     thing the preference exists to refuse. */
  :root[data-motion="reduce"] .flash {
    display: none;
  }
</style>

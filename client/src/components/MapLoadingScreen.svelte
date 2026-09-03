<script lang="ts">
  import type { PlayerDTO } from '../types/protocol'
  import type { Translations } from '../i18n/en'
  import type { SceneSpec } from './cards/maps'
  import type { FeltAnchor } from './cards/layout'
  import { seatColor } from './playerColors'
  import SceneBackdrop from './scene/SceneBackdrop.svelte'

  type Props = {
    scene: SceneSpec
    /** Where the felt will be, so the render behind this screen carries the podium. */
    anchor: FeltAnchor
    /** Seats whose client has the room rendered, straight from the server. */
    ready: number[]
    players: PlayerDTO[]
    myIndex: number
    /** 0–1 across our own render. Ours only; the roster shows everyone else's. */
    progress: number
    t: Translations
  }

  let { scene, anchor, ready, players, myIndex, progress, t }: Props = $props()

  const copy = $derived(t.maps[scene.map.id])
  const moment = $derived(`${t.mapTimes[scene.time]} · ${t.mapWeathers[scene.weather]}`)
  const readySet = $derived(new Set(ready))
  const meReady = $derived(readySet.has(myIndex))
  const ordered = $derived([...players].sort((a, b) => a.index - b.index))
</script>

<!--
  The moment between "hands dealt" and "clock running".

  It exists because the wait is real (the engine's chunk, then a build and a
  draw of a few thousand blocks) and the honest place to spend it is here rather
  than in the first turn. Since the wait has to happen anyway, it may as well
  introduce the room: the name, the hour and the sky, and one line about it are
  what turn a progress bar into a reveal.

  The roster is the other half. A player staring at a bar cannot tell a slow
  machine from a hung game, and "we are waiting on Kiwi" is the difference
  between patience and a reload. It is also where the room earns its keep: the
  scene is on screen, sharp, as soon as it is rendered, so by the time the screen
  lifts the table underneath is fully painted.
-->
<div
  class="screen"
  style="--map-accent: {scene.map.accent}"
  role="status"
  aria-live="polite"
  data-testid="map-loading"
  data-map={scene.map.id}
  data-scene-time={scene.time}
  data-scene-weather={scene.weather}
>
  <SceneBackdrop {scene} {anchor} />
  <div class="scrim"></div>

  <div class="body">
    <div class="kicker">{t.mapLoadingTitle}</div>
    <!-- An h2, like every screen in the game: the page's own top-level heading is
         the one GamePage.astro serves. -->
    <h2 class="name">{copy.name}</h2>
    <div class="moment" data-testid="map-moment">{moment}</div>
    <p class="tagline">{copy.tagline}</p>

    <!-- Our own render. Deliberately separate from the roster below: this bar
         is the only thing on screen the player's own machine controls. -->
    <div class="track">
      <div class="fill" style="transform: scaleX({progress})"></div>
    </div>

    <div class="status">{meReady ? t.mapLoadingReady : t.mapLoadingWaiting}</div>

    <ul class="roster">
      {#each ordered as p (p.index)}
        <li class="seat" class:seatReady={readySet.has(p.index)} data-ready={readySet.has(p.index)}>
          <span
            class="dot"
            style="background: {readySet.has(p.index) ? seatColor(p.index) : 'transparent'}"
          ></span>
          <span class="seatName">{p.nickname}</span>
        </li>
      {/each}
    </ul>

    <div class="count">
      {t.mapLoadingCount
        .replace('%ready', String(readySet.size))
        .replace('%total', String(players.length))}
    </div>
  </div>
</div>

<style>
  /* Full-bleed, opaque, and the only thing on screen: the board is mounted behind
     it and finishing its layout, which is the point. */

  .screen {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: grid;
    place-items: center;
    /* The reveal is full-bleed, its copy is not: the roster is the part that
       answers "is this a slow machine or a hung game", so it may not slide under
       the home indicator. */
    padding: calc(var(--safe-top)) calc(var(--safe-right)) calc(var(--safe-bottom))
      calc(var(--safe-left));
    background-color: var(--room-void);
    /* The room fades up as it renders, so the wait shows itself finishing
       rather than snapping in at the end. */
    animation: mapRoomIn 0.6s var(--ease-out) both;
    text-align: center;
  }

  @keyframes mapRoomIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The backdrop is a picture and the copy is type, so the name needs
     something to sit on. Deliberately light: this screen exists to *show* the
     room, and a scrim heavy enough to make type effortless turns the reveal back
     into the plain loading bar it replaced. The name carries its own ink outline
     instead, which is what the rest of this UI does with type on colour. */
  .scrim {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(52% 44% at 50% 48%, rgba(4, 3, 12, 0.62) 0%, rgba(4, 3, 12, 0) 100%),
      linear-gradient(
        180deg,
        rgba(4, 3, 12, 0.34) 0%,
        rgba(4, 3, 12, 0) 30%,
        rgba(4, 3, 12, 0) 66%,
        rgba(4, 3, 12, 0.5) 100%
      );
  }

  .body {
    position: relative;
    width: min(560px, calc(100vw - 48px));
    text-align: center;
    color: var(--color-on-dark);
    animation: mapCopyIn 0.5s var(--ease-out) 0.12s both;
  }

  @keyframes mapCopyIn {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .kicker {
    font: 700 12px/1.2 var(--font-display);
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: var(--map-accent, #ffffff);
    text-shadow: 0 2px 10px rgba(4, 3, 12, 0.95);
  }

  .name {
    margin: 8px 0 0;
    font: 700 clamp(44px, 9vw, 76px) / 1 var(--font-display);
    letter-spacing: -1px;
    /* Ink outline, like every other raised object in this UI. The name sits on a
       picture, so it cannot rely on the background staying dark behind it.
       Two hard offsets plus a wide soft halo: the halo alone disappears against a
       lantern, and the offsets alone disappear against a shadow. */
    -webkit-text-stroke: 3px rgba(4, 3, 12, 0.75);
    paint-order: stroke fill;
    text-shadow:
      0 4px 0 rgba(4, 3, 12, 0.5),
      0 0 46px rgba(4, 3, 12, 0.9),
      0 0 34px color-mix(in srgb, var(--map-accent, #ffffff) 55%, transparent);
  }

  /* The hour and the sky, as a plate under the name: it is the one line on this
     screen that changes from match to match in the same room, so it is set
     apart from the tagline rather than folded into it. */
  .moment {
    display: inline-block;
    margin-top: 10px;
    padding: 5px 14px;
    border-radius: var(--radius-full);
    border: 2px solid rgba(255, 255, 255, 0.22);
    background: rgba(10, 8, 22, 0.55);
    font: 700 13px/1.2 var(--font-display);
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--color-on-dark);
    text-shadow: 0 2px 10px rgba(4, 3, 12, 0.95);
  }

  .tagline {
    margin: 12px auto 0;
    max-width: 44ch;
    font: 500 16px/1.5 var(--font-body);
    color: rgba(255, 255, 255, 0.88);
    text-shadow: 0 2px 12px rgba(4, 3, 12, 0.95);
  }

  /* Our own render. A real measurement, not a fake timer: it is the one number
     on this screen the player's own machine is responsible for. */
  .track {
    margin: 30px auto 0;
    width: min(340px, 100%);
    height: 6px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.14);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    transform-origin: left center;
    background: var(--map-accent, #ffffff);
    box-shadow: 0 0 16px color-mix(in srgb, var(--map-accent, #ffffff) 70%, transparent);
    transition: transform 0.4s var(--ease-out);
  }

  .status {
    margin-top: 14px;
    font: 600 14px/1.3 var(--font-body);
    color: rgba(255, 255, 255, 0.8);
    text-shadow: 0 2px 10px rgba(4, 3, 12, 0.95);
    min-height: 18px;
  }

  /* Who the table is still waiting on. Without it a player cannot tell a slow
     machine from a hung game, which is the difference between waiting and
     reloading. */
  .roster {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 22px 0 0;
    padding: 0;
    list-style: none;
  }

  .seat {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 14px 7px 10px;
    border-radius: var(--radius-full);
    border: 2px solid rgba(255, 255, 255, 0.14);
    background: rgba(10, 8, 22, 0.55);
    font: 600 14px/1 var(--font-display);
    /* 0.72, not 0.5: the plate is translucent over a picture, and at half
       white a name still loading sat under 3:1 on any bright patch of the room.
       Same shadow as `.status` for the same reason — nothing on this screen may
       rely on the picture staying dark behind it. */
    color: rgba(255, 255, 255, 0.72);
    text-shadow: 0 2px 10px rgba(4, 3, 12, 0.95);
    transition:
      color 0.3s ease,
      border-color 0.3s ease,
      background 0.3s ease;
  }

  .seatReady {
    color: var(--color-on-dark);
    border-color: rgba(255, 255, 255, 0.38);
    background: rgba(22, 18, 42, 0.72);
  }

  /* Empty ring while loading, filled with the seat's own identity colour once in:
     the same colour that player carries on the board and the scoreboard. */
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    transition: background 0.3s ease;
  }

  .seatReady .dot {
    border-color: transparent;
  }

  .seatName {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-top: 16px;
    font: 600 13px/1.3 var(--font-body);
    color: rgba(255, 255, 255, 0.6);
    text-shadow: 0 2px 10px rgba(4, 3, 12, 0.95);
  }

  @media (max-width: 480px) {
    .name {
      font-size: clamp(38px, 13vw, 54px);
    }
    .tagline {
      font-size: 15px;
    }
    .roster {
      gap: 6px;
    }
    .seat {
      padding: 6px 12px 6px 9px;
      font-size: 13px;
    }
  }

  /* The bar is the only place the remaining work is written down, so it keeps its
     transition, the same exception the countdown bars take. The entrance animations
     do collapse, which is what the blanket rule in tokens.css already does. */
  :root[data-motion="reduce"] .fill {
    transition-duration: 0.01ms !important;
  }
</style>

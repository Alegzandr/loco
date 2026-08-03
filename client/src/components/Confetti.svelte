<script lang="ts">
  type Props = {
    /** Number of pieces. Kept modest: this runs on phones too. */
    count?: number
  }

  let { count = 60 }: Props = $props()

  const COLORS = ['#ff3d68', '#ffc93c', '#17b877', '#2b7fff', '#6c5cff', '#ff5cc8']

  // Randomised once, in the script body, which runs on mount and never again.
  // Re-randomising on an update would restart every piece's animation, so the
  // burst would stutter instead of falling.
  const pieces = Array.from({ length: count }, (_, i) => {
    const size = 7 + Math.random() * 9
    const round = Math.random() < 0.3
    return {
      left: Math.random() * 100,
      delay: Math.random() * 2.4,
      duration: 2.6 + Math.random() * 2.2,
      drift: (Math.random() - 0.5) * 220,
      spin: 360 + Math.random() * 900,
      size,
      height: round ? size : size * 1.6,
      color: COLORS[i % COLORS.length],
      round,
    }
  })
</script>

<!--
  Confetti burst for the victory screen.

  Pure CSS: every piece is one absolutely-positioned span animating `transform`
  and `opacity`, so the whole burst stays on the compositor and costs no
  JavaScript per frame.
-->
<div class="layer" aria-hidden="true">
  {#each pieces as p, i (i)}
    <span
      class="piece"
      class:round={p.round}
      style="left: {p.left}%; width: {p.size}px; height: {p.height}px; background: {p.color}; animation-delay: {p.delay}s; animation-duration: {p.duration}s; --drift: {p.drift}px; --spin: {p.spin}deg"
    ></span>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 60;
  }

  .piece {
    position: absolute;
    top: -8%;
    border-radius: 2px;
    will-change: transform, opacity;
    animation-name: fall;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
  }

  .round {
    border-radius: 50%;
  }

  @keyframes fall {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(0deg);
    }
    8% {
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--drift, 0px), 108vh, 0) rotate(var(--spin, 540deg));
    }
  }

  /* Falling debris is exactly the kind of motion reduced-motion users opt out of. */
  :root[data-motion="reduce"] .layer {
    display: none;
  }
</style>

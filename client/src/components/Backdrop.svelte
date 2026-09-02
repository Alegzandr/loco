<script lang="ts">
  /**
   * What the entry screens sit on.
   *
   * The canvas behind the home, the queue, the reveal and the waiting room was
   * one flat colour, and a flat colour under a card game is a form under a
   * form. This is the room the cards live in before the deal: four very soft
   * lights in the suit hues drifting over the ground, and a few cards lying in
   * it, face down, turning slowly. Nothing here is a control and nothing here
   * competes with one — the lights are at a fraction of their hue, the cards
   * at a fraction of the ink, and both move at the pace of weather.
   *
   * Compositor only: every motion is a transform on a layer rasterised once
   * (the blur is static, and the element that carries it never changes size).
   * Under reduced motion it holds a still composition, which is the readable
   * state and still a room rather than a colour.
   */
  const LIGHTS = [
    { x: 12, y: 18, size: 46, hue: 'var(--color-primary)', dur: 26, delay: 0 },
    { x: 78, y: 12, size: 40, hue: 'var(--color-tertiary)', dur: 31, delay: -9 },
    { x: 84, y: 76, size: 44, hue: 'var(--color-secondary)', dur: 29, delay: -17 },
    { x: 18, y: 82, size: 38, hue: 'var(--color-mint)', dur: 34, delay: -5 },
  ] as const

  const CARDS = [
    { x: 8, y: 22, rot: -18, scale: 1, dur: 22, delay: -3 },
    { x: 90, y: 30, rot: 14, scale: 0.8, dur: 27, delay: -11 },
    { x: 22, y: 70, rot: 9, scale: 0.7, dur: 24, delay: -7 },
    { x: 74, y: 84, rot: -11, scale: 0.9, dur: 30, delay: -15 },
    { x: 50, y: 92, rot: 24, scale: 0.6, dur: 26, delay: -1 },
    { x: 94, y: 58, rot: -6, scale: 0.65, dur: 33, delay: -20 },
    { x: 4, y: 50, rot: 31, scale: 0.75, dur: 28, delay: -13 },
  ] as const
</script>

<div class="backdrop" aria-hidden="true">
  {#each LIGHTS as l, i (i)}
    <div
      class="light"
      style="left: {l.x}%; top: {l.y}%; width: {l.size}vmax; height: {l.size}vmax; --hue: {l.hue}; --dur: {l.dur}s; --delay: {l.delay}s"
    ></div>
  {/each}
  {#each CARDS as c, i (i)}
    <div
      class="cardShape"
      style="left: {c.x}%; top: {c.y}%; --rot: {c.rot}deg; --scale: {c.scale}; --dur: {c.dur}s; --delay: {c.delay}s"
    ></div>
  {/each}
</div>

<style>
  /* Behind the screen's own content and above the canvas: the host screen is
     a stacking context (`isolation: isolate` on its container), so -1 lands
     between its transparent background and everything it draws. At 0 the
     cards floated over the buttons. */
  .backdrop {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  }

  .light {
    position: absolute;
    border-radius: var(--radius-full);
    /* A soft light, not a shape: the gradient fades to nothing well inside its
       own box, so the edge of the element is never seen. */
    background: radial-gradient(
      circle at center,
      color-mix(in srgb, var(--hue) 34%, transparent) 0%,
      color-mix(in srgb, var(--hue) 12%, transparent) 40%,
      transparent 70%
    );
    transform: translate(-50%, -50%);
    will-change: transform;
    animation: drift var(--dur) ease-in-out var(--delay) infinite alternate;
  }

  @keyframes drift {
    from {
      transform: translate(-50%, -50%) translate(-6vmax, 4vmax) scale(0.94);
    }
    to {
      transform: translate(-50%, -50%) translate(6vmax, -5vmax) scale(1.08);
    }
  }

  /* A card lying in the room: the deck's own proportions and corner, in ink at
     a whisper, turning as slowly as it drifts. */
  .cardShape {
    position: absolute;
    /* Sized to the screen, so a phone's room holds small cards and a monitor's
       holds a hand-sized one; never larger than a real card. */
    width: clamp(40px, 6vmin, 72px);
    height: clamp(60px, 9vmin, 108px);
    border-radius: 7px;
    border: 2px solid color-mix(in srgb, var(--color-ink) 9%, transparent);
    background: color-mix(in srgb, var(--color-ink) 3%, transparent);
    transform: translate(-50%, -50%) rotate(var(--rot)) scale(var(--scale));
    will-change: transform;
    animation: float var(--dur) ease-in-out var(--delay) infinite alternate;
  }

  @keyframes float {
    from {
      transform: translate(-50%, -50%) translateY(2vh) rotate(calc(var(--rot) - 6deg)) scale(var(--scale));
    }
    to {
      transform: translate(-50%, -50%) translateY(-2vh) rotate(calc(var(--rot) + 6deg)) scale(var(--scale));
    }
  }

  :root[data-motion='reduce'] .light,
  :root[data-motion='reduce'] .cardShape {
    animation: none;
    will-change: auto;
  }
</style>

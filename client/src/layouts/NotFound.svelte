<script lang="ts">
  // Served by nginx for anything that is not a page (error_page 404 /404.html),
  // and rendered by the dev server for the same misses (src/routes/+error.svelte).
  //
  // A real 404, not the app behind a catch-all: answering 200 with the game for
  // an unknown URL is a soft 404, which Google reports as an error and which hides
  // broken links from everyone else.
  //
  // It is the one page of this site a visitor reaches by accident, so it is drawn
  // like the game rather than like an error console: a hand of face-down cards
  // nobody was dealt, the code set the way a card glyph is set, and one way back
  // to a table. <LocoLogo /> and <CardBack /> are the game's own components,
  // prerendered into the file — the mark and the deck back here are the ones on
  // the board — and the page ships no JavaScript at all (`csr = false` on its
  // route): it is served at whatever address was missed, where the router would
  // have nothing to say.
  import Head from './Head.svelte'
  import LocoLogo from '../components/LocoLogo.svelte'
  import CardBack from '../components/cards/CardBack.svelte'
  import type { PageDef } from '../seo/meta'

  // Not in PAGES: it is noindex, so it belongs to neither the sitemap nor the
  // hreflang graph. The shape is only here to reuse the shared <head>.
  const page: PageDef = {
    id: '404',
    path: { en: '/404.html', fr: '/404.html' },
    title: { en: 'LOCO! · Nothing at this address', fr: 'LOCO! · Rien à cette adresse' },
    description: {
      en: 'This page does not exist. The tables are this way.',
      fr: 'Cette page n’existe pas. Les tables sont par ici.',
    },
  }

  // The fan, as angles. Four backs on an arc wide enough to show past the code
  // on both sides; the pivot that turns these into a hand is in the CSS.
  const FAN = ['-24deg', '-8deg', '8deg', '24deg']
</script>

<Head {page} lang="en" noindex />

<main class="page">
  <!--
    The mark is the second way out and the only thing on the page that says
    whose site this is. It names itself (role="img" + aria-label="LOCO!"), so
    the link needs no label of its own.
  -->
  <a class="brand" href="/" data-sveltekit-reload><LocoLogo size="1.5rem" /></a>

  <div class="stage">
    <!--
      Decorative: the heading under it says what happened, and four card backs
      announced one by one would say nothing at all.
    -->
    <div class="fan" aria-hidden="true">
      {#each FAN as r (r)}
        <span class="card" style={`--r:${r}`}><CardBack width={104} height={156} /></span>
      {/each}
    </div>

    <!--
      Drawn like a glyph on a card: off-white filled, ink outlined, ledge
      underneath. The Outline Rule is what carries it on the canvas, exactly
      as it carries a 9 on a green card.
    -->
    <p class="code" aria-hidden="true">404</p>
  </div>

  <h1>Nothing at this address</h1>
  <p class="lede">This page does not exist. Nothing is lost: a table takes ten seconds.</p>

  <div class="actions">
    <a class="btn play" href="/" data-sveltekit-reload>Play</a>
    <a class="btn quiet" href="/fr/" hreflang="fr" lang="fr" data-sveltekit-reload>En français</a>
  </div>
</main>

<style>
  /* Deliberately self-contained: this page is served when something is already
     wrong, so it must not depend on anything the build might not have emitted.
     Every colour is a token from tokens.css, which the root layout carries, and the
     two components above bring their own scoped rules with them. */
  .page {
    /* The canvas, flat — which is what the site actually shows. `body` carries a
       candy gradient and three colour orbs, and nothing on this site paints
       them: the game covers them with `#root` (tokens.css paints it
       `--color-canvas`) and a content page flattens them with `body.doc`, the
       landings being flat by decision. This page has neither, so it was the
       one screen in the product wearing a backdrop of its own. */
    background: var(--color-canvas);
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: calc(var(--space-xl) + var(--safe-top)) var(--space-lg)
      calc(var(--space-xl) + var(--safe-bottom));
    text-align: center;
  }

  /* Top-left, out of the column: it is a way home, not part of the message. */
  .brand {
    position: absolute;
    top: calc(var(--space-lg) + var(--safe-top));
    left: calc(var(--space-lg) + var(--safe-left));
    text-decoration: none;
  }

  /* ── The hand nobody was dealt ─────────────────────────────────────────── */

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    /* The fan is absolutely positioned and arcs above the code, so the space it
       needs is reserved here rather than measured from it. */
    margin-bottom: clamp(var(--space-base), 2.5vw, var(--space-lg));
    padding-top: clamp(52px, 11vw, 96px);
  }

  .fan {
    position: absolute;
    left: 50%;
    top: calc(50% - 12px);
    /* One number scales the whole hand, so the cards keep their own drawing at
       every width instead of being re-sized card by card. */
    transform: scale(var(--fan-scale, 1));
  }

  /* The pivot is far below the card, which is what turns four rotations into a
     hand rather than four tilted rectangles. */
  .card {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 50% 470px;
    transform: translate(-50%, -50%) rotate(var(--r));
  }

  .code {
    position: relative;
    font: 700 clamp(4.75rem, 16vw, 8.75rem) / 0.9 var(--font-display);
    letter-spacing: 0.01em;
    /* Card-glyph paint: off-white over ink. A card is a physical object, and so
       is the code drawn like one. */
    color: #efefef;
    -webkit-text-stroke: 0.055em var(--color-stroke);
    paint-order: stroke fill;
    text-shadow:
      0 0.055em 0 var(--color-stroke),
      0 0.11em 0 rgba(36, 21, 70, 0.35),
      0 0.2em 0.24em rgba(20, 8, 45, 0.32);
    transform: rotate(-3deg);
  }

  /* ── The message ───────────────────────────────────────────────────────── */

  h1 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: clamp(1.6rem, 5.2vw, 2.4rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .lede {
    max-width: 34rem;
    margin-top: var(--space-sm);
    font-size: 1.0625rem;
    color: var(--color-body);
  }

  /* ── The two ways out ──────────────────────────────────────────────────── */

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-md);
    margin-top: var(--space-xl);
  }

  /* Both are bodies with an ink outline and a ledge, and both travel into that
     ledge on press: a link that leaves this page is a control like any other in
     the game, not a blue word. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    padding: 0 var(--space-lg);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    font: 600 1.125rem / 1 var(--font-display);
    text-decoration: none;
    transition:
      transform 140ms var(--ease-bounce),
      box-shadow 140ms var(--ease-bounce),
      filter 140ms ease;
  }

  .play {
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
    text-shadow: 0 2px 0 rgba(122, 12, 46, 0.4);
  }

  .quiet {
    min-height: 50px;
    background: var(--color-surface-card);
    color: var(--color-ink);
    box-shadow: var(--shadow-hard);
  }

  .btn:hover,
  .btn:focus-visible {
    transform: translateY(-2px);
    filter: brightness(1.04);
  }

  .play:hover,
  .play:focus-visible {
    box-shadow: 0 7px 0 var(--color-stroke-soft);
  }

  .quiet:hover,
  .quiet:focus-visible {
    box-shadow: var(--shadow-hard-lg);
  }

  .btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
    filter: none;
  }

  /* ── Narrow ────────────────────────────────────────────────────────────── */

  @media (max-width: 46rem) {
    .fan {
      --fan-scale: 0.76;
    }
  }

  @media (max-width: 30rem) {
    .fan {
      --fan-scale: 0.6;
    }

    .brand {
      top: calc(var(--space-base) + var(--safe-top));
      left: calc(var(--space-base) + var(--safe-left));
    }

    .actions {
      width: 100%;
      max-width: 20rem;
      flex-direction: column;
    }

    .btn {
      width: 100%;
    }
  }
</style>

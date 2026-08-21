<script lang="ts">
  /**
   * Who is streaming the game, along the foot of the entry screen.
   *
   * Three things about it are decisions rather than styling:
   *
   * 1. **It is absolutely positioned, like every other piece of chrome on this
   *    screen.** `/` is exactly one viewport and never scrolls, so anything
   *    taking a row of layout pushes the lockup off centre — and this one would
   *    do it the moment somebody went live, in front of whoever was reading.
   *    Reserving nothing also means its own height can change without moving a
   *    single other thing on the page.
   * 2. **Nobody live is nothing at all.** No plate, no invitation, no line
   *    saying the category is empty: a plate reporting that nobody is playing
   *    is a plate saying the game is dead, and the same reasoning keeps the
   *    connected-player count off the screen below its floor. What tells a
   *    would-be streamer there is a place to take is the page this links to,
   *    where it can be explained rather than announced over the board.
   * 3. **The order is never touched here.** It is Twitch's own, biggest first,
   *    carried through the server untouched. `topLiveStreams` cuts and does not
   *    sort.
   *
   * The pictures come from this origin (`/live-thumb/…`): the server fetched
   * them, so a player's browser never tells Twitch that somebody opened the
   * page. That is what keeps `img-src 'self'` and the privacy page's promise
   * intact, and it is why nothing here ever builds a Twitch URL for a `src`.
   */
  import type { LiveStreamDTO } from '../types/protocol'
  import { i18n } from '../i18n/i18n.svelte'
  import { LIVE_PATH } from '../lang'
  import { formatViewers, hasLiveStreams, moreLiveCount, topLiveStreams } from './liveStreams'
  import { EXTERNAL_REL, twitchChannel } from './twitchLinks'

  interface Props {
    streams: LiveStreamDTO[]
  }

  const { streams }: Props = $props()

  const t = $derived(i18n.t)
  const lang = $derived(i18n.lang)
  const rows = $derived(topLiveStreams(streams))
  const more = $derived(moreLiveCount(streams))
  const live = $derived(hasLiveStreams(streams))
</script>

{#if live}
  <aside class="live" aria-label={t.liveAria}>
    <p class="head">
      <span class="dot" aria-hidden="true"></span>
      {t.liveHead}
    </p>

    <!-- The cards, and the one-line summary that replaces them where there is
         no room for pictures. Both are in the markup and CSS picks: this is a
         content page's trick rather than a component's, and it is here for the
         same reason — the strip must not need a measurement to know its own
         shape. -->
    <ul class="cards">
      {#each rows as s (s.login)}
        <li>
          <a class="card" href={twitchChannel(s.login)} target="_blank" rel={EXTERNAL_REL}>
            {#if s.thumb}
              <img class="thumb" src={s.thumb} alt="" width="96" height="54" loading="lazy" decoding="async" />
            {:else}
              <span class="thumb blank" aria-hidden="true"></span>
            {/if}
            <span class="name">{s.name}</span>
            <span class="count" aria-hidden="true">{formatViewers(s.viewers, lang)}</span>
            <span class="sr-only">{t.liveViewers(String(s.viewers))}, {t.liveOpensTab}</span>
          </a>
        </li>
      {/each}
    </ul>
    <a class="all" href={LIVE_PATH[lang]}>{more > 0 ? t.liveMore(more) : t.liveAll}</a>
    <a class="compact" href={LIVE_PATH[lang]}>
      {rows[0].name} · {formatViewers(rows[0].viewers, lang)}{more > 0 ? ` · ${t.liveMore(more)}` : ''}
    </a>
  </aside>
{/if}

<style>
  /* Absolute, at the foot of the board and above the row of links the page
     serves under it — `.homeIntro` is in the flow below `#root`, so this never
     reaches it. Centred with `inset-inline` + `margin-inline` rather than
     `left: 50%`: an absolute box anchored at the midpoint is shrink-to-fit
     against the half of the screen to its right, and wraps there whatever
     max-width says. */
  .live {
    position: absolute;
    bottom: calc(var(--space-base) + var(--safe-bottom));
    inset-inline: 0;
    margin-inline: auto;
    width: max-content;
    max-width: calc(100% - 2 * var(--space-base));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    text-align: center;
  }

  /* The board's own chrome: plate, ink outline, hard bottom shadow, one type
     size. No saturated fill anywhere in here — those belong to the three
     moments allowed to shout, and a strip competing with them for the same
     glance is a strip that costs the game something. */
  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--color-muted);
    font: 700 11px/1 var(--font-display);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    user-select: none;
  }

  /* Decoration, and only ever that: the words beside it say what it means, so
     the hue carries nothing on its own and needs no shape the way a suit does.
     It is only ever drawn when somebody is live, which is the only state this
     strip has. */
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-primary);
    flex: none;
  }

  .cards {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 96px;
    padding: 5px 5px 7px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-md);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    color: var(--color-ink);
    text-decoration: none;
    transition: transform 0.12s ease-out;
  }

  .card:hover,
  .card:focus-visible {
    transform: translateY(-2px);
  }

  /* Written on the element as well as in here. Without the attributes a
     preview that arrives late resizes the strip, and this is the screen whose
     largest paint the site is measured on. */
  .thumb {
    width: 96px;
    height: 54px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--color-stroke-soft);
    display: block;
  }

  /* No picture is a row, not a gap — and not an empty grey rectangle either.
     The card simply closes up around the name, which is what the strip looks
     like everywhere the preview CDN is not reachable: an empty frame reads as
     an image that failed, and this one never existed. */
  .blank {
    display: none;
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 12px/1.2 var(--font-display);
  }

  .count {
    color: var(--color-muted);
    font: 700 11px/1 var(--font-display);
  }

  .all,
  .compact {
    color: var(--color-muted);
    font: 700 11px/1 var(--font-display);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 6px 13px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .all:hover,
  .all:focus-visible,
  .compact:hover,
  .compact:focus-visible {
    color: var(--color-ink);
  }

  /* The compact line is the shape everywhere the pictures do not fit, and it
     is one plate rather than three. */
  .compact {
    display: none;
  }

  /* Two ways this screen runs out of room, and the pictures go in both.
     Sideways at 46rem, where the row of links is already behind the burger and
     the connected-player count has taken the bottom of the screen: the strip
     stacks above it as a single line, because a phone has the height for one
     of the two and this is not the one that decides whether to start a game.
     Vertically under 44rem, where a laptop in landscape has the width and not
     the height, and a strip of cards would land on the buttons. */
  @media (max-width: 46rem), (max-height: 44rem) {
    .cards,
    .all {
      display: none;
    }
    .compact {
      display: block;
    }
    .head {
      display: none;
    }
  }

  /* Under 46rem the connected-player count has moved to the foot of the screen
     (`Lobby.svelte`), so the strip stacks above it. The offset is unconditional
     rather than following whether that count is drawn: a line that jumped when
     a second player connected would move under the thumb already reaching for
     it, and an empty 34px at the bottom of the screen costs nothing. */
  @media (max-width: 46rem) {
    .live {
      bottom: calc(var(--space-lg) + var(--safe-bottom) + 34px);
    }
  }

  :root[data-motion='reduce'] .card {
    transition: none;
  }
</style>

<script lang="ts">
  // The way back up, on a page long enough to need one.
  //
  // It appears once the reader is half a screen down, above the bar and out of
  // the column: these pages are long, the navigation is pinned to the *bottom*,
  // and the way back to the top was a scroll the whole way or a key a phone
  // does not have. `hidden` in the prerendered markup and revealed once a
  // script runs — with none it could neither know it was wanted nor animate the
  // return, and that reader still has the browser's own way home. A real
  // `href`, so it works even if the handler does not.
  import { onMount } from 'svelte'
  import { ui } from '../content/ui'
  import type { Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()

  let hydrated = $state(false)
  let shown = $state(false)

  function sync() {
    // `documentElement.scrollTop` first: it is what a fragment jump moves, and
    // `window.scrollY` has been observed to lag it by a frame on that path.
    // Half a screen, not a whole one: the jump list at the top of the privacy
    // page lands a reader mid-document in one press, and at a full screenful
    // the button they then needed was still hidden.
    const y = document.documentElement.scrollTop || window.scrollY
    shown = y > window.innerHeight * 0.5
  }

  onMount(() => {
    hydrated = true
    sync()
    // Capture, so a scroll inside any scroller on the page is seen too, not only
    // one on the document itself.
    document.addEventListener('scroll', sync, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', sync, { capture: true })
  })

  // A fragment jump is not guaranteed to emit a scroll event, and the same hash
  // re-clicked emits no `hashchange` either, so an in-page link re-checks too.
  function onDocumentClick(e: MouseEvent) {
    if ((e.target as Element | null)?.closest?.('a[href^="#"]')) {
      requestAnimationFrame(() => requestAnimationFrame(sync))
    }
  }

  function toTop(e: MouseEvent) {
    e.preventDefault()
    // Smooth unless the reader asked for less: `html[data-scroll]` is what the
    // content layout writes from the system preference, and `data-motion` is
    // the game's.
    const smooth = document.documentElement.dataset.scroll === 'smooth'
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
    // The href alone would have moved focus to the header; taking it back to
    // the top of the document is what a keyboard reader expects.
    //
    // `detail === 0` is a keyboard activation — Enter or Space on the link — and
    // it is the whole condition, because `:focus-visible` cannot answer this
    // one: Safari treats a programmatic `focus()` as keyboard focus whatever the
    // gesture was, so a tap published "Skip to content" over the wordmark with
    // nothing offering to close it. A pointer press moves no focus at all.
    //
    // `preventScroll`: the skip link sits at `top: 0` a screenful off to the
    // left, so focusing it scrolled it into view — instantly, and an instant
    // scroll cancels the smooth one that had just started.
    if (e.detail === 0) {
      document.querySelector<HTMLElement>('.skip')?.focus({ preventScroll: true })
    }
  }
</script>

<svelte:window onresize={sync} onhashchange={() => requestAnimationFrame(sync)} />
<svelte:document onclick={onDocumentClick} />

<a class="toTop" href="#top" hidden={!hydrated} data-shown={shown ? '' : undefined} aria-label={ui('toTop', lang)} onclick={toTop}>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      d="M12 19V6M6 12l6-6 6 6"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    ></path>
  </svg>
</a>

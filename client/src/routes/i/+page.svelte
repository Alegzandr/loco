<script lang="ts">
  // Where a table invitation points: `/i/?t=CODE`.
  //
  // This is the home page's document with a different <head>, and that is the
  // entire feature. A link dropped in a chat window unfurls into whatever the
  // *served* HTML says — crawlers and unfurlers run no JavaScript — so an
  // invitation could only say "somebody kept you a seat" by being a document of
  // its own. Everything below the head is `GamePage`, unchanged: same `#root`,
  // same boot, same game.
  //
  // **One built page answers every code.** The build emits `/i/index.html` and
  // nothing else, and the code rides in the query string: a static build cannot
  // emit a page per table, and the site's own rule — a miss is a real 404, never
  // the app (`nginx.conf`) — is left standing everywhere.
  //
  // `chrome={false}`: the footer row, the sheet and the burger are the indexable
  // half of `/`, and this page is `noindex`. Somebody arriving here was handed a
  // seat, not sent a row of links and a page of prose.
  //
  // No `data-served-lang` (`seo/document.ts`): an invitation carries no language
  // (`hooks/tableInvite.ts`), so there is nothing for `initLang` to act on and
  // the reader's own browser decides, exactly as it does at `/`. Nothing here is
  // swapped either: `chrome={false}` leaves this document with no served copy in
  // it at all.
  import GamePage from '../../layouts/GamePage.svelte'
  import { INVITE } from '../../seo/meta'
</script>

<GamePage lang="en" page={INVITE} jsonLd={null} noindex chrome={false} />

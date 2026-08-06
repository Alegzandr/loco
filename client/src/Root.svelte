<script lang="ts">
  import App from './App.svelte'
  import TabTaken from './components/TabTaken.svelte'
  import { tabLock } from './hooks/tabLock.svelte'
  import { takeOverTab } from './hooks/tabLock'
</script>

<!--
  The switch between the game and the curtain saying another tab is holding it.

  It is a level of its own rather than a branch inside `App.svelte` because
  `webSocket()` is called at the top of that component's script: there is no way
  to mount the app and not open a socket, and an open socket is the entire thing
  a second tab must not have. Not mounting is also what makes yielding correct
  in the other direction — the app unmounts, the socket closes, and the server
  holds the seat exactly as it would for any other dropped connection.

  Svelte instantiating the app once and keeping it is a guarantee this block is
  allowed to break and nothing else is: it flips when a player takes the game
  from another tab, which is a fresh session by definition. See
  `test/appSubscription.test.ts` for the guarantee itself.
-->
{#if tabLock.active}
  <App />
{:else}
  <TabTaken seated={tabLock.otherSeated} onTake={takeOverTab} />
{/if}

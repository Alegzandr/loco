<script lang="ts">
  // What the dev server answers a miss with, and what the router shows if a
  // client-side navigation ever lands on an address it has no page for. In
  // production a miss never reaches here: nginx serves the prerendered 404
  // (src/routes/404/) with a real 404 status, and a link the router cannot
  // match is followed as an ordinary navigation, which lands on the same file.
  import NotFound from '../layouts/NotFound.svelte'
</script>

<NotFound />
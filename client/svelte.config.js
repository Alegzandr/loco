import { vitePreprocess } from '@astrojs/svelte'

/**
 * Declared rather than left to the plugin's defaults, for two reasons.
 *
 * `vitePreprocess` is what reads `<script lang="ts">` and `<style lang="...">`
 * through Vite's own transform, so a component is typed by the same toolchain
 * that types the rest of the client instead of by a second, slightly different
 * one. It is also what `svelte-check` picks up: without this file the type gate
 * in `npm run build` sees raw TypeScript inside markup and reports syntax
 * errors on code that compiles.
 *
 * `runes: true` refuses the Svelte 4 reactivity model outright. The two can
 * legally coexist per component, and a file that slips back into `export let`
 * and `$:` still works — it just stops being reactive in the way the rest of the
 * app is, and that failure is silent. This client is Svelte 5 everywhere or it
 * is inconsistent.
 */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
}

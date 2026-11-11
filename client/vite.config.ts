import { sveltekit } from '@sveltejs/kit/vite'
import { enhancedImages } from '@sveltejs/enhanced-img'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import adapter from '@sveltejs/adapter-static'
import { defineConfig } from 'vite'

/**
 * SvelteKit builds the site; the game is mounted client-side by src/entry.ts.
 *
 * Every URL is prerendered to a file and nginx serves `build/` exactly as it
 * served Astro's `dist/`: there is no Node runtime in production
 * (`adapter-static`, `client/Dockerfile`). What SvelteKit adds over the Astro
 * build is a client-side router, so moving between a content page and the game
 * no longer throws the document away — and with it the socket, the music and
 * the store. See docs/notes/client.md, "How the game gets on the page".
 *
 * The app itself is still never server-rendered, and that is still deliberate.
 * The store is seeded from `sessionStorage` before the socket opens, the
 * language comes from `localStorage`, and the whole board is measured from the
 * viewport (layout.ts: boardSpace, state/boardMetrics.svelte.ts). A server
 * knows none of those, so the game route's prerendered HTML carries the served
 * half of `/` — the heading, the footer row, the sheet of prose, the burger —
 * and an empty `#root`, which entry.ts fills in the browser.
 *
 * Since SvelteKit 3 there is no `svelte.config.js`: everything the framework is
 * told is passed to the plugin below, and svelte-check reads it from here too.
 */
export default defineConfig({
  plugins: [
    // Before sveltekit(), as its own documentation requires: it rewrites
    // `<enhanced:img>` into a `<picture>` before the Svelte compiler sees it.
    // It is what replaced Astro's `<Image />` on the rooms page.
    enhancedImages(),
    sveltekit({
      // The output is a directory of files and nothing else. `strict` fails the
      // build on any route that could not be prerendered, which is the only way
      // a page can go missing from a static site without anybody noticing.
      adapter: adapter({ pages: 'build', assets: 'build', strict: true }),

      // `vitePreprocess` reads `<script lang="ts">` and `<style lang="...">`
      // through Vite's own transform, so a component is typed by the same
      // toolchain that types the rest of the client. svelte-check picks it up
      // from this file.
      preprocess: vitePreprocess(),

      // `runes: true` refuses the Svelte 4 reactivity model outright. The two
      // can legally coexist per component, and a file that slips back into
      // `export let` and `$:` still works — it just stops being reactive in the
      // way the rest of the app is, and that failure is silent.
      compilerOptions: { runes: true },

      // Every stylesheet travels in the document. The ones this site emits are
      // small, and as separate files they were render-blocking requests: on a
      // throttled phone the game page waited 753 ms on one of them before it
      // could paint a single word. `style-src` allows `'unsafe-inline'` in
      // client/security-headers.conf, so nothing here is blocked — unlike
      // scripts (see the `csp` block below and csp.test.ts).
      inlineStyleThreshold: Infinity,

      // The one inline script SvelteKit writes — the bootstrap that starts the
      // router on a prerendered page — is hashed rather than refused. SvelteKit
      // puts that hash in a `<meta http-equiv>` per page, which on its own would
      // not loosen the header policy nginx sends (both are enforced), so
      // `tools/csp/hashes.mjs` reads the same hashes out of the built HTML into
      // `client/csp-hashes.conf`, which security-headers.conf includes. The
      // header and the meta therefore allow exactly the same scripts.
      csp: {
        mode: 'hash',
        directives: { 'script-src': ['self'] },
      },

      // `public/` rather than SvelteKit's `static/`: the music, the models, the
      // icons and the link-preview art have lived there since the Vite days,
      // and the tools that write into it (`make og`, `make icons`, `make
      // models`) name the directory.
      files: { assets: 'public' },

      // Root-relative, as Astro wrote them. The 404 is served at whatever
      // address was missed, `/a/b/c` included, and a relative `./_app/` from
      // there names a directory that does not exist.
      paths: { relative: false },

      prerender: {
        // `/live.json` and `/live-thumb/` are the Go server's, behind nginx: a
        // prerender has no server to ask, and a page that links to them is not
        // broken for it.
        handleHttpError: ({ path, message }) => {
          if (path === '/live.json' || path.startsWith('/live-thumb/')) return
          throw new Error(message)
        },
      },
    }),
  ],

  // Vite's own default, written out because `wsEnv.test.ts` reads it. The
  // compose files, the Playwright config and the README all name `VITE_*`
  // variables, and Astro had narrowed this to `PUBLIC_` once already: the only
  // symptom then was a game whose socket dialled the dev server and a table
  // that never opened.
  envPrefix: ['VITE_'],

  // The absolute origin the canonical, hreflang and link-preview tags are built
  // from (src/seo/meta.ts), baked into the server render *and* the browser
  // bundle, so a page the router renders after a client-side navigation names
  // the same origin as the prerendered one. Defaults to production; the
  // Dockerfile takes VITE_PUBLIC_ORIGIN as a build ARG per environment. The
  // apex, never `www.`: one host is canonical and the other 301s to it.
  define: {
    __LOCO_ORIGIN__: JSON.stringify(
      (process.env.VITE_PUBLIC_ORIGIN ?? 'https://ohloco.com').replace(/\/+$/, ''),
    ),
  },

  // Vite runs on container port 3000, exposed at host port 5173 by the Docker
  // port mapping. Without clientPort the HMR client dials 3000 (not exposed)
  // and the browser console fills with WebSocket errors that read exactly like
  // the game's own socket failing.
  server: {
    port: 3000,
    host: true,
    ws: { clientPort: parseInt(process.env.VITE_HMR_CLIENT_PORT ?? '5173') },
    // Polling, and only inside the dev container (docker-compose.dev.yml sets
    // the variable; a dev server run natively never sees it).
    //
    // The source reaches that container through a bind mount, and a bind mount
    // from a Windows or macOS host does not deliver the filesystem events
    // chokidar subscribes to. Nothing fails: the server starts, the page loads,
    // and every edit made from then on is simply never noticed — the module
    // graph keeps serving the transform it cached at boot. That is a silent
    // failure aimed squarely at the person who just wrote the fix they are
    // looking for, which is what makes the poll worth its wakeups.
    watch: process.env.LOCO_WATCH_POLL === '1' ? { usePolling: true, interval: 400 } : undefined,
    // The capture harnesses (tools/lib/devserver.mjs) pick a dedicated port and
    // then poll it. A silent fallback to the next free port would leave them
    // polling a port nothing is listening on until their timeout expires.
    strictPort: process.env.LOCO_STRICT_PORT === '1',
    // The two live-streams paths, which nginx proxies in production. Dev has no
    // nginx, so without this the page's fetch would ask Vite for a file that
    // does not exist and the list would be silently empty — which is also what
    // it looks like when nobody is streaming, so the bug would be invisible.
    // The socket is not proxied here: the client dials the Go server directly
    // (see webSocketPolicy.ts). LOCO_SERVER_ORIGIN because `make dev` runs Vite
    // and the Go server in two containers.
    proxy: {
      '/live.json': process.env.LOCO_SERVER_ORIGIN ?? 'http://localhost:8080',
      '/live-thumb': process.env.LOCO_SERVER_ORIGIN ?? 'http://localhost:8080',
    },
  },
})

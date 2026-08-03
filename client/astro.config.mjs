// @ts-check
import { defineConfig } from 'astro/config'
import svelte from '@astrojs/svelte'
import sitemap from '@astrojs/sitemap'

/**
 * Astro builds the site; the game is mounted client-side by src/entry.ts.
 *
 * Nothing about the app is server-rendered, and that is deliberate. The store is
 * seeded from `sessionStorage` before the socket opens, the theme and the
 * language come from `localStorage`, and the whole board is measured from the
 * viewport (layout.ts: boardSpace, hooks/boardMetrics.svelte.ts). A server
 * knows none of those, so rendering the app there buys nothing and costs a
 * hydration mismatch on every one of them. The content pages around it are pure
 * HTML with no island at all, which is the part search engines actually read.
 *
 * The output stays fully static: `client/Dockerfile` still builds `dist/` and
 * serves it from nginx, so there is no Node runtime in production.
 */
// The absolute origin the canonical, hreflang and link-preview tags are built
// from. `src/seo/meta.ts` reads the same variable, and both default to
// production, so an image built for the dev host stops claiming to be prod only
// once `VITE_PUBLIC_ORIGIN` is actually passed to the build (client/Dockerfile
// takes it as an ARG, .gitlab-ci.yml passes it per environment).
// The apex, never `www.`: one host is canonical and the other 301s to it at the
// edge, so a default carrying `www.` would make every canonical point at a
// redirect.
const SITE = (process.env.VITE_PUBLIC_ORIGIN ?? 'https://ohloco.com').replace(/\/+$/, '')

export default defineConfig({
  site: SITE,

  // English at the root, French under /fr/. `prefixDefaultLocale: false` is what
  // keeps the game's own URL at `/`: it is the address people paste, and moving
  // it to /en/ for symmetry would break every link already shared.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    routing: { prefixDefaultLocale: false },
  },

  // Astro builds directories (`/fr/index.html`), which nginx would serve at both
  // `/fr` and `/fr/`. Pinning the slashed form means the canonical, the sitemap
  // and the hreflang set all name the same URL instead of competing as
  // duplicates of each other.
  trailingSlash: 'always',

  integrations: [
    svelte(),
    // Generates sitemap-index.xml plus the alternates. `i18n` here is what puts
    // the xhtml:link pairs in the XML; the <link rel="alternate"> tags in the
    // page head come from src/seo/meta.ts. Both are worth having: the head links
    // are what Google reads most reliably, the sitemap is what it discovers.
    sitemap({ i18n: { defaultLocale: 'en', locales: { en: 'en-US', fr: 'fr-FR' } } }),
  ],

  // Astro's dev toolbar floats over the bottom of the page, which is where the
  // action bar and the hand are. `make visual` and `make og` drive the real dev
  // server, so it lands in the captures: the first og.png shot after the
  // migration had a slice of it across the bottom edge. Nothing in this project
  // uses it, and the visual review is the thing it would break.
  devToolbar: { enabled: false },

  // Every stylesheet travels in the document. The three this site emits are
  // small (3-22 kB before compression) and all three were render-blocking
  // requests: on a throttled phone the game page waited 753 ms on one of them
  // before it could paint a single word, which is most of its first paint. The
  // trade is a stylesheet re-sent per page instead of cached across them, and at
  // this size the round trip costs more than the bytes. `style-src` allows
  // `'unsafe-inline'` in client/nginx.conf, so nothing here is blocked â€” unlike
  // scripts, which must stay external (see csp.test.ts).
  build: { inlineStylesheets: 'always' },

  // Vite runs on container port 3000, exposed at host port 5173 by the Docker
  // port mapping. Without clientPort the HMR client dials 3000 (not exposed)
  // and the browser console fills with WebSocket errors that read exactly like
  // the game's own socket failing.
  server: { port: 3000, host: true },
  vite: {
    // Astro narrows Vite's env prefix to `PUBLIC_`, so `import.meta.env.VITE_*`
    // is left in the output verbatim and reads as `undefined` in the browser,
    // with no warning anywhere.
    // That silently sent the game's socket to the Vite dev server
    // (`ws://localhost:5173/ws`, which proxies nothing) instead of the Go server
    // on 8080, and the only symptom was a table that never opened. `VITE_` is
    // restored here because it is the name the compose files, the Playwright
    // config and the README all already use.
    envPrefix: ['PUBLIC_', 'VITE_'],
    server: {
      // `server.ws.*` since Vite 8; `server.hmr.*` is deprecated and warns.
      ws: { clientPort: parseInt(process.env.VITE_HMR_CLIENT_PORT ?? '5173') },
      // The capture harnesses (tools/lib/devserver.mjs) pick a dedicated port and
      // then poll it. A silent fallback to the next free port would leave them
      // polling a port nothing is listening on until their timeout expires, and
      // report "did not start" for a server that is up.
      strictPort: process.env.LOCO_STRICT_PORT === '1',
    },
  },
})

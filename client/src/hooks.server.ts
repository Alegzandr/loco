/**
 * Runs when a page is prerendered (and under `vite dev`), never in production:
 * production is the files this produced, served by nginx.
 *
 * Its one job is the part of a document a component cannot render: the
 * attributes on `<html>` and `<body>`, which `src/app.html` leaves as
 * placeholders. The values come from `seo/document.ts: routeFor`, the same
 * function the root layout applies in the browser after a client-side
 * navigation.
 */
import type { Handle } from '@sveltejs/kit/hooks'
import { bodyAttrs, htmlAttrs, routeFor } from './seo/document'

export const handle: Handle = ({ event, resolve }) => {
  const route = routeFor(event.url.pathname)
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace('%loco.lang%', route.lang)
        .replace('%loco.htmlAttrs%', htmlAttrs(route))
        .replace('%loco.bodyAttrs%', bodyAttrs(route)),
  })
}

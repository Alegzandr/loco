/**
 * Runs when a page is prerendered (and under `vite dev`), never in production:
 * production is the files this produced, served by nginx.
 *
 * Its one job is the part of a document a component cannot render: the
 * attributes on `<html>` and `<body>`, which `src/app.html` leaves as
 * placeholders. The values come from `seo/document.ts`, the same function the
 * page layouts apply in the browser after a client-side navigation.
 */
import type { Handle } from '@sveltejs/kit/hooks'
import { bodyAttrs, documentFor, htmlAttrs } from './seo/document'

export const handle: Handle = ({ event, resolve }) => {
  const doc = documentFor(event.url.pathname)
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace('%loco.lang%', doc.lang)
        .replace('%loco.htmlAttrs%', htmlAttrs(doc))
        .replace('%loco.bodyAttrs%', bodyAttrs(doc)),
  })
}

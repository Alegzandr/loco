// Prerendered to /sitemap-index.xml, a file nginx serves like any other. See src/seo/sitemap.ts.
import { sitemapIndex } from '../../seo/sitemap'

export const prerender = true
// A file, not a directory: the slashed form would build a directory of that name.
export const trailingSlash = 'never'

export function GET(): Response {
  return new Response(sitemapIndex(), { headers: { 'Content-Type': 'application/xml' } })
}

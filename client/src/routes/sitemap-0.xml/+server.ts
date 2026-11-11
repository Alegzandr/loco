// Prerendered to /sitemap-0.xml, a file nginx serves like any other. See src/seo/sitemap.ts.
import { sitemapUrls } from '../../seo/sitemap'

export const prerender = true
// A file, not a directory: the slashed form would build a directory of that name.
export const trailingSlash = 'never'

export function GET(): Response {
  return new Response(sitemapUrls(), { headers: { 'Content-Type': 'application/xml' } })
}

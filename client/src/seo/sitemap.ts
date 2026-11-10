/**
 * The sitemap, as two strings built from the registry.
 *
 * Astro's sitemap integration walked the pages it had *emitted*, which is how
 * `/i/` shipped in it the first time: the invite page is a door somebody was
 * handed, served `noindex`, and a sitemap entry for it asks Google to crawl a
 * page that then refuses to be indexed. Built from `PAGES` instead, the sitemap
 * is the registry and nothing else — the same list the canonicals, the
 * `hreflang` sets and `seo.test.ts` read — so a page outside it cannot leak in.
 *
 * Same two files, same names and same shape as before: `robots.txt`
 * (client/nginx.conf) advertises `sitemap-index.xml`, which names
 * `sitemap-0.xml`, which lists every page in every language with its
 * `xhtml:link` alternates. The routes under `src/routes/sitemap-*.xml/` are
 * prerendered from these.
 */
import { LANGS, LOCALE, PAGES, absolute } from './meta'

const XML = '<?xml version="1.0" encoding="UTF-8"?>'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The one page of the sitemap: every page of the site, in every language. */
export function sitemapUrls(): string {
  const urls: string[] = []
  for (const page of PAGES) {
    const alternates = LANGS.map(
      (l) => `<xhtml:link rel="alternate" hreflang="${LOCALE[l]}" href="${escapeXml(absolute(page.path[l]))}"/>`,
    ).join('')
    for (const lang of LANGS) {
      urls.push(`<url><loc>${escapeXml(absolute(page.path[lang]))}</loc>${alternates}</url>`)
    }
  }
  return (
    XML +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    urls.join('') +
    '</urlset>'
  )
}

/** The index `robots.txt` names, pointing at the page above. */
export function sitemapIndex(): string {
  return (
    XML +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    `<sitemap><loc>${escapeXml(absolute('/sitemap-0.xml'))}</loc></sitemap>` +
    '</sitemapindex>'
  )
}

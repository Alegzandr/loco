/**
 * The route parameters, matched against the page registry.
 *
 * A content page is one route per language (`routes/(content)/[slug=pageEn]`,
 * `routes/(content)/fr/[slug=pageFr]`) rather than a directory per page, and a
 * slug only matches a page `seo/meta.ts` declares: the registry is the single
 * source of every path, so a URL it does not know is a miss — the 404 — rather
 * than an empty article. The same registry feeds those routes' `entries`, which
 * is what prerenders each page to its file.
 */
import { defineParams } from '@sveltejs/kit/params'
import { contentPageBySlug } from './seo/document.ts'

export const params = defineParams({
  pageEn: (slug: string) => (contentPageBySlug(slug, 'en') ? slug : undefined),
  pageFr: (slug: string) => (contentPageBySlug(slug, 'fr') ? slug : undefined),
})

// Every content page of the registry in this language, prerendered one by one:
// `entries` is what turns this one parameterised route into a file per page.
// The slugs come from `seo/meta.ts`, the same list the sitemap, the hreflang
// sets and the param matcher read, so a page cannot exist in one and not the
// others.
import { contentSlugs } from '../../../seo/document'

export const entries = () => contentSlugs('en').map((slug) => ({ slug }))
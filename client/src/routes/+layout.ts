// Every page of this site is a file. The game's page included: its served half
// (the heading, the footer row, the prose behind the sheet) is what a crawler
// reads, and `#root` is left empty for src/entry.ts to fill in the browser.
export const prerender = true

// SvelteKit builds directories (`/fr/index.html`), which nginx would serve at
// both `/fr` and `/fr/`. Pinning the slashed form means the canonical, the
// sitemap and the hreflang set all name the same URL instead of competing as
// duplicates of each other. The 404 and the sitemaps opt out, one file each.
export const trailingSlash = 'always'

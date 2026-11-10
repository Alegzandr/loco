// The page nginx answers every miss with (`error_page 404 /404.html`).
//
// `never`: this is the one route that is a file rather than a directory, so it
// builds to `404.html` beside the index rather than `404/index.html`.
export const trailingSlash = 'never'

// No script at all. This document is served at whatever address was missed, so
// a router started on it would be routing a URL it has no page for — and a 404
// has nothing to do that a link cannot. It also keeps the bootstrap's hash out
// of the CSP: there is no inline script here to allow.
export const csr = false
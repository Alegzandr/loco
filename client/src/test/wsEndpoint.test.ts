import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DIRECT_FAILURES_BEFORE_FALLBACK,
  wsEndpoints,
  wsUrl,
  type WsEnv,
  type WsLocation,
} from '../hooks/webSocketPolicy'

const CLIENT = path.resolve(__dirname, '../..')
const ROOT = path.resolve(CLIENT, '..')

const https: WsLocation = { protocol: 'https:', hostname: 'ohloco.com', host: 'ohloco.com' }
const http: WsLocation = {
  protocol: 'http:',
  hostname: 'localhost',
  host: 'localhost:3000',
}

const at = (loc: WsLocation, env: WsEnv) => wsEndpoints(loc, env)

/**
 * The socket left the CDN because a proxied round trip measured 389 ms against
 * 8.5 ms direct, on an established connection between two Paris networks. Every
 * assertion here is about not losing that, and about not letting it take the
 * game down with it the day the certificate expires.
 */
describe('which address the socket dials', () => {
  it('uses the direct hostname when the build named one', () => {
    const e = at(https, { VITE_WS_ORIGIN: 'wss://ws.ohloco.com' })
    expect(e.direct).toBe('wss://ws.ohloco.com/ws')
    expect(wsUrl(e, false)).toBe('wss://ws.ohloco.com/ws')
  })

  it('stays on the page origin when it did not', () => {
    const e = at(https, {})
    expect(e.direct).toBeNull()
    expect(wsUrl(e, false)).toBe('wss://ohloco.com/ws')
  })

  it('takes the scheme from the page, never from the value', () => {
    // Mixed content is refused by the browser before the socket is attempted,
    // and it fails as silence: a page on http:// dialling wss:// (or the
    // reverse) looks exactly like the server being down.
    expect(at(http, { VITE_WS_ORIGIN: 'wss://ws.localhost' }).direct).toBe('ws://ws.localhost/ws')
    expect(at(https, { VITE_WS_ORIGIN: 'ws://ws.ohloco.com' }).direct).toBe('wss://ws.ohloco.com/ws')
    expect(at(https, { VITE_WS_ORIGIN: 'ws.ohloco.com' }).direct).toBe('wss://ws.ohloco.com/ws')
    expect(at(https, { VITE_WS_ORIGIN: 'wss://ws.ohloco.com/' }).direct).toBe(
      'wss://ws.ohloco.com/ws',
    )
  })

  it('keeps the port on the page origin', () => {
    // host, not hostname: a CSP host source and a socket address both need the
    // port, and dropping it is invisible on :443 and broken everywhere else.
    expect(at(http, {}).proxied).toBe('ws://localhost:3000/ws')
  })

  it('lets the dev port win, and leaves no direct endpoint behind it', () => {
    // docker-compose.dev.yml points this at the Go server because Vite's own
    // WebSocket proxy is unreliable under Docker networking. There is no CDN in
    // front of a dev server to escape, so there is nothing to fall back from.
    const e = at(http, { VITE_WS_PORT: '8080', VITE_WS_ORIGIN: 'wss://ws.ohloco.com' })
    expect(e.proxied).toBe('ws://localhost:8080/ws')
    expect(e.direct).toBeNull()
  })

  it('ignores an empty or blank origin rather than building nonsense', () => {
    expect(at(https, { VITE_WS_ORIGIN: '' }).direct).toBeNull()
    expect(at(https, { VITE_WS_ORIGIN: '   ' }).direct).toBeNull()
    expect(at(https, { VITE_WS_ORIGIN: 'wss://' }).direct).toBeNull()
  })
})

describe('the fallback', () => {
  it('returns to the page origin once the direct hostname has failed', () => {
    const e = at(https, { VITE_WS_ORIGIN: 'wss://ws.ohloco.com' })
    expect(wsUrl(e, true)).toBe('wss://ohloco.com/ws')
  })

  it('is reached in a small number of attempts', () => {
    // Every one of these is a failed connection the player waits through. The
    // backoff is 250 / 500 / 1000 ms, so three is about two seconds.
    expect(DIRECT_FAILURES_BEFORE_FALLBACK).toBeGreaterThanOrEqual(2)
    expect(DIRECT_FAILURES_BEFORE_FALLBACK).toBeLessThanOrEqual(5)
  })

  it('is what the CSP has to keep allowing', () => {
    // The direct hostname is the one part of the stack whose certificate nothing
    // renews and nothing here can see expire. A policy that dropped the
    // same-origin socket in favour of the direct one would turn that expiry from
    // a slow game into a dead one.
    const headers = readFileSync(path.join(CLIENT, 'security-headers.conf'), 'utf8')
    // The directive off the add_header line, not off the comments above it,
    // several of which say "connect-src" while explaining why.
    const csp = /add_header Content-Security-Policy "([^"]*)"/.exec(headers)?.[1] ?? ''
    expect(csp, 'no Content-Security-Policy line found').not.toBe('')
    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? ''
    expect(connect).toContain('ws://$http_host')
    expect(connect).toContain('wss://$http_host')
    expect(connect).toContain('__WS_DIRECT_ORIGIN__')
  })

  it('has its placeholder filled by the image build, from the same value as the bundle', () => {
    // The CSP has to allow exactly what the bundle was built to dial, and
    // nothing in a request says what that is. One build-arg fills both, and the
    // build fails rather than shipping an unsubstituted policy.
    const dockerfile = readFileSync(path.join(CLIENT, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/ARG VITE_WS_ORIGIN/)
    expect(dockerfile).toMatch(/sed -i .*__WS_DIRECT_ORIGIN__/)
    expect(dockerfile).toMatch(/grep -q '__WS_DIRECT_ORIGIN__'/)

    // And CI passes it on a tag only: dev has no such hostname, no DNS record
    // and no certificate for one.
    const ci = readFileSync(path.join(ROOT, '.gitlab-ci.yml'), 'utf8')
    expect(ci).toMatch(/--build-arg "VITE_WS_ORIGIN=\$\{WS_ORIGIN\}"/)
    expect(ci).toMatch(/WS_ORIGIN="wss:\/\/ws\.\$\{APP_HOST\}"/)
  })
})

describe('the server has to accept the upgrade across two hostnames', () => {
  it('is told the page origin explicitly', () => {
    // hub.originAllowed defaults to "the Origin's hostname equals the request's
    // Host", which a page on ohloco.com opening a socket on ws.ohloco.com does
    // not satisfy. Without this the upgrade is refused every time, and the
    // client reads a refused upgrade as the server being down.
    const ci = readFileSync(path.join(ROOT, '.gitlab-ci.yml'), 'utf8')
    expect(ci).toMatch(/"LOCO_ALLOWED_ORIGINS=https:\/\/\$\{APP_HOST\}"/)
  })

  it('serves the socket and nothing else on that hostname', () => {
    // Serving the SPA there too would publish the whole site under a second
    // hostname, with only the canonical arguing against it.
    const conf = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')
    expect(conf).toMatch(/server_name\s+ws\.\*;/)
    const wsBlock = conf.slice(conf.indexOf('server_name ws.*;'))
    expect(wsBlock).toContain('include /etc/nginx/ws-proxy.conf;')
    expect(wsBlock).toMatch(/location \/ \{\s*return 404;/)
  })

  it('proxies both hostnames through one definition', () => {
    // A socket that reconnects onto the fallback must reach a server that cannot
    // tell the difference: the seat it is reclaiming was taken on the other one.
    const conf = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')
    expect(conf.match(/include \/etc\/nginx\/ws-proxy\.conf;/g)).toHaveLength(2)

    const proxy = readFileSync(path.join(CLIENT, 'ws-proxy.conf'), 'utf8')
    expect(proxy).toContain('proxy_pass http://server:8080;')
    // The two latency rules the socket exists for.
    expect(proxy).toContain('tcp_nodelay on;')
    expect(proxy).toContain('proxy_buffering off;')
    // And the client address, on both paths.
    expect(proxy).toContain('proxy_set_header CF-Connecting-IP')
    expect(proxy).toContain('proxy_set_header X-Real-IP')
  })
})

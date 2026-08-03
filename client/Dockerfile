# Astro 7 declares engines.node >= 22.12, so 22 is the floor; the image is the
# current LTS rather than the floor, because a build image is the one place
# there is nothing to gain from running the oldest thing that works.
FROM node:24-alpine AS builder

# The absolute origin baked into canonical / hreflang / og: tags. Crawlers do not
# run JS and resolve og:image against nothing, so a relative URL is simply not
# fetched: this has to be decided here, at build time. Defaults to production so
# a plain `docker build` still produces a correct image; .gitlab-ci.yml passes
# the real host per environment.
ARG VITE_PUBLIC_ORIGIN=https://ohloco.com
ENV VITE_PUBLIC_ORIGIN=$VITE_PUBLIC_ORIGIN

# The hostname the WebSocket dials to bypass the CDN, e.g. wss://ws.ohloco.com.
# Empty by default, which is every environment that has no such hostname: dev, a
# local build, and the dev deployment, all of which keep the socket on the page's
# own origin. Baked in here rather than read at runtime for the same reason as
# the origin above — the bundle is built per environment — and used twice below:
# once by the bundle, once by the CSP that has to allow what the bundle dials.
ARG VITE_WS_ORIGIN=
ENV VITE_WS_ORIGIN=$VITE_WS_ORIGIN

WORKDIR /app
# The lockfile travels, and `npm ci` installs exactly what is in it.
#
# `npm install` off package.json alone re-resolved the whole transitive tree on
# every build, so two builds of the same commit were not the same image and a
# dependency compromised between them shipped with nothing in the diff to show
# it. The lockfile is committed precisely so that cannot happen; it just was not
# being copied in.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Not into conf.d/: nginx.conf's own `include /etc/nginx/conf.d/*.conf` would
# pick these up as second server-level files and refuse to start on an
# add_header, or a location, outside any server block.
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY ws-proxy.conf /etc/nginx/ws-proxy.conf

# The CSP has to allow the socket the bundle was built to dial, and nothing in a
# request says what that is — it is a property of the deployment. So the same
# build-arg fills both, here, and the two cannot disagree.
#
# An ARG does not cross a stage boundary, hence the redeclaration. Both schemes
# are emitted because the client takes the scheme from the page rather than from
# this value (webSocketPolicy.ts), so a policy naming only wss:// would block the
# socket on any deployment served over http.
#
# The grep is the point of the whole step: a substitution that silently matched
# nothing would ship a policy containing a literal placeholder, which blocks the
# socket on a hostname the game is about to dial and reports it nowhere.
ARG VITE_WS_ORIGIN=
RUN set -eux; \
    if [ -n "${VITE_WS_ORIGIN}" ]; then \
      host="$(printf '%s' "${VITE_WS_ORIGIN}" | sed -E 's#^wss?://##; s#/+$##')"; \
      replacement="ws://${host} wss://${host}"; \
    else \
      replacement=""; \
    fi; \
    sed -i "s#__WS_DIRECT_ORIGIN__#${replacement}#" /etc/nginx/security-headers.conf; \
    if grep -q '__WS_DIRECT_ORIGIN__' /etc/nginx/security-headers.conf; then \
      echo "the CSP placeholder was not substituted" >&2; exit 1; \
    fi

EXPOSE 80

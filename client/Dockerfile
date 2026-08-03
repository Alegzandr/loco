# Astro 7 declares engines.node >= 22.12, so 22 is the floor; the image is the
# current LTS rather than the floor, because a build image is the one place
# there is nothing to gain from running the oldest thing that works.
FROM node:24-alpine AS builder

# The absolute origin baked into canonical / hreflang / og: tags. Crawlers do not
# run JS and resolve og:image against nothing, so a relative URL is simply not
# fetched: this has to be decided here, at build time. Defaults to production so
# a plain `docker build` still produces a correct image; .gitlab-ci.yml passes
# the real host per environment.
ARG VITE_PUBLIC_ORIGIN=https://loco.kisukesaama.com
ENV VITE_PUBLIC_ORIGIN=$VITE_PUBLIC_ORIGIN

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
# pick this up as a second server-level file and refuse to start on an
# add_header outside any server block.
COPY security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 80

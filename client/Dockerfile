# Astro 7 declares engines.node >= 22.12: on node:20 the install fails outright.
FROM node:22-alpine AS builder

# The absolute origin baked into canonical / hreflang / og: tags. Crawlers do not
# run JS and resolve og:image against nothing, so a relative URL is simply not
# fetched: this has to be decided here, at build time. Defaults to production so
# a plain `docker build` still produces a correct image; .gitlab-ci.yml passes
# the real host per environment.
ARG VITE_PUBLIC_ORIGIN=https://loco.kisukesaama.com
ENV VITE_PUBLIC_ORIGIN=$VITE_PUBLIC_ORIGIN

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

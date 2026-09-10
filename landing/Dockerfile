FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY landing/package.json landing/package.json
RUN pnpm install --frozen-lockfile --filter @sodera/landing...

COPY landing landing
RUN pnpm --filter @sodera/landing build

FROM caddy:2.10-alpine

COPY landing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/landing/dist /srv

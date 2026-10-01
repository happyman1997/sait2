# syntax=docker/dockerfile:1
# Образ «Арены Работы»: Next.js в режиме standalone (только нужные модули) + собранные служебные скрипты.
# Postgres и nginx — в docker-compose.prod.yml; подробности — DEPLOY.md.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY scripts/copy-maplibre-worker.mjs scripts/
# За прокси с подменой TLS (корпоративная сеть): docker build --secret id=ca,src=ca.crt … — иначе не нужен.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm ci
COPY . .
# Адрес стиля карты попадает в клиентский код при сборке.
ARG NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL NEXT_OUTPUT=standalone
RUN npm run build && node scripts/bundle-scripts.mjs

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/app/data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/dist/scripts ./scripts
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Миграции под блокировкой (несколько экземпляров стартуют безопасно), затем сервер.
# Служебные команды: docker compose exec app node scripts/staff.mjs add <логин>
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]

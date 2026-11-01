# One build for the whole workspace, then a small image per app: `--target api` or `--target web`.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_HOME=/corepack NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
# The pnpm version comes from package.json's packageManager.
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
# Installing also builds packages/shared (its prepare script), which both apps import.
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build && NEXT_STANDALONE=1 pnpm --filter web build
# The API with only its production dependencies, packages/shared included.
RUN pnpm --filter api deploy --prod --legacy /deploy/api

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /deploy/api/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/api/package.json ./
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
# Migrations run on startup, from ../../drizzle relative to dist/db.
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
RUN mkdir /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/v1/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next.js's standalone output keeps the workspace layout: the server lives in apps/web.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/login`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]

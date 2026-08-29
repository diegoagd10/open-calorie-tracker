FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app

FROM base AS dependencies

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm typecheck \
  && pnpm build \
  && pnpm prune --prod

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/open-calory-tracker.sqlite
ENV TZ=UTC

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server.js ./server.js

RUN mkdir -p /app/data \
  && chown node:node /app/data

USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health/ready`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "server.js"]

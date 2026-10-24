<img src="assets/icon.svg" width="64" height="64" alt="">

# open-calorie-tracker

Created in [T3 Code](https://t3.codes).

## Stack

- `apps/web` — Next.js (App Router, TypeScript, Tailwind)
- `apps/api` — NestJS + Drizzle ORM (SQLite)
- `packages/shared` — login schema (zod) and auth constants used by the web app, the API and the tests

## Development

```bash
pnpm install
pnpm --filter web exec playwright install chromium   # browser tests
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter api db:seed     # creates the development user (SEED_USER_* in apps/api/.env)
pnpm dev:api                  # http://localhost:3001
pnpm dev:web                  # http://localhost:3000
pnpm --filter @open-calorie-tracker/shared dev   # only when editing packages/shared
```

## Code quality ([Vite+](https://viteplus.dev))

```bash
pnpm check      # format + lint + type check
pnpm check:fix  # same, auto-fixing format and lint issues
pnpm lint       # vp lint (Oxlint)
pnpm fmt        # vp fmt (Oxfmt)
pnpm test       # vp test (Vitest)
pnpm test:cov   # tests with coverage; fails below 95%
```

`packages/shared` is built with `vp pack` on `pnpm install`, on `pnpm build` and before the tests;
while editing it, keep its `dev` script running in watch mode.

The web tests start their own `next dev`, and Next.js allows only one per project, so stop
`pnpm dev:web` before running them.

Lint and format settings live in the root `vite.config.ts`; test settings live in each package's
`vite.config.ts`.

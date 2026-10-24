<img src="assets/icon.svg" width="64" height="64" alt="">

# open-calorie-tracker

Created in [T3 Code](https://t3.codes).

## Stack

- `apps/web` — Next.js (App Router, TypeScript, Tailwind)
- `apps/api` — NestJS + Drizzle ORM (SQLite)

## Desarrollo

```bash
pnpm install
pnpm --filter web exec playwright install chromium   # tests de navegador
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev:api                  # http://localhost:3001
pnpm dev:web                  # http://localhost:3000
```

## Calidad de código ([Vite+](https://viteplus.dev))

```bash
pnpm check      # formato + lint + type check
pnpm check:fix  # lo mismo, corrigiendo formato y lint automáticamente
pnpm lint       # vp lint (Oxlint)
pnpm fmt        # vp fmt (Oxfmt)
pnpm test       # vp test (Vitest)
pnpm test:cov   # tests con coverage
```

La configuración de lint y formato vive en `vite.config.ts` (raíz); la de tests en `apps/api/vite.config.ts`.

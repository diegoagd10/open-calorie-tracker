<img src="assets/icon.svg" width="64" height="64" alt="">

# open-calorie-tracker

Created in [T3 Code](https://t3.codes).

## Stack

- `apps/web` — Next.js (App Router, TypeScript, Tailwind)
- `apps/api` — NestJS + Drizzle ORM (SQLite)
- `packages/shared` — schema de login (zod) y constantes de auth que usan la web, la API y las pruebas

## Desarrollo

```bash
pnpm install
pnpm --filter web exec playwright install chromium   # tests de navegador
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter api db:seed     # crea el usuario de desarrollo (SEED_USER_* en apps/api/.env)
pnpm dev:api                  # http://localhost:3001
pnpm dev:web                  # http://localhost:3000
pnpm --filter @open-calorie-tracker/shared dev   # solo si editas packages/shared
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

`packages/shared` se compila con `vp pack` en `pnpm install` y en `pnpm build`; mientras lo editas, déjalo en modo watch con su `dev`.

La configuración de lint y formato vive en `vite.config.ts` (raíz); la de tests en `apps/api/vite.config.ts`.

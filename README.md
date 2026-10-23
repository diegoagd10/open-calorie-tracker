<img src="assets/icon.svg" width="64" height="64" alt="">

# open-calorie-tracker

Created in [T3 Code](https://t3.codes).

## Stack

- `apps/web` — Next.js (App Router, TypeScript, Tailwind)
- `apps/api` — NestJS + Drizzle ORM (SQLite)

## Desarrollo

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev:api                  # http://localhost:3001
pnpm dev:web                  # http://localhost:3000
```

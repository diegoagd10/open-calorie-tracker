# Daily Intake

A small Next.js application for recording foods and tracking total calories by day. Entries persist locally in SQLite.

## Requirements

- Node.js 20.9 or newer
- pnpm 11

## Development

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created automatically at `data/calories.db`. Override its location with `CALORIE_DB_PATH`.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

Tests follow the repository, business-logic, and HTTP API seams. They use in-memory or temporary SQLite databases and do not modify local application data.

# Daily Intake

A local, single-user nutrition ledger for reusable serving-based foods, dated
food snapshots, hydration, daily comparison targets, and weight history.

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

The SQLite database is created automatically at `data/calories.db`. Override its
location with `DAILY_INTAKE_DB_PATH` (or the legacy `CALORIE_DB_PATH` variable).
Existing `calorie_entries` rows are migrated into editable legacy food snapshots
with unavailable nutrients represented as zero.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

Tests follow the repository, business-logic, and HTTP API seams. They use in-memory or temporary SQLite databases and do not modify local application data.

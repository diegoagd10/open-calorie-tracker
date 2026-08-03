# Calories

Calories is a self-hosted, single-user food and nutrition tracker. The first screen is a server-rendered Daily log. Confirmed Foods and one-unit Meals are reusable, while each logged Food entry keeps its own immutable Nutritional snapshot.

## Development

```bash
pnpm install
pnpm migrate
pnpm dev
```

Open <http://localhost:3000>. Durable data defaults to `./data`; set `DATA_DIR` and `TIMEZONE` to configure the local instance. `pnpm typecheck` runs TypeScript checking and `pnpm test` runs the isolated and request-level tests.

The application uses TypeScript/ESM, Express 5, HTMX, SQLite, Drizzle schema definitions, and explicit versioned migrations. Runtime startup does not mutate the schema implicitly; run `pnpm migrate` or the deployment migration command first.

## Provider configuration

Provider credentials stay server-side. Optional values include:

- `OPEN_FOOD_FACTS_USER_AGENT` for identifying barcode requests;
- `OPENAI_API_KEY` and `OPENAI_MODEL` for Food image analysis; and
- `MAX_IMAGE_BYTES` for retained image validation.

External records and AI proposals remain transient candidates until the User reviews and explicitly confirms them. Provider failures are classified so only temporary availability failures offer retry.

## Production

Docker Compose is the supported self-hosted deployment. `DATA_DIR` contains `calories.sqlite`, retained `images/`, and generated `exports/`. HTTPS and public exposure belong to an optional reverse proxy. See [`docs/deployment.md`](docs/deployment.md) for backup, restore, and upgrade procedures.

## Existing ingredient CLI

The original image ingredient extractor remains available as a separate CLI:

```bash
pnpm setup-key
pnpm extract ./path/to/image.jpg
```

It prints `no food` for a non-food image and JSON ingredients for a food image.

# Agent guide

## Codebase map

- `app/routes/` owns the React Router HTTP/UI edge; feature behavior lives in
  the sibling `app/` domain directories.
- `app/**/runtime.server.ts` files are environment boundaries; `app/database/`
  owns SQLite and Drizzle access; `server/` owns the Express process edge.
- `tests/` contains Vitest and Playwright behavior; `scripts/` contains the
  executable quality policies. `.fallowrc.json` is the source of truth for
  allowed architecture and side effects.

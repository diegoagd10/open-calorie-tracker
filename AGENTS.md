# Agent guide

## Codebase map

- `app/routes/` owns the React Router HTTP/UI edge; feature behavior lives in
  the sibling `app/` domain directories.
- `app/**/runtime.server.ts` files are environment boundaries; `app/database/`
  owns SQLite and Drizzle access; `server/` owns the Express process edge.
- `tests/` contains Vitest and Playwright behavior; `scripts/` contains the
  executable quality policies. `.fallowrc.json` is the source of truth for
  allowed architecture and side effects.

## Verification contract

Run focused tests while working. Before handoff, run `pnpm verify`. Run
`pnpm verify:deep` for releases and broad production, architecture, test, or
tooling changes. Read `docs/verification.md` when a gate fails, its prerequisites
matter, or a Fallow baseline must change.

Docker deployment tests and the credentialed USDA live test are explicit
external suites; their commands and requirements are in `docs/verification.md`.
